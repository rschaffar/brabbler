"use strict";
/* Shared installed CLI/server credential owner. No passwords or verifier bytes in errors. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { constants: C } = fs;
const PARAMS = Object.freeze({ N: 32768, r: 8, p: 1 });
const MAX_RECORD = 2048;
const MAX_PASSWORD = 1024;
const slotKey = Symbol.for("brabbler:password-kdf-slots");
const slots = globalThis[slotKey] ||= { active: 0 };

function unsafe() { return new Error("Web authentication state is invalid or insecure; repair it locally."); }
function authDirectory(env = process.env) {
  return path.resolve(env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "brabbler", "auth");
}
function checkOwned(stat, directory = false) {
  if (typeof process.getuid !== "function" || stat.uid !== process.getuid()
    || (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600)
    || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw unsafe();
}
// Walk each physical component: mkdir(recursive) and realpath alone would accept aliases.
// Only app-owned directories require private permissions; HOME/agent ancestors may be shared.
function openDirectory(env, create) {
  const dir = authDirectory(env);
  const parts = dir.split(path.sep).filter(Boolean);
  const privateStats = [];
  let current = path.parse(dir).root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw unsafe();
      if (!create) return null;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw unsafe(); }
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe();
    if (i === parts.length - 3 && (typeof process.getuid !== "function" || stat.uid !== process.getuid()
      || (stat.mode & 0o7022) !== 0)) throw unsafe();
    if (i >= parts.length - 2) {
      if (create) {
        try { checkOwned(stat, true); }
        catch { throw new Error("Local auth setup requires owned physical brabbler/ and auth/ directories with mode 0700; inspect and repair them locally."); }
      } else privateStats.push(stat);
    }
  }
  // Legacy settings may have created brabbler/ as 0755. Only enforce auth's
  // private-directory contract after auth/ exists; absence must stay compatible.
  for (const stat of privateStats) checkOwned(stat, true);
  const fd = fs.openSync(dir, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
  try {
    checkOwned(fs.fstatSync(fd), true);
    // Descriptor-relative access pins the private directory even if a parent moves.
    // Refuse platforms without this facility rather than weakening no-follow semantics.
    const pinned = `/proc/self/fd/${fd}`;
    if (fs.realpathSync(pinned) !== dir || fs.realpathSync(dir) !== dir) throw unsafe();
    return { fd, path: pinned };
  } catch (error) { fs.closeSync(fd); throw error; }
}
function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || Object.keys(record).sort().join() !== "kdf,key,salt,verifier,version"
    || record.version !== 1 || !record.kdf || Object.keys(record.kdf).sort().join() !== "N,p,r"
    || record.kdf.N !== PARAMS.N || record.kdf.r !== PARAMS.r || record.kdf.p !== PARAMS.p
    || typeof record.salt !== "string" || typeof record.verifier !== "string" || typeof record.key !== "string"
    || !/^[a-f0-9]{64}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.verifier)
    || !/^[a-f0-9]{64}$/.test(record.key)) throw unsafe();
  return record;
}
function readAt(dir) {
  let fd;
  try { fd = fs.openSync(path.join(dir.path, "credentials.json"), C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK); }
  catch (error) { if (error.code === "ENOENT") return null; throw unsafe(); }
  try {
    const stat = fs.fstatSync(fd); checkOwned(stat);
    if (stat.size < 1 || stat.size > MAX_RECORD) throw unsafe();
    const bytes = Buffer.alloc(MAX_RECORD + 1);
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (size !== stat.size || size > MAX_RECORD) throw unsafe();
    return validateRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
  } catch { throw unsafe(); } finally { fs.closeSync(fd); }
}
function readCredentials(env = process.env) {
  const dir = openDirectory(env, false);
  if (!dir) return null;
  try { return readAt(dir); } finally { fs.closeSync(dir.fd); }
}
async function derive(password, salt) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > MAX_PASSWORD) return null;
  if (slots.active >= 2) {
    const error = new Error("Authentication is busy; try again."); error.code = "AUTH_BUSY"; throw error;
  }
  slots.active++;
  try {
    return await new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, "hex"), 32,
      { ...PARAMS, maxmem: 48 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { slots.active--; }
}
async function verifyPassword(password, record) {
  validateRecord(record);
  const key = await derive(password, record.salt);
  return key !== null && timingSafeEqual(key, Buffer.from(record.verifier, "hex"));
}
async function setupCredentials(password, { replace = false, env = process.env } = {}) {
  if (env.BRABBLER_PASSWORD) throw new Error("Unset BRABBLER_PASSWORD before local auth setup.");
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > MAX_PASSWORD) {
    throw new Error("Use a passphrase of at least 12 characters and at most 1024 UTF-8 bytes.");
  }
  const dir = openDirectory(env, true);
  const lock = path.join(dir.path, "setup.lock");
  let locked = false, temporary;
  try {
    const lockFd = fs.openSync(lock, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
    locked = true; fs.closeSync(lockFd);
    const old = readAt(dir);
    if (old && !replace) throw new Error("Web authentication is already configured; use auth setup --replace to rotate it.");
    if (!old && replace) throw new Error("No credentials to replace; use auth setup.");
    const salt = randomBytes(32).toString("hex");
    const verifier = await derive(password, salt);
    const record = { version: 1, kdf: PARAMS, salt, verifier: verifier.toString("hex"), key: randomBytes(32).toString("hex") };
    temporary = path.join(dir.path, `.credentials-${randomBytes(16).toString("hex")}`);
    const fd = fs.openSync(temporary, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const target = path.join(dir.path, "credentials.json");
    if (old) {
      const current = readAt(dir);
      if (!current || JSON.stringify(current) !== JSON.stringify(old)) throw unsafe();
      fs.renameSync(temporary, target);
    } else {
      fs.linkSync(temporary, target); // exclusive publication: never silently overwrite
      fs.unlinkSync(temporary);
    }
    temporary = null; fs.fsyncSync(dir.fd);
  } finally {
    try { if (temporary) fs.unlinkSync(temporary); }
    finally { try { if (locked) fs.unlinkSync(lock); } finally { fs.closeSync(dir.fd); } }
  }
}
module.exports = { authDirectory, readCredentials, setupCredentials, verifyPassword };
