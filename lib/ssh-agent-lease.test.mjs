import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { claimSshSettingsLease } from "../bin/ssh-agent-lease.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ssh-lease-")), settings = join(root, "settings.json"), directory = settings + ".lock";
  t.after(() => rmSync(root, { recursive: true, force: true })); return { root, settings, directory };
}
async function deadOwner(settings, prelude = "") {
  const helper = new URL("../bin/ssh-agent-lease.js", import.meta.url).pathname;
  const child = spawn(process.execPath, ["-e", `${prelude}; require(${JSON.stringify(helper)}).claimSshSettingsLease(${JSON.stringify(settings)}); setInterval(()=>{},1000); process.stdout.write('ready');`], { env: {}, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  try {
    await Promise.race([once(child.stdout, "data"), once(child, "exit").then(() => { throw new Error("Lease child failed: " + errors); })]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGKILL"); await closed; }
  }
}

test("exclusive owner has a unique private marker, with idempotent bounded release", t => {
  const { settings, directory } = fixture(t); const lease = claimSshSettingsLease(settings);
  try {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700); assert.equal(readdirSync(directory).length, 1);
    const marker = join(directory, readdirSync(directory)[0]); assert.equal(fs.statSync(marker).mode & 0o777, 0o600);
    lease.assertOwned(); assert.throws(() => claimSshSettingsLease(settings), /already being held/);
  } finally { lease.release(); lease.release(); }
  assert.equal(existsSync(directory), false);
});

test("known dead owner in the same execution context is recoverable without a time-based takeover", async t => {
  const { settings, directory } = fixture(t); await deadOwner(settings);
  const oldName = readdirSync(directory)[0]; const lease = claimSshSettingsLease(settings);
  try { lease.assertOwned(); assert.notEqual(readdirSync(directory)[0], oldName); }
  finally { lease.release(); }
  assert.equal(existsSync(directory), false);
});

test("a gated release cannot rename or remove a replacement owner's unique marker", t => {
  const { settings, directory } = fixture(t); const lease = claimSshSettingsLease(settings);
  const owner = readdirSync(directory)[0], body = readFileSync(join(directory, owner));
  const replacement = `owner-${process.pid}-${randomUUID()}`; const original = fs.renameSync; let gated = false;
  lease.assertOwned();
  try {
    fs.renameSync = (from, to) => {
      if (!gated && from === join(directory, owner)) {
        gated = true; original(directory, directory + ".retired"); mkdirSync(directory, { mode: 0o700 }); writeFileSync(join(directory, replacement), body, { mode: 0o600 });
      }
      return original(from, to);
    };
    lease.release();
  } finally { fs.renameSync = original; lease.release(); }
  assert.equal(gated, true); assert.deepEqual(readdirSync(directory), [replacement]); assert.equal(existsSync(join(directory + ".retired", owner)), true);
});

test("a gated stale reaper cannot delete a competing replacement admitted after its inspection", async t => {
  const { settings, directory } = fixture(t); await deadOwner(settings);
  const old = join(directory, readdirSync(directory)[0]), original = fs.renameSync; let competing, gated = false;
  try {
    fs.renameSync = (from, to) => {
      if (!gated && from === old) { gated = true; competing = claimSshSettingsLease(settings); }
      return original(from, to);
    };
    assert.throws(() => claimSshSettingsLease(settings), /already being held/);
    competing.assertOwned(); assert.equal(readdirSync(directory).length, 1);
  } finally { fs.renameSync = original; competing?.release(); }
  assert.equal(existsSync(directory), false);
});

test("incomplete or foreign-context leases fail closed instead of inferring stale ownership", async t => {
  const { settings, directory } = fixture(t);
  mkdirSync(directory, { mode: 0o700 }); assert.throws(() => claimSshSettingsLease(settings), /Incomplete/); fs.rmdirSync(directory);
  await deadOwner(settings);
  const marker = join(directory, readdirSync(directory)[0]); writeFileSync(marker, JSON.stringify({ version: 1, context: "other-namespace" }));
  assert.throws(() => claimSshSettingsLease(settings), /another boot\/host\/PID namespace/); assert.equal(existsSync(marker), true);
});

test("matching unavailable context identifiers never authorize automatic stale recovery", async t => {
  const { settings, directory } = fixture(t);
  const prelude = `const fs = require('node:fs'), read = fs.readFileSync, link = fs.readlinkSync;
    fs.readFileSync = (file,...args) => { if(file==='/proc/sys/kernel/random/boot_id') throw new Error('unavailable'); return read(file,...args); };
    fs.readlinkSync = (file,...args) => { if(file==='/proc/self/ns/pid') throw new Error('unavailable'); return link(file,...args); };`;
  await deadOwner(settings, prelude);
  const marker = join(directory, readdirSync(directory)[0]);
  const data = JSON.parse(JSON.parse(readFileSync(marker, "utf8")).context);
  assert.equal(data.boot, null); assert.equal(data.pidNamespace, null);
  const originalRead = fs.readFileSync, originalLink = fs.readlinkSync;
  try {
    fs.readFileSync = (file, ...args) => { if (file === "/proc/sys/kernel/random/boot_id") throw new Error("unavailable"); return originalRead(file, ...args); };
    fs.readlinkSync = (file, ...args) => { if (file === "/proc/self/ns/pid") throw new Error("unavailable"); return originalLink(file, ...args); };
    assert.throws(() => claimSshSettingsLease(settings), /unverified/);
  } finally { fs.readFileSync = originalRead; fs.readlinkSync = originalLink; }
  assert.equal(existsSync(marker), true);
});

test("unknown files are never recursively removed during release or subsequent recovery", t => {
  const { settings, directory } = fixture(t); const lease = claimSshSettingsLease(settings);
  writeFileSync(join(directory, "unexpected"), "preserve"); assert.throws(() => lease.release(), /ENOTEMPTY/);
  assert.equal(readFileSync(join(directory, "unexpected"), "utf8"), "preserve"); assert.throws(() => claimSshSettingsLease(settings), /Incomplete/);
});
