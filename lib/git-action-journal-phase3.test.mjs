import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { canonical, writeLegacyGitActionFixture } from "./git-action-legacy-fixture.mjs";

const jiti = createJiti(import.meta.url);
const { createGitAction, createGitActionWithId, transitionGitAction, readGitAction, releaseGitAction, captureGitActionRecord, advanceGitActionRecord, GIT_ACTION_LIMITS } = await jiti.import("./git-action-journal.ts");
const { snapshotGitWorkspaceAction, snapshotGitPreparationAction, beginGitActionWithId, finishGitAction, finishVerifiedNativeGitAction,
  GitActionApplyError } = await jiti.import("./git-action-controller.ts");
const oid = (c) => c.repeat(40);
const identity = { device: "1", inode: "2", birthtime: "3" };
const source = { projectRoot: "/repo", cwd: "/repo-worktrees/source", branch: "feature", commonDir: "/repo/.git", gitDir: "/repo/.git/worktrees/source",
  identities: { common: identity, project: identity, checkout: identity, git: identity, marker: { ...identity, changed: "4", size: "5" } } };
const target = { ...source, cwd: "/repo", branch: "main", gitDir: "/repo/.git" };
const workspaceCandidate = (mode = "create") => ({ actionId: "not-authority", sourceOid: oid("a"), resultOid: oid("b"), treeOid: oid("c"),
  request: { mode, repositoryPath: "/repo", sourceCheckoutPath: source.cwd, destinationPath: "/repo-worktrees/new", branch: "new", baseBranch: "main",
    expectedBaseOid: oid("b"), ...(mode === "attach" ? { expectedTipOid: oid("b") } : {}) } });
const preparationCandidate = { status: "candidate", oldSourceOid: oid("a"), newSourceOid: oid("b"), targetOid: oid("c"),
  comparison: { commits: [{ oldOid: oid("a"), newOid: oid("b"), oldTreeOid: oid("d"), newTreeOid: oid("e"), emptyAfterReplay: true }] } };
const workspace = (mode) => snapshotGitWorkspaceAction(source, workspaceCandidate(mode));
const preparation = () => snapshotGitPreparationAction(source, target, preparationCandidate, oid("e"));
const outcome = (snapshot) => snapshot.kind === "workspace" ? { kind: "workspace", status: snapshot.workspace.mode === "create" ? "created" : "attached",
  workspace: { mode: snapshot.workspace.mode, destinationPath: snapshot.workspace.destinationPath, branch: snapshot.workspace.branch, tipOid: snapshot.workspace.tipOid, treeOid: oid("c") } }
  : { kind: "preparation", status: "prepared", preparation: Object.fromEntries(["oldSourceOid", "newSourceOid", "targetMainOid", "resultTreeOid"].map((key) => [key, snapshot.preparation[key]])) };
function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-history-phase3-")), ids = [];
  t.after(() => { ids.forEach((id) => releaseGitAction(id, dir)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, create: async (candidate) => { const value = await createGitAction({ sessionId: "s", source: "agent", candidate }, dir); ids.push(value.id); return value; },
    step: (value, patch) => transitionGitAction(value.id, value.revision, patch, dir),
    read: (id) => readGitAction(id, { includeArtifact: true }, dir),
    path: (id, file) => join(dir, "pi-web", "git-actions", "v1", id, file) };
}

test("create/attach capture exact local base, destination and intended full tip without tokens", async (t) => {
  const f = fixture(t);
  for (const mode of ["create", "attach"]) {
    const snapshot = workspace(mode), record = await f.create(snapshot);
    assert.deepEqual((await f.read(record.id)).candidate, snapshot);
    assert.equal(record.summary.resourceAttribution.version, 2);
    assert.equal(record.summary.workspace.baseOid, oid("b"));
    assert.equal(record.summary.workspace.tipOid, oid("b"));
    assert.equal(record.summary.workspace.treeOid, workspaceCandidate(mode).treeOid);
    assert.doesNotMatch(JSON.stringify((await f.read(record.id)).candidate), /not-authority|actionId|token/);
    const executing = await f.step(record, { state: "executing" });
    const done = await f.step(executing, { state: "succeeded", outcome: outcome(snapshot) });
    assert.equal(done.decision, undefined, "none is not fabricated human approval");
  }
});

test("workspace completion and intent must match mode/destination/branch/tip/tree, including valid wrong trees", async (t) => {
  const f = fixture(t), snapshot = workspace(), record = await f.create(snapshot);
  const executing = await f.step(record, { state: "executing" });
  const good = outcome(snapshot);
  for (const [key, value] of [["mode", "attach"], ["destinationPath", "/different"], ["branch", "different"], ["tipOid", oid("e")], ["treeOid", oid("f")]]) {
    const mismatch = { ...good, workspace: { ...good.workspace, [key]: value } };
    await assert.rejects(f.step(executing, { state: "succeeded", outcome: mismatch }), /workspace result mismatch/);
    await assert.rejects(f.step(executing, { state: "executing", intended: mismatch }), /workspace result mismatch/);
  }
  const done = await f.step(executing, { state: "succeeded", outcome: good });
  const history = await f.read(done.id);
  assert.equal(history.candidate.workspace.treeOid, good.workspace.treeOid);
  assert.equal(history.record.summary.workspace.treeOid, good.workspace.treeOid);
  assert.equal(history.record.outcome.workspace.treeOid, good.workspace.treeOid);
});

test("trusted native UUID correlation is exclusive, including races and incomplete prior creation; raw schema unchanged", async (t) => {
  const f = fixture(t), candidate = workspace(), id = randomUUID();
  const input = { sessionId: "s", source: "agent", candidate };
  t.after(() => releaseGitAction(id, f.dir));
  const results = await Promise.allSettled([createGitActionWithId(id, input, f.dir), createGitActionWithId(id, input, f.dir)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await f.read(id)).record.id, id);
  const before = await f.read(id);
  await assert.rejects(createGitActionWithId(id, input, f.dir), /already live/);
  assert.deepEqual(await f.read(id), before);
  for (const bad of ["../escape", id.toUpperCase(), id + "\n", "00000000-0000-0000-0000-000000000000"]) {
    await assert.rejects(createGitActionWithId(bad, input, f.dir), /Invalid/);
  }
  const incomplete = randomUUID();
  fs.mkdirSync(join(f.dir, "pi-web", "git-actions", "v1", incomplete), { recursive: true, mode: 0o700 });
  const fresh = await createGitActionWithId(incomplete, input, f.dir);
  assert.equal(fresh.state, "proposed", "old incomplete storage is not admission");
  assert.deepEqual(fs.readdirSync(join(f.dir, "pi-web", "git-actions", "v1", incomplete)), []);
  releaseGitAction(incomplete, f.dir);
  await assert.rejects(createGitAction({ ...input, recordId: randomUUID() }, f.dir), /Invalid/);
  await assert.rejects(createGitActionWithId(randomUUID(), { ...input, candidate: { kind: "commit", repositoryRoot: "/repo" } }, f.dir), /Invalid/);
  const nativeId = randomUUID(), native = { ...workspaceCandidate(), actionId: nativeId }, appended = [];
  const handle = await beginGitActionWithId(native.actionId, { sessionId: "s", append(record) { appended.push(record.id); return { entryId: "anchor", timestamp: record.createdAt }; } },
    "agent", snapshotGitWorkspaceAction(source, native), f.dir);
  t.after(() => handle.release());
  assert.equal(handle.record.id, native.actionId);
  assert.deepEqual(appended, [native.actionId]);
  await handle.update("blocked", { reason: "No native operation in this disposable fixture." });
  assert.equal((await f.read(nativeId)).record.state, "blocked");
});

test("preparation mapping and empty retention are immutable artifact-only data with physical identities", async (t) => {
  const f = fixture(t), snapshot = preparation(), record = await f.create(snapshot);
  assert.equal(record.summary.preparation.commitCount, 1);
  assert.equal(record.summary.preparation.commitMapping, undefined);
  assert.equal(record.summary.preparation.emptyRetention, "keep");
  assert.deepEqual((await f.read(record.id)).candidate, snapshot);
  preparationCandidate.comparison.commits[0].emptyAfterReplay = false;
  assert.equal((await f.read(record.id)).candidate.preparation.commitMapping[0].emptyAfterReplay, true);
  preparationCandidate.comparison.commits[0].emptyAfterReplay = true;
  const executing = await f.step(record, { state: "executing", intended: { ...outcome(snapshot), status: undefined } });
  const done = await f.step(executing, { state: "succeeded", outcome: outcome(snapshot) });
  assert.equal(done.decision, undefined);
  assert.deepEqual(done.outcome.preparation, outcome(snapshot).preparation);
});

test("already-prepared no-op and optional immutable patches retain their exact captured meaning", async (t) => {
  const f = fixture(t);
  const candidate = { ...preparationCandidate, status: "already-prepared", newSourceOid: preparationCandidate.oldSourceOid,
    comparison: { commits: [] } };
  const snapshot = snapshotGitPreparationAction(source, target, candidate, oid("e"));
  const record = await f.create(snapshot), executing = await f.step(record, { state: "executing" });
  const facts = { ...outcome(snapshot), status: "already-prepared" };
  const done = await f.step(executing, { state: "succeeded", outcome: facts });
  assert.equal(done.outcome.preparation.oldSourceOid, done.outcome.preparation.newSourceOid);
  assert.equal(done.summary.preparation.commitCount, 0);
  assert.deepEqual((await f.read(done.id)).candidate.preparation.commitMapping, []);
  const diff = { fromTreeOid: oid("d"), toTreeOid: oid("e"), patch: "captured immutable patch", hasBinaryChanges: false };
  const captured = await f.create(snapshotGitPreparationAction(source, target, preparationCandidate, oid("e"), diff));
  diff.patch = "later data";
  assert.equal((await f.read(captured.id)).candidate.diff.patch, "captured immutable patch");
  assert.equal(captured.summary.diff, undefined);
  await assert.rejects(f.create({ ...preparation(), diff: { ...diff, toTreeOid: oid("f") } }), /diff tree mismatch/);
});

test("new metadata rejects unknown keys, cross-kind fields, incomplete attribution and unbounded mappings", async (t) => {
  const f = fixture(t), w = workspace(), p = preparation();
  const invalid = [
    { ...w, preparation: p.preparation }, { ...w, workspace: undefined }, { ...w, resourceAttribution: undefined },
    { ...w, workspace: { ...w.workspace, token: "bad" } }, { ...w, workspace: { ...w.workspace, destinationPath: "relative" } },
    { ...w, workspace: { ...w.workspace, tipOid: "short" } }, { ...w, workspace: { ...w.workspace, tipOid: oid("f") } },
    { ...w, message: "not this kind" }, { kind: "commit", repositoryRoot: "/repo", workspace: w.workspace },
    { ...p, targetCheckoutRoot: undefined }, { ...p, preparation: { ...p.preparation, emptyRetention: "drop" } },
    { ...p, preparation: { ...p.preparation, commitCount: 2 } }, { ...p, preparation: { ...p.preparation, commitMapping: undefined } },
    { ...p, preparation: { ...p.preparation, source: { ...p.preparation.source, extra: true } } },
    { ...p, preparation: { ...p.preparation, commitMapping: [{ ...p.preparation.commitMapping[0], extra: true }] } },
    { ...p, preparation: { ...p.preparation, commitMapping: Array(GIT_ACTION_LIMITS.commitMapping + 1).fill(p.preparation.commitMapping[0]) } },
    { ...p, preparation: { ...p.preparation, commitMapping: [p.preparation.commitMapping[0], p.preparation.commitMapping[0]], commitCount: 2 } },
  ];
  for (const candidate of invalid) await assert.rejects(f.create(candidate), /Invalid/);
});

test("success needs executing plus matching outcome; partial results require recovery, not blind retry", async (t) => {
  const f = fixture(t);
  for (const snapshot of [workspace(), preparation()]) {
    const record = await f.create(snapshot), good = outcome(snapshot);
    await assert.rejects(f.step(record, { state: "succeeded", outcome: good }), /Illegal/);
    await assert.rejects(f.step(record, { state: "executing", decision: "reviewed" }), /mutation review/);
    const pending = await f.step(record, { state: "awaiting-decision" });
    await assert.rejects(f.step(pending, { state: "succeeded", outcome: good }), /Illegal/);
    const executing = await f.step(pending, { state: "executing", decision: "approved" });
    for (const bad of [undefined, {}, outcome(snapshot.kind === "workspace" ? preparation() : workspace()),
      { ...good, status: "unknown" }, { ...good, status: "partial-state" }, { ...good, token: "bad" }]) {
      await assert.rejects(f.step(executing, { state: "succeeded", ...(bad ? { outcome: bad } : {}) }), /Invalid/);
    }
    const mismatch = structuredClone(good);
    if (mismatch.workspace) mismatch.workspace.destinationPath = "/different";
    else mismatch.preparation.newSourceOid = oid("f");
    await assert.rejects(f.step(executing, { state: "succeeded", outcome: mismatch }), /mismatch/);
    const partial = await f.step(executing, { state: "recovery-required", outcome: { ...good, status: "partial-state" }, reason: "Manual recovery; do not retry." });
    assert.equal(partial.state, "recovery-required");
    await assert.rejects(f.step(partial, { state: "executing" }), /terminal/);
  }
});

test("pre-native cancelled/refused/stale stays definite; interrupted execution retains known OIDs", async (t) => {
  const f = fixture(t);
  for (const state of ["cancelled", "blocked", "expired"]) {
    const record = await f.create(workspace());
    const done = await f.step(record, { state, reason: "Before native operation." });
    assert.equal((await f.read(done.id)).record.state, state);
    assert.equal(done.outcome, undefined);
  }
  const snapshot = preparation(), record = await f.create(snapshot);
  const executing = await f.step(record, { state: "executing", intended: outcome(snapshot) });
  releaseGitAction(record.id, f.dir);
  const history = await f.read(record.id);
  assert.deepEqual(executing.intended, outcome(snapshot));
  assert.equal(history.record, null, "unfinished memory is not falsely claimed durable");
  assert.match(history.unavailable, /unavailable/);
});

test("legacy v1 bytes unchanged; malformed historical operation/result is conservatively missing", async (t) => {
  const f = fixture(t);
  for (const kind of ["commit", "review", "checks", "integration"]) {
    const candidate = { kind, repositoryRoot: "/repo" }, { record } = captureGitActionRecord({ sessionId: "s", source: "agent", candidate });
    writeLegacyGitActionFixture(f.dir, record, candidate);
    const expected = `{"candidate":{"kind":"${kind}","repositoryRoot":"/repo"},"version":1}`;
    assert.equal(fs.readFileSync(f.path(record.id, "candidate.json"), "utf8"), expected);
    assert.equal(record.artifact.sha256, createHash("sha256").update(expected).digest("hex"));
  }
  const snapshot = workspace(), { record } = captureGitActionRecord({ sessionId: "s", source: "agent", candidate: snapshot });
  const executing = advanceGitActionRecord(record, snapshot, { state: "executing" });
  const done = advanceGitActionRecord(executing, snapshot, { state: "succeeded", outcome: outcome(snapshot) });
  writeLegacyGitActionFixture(f.dir, done, snapshot);
  for (const changed of [{ ...done, outcome: { kind: "preparation", status: "prepared", preparation: outcome(preparation()).preparation } },
    { ...done, summary: { ...done.summary, workspace: { ...done.summary.workspace, unknown: true } } }]) {
    fs.writeFileSync(f.path(record.id, "record.json"), canonical({ version: 1, record: changed,
      sha256: createHash("sha256").update(canonical(changed)).digest("hex") }));
    assert.equal((await f.read(record.id)).record, null);
  }
});

test("caller-supplied private WeakMaps and callbacks cannot issue native success", async (t) => {
  const f = fixture(t), snapshot = workspace(), facts = outcome(snapshot);
  for (const fake of [facts, {}, structuredClone(facts)]) {
    const h = await beginGitActionWithId(randomUUID(), { sessionId: "s", append: () => ({ entryId: "fixture", timestamp: 1 }) }, "agent", snapshot, f.dir);
    t.after(() => h.release());
    await h.update("executing");
    const registry = new WeakMap([[fake, { actionId: h.record.id, outcome: facts }]]);
    let called = false;
    await assert.rejects(finishGitAction(h, facts), /independently verified/);
    await assert.rejects(finishVerifiedNativeGitAction(h, fake, value => { called = true; return registry.get(value); }), GitActionApplyError);
    assert.equal(called, false);
    assert.equal(h.record.state, "recovery-required");
    assert.equal(h.record.outcome, undefined);
    await assert.rejects(finishVerifiedNativeGitAction({ ...h }, fake), /Original live/);
  }
  // Positive native identity + storage fault coverage uses an actual disposable
  // Git workspace operation in git-action-controller.test.mjs, not this fake map.
});
