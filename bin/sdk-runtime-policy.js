"use strict";
/* Version/inventory-pinned exclusion, only in an exclusively owned installation.
 * Startup checks read-only. Never remove an upstream/shared/global Pi install.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { resolveInstalledSdkRoot, payload } = require("./patch-sdk-command-env");
const applicationRoot = path.resolve(__dirname, "..");
const BUNDLE_DIGEST = "f6deb19c143757233fe221c10ee27bd4cb6b5f59240330a5462a975f1da06bd2";
const FIXED_UNDICI = "8.12.2";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function refusal(code) { return Object.assign(new Error(`SDK runtime policy refused (${code})`), { code }); }
function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return null; throw refusal("SDK_RUNTIME_FILE"); }
}
function regular(file, limit = 1024 * 1024) {
  const s = stat(file);
  if (!s?.isFile() || s.size > limit) throw refusal("SDK_RUNTIME_FILE");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const current = fs.fstatSync(fd);
    if (current.dev !== s.dev || current.ino !== s.ino || !current.isFile()) throw refusal("SDK_RUNTIME_CHANGED");
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) throw refusal("SDK_RUNTIME_FILE");
    return bytes;
  } finally { fs.closeSync(fd); }
}
function context(root) {
  const sdk = resolveInstalledSdkRoot(root);
  if (hash(regular(path.join(sdk, "package.json"))) !== payload.packageJsonSha256 || payload.packageVersion !== "1.4.0") throw refusal("SDK_RUNTIME_VERSION");
  const require = createRequire(path.join(sdk, "package.json"));
  let undici;
  try { undici = JSON.parse(regular(require.resolve("undici/package.json"))); }
  catch { throw refusal("SDK_RUNTIME_UNDICI"); }
  if (undici.version !== FIXED_UNDICI) throw refusal("SDK_RUNTIME_UNDICI");
  return { sdk, bundle: path.join(sdk, "dist/bundle"), staged: path.join(sdk, "dist/.brabbler-excluded-bundle"),
    bin: path.join(path.dirname(path.dirname(sdk)), ".bin/pi") };
}
function cliLink(c) {
  const s = stat(c.bin);
  if (!s) return false;
  if (!s.isSymbolicLink() || path.resolve(path.dirname(c.bin), fs.readlinkSync(c.bin)) !== path.join(c.bundle, "cli.js")) throw refusal("SDK_RUNTIME_BIN");
  return true;
}
function verifyBundle(directory) {
  const records = [];
  let bytes = 0;
  function walk(dir, prefix = "") {
    if (!stat(dir)?.isDirectory()) throw refusal("SDK_RUNTIME_BUNDLE_TYPE");
    if (prefix.split("/").length > 4) throw refusal("SDK_RUNTIME_BUNDLE_LIMIT");
    for (const name of fs.readdirSync(dir).sort()) {
      if (records.length >= 128) throw refusal("SDK_RUNTIME_BUNDLE_LIMIT");
      if (!/^[A-Za-z0-9._-]+$/.test(name)) throw refusal("SDK_RUNTIME_BUNDLE_NAME");
      const relative = prefix + name, file = path.join(dir, name), s = stat(file);
      if (s?.isDirectory()) { records.push(`d ${relative}`); walk(file, relative + "/"); }
      else if (s?.isFile()) {
        bytes += s.size;
        if (bytes > 16 * 1024 * 1024 || records.length >= 128) throw refusal("SDK_RUNTIME_BUNDLE_LIMIT");
        let contents = regular(file, 16 * 1024 * 1024);
        // Nix's npm hook rewrites these three known upstream Node shebangs
        // before preInstall. Normalize only this exact interpreter substitution;
        // every remaining byte and every inventory entry is still fingerprinted.
        if (["cli.js", "cli-runtime.js", "rpc-entry.js"].includes(relative)) {
          const end = contents.indexOf(10);
          const line = end >= 0 && end < 4096 ? contents.subarray(0, end).toString("utf8") : "";
          if (line.startsWith("#!/")) {
            // The Nix Node package's bin/node may itself be a symlink to slim Node.
            let sameInterpreter = false;
            try { sameInterpreter = fs.realpathSync(line.slice(2)) === fs.realpathSync(process.execPath); } catch { /* Unknown shebang remains fingerprinted unchanged. */ }
            if (sameInterpreter) contents = Buffer.concat([Buffer.from("#!/usr/bin/env node\n"), contents.subarray(end + 1)]);
          }
        }
        records.push(`f ${relative} ${hash(contents)}`);
      } else throw refusal("SDK_RUNTIME_BUNDLE_TYPE");
    }
  }
  walk(directory);
  if (records.length !== 82 || hash(records.sort().join("\n") + "\n") !== BUNDLE_DIGEST) throw refusal("SDK_RUNTIME_BUNDLE_UNKNOWN");
}
function checkSdkRuntimePolicy(root = applicationRoot) {
  const c = context(root);
  if (stat(c.bundle) || stat(c.staged) || cliLink(c)) throw refusal("SDK_RUNTIME_NOT_EXCLUDED");
  return { packageVersion: "1.4.0", undiciVersion: FIXED_UNDICI, standaloneBundles: "excluded" };
}
function preflightOwnedSdk(root = applicationRoot) {
  // npm hoisting could share this SDK with another application. Require a physical
  // private dependency subtree, as produced by --install-strategy=nested or Nix.
  const owned = fs.realpathSync(root);
  for (const relative of ["node_modules", "node_modules/@earendil-works", "node_modules/@earendil-works/pi-coding-agent"]) {
    const dir = path.join(owned, relative);
    if (!stat(dir)?.isDirectory() || fs.realpathSync(dir) !== dir) throw refusal("SDK_RUNTIME_SHARED_INSTALL");
  }
  const c = context(owned);
  if (c.sdk !== path.join(owned, "node_modules/@earendil-works/pi-coding-agent")) throw refusal("SDK_RUNTIME_SHARED_INSTALL");
  for (const dir of [path.join(c.sdk, "dist"), path.dirname(c.bin)]) {
    if (stat(dir) && (!stat(dir).isDirectory() || fs.realpathSync(dir) !== dir)) throw refusal("SDK_RUNTIME_SHARED_INSTALL");
  }
  const link = cliLink(c), bundle = stat(c.bundle), staged = stat(c.staged);
  if (bundle && staged) throw refusal("SDK_RUNTIME_INSTALL_CHANGED");
  if (bundle) verifyBundle(c.bundle);
  if (staged) verifyBundle(c.staged);
  return { c, link, bundle, staged, owned };
}
function preflightSdkRuntimePolicy(root = applicationRoot) {
  preflightOwnedSdk(root);
  return { owned: true, packageVersion: "1.4.0" };
}
function applySdkRuntimePolicy(root = applicationRoot) {
  const { c, link, bundle, staged, owned } = preflightOwnedSdk(root);
  // Only the complete known upstream tree may be renamed/removed. An interrupted
  // partial removal refuses: reinstall into a fresh owned prefix; do not guess.
  if (bundle) fs.renameSync(c.bundle, c.staged);
  if (link) { cliLink(c); fs.unlinkSync(c.bin); }
  if (bundle || staged) { verifyBundle(c.staged); fs.rmSync(c.staged, { recursive: true }); }
  checkSdkRuntimePolicy(owned);
  return { changed: Boolean(bundle || staged || link), standaloneBundles: "excluded" };
}
function main(args) {
  if (args.length !== 1 || !["--preflight", "--apply", "--check"].includes(args[0])) throw refusal("SDK_RUNTIME_ARGUMENTS");
  if (args[0] === "--preflight") preflightSdkRuntimePolicy();
  else if (args[0] === "--apply") applySdkRuntimePolicy();
  else checkSdkRuntimePolicy();
}
module.exports = { checkSdkRuntimePolicy, applySdkRuntimePolicy, preflightSdkRuntimePolicy };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.code?.startsWith("SDK_RUNTIME_") ? error.message : "SDK runtime policy failed; use a fresh, owned nested installation."); process.exitCode = 1; }
}
