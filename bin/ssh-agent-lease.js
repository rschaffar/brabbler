"use strict";
/* Launcher/CommonJS module. Same-UID processes remain trusted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const namespaces = new Set();
const markerPattern = /^(?:owner|reap)-([1-9][0-9]{0,9})-[a-f0-9-]{36}$/;

function context() {
  const read = file => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return null; } };
  let pidNamespace = null;
  try { pidNamespace = fs.readlinkSync("/proc/self/ns/pid"); } catch { /* Non-Linux Unix host. */ }
  const boot = read("/proc/sys/kernel/random/boot_id");
  return { id: JSON.stringify({ host: createHash("sha256").update(os.hostname() + "\0" + (read("/etc/machine-id") || "")).digest("hex"), boot, pidNamespace }),
    canRecover: typeof boot === "string" && /^[a-f0-9-]{36}$/.test(boot) && typeof pidNamespace === "string" && /^pid:\[[0-9]+\]$/.test(pidNamespace),
  };
}
function held(message = "SSH settings lock is already being held") { return Object.assign(new Error(message), { code: "ELOCKED" }); }
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; return true; }
}

/**
 * No time-based takeover of a live PID. All cooperating claim/release/reap paths
 * first atomically rename a UNIQUE marker, never a generic owner filename. A
 * stale reader therefore cannot remove a replacement owner's marker. Once the
 * marker is removed, an empty/incomplete directory is NOT reclaimable: it fences
 * the final rmdir interval even if this process is suspended or dies there.
 * Incomplete/foreign-context leases require explicit operator recovery. This is
 * conservative on PID reuse and across boots/PID namespaces, not proof of death.
 */
function claimSshSettingsLease(settingsPath) {
  const directory = settingsPath + ".lock";
  const key = path.join(fs.realpathSync(path.dirname(settingsPath)), path.basename(settingsPath));
  if (namespaces.has(key)) throw held();
  const ownerContext = context();
  const owner = `owner-${process.pid}-${randomUUID()}`;
  const ownerPath = path.join(directory, owner);
  const uid = BigInt(process.getuid());
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    try { fs.mkdirSync(directory, { mode: 0o700 }); acquired = true; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = fs.lstatSync(directory, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o022n)) throw held("Unsafe SSH settings lease; operator recovery required");
      let files;
      try { files = fs.readdirSync(directory); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (files.length !== 1 || !markerPattern.test(files[0])) throw held("Incomplete SSH settings lease; confirm its owner has stopped before recovery");
      const previous = path.join(directory, files[0]); const pid = Number(markerPattern.exec(files[0])[1]);
      if (alive(pid)) throw held();
      let data;
      try {
        const marker = fs.lstatSync(previous, { bigint: true });
        if (!marker.isFile() || marker.isSymbolicLink() || marker.uid !== uid || (marker.mode & 0o022n) || marker.size > 1024n) throw held("Unsafe SSH settings lease marker");
        data = JSON.parse(fs.readFileSync(previous, "utf8"));
      } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (!ownerContext.canRecover) throw held("SSH settings lease context is unverified; operator recovery required");
      if (!data || data.version !== 1 || data.context !== ownerContext.id) throw held("SSH settings lease belongs to another boot/host/PID namespace; confirm the owner stopped before recovery");
      const reaping = path.join(directory, `reap-${process.pid}-${randomUUID()}`);
      try { fs.renameSync(previous, reaping); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      fs.unlinkSync(reaping); fs.rmdirSync(directory);
    }
  }
  if (!acquired) throw held("SSH settings lease changed concurrently; retry explicitly");
  try {
    fs.writeFileSync(ownerPath, JSON.stringify({ version: 1, context: ownerContext.id }) + "\n", { mode: 0o600, flag: "wx" });
  } catch (error) {
    // Only this newly created directory/marker; never recursively remove contents.
    try { fs.unlinkSync(ownerPath); } catch {} try { fs.rmdirSync(directory); } catch {} throw error;
  }
  const directoryStat = fs.lstatSync(directory, { bigint: true });
  const markerStat = fs.lstatSync(ownerPath, { bigint: true });
  namespaces.add(key); let released = false;
  const assertOwned = () => {
    const current = fs.lstatSync(directory, { bigint: true }), marker = fs.lstatSync(ownerPath, { bigint: true });
    if (released || !current.isDirectory() || current.isSymbolicLink() || current.ino !== directoryStat.ino || current.dev !== directoryStat.dev
      || !marker.isFile() || marker.isSymbolicLink() || marker.ino !== markerStat.ino || marker.dev !== markerStat.dev) throw new Error("SSH settings ownership lost; restart this runtime");
  };
  const release = () => {
    if (released) return; released = true; namespaces.delete(key); process.removeListener("exit", exit);
    const reaping = path.join(directory, `reap-${process.pid}-${randomUUID()}`);
    // The unique source marker is the fence, including after a stalled precheck.
    try { fs.renameSync(ownerPath, reaping); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    fs.unlinkSync(reaping); fs.rmdirSync(directory);
  };
  const exit = () => { try { release(); } catch { /* No recursive or foreign-owner exit cleanup. */ } };
  process.once("exit", exit);
  return { assertOwned, release };
}
module.exports = { claimSshSettingsLease };
