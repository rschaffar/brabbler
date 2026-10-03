import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const journal = await jiti.import("./git-action-journal.ts");
const controller = await jiti.import("./git-action-controller.ts");
const { projectNativeGitActionCandidate, projectGitActionUiCandidate, resolveNativeGitActionResponse, gitActionResponsePassesNativeGuard } = await jiti.import("./rpc-manager.git-ui.ts");
const oid = (char) => char.repeat(40), dig = (char) => char.repeat(64);
const instance = { device: "1", inode: "2", birthtime: "3" };
const resources = (cwd, branch, gitDir) => ({ projectRoot: "/repo", cwd, branch, commonDir: "/repo/.git", gitDir,
  identities: { project: instance, common: instance, checkout: { ...instance, inode: cwd === "/repo" ? "3" : "4" }, git: instance, marker: instance } });
const source = resources("/repo-worktrees/feature", "feature", "/repo/.git/worktrees/feature"), target = resources("/repo", "main", "/repo/.git");
const physical = (r) => ({ gitDir: r.gitDir, checkoutIdentity: r.identities.checkout, gitIdentity: r.identities.git, markerIdentity: r.identities.marker });
const flags = { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const savedRecipe = (stage) => ({ label: "Saved source tests", argv: ["npm", "test"], cwd: ".", env: { CI: "1" }, requiredStage: stage });
const cleanManifest = (stage) => ({ version: 2, checkoutPath: sha(source.cwd), checkoutIdentity: sha(JSON.stringify({ project: source.identities.project,
  checkout: source.identities.checkout, common: source.identities.common, git: source.identities.git, marker: source.identities.marker })),
  resourceIdentity: sha(source.commonDir + "\0" + JSON.stringify(source.identities.common)), branch: sha("refs/heads/feature"), head: sha(oid("a")), tree: sha(oid("b")),
  index: dig("7"), status: dig("8"), refs: dig("9"), policyDigest: dig("2"), policyRevision: sha("saved-source-revision"),
  recipeDigest: sha(JSON.stringify(savedRecipe(stage))), checkDigest: sha(JSON.stringify({ checkIndex: 7, recipe: savedRecipe(stage) })),
  cwdIdentity: sha(JSON.stringify({ cwd: source.cwd, ...source.identities.checkout })), environmentDigest: dig("4"), stageDigest: sha(stage) });
const binding = (stage = "commit") => ({ ...flags, evidenceScope: stage === "commit" ? "working-workspace" : "clean-checkout",
  sourceOid: oid("a"), sourceTreeOid: oid("b"), snapshotDigest: stage === "commit" ? dig("1") : sha(JSON.stringify(cleanManifest(stage))), policyDigest: dig("2"), policyRevision: "saved-source-revision",
  stage, requiredSavedIndexes: stage === "none" ? [] : [7] });
const checkSnapshot = (stage = "commit") => controller.snapshotGitCheckoutVerificationAction(source, { ...binding(stage), source: physical(source),
  checks: [{ checkIndex: 7, recipe: savedRecipe(stage), recipeDigest: stage === "commit" ? dig("3") : cleanManifest(stage).recipeDigest, environmentDigest: dig("4"), executionCwd: source.cwd,
    ...(stage === "commit" ? {} : { snapshot: cleanManifest(stage) }) }] });
const run = (id, stage = "commit") => ({ actionId: id, sessionId: "session", checkIndex: 7, stage, recipeDigest: stage === "commit" ? dig("3") : cleanManifest(stage).recipeDigest,
  policyDigest: dig("2"), snapshotDigest: binding(stage).snapshotDigest, environmentDigest: dig("4"),
  executionCwd: source.cwd, startedAt: 100, finishedAt: 200, unit: "pi-web-git-check-fixture.service", cgroupIdentity: "1:2", invocation: "f".repeat(32),
  exitStatus: 0, containmentComplete: true, timedOut: false, overflow: false, logDigest: dig("5"), logBytes: 10, receipt: { id: randomUUID(), sha256: dig("6"), expiresAt: 1000 } });
const checkOutcome = (id, stage = "commit") => ({ kind: "checkout-verification", status: "passed", checkoutVerification: { ...binding(stage), runs: [run(id, stage)] } });
const ignored = { path: "cache/output", kind: "file", ...instance, size: "12", mode: "33152", changed: "4", modified: "5" };
const cleanupSnapshot = (entries = [ignored]) => controller.snapshotGitCleanupAction(source, target, {
  featureOid: oid("a"), targetOid: oid("c"), mainOid: oid("c"), sourcePath: source.cwd, branchRef: "refs/heads/feature", targetPath: target.cwd, mainPath: target.cwd,
  source: physical(source), target: physical(target), main: physical(target),
  integration: { completedAt: 100, delivery: "selected-local", method: "merge", actualFF: false, featureOid: oid("a"), previousTargetOid: oid("b"), resultOid: oid("c"), resultTree: oid("d"), parents: [oid("b"), oid("a")] },
  provenance: { mode: "create", originalSourcePath: target.cwd, originalSource: physical(target), branchRef: "refs/heads/feature" },
  ignoredCount: entries.length, ignoredDeletion: entries.length ? "exact-approval-required" : "none", ignored: entries });
const cleanupBinding = (snapshot) => Object.fromEntries(["featureOid", "targetOid", "mainOid", "sourcePath", "branchRef", "targetPath", "mainPath"].map((key) => [key, snapshot.cleanup[key]]));
const removal = { kind: "worktree-removed", sourcePath: source.cwd, sourceIdentity: source.identities.checkout, adminPath: source.gitDir, featureOid: oid("a"), exit: 0,
  sourceAbsent: true, adminAbsent: true, beforeInventoryDigest: dig("1"), afterInventoryDigest: dig("2") };
const deletion = { kind: "branch-deleted", branchRef: "refs/heads/feature", deletedOid: oid("a"), transactionExit: 0, finalInventoryDigest: dig("3") };
function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-action-operations-")), ids = [];
  t.after(() => { ids.forEach((id) => journal.releaseGitAction(id, dir)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, async create(candidate, id = randomUUID()) { ids.push(id); return journal.createGitActionWithId(id, { sessionId: "session", source: "agent", candidate }, dir); },
    step: (record, patch) => journal.transitionGitAction(record.id, record.revision, patch, dir), read: (id) => journal.readGitAction(id, { includeArtifact: true }, dir) };
}
async function executeCheck(f, record, stage = "commit") {
  return f.step(record, { state: "executing", intended: { kind: "checkout-verification", checkoutVerification: { ...binding(stage), runs: [] } } });
}
async function executeCleanup(f, record, snapshot, decision = "approved") {
  return f.step(record, { state: "executing", ...(decision ? { decision } : {}), intended: { kind: "cleanup", cleanup: { ...cleanupBinding(snapshot), effects: [] } } });
}

test("distinct target-free check artifact/outcome retains actual metadata, no fake target/task/acknowledgement", async (t) => {
  const f = fixture(t), snapshot = checkSnapshot(), record = await f.create(snapshot);
  assert.equal(record.kind, "checkout-verification");
  assert.equal(record.summary.targetCheckoutRoot, undefined);
  const pending = await f.step(record, { state: "awaiting-decision" });
  const executing = await executeCheck(f, pending), facts = checkOutcome(record.id);
  const done = await f.step(executing, { state: "succeeded", outcome: facts });
  assert.equal(done.decision, undefined);
  const history = await f.read(done.id);
  assert.deepEqual(history.candidate, snapshot);
  assert.deepEqual(history.record.outcome.checkoutVerification.runs, facts.checkoutVerification.runs);
  assert.doesNotMatch(JSON.stringify(history), /targetCheckoutRoot|targetBranch|task|logContents|processEnv/);
  const ask = projectGitActionUiCandidate(projectNativeGitActionCandidate(record.id, snapshot));
  assert.deepEqual(ask.checkoutVerification.checks[0].recipe.env, { CI: "1" });
  assert.equal(ask.diff, undefined);
  assert.throws(() => controller.snapshotGitCheckoutVerificationAction(source, { ...snapshot.checkoutVerification,
    source: { ...physical(source), gitDir: "/foreign/.git" } }), /physical checkout/);
});

test("presettlement check progress stays executing; exact measurements survive published completion or quarantine", async (t) => {
  const f = fixture(t);
  for (const terminal of ["succeeded", "recovery-required"]) {
    const record = await f.create(checkSnapshot()), executing = await executeCheck(f, record), facts = checkOutcome(record.id);
    facts.checkoutVerification.runs[0].cgroupIdentity = `12:345:${facts.checkoutVerification.runs[0].invocation}:/user.slice/original-unit.service`;
    const progress = await f.step(executing, { state: "executing", outcome: facts });
    assert.equal(progress.state, "executing");
    assert.deepEqual((await f.read(record.id)).record.outcome, facts);
    assert.deepEqual(progress.intended, executing.intended);
    const outcome = { ...facts, status: terminal === "succeeded" ? "passed" : "partial-state" };
    const done = await f.step(progress, { state: terminal, outcome });
    assert.deepEqual(done.outcome.checkoutVerification.runs, facts.checkoutVerification.runs);
    assert.equal(done.outcome.checkoutVerification.runs[0].exitStatus, 0);
    if (terminal === "recovery-required") await assert.rejects(f.step(done, { state: "executing" }), /terminal/);
  }
});

test("executing check outcomes require prior intent and bound nonempty measured facts, not a general self-transition", async (t) => {
  const f = fixture(t), record = await f.create(checkSnapshot()), facts = checkOutcome(record.id);
  await assert.rejects(f.step(record, { state: "executing", intended: { kind: "checkout-verification", checkoutVerification: { ...binding(), runs: [] } }, outcome: facts }), /must follow/);
  const noIntent = await f.step(record, { state: "executing" });
  await assert.rejects(f.step(noIntent, { state: "executing", outcome: facts }), /must follow/);
  const other = await f.create(checkSnapshot()), executing = await executeCheck(f, other), good = checkOutcome(other.id);
  for (const extra of [{}, { reason: "no-op" }, { outcome: good, decision: "approved" }, { outcome: good, intended: executing.intended },
    { outcome: { ...good, status: "partial-state" } }, { outcome: { ...good, status: "executing" } },
    { outcome: { ...good, checkoutVerification: { ...good.checkoutVerification, runs: [] } } }]) {
    await assert.rejects(f.step(executing, { state: "executing", ...extra }));
  }
  for (const [key, value] of [["actionId", randomUUID()], ["sessionId", "foreign"], ["stage", "integration"], ["checkIndex", 11],
    ["recipeDigest", dig("a")], ["snapshotDigest", dig("a")], ["policyDigest", dig("a")], ["environmentDigest", dig("a")],
    ["executionCwd", "/foreign"], ["containmentComplete", false], ["log", "RAW_SECRET"], ["cgroupIdentity", "12:345:fake:/unit"]]) {
    const bad = structuredClone(good); bad.checkoutVerification.runs[0][key] = value;
    await assert.rejects(f.step(executing, { state: "executing", outcome: bad }));
  }
  const legacy = await journal.createGitAction({ sessionId: "session", source: "agent", candidate: { kind: "commit", repositoryRoot: source.cwd } }, f.dir);
  t.after(() => journal.releaseGitAction(legacy.id, f.dir));
  const running = await f.step(legacy, { state: "executing" });
  await assert.rejects(f.step(running, { state: "executing", outcome: { status: "committed", commit: oid("a") } }));
  assert.equal((await f.read(other.id)).record.revision, executing.revision);
});

test("check progress is append-only across saved indexes and never substitutes measurements at completion", async (t) => {
  const f = fixture(t), snapshot = checkSnapshot();
  snapshot.checkoutVerification.requiredSavedIndexes.push(8);
  snapshot.checkoutVerification.checks.push({ ...snapshot.checkoutVerification.checks[0], checkIndex: 8 });
  const record = await f.create(snapshot);
  const bound = { ...binding(), requiredSavedIndexes: [7, 8] };
  const executing = await f.step(record, { state: "executing", intended: { kind: "checkout-verification", checkoutVerification: { ...bound, runs: [] } } });
  const first = { kind: "checkout-verification", status: "passed", checkoutVerification: { ...bound, runs: [run(record.id)] } };
  const progress = await f.step(executing, { state: "executing", outcome: first });
  await assert.rejects(f.step(progress, { state: "executing", outcome: first }), /append/);
  await assert.rejects(f.step(progress, { state: "succeeded", outcome: first }), /incomplete passing/);
  const second = { ...first, checkoutVerification: { ...bound, runs: [...first.checkoutVerification.runs, { ...run(record.id), checkIndex: 8 }] } };
  for (const state of ["executing", "succeeded", "recovery-required"]) {
    const changed = structuredClone(second); changed.checkoutVerification.runs[0].unit = "pi-web-git-check-substitute.service";
    await assert.rejects(f.step(progress, { state, outcome: { ...changed, status: state === "recovery-required" ? "partial-state" : "passed" } }), /immutable/);
  }
  const more = await f.step(progress, { state: "executing", outcome: second });
  await assert.rejects(f.step(more, { state: "recovery-required", outcome: { ...first, status: "partial-state" } }), /immutable/);
  const done = await f.step(more, { state: "succeeded", outcome: second });
  assert.deepEqual(done.outcome.checkoutVerification.runs, second.checkoutVerification.runs);
});

test("stopped failed/cancelled check progress matches its terminal state without claiming passing evidence", async (t) => {
  const f = fixture(t);
  for (const status of ["failed", "cancelled"]) {
    const record = await f.create(checkSnapshot()), executing = await executeCheck(f, record), facts = checkOutcome(record.id);
    facts.status = status; delete facts.checkoutVerification.runs[0].receipt; facts.checkoutVerification.runs[0].exitStatus = 1;
    const progress = await f.step(executing, { state: "executing", outcome: facts });
    await assert.rejects(f.step(progress, { state: status === "failed" ? "cancelled" : "failed" }), /state mismatch/);
    await assert.rejects(f.step(progress, { state: "succeeded" }), /state mismatch/);
    const done = await f.step(progress, { state: status, outcome: facts });
    assert.equal(done.outcome.status, status);
    assert.equal(done.outcome.checkoutVerification.runs[0].receipt, undefined);
  }
});

test("native cgroup identity retains original dev/inode/invocation/ControlGroup, with strict bounds and legacy readability", async (t) => {
  const f = fixture(t), record = await f.create(checkSnapshot()), running = await executeCheck(f, record);
  const invocation = "A".repeat(32), group = "/user.slice/user-1000.slice/user@1000.service/app.slice/pi-web-git-check-fixture.service";
  const good = checkOutcome(record.id);
  good.checkoutVerification.runs[0].invocation = invocation;
  good.checkoutVerification.runs[0].cgroupIdentity = `12:345:${invocation}:${group}`;
  for (const identity of [`12:345:${"0".repeat(32)}:${group}`, `12:345:not-an-invocation:${group}`, `x:345:${invocation}:${group}`,
    `12:345:${invocation}:/`, `12:345:${invocation}:/user//unit`, `12:345:${invocation}:/user/../unit`,
    `12:345:${invocation}:/user/./unit`, `12:345:${invocation}:/unit/`, `12:345:${invocation}:/unit\\n`,
    `12:345:${invocation}:/unit with spaces`, `12:345:${invocation}:relative`, `12:345:${invocation}:/${"x".repeat(256)}`,
    `12:345:${"b".repeat(32)}:${group}`, `12:345:${invocation}:/${Array(40).fill("x".repeat(120)).join("/")}`]) {
    const bad = structuredClone(good); bad.checkoutVerification.runs[0].cgroupIdentity = identity;
    await assert.rejects(f.step(running, { state: "succeeded", outcome: bad }));
  }
  const done = await f.step(running, { state: "succeeded", outcome: good });
  assert.equal((await f.read(done.id)).record.outcome.checkoutVerification.runs[0].cgroupIdentity, good.checkoutVerification.runs[0].cgroupIdentity);
  assert.equal(done.outcome.checkoutVerification.runs[0].invocation, invocation);
  const old = await f.create(checkSnapshot()), oldRunning = await executeCheck(f, old), oldFacts = checkOutcome(old.id);
  const oldDone = await f.step(oldRunning, { state: "succeeded", outcome: oldFacts });
  assert.equal(oldDone.outcome.checkoutVerification.runs[0].cgroupIdentity, "1:2");
});

test("manual-only none-stage receipts are not integration prerequisites", async (t) => {
  const f = fixture(t), snapshot = checkSnapshot("none"), record = await f.create(snapshot);
  const executing = await executeCheck(f, record, "none");
  const done = await f.step(executing, { state: "succeeded", outcome: checkOutcome(record.id, "none") });
  assert.deepEqual(done.outcome.checkoutVerification.requiredSavedIndexes, []);
  await assert.rejects(f.create({ ...snapshot, checkoutVerification: { ...snapshot.checkoutVerification, requiredSavedIndexes: [7] } }), /manual-only/);
});

test("strict check candidates reject targets, secrets, unknown rows and oversize; actual outcomes reject foreign/mismatched facts", async (t) => {
  const f = fixture(t), snapshot = checkSnapshot();
  for (const candidate of [
    { ...snapshot, targetCheckoutRoot: "/fake" }, { ...snapshot, targetBranch: "main" }, { ...snapshot, checks: [] },
    { ...snapshot, checkoutVerification: { ...snapshot.checkoutVerification, candidateTreeVerified: true } },
    { ...snapshot, checkoutVerification: { ...snapshot.checkoutVerification, checks: Array(13).fill(snapshot.checkoutVerification.checks[0]) } },
    { ...snapshot, checkoutVerification: { ...snapshot.checkoutVerification, checks: [{ ...snapshot.checkoutVerification.checks[0], recipe: { label: "Secret", argv: ["npm"], requiredStage: "commit", env: { TOKEN: "secret" } } }] } },
    { ...snapshot, checkoutVerification: { ...snapshot.checkoutVerification, checks: [{ ...snapshot.checkoutVerification.checks[0], executionCwd: "/foreign" }] } },
  ]) await assert.rejects(f.create(candidate));
  const record = await f.create(snapshot), executing = await executeCheck(f, record), good = checkOutcome(record.id);
  for (const [key, value] of [["actionId", randomUUID()], ["sessionId", "foreign"], ["recipeDigest", dig("a")], ["snapshotDigest", dig("a")], ["policyDigest", dig("a")],
    ["environmentDigest", dig("a")], ["executionCwd", "/foreign"], ["checkIndex", 11], ["stage", "integration"], ["logBytes", 8 * 1024 * 1024 + 1], ["log", "secret"], ["payload", "prevented-before-write"], ["launcherIdentity", "pid-alone"]]) {
    const bad = structuredClone(good); bad.checkoutVerification.runs[0][key] = value;
    await assert.rejects(f.step(executing, { state: "succeeded", outcome: bad }));
  }
  for (const status of ["failed", "cancelled", "partial-state", "unknown"]) await assert.rejects(f.step(executing, { state: "succeeded", outcome: { ...good, status } }));
  const missing = structuredClone(good); delete missing.checkoutVerification.runs[0].receipt;
  await assert.rejects(f.step(executing, { state: "succeeded", outcome: missing }), /passing/);
  const wrongKind = { kind: "preparation", status: "prepared", preparation: { oldSourceOid: oid("a"), newSourceOid: oid("b"), targetMainOid: oid("c"), resultTreeOid: oid("d") } };
  await assert.rejects(f.step(executing, { state: "succeeded", outcome: wrongKind }), /kind mismatch/);
});

test("failed checks truthfully preserve stopped actual execution; uncontained/partial checks require recovery", async (t) => {
  const f = fixture(t), record = await f.create(checkSnapshot()), executing = await executeCheck(f, record), facts = checkOutcome(record.id);
  facts.status = "failed"; delete facts.checkoutVerification.runs[0].receipt; facts.checkoutVerification.runs[0].exitStatus = 1;
  const failed = await f.step(executing, { state: "failed", outcome: facts });
  assert.equal(failed.outcome.checkoutVerification.runs[0].exitStatus, 1);
  const other = await f.create(checkSnapshot()), running = await executeCheck(f, other), uncertain = checkOutcome(other.id);
  uncertain.status = "partial-state"; delete uncertain.checkoutVerification.runs[0].receipt; uncertain.checkoutVerification.runs[0].containmentComplete = false;
  const partial = await f.step(running, { state: "recovery-required", outcome: uncertain });
  assert.equal(partial.state, "recovery-required");
  await assert.rejects(f.step(partial, { state: "executing" }), /terminal/);
});

test("cleanup ignored inventory stays complete/lazy and needs exact approval, not generic Allow", async (t) => {
  const f = fixture(t), snapshot = cleanupSnapshot(), record = await f.create(snapshot);
  assert.equal(record.summary.cleanup.ignored, undefined);
  assert.equal(record.summary.cleanup.ignoredCount, 1);
  assert.deepEqual((await f.read(record.id)).candidate.cleanup.ignored, [ignored]);
  const ask = projectNativeGitActionCandidate(record.id, snapshot);
  assert.deepEqual(ask.cleanup.ignored, [ignored]);
  await assert.rejects(executeCleanup(f, record, snapshot, null), /exact ignored-data/);
  await assert.rejects(executeCleanup(f, record, snapshot, "reviewed"), /review decision/);
  for (const bad of [
    { ...snapshot, cleanup: { ...snapshot.cleanup, ignoredCount: 0 } },
    { ...snapshot, cleanup: { ...snapshot.cleanup, ignored: [{ ...ignored, path: "../secret" }] } },
    { ...snapshot, cleanup: { ...snapshot.cleanup, ignored: [{ ...ignored, contents: "secret" }] } },
    { ...snapshot, cleanup: { ...snapshot.cleanup, ignored: Array(2001).fill(ignored), ignoredCount: 2001 } },
    { ...snapshot, cleanup: { ...snapshot.cleanup, provenance: { ...snapshot.cleanup.provenance, mode: "attach" } } },
    { ...snapshot, cleanup: { ...snapshot.cleanup, integration: { ...snapshot.cleanup.integration, parents: [oid("b")] } } },
  ]) await assert.rejects(f.create(bad));
});

test("cleanup journals each measured effect monotonically, known OIDs and manual recovery; no retry", async (t) => {
  const f = fixture(t), snapshot = cleanupSnapshot(), record = await f.create(snapshot), executing = await executeCleanup(f, record, snapshot);
  const base = { ...cleanupBinding(snapshot), effects: [removal], ignoredDataDeletionApproved: true };
  const progress = await f.step(executing, { state: "executing", outcome: { kind: "cleanup", status: "worktree-removed", cleanup: base } });
  assert.equal(progress.outcome.cleanup.effects[0].featureOid, oid("a"));
  for (const change of [{ sourcePath: "/foreign" }, { featureOid: oid("f") }, { mainOid: oid("f") }]) await assert.rejects(f.step(progress,
    { state: "succeeded", outcome: { kind: "cleanup", status: "cleaned-up", cleanup: { ...base, ...change, effects: [removal, deletion], nativeHeadReflogMayHaveChanged: true } } }), /mismatch/);
  await assert.rejects(f.step(progress, { state: "recovery-required", outcome: { kind: "cleanup", status: "partial-state", cleanup: { ...base, effects: [] } } }), /immutable/);
  const partial = await f.step(progress, { state: "recovery-required", outcome: { kind: "cleanup", status: "partial-state", cleanup: { ...base, observedFeatureOid: oid("a") } } });
  assert.equal(partial.outcome.cleanup.effects.length, 1);
  assert.equal(partial.outcome.cleanup.observedFeatureOid, oid("a"));
  await assert.rejects(f.step(partial, { state: "executing" }), /terminal/);
  const next = await f.create(cleanupSnapshot([])), running = await executeCleanup(f, next, cleanupSnapshot([]), null);
  const done = await f.step(running, { state: "succeeded", outcome: { kind: "cleanup", status: "cleaned-up", cleanup: { ...cleanupBinding(cleanupSnapshot([])), effects: [removal, deletion], nativeHeadReflogMayHaveChanged: true } } });
  assert.equal(done.outcome.cleanup.effects.length, 2);
});

test("partial cleanup retains bounded actual recovery observations without inventing completed removal", async (t) => {
  const f = fixture(t), snapshot = cleanupSnapshot([]), record = await f.create(snapshot), running = await executeCleanup(f, record, snapshot, null);
  const recovery = { phase: "remove", removeAttempted: true, branchDeleteAttempted: false, childTerminationConfirmed: false,
    sourceAbsent: true, adminAbsent: null, featureRefAbsent: null, removeExit: null, transactionExit: null, leaseReleaseUncertain: true, checkoutGateRetained: true };
  const facts = { kind: "cleanup", status: "partial-state", cleanup: { ...cleanupBinding(snapshot), effects: [], recovery, observedFeatureOid: null } };
  await assert.rejects(f.step(running, { state: "recovery-required", outcome: { ...facts, cleanup: { ...facts.cleanup, recovery: { ...recovery, logs: "SECRET" } } } }));
  const final = await f.step(running, { state: "recovery-required", outcome: facts });
  assert.deepEqual(final.outcome.cleanup.recovery, recovery);
  assert.deepEqual(final.outcome.cleanup.effects, []);
  assert.equal((await f.read(final.id)).record.outcome.cleanup.observedFeatureOid, null);
  await assert.rejects(f.step(final, { state: "executing" }));
});

test("workspace optional parent disclosure and measured outcome match native shape; omission bytes remain compatible", async (t) => {
  const f = fixture(t), native = { actionId: randomUUID(), sourceOid: oid("a"), resultOid: oid("b"), treeOid: oid("c"), request: { mode: "create", repositoryPath: "/repo", sourceCheckoutPath: target.cwd,
    destinationPath: "/repo-worktrees/new", branch: "new", baseBranch: "main", expectedBaseOid: oid("b") } };
  const plan = { path: "/repo-worktrees", expectedAbsent: true, ancestorPath: "/", ancestorIdentity: instance, mode: 448 };
  const old = controller.snapshotGitWorkspaceAction(target, native);
  assert.equal(old.workspace.parentCreation, undefined);
  const snapshot = controller.snapshotGitWorkspaceAction(target, { ...native, parentCreation: plan }), record = await f.create(snapshot);
  assert.deepEqual(projectNativeGitActionCandidate(record.id, snapshot).workspace.parentCreation, plan);
  const facts = { kind: "workspace", status: "created", workspace: { mode: "create", destinationPath: native.request.destinationPath, branch: "new", tipOid: oid("b"), treeOid: oid("c") } };
  const executing = await f.step(record, { state: "executing", intended: { ...facts, status: undefined } });
  await assert.rejects(f.step(executing, { state: "succeeded", outcome: facts }), /parent creation outcome/);
  const measured = { path: plan.path, identity: instance, mode: 448, ownerUid: 1000, ancestorPath: plan.ancestorPath, ancestorIdentity: instance };
  const good = { ...facts, workspace: { ...facts.workspace, parentCreated: true, knownParentCreation: measured } };
  await assert.rejects(f.step(executing, { state: "succeeded", outcome: { ...good, workspace: { ...good.workspace, knownParentCreation: { ...measured, path: "/different" } } } }), /measurement mismatch/);
  const done = await f.step(executing, { state: "succeeded", outcome: good });
  assert.deepEqual(done.outcome.workspace.knownParentCreation, measured);
  const other = await f.create(snapshot), running = await f.step(other, { state: "executing", intended: { ...facts, status: undefined } });
  const uncertain = { ...facts, status: "partial-state", workspace: { ...facts.workspace, phase: "create-parent", parentCreationAttempted: true,
    parentCreated: true, addAttempted: false, observedBranchOid: null, destinationPresent: false } };
  const recovery = await f.step(running, { state: "recovery-required", outcome: uncertain });
  assert.equal(recovery.outcome.workspace.parentCreated, true);
  assert.equal(recovery.outcome.workspace.knownParentCreation, undefined);
  assert.equal(recovery.outcome.workspace.observedBranchOid, null);
  assert.equal(recovery.outcome.workspace.destinationPresent, false);
  const oldRecord = await f.create(old), oldExecuting = await f.step(oldRecord, { state: "executing" });
  const oldDone = await f.step(oldExecuting, { state: "succeeded", outcome: facts });
  assert.equal(oldDone.outcome.workspace.parentCreated, undefined);
});

test("commit evidence is explicitly working-workspace with actual receipts/digests; foreign or none-stage cannot satisfy required indexes", async (t) => {
  const f = fixture(t), actual = run(randomUUID()), evidence = { ...flags, requiredSavedIndexes: [7], runs: [actual] };
  const candidate = { kind: "commit", repositoryRoot: source.cwd, workingWorkspaceVerification: evidence };
  const record = await journal.createGitAction({ sessionId: "session", source: "agent", candidate }, f.dir);
  t.after(() => journal.releaseGitAction(record.id, f.dir));
  assert.deepEqual(record.summary.workingWorkspaceVerification, evidence);
  for (const change of [{ evidenceScope: "candidate-tree" }, { repositoryChecksWaived: true }, { candidateTreeVerified: true },
    { runs: [{ ...actual, sessionId: "foreign" }] }, { runs: [{ ...actual, executionCwd: "/foreign" }] }, { runs: [{ ...actual, stage: "none" }] }]) {
    await assert.rejects(journal.createGitAction({ sessionId: "session", source: "agent", candidate: { ...candidate, workingWorkspaceVerification: { ...evidence, ...change } } }, f.dir));
  }
});

test("binary/unavailable immutable artifacts stay patch-free in live projections; verification/cleanup never accept patches", async (t) => {
  const f = fixture(t), native = { actionId: randomUUID(), sourceOid: oid("a"), resultOid: oid("b"), treeOid: oid("c"), request: { mode: "create", repositoryPath: "/repo", sourceCheckoutPath: target.cwd,
    destinationPath: "/repo-worktrees/new", branch: "new", baseBranch: "main", expectedBaseOid: oid("b") } };
  const base = controller.snapshotGitWorkspaceAction(target, native), candidate = { ...base, diff: { fromTreeOid: oid("a"), toTreeOid: oid("c"), patch: "diff --git a/image b/image\nBinary files a/image and b/image differ\n", hasBinaryChanges: true } };
  const record = await f.create(candidate), history = await f.read(record.id);
  assert.equal(history.candidate.diff.hasBinaryChanges, true);
  assert.deepEqual(history.candidate.diff, candidate.diff);
  assert.equal(projectNativeGitActionCandidate(record.id, candidate).diff, undefined);
  const unavailable = { ...base, diffUnavailable: "Binary patch not captured" }, old = await f.create(unavailable);
  assert.equal((await f.read(old.id)).candidate.diffUnavailable, unavailable.diffUnavailable);
  assert.equal(projectNativeGitActionCandidate(old.id, unavailable).diffUnavailable, undefined);
  for (const snapshot of [checkSnapshot(), cleanupSnapshot()]) await assert.rejects(f.create({ ...snapshot, diff: candidate.diff }));
});

test("native response reducer requires the actual live request identity and exact boolean approval, never historical IDs/Allow/extras", () => {
  for (const snapshot of [checkSnapshot(), cleanupSnapshot()]) {
    const request = { type: "extension_ui_request", method: "git_action", id: "actual-pending-request", candidate: projectNativeGitActionCandidate(randomUUID(), snapshot) };
    const response = { type: "extension_ui_response", id: request.id, confirmed: true };
    assert.equal(resolveNativeGitActionResponse(request, response), true);
    assert.equal(resolveNativeGitActionResponse(request, { ...response, confirmed: false }), false);
    assert.equal(resolveNativeGitActionResponse(request, { type: response.type, id: request.id, cancelled: true }), false);
    for (const bad of [{ ...response, id: request.candidate.actionId }, { ...response, confirmed: "true" }, { ...response, permission: "Allow" },
      { ...response, approvePlanId: "history" }, { ...response, cancelled: true }, { ...response, actionId: request.candidate.actionId },
      { ...response, ignoredDataDeletionApproved: true }, Object.create(response)]) {
      assert.equal(resolveNativeGitActionResponse(request, bad), undefined);
      assert.equal(gitActionResponsePassesNativeGuard(request, bad), false);
    }
    assert.equal(gitActionResponsePassesNativeGuard(request, response), true);
  }
  assert.equal(gitActionResponsePassesNativeGuard({ method: "git_action", id: "old", candidate: { kind: "integration" } }, { approvePlanId: "v1" }), true);
});

test("only identity-registered actual native completion/removal handles can write outcomes", async () => {
  const id = randomUUID(), facts = { kind: "cleanup", status: "worktree-removed", cleanup: { ...cleanupBinding(cleanupSnapshot([])), effects: [removal] } };
  let record = { id, kind: "cleanup", state: "executing" };
  const handle = { get record() { return record; }, async update(state, extra) { record = { ...record, state, ...extra }; }, release() {} };
  const registry = new WeakMap(), actualNativeHandle = {};
  registry.set(actualNativeHandle, { actionId: id, outcome: facts });
  await assert.rejects(controller.recordVerifiedCleanupRemoval(handle, structuredClone(actualNativeHandle), (handle) => registry.get(handle)), controller.GitActionApplyError);
  record = { id, kind: "cleanup", state: "executing" };
  await controller.recordVerifiedCleanupRemoval(handle, actualNativeHandle, (handle) => registry.get(handle));
  assert.equal(record.outcome.status, "worktree-removed");
  await assert.rejects(controller.finishGitAction(handle, facts, true), /actual-native/);
  const withSecrets = {}, secretFacts = { ...facts, cleanup: { ...facts.cleanup, logs: "SECRET_RAW_DIAGNOSTICS" } };
  registry.set(withSecrets, { actionId: id, outcome: secretFacts });
  record = { id, kind: "cleanup", state: "executing" };
  await assert.rejects(controller.recordVerifiedCleanupRemoval(handle, withSecrets, (handle) => registry.get(handle)), (error) => {
    assert.equal(error.outcome, undefined);
    assert.doesNotMatch(JSON.stringify(controller.gitActionFailureResult(error)), /SECRET_RAW_DIAGNOSTICS/);
    return error instanceof controller.GitActionApplyError;
  });
});
