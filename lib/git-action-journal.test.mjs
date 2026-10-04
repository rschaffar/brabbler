import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { canonical, hash, document, writeLegacyGitActionFixture } from "./git-action-legacy-fixture.mjs";
const jiti = createJiti(import.meta.url);
const journal = await jiti.import("./git-action-journal.ts");
const retention = await jiti.import("./git-diagnostic-retention.ts");
const { createGitAction, transitionGitAction, releaseGitAction, readGitAction, readLiveGitAction, captureGitActionRecord,
  advanceGitActionRecord, persistCompletedGitAction, subscribeGitActionUpdates, emitGitActionAnchor, GIT_ACTION_LIMITS: limits } = journal;
const parentOid = "a".repeat(40), treeOid = "b".repeat(40), commitOid = "c".repeat(40);
const result = { commit: commitOid, tree: treeOid, parents: [parentOid], authorEmail: "fixture@example.invalid" };
function fixture(t) {
  const agentDir = fs.mkdtempSync(join(tmpdir(), "pi-journal-v2-")), ids = [];
  t.after(() => { for (const id of ids) releaseGitAction(id, agentDir); fs.rmSync(agentDir, { recursive: true, force: true }); });
  const snapshot = (extra = {}) => ({ kind: "commit", repositoryRoot: "/fixture/repo", featureBranch: "feature",
    message: "Exact message", paths: ["a"], parentOid, candidateTreeOid: treeOid,
    diff: { fromTreeOid: parentOid, toTreeOid: treeOid, patch: "--- a/a\n+++ b/a\n+exact\n", hasBinaryChanges: false }, ...extra });
  const review = (extra = {}) => ({ kind: "review", repositoryRoot: "/fixture/repo", featureBranch: "feature", targetBranch: "main",
    featureOid: commitOid, targetOid: parentOid, selection: { kind: "merge" }, diff: snapshot().diff, ...extra });
  return { agentDir, ids, snapshot, review,
    async create(c = snapshot(), source = "human", sessionId = "origin") {
      const r = await createGitAction({ sessionId, source, candidate: c }, agentDir); ids.push(r.id); return r;
    },
    step: (r, patch) => transitionGitAction(r.id, r.revision, patch, agentDir),
    read: (id, includeArtifact = true) => readGitAction(id, { includeArtifact }, agentDir),
    legacy(c = snapshot(), patch = {}) {
      const captured = captureGitActionRecord({ sessionId: "origin", source: "human", candidate: c });
      const record = { ...captured.record, ...patch };
      return { record, candidate: captured.candidate, ...writeLegacyGitActionFixture(agentDir, record, captured.candidate), value: record };
    },
  };
}
async function complete(f, c) {
  const a = await f.create(c), b = await f.step(a, { state: "executing", decision: "approved", intended: result });
  return f.step(b, { state: "succeeded", outcome: result });
}
function fault(t, method, replacement) {
  const original = fs[method], mocked = t.mock.method(fs, method, (...args) => replacement(original, ...args));
  syncBuiltinESMExports(); t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}

test("new low-level APIs are in-memory diagnostics, never unbounded v1 writers", async t => {
  const f = fixture(t), input = f.snapshot(), original = structuredClone(input), a = await f.create(input);
  input.message = "mutated"; a.summary.paths.push("mutated");
  assert.equal((await f.read(a.id)).record.summary.message, original.message);
  assert.deepEqual((await f.read(a.id)).candidate, original);
  assert.equal(fs.existsSync(join(f.agentDir, "pi-web")), false);
  assert.deepEqual(fs.readdirSync(join(f.agentDir, "git-diagnostics-v2")), []);
  const copy = await f.read(a.id); copy.candidate.diff.patch = "changed";
  assert.equal((await f.read(a.id)).candidate.diff.patch, original.diff.patch);
});

test("completed record AND exact artifact are retained across release/restart with no checkout reads", async t => {
  const f = fixture(t), c = f.snapshot({ commitMode: "staged" }), a = await complete(f, c);
  assert.equal(a.diagnostics, undefined);
  releaseGitAction(a.id, f.agentDir);
  const restored = await f.read(a.id);
  assert.deepEqual(restored.record, a); assert.deepEqual(restored.candidate, c);
  assert.equal(restored.unavailable, undefined);
  const names = fs.readdirSync(join(f.agentDir, "git-diagnostics-v2")).sort();
  assert.deepEqual(names, [`${a.id}.action`, `${a.id}.artifact`]);
  const script = `const {createJiti}=require('jiti'); (async()=>{const j=await createJiti(process.cwd()+'/fixture.cjs').import('./lib/git-action-journal.ts');const h=await j.readGitAction(${JSON.stringify(a.id)},{includeArtifact:true},${JSON.stringify(f.agentDir)});console.log(JSON.stringify(h));})()`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" })), restored);
  await assert.rejects(f.step(a, { state: "executing" }), /read-only/);
  assert.equal(readLiveGitAction("origin", a.id, { includeArtifact: true }, f.agentDir), undefined);
});

test("metadata reads are lazy; expired artifacts preserve terminal facts and never reconstruct", async t => {
  const f = fixture(t), a = await complete(f); releaseGitAction(a.id, f.agentDir);
  const store = retention.openGitDiagnosticStore(f.agentDir, { application: true, budgets: { artifactBytes: 0 } }).store;
  assert.equal(store.retain().removed.artifact, 1); store.close();
  const metadata = await f.read(a.id, false);
  assert.equal(metadata.record.state, "succeeded"); assert.equal(metadata.unavailable, undefined);
  const full = await f.read(a.id);
  assert.equal(full.record.outcome.commit, commitOid); assert.equal(full.candidate, undefined); assert.match(full.unavailable, /expired/);
});

test("artifact restore is inert and binding mismatch is refused even with a valid storage digest", async t => {
  const f = fixture(t), a = await complete(f); releaseGitAction(a.id, f.agentDir);
  const root = join(f.agentDir, "git-diagnostics-v2"), file = join(root, `${a.id}.artifact`), bytes = fs.readFileSync(file);
  const store = retention.openGitDiagnosticStore(f.agentDir, { application: true, budgets: { artifactBytes: 0 } }).store;
  store.retain(); store.close();
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
  assert.equal((await f.read(a.id)).candidate.message, "Exact message");
  await assert.rejects(f.step(a, { state: "executing" }), /read-only/);
  const other = await complete(f, f.snapshot({ message: "other" })); releaseGitAction(other.id, f.agentDir);
  // Fixture-only replacement of a complete envelope, including outer ID/digest.
  const b = fs.readFileSync(join(root, `${other.id}.artifact`)), end = b.indexOf(10), header = JSON.parse(b.subarray(0, end));
  header.id = a.id;
  fs.writeFileSync(file, Buffer.concat([Buffer.from(JSON.stringify(header) + "\n"), b.subarray(end + 1)]));
  assert.equal((await f.read(a.id, false)).record.state, "succeeded");
  assert.match((await f.read(a.id)).unavailable, /invalid/);
});

test("active exact candidates survive zero retention budgets and broken optional storage", async t => {
  const f = fixture(t), a = await f.create();
  const store = retention.openGitDiagnosticStore(f.agentDir, { application: true, budgets: { recordBytes: 0, logBytes: 0, artifactBytes: 0 } }).store;
  assert.deepEqual(store.retain().removed, { record: 0, log: 0, artifact: 0 }); store.close();
  fs.writeFileSync(join(f.agentDir, "git-diagnostics-v2", "foreign"), "unknown");
  const b = await f.step(a, { state: "awaiting-decision" });
  assert.deepEqual(readLiveGitAction("origin", a.id, { includeArtifact: true }, f.agentDir).candidate, f.snapshot());
  assert.equal(readLiveGitAction("other", a.id, { includeArtifact: true }, f.agentDir), undefined);
  const c = await f.step(b, { state: "executing" }), d = await f.step(c, { state: "succeeded", outcome: result });
  assert.equal(d.state, "succeeded"); assert.equal(d.diagnostics.reason, "retention-limited");
  assert.equal((await f.read(a.id)).candidate.diff.patch, f.snapshot().diff.patch);
  releaseGitAction(a.id, f.agentDir);
  assert.equal(readLiveGitAction("origin", a.id, { includeArtifact: true }, f.agentDir), undefined);
});

test("legacy malformed/oversized data neither gates fresh invocations nor gets migrated/pruned", async t => {
  const f = fixture(t), old = f.legacy(); fs.writeFileSync(old.record, "x".repeat(limits.recordBytes + 1));
  const before = fs.readFileSync(old.record), a = await complete(f);
  assert.equal(a.state, "succeeded");
  assert.deepEqual(fs.readFileSync(old.record), before);
  assert.deepEqual(fs.readdirSync(join(f.agentDir, "pi-web", "git-actions", "v1")), [old.value.id]);
  assert.equal((await f.read(old.value.id)).record, null);
});

test("strict input allowlists reject capabilities and accessors BEFORE optional storage", async t => {
  const f = fixture(t), c = f.snapshot();
  for (const field of ["plan", "planId", "reviewToken", "receiptIds", "verificationIds", "jobs", "credentials", "token", "approved"]) {
    for (const v of [{ ...c, [field]: true }, { ...c, diff: { ...c.diff, [field]: true } },
      { ...c, checks: [{ label: "Check", argv: ["true"], [field]: true }] }, { ...c, selection: { kind: "merge", [field]: true } }]) await assert.rejects(f.create(v), /Invalid/);
    await assert.rejects(createGitAction({ sessionId: "origin", source: "human", candidate: c, [field]: undefined }, f.agentDir), /Invalid/);
  }
  let accessed = false; const accessor = { ...c, get message() { accessed = true; throw Error("getter"); } };
  await assert.rejects(f.create(accessor), /Invalid/); assert.equal(accessed, false);
  assert.deepEqual(fs.readdirSync(f.agentDir), []);
  const a = await f.create();
  for (const field of ["plan", "token", "jobs", "approved"]) {
    await assert.rejects(f.step(a, { state: "executing", [field]: true }), /Invalid/);
    await assert.rejects(f.step(a, { state: "executing", intended: { ...result, [field]: true } }), /Invalid/);
    await assert.rejects(f.step(a, { state: "executing", outcome: { ...result, [field]: true } }), /Invalid/);
  }
});

test("invalid candidate/outcome shapes, bounds and revisions still reject", async t => {
  const f = fixture(t), c = f.snapshot();
  for (const value of [null, [], { ...c, kind: "push" }, { ...c, repositoryRoot: "relative" }, { ...c, parentOid: "short" },
    { ...c, diff: { ...c.diff, hasBinaryChanges: "false" } }, { ...c, diffUnavailable: "not missing" },
    { ...c, selection: { kind: "commits", commitOids: [] } }, { ...c, checks: [{ label: "Check", argv: [] }] }, { ...c, paths: new Array(2) }, { ...c, message: "\0" }]) await assert.rejects(f.create(value), /Invalid/);
  for (const extra of [{ diff: { ...c.diff, patch: "x".repeat(limits.patchBytes + 1) } }, { diff: { ...c.diff, patch: "é".repeat(limits.patchBytes / 2 + 1) } },
    { paths: Array(limits.paths + 1).fill("a") }, { paths: ["x".repeat(limits.pathBytes + 1)] }, { message: "x".repeat(limits.messageBytes + 1) },
    { checks: Array(limits.checks + 1).fill({ label: "c", argv: ["true"] }) }, { checks: [{ label: "c", argv: Array(limits.checkArgs + 1).fill("a") }] },
    { selection: { kind: "commits", commitOids: Array(limits.commitOids + 1).fill(parentOid) } }, { paths: Array(limits.paths).fill("x".repeat(200)) },
    { diff: { ...c.diff, patch: "\u0001".repeat(limits.patchBytes) } }]) await assert.rejects(f.create({ ...c, ...extra }), /Invalid/);
  assert.deepEqual(fs.readdirSync(f.agentDir), []);
  const a = await f.create({ ...c, diff: { ...c.diff, patch: "x".repeat(limits.patchBytes) } });
  assert.equal((await f.read(a.id)).candidate.diff.patch.length, limits.patchBytes);
  for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(transitionGitAction(a.id, revision, { state: "executing" }, f.agentDir), /Invalid/);
  await assert.rejects(f.step(a, { state: "blocked", reason: "x".repeat(limits.reasonBytes + 1) }), /Invalid/);
});

test("approved decision/intent immutable, illegal completion refuses, terminal edits refuse", async t => {
  const f = fixture(t), a = await f.create();
  await assert.rejects(f.step(a, { state: "succeeded", outcome: result }), /Illegal/);
  const b = await f.step(a, { state: "awaiting-decision" });
  await assert.rejects(f.step(b, { state: "succeeded", outcome: result }), /Illegal/);
  const c = await f.step(b, { state: "executing", decision: "approved", intended: result });
  await assert.rejects(f.step(c, { state: "executing", decision: "declined" }), /Executing|immutable/);
  await assert.rejects(f.step(c, { state: "executing", intended: { ...result, commit: parentOid } }), /immutable/);
  await assert.rejects(f.step(c, { state: "executing", outcome: result }), /Executing/);
  const done = await f.step(c, { state: "succeeded", outcome: result });
  assert.deepEqual(done.intended, result); assert.deepEqual(done.outcome, result);
  await assert.rejects(f.step(done, { state: "executing" }), /terminal/);
});

test("review-only direct comparison completion is not human acknowledgement", async t => {
  const f = fixture(t), a = await f.create(f.review()), b = await f.step(a, { state: "succeeded" });
  assert.equal(b.decision, undefined); assert.equal(b.outcome, undefined);
  for (const key of ["diff", "selection", "featureBranch", "targetBranch", "featureOid", "targetOid"]) {
    const input = f.review(); delete input[key]; const c = await f.create(input);
    await assert.rejects(f.step(c, { state: "succeeded" }), /Incomplete/);
  }
});

test("optimistic process-local revision checks need no promise lock, disk authority or namespace gate", async t => {
  const f = fixture(t), a = await f.create();
  const results = await Promise.allSettled([f.step(a, { state: "awaiting-decision" }), f.step(a, { state: "blocked" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(results.find(r => r.status === "rejected").reason.message, /revision conflict/);
  releaseGitAction(a.id, f.agentDir); await assert.rejects(f.step(a, { state: "executing" }), /read-only/);
  assert.equal((await f.read(a.id)).record, null, "nonterminal memory is not falsely durable");
});

for (const state of ["declined", "cancelled", "expired", "blocked", "failed"]) test(`terminal ${state} retains exact captured bytes without approval inference`, async t => {
  const f = fixture(t), a = await f.create(), b = await f.step(a, { state: "awaiting-decision" }), c = await f.step(b, { state });
  releaseGitAction(a.id, f.agentDir); const h = await f.read(a.id);
  assert.equal(h.record.state, state); assert.equal(h.record.decision, undefined); assert.deepEqual(h.candidate, f.snapshot());
  assert.equal(c.diagnostics, undefined);
});

test("combined terminal document overflow omits diagnostics, not validated native facts", t => {
  const f = fixture(t);
  let captured;
  // Find a near-limit valid initial compact candidate without changing any
  // per-field limit. A later bounded reason/outcome exceeds the storage bound.
  for (let length = 100; length < 140; length++) {
    try { captured = captureGitActionRecord({ sessionId: "s", source: "human", candidate: f.snapshot({ paths: Array(2000).fill("x".repeat(length)) }) }); }
    catch { break; }
  }
  assert.ok(captured);
  const executing = advanceGitActionRecord(captured.record, captured.candidate, { state: "executing" });
  const done = advanceGitActionRecord(executing, captured.candidate, { state: "succeeded", outcome: result, reason: "x".repeat(limits.reasonBytes) });
  assert.ok(Buffer.byteLength(document(done)) > limits.recordBytes);
  assert.equal(persistCompletedGitAction(done, f.agentDir, captured.candidate).diagnostics.reason, "retention-limited");
  assert.equal(done.outcome.commit, commitOid); assert.deepEqual(fs.readdirSync(f.agentDir), []);
});

test("candidate binding validation is pure and precedes finalized I/O", async t => {
  const f = fixture(t), a = captureGitActionRecord({ sessionId: "s", source: "human", candidate: f.snapshot() });
  const b = advanceGitActionRecord(a.record, a.candidate, { state: "blocked" });
  assert.throws(() => persistCompletedGitAction(b, f.agentDir, f.snapshot({ message: "substitution" })), /artifact/);
  assert.throws(() => persistCompletedGitAction(a.record, f.agentDir, a.candidate), /completed/);
  assert.deepEqual(fs.readdirSync(f.agentDir), []);
});

for (const state of ["proposed", "executing", "succeeded"]) test(`legacy ${state} fixture is read-only and never regains liveness`, async t => {
  const f = fixture(t), old = f.legacy(f.snapshot(), { state, ...(state === "succeeded" ? { outcome: result } : {}) });
  const bytes = fs.readFileSync(old.record), h = await f.read(old.value.id);
  assert.equal(h.record.state, state === "proposed" ? "expired" : state === "executing" ? "recovery-required" : "succeeded");
  assert.deepEqual(h.candidate, f.snapshot());
  await assert.rejects(f.step(old.value, { state: "executing" }), /read-only/);
  emitGitActionAnchor("origin", { type: "git_action_update", actionId: old.value.id, revision: 1 });
  assert.equal(readLiveGitAction("origin", old.value.id, { includeArtifact: true }, f.agentDir), undefined);
  assert.deepEqual(fs.readFileSync(old.record), bytes);
});

test("strict legacy record versions, hashes, keys, identity and encoding remain validated without repair", async t => {
  const f = fixture(t), old = f.legacy(), a = old.value, original = JSON.parse(fs.readFileSync(old.record));
  const variants = ["{", "null", canonical({ ...original, version: 2 }), canonical({ ...original, job: {} }),
    canonical({ ...original, record: { ...a, state: "executing" } }), document({ ...a, version: 2 }), document({ ...a, id: randomUUID() }),
    document({ ...a, revision: 0 }), document({ ...a, processId: "bad" }), document({ ...a, updatedAt: a.createdAt - 1 }),
    document({ ...a, summary: { ...a.summary, diff: f.snapshot().diff } }), document({ ...a, artifact: { ...a.artifact, planId: "bad" } }),
    document({ ...a, outcome: { ...result, token: true } }), document({ ...a, intended: { ...result, approved: true } }),
    document({ ...a, state: "future" }), document({ ...a, kind: "integration" }), document({ ...a, artifact: { ...a.artifact, bytes: limits.artifactBytes + 1 } }),
    JSON.stringify(original, null, 2), `{"version":0,${canonical(original).slice(1)}`];
  for (const raw of variants) { fs.writeFileSync(old.record, raw); assert.equal((await f.read(a.id)).record, null); assert.equal(fs.readFileSync(old.record, "utf8"), raw); }
});

test("legacy artifact exact digest/size/schema/summary binding is never replaced with current content", async t => {
  const f = fixture(t), old = f.legacy(f.snapshot(), { state: "succeeded", outcome: result }), a = old.value, c = f.snapshot();
  for (const raw of ["{}", canonical({ version: 1, candidate: { ...c, message: "different" } }), "x".repeat(limits.artifactBytes + 1)]) {
    fs.writeFileSync(old.artifact, raw); const h = await f.read(a.id); assert.equal(h.record.state, "succeeded"); assert.equal(h.candidate, undefined); assert.match(h.unavailable, /invalid/);
  }
  for (const v of [{ version: 2, candidate: c }, { version: 1, candidate: c, token: true }, { version: 1, candidate: { ...c, reviewToken: "bad" } },
    { version: 1, candidate: { ...c, diff: { ...c.diff, plan: true } } }, { version: 1, candidate: { ...c, message: "substitution" } }]) {
    const raw = canonical(v); fs.writeFileSync(old.artifact, raw);
    fs.writeFileSync(old.record, document({ ...a, artifact: { bytes: Buffer.byteLength(raw), sha256: hash(raw) } }));
    assert.equal((await f.read(a.id)).candidate, undefined);
  }
});

test("legacy file bounds/links/private modes and UUID traversal fail safely", async t => {
  const f = fixture(t);
  for (const id of ["../escape", "", "/tmp/action", randomUUID().toUpperCase(), `${randomUUID()}/record.json`]) {
    await assert.rejects(f.read(id), /Invalid/); await assert.rejects(transitionGitAction(id, 1, { state: "executing" }, f.agentDir), /Invalid/);
  }
  const old = f.legacy(), bytes = fs.readFileSync(old.record), foreign = join(f.agentDir, "foreign");
  fs.writeFileSync(foreign, bytes, { mode: 0o600 });
  for (const kind of ["symlink", "hardlink", "public", "oversized"]) {
    fs.unlinkSync(old.record);
    if (kind === "symlink") fs.symlinkSync(foreign, old.record);
    if (kind === "hardlink") fs.linkSync(foreign, old.record);
    if (kind === "public") { fs.writeFileSync(old.record, bytes, { mode: 0o600 }); fs.chmodSync(old.record, 0o644); }
    if (kind === "oversized") fs.writeFileSync(old.record, Buffer.alloc(limits.recordBytes + 1), { mode: 0o600 });
    assert.equal((await f.read(old.value.id)).record, null);
    assert.deepEqual(fs.readFileSync(foreign), bytes);
  }
});

test("storage failure keeps exact memory/outcome; no blind retry, no parallel v1 copy", async t => {
  const f = fixture(t), a = await f.create(), b = await f.step(a, { state: "executing" });
  fault(t, "writeSync", () => { throw Object.assign(Error("private diagnostic"), { code: "ENOSPC" }); });
  const c = await f.step(b, { state: "succeeded", outcome: result });
  assert.equal(c.state, "succeeded"); assert.equal(c.outcome.commit, commitOid); assert.equal(c.diagnostics.reason, "storage-unavailable");
  assert.deepEqual((await f.read(a.id)).candidate, f.snapshot()); assert.equal(fs.existsSync(join(f.agentDir, "pi-web")), false);
});

test("minimal session updates and failing observers never create approval or change outcomes", async t => {
  const f = fixture(t), events = [], stop = subscribeGitActionUpdates("origin", e => { events.push(e); throw Error("observer"); }); t.after(stop);
  const a = await complete(f); assert.equal(a.state, "succeeded");
  assert.ok(events.length >= 3);
  for (const e of events) assert.deepEqual(Object.keys(e).sort(), ["actionId", "revision", "type"]);
  assert.equal(events.every(e => e.actionId === a.id), true);
});
