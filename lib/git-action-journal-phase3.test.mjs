import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createGitAction, createGitActionWithId, transitionGitAction, readGitAction, releaseGitAction, GIT_ACTION_LIMITS } = await jiti.import("./git-action-journal.ts");
const { snapshotGitWorkspaceAction, snapshotGitPreparationAction, beginGitActionWithId, finishGitAction, finishVerifiedNativeGitAction,
  GitActionRecordingError, GitActionApplyError } = await jiti.import("./git-action-controller.ts");
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
    assert.doesNotMatch(fs.readFileSync(f.path(record.id, "candidate.json"), "utf8"), /not-authority|actionId|token/);
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
  const bytes = fs.readFileSync(f.path(id, "record.json"));
  await assert.rejects(createGitActionWithId(id, input, f.dir), /EEXIST/);
  assert.deepEqual(fs.readFileSync(f.path(id, "record.json")), bytes);
  for (const bad of ["../escape", id.toUpperCase(), id + "\n", "00000000-0000-0000-0000-000000000000"]) {
    await assert.rejects(createGitActionWithId(bad, input, f.dir), /Invalid/);
  }
  const incomplete = randomUUID();
  fs.mkdirSync(join(f.dir, "pi-web", "git-actions", "v1", incomplete));
  await assert.rejects(createGitActionWithId(incomplete, input, f.dir), /EEXIST/);
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
  assert.equal(history.record.state, "recovery-required");
  assert.deepEqual(history.record.intended, executing.intended);
  assert.equal(history.record.outcome, undefined);
});

test("legacy v1 bytes unchanged; malformed historical operation/result is conservatively missing", async (t) => {
  const f = fixture(t);
  for (const kind of ["commit", "review", "checks", "integration"]) {
    const candidate = { kind, repositoryRoot: "/repo" }, record = await f.create(candidate);
    const expected = `{"candidate":{"kind":"${kind}","repositoryRoot":"/repo"},"version":1}`;
    assert.equal(fs.readFileSync(f.path(record.id, "candidate.json"), "utf8"), expected);
    assert.equal(record.artifact.sha256, createHash("sha256").update(expected).digest("hex"));
  }
  const snapshot = workspace(), record = await f.create(snapshot);
  const executing = await f.step(record, { state: "executing" });
  const done = await f.step(executing, { state: "succeeded", outcome: outcome(snapshot) });
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  for (const changed of [{ ...done, outcome: { kind: "preparation", status: "prepared", preparation: outcome(preparation()).preparation } },
    { ...done, summary: { ...done.summary, workspace: { ...done.summary.workspace, unknown: true } } }]) {
    fs.writeFileSync(f.path(record.id, "record.json"), canonical({ version: 1, record: changed,
      sha256: createHash("sha256").update(canonical(changed)).digest("hex") }));
    assert.equal((await f.read(record.id)).record, null);
  }
});

function handle(kind, fail = false) {
  let record = { id: "id", kind, state: "executing", intended: { kind } };
  return { get record() { return record; }, async update(state, extra) { if (fail) throw new Error("record failed"); record = { ...record, state, ...extra }; }, release() {} };
}
test("controller accepts private verified result identity only; failures preserve known outcome or uncertainty", async () => {
  const snapshot = workspace(), facts = outcome(snapshot), registry = new WeakMap(), proof = {};
  registry.set(proof, { actionId: "id", outcome: facts });
  const read = (handle) => registry.get(handle);
  await assert.rejects(finishGitAction(handle("workspace"), facts), /independently verified/);
  for (const fake of [facts, structuredClone(proof)]) {
    const h = handle("workspace");
    await assert.rejects(finishVerifiedNativeGitAction(h, fake, read), GitActionApplyError);
    assert.equal(h.record.state, "recovery-required");
  }
  const wrongAction = {};
  registry.set(wrongAction, { actionId: "another-action", outcome: facts });
  await assert.rejects(finishVerifiedNativeGitAction(handle("workspace"), wrongAction, read), GitActionApplyError);
  const unavailable = handle("workspace");
  await assert.rejects(finishVerifiedNativeGitAction(unavailable, proof, () => { throw new Error("verification unavailable"); }), GitActionApplyError);
  assert.equal(unavailable.record.state, "recovery-required");
  const h = handle("workspace");
  await finishVerifiedNativeGitAction(h, proof, read);
  assert.equal(h.record.state, "succeeded");
  assert.equal(h.record.decision, undefined);
  await assert.rejects(finishVerifiedNativeGitAction(handle("workspace", true), proof, read), (error) => {
    assert.deepEqual(error.outcome, facts);
    return error instanceof GitActionRecordingError && /Do not retry/.test(error.message);
  });
});
