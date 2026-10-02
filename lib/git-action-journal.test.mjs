import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const journal = await createJiti(import.meta.url).import("./git-action-journal.ts");
const { createGitAction, transitionGitAction, readGitAction, releaseGitAction,
  subscribeGitActionUpdates, emitGitActionAnchor, GIT_ACTION_LIMITS: limits } = journal;
const parentOid = "a".repeat(40), treeOid = "b".repeat(40), commitOid = "c".repeat(40);
const result = { commit: commitOid, tree: treeOid, parents: [parentOid], authorEmail: "tester@example.invalid" };
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const document = (record) => canonical({ version: 1, record, sha256: hash(canonical(record)) });

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-git-journal-")), agentDir = join(root, "agent"), repo = join(root, "repo");
  const ids = [];
  t.after(() => {
    for (const id of ids) releaseGitAction(id, agentDir);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const snapshot = (overrides = {}) => ({ kind: "commit", repositoryRoot: repo, featureBranch: "feature/cards",
    message: "Capture immutable change", paths: ["file.txt"], parentOid, candidateTreeOid: treeOid,
    diff: { fromTreeOid: parentOid, toTreeOid: treeOid, patch: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n", hasBinaryChanges: false },
    ...overrides });
  const reviewSnapshot = (overrides = {}) => ({ kind: "review", repositoryRoot: repo, featureBranch: "feature/cards",
    targetBranch: "target", featureOid: commitOid, targetOid: parentOid, selection: { kind: "merge" },
    diff: { fromTreeOid: parentOid, toTreeOid: treeOid, patch: "diff --git a/file.txt b/file.txt\n+new\n", hasBinaryChanges: false },
    ...overrides });
  const create = async (candidate = snapshot(), source = "human", sessionId = "origin") => {
    const value = await createGitAction({ sessionId, source, candidate }, agentDir);
    ids.push(value.id);
    return value;
  };
  const paths = (id) => {
    const dir = join(agentDir, "pi-web", "git-actions", "v1", id);
    return { dir, record: join(dir, "record.json"), artifact: join(dir, "candidate.json") };
  };
  const read = (id, includeArtifact = true) => readGitAction(id, { includeArtifact }, agentDir);
  const step = (value, patch) => transitionGitAction(value.id, value.revision, patch, agentDir);
  return { root, agentDir, repo, create, snapshot, reviewSnapshot, paths, read, step };
}

function mockFs(t, method, replacement) {
  const original = fs[method];
  const mocked = t.mock.method(fs, method, (...args) => replacement(original, ...args));
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  return mocked;
}

async function terminal(f, state = "succeeded") {
  const proposed = await f.create();
  const executing = await f.step(proposed, { state: "executing", decision: "approved" });
  return f.step(executing, { state, outcome: result });
}

test("private atomic documents: candidate precedes record, summaries omit patches, and no Git checkout is needed", async (t) => {
  const f = fixture(t), events = [];
  const stop = subscribeGitActionUpdates("origin", (event) => {
    const paths = f.paths(event.actionId);
    events.push({ event, record: fs.existsSync(paths.record), artifact: fs.existsSync(paths.artifact) });
  });
  t.after(stop);
  const candidate = f.snapshot({ checks: [{ label: "Types", argv: ["tsc", "--noEmit"] }],
    selection: { kind: "commits", commitOids: [parentOid] } });
  const value = await f.create(candidate);
  assert.equal(fs.existsSync(f.repo), false);
  assert.equal(value.state, "proposed");
  assert.equal(value.revision, 1);
  assert.equal(value.summary.diff, undefined);
  const paths = f.paths(value.id), bytes = fs.readFileSync(paths.artifact);
  assert.deepEqual(value.artifact, { bytes: bytes.length, sha256: hash(bytes) });
  assert.deepEqual(JSON.parse(bytes), { version: 1, candidate });
  const envelope = JSON.parse(fs.readFileSync(paths.record, "utf8"));
  assert.deepEqual(envelope.record, value);
  assert.equal(envelope.sha256, hash(canonical(value)));
  assert.deepEqual(fs.readdirSync(paths.dir).sort(), ["candidate.json", "record.json"]);
  if (process.platform !== "win32") {
    for (const file of [paths.record, paths.artifact]) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    for (const dir of [paths.dir, dirname(paths.dir), dirname(dirname(paths.dir)), join(f.agentDir, "pi-web")]) {
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    }
  }
  assert.deepEqual(events, [{ event: { type: "git_action_update", actionId: value.id, revision: 1 }, record: true, artifact: true }]);
  assert.deepEqual(await readGitAction(value.id, undefined, f.agentDir), { record: value });
  assert.deepEqual(await f.read(value.id), { record: value, candidate });
  // Neither API inputs nor returned records/candidates retain mutable store references.
  candidate.paths.push("later.txt"); candidate.checks[0].argv[0] = "changed";
  value.summary.paths[0] = "mutated";
  const loaded = await f.read(value.id);
  assert.deepEqual(loaded.candidate.paths, ["file.txt"]);
  assert.equal(loaded.candidate.checks[0].argv[0], "tsc");
  loaded.candidate.diff.patch = "changed";
  assert.equal((await f.read(value.id)).candidate.diff.patch, JSON.parse(bytes).candidate.diff.patch);
});

test("staged commit source survives private history; older snapshots remain readable without inferred mode", async (t) => {
  const f = fixture(t);
  const staged = await f.create(f.snapshot({ commitMode: "staged" }));
  assert.equal(staged.summary.commitMode, "staged");
  assert.equal((await f.read(staged.id)).candidate.commitMode, "staged");
  const old = await f.create();
  assert.equal((await f.read(old.id)).candidate.commitMode, undefined);
  await assert.rejects(f.create(f.snapshot({ commitMode: "unknown" })));
  await assert.rejects(f.create(f.snapshot({ kind: "review", commitMode: "staged" })));
});

test("v1 project/checkout attribution is immutable display evidence, not inferred from branch names", async (t) => {
  const f = fixture(t);
  const other = join(f.root, "other");
  const a = await f.create(f.reviewSnapshot({ projectRoot: f.repo, sourceCheckoutRoot: f.repo,
    targetCheckoutRoot: join(f.repo, "target"), featureBranch: "feature", targetBranch: "main" }));
  const b = await f.create(f.reviewSnapshot({ repositoryRoot: other, projectRoot: other,
    sourceCheckoutRoot: other, targetCheckoutRoot: join(other, "target"), featureBranch: "feature", targetBranch: "main" }));
  assert.notEqual(a.artifact.sha256, b.artifact.sha256);
  for (const [value, project] of [[a, f.repo], [b, other]]) {
    assert.equal(value.summary.projectRoot, project);
    assert.equal((await f.read(value.id)).candidate.sourceCheckoutRoot, project);
  }
  const legacy = await f.create(f.reviewSnapshot());
  assert.equal((await f.read(legacy.id)).candidate.projectRoot, undefined);
  assert.equal((await f.read(legacy.id)).candidate.sourceCheckoutRoot, undefined);
  for (const bad of [
    { projectRoot: f.repo }, { sourceCheckoutRoot: f.repo }, { targetCheckoutRoot: f.repo },
    { projectRoot: f.repo, sourceCheckoutRoot: other },
    { projectRoot: f.repo, sourceCheckoutRoot: "relative" },
    { projectRoot: f.repo, sourceCheckoutRoot: f.repo, targetCheckoutRoot: "relative" },
    { projectRoot: f.repo, sourceCheckoutRoot: f.repo, targetCheckoutRoot: "/bad\npath" },
  ]) await assert.rejects(f.create(f.reviewSnapshot(bad)), /Invalid/);
  await assert.rejects(f.create(f.snapshot({ projectRoot: f.repo, sourceCheckoutRoot: f.repo,
    targetCheckoutRoot: other })), /Invalid/);
});

test("changed attribution in an artifact is refused even when its digest and byte count are recomputed", async (t) => {
  const f = fixture(t), a = await f.create(f.snapshot({ projectRoot: f.repo, sourceCheckoutRoot: f.repo }));
  const paths = f.paths(a.id);
  const original = fs.readFileSync(paths.artifact, "utf8");
  for (const change of [
    { projectRoot: join(f.root, "swapped") },
    { sourceCheckoutRoot: join(f.root, "swapped") },
    { projectRoot: undefined, sourceCheckoutRoot: undefined },
  ]) {
    const candidate = { ...JSON.parse(original).candidate, ...change };
    if (change.projectRoot === undefined) { delete candidate.projectRoot; delete candidate.sourceCheckoutRoot; }
    const data = canonical({ version: 1, candidate });
    fs.writeFileSync(paths.artifact, data);
    fs.writeFileSync(paths.record, document({ ...a, artifact: { bytes: Buffer.byteLength(data), sha256: hash(data) } }));
    const response = await f.read(a.id, false);
    assert.equal(response.candidate, undefined);
    assert.match(response.unavailable, /invalid/);
  }
});

test("identical captured data has stable hashes regardless of object key order; array order remains significant", async (t) => {
  const f = fixture(t), snapshot = f.snapshot();
  const reversed = Object.fromEntries(Object.entries(snapshot).reverse());
  reversed.diff = Object.fromEntries(Object.entries(snapshot.diff).reverse());
  const a = await f.create(snapshot), b = await f.create(reversed);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a.artifact, b.artifact);
  const c = await f.create(f.snapshot({ paths: ["a", "b"] })), d = await f.create(f.snapshot({ paths: ["b", "a"] }));
  assert.notEqual(c.artifact.sha256, d.artifact.sha256);
});

test("terminal history and captured artifacts survive repository and originating session deletion", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.repo); fs.writeFileSync(join(f.repo, "file.txt"), "old");
  fs.mkdirSync(join(f.agentDir, "sessions"), { recursive: true });
  fs.writeFileSync(join(f.agentDir, "sessions", "origin.jsonl"), "original session");
  const captured = f.snapshot({ projectRoot: f.repo, sourceCheckoutRoot: f.repo });
  const proposed = await f.create(captured), paths = f.paths(proposed.id), before = fs.readFileSync(paths.artifact);
  const awaiting = await f.step(proposed, { state: "awaiting-decision" });
  const declined = await f.step(awaiting, { state: "declined", decision: "declined" });
  fs.rmSync(f.repo, { recursive: true }); fs.rmSync(join(f.agentDir, "sessions"), { recursive: true });
  releaseGitAction(declined.id, f.agentDir);
  const history = await f.read(declined.id);
  assert.equal(history.record.state, "declined");
  assert.equal(history.record.revision, 3);
  assert.deepEqual(history.candidate, captured);
  assert.equal(history.record.summary.projectRoot, f.repo);
  assert.deepEqual(fs.readFileSync(paths.artifact), before);
  await assert.rejects(f.step(declined, { state: "executing" }), /terminal/);
});

test("approval, pre-ref intended OIDs, and actual outcome remain three distinct facts", async (t) => {
  const f = fixture(t);
  const a = await f.create(), b = await f.step(a, { state: "awaiting-decision" });
  const c = await f.step(b, { state: "executing", decision: "approved" });
  assert.equal(c.outcome, undefined);
  assert.equal(c.intended, undefined);
  const patch = { state: "executing", intended: structuredClone(result) };
  const pending = f.step(c, patch);
  patch.intended.parents[0] = commitOid;
  const prepared = await pending;
  assert.deepEqual(prepared.intended, result);
  assert.equal(prepared.outcome, undefined);
  assert.equal(prepared.revision, 4);
  const partial = await f.step(prepared, { state: "recovery-required", outcome: { ...result, status: "partial-success" }, reason: "Index needs inspection" });
  assert.equal(partial.decision, "approved");
  assert.equal(partial.state, "recovery-required");
  assert.deepEqual(partial.intended, result);
  assert.equal(partial.outcome.status, "partial-success");
  assert.ok(partial.updatedAt > c.updatedAt);
  const before = fs.readFileSync(f.paths(a.id).record);
  await assert.rejects(f.step(partial, { state: "succeeded" }), /terminal/);
  assert.deepEqual(fs.readFileSync(f.paths(a.id).record), before);
});

test("pre-ref intent updates cannot change a recorded decision, substitute intended OIDs, or report actual outcome", async (t) => {
  const f = fixture(t), a = await f.create();
  const b = await f.step(a, { state: "executing", decision: "approved" });
  for (const patch of [{ state: "executing" }, { state: "executing", outcome: result },
    { state: "executing", intended: result, decision: "approved" }]) {
    await assert.rejects(f.step(b, patch), /pre-ref intent/);
  }
  const c = await f.step(b, { state: "executing", intended: result });
  await assert.rejects(f.step(c, { state: "executing", intended: { ...result, commit: parentOid } }), /intended result is immutable/);
  await assert.rejects(f.step(c, { state: "cancelled", decision: "cancelled" }), /decision is immutable/);
  await assert.rejects(f.step(c, { state: "succeeded", intended: result }), /must precede completion/);
  assert.equal((await f.read(a.id)).record.revision, c.revision);
  releaseGitAction(a.id, f.agentDir);
  const projected = (await f.read(a.id)).record;
  assert.equal(projected.state, "recovery-required");
  assert.deepEqual(projected.intended, result);
  assert.equal(projected.outcome, undefined);
});

test("allowed state machine edges work, including read-only review completion without execution", async (t) => {
  const f = fixture(t);
  const allowed = {
    proposed: ["awaiting-decision", "executing", "succeeded", "blocked", "failed", "cancelled", "expired"],
    "awaiting-decision": ["executing", "succeeded", "declined", "cancelled", "blocked", "failed", "expired"],
    executing: ["succeeded", "failed", "cancelled", "blocked", "recovery-required"],
  };
  for (const [from, next] of Object.entries(allowed)) for (const to of next) {
    let value = await f.create(f.reviewSnapshot());
    if (from !== "proposed") value = await f.step(value, { state: from });
    const updated = await f.step(value, { state: to, ...(to === "succeeded" && from === "awaiting-decision" ? { decision: "reviewed" } : {}) });
    assert.equal(updated.state, to, `${from} -> ${to}`);
    assert.equal(updated.revision, value.revision + 1);
    assert.deepEqual(updated.summary, value.summary);
    assert.deepEqual(updated.artifact, value.artifact);
    assert.equal(updated.createdAt, value.createdAt);
    assert.equal(updated.processId, value.processId);
  }
});

test("only review can complete directly without a decision; old acknowledged review history remains valid", async (t) => {
  const f = fixture(t);
  const review = await f.create(f.reviewSnapshot());
  for (const patch of [{ state: "succeeded", decision: "reviewed" }, { state: "succeeded", outcome: result },
    { state: "succeeded", intended: result }]) await assert.rejects(f.step(review, patch), /Illegal/);
  const done = await f.step(review, { state: "succeeded" });
  assert.equal(done.decision, undefined);
  assert.equal((await f.read(done.id)).record.state, "succeeded");
  for (const kind of ["commit", "checks", "integration"]) {
    const other = await f.create(f.snapshot({ kind }));
    await assert.rejects(f.step(other, { state: "succeeded" }), /Illegal/);
  }
  const old = await f.create(f.snapshot({ kind: "review" })); // Historical weaker shape is still readable.
  const waiting = await f.step(old, { state: "awaiting-decision" });
  const acknowledged = await f.step(waiting, { state: "succeeded", decision: "reviewed" });
  assert.equal((await f.read(acknowledged.id)).record.decision, "reviewed");
});

test("direct review completion requires a captured diff, selection and bound ref metadata", async (t) => {
  const f = fixture(t);
  for (const missing of ["diff", "selection", "featureBranch", "targetBranch", "featureOid", "targetOid"]) {
    const incomplete = f.reviewSnapshot();
    delete incomplete[missing];
    const proposed = await f.create(incomplete), bytes = fs.readFileSync(f.paths(proposed.id).record);
    await assert.rejects(f.step(proposed, { state: "succeeded" }), /Incomplete Git review comparison artifact/);
    assert.deepEqual(fs.readFileSync(f.paths(proposed.id).record), bytes, `no completed record without ${missing}`);
  }
  for (const tree of ["fromTreeOid", "toTreeOid"]) {
    const incomplete = f.reviewSnapshot();
    delete incomplete.diff[tree];
    await assert.rejects(f.create(incomplete), /Invalid/, `malformed ${tree} never reaches the journal`);
  }
  await assert.rejects(f.create(f.reviewSnapshot({ featureOid: "not-an-oid" })), /Invalid/);
  await assert.rejects(f.create(f.reviewSnapshot({ targetBranch: "" })), /Invalid/);
  const noPatch = await f.create(f.reviewSnapshot({ diff: undefined, diffUnavailable: "Comparison too large" }));
  await assert.rejects(f.step(noPatch, { state: "succeeded" }), /Incomplete Git review comparison artifact/);
  const valid = await f.create(f.reviewSnapshot());
  assert.equal((await f.step(valid, { state: "succeeded" })).decision, undefined);
});

test("explicit preview/dialog timeout is durable expiry, never an inferred decline or approval", async (t) => {
  const f = fixture(t);
  for (const from of ["proposed", "awaiting-decision"]) {
    let value = await f.create();
    if (from === "awaiting-decision") value = await f.step(value, { state: from });
    const expired = await f.step(value, { state: "expired", reason: "Approval window timed out" });
    assert.equal(expired.state, "expired");
    assert.equal(expired.decision, undefined);
    assert.equal(expired.outcome, undefined);
    assert.equal(expired.revision, value.revision + 1);
    assert.deepEqual((await f.read(expired.id)).record, expired);
    releaseGitAction(expired.id, f.agentDir);
    await assert.rejects(f.step(expired, { state: "executing", decision: "approved" }), /terminal/);
  }
});

test("owner session IDs are bounded display identities, never journal path components", async (t) => {
  const f = fixture(t), session = "../../session fixture/日本語";
  const value = await f.create(f.snapshot(), "legacy-agent", session);
  assert.equal(value.sessionId, session);
  assert.equal(fs.existsSync(f.paths(value.id).record), true);
  assert.equal((await f.read(value.id)).record.sessionId, session);
  await f.create(f.snapshot(), "agent", "s".repeat(256));
  await assert.rejects(f.create(f.snapshot(), "human", "s".repeat(257)), /Invalid/);
  await assert.rejects(f.create(f.snapshot(), "human", "é".repeat(129)), /Invalid/);
});

test("illegal transitions and terminal edits never touch the record", async (t) => {
  const f = fixture(t), a = await f.create(), path = f.paths(a.id).record;
  const before = fs.readFileSync(path);
  for (const state of ["proposed", "succeeded", "declined", "recovery-required"]) {
    await assert.rejects(f.step(a, { state }), /Illegal/);
    assert.deepEqual(fs.readFileSync(path), before);
  }
  const b = await f.step(a, { state: "awaiting-decision" });
  await assert.rejects(f.step(b, { state: "succeeded" }), /Illegal/);
  await assert.rejects(f.step(b, { state: "proposed" }), /Illegal/);
  const c = await f.step(b, { state: "executing" });
  await assert.rejects(f.step(c, { state: "awaiting-decision" }), /Illegal/);
  for (const state of ["blocked", "failed", "cancelled", "succeeded", "recovery-required"]) {
    const done = await terminal(f, state), terminalBytes = fs.readFileSync(f.paths(done.id).record);
    await assert.rejects(f.step(done, { state, reason: "rewrite terminal history" }), /terminal/);
    assert.deepEqual(fs.readFileSync(f.paths(done.id).record), terminalBytes);
  }
});

test("concurrent CAS has one winner, stale revisions conflict, and HMR shares locks and liveness", async (t) => {
  const f = fixture(t), value = await f.create();
  const reloaded = await createJiti(import.meta.url, { moduleCache: false }).import("./git-action-journal.ts");
  assert.notEqual(reloaded.createGitAction, createGitAction);
  assert.equal((await reloaded.readGitAction(value.id, {}, f.agentDir)).record.state, "proposed");
  const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => (i % 2 ? journal : reloaded)
    .transitionGitAction(value.id, 1, { state: "awaiting-decision" }, f.agentDir)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results.filter((r) => r.status === "rejected")) assert.match(r.reason.message, /revision conflict/);
  const b = (await f.read(value.id)).record;
  assert.equal(b.revision, 2);
  await assert.rejects(f.step(value, { state: "executing" }), /revision conflict/);
  const c = await f.step(b, { state: "executing" });
  assert.equal(c.revision, 3);
  reloaded.releaseGitAction(value.id, f.agentDir);
  assert.equal((await f.read(value.id)).record.state, "recovery-required");
});

test("release revokes queued transitions and timestamps stay monotonic if the wall clock moves back", async (t) => {
  const f = fixture(t), a = await f.create();
  t.mock.method(Date, "now", () => 0);
  const b = await f.step(a, { state: "awaiting-decision" });
  assert.equal(b.updatedAt, a.updatedAt + 1);
  const pending = f.step(b, { state: "executing", decision: "approved" });
  releaseGitAction(b.id, f.agentDir);
  await assert.rejects(pending, /no longer live/);
  assert.equal(JSON.parse(fs.readFileSync(f.paths(b.id).record, "utf8")).record.revision, b.revision);
});

test("release projects nonterminal history without rewriting it or allowing anchor/replay reactivation", async (t) => {
  const f = fixture(t);
  for (const state of ["proposed", "awaiting-decision", "executing"]) {
    let value = await f.create();
    if (state !== "proposed") value = await f.step(value, { state, ...(state === "executing" ? { decision: "approved" } : {}) });
    const path = f.paths(value.id).record, before = fs.readFileSync(path);
    releaseGitAction(value.id, f.agentDir); releaseGitAction(value.id, f.agentDir);
    emitGitActionAnchor("fork", { type: "git_action_update", actionId: value.id, revision: value.revision, entryId: "fork-anchor", timestamp: 123 });
    const projection = (await f.read(value.id)).record;
    assert.equal(projection.state, state === "executing" ? "recovery-required" : "expired");
    assert.equal(projection.revision, value.revision);
    assert.equal(projection.updatedAt, value.updatedAt);
    assert.equal(projection.decision, value.decision);
    await assert.rejects(f.step(value, { state: state === "executing" ? "succeeded" : "executing" }), /no longer live/);
    assert.deepEqual(fs.readFileSync(path), before);
  }
});

test("a fresh process only reads history; matching persisted process IDs still cannot supply active membership", async (t) => {
  const f = fixture(t);
  const proposed = await f.create(), awaiting = await f.step(await f.create(), { state: "awaiting-decision" });
  const executing = await f.step(await f.create(), { state: "executing", decision: "approved" });
  const prepared = await f.step(executing, { state: "executing", intended: result });
  const done = await terminal(f);
  const values = [proposed, awaiting, prepared, done];
  const bytes = values.map((value) => fs.readFileSync(f.paths(value.id).record));
  const script = `const { createJiti } = require("jiti");
    (async () => {
      const j = await createJiti(process.cwd() + "/lib/git-action-journal.test.mjs").import("./git-action-journal.ts");
      const [dir, ...ids] = process.argv.slice(1);
      const histories = [], denied = [];
      for (const id of ids) {
        const history = await j.readGitAction(id, { includeArtifact: true }, dir);
        histories.push(history);
        try { await j.transitionGitAction(id, history.record.revision, { state: "executing" }, dir); denied.push(false); }
        catch { denied.push(true); }
      }
      process.stdout.write(JSON.stringify({ histories, denied }));
    })().catch(e => { console.error(e); process.exitCode = 1; });`;
  const fresh = JSON.parse(execFileSync(process.execPath, ["-e", script, f.agentDir, ...values.map((v) => v.id)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: f.agentDir },
  }));
  assert.deepEqual(fresh.histories.map((h) => h.record.state), ["expired", "expired", "recovery-required", "succeeded"]);
  assert.deepEqual(fresh.denied, [true, true, true, true]);
  assert.deepEqual(fresh.histories[2].record.intended, result);
  assert.equal(fresh.histories[2].record.outcome, undefined);
  values.forEach((value, i) => assert.deepEqual(fs.readFileSync(f.paths(value.id).record), bytes[i]));
  assert.equal((await f.read(proposed.id)).record.state, "proposed");
  // Copying intact evidence to another agent root in this same process is not adoption.
  const otherDir = join(f.root, "other-agent"), otherAction = join(otherDir, "pi-web", "git-actions", "v1", proposed.id);
  fs.mkdirSync(otherAction, { recursive: true, mode: 0o700 });
  fs.copyFileSync(f.paths(proposed.id).record, join(otherAction, "record.json"));
  fs.copyFileSync(f.paths(proposed.id).artifact, join(otherAction, "candidate.json"));
  assert.equal((await readGitAction(proposed.id, {}, otherDir)).record.state, "expired");
  await assert.rejects(transitionGitAction(proposed.id, 1, { state: "executing" }, otherDir), /no longer live/);
});

test("strict input allowlists reject capability fields at every nesting level, without silently stripping them", async (t) => {
  const f = fixture(t), c = f.snapshot();
  const unknown = ["plan", "planId", "reviewToken", "receiptIds", "verificationIds", "jobs", "credentials", "token", "approved"];
  for (const field of unknown) {
    await assert.rejects(f.create({ ...c, [field]: "not-persisted" }), /Invalid/);
    await assert.rejects(createGitAction({ sessionId: "origin", source: "human", candidate: c, [field]: undefined }, f.agentDir), /Invalid/);
    await assert.rejects(f.create({ ...c, diff: { ...c.diff, [field]: true } }), /Invalid/);
    await assert.rejects(f.create({ ...c, checks: [{ label: "Check", argv: ["true"], [field]: true }] }), /Invalid/);
    await assert.rejects(f.create({ ...c, selection: { kind: "merge", [field]: true } }), /Invalid/);
  }
  assert.equal(fs.existsSync(f.agentDir), false);
  const a = await f.create();
  for (const field of unknown) {
    await assert.rejects(f.step(a, { state: "executing", [field]: true }), /Invalid/);
    await assert.rejects(f.step(a, { state: "executing", outcome: { ...result, [field]: true } }), /Invalid/);
    await assert.rejects(f.step(a, { state: "executing", intended: { ...result, [field]: true } }), /Invalid/);
  }
  for (const input of [null, [], { ...c, kind: "push" }, { ...c, repositoryRoot: "relative" }, { ...c, parentOid: "short" },
    { ...c, diff: { ...c.diff, hasBinaryChanges: "false" } }, { ...c, diffUnavailable: "not missing" },
    { ...c, selection: { kind: "commits", commitOids: [] } }, { ...c, selection: { kind: "merge", commitOids: [] } },
    { ...c, checks: [{ label: "Check", argv: [] }] }, { ...c, paths: new Array(2) }, { ...c, message: "\0" }]) {
    await assert.rejects(f.create(input), /Invalid/);
  }
  await assert.rejects(f.create(c, "robot"), /Invalid/);
  await assert.rejects(f.create(c, "human", ""), /Invalid/);
  await assert.rejects(f.step(a, { state: "succeeded", decision: "auto-approved" }), /Invalid/);
  for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(transitionGitAction(a.id, revision, { state: "executing" }, f.agentDir), /Invalid/);
  }
  assert.equal((await f.read(a.id)).record.revision, 1);
});

test("bounded candidate inputs and encoded documents are refused, never truncated", async (t) => {
  const f = fixture(t), base = f.snapshot();
  for (const extra of [
    { diff: { ...base.diff, patch: "x".repeat(limits.patchBytes + 1) } },
    { diff: { ...base.diff, patch: "é".repeat(limits.patchBytes / 2 + 1) } },
    { paths: Array(limits.paths + 1).fill("a") }, { paths: ["x".repeat(limits.pathBytes + 1)] },
    { message: "x".repeat(limits.messageBytes + 1) },
    { checks: Array(limits.checks + 1).fill({ label: "Check", argv: ["true"] }) },
    { checks: [{ label: "Check", argv: Array(limits.checkArgs + 1).fill("arg") }] },
    { selection: { kind: "commits", commitOids: Array(limits.commitOids + 1).fill(parentOid) } },
    { paths: Array(limits.paths).fill("x".repeat(200)) }, // Individually valid, oversized record.
    { diff: { ...base.diff, patch: "\u0001".repeat(limits.patchBytes) } }, // JSON expansion exceeds artifact cap.
  ]) await assert.rejects(f.create({ ...base, ...extra }), /Invalid/);
  assert.equal(fs.existsSync(f.agentDir), false);
  const exact = await f.create({ ...base, diff: { ...base.diff, patch: "x".repeat(limits.patchBytes) } });
  assert.equal((await f.read(exact.id)).candidate.diff.patch.length, limits.patchBytes);
  await assert.rejects(f.step(exact, { state: "blocked", reason: "x".repeat(limits.reasonBytes + 1) }), /Invalid/);
});

test("corrupt, future, unknown-field, duplicate-key and noncanonical record documents are refused without repair", async (t) => {
  const f = fixture(t), a = await f.create(), paths = f.paths(a.id), original = JSON.parse(fs.readFileSync(paths.record, "utf8"));
  releaseGitAction(a.id, f.agentDir);
  const variants = ["{", "null", canonical({ ...original, version: 2 }), canonical({ ...original, job: {} }),
    canonical({ ...original, record: { ...a, state: "executing" } }), // Old digest.
    document({ ...a, version: 2 }), document({ ...a, id: randomUUID() }), document({ ...a, revision: 0 }),
    document({ ...a, processId: "not-a-uuid" }), document({ ...a, updatedAt: a.createdAt - 1 }),
    document({ ...a, summary: { ...a.summary, diff: f.snapshot().diff } }),
    document({ ...a, artifact: { ...a.artifact, planId: "forbidden" } }),
    document({ ...a, outcome: { ...result, receiptId: "forbidden" } }),
    document({ ...a, intended: { ...result, reviewToken: "forbidden" } }),
    document({ ...a, state: "future-state" }), document({ ...a, kind: "integration" }),
    document({ ...a, artifact: { ...a.artifact, bytes: limits.artifactBytes + 1 } }),
    JSON.stringify(original, null, 2), `{"version":0,${canonical(original).slice(1)}`];
  for (const raw of variants) {
    fs.writeFileSync(paths.record, raw);
    const response = await f.read(a.id);
    assert.equal(response.record, null, raw.slice(0, 120));
    assert.match(response.unavailable, /invalid|unsupported/);
    await assert.rejects(f.step(a, { state: "executing" }));
    assert.equal(fs.readFileSync(paths.record, "utf8"), raw);
  }
});

test("active digest evidence refuses otherwise well-formed in-process tampering and revision rollback", async (t) => {
  const f = fixture(t), a = await f.create(), path = f.paths(a.id).record;
  const original = fs.readFileSync(path);
  fs.writeFileSync(path, document({ ...a, decision: "approved" }));
  assert.equal((await f.read(a.id)).record, null);
  await assert.rejects(f.step(a, { state: "executing" }), /live record digest/);
  fs.writeFileSync(path, original);
  const b = await f.step(a, { state: "awaiting-decision" });
  fs.writeFileSync(path, original);
  assert.equal((await f.read(b.id)).record, null);
  await assert.rejects(f.step(a, { state: "executing" }), /live record digest/);
});

test("artifact digest, size, metadata and strict schema are validated even for summary-only reads", async (t) => {
  const f = fixture(t), a = await terminal(f), paths = f.paths(a.id);
  const original = fs.readFileSync(paths.artifact), c = f.snapshot();
  const corruptions = [Buffer.from("{}"), Buffer.from(original.toString().replace("+new", "+bad")), Buffer.concat([original, Buffer.from(" ")])];
  for (const bytes of corruptions) {
    fs.writeFileSync(paths.artifact, bytes);
    const response = await f.read(a.id, false);
    assert.equal(response.record.state, "succeeded");
    assert.equal(response.candidate, undefined);
    assert.match(response.unavailable, /candidate.*invalid/);
  }
  // Recomputed checksums do not bypass the version/shape/summary contract.
  for (const artifact of [{ version: 2, candidate: c }, { version: 1, candidate: c, token: true },
    { version: 1, candidate: { ...c, reviewToken: "forbidden" } },
    { version: 1, candidate: { ...c, diff: { ...c.diff, plan: true } } },
    { version: 1, candidate: { ...c, message: "substituted" } }]) {
    const data = canonical(artifact);
    fs.writeFileSync(paths.artifact, data);
    fs.writeFileSync(paths.record, document({ ...a, artifact: { bytes: Buffer.byteLength(data), sha256: hash(data) } }));
    const response = await f.read(a.id);
    assert.equal(response.candidate, undefined);
    assert.match(response.unavailable, /candidate.*invalid/);
  }
});

test("missing records/artifacts have honest placeholders, and missing live artifacts block transitions", async (t) => {
  const f = fixture(t);
  const missing = await f.read(randomUUID());
  assert.equal(missing.record, null); assert.match(missing.unavailable, /unavailable/);
  assert.equal(fs.existsSync(f.agentDir), false); // Reads do not create directories.
  for (const phase of ["proposed", "executing", "succeeded"]) {
    let a = phase === "succeeded" ? await terminal(f) : await f.create();
    if (phase === "executing") a = await f.step(a, { state: "executing" });
    const path = f.paths(a.id);
    fs.unlinkSync(path.artifact);
    const response = await f.read(a.id);
    assert.equal(response.record.state, phase === "proposed" ? "expired" : phase === "executing" ? "recovery-required" : "succeeded");
    assert.equal(response.candidate, undefined);
    assert.match(response.unavailable, /missing/);
    await assert.rejects(f.step(a, { state: "succeeded" }));
    assert.equal(fs.existsSync(path.artifact), false);
  }
});

test("oversized on-disk records/artifacts are refused before file contents are read", async (t) => {
  const f = fixture(t), a = await f.create(), paths = f.paths(a.id);
  const original = fs.readFileSync(paths.record);
  let reads = 0;
  mockFs(t, "readSync", (original, ...args) => { reads++; return original(...args); });
  const resize = (file, size) => { const fd = fs.openSync(file, "r+"); try { fs.ftruncateSync(fd, size); } finally { fs.closeSync(fd); } };
  resize(paths.record, limits.recordBytes + 1);
  assert.equal((await f.read(a.id)).record, null);
  assert.equal(reads, 0);
  fs.writeFileSync(paths.record, original);
  resize(paths.artifact, limits.artifactBytes + 1);
  const response = await f.read(a.id);
  assert.equal(response.candidate, undefined);
  assert.match(response.unavailable, /invalid/);
  assert.equal(reads, 2); // Bounded record + its EOF; artifact never opened/read.
});

test("UUID path validation and symlink/hardlink/private-mode checks prevent redirected storage", async (t) => {
  const f = fixture(t);
  for (const id of ["../escape", "a/../b", "", "/tmp/action", randomUUID().toUpperCase(), `${randomUUID()}/record.json`]) {
    await assert.rejects(readGitAction(id, {}, f.agentDir), /Invalid.*ID/);
    await assert.rejects(transitionGitAction(id, 1, { state: "executing" }, f.agentDir), /Invalid.*ID/);
    assert.throws(() => releaseGitAction(id, f.agentDir), /Invalid.*ID/);
  }
  const a = await f.create(), paths = f.paths(a.id), external = join(f.root, "external.json");
  fs.writeFileSync(external, fs.readFileSync(paths.record), { mode: 0o600 });
  fs.unlinkSync(paths.record); fs.symlinkSync(external, paths.record);
  assert.equal((await f.read(a.id)).record, null);
  await assert.rejects(f.step(a, { state: "executing" }));
  fs.unlinkSync(paths.record); fs.linkSync(external, paths.record);
  assert.equal((await f.read(a.id)).record, null);
  fs.unlinkSync(paths.record); fs.copyFileSync(external, paths.record);
  if (process.platform !== "win32") {
    fs.chmodSync(paths.record, 0o644);
    assert.equal((await f.read(a.id)).record, null);
    fs.chmodSync(paths.record, 0o600);
    fs.chmodSync(paths.dir, 0o755);
    assert.equal((await f.read(a.id)).record, null);
    fs.chmodSync(paths.dir, 0o700);
  }
  const alias = join(f.root, "alias"); fs.symlinkSync(f.agentDir, alias, "dir");
  assert.equal((await readGitAction(a.id, {}, alias)).record, null);
  await assert.rejects(createGitAction({ sessionId: "origin", source: "human", candidate: f.snapshot() }, alias), /directory/);
  const privateParent = join(f.root, "unsafe-agent"); fs.mkdirSync(privateParent);
  fs.symlinkSync(f.agentDir, join(privateParent, "pi-web"), "dir");
  await assert.rejects(createGitAction({ sessionId: "origin", source: "human", candidate: f.snapshot() }, privateParent), /directory/);
});

test("pre-artifact publication failure exposes no record/event or active action", async (t) => {
  const f = fixture(t), events = [], stop = subscribeGitActionUpdates("origin", (event) => events.push(event)); t.after(stop);
  mockFs(t, "linkSync", (original, source, destination) => {
    if (destination.endsWith("candidate.json")) throw new Error("injected pre-artifact failure");
    return original(source, destination);
  });
  await assert.rejects(f.create(), /injected pre-artifact/);
  assert.deepEqual(events, []);
  const root = join(f.agentDir, "pi-web", "git-actions", "v1"), [id] = fs.readdirSync(root);
  assert.ok(id);
  assert.deepEqual(fs.readdirSync(join(root, id)), []);
  assert.equal((await f.read(id)).record, null);
  await assert.rejects(transitionGitAction(id, 1, { state: "executing" }, f.agentDir));
});

test("failure publishing initial record retains only the immutable artifact, never an approval", async (t) => {
  const f = fixture(t), events = [], stop = subscribeGitActionUpdates("origin", (event) => events.push(event)); t.after(stop);
  mockFs(t, "linkSync", (original, source, destination) => {
    if (destination.endsWith("record.json")) throw new Error("injected initial record failure");
    return original(source, destination);
  });
  await assert.rejects(f.create(), /injected initial record/);
  const root = join(f.agentDir, "pi-web", "git-actions", "v1"), [id] = fs.readdirSync(root);
  assert.deepEqual(fs.readdirSync(join(root, id)), ["candidate.json"]);
  assert.equal((await f.read(id)).record, null);
  assert.deepEqual(events, []);
});

test("failed initial record directory sync cannot leave a live proposal", { skip: process.platform === "win32" }, async (t) => {
  const f = fixture(t), events = [], stop = subscribeGitActionUpdates("origin", (event) => events.push(event)); t.after(stop);
  let installed = false;
  mockFs(t, "linkSync", (original, source, destination) => {
    const result = original(source, destination);
    if (destination.endsWith("record.json")) installed = true;
    return result;
  });
  mockFs(t, "fsyncSync", (original, fd) => {
    if (installed) { installed = false; throw new Error("injected initial post-record failure"); }
    return original(fd);
  });
  await assert.rejects(f.create(), /initial post-record/);
  const [id] = fs.readdirSync(join(f.agentDir, "pi-web", "git-actions", "v1"));
  assert.equal((await f.read(id)).record.state, "expired");
  await assert.rejects(transitionGitAction(id, 1, { state: "executing" }, f.agentDir), /no longer live/);
  assert.deepEqual(events, []);
});

test("post-record-publication fsync failure leaves read-only evidence and cannot report success or retry", { skip: process.platform === "win32" }, async (t) => {
  const f = fixture(t), events = [], stop = subscribeGitActionUpdates("origin", (event) => events.push(event)); t.after(stop);
  const a = await f.create();
  let published = false;
  mockFs(t, "renameSync", (original, source, destination) => {
    const result = original(source, destination);
    if (destination === f.paths(a.id).record) published = true;
    return result;
  });
  mockFs(t, "fsyncSync", (original, fd) => {
    if (published) { published = false; throw new Error("injected post-record fsync failure"); }
    return original(fd);
  });
  await assert.rejects(f.step(a, { state: "executing", decision: "approved" }), /post-record fsync/);
  const disk = JSON.parse(fs.readFileSync(f.paths(a.id).record, "utf8")).record;
  assert.equal(disk.state, "executing"); assert.equal(disk.revision, 2);
  assert.equal((await f.read(a.id)).record.state, "recovery-required");
  await assert.rejects(f.step(disk, { state: "succeeded" }), /no longer live/);
  assert.equal(events.length, 1);
  assert.deepEqual(fs.readdirSync(f.paths(a.id).dir).sort(), ["candidate.json", "record.json"]);
});

test("failure saving the post-mutation outcome preserves prepared intent, not fictitious success", async (t) => {
  const f = fixture(t), a = await f.create();
  const executing = await f.step(a, { state: "executing", decision: "approved" });
  const prepared = await f.step(executing, { state: "executing", intended: result });
  const before = fs.readFileSync(f.paths(a.id).record), artifact = fs.readFileSync(f.paths(a.id).artifact);
  mockFs(t, "renameSync", () => { throw new Error("injected outcome write failure"); });
  await assert.rejects(f.step(prepared, { state: "succeeded", outcome: result }), /outcome write/);
  const history = await f.read(a.id);
  assert.equal(history.record.state, "recovery-required");
  assert.deepEqual(history.record.intended, result);
  assert.equal(history.record.outcome, undefined);
  assert.equal(history.record.decision, "approved");
  assert.deepEqual(fs.readFileSync(f.paths(a.id).record), before);
  assert.deepEqual(fs.readFileSync(f.paths(a.id).artifact), artifact);
  await assert.rejects(f.step(prepared, { state: "succeeded", outcome: result }), /no longer live/);
});

test("minimal origin-session updates, anchors and failing observers never affect mutation outcomes", async (t) => {
  const f = fixture(t), events = [], other = [];
  const stops = [subscribeGitActionUpdates("origin", () => { throw new Error("observer failed"); }),
    subscribeGitActionUpdates("origin", async () => { throw new Error("async observer failed"); }),
    subscribeGitActionUpdates("origin", (event) => { event.revision = -1; }),
    subscribeGitActionUpdates("origin", (event) => events.push(event)),
    subscribeGitActionUpdates("other", (event) => other.push(event))];
  t.after(() => stops.forEach((stop) => stop()));
  const a = await f.create(), b = await f.step(a, { state: "awaiting-decision" });
  const c = await f.step(b, { state: "executing", decision: "approved" });
  const d = await f.step(c, { state: "succeeded", outcome: result });
  emitGitActionAnchor("origin", { type: "git_action_update", actionId: a.id, revision: d.revision, entryId: "anchor-id", timestamp: 123 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [1, 2, 3, 4].map((revision) => ({ type: "git_action_update", actionId: a.id, revision }))
    .concat({ type: "git_action_update", actionId: a.id, revision: 4, entryId: "anchor-id", timestamp: 123 }));
  assert.deepEqual(other, []);
  assert.equal((await f.read(a.id)).record.state, "succeeded");
  assert.throws(() => emitGitActionAnchor("origin", { type: "git_action_update", actionId: a.id, revision: 4, candidate: f.snapshot() }), /Invalid/);
  stops.forEach((stop) => stop());
  emitGitActionAnchor("origin", { type: "git_action_update", actionId: a.id, revision: 4 });
  assert.equal(events.length, 5);
});

test("pure shared contract remains importable without server dependencies under Node type stripping", async () => {
  const types = await import("./git-action-types.ts");
  assert.equal(types.isGitActionAnchor({ version: 1, actionId: randomUUID() }), true);
  assert.equal(types.isTerminalGitAction("recovery-required"), true);
  assert.equal(types.isTerminalGitAction("executing"), false);
});
