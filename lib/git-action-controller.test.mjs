import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";

const home = fs.mkdtempSync(join(tmpdir(), "pi-optional-controller-"));
const previous = new Map(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map(k => [k, process.env[k]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: home, PI_CODING_AGENT_DIR: home });
after(() => { for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(home, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const controller = await jiti.import("./git-action-controller.ts");
const journal = await jiti.import("./git-action-journal.ts");
const native = await jiti.import("./git-workspace-operation.ts");
const resources = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const oid = c => c.repeat(40);
const candidate = () => ({ kind: "commit", repositoryRoot: "/fixture/repo", featureBranch: "feature", message: "Exact\nmessage",
  paths: ["a"], parentOid: oid("a"), candidateTreeOid: oid("b"), diff: { fromTreeOid: oid("a"), toTreeOid: oid("b"), patch: "--- a/a\n+++ b/a\n+exact\n", hasBinaryChanges: false } });
const outcome = { status: "committed", commit: oid("c"), tree: oid("b"), parents: [oid("a")] };
function fixture(t) {
  const agent = fs.mkdtempSync(join(home, "agent-"));
  t.after(() => fs.rmSync(agent, { recursive: true, force: true }));
  const anchors = [];
  const sink = { sessionId: randomUUID(), append(r) { anchors.push(r.id); return { entryId: randomUUID(), timestamp: Date.now() }; } };
  const begin = async (c = candidate(), s = sink) => { const h = await controller.beginGitAction(s, "agent", c, agent); t.after(() => h.release()); return h; };
  return { agent, sink, anchors, begin };
}
function fault(t, name, replacement) {
  const original = fs[name];
  const mock = t.mock.method(fs, name, (...args) => replacement(original, ...args));
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return () => { mock.mock.restore(); syncBuiltinESMExports(); };
}

test("bad private history and anchor failure retain exact live candidate and known outcome, with explicit warnings", async t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.agent, "git-diagnostics-v2"), "not a directory");
  const input = candidate(), exact = structuredClone(input);
  const h = await f.begin(input, { ...f.sink, append(r) { f.anchors.push(r.id); input.message = "changed during optional append"; throw Error("private error must not leak"); } });
  assert.deepEqual(h.candidate, exact);
  input.diff.patch = "modified";
  h.candidate.paths.push("foreign"); h.record.summary.message = "mutated";
  assert.deepEqual(h.candidate, exact);
  assert.equal(h.record.summary.message, exact.message);
  assert.equal(h.diagnosticsUnavailable, true);
  assert.deepEqual(h.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  await h.update("awaiting-decision");
  const live = await journal.readGitAction(h.record.id, { includeArtifact: true }, f.agent);
  assert.deepEqual(live.candidate, exact);
  assert.equal(live.record.state, "awaiting-decision");
  const associated = journal.readLiveGitAction(f.sink.sessionId, h.record.id, { includeArtifact: true }, f.agent);
  assert.deepEqual(associated.candidate, exact);
  assert.equal(journal.readLiveGitAction("foreign-session", h.record.id, { includeArtifact: true }, f.agent), undefined);
  await h.update("executing", { decision: "approved", intended: outcome });
  await controller.finishGitAction(h, outcome);
  assert.equal(controller.gitActionDiagnosticReport(h).diagnosticsUnavailable, true);
  assert.equal(h.record.state, "succeeded");
  assert.equal(h.record.outcome.commit, outcome.commit);
  assert.equal(f.anchors.length, 1, "no blind append retry");
  assert.equal(fs.existsSync(join(f.agent, "pi-web", "git-actions", "v1")), false);
  assert.doesNotMatch(JSON.stringify(h.record), /private error|changed during/);
  h.release();
  assert.equal(journal.readLiveGitAction(f.sink.sessionId, h.record.id, { includeArtifact: true }, f.agent), undefined);
  await assert.rejects(h.update("executing"), /no longer live/);
  const independent = await f.begin();
  await independent.update("executing");
  await controller.finishGitAction(independent, outcome);
  assert.equal(independent.record.state, "succeeded");
});

test("pure candidate, native shape and transition refusal are not optional-storage warnings", async t => {
  const f = fixture(t); let appends = 0;
  const bad = candidate(); bad.parentOid = "invalid";
  await assert.rejects(f.begin(bad, { ...f.sink, append() { appends++; throw Error("not reached"); } }), /Invalid/);
  assert.equal(appends, 0);
  assert.deepEqual(fs.readdirSync(f.agent), []);
  const h = await f.begin();
  assert.equal(Object.isFrozen(h), true);
  assert.throws(() => Object.defineProperty(h, "record", { value: { ...h.record, id: randomUUID() } }), TypeError);
  await assert.rejects(h.update("succeeded", { outcome }), /Illegal/);
  assert.equal(h.record.state, "proposed");
  await h.update("executing");
  await assert.rejects(controller.finishGitAction(h, { ...outcome, commit: "invalid" }), /Invalid/);
  assert.equal(h.record.state, "executing");
  h.release();
  await assert.rejects(controller.finishGitAction(h, outcome), /no longer live/);
});

test("source caller warning converts to strict history diagnostics without changing native facts", async t => {
  const f = fixture(t), h = await f.begin();
  assert.equal(h.diagnosticsUnavailable, false);
  await h.update("executing");
  await controller.finishGitAction(h, { ...outcome, diagnosticsUnavailable: true });
  assert.deepEqual(h.record.outcome.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.equal(h.record.outcome.diagnosticsUnavailable, undefined);
  assert.equal(controller.gitActionDiagnosticReport(h).diagnosticsUnavailable, true);
  assert.equal(h.record.state, "succeeded");
  assert.equal(h.record.outcome.commit, outcome.commit);
});

test("terminal ENOSPC and partly-published fsync failure preserve truthful completion and known ID", async t => {
  for (const phase of ["writeSync", "fsyncSync"]) await t.test(phase, async t => {
    const f = fixture(t), h = await f.begin();
    await h.update("executing");
    let calls = 0;
    const restore = fault(t, phase, (original, ...args) => {
      calls++;
      if (phase === "writeSync" || fs.fstatSync(args[0]).isDirectory()) throw Object.assign(Error("disk failure"), { code: "ENOSPC" });
      return original(...args);
    });
    const id = h.record.id;
    await controller.finishGitAction(h, outcome);
    assert.ok(calls);
    assert.equal(controller.gitActionDiagnosticReport(h).diagnosticsUnavailable, true);
    assert.equal(h.record.id, id);
    assert.equal(h.record.state, "succeeded");
    assert.equal(h.record.outcome.commit, outcome.commit);
    restore(); h.release();
    if (phase === "fsyncSync") {
      const persisted = await journal.readGitAction(id, {}, f.agent);
      assert.equal(persisted.record.state, "succeeded");
      assert.equal(persisted.record.outcome.commit, outcome.commit);
    }
  });
});

test("bounded terminal v2 copies survive restart; legacy ledgers remain untouched; exact completed artifacts retained", async t => {
  const f = fixture(t), legacy = join(f.agent, "pi-web", "git-actions", "v1");
  fs.mkdirSync(legacy, { recursive: true, mode: 0o700 });
  fs.writeFileSync(join(legacy, "foreign"), "malformed legacy diagnostic");
  for (let i = 0; i < 3; i++) {
    const h = await f.begin(); await h.update("executing"); await controller.finishGitAction(h, outcome);
    const id = h.record.id; h.release();
    const restored = await journal.readGitAction(id, { includeArtifact: true }, f.agent);
    assert.equal(restored.record.state, "succeeded");
    assert.deepEqual(restored.candidate, candidate());
    assert.equal(restored.unavailable, undefined);
    await assert.rejects(journal.transitionGitAction(id, restored.record.revision, { state: "executing" }, f.agent));
    const script = `const {createJiti}=require('jiti'); (async()=>{const j=await createJiti(process.cwd()+'/fixture.cjs').import('./lib/git-action-journal.ts'); const r=await j.readGitAction(${JSON.stringify(id)},{},${JSON.stringify(f.agent)}); console.log(r.record.state);})()`;
    assert.equal(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim(), "succeeded");
  }
  assert.deepEqual(fs.readdirSync(legacy), ["foreign"]);
  assert.equal(fs.readFileSync(join(legacy, "foreign"), "utf8"), "malformed legacy diagnostic");
  assert.deepEqual(fs.readdirSync(f.agent).sort(), ["git-diagnostics-v2", "pi-web"]);
  assert.equal(fs.readdirSync(join(f.agent, "git-diagnostics-v2")).length, 6);
});

test("original published check receipts and measured failures project truthfully despite missing history", { skip: process.platform !== "linux" }, async t => {
  const checkout = await jiti.import("./git-checkout-verification.ts");
  const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
  const { gitExecEnv } = await jiti.import("./git-exec.ts");
  const { sanitizeProjectCommandEnvironment } = await jiti.import("./project-command-env.ts");
  const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  for (const exit of [0, 2]) await t.test(`exit ${exit}`, async t => {
    const f = fixture(t), repo = join(f.agent, "check-repo");
    const git = (...args) => execFileSync("git", ["-C", f.agent, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-qb", "main", repo); fs.writeFileSync(join(repo, "a"), "base\n");
    git("-C", repo, "add", "."); git("-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
    allowFileRoot(f.agent);
    const source = await resources.selectGitProjectResources(repo);
    const recipe = { label: "Fixture", argv: [process.execPath, "-e", `process.exit(${exit})`], requiredStage: "integration" };
    const policy = { policyRevision: "fixture-policy", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, mainBranch: "main", delivery: "local", baseBranch: null, targetBranch: null, checks: [recipe] } };
    const environment = sanitizeProjectCommandEnvironment(gitExecEnv());
    const binding = { recipe, checkIndex: 0, stage: "integration", policyDigest: hash(policy.settings), policyRevision: policy.policyRevision,
      environmentDigest: hash(Object.entries(environment).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))) };
    const snapshot = await checkout.captureGitCheckoutCheckRecoverySnapshot(source, binding, true);
    const candidate = controller.snapshotGitCheckoutVerificationAction(source, {
      evidenceScope: "clean-checkout", candidateTreeVerified: false, repositoryChecksWaived: false,
      sourceOid: git("-C", repo, "rev-parse", "HEAD"), sourceTreeOid: git("-C", repo, "rev-parse", "HEAD^{tree}"), snapshotDigest: hash(snapshot),
      policyDigest: binding.policyDigest, policyRevision: binding.policyRevision, stage: binding.stage, requiredSavedIndexes: [0],
      source: { gitDir: source.gitDir, checkoutIdentity: source.identities.checkout, gitIdentity: source.identities.git, markerIdentity: source.identities.marker },
      checks: [{ checkIndex: 0, recipe, recipeDigest: snapshot.recipeDigest, environmentDigest: binding.environmentDigest, executionCwd: repo, snapshot }],
    });
    fs.writeFileSync(join(f.agent, "git-diagnostics-v2"), "optional storage unavailable");
    const id = randomUUID(), h = await controller.beginGitActionWithId(id, f.sink, "agent", candidate, f.agent);
    const { source: _source, checks: _checks, ...bound } = candidate.checkoutVerification; void _source; void _checks;
    t.after(() => h.release()); await h.update("executing", { intended: { kind: "checkout-verification", checkoutVerification: { ...bound, runs: [] } } });
    let measured;
    // Protocol/stdio fixture only, NOT OS containment. The production leaf still
    // issues the original receipt/facts; no structural execution is registered.
    const backend = createTestContainmentBackend(), observations = new WeakMap();
    const proofBackend = { ...backend, async observe(...args) {
      const original = await backend.observe(...args);
      const row = { ...original, identity: `1:2:${original.unit.InvocationID}:${original.unit.ControlGroup}`, launcherIdentity: "123:1:2:3" };
      observations.set(row, original); return row;
    }, assertLauncherCwd(name, row, expected) {
      const original = observations.get(row); assert.ok(original);
      backend.assertLauncherCwd(name, original, expected);
    } };
    const options = { sessionId: f.sink.sessionId, actionId: id, selector: { repositoryPath: repo, checkoutPath: repo }, agentDir: f.agent,
      checkIndex: 0, stage: "integration", getPolicy: () => policy, isTrusted: () => true, isSelectionAuthorized: () => true, isActorAuthorized: () => true,
      testContainmentBackend: proofBackend, onExecution(row) { measured = row; } };
    let original;
    if (exit === 0) original = await checkout.runGitCheckoutVerification(options);
    else { await assert.rejects(checkout.runGitCheckoutVerification(options)); original = measured; }
    assert.ok(measured); assert.equal(measured.receipt, undefined);
    assert.equal(checkout.readGitCheckoutVerificationNativeExecution({ ...original }), undefined);
    const authenticated = checkout.readGitCheckoutVerificationNativeExecution(original);
    assert.ok(authenticated);
    journal.captureGitActionOutcome({ kind: "checkout-verification", status: exit === 0 ? "passed" : "failed", checkoutVerification: { ...bound, runs: [authenticated] } });
    const report = await controller.finishVerifiedNativeGitAction(h, original);
    assert.equal(report.diagnosticsUnavailable, true);
    assert.equal(h.record.state, exit === 0 ? "succeeded" : "failed");
    assert.equal(h.record.outcome.checkoutVerification.runs[0].exitStatus, exit);
    assert.equal(!!h.record.outcome.checkoutVerification.runs[0].receipt, exit === 0);
    if (exit === 0) {
      h.release();
      const incomplete = await controller.beginGitActionWithId(id, f.sink, "agent", candidate, f.agent);
      await incomplete.update("executing", { intended: { kind: "checkout-verification", checkoutVerification: { ...bound, runs: [] } } });
      await assert.rejects(controller.finishVerifiedNativeGitAction(incomplete, measured), controller.GitActionApplyError);
      assert.notEqual(incomplete.record.state, "succeeded", "onExecution cannot attest receipt publication");
    }
  });
});

test("genuine original native workspace proof survives missing diagnostics; structural callback cannot certify a fake", { skip: process.platform !== "linux" }, async t => {
  const f = fixture(t), repo = join(f.agent, "repo"), parent = `${repo}-worktrees`;
  const git = (...args) => execFileSync("git", ["-C", f.agent, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-qb", "main", repo); fs.mkdirSync(parent);
  fs.writeFileSync(join(repo, "a"), "base\n");
  git("-C", repo, "add", "."); git("-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  allowFileRoot(f.agent);
  const source = await resources.selectGitProjectResources(repo), baseOid = git("-C", repo, "rev-parse", "HEAD");
  const owner = { sessionId: f.sink.sessionId, sessionFile: join(f.agent, "session.jsonl"), generation: randomUUID() };
  fs.writeFileSync(owner.sessionFile, JSON.stringify({ type: "session", id: owner.sessionId, cwd: repo }) + "\n");
  const authority = { owner, readAuthorityRevisionSync: () => "fixture-policy", assertCurrentSync(b) { assert.deepEqual(b.owner, owner); assert.equal(b.source.projectRoot, repo); } };
  const request = branch => ({ repositoryPath: repo, sourceCheckoutPath: repo, destinationPath: join(parent, branch), branch, baseBranch: "main", expectedBaseOid: baseOid, mode: "create" });
  fs.writeFileSync(join(f.agent, "git-diagnostics-v2"), "unavailable");
  for (const branch of ["first", "independent"]) {
    const captured = await native.captureGitWorkspaceOperation(request(branch), {}, authority);
    const snapshot = controller.snapshotGitWorkspaceAction(source, captured);
    const h = await controller.beginGitActionWithId(captured.actionId, f.sink, "agent", snapshot, f.agent);
    t.after(() => h.release());
    await h.update("executing");
    const original = await native.applyGitWorkspaceOperation({ candidate: captured, authorize: async () => {} });
    assert.ok(native.readGitWorkspaceNativeProof(original));
    let called = false;
    const report = await controller.finishVerifiedNativeGitAction(h, original, () => { called = true; throw Error("not an issuer"); });
    assert.equal(called, false);
    assert.equal(report.diagnosticsUnavailable, true);
    assert.equal(h.record.state, "succeeded"); assert.equal(h.record.outcome.status, "created");
    assert.equal(git("-C", original.path, "rev-parse", "HEAD"), baseOid);
    await assert.rejects(native.applyGitWorkspaceOperation({ candidate: captured, authorize: async () => {} }), { code: "stale" });
    h.release();
    const fake = await controller.beginGitActionWithId(randomUUID(), f.sink, "agent", snapshot, f.agent);
    await fake.update("executing");
    await assert.rejects(controller.finishVerifiedNativeGitAction(fake, { ...original }, () => ({ actionId: fake.record.id, outcome: h.record.outcome })), controller.GitActionApplyError);
    assert.notEqual(fake.record.state, "succeeded");
  }
});
