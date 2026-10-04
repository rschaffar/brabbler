import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";

// Faults affect this freshly compiled module ONLY, never global fs or production
// callback parameters. Every filesystem action below is inside mkdtemp fixtures.
const load = (overrides = {}, extra = {}) => bindingTestModule("./git-diagnostic-retention.ts", {
  "node:fs": { ...fs, ...overrides }, ...extra,
});
const api = load();
const linux = { skip: process.platform !== "linux" };
const metadata = (n = 1) => ({ kind: "commit", nativeOutcome: "succeeded", completedAt: n, durationMs: 12, exitCode: 0 });
function fixture(t, mod = api, budgets) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pi-diagnostics-fixture-"));
  fs.chmodSync(parent, 0o700);
  const opened = mod.openGitDiagnosticStore(parent, { create: true, budgets });
  assert.equal(opened.status, "stored");
  t.after(() => { opened.store.close(); fs.rmSync(parent, { recursive: true, force: true }); });
  return { parent, ...opened };
}
function reopen(t, f, mod = api, budgets) {
  const r = mod.openGitDiagnosticStore(f.root, { budgets });
  assert.equal(r.status, "stored"); t.after(() => r.store.close()); return r.store;
}
function itemPath(f, id, type = "record") { return path.join(f.root, `${id}.${type}`); }
function errno(code) { return Object.assign(new Error("private path/secret must not leak"), { code }); }

// Freeze only the accounting regressions' clock: actual filesystem, envelopes,
// hashing and deletion remain real. Deadline behavior has separate coverage.
const accountingClock = { "node:perf_hooks": { performance: { now: () => 0 } } };

for (const suffix of ["artifact", "action"]) test(`inventory-discovered ${suffix} ID conflict cannot evict the winning publication`, linux, t => {
  const budgets = suffix === "artifact" ? { artifactBytes: 1800 } : { recordBytes: 1800 };
  const method = suffix === "artifact" ? "appendCompletedArtifact" : "appendCompletedRecord";
  const field = suffix === "artifact" ? "artifact" : "record";
  const f = fixture(t, api, budgets), id = randomUUID();
  const winner = Buffer.alloc(1000, 66), incoming = Buffer.alloc(1000, 65);
  let armed = true, winningBytes;
  const racing = load({ opendirSync(...args) {
    // A has checked absence, but has not begun inventory. Independent B really
    // publishes a valid envelope at X before A can inspect or rotate it.
    if (armed) {
      armed = false;
      assert.equal(f.store[method](id, winner)[field], "stored");
      winningBytes = fs.readFileSync(itemPath(f, id, suffix));
    }
    return fs.opendirSync(...args);
  } }, accountingClock);
  const a = reopen(t, f, racing, budgets);
  const result = a[method](id, incoming);
  assert.equal(armed, false);
  assert.deepEqual(fs.readFileSync(itemPath(f, id, suffix)), winningBytes, "A must not rotate B away to reuse its ID");
  assert.equal(result[field], "unavailable");
  assert.ok(result.warnings.includes("changed-item"));
  assert.deepEqual(fs.readdirSync(f.root), [`${id}.${suffix}`]);
});

test("combined within-category bytes cross 128MiB without freezing append or restart", linux, t => {
  const mod = load({}, accountingClock), f = fixture(t, mod);
  const log = Buffer.alloc(8 * 1024 * 1024, 108), artifact = Buffer.alloc(2 * 1024 * 1024, 97);
  for (let n = 0; n < 12; n++) assert.equal(f.store.append(metadata(n), log).log, "stored");
  for (let n = 0; n < 16; n++) assert.equal(f.store.appendCompletedArtifact(randomUUID(), artifact).artifact, "stored");
  const size = fs.readdirSync(f.root).reduce((total, name) => total + fs.statSync(path.join(f.root, name)).size, 0);
  assert.ok(size > 128 * 1024 * 1024);
  assert.equal(f.store.appendCompletedArtifact(randomUUID(), artifact).artifact, "stored", "next append must still inventory its own valid files");
  f.store.close();
  const restarted = reopen(t, f, load({}, accountingClock));
  for (let n = 0; n < 18; n++) assert.equal(restarted.appendCompletedArtifact(randomUUID(), artifact).artifact, "stored");
  // Fill the third category near its target too, using genuine private action
  // envelopes without quadratic setup reads of the already-large inventory.
  const record = Buffer.alloc(api.GIT_DIAGNOSTIC_LIMITS.recordBytes - 1024, 114), first = randomUUID();
  assert.equal(restarted.appendCompletedRecord(first, record).record, "stored");
  const template = fs.readFileSync(itemPath(f, first, "action")), end = template.indexOf(10);
  const header = JSON.parse(template.subarray(0, end));
  for (let n = 1; n < 64; n++) {
    const id = randomUUID();
    fs.writeFileSync(itemPath(f, id, "action"), Buffer.concat([Buffer.from(JSON.stringify({ ...header, id }) + "\n"), record]), { flag: "wx", mode: 0o600 });
  }
  assert.equal(restarted.appendCompletedRecord(randomUUID(), record).record, "stored");
  for (let n = 0; n < 3; n++) assert.equal(restarted.append(metadata(100 + n), log).log, "stored");
  const retained = restarted.retain();
  assert.equal(retained.complete, true);
  assert.ok(retained.observedBytes.log <= api.GIT_DIAGNOSTIC_LIMITS.logBudget);
  assert.ok(retained.observedBytes.artifact <= api.GIT_DIAGNOSTIC_LIMITS.artifactBudget);
  assert.ok(retained.observedBytes.record <= api.GIT_DIAGNOSTIC_LIMITS.recordBudget);
  assert.ok(Object.values(retained.observedBytes).reduce((sum, bytes) => sum + bytes, 0) > 170 * 1024 * 1024);
});

for (const firstSuffix of ["artifact", "action"]) test(`4096-entry boundary reserves pairs and protects correlated ${firstSuffix} across restart`, linux, t => {
  const mod = load({}, accountingClock), f = fixture(t, mod);
  const initial = f.store.append(metadata()), template = JSON.parse(fs.readFileSync(itemPath(f, initial.id)));
  // Seed genuine complete private envelopes, not 4095 quadratic append scans.
  for (let n = 1; n < 4095; n++) {
    const id = randomUUID();
    fs.writeFileSync(itemPath(f, id), JSON.stringify({ ...template, id }), { flag: "wx", mode: 0o600 });
  }
  const id = randomUUID();
  const firstMethod = firstSuffix === "artifact" ? "appendCompletedArtifact" : "appendCompletedRecord";
  const secondMethod = firstSuffix === "artifact" ? "appendCompletedRecord" : "appendCompletedArtifact";
  const firstField = firstSuffix === "artifact" ? "artifact" : "record";
  const secondField = firstSuffix === "artifact" ? "record" : "artifact";
  const readFirst = firstSuffix === "artifact" ? "readCompletedArtifact" : "readCompletedRecord";
  assert.equal(f.store[firstMethod](id, Buffer.from("first correlated copy"))[firstField], "stored");
  fs.utimesSync(itemPath(f, id, firstSuffix), 0, 0); // oldest: count pressure must still protect this ID
  assert.equal(fs.readdirSync(f.root).length, 4096);
  assert.equal(f.store[secondMethod](id, Buffer.from("second correlated copy"))[secondField], "stored");
  assert.equal(f.store[readFirst](id).value.toString(), "first correlated copy");
  assert.ok(fs.readdirSync(f.root).length <= 4096);
  f.store.close();
  const restarted = reopen(t, f, load({}, accountingClock));
  for (let n = 0; n < 3; n++) {
    const result = restarted.append(metadata(100 + n), Buffer.from("final output"));
    assert.equal(result.record, "stored"); assert.equal(result.log, "stored");
    assert.ok(fs.readdirSync(f.root).length <= 4096, "both record and log need reserved directory slots");
  }
  assert.equal(restarted.retain().complete, true);
});

for (const suffix of ["artifact", "action"]) test(`post-inventory ${suffix} conflict is rechecked before retiring any unrelated copy`, linux, t => {
  const method = suffix === "artifact" ? "appendCompletedArtifact" : "appendCompletedRecord";
  const field = suffix === "artifact" ? "artifact" : "record";
  const budgets = suffix === "artifact" ? { artifactBytes: 1800 } : { recordBytes: 1800 };
  const f = fixture(t), oldId = randomUUID(), id = randomUUID(), bytes = Buffer.alloc(1000, 66);
  assert.equal(f.store[method](oldId, bytes)[field], "stored");
  const original = fs.readFileSync(itemPath(f, oldId, suffix));
  let armed = true, winner;
  const mod = load({ opendirSync(...args) {
    const dir = fs.opendirSync(...args);
    return { readSync: () => dir.readSync(), closeSync() {
      dir.closeSync();
      if (armed) {
        armed = false;
        assert.equal(f.store[method](id, bytes)[field], "stored");
        winner = fs.readFileSync(itemPath(f, id, suffix));
      }
    } };
  } }, accountingClock);
  const result = reopen(t, f, mod, budgets)[method](id, Buffer.alloc(1000, 65));
  assert.equal(result[field], "unavailable"); assert.ok(result.warnings.includes("changed-item"));
  assert.deepEqual(fs.readFileSync(itemPath(f, oldId, suffix)), original);
  assert.deepEqual(fs.readFileSync(itemPath(f, id, suffix)), winner);
  assert.equal(fs.readdirSync(f.root).length, 2);
});

test("entry inventory overshoot retires only a bounded validated prefix and recovers after restart", linux, t => {
  const mod = load({}, accountingClock), f = fixture(t, mod), initial = f.store.append(metadata());
  const template = JSON.parse(fs.readFileSync(itemPath(f, initial.id)));
  for (let n = 1; n <= api.GIT_DIAGNOSTIC_LIMITS.entries; n++) {
    const id = randomUUID();
    fs.writeFileSync(itemPath(f, id), JSON.stringify({ ...template, id }), { flag: "wx", mode: 0o600 });
  }
  const result = f.store.append(metadata());
  assert.equal(result.record, "omitted", "partial inventory never grants publication capacity");
  assert.ok(result.warnings.includes("scan-incomplete"));
  assert.equal(fs.readdirSync(f.root).length, 1, "only the fully validated prefix was retired");
  f.store.close();
  const restarted = reopen(t, f, load({}, accountingClock));
  const next = restarted.append(metadata(), Buffer.from("finalized"));
  assert.equal(next.record, "stored"); assert.equal(next.log, "stored");
  assert.equal(restarted.retain().complete, true);
});

test("refused entry retirement cannot publish entry 4097 and recovers without a new namespace", linux, t => {
  const mod = load({}, accountingClock), f = fixture(t, mod), first = f.store.append(metadata());
  const template = JSON.parse(fs.readFileSync(itemPath(f, first.id)));
  for (let n = 1; n < api.GIT_DIAGNOSTIC_LIMITS.entryBudget; n++) {
    const id = randomUUID();
    fs.writeFileSync(itemPath(f, id), JSON.stringify({ ...template, id }), { flag: "wx", mode: 0o600 });
  }
  const refused = load({ renameSync() { throw errno("EACCES"); } }, accountingClock);
  const id = randomUUID(), before = fs.readdirSync(f.root).sort();
  const result = reopen(t, f, refused).appendCompletedArtifact(id, Buffer.from("final copy"));
  assert.equal(result.artifact, "omitted"); assert.ok(result.warnings.includes("budget-unavailable"));
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
  assert.equal(reopen(t, f, load({}, accountingClock)).appendCompletedArtifact(id, Buffer.from("final copy")).artifact, "stored");
  assert.equal(fs.readdirSync(f.root).length, api.GIT_DIAGNOSTIC_LIMITS.entryBudget);
});

for (const suffix of ["artifact", "action"]) test(`inventory-discovered malformed ${suffix} conflict stays untouched`, linux, t => {
  const f = fixture(t), id = randomUUID(), foreign = Buffer.from("foreign bytes, not an eligible diagnostic");
  let armed = true;
  const mod = load({ opendirSync(...args) {
    if (armed) { armed = false; fs.writeFileSync(itemPath(f, id, suffix), foreign, { flag: "wx", mode: 0o600 }); }
    return fs.opendirSync(...args);
  } }, accountingClock);
  const method = suffix === "artifact" ? "appendCompletedArtifact" : "appendCompletedRecord";
  const field = suffix === "artifact" ? "artifact" : "record";
  const result = reopen(t, f, mod)[method](id, Buffer.from("our bytes"));
  assert.equal(result[field], "unavailable"); assert.ok(result.warnings.includes("changed-item"));
  assert.deepEqual(fs.readFileSync(itemPath(f, id, suffix)), foreign);
  assert.deepEqual(fs.readdirSync(f.root), [`${id}.${suffix}`]);
});

test("byte inventory overshoot retires validated copies without touching an unscanned foreign file", linux, t => {
  const mod = load({}, accountingClock), f = fixture(t, mod);
  const first = f.store.append(metadata(), Buffer.alloc(api.GIT_DIAGNOSTIC_LIMITS.logBytes, 108));
  const template = fs.readFileSync(itemPath(f, first.id, "log")), end = template.indexOf(10);
  const header = JSON.parse(template.subarray(0, end)), payload = template.subarray(end + 1);
  for (let n = 1; n < 34; n++) {
    const id = randomUUID();
    fs.writeFileSync(itemPath(f, id, "log"), Buffer.concat([Buffer.from(JSON.stringify({ ...header, id }) + "\n"), payload]), { flag: "wx", mode: 0o600 });
  }
  const foreign = ".active-foreign-spool", foreignBytes = Buffer.from("never an eligible completed item");
  fs.writeFileSync(path.join(f.root, foreign), foreignBytes, { mode: 0o600 });
  // Deterministic directory order puts the foreign item beyond the byte-limited
  // prefix. No fake stat/content: every inventoried envelope is actually read.
  const ordered = load({ opendirSync(dirPath) {
    const names = fs.readdirSync(dirPath).filter(name => name !== foreign).concat(foreign);
    let index = 0;
    return { readSync: () => index < names.length ? { name: names[index++] } : null, closeSync() {} };
  } }, accountingClock);
  const limited = reopen(t, f, ordered).retain();
  assert.equal(limited.complete, false); assert.ok(limited.warnings.includes("scan-incomplete"));
  assert.ok(limited.removed.log > 0);
  assert.deepEqual(fs.readFileSync(path.join(f.root, foreign)), foreignBytes);
  // Fixture owner removes ONLY its own foreign spool to allow a full inventory.
  fs.unlinkSync(path.join(f.root, foreign)); f.store.close();
  const restarted = reopen(t, f, load({}, accountingClock));
  assert.equal(restarted.appendCompletedArtifact(randomUUID(), Buffer.from("finished")).artifact, "stored");
  assert.equal(restarted.retain().complete, true);
});

test("time-limited valid inventory leaves bounded retirement time instead of freezing forever", linux, t => {
  const f = fixture(t), original = f.store.append(metadata());
  f.store.append(metadata(2)); f.store.append(metadata(3));
  let clock = 0, reads = 0;
  const mod = load({ opendirSync(...args) {
    const dir = fs.opendirSync(...args);
    return { readSync() { reads++; const entry = dir.readSync(); clock = api.GIT_DIAGNOSTIC_LIMITS.passMs / 2; return entry; }, closeSync: () => dir.closeSync() };
  } }, { "node:perf_hooks": { performance: { now: () => clock } } });
  const result = reopen(t, f, mod).append(metadata(4));
  assert.equal(reads, 1); assert.equal(result.record, "omitted");
  assert.ok(result.warnings.includes("scan-incomplete"));
  assert.equal(fs.readdirSync(f.root).length, 2, "one validated item can retire before the overall deadline");
  assert.equal(reopen(t, f).append(metadata(5)).record, "stored");
  // No receipt/native fact was rewritten: this is only display-data expiry.
  assert.ok(["stored", "expired"].includes(f.store.readRecord(original.id).status));
});

test("failed category retirement cannot spend aggregate capacity on a different category", linux, t => {
  const f = fixture(t), records = [];
  for (let n = 0; n < 3; n++) records.push(f.store.append(metadata(n), Buffer.alloc(1000, 108)).id);
  const budgets = { recordBytes: 1800, logBytes: 1, artifactBytes: 1800 };
  const mod = load({ renameSync(from, to) { if (String(from).endsWith(".log")) throw errno("EACCES"); fs.renameSync(from, to); } }, accountingClock);
  const id = randomUUID(), result = reopen(t, f, mod, budgets).appendCompletedArtifact(id, Buffer.alloc(1000, 97));
  assert.equal(result.artifact, "omitted"); assert.ok(result.warnings.includes("budget-unavailable"));
  for (const record of records) assert.equal(f.store.readRecord(record).value.nativeOutcome, "succeeded");
  assert.equal(fs.readdirSync(f.root).length, 6);
  assert.equal(reopen(t, f, api, budgets).appendCompletedArtifact(id, Buffer.alloc(1000, 97)).artifact, "stored");
});

test("inventory size observation is bound to the read and cannot undercount a growing file", linux, t => {
  const f = fixture(t), id = randomUUID(), other = randomUUID();
  f.store.appendCompletedArtifact(id, Buffer.from("small"));
  f.store.appendCompletedArtifact(other, Buffer.alloc(1000, 108));
  const larger = fs.readFileSync(itemPath(f, other, "artifact"));
  const replacement = Buffer.from(larger.toString().replace(other, id));
  let armed = true, opens = 0;
  const mod = load({
    lstatSync(file, options) {
      const stat = fs.lstatSync(file, options);
      if (armed && String(file).endsWith(`${id}.artifact`)) { armed = false; fs.writeFileSync(file, replacement); }
      return stat;
    },
    openSync(file, ...args) { if (String(file).endsWith(`${id}.artifact`)) opens++; return fs.openSync(file, ...args); },
  }, accountingClock);
  const result = reopen(t, f, mod).retain();
  assert.equal(result.complete, false); assert.ok(result.warnings.includes("unsafe-item"));
  assert.equal(opens, 0, "changed size is rejected before payload I/O");
  assert.deepEqual(fs.readFileSync(itemPath(f, id, "artifact")), replacement);
});

test("stable application namespace reopens across invocations; completed actions share record budget", linux, t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pi-connected-retention-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const options = { application: true, budgets: { recordBytes: 1800 } };
  const first = api.openGitDiagnosticStore(parent, options);
  assert.equal(first.status, "stored");
  assert.equal(first.root, path.join(parent, "git-diagnostics-v2"));
  const id = randomUUID(), bytes = Buffer.from(JSON.stringify({ terminal: "fixture", padding: "x".repeat(900) }));
  assert.equal(first.store.appendCompletedRecord(id, bytes).record, "stored");
  const original = fs.readFileSync(path.join(first.root, `${id}.action`));
  assert.equal(first.store.appendCompletedRecord(id, Buffer.from("conflict")).record, "unavailable");
  assert.deepEqual(fs.readFileSync(path.join(first.root, `${id}.action`)), original);
  first.store.close();
  const second = api.openGitDiagnosticStore(parent, options);
  assert.equal(second.status, "stored");
  assert.deepEqual(second.store.readCompletedRecord(id).value, bytes);
  const next = randomUUID();
  assert.equal(second.store.appendCompletedRecord(next, bytes).record, "stored");
  assert.equal(second.store.readCompletedRecord(id).status, "expired");
  assert.equal(second.store.readCompletedRecord(next).status, "stored");
  assert.ok(second.store.retain().observedBytes.record <= 1800);
  second.store.close();
  assert.deepEqual(fs.readdirSync(parent), ["git-diagnostics-v2"]);
});

test("completed output handoff uses the same namespace and accepts no spool path", linux, t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pi-output-handoff-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const input = { ...metadata(), kind: "checkout-verification" };
  const result = api.appendFinalizedGitDiagnosticOutput(parent, input, Buffer.from("already finalized"));
  assert.equal(result.nativeOutcome, "succeeded"); assert.equal(result.log, "stored");
  const opened = api.openGitDiagnosticStore(parent, { application: true });
  assert.equal(opened.store.readCompletedLog(result.id).value.toString(), "already finalized");
  opened.store.close();
  const refused = api.appendFinalizedGitDiagnosticOutput(parent, input, "/not/a/spool-reader");
  assert.equal(refused.log, "omitted"); assert.equal(refused.diagnosticsUnavailable, true);
});

test("completed action link publication cannot overwrite racing ID and post-publication failure keeps known ID", linux, t => {
  let root, competing;
  const mod = load({ linkSync(from, to) {
    competing = Buffer.from("foreign concurrent bytes"); fs.writeFileSync(to, competing, { flag: "wx", mode: 0o600 });
    return fs.linkSync(from, to);
  } });
  const f = fixture(t, mod); root = f.root;
  const id = randomUUID();
  assert.equal(f.store.appendCompletedRecord(id, Buffer.from("completed fixture")).record, "unavailable");
  assert.deepEqual(fs.readFileSync(path.join(root, `${id}.action`)), competing);
  const known = randomUUID(); let published = false;
  const broken = load({ linkSync(from, to) { fs.linkSync(from, to); published = true; },
    fsyncSync(fd) { if (published && fs.fstatSync(fd).isDirectory()) throw errno("ENOSPC"); fs.fsyncSync(fd); } });
  const g = fixture(t, broken);
  assert.equal(g.store.appendCompletedRecord(known, Buffer.from("completed fixture")).record, "unavailable");
  assert.equal(g.store.readCompletedRecord(known).value.toString(), "completed fixture");
});

test("finalized artifacts have independent 64MiB target, bounded exact immutable bytes and expired reads", linux, t => {
  assert.equal(api.GIT_DIAGNOSTIC_LIMITS.artifactBudget, 64 * 1024 * 1024);
  const f = fixture(t, api, { artifactBytes: 1800 }), id = randomUUID(), bytes = Buffer.alloc(1000, 97);
  const metadataOnly = f.store.append(metadata(), Buffer.from("log"));
  assert.equal(f.store.appendCompletedArtifact(id, bytes).artifact, "stored"); bytes.fill(98);
  assert.equal(f.store.readCompletedArtifact(id).value.equals(Buffer.alloc(1000, 97)), true);
  const original = fs.readFileSync(itemPath(f, id, "artifact"));
  assert.equal(f.store.appendCompletedArtifact(id, Buffer.from("conflict")).artifact, "unavailable");
  assert.deepEqual(fs.readFileSync(itemPath(f, id, "artifact")), original);
  const next = randomUUID(); assert.equal(f.store.appendCompletedArtifact(next, bytes).artifact, "stored");
  assert.equal(f.store.readCompletedArtifact(id).status, "expired");
  assert.equal(f.store.readRecord(metadataOnly.id).status, "stored");
  assert.equal(f.store.readCompletedLog(metadataOnly.id).value.toString(), "log");
  assert.equal(reopen(t, f).readCompletedArtifact(next).value.equals(bytes), true);
  const retained = f.store.retain(); assert.ok(retained.observedBytes.artifact <= 1800);
});

test("artifact 2MiB payload bound, unsafe inputs and budget omission do not evict for no benefit", linux, t => {
  const f = fixture(t), id = randomUUID(), bytes = Buffer.alloc(api.GIT_DIAGNOSTIC_LIMITS.artifactBytes, 120);
  assert.equal(f.store.appendCompletedArtifact(id, bytes).artifact, "stored");
  assert.equal(f.store.readCompletedArtifact(id).value.length, bytes.length);
  for (const input of [Buffer.alloc(bytes.length + 1), Buffer.from(new SharedArrayBuffer(1)), "/active/spool", null]) {
    assert.deepEqual(f.store.appendCompletedArtifact(randomUUID(), input), { artifact: "omitted", warnings: ["invalid-input"] });
  }
  const tiny = reopen(t, f, api, { artifactBytes: 1 });
  assert.equal(tiny.appendCompletedArtifact(randomUUID(), Buffer.from("too large")).artifact, "omitted");
  assert.equal(f.store.readCompletedArtifact(id).status, "stored");
  assert.equal(api.openGitDiagnosticStore(f.parent, { application: true, budgets: { artifactBytes: api.GIT_DIAGNOSTIC_LIMITS.artifactBudget + 1 } }).status, "unavailable");
});

for (const kind of ["symlink", "hardlink", "public", "corrupt", "oversized", "foreign", "temp"]) test(`artifact inventory refuses ${kind}, preserves unknown data and omits optional writes`, linux, t => {
  const f = fixture(t), id = randomUUID();
  assert.equal(f.store.appendCompletedArtifact(id, Buffer.from("exact artifact")).artifact, "stored");
  const file = itemPath(f, id, "artifact"), original = fs.readFileSync(file), outside = path.join(f.parent, "foreign");
  fs.writeFileSync(outside, original, { mode: 0o600 });
  if (kind === "symlink" || kind === "hardlink") { fs.unlinkSync(file); fs[kind === "symlink" ? "symlinkSync" : "linkSync"](outside, file); }
  if (kind === "public") fs.chmodSync(file, 0o644);
  if (kind === "corrupt") fs.writeFileSync(file, Buffer.concat([original.subarray(0, original.length - 1), Buffer.from("!")]));
  if (kind === "oversized") fs.truncateSync(file, api.GIT_DIAGNOSTIC_LIMITS.artifactBytes + 1025);
  if (kind === "foreign" || kind === "temp") fs.writeFileSync(path.join(f.root, kind === "temp" ? ".not-owned.tmp" : "foreign"), "preserve", { mode: 0o600 });
  const before = fs.readdirSync(f.root).sort();
  assert.equal(f.store.appendCompletedArtifact(randomUUID(), Buffer.from("optional")).artifact, "omitted");
  assert.deepEqual(fs.readdirSync(f.root).sort(), before); assert.deepEqual(fs.readFileSync(outside), original);
  if (!["foreign", "temp"].includes(kind)) assert.equal(f.store.readCompletedArtifact(id).status, "unavailable");
});

for (const phase of ["write", "fsync", "post-link"]) test(`artifact ${phase} failure keeps known ID and never rolls back published/foreign data`, linux, t => {
  let linked = false;
  const mod = load({ writeSync(...args) { if (phase === "write") throw errno("ENOSPC"); return fs.writeSync(...args); },
    linkSync(...args) { fs.linkSync(...args); linked = true; },
    fsyncSync(fd) { if (phase === "fsync" && fs.fstatSync(fd).isFile() || phase === "post-link" && linked && fs.fstatSync(fd).isDirectory()) throw errno("EACCES"); return fs.fsyncSync(fd); } });
  const f = fixture(t, mod), id = randomUUID();
  assert.equal(f.store.appendCompletedArtifact(id, Buffer.from("final bytes")).artifact, "unavailable");
  if (phase === "post-link") {
    assert.equal(f.store.readCompletedArtifact(id).value.toString(), "final bytes");
    assert.equal(f.store.appendCompletedArtifact(id, Buffer.from("replacement")).artifact, "unavailable");
    assert.equal(f.store.readCompletedArtifact(id).value.toString(), "final bytes");
  } else {
    const before = fs.readdirSync(f.root).sort(); assert.ok(before.some(n => n.endsWith(".tmp")));
    assert.equal(f.store.appendCompletedArtifact(randomUUID(), Buffer.from("fresh")).artifact, "omitted");
    assert.deepEqual(fs.readdirSync(f.root).sort(), before);
  }
});

test("artifact no-replace publication refuses a racing foreign ID", linux, t => {
  const mod = load({ linkSync(from, to) { fs.writeFileSync(to, "foreign", { mode: 0o600, flag: "wx" }); return fs.linkSync(from, to); } });
  const f = fixture(t, mod), id = randomUUID();
  assert.equal(f.store.appendCompletedArtifact(id, Buffer.from("final bytes")).artifact, "unavailable");
  assert.equal(fs.readFileSync(itemPath(f, id, "artifact"), "utf8"), "foreign");
});

test("artifact rotation preserves a foreign replacement raced into its quarantine", linux, t => {
  let armed = false;
  const mod = load({ renameSync(from, to) {
    if (armed && String(from).endsWith(".artifact")) { armed = false; fs.unlinkSync(from); fs.writeFileSync(from, "foreign replacement", { mode: 0o600 }); }
    return fs.renameSync(from, to);
  } });
  const f = fixture(t, mod, { artifactBytes: 1500 }), id = randomUUID();
  assert.equal(f.store.appendCompletedArtifact(id, Buffer.alloc(1000)).artifact, "stored");
  armed = true;
  const result = f.store.appendCompletedArtifact(randomUUID(), Buffer.alloc(1000));
  assert.equal(result.artifact, "omitted"); assert.ok(result.warnings.includes("changed-item"));
  const retired = fs.readdirSync(f.root).find(n => n.startsWith(".retired-"));
  assert.ok(retired); assert.equal(fs.readFileSync(path.join(f.root, retired), "utf8"), "foreign replacement");
});

test("artifact reads/writes refuse replaced roots and incomplete inventories; existing-only read never bootstraps", linux, t => {
  const f = fixture(t), id = randomUUID();
  assert.equal(f.store.appendCompletedArtifact(id, Buffer.from("saved")).artifact, "stored");
  const old = f.root + "-retired"; fs.renameSync(f.root, old); fs.mkdirSync(f.root, { mode: 0o700 });
  fs.writeFileSync(path.join(f.root, "foreign"), "preserve", { mode: 0o600 });
  assert.equal(f.store.readCompletedArtifact(id).status, "unavailable");
  assert.equal(f.store.appendCompletedArtifact(randomUUID(), Buffer.from("new")).artifact, "unavailable");
  assert.equal(fs.readFileSync(path.join(f.root, "foreign"), "utf8"), "preserve");
  let clock = 0;
  const mod = load({}, { "node:perf_hooks": { performance: { now: () => clock += 1000 } } });
  const g = fixture(t, mod);
  const omitted = g.store.appendCompletedArtifact(randomUUID(), Buffer.from("omitted"));
  assert.equal(omitted.artifact, "omitted"); assert.ok(omitted.warnings.includes("scan-incomplete"));
  const before = fs.readdirSync(f.parent).sort();
  assert.equal(api.openGitDiagnosticStore(f.parent, { application: true, existingOnly: true }).status, "unavailable");
  assert.deepEqual(fs.readdirSync(f.parent).sort(), before);
});

test("fresh UUID namespace, private modes, exact closed terminal schema and completed copies", linux, t => {
  const f = fixture(t);
  assert.match(path.basename(f.root), /^git-diagnostics-v2-[a-f0-9-]{36}$/);
  const bytes = Buffer.from("final output\n"), result = f.store.append(metadata(), bytes);
  assert.equal(result.record, "stored"); assert.equal(result.log, "stored"); assert.deepEqual(result.warnings, []);
  bytes.fill(0);
  assert.deepEqual(f.store.readRecord(result.id).value, metadata());
  assert.equal(f.store.readCompletedLog(result.id).value.toString(), "final output\n");
  for (const p of [f.root, itemPath(f, result.id), itemPath(f, result.id, "log")]) assert.equal(fs.statSync(p).mode & 0o077, 0);
  assert.equal(reopen(t, f).readCompletedLog(result.id).status, "stored");
});

test("terminal metadata excludes secrets, callbacks, receipts, authority and in-progress states", linux, t => {
  const f = fixture(t);
  for (const key of ["provider", "run", "receipt", "token", "password", "path", "command", "approval", "reason"]) {
    const r = f.store.append({ ...metadata(), [key]: "secret" });
    assert.equal(r.record, "omitted"); assert.deepEqual(r.warnings, ["invalid-input"]);
  }
  for (const patch of [{ nativeOutcome: "executing" }, { completedAt: -1 }, { durationMs: Infinity }, { exitCode: 256 }, { kind: "secret" }]) {
    assert.equal(f.store.append({ ...metadata(), ...patch }).record, "omitted");
  }
  let accessed = false;
  const getter = { ...metadata(), get kind() { accessed = true; throw Error("not data"); } };
  assert.equal(f.store.append(getter).record, "omitted"); assert.equal(accessed, false);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test("native outcomes remain separate from diagnostic omission", linux, t => {
  const f = fixture(t, api, { recordBytes: 0, logBytes: 0 });
  for (const nativeOutcome of ["succeeded", "rejected", "failed", "cancelled", "partial", "uncertain"]) {
    const r = f.store.append({ ...metadata(), nativeOutcome }, Buffer.from("output"));
    assert.equal(r.nativeOutcome, nativeOutcome); assert.equal(r.record, "omitted"); assert.equal(r.log, "omitted");
    assert.ok(r.warnings.includes("budget-unavailable"));
  }
});

test("per-item output bound, shared memory and source paths refused before copying", linux, t => {
  const f = fixture(t);
  for (const output of [Buffer.alloc(api.GIT_DIAGNOSTIC_LIMITS.logBytes + 1), Buffer.from(new SharedArrayBuffer(2)), "/private/credentials"]) {
    const r = f.store.append(metadata(), output);
    assert.equal(r.record, "stored"); assert.equal(r.log, "omitted"); assert.ok(r.warnings.includes("invalid-input"));
  }
  const maximum = f.store.append(metadata(), Buffer.alloc(api.GIT_DIAGNOSTIC_LIMITS.logBytes));
  assert.equal(maximum.log, "stored");
  assert.equal(f.store.readCompletedLog(maximum.id).value.length, api.GIT_DIAGNOSTIC_LIMITS.logBytes);
});

test("best-effort independent record/log targets evict oldest completed items; reads expire", linux, t => {
  const f = fixture(t);
  const a = f.store.append(metadata(1), Buffer.alloc(100));
  const b = f.store.append(metadata(2), Buffer.alloc(100));
  const recordSize = fs.statSync(itemPath(f, a.id)).size, logSize = fs.statSync(itemPath(f, a.id, "log")).size;
  const small = reopen(t, f, api, { recordBytes: recordSize, logBytes: logSize });
  const r = small.retain();
  assert.deepEqual(r.removed, { record: 1, log: 1, artifact: 0 }); assert.equal(r.complete, true);
  assert.equal(small.readRecord(a.id).status, "expired"); assert.equal(small.readCompletedLog(a.id).status, "expired");
  assert.equal(small.readRecord(b.id).status, "stored");
  assert.ok(r.observedBytes.record <= recordSize); assert.ok(r.observedBytes.log <= logSize);
});

test("reservation omits too-large new item without evicting old data for it", linux, t => {
  const f = fixture(t);
  const r = f.store.append(metadata(), Buffer.from("small"));
  const size = fs.statSync(itemPath(f, r.id, "log")).size;
  const small = reopen(t, f, api, { logBytes: size });
  assert.equal(small.append(metadata(), Buffer.alloc(1000)).log, "omitted");
  assert.equal(small.readCompletedLog(r.id).status, "stored");
});

for (const code of ["ENOSPC", "EACCES"]) test(`${code} writing is optional, sanitized and cannot falsify native success`, linux, t => {
  let inject = false;
  const mod = load({ writeSync(...args) { if (inject) throw errno(code); return fs.writeSync(...args); } });
  const f = fixture(t, mod); inject = true;
  const r = f.store.append(metadata(), Buffer.from("output"));
  assert.equal(r.nativeOutcome, "succeeded"); assert.equal(r.record, "unavailable"); assert.equal(r.log, "unavailable");
  assert.deepEqual(r.warnings, ["storage-unavailable"]);
  const temps = fs.readdirSync(f.root); assert.equal(temps.length, 2); assert.ok(temps.every(n => n.endsWith(".tmp")));
  inject = false; f.store.retain(); assert.deepEqual(fs.readdirSync(f.root), temps, "no stale staging sweep");
  assert.equal(f.store.append(metadata()).record, "omitted", "unknown orphan capacity is not free space");
  assert.deepEqual(fs.readdirSync(f.root), temps, "repeated faults cannot accumulate unaccounted staging files");
});

test("failed deletion reports warning and omits rather than enforcing a quota with a lock", linux, t => {
  const f = fixture(t);
  const r = f.store.append(metadata());
  const mod = load({ unlinkSync() { throw errno("EACCES"); } });
  const small = reopen(t, f, mod, { recordBytes: fs.statSync(itemPath(f, r.id)).size });
  const result = small.append(metadata(2));
  assert.equal(result.record, "omitted"); assert.equal(result.nativeOutcome, "succeeded");
  assert.ok(result.warnings.includes("changed-item")); assert.ok(result.warnings.includes("budget-unavailable"));
  assert.ok(fs.readdirSync(f.root).some(n => n.startsWith(".retired-")), "failed cleanup preserves quarantined bytes");
});

test("fsync failure does not claim stored and never changes native outcome", linux, t => {
  let fail = false;
  const f = fixture(t, load({ fsyncSync(fd) { if (fail) throw errno("ENOSPC"); fs.fsyncSync(fd); } }));
  fail = true;
  const r = f.store.append(metadata()); assert.equal(r.record, "unavailable"); assert.equal(r.nativeOutcome, "succeeded");
});

test("lost directory fsync acknowledgement preserves installed diagnostic and native success", linux, t => {
  let fail = false;
  const f = fixture(t, load({ fsyncSync(fd) {
    if (fail && fs.fstatSync(fd).isDirectory()) throw errno("EACCES");
    fs.fsyncSync(fd);
  } }));
  fail = true;
  const r = f.store.append(metadata());
  assert.equal(r.record, "unavailable"); assert.equal(r.nativeOutcome, "succeeded");
  assert.equal(f.store.readRecord(r.id).status, "stored", "uncertain optional durability is not rolled back or retried");
});

test("unknown names, active spools, staging files, legacy ledger and Git locks untouched", linux, t => {
  const f = fixture(t);
  const names = ["record.json", "candidate.json", "index.lock", "active-spool", ".own.tmp", "not-a-uuid.log", `${randomUUID()}.artifact`];
  for (const name of names) fs.writeFileSync(path.join(f.root, name), "do not delete", { mode: 0o600 });
  for (const name of ["git-actions", "git-verification-logs", "project", ".git", "worktree"]) fs.mkdirSync(path.join(f.parent, name), { mode: 0o700 });
  const small = reopen(t, f, api, { recordBytes: 0, logBytes: 0 });
  const r = small.retain(); assert.ok(r.warnings.includes("unknown-name")); assert.deepEqual(r.removed, { record: 0, log: 0, artifact: 0 });
  for (const name of names) assert.equal(fs.readFileSync(path.join(f.root, name), "utf8"), "do not delete");
  assert.equal(api.openGitDiagnosticStore(path.join(f.parent, "git-actions")).status, "unavailable");
});

test("traversal, malformed UUID, arbitrary root and symlink ancestors refused", linux, t => {
  const f = fixture(t);
  for (const id of ["../credentials", `${randomUUID()}/../x`, "x".repeat(5000), randomUUID().toUpperCase(), ""]) {
    assert.equal(f.store.readCompletedLog(id).status, "unavailable");
  }
  for (const p of [f.parent, `${f.root}/..`, `${f.root}//`, "relative", `${f.root}/.`]) assert.equal(api.openGitDiagnosticStore(p).status, "unavailable");
  const link = path.join(f.parent, "alias"); fs.symlinkSync(f.root, link);
  assert.equal(api.openGitDiagnosticStore(link).status, "unavailable");
  const parentLink = path.join(f.parent, "parent-link"); fs.symlinkSync(f.parent, parentLink);
  assert.equal(api.openGitDiagnosticStore(path.join(parentLink, path.basename(f.root))).status, "unavailable");
});

for (const variant of ["symlink", "hardlink", "public", "directory", "invalid", "oversized", "digest"]) test(`unsafe ${variant} is neither exposed nor pruned`, linux, t => {
  const f = fixture(t), r = f.store.append(metadata(), Buffer.from("output"));
  const file = itemPath(f, r.id, "log"), victim = path.join(f.parent, "private-credential-fixture");
  fs.writeFileSync(victim, "fixture secret", { mode: 0o600 });
  if (variant === "symlink") { fs.unlinkSync(file); fs.symlinkSync(victim, file); }
  if (variant === "hardlink") { fs.unlinkSync(file); fs.linkSync(victim, file); }
  if (variant === "public") fs.chmodSync(file, 0o644);
  if (variant === "directory") { fs.unlinkSync(file); fs.mkdirSync(file, { mode: 0o700 }); }
  if (variant === "invalid") fs.writeFileSync(file, "{ invalid JSON");
  if (variant === "oversized") fs.truncateSync(file, api.GIT_DIAGNOSTIC_LIMITS.logBytes + 1025);
  if (variant === "digest") { const bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes); }
  assert.equal(f.store.readCompletedLog(r.id).status, "unavailable");
  const retention = reopen(t, f, api, { logBytes: 0 }).retain();
  assert.ok(retention.warnings.includes("unsafe-item")); assert.equal(retention.removed.log, 0);
  assert.ok(fs.lstatSync(file)); assert.equal(fs.readFileSync(victim, "utf8"), "fixture secret");
});

test("invalid terminal record cannot become eligible by a valid filename", linux, t => {
  const f = fixture(t), r = f.store.append(metadata());
  const file = itemPath(f, r.id), value = JSON.parse(fs.readFileSync(file));
  value.terminal.nativeOutcome = "executing"; fs.writeFileSync(file, JSON.stringify(value));
  assert.equal(f.store.readRecord(r.id).status, "unavailable");
  const retained = reopen(t, f, api, { recordBytes: 0 }).retain();
  assert.equal(retained.removed.record, 0); assert.ok(fs.existsSync(file));
});

test("root replacement and symlink retarget invalidate original directory pins", linux, t => {
  const f = fixture(t), r = f.store.append(metadata());
  const replacement = path.join(f.parent, "replacement"); fs.mkdirSync(replacement, { mode: 0o700 });
  const moved = `${f.root}.original`; fs.renameSync(f.root, moved); fs.symlinkSync(replacement, f.root);
  fs.writeFileSync(path.join(replacement, `${r.id}.record`), "foreign", { mode: 0o600 });
  assert.equal(f.store.readRecord(r.id).status, "unavailable"); assert.equal(f.store.retain().complete, false);
  assert.equal(f.store.append(metadata()).record, "unavailable");
  assert.equal(fs.readFileSync(path.join(replacement, `${r.id}.record`), "utf8"), "foreign");
  assert.ok(fs.existsSync(path.join(moved, `${r.id}.record`)));
});

for (const variant of ["file", "symlink"]) test(`foreign ${variant} winning quarantine rename race is not unlinked`, linux, t => {
  const f = fixture(t), r = f.store.append(metadata());
  const original = itemPath(f, r.id), victim = path.join(f.parent, "credential-fixture");
  fs.writeFileSync(victim, "secret fixture", { mode: 0o600 });
  let injected = false, unlinks = 0;
  const mod = load({
    renameSync(from, to) {
      if (String(to).includes(".retired-") && !injected) {
        injected = true; fs.renameSync(original, path.join(f.root, ".preserved-original"));
        if (variant === "file") fs.writeFileSync(original, "foreign", { mode: 0o600 });
        else fs.symlinkSync(victim, original);
      }
      return fs.renameSync(from, to);
    },
    unlinkSync(...args) { unlinks++; return fs.unlinkSync(...args); },
  });
  const retention = reopen(t, f, mod, { recordBytes: 0 }).retain();
  assert.equal(injected, true); assert.equal(unlinks, 0); assert.equal(retention.removed.record, 0);
  assert.ok(retention.warnings.includes("changed-item"));
  assert.equal(fs.readFileSync(victim, "utf8"), "secret fixture");
  const name = fs.readdirSync(f.root).find(n => n.startsWith(".retired-")); assert.ok(name);
  if (variant === "file") assert.equal(fs.readFileSync(path.join(f.root, name), "utf8"), "foreign");
  else assert.ok(fs.lstatSync(path.join(f.root, name)).isSymbolicLink());
});

test("replaced staging inode is not deleted or reported stored", linux, t => {
  let active = false;
  const f = fixture(t, load({ renameSync(from, to) {
    if (active && String(from).endsWith(".tmp")) {
      fs.renameSync(from, `${from}.preserved`); fs.writeFileSync(from, "foreign", { mode: 0o600 });
    }
    fs.renameSync(from, to);
  } }));
  active = true;
  const r = f.store.append(metadata()); assert.equal(r.record, "unavailable");
  assert.equal(fs.readFileSync(itemPath(f, r.id), "utf8"), "foreign");
});

test("bounded directory iteration and warning cardinality omit on incomplete scan", linux, t => {
  let reads = 0;
  const mod = load({ opendirSync() { return { readSync() { reads++; return { name: `unknown-${reads}` }; }, closeSync() {} }; } },
    { "node:perf_hooks": { performance: { now: () => 0 } } });
  const f = fixture(t, mod), r = f.store.append(metadata());
  assert.equal(reads, api.GIT_DIAGNOSTIC_LIMITS.entries); assert.equal(r.record, "omitted");
  assert.ok(r.warnings.includes("scan-incomplete")); assert.ok(r.warnings.length <= api.GIT_DIAGNOSTIC_LIMITS.warnings);
});

test("monotonic pass deadline stops further work without sleeping or retry", linux, t => {
  let clock = 0, reads = 0;
  const mod = load({ opendirSync() { return { readSync() { reads++; return { name: "unknown" }; }, closeSync() {} }; } },
    { "node:perf_hooks": { performance: { now: () => (clock += 100) } } });
  const f = fixture(t, mod), r = f.store.append(metadata());
  assert.equal(r.record, "omitted"); assert.ok(reads <= 2); assert.ok(r.warnings.includes("scan-incomplete"));
});

test("scan byte cap is enforced even when individual candidate reads fail", linux, t => {
  const f = fixture(t), r = f.store.append(metadata(), Buffer.from("output"));
  const actual = fs.lstatSync(itemPath(f, r.id, "log"), { bigint: true });
  let reads = 0;
  const mod = load({
    opendirSync() { return { readSync() { reads++; return { name: `${randomUUID()}.log` }; }, closeSync() {} }; },
    lstatSync(p, options) { if (String(p).endsWith(".log")) return Object.assign(Object.create(Object.getPrototypeOf(actual)), actual, { size: BigInt(api.GIT_DIAGNOSTIC_LIMITS.logBytes) }); return fs.lstatSync(p, options); },
  }, { "node:perf_hooks": { performance: { now: () => 0 } } });
  const result = reopen(t, f, mod).retain();
  assert.equal(result.complete, false);
  assert.equal(reads, Math.floor(api.GIT_DIAGNOSTIC_LIMITS.scanBytes / (api.GIT_DIAGNOSTIC_LIMITS.logBytes + 1)) + 1);
  assert.ok(result.warnings.includes("scan-incomplete"));
});

test("restored removed diagnostics stay inert display data across reopen", linux, t => {
  const f = fixture(t), r = f.store.append(metadata(), Buffer.from("captured, not today's checkout"));
  const record = fs.readFileSync(itemPath(f, r.id)), log = fs.readFileSync(itemPath(f, r.id, "log"));
  const small = reopen(t, f, api, { recordBytes: 0, logBytes: 0 }); small.retain();
  assert.equal(small.readCompletedLog(r.id).status, "expired");
  fs.writeFileSync(itemPath(f, r.id), record, { mode: 0o600 }); fs.writeFileSync(itemPath(f, r.id, "log"), log, { mode: 0o600 });
  const restored = reopen(t, f);
  assert.equal(restored.readCompletedLog(r.id).value.toString(), "captured, not today's checkout");
  assert.deepEqual(Object.keys(restored).sort(), ["append", "appendCompletedArtifact", "appendCompletedRecord", "close", "readCompletedArtifact", "readCompletedLog", "readCompletedRecord", "readRecord", "retain"]);
  const source = fs.readFileSync(new URL("./git-diagnostic-retention.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map(m => m[1]);
  assert.ok(imports.every(i => i.startsWith("node:")), "no authority/receipt/ledger dependency or hook");
  assert.deepEqual(Object.keys(api).sort(), ["GIT_DIAGNOSTIC_LIMITS", "appendFinalizedGitDiagnosticOutput", "openGitDiagnosticStore"]);
});

test("copied record from another UUID root is unavailable and ineligible", linux, t => {
  const a = fixture(t), b = fixture(t), r = a.store.append(metadata());
  fs.copyFileSync(itemPath(a, r.id), itemPath(b, r.id));
  assert.equal(b.store.readRecord(r.id).status, "unavailable");
  assert.equal(reopen(t, b, api, { recordBytes: 0 }).retain().removed.record, 0);
});

test("explicitly reopened configured namespace shares budgets across module restarts", linux, t => {
  const f = fixture(t), first = f.store.append(metadata());
  const size = fs.statSync(itemPath(f, first.id)).size;
  f.store.close();
  const restarted = reopen(t, f, load(), { recordBytes: size });
  const second = restarted.append(metadata(2));
  assert.equal(second.record, "stored"); assert.equal(restarted.readRecord(first.id).status, "expired");
  assert.equal(fs.readdirSync(f.parent).length, 1, "restart reuses the one configured root");
  assert.equal(fs.readdirSync(f.root).length, 1);
});

test("racing independent writers can honestly overshoot the target; later pass reclaims", linux, t => {
  const f = fixture(t), initial = f.store.append(metadata());
  const size = fs.statSync(itemPath(f, initial.id)).size;
  reopen(t, f, api, { recordBytes: 0 }).retain();
  const second = reopen(t, f, api, { recordBytes: size });
  let raced, armed = true;
  const mod = load({ openSync(file, ...args) {
    if (armed && String(file).endsWith(".tmp")) {
      armed = false;
      raced = second.append(metadata(2)); // after first inventory, before its write
    }
    return fs.openSync(file, ...args);
  } });
  const first = reopen(t, f, mod, { recordBytes: size });
  const result = first.append(metadata());
  assert.equal(result.record, "stored"); assert.equal(raced.record, "stored");
  assert.equal(fs.readdirSync(f.root).length, 2, "target is not a serialized quota");
  const retained = first.retain(); assert.equal(retained.removed.record, 1); assert.ok(retained.observedBytes.record <= size);
});

test("invalid bootstrap budgets create no orphan namespaces", linux, t => {
  const f = fixture(t), before = fs.readdirSync(f.parent);
  for (const recordBytes of [-1, Infinity, api.GIT_DIAGNOSTIC_LIMITS.recordBudget + 1]) {
    assert.equal(api.openGitDiagnosticStore(f.parent, { create: true, budgets: { recordBytes } }).status, "unavailable");
  }
  assert.deepEqual(fs.readdirSync(f.parent), before);
});

test("closed store returns warnings without throwing into callers", linux, t => {
  const f = fixture(t); f.store.close(); f.store.close();
  assert.equal(f.store.append(metadata()).record, "unavailable"); assert.equal(f.store.retain().complete, false);
  assert.equal(f.store.readRecord(randomUUID()).status, "unavailable");
});

test("concurrent application bootstraps/writers share one stable root without a namespace lock", linux, async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stable-concurrent-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const modulePath = fileURLToPath(new URL("./git-diagnostic-retention.ts", import.meta.url));
  const script = `import {openGitDiagnosticStore} from ${JSON.stringify(modulePath)};
    import {randomUUID} from 'node:crypto';
    const opened=openGitDiagnosticStore(${JSON.stringify(parent)},{application:true});
    if(opened.status!=='stored') throw Error('fixture bootstrap');
    const results=Array.from({length:8},()=>{const id=randomUUID();return {id,...opened.store.appendCompletedRecord(id,Buffer.from('completed fixture')),artifact:opened.store.appendCompletedArtifact(id,Buffer.from('exact finalized artifact')).artifact}});
    opened.store.close();console.log(JSON.stringify(results));`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.on("data", b => { out += b; }); child.stderr.on("data", b => { err += b; });
    child.on("error", reject); child.on("exit", code => code ? reject(Error(err)) : resolve(JSON.parse(out)));
  });
  const results = (await Promise.all(Array.from({ length: 4 }, run))).flat();
  assert.equal(new Set(results.map(r => r.id)).size, 32);
  assert.deepEqual(fs.readdirSync(parent), ["git-diagnostics-v2"]);
  const reopened = api.openGitDiagnosticStore(parent, { application: true });
  let stored = 0;
  for (const r of results) {
    assert.ok(["stored", "omitted"].includes(r.record));
    if (r.record === "stored") { stored++; assert.equal(reopened.store.readCompletedRecord(r.id).value.toString(), "completed fixture"); }
    assert.ok(["stored", "omitted"].includes(r.artifact));
    if (r.artifact === "stored") assert.equal(reopened.store.readCompletedArtifact(r.id).value.toString(), "exact finalized artifact");
  }
  assert.ok(stored > 0); reopened.store.close();
});

test("independent concurrent processes publish unique complete immutable files without queues", linux, async t => {
  const f = fixture(t);
  const modulePath = fileURLToPath(new URL("./git-diagnostic-retention.ts", import.meta.url));
  const script = `import { openGitDiagnosticStore } from ${JSON.stringify(modulePath)};
    const s = openGitDiagnosticStore(${JSON.stringify(f.root)}).store;
    const results = Array.from({length:8}, (_,n) => s.append(${JSON.stringify(metadata())}, Buffer.from('final')));
    s.close(); console.log(JSON.stringify(results));`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.on("data", b => { out += b; }); child.stderr.on("data", b => { err += b; });
    child.on("error", reject); child.on("exit", code => code ? reject(Error(err)) : resolve(JSON.parse(out)));
  });
  const results = (await Promise.all(Array.from({ length: 4 }, run))).flat();
  assert.equal(results.length, 32); assert.equal(new Set(results.map(r => r.id)).size, 32);
  let stored = 0;
  for (const r of results) {
    assert.equal(r.nativeOutcome, "succeeded");
    // Seeing another process's active temp can conservatively omit diagnostics,
    // never block/retry or affect native outcome. Stored envelopes stay complete.
    assert.ok(["stored", "omitted"].includes(r.record)); assert.ok(["stored", "omitted"].includes(r.log));
    if (r.record === "stored") { stored++; assert.equal(f.store.readRecord(r.id).status, "stored"); }
    if (r.log === "stored") { stored++; assert.equal(f.store.readCompletedLog(r.id).value.toString(), "final"); }
  }
  assert.ok(stored > 0); assert.equal(fs.readdirSync(f.root).length, stored);
});
