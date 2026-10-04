import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { runGitCheckoutVerification: run, lookupGitCheckoutVerificationReceipt: lookup,
  validateGitCheckoutVerificationReceipt: validate, gitCommitWorkingWorkspaceReceiptReader: reader,
  readGitCheckoutVerificationNativeExecution: facts } = await jiti.import("./git-checkout-verification.ts");
const { createGitCheckCohort, retireGitCheckCohort, assertGitCheckReceiptBatchCurrent: assertBatch } = await jiti.import("./git-check-runner.ts");
const { runGitVerification: paired, lookupGitVerificationReceipt: pairedLookup } = await jiti.import("./git-verification.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS: defaults } = await jiti.import("./git-workflow-settings.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { captureGitCommitVerification: capture, bindGitCommitVerification: bind,
  revalidateGitCommitVerification: revalidate } = await jiti.import("./git-commit-verification.ts");
const { loadGitProjectSettings } = await jiti.import("./git-project-settings.ts");
const { gitWorkflowPolicyRevision } = await jiti.import("./git-scoped-authority.ts");
const { writeGitWorkflowSettingsDocument: saveSettings } = await jiti.import("./git-workflow-settings-store.ts");
const native = await jiti.import("./git-commit.ts");
const { captureGitInvocation } = await jiti.import("./git-invocation.ts");
const { beginSupervisedGitOperationIntent } = await jiti.import("./git-operation-admission.ts");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const check = (code = "process.exit(0)") => ({ label: "fixture", argv: [process.execPath, "-e", code], requiredStage: "commit" });
function fixture(t, checks = [check()]) {
  const home = mkdtempSync(join(tmpdir(), "pi-independent-checks-"));
  const saved = new Map(["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"].map(k => [k, process.env[k]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), GIT_CONFIG_GLOBAL: join(home, "no-global"), GIT_CONFIG_NOSYSTEM: "1" });
  t.after(() => { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(home, { recursive: true, force: true }); });
  const cwd = join(home, "repo"), agentDir = join(home, "agent");
  mkdirSync(agentDir, { mode: 0o700 }); git(home, "init", "-qb", "main", cwd);
  git(cwd, "config", "user.name", "Fixture"); git(cwd, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, "a"), "base\n"); writeFileSync(join(cwd, ".gitignore"), "ignored*\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "fixture base"); allowFileRoot(home);
  const policy = { policyRevision: "fixture-1", settings: { ...defaults, checks } };
  const session = (location) => {
    const manager = SessionManager.create(location, join(agentDir, "sessions"));
    manager.appendMessage({ role: "user", content: "Disposable verification fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], api: "openai-responses", provider: "fixture", model: "fixture",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
    assert.ok(existsSync(manager.getSessionFile()));
    return manager;
  };
  const owner = session(cwd);
  const options = { sessionId: owner.getSessionId(), selector: { repositoryPath: cwd, checkoutPath: cwd }, agentDir,
    checkIndex: 0, stage: "commit", getPolicy: () => policy, isTrusted: () => true, isSelectionAuthorized: () => true,
    isActorAuthorized: () => true, testContainmentBackend: createTestContainmentBackend() };
  return { home, cwd, agentDir, policy, options, owner, session };
}
function latchBackend() {
  const base = createTestContainmentBackend();
  let release, entered;
  const gate = new Promise(r => { release = r; }), ready = new Promise(r => { entered = r; });
  return { ready, release, backend: { ...base, async start(...args) { const result = await base.start(...args); entered(); await gate; return result; } } };
}
async function commitOptions(f, extra = {}) {
  return { sessionId: f.options.sessionId, agentDir: f.agentDir, source: await selectGitProjectResources(f.cwd), checkIndex: 0, stage: "commit",
    sourceGetPolicy: () => ({ ...f.policy, savedProjectSettings: { checks: f.policy.settings.checks } }),
    isTrusted: () => true, isSelectionAuthorized: () => true, isCheckAuthorized: () => true, ...extra };
}

test("postpublication facts are distinct from optional measured diagnostics, copies/history never prove a pass", async (t) => {
  const f = fixture(t); let measured;
  const receipt = await run({ ...f.options, onExecution: async row => {
    measured = row; assert.equal(facts(row), row); assert.equal(row.receipt, undefined);
    assert.equal(facts({ ...row, receipt: { id: randomUUID(), sha256: "a".repeat(64), expiresAt: Date.now() + 1000 } }), undefined);
    assert.equal(facts(JSON.parse(JSON.stringify(row))), undefined);
  } });
  const published = facts(receipt);
  assert.equal(receipt.diagnostics, undefined, "all assertions inside optional callback actually completed");
  assert.equal(published.receipt.id, receipt.id); assert.equal(published.receipt.sha256, hash(JSON.stringify(receipt)));
  assert.equal(facts(measured).receipt, undefined); assert.equal(facts({ ...receipt }), undefined);
  assert.equal(receipt.snapshot.dependencyVersion, 2); assert.deepEqual(receipt.snapshot.relevantRefs, ["refs/heads/main"]);
  assert.equal(await validate(receipt.id, f.options), receipt);
});

test("missing/throwing diagnostics and output storage failure do not redefine actual native success", async (t) => {
  const f = fixture(t), first = await run(f.options);
  const second = await run({ ...f.options, onExecution: async () => { throw new Error("PRIVATE_STORAGE_ERROR"); } });
  assert.deepEqual(second.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.equal(lookup(first.id), first); assert.equal(lookup(second.id), second);
  rmSync(join(f.agentDir, "git-diagnostics-v2"), { recursive: true });
  writeFileSync(join(f.agentDir, "git-diagnostics-v2"), "storage unavailable");
  const third = await run(f.options); assert.equal(third.diagnostics.reason, "storage-unavailable");
  assert.equal(lookup(first.id), first, "diagnostic deletion cannot retire an authentic receipt");
  assert.equal(facts(third).receipt.id, third.id); assert.equal(JSON.stringify(third).includes("PRIVATE_STORAGE_ERROR"), false);
  const unavailableAgent = join(f.home, "not-a-directory"); writeFileSync(unavailableAgent, "fixture");
  const fourth = await run({ ...f.options, agentDir: unavailableAgent });
  assert.equal(fourth.diagnostics.reason, "storage-unavailable"); assert.equal(lookup(fourth.id), fourth);
});

for (const failure of ["failed", "uncertain"]) test(`persisted independent sessions A ${failure}, B succeeds concurrently and prior B survives`, async (t) => {
  const f = fixture(t, [check("process.exit(process.cwd().endsWith('feature-a') ? 7 : 0)")]);
  const a = join(f.home, "feature-a"), b = join(f.home, "feature-b");
  git(f.cwd, "worktree", "add", "-qb", "feature-a", a); git(f.cwd, "worktree", "add", "-qb", "feature-b", b);
  const ownerA = f.session(a), ownerB = f.session(b);
  f.options.sessionId = ownerB.getSessionId();
  const { context } = await savedContext(f);
  writeFileSync(join(b, "a"), "B independently checked workspace\n");
  const bOptions = { ...f.options, sessionId: ownerB.getSessionId(), selector: { repositoryPath: f.cwd, checkoutPath: b },
    getPolicy: context.sourceGetPolicy, readAuthorityRevisionSync: context.readAuthorityRevisionSync };
  const prior = await run(bOptions), held = latchBackend();
  let backend = held.backend;
  if (failure === "uncertain") backend = { ...backend, async terminal() { return false; } };
  const aRun = run({ ...f.options, sessionId: ownerA.getSessionId(), selector: { repositoryPath: f.cwd, checkoutPath: a },
    checkIndex: 0, timeoutMs: 5000, testContainmentBackend: backend });
  const rejected = assert.rejects(aRun);
  await held.ready;
  assert.equal(lookup(prior.id), prior);
  const concurrent = await run(bOptions);
  assert.equal(lookup(concurrent.id), concurrent);
  held.release(); await rejected;
  assert.equal(await validate(prior.id, bOptions), prior); assert.equal(await validate(concurrent.id, bOptions), concurrent);
  context.receiptIds.push(prior.id);
  const verified = await capture(b, context), preview = await native.prepareGitCommit(b, ["a"]), message = "B own authorized candidate";
  bind(verified.handle, preview, message);
  const source = await selectGitProjectResources(b), owner = { sessionId: ownerB.getSessionId(), sessionFile: ownerB.getSessionFile(), generation: "B-original" };
  const binding = native.gitCommitInvocationBinding(source, preview, message, owner);
  const invocation = captureGitInvocation(binding, { readAuthorityRevisionSync: context.readAuthorityRevisionSync,
    assertCurrentSync(actual) { assert.equal(actual.owner.sessionId, ownerB.getSessionId()); assert.equal(actual.candidateSha256, binding.candidateSha256); } });
  const operation = await beginSupervisedGitOperationIntent(source, randomUUID(), "commit", f.agentDir);
  const result = await native.confirmGitCommit(preview, message, async (_, lock) => {
    const boundary = native.captureGitCommitProtectedBoundary(lock, operation, source, invocation, binding, f.agentDir);
    return revalidate(verified.handle, preview, message, boundary, context.sessionId);
  }, { operation, invocation, binding });
  assert.equal(result.status, "committed"); assert.equal(git(b, "show", "HEAD:a"), "B independently checked workspace");
  assert.equal(git(a, "show", "HEAD:a"), "base");
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("same-checkout independent invocations overlap, while ordered sibling failure retires only its own batch", async (t) => {
  const f = fixture(t, [check(), check("process.exit(3)")]);
  const independent = await run(f.options), cohort = createGitCheckCohort([0, 1]), held = latchBackend();
  const first = await run({ ...f.options, cohort });
  const rejected = assert.rejects(run({ ...f.options, cohort, checkIndex: 1, testContainmentBackend: held.backend }));
  let concurrent;
  try {
    await Promise.race([held.ready, rejected.then(() => { throw new Error("failed before intended launcher gate"); })]);
    await assert.rejects(run({ ...f.options, cohort, checkIndex: 1 }));
    assert.equal(lookup(first.id), first, "invalid replay cannot retire the running original batch");
    concurrent = await run(f.options); assert.equal(lookup(independent.id), independent);
  } finally { held.release(); await rejected; }
  assert.equal(lookup(first.id), undefined);
  await assert.rejects(run({ ...f.options, cohort, checkIndex: 1 }));
  await assert.rejects(run({ ...f.options, cohort: { ...cohort }, checkIndex: 1 }));
  assert.equal(await validate(independent.id, f.options), independent); assert.equal(lookup(concurrent.id), concurrent);
});

test("genuine reversed leaf executions cannot certify an ordered required batch", async (t) => {
  const f = fixture(t, [check(), check()]), cohort = createGitCheckCohort([0, 1]);
  const order = join(f.home, "actual-command-order"), base = createTestContainmentBackend(); let starts = 0;
  for (let index = 0; index < 2; index++) f.policy.settings.checks[index] = check(
    `require('fs').appendFileSync(${JSON.stringify(order)},${JSON.stringify(String(index))})`);
  await assert.rejects(run({ ...f.options, cohort, checkIndex: 1, testContainmentBackend: { ...base,
    start(options) { starts++; return base.start(options); } } }));
  assert.equal(starts, 0); assert.equal(existsSync(order), false);
  const first = await run({ ...f.options, cohort, checkIndex: 0 });
  const second = await run({ ...f.options, cohort, checkIndex: 1 });
  assert.equal(facts(first).receipt.id, first.id); assert.equal(facts(second).receipt.id, second.id);
  assert.equal(lookup(first.id), first); assert.equal(lookup(second.id), second);
  assert.equal(readFileSync(order, "utf8"), "01"); assertBatch([first.id, second.id], [0, 1]);
});

for (const boundary of ["diagnostics", "publication"]) test(`same-cohort sibling cannot start before predecessor ${boundary} finishes, independent cohort can`, async (t) => {
  const f = fixture(t, [check(), check()]), cohort = createGitCheckCohort([0, 1]);
  let announce, release, measured, starts = 0;
  const ready = new Promise(resolve => { announce = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const firstRun = run({ ...f.options, cohort,
    onExecution: async row => { measured = row; if (boundary === "diagnostics") { announce(); await gate; } },
    testBeforeReceiptRegistration: boundary === "publication" ? async () => { announce(); await gate; } : undefined });
  const base = createTestContainmentBackend();
  let first;
  try {
    await Promise.race([ready, firstRun.then(() => { throw new Error("missed intended publication gate"); })]);
    assert.equal(measured.exitStatus, 0); assert.equal(measured.containmentComplete, true); assert.equal(measured.receipt, undefined);
    await assert.rejects(run({ ...f.options, cohort, checkIndex: 1, testContainmentBackend: { ...base,
      start(options) { starts++; return base.start(options); } } }));
    assert.equal(starts, 0, "invalid sibling must be rejected before any launcher starts");
    const independent = await run({ ...f.options, checkIndex: 1 }); assertBatch([independent.id], [1]);
  } finally { release(); first = await firstRun; }
  const second = await run({ ...f.options, cohort, checkIndex: 1 });
  assertBatch([first.id, second.id], [0, 1]);
});

test("explicit siblings preserve distinct recipe cwd/env/index; one entry each, retirement cannot reissue history", async (t) => {
  const f = fixture(t, [check(), { ...check(), env: { CI: "sibling" } }]), cohort = createGitCheckCohort([0, 1]);
  const first = await run({ ...f.options, cohort }), second = await run({ ...f.options, cohort, checkIndex: 1 });
  assert.notEqual(first.environmentDigest, second.environmentDigest); assert.equal(lookup(first.id), first);
  await assert.rejects(run({ ...f.options, cohort })); // duplicate entry doesn't retire a genuine completed member
  assert.equal(lookup(first.id), first);
  retireGitCheckCohort(cohort); assert.equal(lookup(first.id), undefined); assert.equal(lookup(second.id), undefined);
  assert.equal(facts(first).receipt.id, first.id, "retired measured facts are informational, not execution authority");
  assert.throws(() => retireGitCheckCohort(JSON.parse(JSON.stringify(cohort))));
});

test("terminal failure retires only its own batch before optional diagnostic awaits", async (t) => {
  const f = fixture(t, [check(), check("process.exit(7)")]), cohort = createGitCheckCohort([0, 1]);
  const first = await run({ ...f.options, cohort });
  let resume, announce, measured;
  const gate = new Promise(r => { resume = r; }), ready = new Promise(r => { announce = r; });
  const failure = assert.rejects(run({ ...f.options, cohort, checkIndex: 1, onExecution: async row => {
    measured = row; announce(); await gate; // assertions belong outside the optional, deliberately caught callback
  } }));
  try {
    await Promise.race([ready, failure.then(() => { throw new Error("failed before diagnostic boundary"); })]);
    assert.equal(measured.exitStatus, 7);
    assert.equal(lookup(first.id), undefined, "known terminal failure retires before optional history completes");
    assert.equal(facts(first).receipt.id, first.id, "retired measurements are still inspectable");
    const independent = await run(f.options); assert.equal(lookup(independent.id), independent);
  } finally { resume(); await failure; }
});

test("original receipt authority cannot be rebaselined after change-and-restore or replaced reader", async (t) => {
  const f = fixture(t); let revision = 1;
  const options = { ...f.options, readAuthorityRevisionSync: () => String(revision) }, receipt = await run(options);
  revision += 2; // monotonic revision records revoked and restored values
  await assert.rejects(validate(receipt.id, { ...options, readAuthorityRevisionSync: () => String(revision) }), /stale/);
  assert.equal(lookup(receipt.id), undefined);
});

for (const mutation of ["content", "authority"]) test(`awaited diagnostic callback ${mutation} mutation still refuses receipt`, async (t) => {
  const f = fixture(t); let revision = 1, measured;
  await assert.rejects(run({ ...f.options, readAuthorityRevisionSync: () => String(revision), onExecution: async row => {
    measured = row; await Promise.resolve();
    if (mutation === "content") writeFileSync(join(f.cwd, "a"), "modified"); else revision += 2;
    throw new Error("optional diagnostic failure");
  } }));
  assert.equal(facts(measured).exitStatus, 0); assert.equal(facts(measured).receipt, undefined);
});

test("linked selected checkout ignores unrelated refs and primary markers, relevant branch/index/content remain bound", async (t) => {
  const f = fixture(t), linked = join(f.home, "linked"); git(f.cwd, "worktree", "add", "-qb", "feature", linked);
  const options = { ...f.options, selector: { repositoryPath: f.cwd, checkoutPath: linked } };
  const receipt = await run(options);
  git(f.cwd, "update-ref", "refs/heads/unrelated", "HEAD"); writeFileSync(join(f.cwd, ".git", "index.lock"), "foreign native lock");
  writeFileSync(join(f.cwd, ".git", "MERGE_HEAD"), "foreign marker");
  assert.equal(await validate(receipt.id, options), receipt);
  assert.equal((await validate((await run(options)).id, options)).snapshot.dependencyVersion, 2);
  assert.equal(readFileSync(join(f.cwd, ".git", "index.lock"), "utf8"), "foreign native lock");
  writeFileSync(join(linked, "a"), "changed"); await assert.rejects(validate(receipt.id, options), /stale/);
});

for (const change of ["untracked", "mode", "symlink", "index", "branch"]) test(`working physical manifest rejects ${change} without claiming ignored/external coverage`, async (t) => {
  const f = fixture(t); git(f.cwd, "config", "core.fileMode", "false");
  if (change === "untracked") writeFileSync(join(f.cwd, "new"), "one");
  if (change === "symlink") { unlinkSync(join(f.cwd, "a")); symlinkSync("missing-one", join(f.cwd, "a")); }
  const receipt = await run(f.options);
  assert.equal(receipt.snapshot.workspaceManifestVersion, 2); assert.equal(receipt.snapshot.ignoredCachesCovered, false);
  assert.equal(receipt.snapshot.externalInputsCovered, false); assert.equal(receipt.candidateTreeVerified, false);
  if (change === "untracked") writeFileSync(join(f.cwd, "new"), "two");
  if (change === "mode") chmodSync(join(f.cwd, "a"), 0o755);
  if (change === "symlink") { unlinkSync(join(f.cwd, "a")); symlinkSync("missing-two", join(f.cwd, "a")); }
  if (change === "index") { writeFileSync(join(f.cwd, "a"), "staged"); git(f.cwd, "add", "a"); }
  if (change === "branch") git(f.cwd, "symbolic-ref", "HEAD", "refs/heads/moved");
  await assert.rejects(validate(receipt.id, f.options), /stale/);
});

test("working reader preserves original validation context and refuses wrongstage/duplicate identity/history", async (t) => {
  const f = fixture(t), receipt = await run(f.options); let revision = 1;
  const options = await commitOptions(f, { readAuthorityRevisionSync: () => String(revision) });
  assert.equal(await reader.validate(receipt.id, options), receipt); reader.assertCurrentSync(receipt.id, options);
  for (const patch of [{ sessionId: "foreign" }, { checkIndex: 1 }, { stage: "integration" }]) await assert.rejects(reader.validate(receipt.id, { ...options, ...patch }));
  revision++;
  await assert.rejects(reader.validate(receipt.id, options)); assert.throws(() => reader.assertCurrentSync(receipt.id, options));
});

test("paired verification independently overlaps selected checks and ignores unrelated refs", async (t) => {
  const f = fixture(t), feature = join(f.home, "feature"); git(f.cwd, "worktree", "add", "-qb", "feature", feature);
  const policy = { mode: "worktree", baseBranch: "main", onCreate: "continue", commits: "manual",
    checks: [{ label: "pair", argv: [process.execPath, "-e", "process.exit(0)"] }], integration: { targetBranch: "main", method: "merge" } };
  const options = { sessionId: f.options.sessionId, cwd: feature, agentDir: f.agentDir, checkIndex: 0,
    review: await reviewGitBranches(feature, "feature", "main"), getPolicy: () => policy, isTrusted: () => true, testContainmentBackend: createTestContainmentBackend() };
  const receipt = await paired(options);
  let release, entered;
  const gate = new Promise(r => { release = r; }), ready = new Promise(r => { entered = r; });
  const pending = paired({ ...options, testBeforeReceiptRegistration: async () => { entered(); await gate; } });
  await ready;
  const selected = await run({ ...f.options, selector: { repositoryPath: f.cwd, checkoutPath: feature } });
  git(f.cwd, "update-ref", "refs/heads/unrelated", "HEAD"); release();
  const second = await pending;
  assert.equal(pairedLookup(receipt.id), receipt); assert.equal(pairedLookup(second.id), second); assert.equal(lookup(selected.id), selected);
  assert.deepEqual(receipt.relevantRefs, ["refs/heads/feature", "refs/heads/main"]);
});

async function savedContext(f) {
  const document = { version: 1, paused: false, global: {}, projects: { [f.cwd]: { checks: f.policy.settings.checks } } };
  saveSettings(document, f.agentDir, [{ kind: "project", projectRoot: f.cwd }]);
  const sourceGetPolicy = async source => {
    const state = await loadGitProjectSettings(source, [], f.agentDir, f.options.sessionId);
    return { policyRevision: gitWorkflowPolicyRevision(state), settings: state.resolved.project.values, savedProjectSettings: state.project };
  };
  // Trusted fixture actor: monotonically advanced authorization, actual scoped
  // policy revision independently checked by sourceGetPolicy and prerequisite.
  let actorRevision = 1;
  const context = { sessionId: f.options.sessionId, agentDir: f.agentDir, receiptIds: [], sourceGetPolicy,
    isTrusted: () => true, isSelectionAuthorized: () => true, isCheckAuthorized: () => true,
    readAuthorityRevisionSync: () => String(actorRevision) };
  return { context, document, revoke: () => { actorRevision += 2; } };
}

test("required commit prerequisite accepts authentic working receipts and exact native protected FD, rejects copied boundary", async (t) => {
  const f = fixture(t), { context } = await savedContext(f);
  writeFileSync(join(f.cwd, "a"), "staged\n"); git(f.cwd, "add", "a"); writeFileSync(join(f.cwd, "a"), "unstaged\n");
  const receipt = await run({ ...f.options, getPolicy: context.sourceGetPolicy, readAuthorityRevisionSync: context.readAuthorityRevisionSync });
  context.receiptIds.push(receipt.id);
  const verified = await capture(f.cwd, context), preview = await native.prepareGitCommit(f.cwd, ["a"], "staged"), message = "fixture exact";
  bind(verified.handle, preview, message);
  const source = await selectGitProjectResources(f.cwd), originalIndex = readFileSync(join(source.gitDir, "index"));
  const owner = { sessionId: context.sessionId, sessionFile: f.owner.getSessionFile(), generation: "fixture-original" };
  const binding = native.gitCommitInvocationBinding(source, preview, message, owner);
  const invocation = captureGitInvocation(binding, { readAuthorityRevisionSync: context.readAuthorityRevisionSync,
    assertCurrentSync(actual) { assert.equal(actual.owner.sessionId, f.owner.getSessionId()); assert.equal(actual.candidateSha256, binding.candidateSha256); } });
  const operation = await beginSupervisedGitOperationIntent(source, randomUUID(), "commit", f.agentDir);
  const result = await native.confirmGitCommit(preview, message, async (_intended, ownedLock) => {
    const boundary = native.captureGitCommitProtectedBoundary(ownedLock, operation, source, invocation, binding, f.agentDir);
    await assert.rejects(revalidate(verified.handle, preview, message, { ...boundary }, context.sessionId));
    return revalidate(verified.handle, preview, message, boundary, context.sessionId);
  }, { operation, invocation, binding });
  assert.equal(result.status, "committed"); assert.equal(git(f.cwd, "show", "HEAD:a"), "staged");
  assert.deepEqual(readFileSync(join(source.gitDir, "index")), originalIndex);
  assert.equal(readFileSync(join(f.cwd, "a"), "utf8"), "unstaged\n");
});

test("corrupt history is diagnostic only and restart/restored JSON cannot reconstruct receipt authority", async (t) => {
  const f = fixture(t), history = join(f.agentDir, "pi-web", "git-operation-admission", "v1");
  mkdirSync(history, { recursive: true, mode: 0o700 }); writeFileSync(join(history, "corrupt"), "unsettled historical bytes");
  const receipt = await run(f.options);
  assert.equal(readFileSync(join(history, "corrupt"), "utf8"), "unsettled historical bytes");
  const file = join(f.home, "historical-receipt.json"); writeFileSync(file, JSON.stringify(receipt));
  const script = `const {createJiti}=require('jiti'); (async()=>{ const m=await createJiti(process.cwd()+'/lib/git-verification-independent.test.mjs').import('./git-checkout-verification.ts'); const row=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(m.lookupGitCheckoutVerificationReceipt(row.id)||m.readGitCheckoutVerificationNativeExecution(row))process.exit(1); })().catch(()=>process.exit(2))`;
  execFileSync(process.execPath, ["-e", script, file], { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
  assert.equal(await validate(receipt.id, f.options), receipt);
});

test("unrelated saved Project insertion does not revoke captured commit prerequisites", async (t) => {
  const f = fixture(t, []), { context, document } = await savedContext(f);
  writeFileSync(join(f.cwd, "a"), "changed\n");
  const verified = await capture(f.cwd, context), preview = await native.prepareGitCommit(f.cwd, ["a"]); bind(verified.handle, preview, "message");
  const other = join(f.home, "other-project"); git(f.home, "init", "-qb", "other", other);
  document.projects[other] = { checks: [check()] };
  saveSettings(document, f.agentDir, [{ kind: "project", projectRoot: other }]);
  (await revalidate(verified.handle, preview, "message"))();
});

test("required insertion after zero baseline and authority change-and-restore reject original prerequisite", async (t) => {
  const f = fixture(t, []), { context, document, revoke } = await savedContext(f);
  writeFileSync(join(f.cwd, "a"), "changed\n");
  const verified = await capture(f.cwd, context), preview = await native.prepareGitCommit(f.cwd, ["a"]); bind(verified.handle, preview, "message");
  document.projects[f.cwd].checks = [check()]; saveSettings(document, f.agentDir, [{ kind: "project", projectRoot: f.cwd }]);
  await assert.rejects(revalidate(verified.handle, preview, "message"), /stale/);
  document.projects[f.cwd].checks = []; saveSettings(document, f.agentDir, [{ kind: "project", projectRoot: f.cwd }]);
  await assert.rejects(revalidate(verified.handle, preview, "message"), /stale/);
  const fresh = await capture(f.cwd, context); bind(fresh.handle, preview, "message"); revoke();
  await assert.rejects(revalidate(fresh.handle, preview, "message"), /stale/);
});
