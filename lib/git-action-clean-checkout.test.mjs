import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Native dependency capture now measures user ignore/config inputs as well.
// Never inspect developer/live HOME data or relax physical-input validation.
const isolatedHome = fs.mkdtempSync(join(tmpdir(), "pi-history-clean-config-"));
const priorEnvironment = new Map(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map(key => [key, process.env[key]]));
Object.assign(process.env, { HOME: isolatedHome, XDG_CONFIG_HOME: isolatedHome, PI_CODING_AGENT_DIR: isolatedHome });
after(() => {
  for (const [key, value] of priorEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url);
const journal = await jiti.import("./git-action-journal.ts");
const controller = await jiti.import("./git-action-controller.ts");
const native = await jiti.import("./git-checkout-verification.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { normalizeGitCheckRecipe } = await jiti.import("./git-check-recipe.ts");
const { gitExecEnv } = await jiti.import("./git-exec.ts");
const { sanitizeProjectCommandEnvironment } = await jiti.import("./project-command-env.ts");
const ui = await jiti.import("./rpc-manager.git-ui.ts");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const digest = (v) => sha(JSON.stringify(v));
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8" }).trim();
const limits = { candidateTreeVerified: false, repositoryChecksWaived: false };

async function fixture(t, stage = "integration", cohort = false) {
  const home = fs.mkdtempSync(join(tmpdir(), "pi-history-clean-v2-")), cwd = join(home, "source"), agentDir = join(home, "agent");
  fs.mkdirSync(cwd); fs.mkdirSync(agentDir, { mode: 0o700 });
  git(cwd, "init", "-qb", "feature"); fs.writeFileSync(join(cwd, "a"), "source\n");
  fs.mkdirSync(join(cwd, "tests")); fs.writeFileSync(join(cwd, "tests", "b"), "subdirectory\n");
  git(cwd, "add", "."); git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  allowFileRoot(cwd);
  const source = await selectGitProjectResources(cwd), live = [];
  t.after(() => { live.forEach((id) => journal.releaseGitAction(id, agentDir)); fs.rmSync(home, { recursive: true, force: true }); });
  const rows = [];
  for (const checkIndex of cohort ? [1, 4] : [1]) {
    // Absence of explicit integration/cwd/env defaults is deliberately retained
    // in the recipe digest. No execution or native receipt is fabricated here.
    const recipe = checkIndex === 1 ? { label: "Saved clean check", argv: [process.execPath, "--version"], ...(stage === "integration" ? {} : { requiredStage: stage }) }
      : { label: "Saved subdirectory check", argv: [process.execPath, "--version"], cwd: "tests", env: { ZZ: "1", AA: "2" }, requiredStage: stage };
    const env = sanitizeProjectCommandEnvironment({ ...gitExecEnv(), ...normalizeGitCheckRecipe(recipe).env });
    const environmentDigest = digest(Object.entries(env).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
    const binding = { recipe, checkIndex, stage, policyDigest: "2".repeat(64), policyRevision: "saved-source-policy", environmentDigest };
    const snapshot = await native.captureGitCheckoutCheckRecoverySnapshot(source, binding, true);
    assert.equal(snapshot.version, 2);
    rows.push({ checkIndex, recipe, recipeDigest: snapshot.recipeDigest, environmentDigest, executionCwd: join(cwd, recipe.cwd ?? "."), snapshot });
  }
  const bound = { evidenceScope: "clean-checkout", ...limits, stage, requiredSavedIndexes: stage === "none" ? [] : rows.map((r) => r.checkIndex),
    sourceOid: git(cwd, "rev-parse", "HEAD^{commit}"), sourceTreeOid: git(cwd, "rev-parse", "HEAD^{tree}"), snapshotDigest: digest(rows[0].snapshot),
    policyDigest: "2".repeat(64), policyRevision: "saved-source-policy" };
  const details = { ...bound, source: { gitDir: source.gitDir, checkoutIdentity: source.identities.checkout,
    gitIdentity: source.identities.git, markerIdentity: source.identities.marker }, checks: rows };
  const candidate = controller.snapshotGitCheckoutVerificationAction(source, details);
  return { source, bound, details, candidate, agentDir, rows,
    async create(value = candidate) { const record = await journal.createGitActionWithId(randomUUID(), { sessionId: "session", source: "agent", candidate: value }, agentDir); live.push(record.id); return record; },
    step: (r, patch) => journal.transitionGitAction(r.id, r.revision, patch, agentDir),
    read: (id) => journal.readGitAction(id, { includeArtifact: true }, agentDir) };
}
// Inert measured-history test rows only. They are NOT registered native objects
// and cannot mint live receipt/operation capabilities via any public binding.
function measured(id, row, stage) {
  const invocation = "f".repeat(32);
  return { actionId: id, sessionId: "session", checkIndex: row.checkIndex, stage, recipeDigest: row.recipeDigest,
    policyDigest: row.snapshot.policyDigest, snapshotDigest: digest(row.snapshot), environmentDigest: row.environmentDigest, executionCwd: row.executionCwd,
    startedAt: 100, finishedAt: 200, unit: "pi-web-clean-history-fixture.service", cgroupIdentity: `12:345:${invocation}:/user.slice/history-fixture.service`, invocation,
    exitStatus: 0, containmentComplete: true, timedOut: false, overflow: false, logDigest: "5".repeat(64), logBytes: 0,
    receipt: { id: randomUUID(), sha256: "6".repeat(64), expiresAt: 1000 } };
}

test("actual physical native v2 captures retain exact recipe/manifest digests and honest source-only scopes", async (t) => {
  for (const stage of ["integration", "handoff", "none"]) {
    const f = await fixture(t, stage), record = await f.create(), history = await f.read(record.id);
    assert.deepEqual(history.candidate, f.candidate);
    assert.deepEqual(history.candidate.checkoutVerification.checks[0].snapshot, f.rows[0].snapshot);
    assert.equal(history.record.summary.checkoutVerification.evidenceScope, "clean-checkout");
    assert.equal(history.record.summary.checkoutVerification.candidateTreeVerified, false);
    assert.equal(history.record.summary.checkoutVerification.repositoryChecksWaived, false);
    assert.equal(f.rows[0].recipeDigest, digest(f.rows[0].recipe));
    assert.doesNotMatch(JSON.stringify(history), /targetPath|targetBranch|featurePath|workspaceManifestVersion|workingWorkspaceVerification|reviewToken|approvePlanId/);
    assert.equal(native.lookupGitCheckoutVerificationReceipt(record.id), undefined);
  }
});

test("scoped dependency history preserves version and exact refs without upgrading legacy metadata", async (t) => {
  const f = await fixture(t);
  const snapshot = f.candidate.checkoutVerification.checks[0].snapshot;
  assert.equal(snapshot.dependencyVersion, 2);
  assert.deepEqual(snapshot.relevantRefs, ["refs/heads/feature"]);
  const modern = await f.create();
  assert.deepEqual((await f.read(modern.id)).candidate.checkoutVerification.checks[0].snapshot, snapshot);

  // Historical display data only: deliberately no registered execution/receipt.
  const legacy = structuredClone(f.candidate), old = legacy.checkoutVerification.checks[0].snapshot;
  delete old.dependencyVersion; delete old.relevantRefs;
  old.refs = sha(git(f.source.cwd, "show-ref", "--head"));
  legacy.checkoutVerification.snapshotDigest = digest(old);
  const stored = await f.create(legacy), restored = (await f.read(stored.id)).candidate.checkoutVerification.checks[0].snapshot;
  assert.deepEqual(restored, old);
  assert.equal(Object.hasOwn(restored, "dependencyVersion"), false);
  assert.equal(native.lookupGitCheckoutVerificationReceipt(stored.id), undefined);

  for (const change of [
    (s) => { delete s.dependencyVersion; }, (s) => { delete s.relevantRefs; },
    (s) => { s.dependencyVersion = 1; }, (s) => { s.relevantRefs = []; },
    (s) => { s.relevantRefs = ["refs/heads/feature", "refs/heads/feature"]; },
    (s) => { s.relevantRefs = ["refs/tags/feature"]; }, (s) => { s.relevantRefs = ["refs/heads/other"]; },
  ]) {
    const bad = structuredClone(f.candidate); change(bad.checkoutVerification.checks[0].snapshot);
    bad.checkoutVerification.snapshotDigest = digest(bad.checkoutVerification.checks[0].snapshot);
    assert.throws(() => journal.captureGitActionCandidateSnapshot(bad));
  }
});

test("optional diagnostic warnings preserve measured native facts and cannot certify receipt success", async (t) => {
  const f = await fixture(t), id = randomUUID(), run = measured(id, f.rows[0], "integration");
  const diagnostics = { status: "unavailable", reason: "storage-unavailable" };
  const value = { kind: "checkout-verification", status: "passed", diagnostics,
    checkoutVerification: { ...f.bound, runs: [{ ...run, diagnostics }] } };
  assert.deepEqual(journal.captureGitActionOutcome(value), value);
  assert.equal(native.readGitCheckoutVerificationNativeExecution(value), undefined);
  const nonpassing = structuredClone(value); nonpassing.checkoutVerification.runs[0].exitStatus = 1;
  assert.throws(() => journal.captureGitActionOutcome(nonpassing), /receipt without passing/);
  for (const bad of [{ status: "available", reason: "storage-unavailable" },
    { ...diagnostics, reason: "RAW_PRIVATE_ERROR" }, { ...diagnostics, authority: true }]) {
    assert.throws(() => journal.captureGitActionOutcome({ ...value, diagnostics: bad }));
    assert.throws(() => journal.captureGitActionOutcome({ ...value,
      checkoutVerification: { ...f.bound, runs: [{ ...run, diagnostics: bad }] } }));
  }
});

test("strict v2 capture rejects wrong stages, versions, hashes, unknown fields and mixed candidate capabilities", async (t) => {
  const f = await fixture(t);
  const invalid = [
    (c) => { c.checkoutVerification.stage = "commit"; },
    (c) => { c.checkoutVerification.evidenceScope = "working-workspace"; },
    (c) => { c.checkoutVerification.evidenceScope = "future-scope"; },
    (c) => { c.checkoutVerification.candidateTreeVerified = true; },
    (c) => { c.checkoutVerification.repositoryChecksWaived = true; },
    (c) => { c.targetCheckoutRoot = f.source.cwd; c.targetBranch = "main"; },
    (c) => { c.commitMode = "staged"; },
    (c) => { c.workingWorkspaceVerification = { evidenceScope: "working-workspace", ...limits, requiredSavedIndexes: [], runs: [] }; },
    (c) => { c.kind = "checks"; },
    (c) => { c.checkoutVerification.checks[0].receipt = { id: randomUUID() }; },
    (c) => { delete c.checkoutVerification.checks[0].snapshot; },
    (c) => { c.checkoutVerification.checks[0].snapshot.version = 1; },
    (c) => { c.checkoutVerification.checks[0].snapshot.version = 3; },
    (c) => { c.checkoutVerification.checks[0].snapshot.targetPath = sha("invented pair"); },
    (c) => { c.checkoutVerification.checks[0].snapshot.workspaceContentDigest = sha("dirty workspace"); },
    (c) => { c.checkoutVerification.checks[0].snapshot.log = "RAW_PRIVATE_LOG"; },
    (c) => { c.checkoutVerification.checks[0].recipe.cwd = "."; },
    (c) => { c.checkoutVerification.checks[0].recipe.env = {}; },
    (c) => { c.checkoutVerification.checks[0].recipe.requiredStage = "integration"; },
    (c) => { c.checkoutVerification.checks[0].recipeDigest = "a".repeat(64); },
    (c) => { c.checkoutVerification.snapshotDigest = "a".repeat(64); },
  ];
  for (const key of ["checkoutPath", "checkoutIdentity", "resourceIdentity", "branch", "head", "tree", "cwdIdentity", "policyDigest", "policyRevision", "recipeDigest", "checkDigest", "environmentDigest", "stageDigest"]) {
    invalid.push((c) => { c.checkoutVerification.checks[0].snapshot[key] = "a".repeat(64); c.checkoutVerification.snapshotDigest = digest(c.checkoutVerification.checks[0].snapshot); });
  }
  for (const mutate of invalid) {
    const bad = structuredClone(f.candidate); mutate(bad);
    assert.throws(() => journal.captureGitActionCandidateSnapshot(bad));
    assert.throws(() => ui.projectNativeGitActionCandidate(randomUUID(), bad));
    await assert.rejects(f.create(bad));
  }
  const working = structuredClone(f.candidate);
  Object.assign(working.checkoutVerification, { evidenceScope: "working-workspace", stage: "commit" });
  working.checkoutVerification.checks[0].recipe.requiredStage = "commit";
  assert.throws(() => journal.captureGitActionCandidateSnapshot(working), /v2 manifest/);
});

test("inert cohort history binds immutable manifests and retains known status zero in old recovery records", async (t) => {
  const f = await fixture(t, "integration", true), record = await f.create();
  const executing = await f.step(record, { state: "executing", intended: { kind: "checkout-verification", status: "passed", checkoutVerification: { ...f.bound, runs: [] } } });
  const first = { kind: "checkout-verification", status: "passed", checkoutVerification: { ...f.bound, runs: [measured(record.id, f.rows[0], "integration")] } };
  const progress = await f.step(executing, { state: "executing", outcome: first });
  const roundTrip = await f.read(record.id);
  assert.deepEqual(roundTrip.candidate.checkoutVerification.checks, f.rows);
  assert.deepEqual(Object.keys(roundTrip.candidate.checkoutVerification.checks[1].recipe.env), ["ZZ", "AA"], "native recipe JSON hashes are not normalized by journal storage");
  assert.equal(progress.state, "executing");
  await assert.rejects(f.step(progress, { state: "succeeded", outcome: first }), /incomplete passing/);
  const second = { ...first, checkoutVerification: { ...f.bound, runs: [...first.checkoutVerification.runs, measured(record.id, f.rows[1], "integration")] } };
  assert.notEqual(second.checkoutVerification.runs[0].snapshotDigest, second.checkoutVerification.runs[1].snapshotDigest);
  for (const [key, value] of [["snapshotDigest", f.bound.snapshotDigest], ["recipeDigest", f.rows[0].recipeDigest], ["stage", "commit"], ["sessionId", "foreign"]]) {
    const bad = structuredClone(second); bad.checkoutVerification.runs[1][key] = value;
    await assert.rejects(f.step(progress, { state: "executing", outcome: bad }), /foreign\/mismatched/);
  }
  const changed = structuredClone(second); changed.checkoutVerification.runs[0].unit = "pi-web-substitute.service";
  await assert.rejects(f.step(progress, { state: "executing", outcome: changed }), /immutable/);
  const more = await f.step(progress, { state: "executing", outcome: second });
  const quarantined = await f.step(more, { state: "recovery-required", outcome: { ...second, status: "partial-state" } });
  assert.deepEqual((await f.read(record.id)).record.outcome.checkoutVerification.runs, second.checkoutVerification.runs);
  assert.equal(quarantined.outcome.checkoutVerification.runs[0].exitStatus, 0);
  for (const r of second.checkoutVerification.runs) assert.equal(native.lookupGitCheckoutVerificationReceipt(r.receipt.id), undefined);
  await assert.rejects(f.step(quarantined, { state: "executing" }), /terminal/);
});

test("clean v2 projection isolates caller mutation and exact pending responses never grant replay/commit or malformed scopes", async (t) => {
  const f = await fixture(t, "handoff"), record = await f.create(), packet = ui.projectNativeGitActionCandidate(record.id, f.candidate);
  const request = { type: "extension_ui_request", method: "git_action", id: "actual-pending-id", candidate: packet };
  const response = { type: "extension_ui_response", id: request.id, confirmed: true };
  assert.deepEqual(ui.projectGitActionUiCandidate(packet), packet);
  assert.equal(ui.resolveNativeGitActionResponse(request, response), true);
  assert.equal(ui.resolveNativeGitActionResponse(request, { ...response, confirmed: false }), false);
  assert.equal(ui.resolveNativeGitActionResponse(request, { type: response.type, id: request.id, cancelled: true }), false);
  for (const bad of [{ ...response, id: record.id }, { ...response, receipt: {} }, { ...response, permission: "Allow" }, { ...response, stage: "commit" }])
    assert.equal(ui.gitActionResponsePassesNativeGuard(request, bad), false);
  for (const mutate of [(p) => { p.checkoutVerification.stage = "commit"; }, (p) => { p.checkoutVerification.evidenceScope = "future"; },
    (p) => { p.checkoutVerification.checks[0].snapshot.version = 3; }, (p) => { p.nativeHandle = {}; }]) {
    const bad = structuredClone(packet); mutate(bad);
    assert.equal(ui.resolveNativeGitActionResponse({ ...request, candidate: bad }, response), undefined);
  }
  f.candidate.checkoutVerification.checks[0].snapshot.index = "a".repeat(64);
  f.candidate.checkoutVerification.checks[0].recipe.argv.push("changed");
  assert.equal(packet.checkoutVerification.checks[0].snapshot.index, f.rows[0].snapshot.index);
  assert.deepEqual(packet.checkoutVerification.checks[0].recipe.argv, [process.execPath, "--version"]);
  assert.equal(native.lookupGitCheckoutVerificationReceipt(record.id), undefined);
});

test("v2 history data and copied native-like objects never authenticate completion or commit prerequisites", async (t) => {
  const f = await fixture(t);
  const handle = await controller.beginGitActionWithId(randomUUID(), { sessionId: "session", append: () => ({ entryId: "fixture", timestamp: 1 }) }, "agent", f.candidate, f.agentDir);
  t.after(() => handle.release());
  const record = handle.record;
  await handle.update("executing", { intended: { kind: "checkout-verification", checkoutVerification: { ...f.bound, runs: [] } } });
  const facts = { kind: "checkout-verification", status: "passed", checkoutVerification: { ...f.bound, runs: [measured(record.id, f.rows[0], "integration")] } };
  await assert.rejects(controller.finishGitAction(handle, facts), /actual-native/);
  let called = false;
  await assert.rejects(controller.finishVerifiedNativeGitAction(handle, structuredClone(facts), () => {
    called = true; return { actionId: record.id, outcome: facts };
  }), controller.GitActionApplyError);
  assert.equal(called, false, "caller callback cannot issue native success");
  assert.equal(handle.record.state, "recovery-required");
  await assert.rejects(journal.createGitAction({ sessionId: "session", source: "agent", candidate: { kind: "commit", repositoryRoot: f.source.cwd,
    workingWorkspaceVerification: { evidenceScope: "working-workspace", ...limits, requiredSavedIndexes: [], runs: facts.checkoutVerification.runs } } }, f.agentDir), /non-commit/);
});
