import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { runGitCheckoutVerification: run, lookupGitCheckoutVerificationReceipt: lookup,
  validateGitCheckoutVerificationReceipt: validate, selectGitCheckoutVerificationChecks: select,
  captureGitCheckoutCheckRecoverySnapshot: capture, gitCommitWorkingWorkspaceReceiptReader: commitReader,
  readGitCheckoutVerificationNativeExecution: nativeExecution } = await jiti.import("./git-checkout-verification.ts");
const { runGitVerification: legacyRun, lookupGitVerificationReceipt: legacyLookup, isGitVerificationRunning } = await jiti.import("./git-verification.ts");
const { gitCheckRunningCheckouts } = await jiti.import("./git-check-runner.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { prepareGitCommit, confirmGitCommit, captureGitCommitProtectedBoundary, readGitCommitProtectedBoundary } = await jiti.import("./git-commit.ts");
const { assertGitOperationAdmission, beginSupervisedGitOperationIntent, inspectGitOperationAdmission: admission, readUnresolvedGitCheckRecovery: recovery,
  resolveHumanReviewedGitCheck: resolveReviewed } = await jiti.import("./git-operation-admission.ts");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function proofBackend() {
  const fake = createTestContainmentBackend();
  return { ...fake, async observe(...args) {
    const observation = await fake.observe(...args);
    return { ...observation, identity: `1:2:${observation.unit.InvocationID}:${observation.unit.ControlGroup}` };
  }, async originalEmpty() { return "pinned-populated-zero"; } };
}
const fixtureEnvironmentOwners = new WeakSet();
function fixture(t, delivery = "local") {
  const home = mkdtempSync(join(tmpdir(), "pi-web-selected-check-"));
  if (!fixtureEnvironmentOwners.has(t)) {
    fixtureEnvironmentOwners.add(t);
    const priorHome = process.env.HOME, priorXdg = process.env.XDG_CONFIG_HOME;
    t.after(() => {
      if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
      if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = priorXdg;
    });
  }
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, "xdg");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cwd = join(home, "repo"), agentDir = join(home, "agent");
  git(home, "init", "-q", "-b", "main", cwd);
  git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.com");
  mkdirSync(join(cwd, "checks"));
  writeFileSync(join(cwd, "checks", "note"), "base\n");
  writeFileSync(join(cwd, ".gitignore"), "ignored*\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  allowFileRoot(cwd);
  const policy = { policyRevision: "revision-1", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS,
    mainBranch: "main", delivery, baseBranch: null, targetBranch: null,
    checks: [{ label: "test", argv: [process.execPath, "-e", "process.exit(0)"], cwd: "checks", env: { CI: "1" }, requiredStage: "commit" }] } };
  const options = { sessionId: "selected-check", selector: { repositoryPath: cwd, checkoutPath: cwd }, agentDir,
    checkIndex: 0, stage: "commit", getPolicy: () => policy, isTrusted: () => true,
    isSelectionAuthorized: () => true, isActorAuthorized: () => true,
    testContainmentBackend: proofBackend(), testRecoveryEvidence: true };
  return { home, cwd, agentDir, policy, options };
}
async function failed(t, command = "process.exit(1)", extra = {}) {
  const f = fixture(t);
  if (extra.stage) { f.options.stage = extra.stage; f.policy.settings.checks[0].requiredStage = extra.stage; }
  f.policy.settings.checks[0].argv = [process.execPath, "-e", command];
  const selection = await selectGitProjectResources(f.cwd);
  await assert.rejects(run({ ...f.options, ...extra }));
  return { ...f, selection, evidence: recovery(f.agentDir, selection.commonDir) };
}

test("native execution lifecycle journals actual facts before admission settlement or receipt visibility", async (t) => {
  const f = fixture(t), actionId = randomUUID(), secret = "PRIVATE_CHECK_LOG_12345";
  f.policy.settings.checks[0].argv = [process.execPath, "-e", `process.stdout.write(${JSON.stringify(secret)})`];
  let measured, calls = 0;
  const receipt = await run({ ...f.options, actionId, onExecution: async (row) => {
    calls++; measured = row;
    assert.equal(nativeExecution(row), row);
    assert.equal(nativeExecution(structuredClone(row)), undefined);
    assert.equal(nativeExecution({ ...row }), undefined);
    assert.equal(Object.isFrozen(row), true); assert.equal(Object.isFrozen(row.receipt), true);
    assert.equal(row.actionId, actionId); assert.equal(row.sessionId, f.options.sessionId);
    assert.equal(row.checkIndex, 0); assert.equal(row.stage, "commit");
    assert.match(row.unit, /^pi-web-git-check-.*\.service$/);
    assert.ok(row.cgroupIdentity); assert.ok(row.invocation); assert.ok(row.launcherIdentity);
    assert.equal(row.payload, "release-attempted"); assert.equal(row.exitStatus, 0);
    assert.equal(row.containmentComplete, true); assert.equal(row.timedOut, false); assert.equal(row.overflow, false);
    assert.equal(row.logDigest, hash(secret)); assert.equal(row.logBytes, Buffer.byteLength(secret));
    assert.equal(JSON.stringify(row).includes(secret), false);
    assert.equal(lookup(row.receipt.id), undefined, "proposed receipt is never published during journal I/O");
    const source = await selectGitProjectResources(f.cwd);
    assert.equal(admission(f.agentDir, source.commonDir).reason, "unresolved");
    assert.equal(recovery(f.agentDir, source.commonDir).unit, row.unit);
    await assert.rejects(run(f.options), /running/, "reentrant callback cannot execute a sibling or adopt old passes");
    writeFileSync(join(f.home, "durable-journal"), JSON.stringify(row));
    await Promise.resolve();
    assert.equal(lookup(row.receipt.id), undefined);
  } });
  assert.equal(calls, 1); assert.equal(nativeExecution(receipt), measured);
  assert.equal(nativeExecution(structuredClone(receipt)), undefined);
  assert.equal(measured.receipt.id, receipt.id); assert.equal(measured.receipt.sha256, hash(JSON.stringify(receipt)));
  for (const key of ["recipeDigest", "policyDigest", "snapshotDigest", "environmentDigest", "executionCwd", "startedAt", "finishedAt", "logDigest"])
    assert.equal(measured[key], receipt[key]);
  assert.equal(receipt.snapshot.evidenceScope, "working-workspace");
  assert.equal(receipt.snapshot.candidateTreeVerified, false); assert.equal(receipt.snapshot.repositoryChecksWaived, false);
  assert.equal(lookup(receipt.id), receipt); assert.equal(admission(f.agentDir, receipt.selection.commonDir).reason, "clear");
  assert.deepEqual(JSON.parse(readFileSync(join(f.home, "durable-journal"), "utf8")), measured);
});

test("native execution lifecycle journal failure keeps actual terminal facts and permanently fences previous receipts", async (t) => {
  const f = fixture(t), older = await run(f.options); let measured, calls = 0;
  await assert.rejects(run({ ...f.options, onExecution: async (row) => {
    measured = row; calls++;
    assert.equal(lookup(older.id), undefined, "pending owner hides older cohort");
    assert.equal(lookup(row.receipt.id), undefined);
    throw new Error("SECRET_JOURNAL_IO_ERROR");
  } }), (error) => error.code === "recovery-required" && !error.message.includes("SECRET_JOURNAL_IO_ERROR"));
  assert.equal(calls, 1); assert.equal(nativeExecution(measured), measured);
  assert.equal(lookup(measured.receipt.id), undefined); assert.equal(lookup(older.id), undefined);
  const evidence = recovery(f.agentDir, older.selection.commonDir);
  assert.equal(evidence.unit, measured.unit); assert.equal(evidence.outcome.status, 0);
  assert.equal(evidence.cleanupProof.terminal, true); assert.equal(evidence.cleanupProof.empty, true);
  assert.equal(admission(f.agentDir, older.selection.commonDir).reason, "unresolved");
  assert.throws(() => resolveReviewed(f.agentDir, older.selection.commonDir, evidence.id, evidence.actionId, evidence.after,
    evidence.cleanupProof.invocation, { kind: "human-reviewed-git-check-recovery", id: evidence.id, actionId: evidence.actionId,
      resource: older.selection.commonDir, unit: evidence.unit, proofIdentifier: evidence.cleanupProof.invocation }), /unavailable/,
    "status-0 journal failure stays quarantined; never falsify process exit as a recoverable failure");
  assert.equal(lookup(older.id), undefined, "failed journal cannot revive pre-attempt passes");
});

test("native execution lifecycle remeasures actual bytes and authority after awaited durable recording", async (t) => {
  for (const mutation of ["content", "authority"]) {
    const f = fixture(t), file = join(f.cwd, "checks", "note"); let revision = "1", measured;
    writeFileSync(file, "dirty-before\n");
    const beforeStatus = git(f.cwd, "status", "--porcelain=v1", "-z");
    await assert.rejects(run({ ...f.options, readAuthorityRevisionSync: () => revision, onExecution: async (row) => {
      measured = row; await Promise.resolve();
      if (mutation === "content") { writeFileSync(file, "dirty-after-\n"); assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), beforeStatus); }
      else revision = "2";
    } }), /recovery-required/);
    assert.equal(measured.exitStatus, 0); assert.equal(lookup(measured.receipt.id), undefined);
    const source = await selectGitProjectResources(f.cwd);
    assert.equal(admission(f.agentDir, source.commonDir).reason, "unresolved");
    assert.equal(recovery(f.agentDir, source.commonDir).cleanupProof.terminal, true);
  }
});

test("native execution lifecycle reports failed and prevented payload measurements without synthetic receipt passes", async (t) => {
  for (const mode of ["failed", "prevented"]) {
    const f = fixture(t); let measured;
    if (mode === "failed") f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.exit(7)"];
    else {
      const fake = f.options.testContainmentBackend;
      f.options.testContainmentBackend = { ...fake, async observe(...args) {
        const state = await fake.observe(...args); f.policy.policyRevision = "revoked-at-placement"; return state;
      } };
    }
    await assert.rejects(run({ ...f.options, onExecution: async (row) => { measured = row; } }), /recovery-required/);
    assert.equal(nativeExecution(measured), measured); assert.equal(measured.receipt, undefined);
    assert.equal(measured.exitStatus, mode === "failed" ? 7 : null);
    assert.equal(measured.payload, mode === "failed" ? "release-attempted" : "prevented-before-write");
    assert.ok(measured.unit); assert.ok(measured.cgroupIdentity); assert.ok(measured.invocation);
  }
});

for (const delivery of ["local", "pr", "leave"]) test(`single direct-main checkout verifies ${delivery}, without any target/base or GitReview`, async (t) => {
  const f = fixture(t, delivery);
  if (delivery !== "local") { f.options.stage = "handoff"; f.policy.settings.checks[0].requiredStage = "handoff"; }
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.stdout.write(JSON.stringify([process.cwd(),process.env.CI,process.env['PI_WEB_'+'P'+'ASSWORD'],process.env.NEXT_RUNTIME,process.env.PORT]))"];
  const prior = Object.fromEntries(["PI_WEB_PASSWORD", "NEXT_RUNTIME", "PORT"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { PI_WEB_PASSWORD: "private-value", NEXT_RUNTIME: "server", PORT: "9999" });
  try {
    const receipt = await run(f.options);
    assert.equal(receipt.kind, "selected-checkout-verification"); assert.equal(receipt.version, delivery === "local" ? 3 : 2);
    assert.equal(receipt.exitStatus, 0); assert.equal(receipt.expiresAt - receipt.finishedAt, 15 * 60_000);
    assert.equal(receipt.executionCwd, join(f.cwd, "checks"));
    assert.equal(lookup(receipt.id), receipt); assert.equal(legacyLookup(receipt.id), undefined);
    assert.equal(Object.isFrozen(receipt.selection.identities.checkout), true);
    const serialized = JSON.stringify(receipt);
    for (const forbidden of ["targetCwd", "targetPath", "targetOid", "featurePath", "mergeTreeOid", "reviewDigest", "private-value", '"env"']) assert.equal(serialized.includes(forbidden), false);
    const log = readFileSync(join(f.agentDir, "pi-web", "git-verification-logs", `${receipt.id}.log`), "utf8");
    assert.deepEqual(JSON.parse(log), [join(f.cwd, "checks"), "1", null, null, null]);
    assert.equal(await validate(receipt.id, f.options), receipt);
    assert.equal(admission(f.agentDir, receipt.selection.commonDir).reason, "clear");
  } finally { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } }
});

async function commitOptions(f, extra = {}) {
  const source = await selectGitProjectResources(f.options.selector.checkoutPath);
  return { sessionId: f.options.sessionId, agentDir: f.agentDir, source, checkIndex: 0, stage: "commit",
    sourceGetPolicy: () => ({ ...f.policy, savedProjectSettings: { checks: f.policy.settings.checks } }),
    isTrusted: () => true, isSelectionAuthorized: () => true, isCheckAuthorized: () => true, ...extra };
}

test("actual v3 snapshot compilation binds dirty bytes/index/HEAD and emits only digests plus bounded truthful coverage", async (t) => {
  const f = fixture(t), file = join(f.cwd, "checks", "note"), secret = "PRIVATE_WORKSPACE_BYTES_12345";
  writeFileSync(file, "staged\noriginal\n"); git(f.cwd, "add", "checks/note"); writeFileSync(file, `staged\n${secret}\n`);
  const selection = await selectGitProjectResources(f.cwd), binding = { recipe: f.policy.settings.checks[0], checkIndex: 0, stage: "commit",
    policyDigest: hash(JSON.stringify(f.policy.settings)), policyRevision: f.policy.policyRevision, environmentDigest: hash("fixture-environment") };
  const bytes = readFileSync(join(f.cwd, ".git", "index")), status = git(f.cwd, "status", "--porcelain=v1", "-z");
  const snapshot = await capture(selection, binding, true);
  assert.equal(snapshot.version, 3); assert.equal(snapshot.workspaceIndexDigest, hash(bytes));
  assert.equal(snapshot.evidenceScope, "working-workspace"); assert.equal(snapshot.candidateTreeVerified, false); assert.equal(snapshot.repositoryChecksWaived, false);
  assert.equal(snapshot.workspaceManifestVersion, 2); assert.equal(snapshot.workspaceSummary.paths, snapshot.workspaceSummary.tracked + snapshot.workspaceSummary.untracked);
  assert.equal(snapshot.workspaceSummary.paths, snapshot.workspaceSummary.regularFiles + snapshot.workspaceSummary.symlinks + snapshot.workspaceSummary.absent + snapshot.workspaceSummary.directories);
  assert.equal(JSON.stringify(snapshot).includes(secret), false); assert.equal(JSON.stringify(snapshot).includes("checks/note"), false);
  assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), bytes);
  writeFileSync(file, "staged\nSAME_PORCELAIN_DIFFERENT_BYTES\n"); assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
  const changed = await capture(selection, binding, true);
  assert.notEqual(changed.workspaceContentDigest, snapshot.workspaceContentDigest); assert.equal(changed.workspaceIndexDigest, snapshot.workspaceIndexDigest);
});

test("commit v3 captures the actual dirty partial workspace without staging/importing hunks or claiming candidate-tree verification", async (t) => {
  const f = fixture(t), file = join(f.cwd, "checks", "note"), untracked = join(f.cwd, "untracked");
  writeFileSync(file, "staged\nbase\n"); git(f.cwd, "add", "checks/note"); writeFileSync(file, "staged\nunstaged\n");
  writeFileSync(untracked, "unselected source bytes\n");
  const index = readFileSync(join(f.cwd, ".git", "index")), cached = git(f.cwd, "diff", "--cached", "--no-ext-diff"),
    unstaged = git(f.cwd, "diff", "--no-ext-diff"), status = git(f.cwd, "status", "--porcelain=v1", "-z");
  assert.match(status, /MM checks\/note/);
  const receipt = await run(f.options), options = await commitOptions(f);
  assert.equal(receipt.version, 3); assert.equal(receipt.snapshot.version, 3);
  assert.equal(receipt.evidenceScope, "working-workspace"); assert.equal(receipt.candidateTreeVerified, false); assert.equal(receipt.repositoryChecksWaived, false);
  assert.equal(receipt.snapshot.workspaceCoverage, "tracked-index-head-union-and-nonignored-physical-workspace");
  assert.equal(receipt.snapshot.ignoredCachesCovered, false); assert.equal(receipt.snapshot.externalInputsCovered, false);
  assert.equal(receipt.snapshot.workspaceIndexDigest, hash(index));
  assert.equal(JSON.stringify(receipt).includes("unselected source bytes"), false);
  assert.equal(await commitReader.validate(receipt.id, options), receipt); commitReader.assertCurrentSync(receipt.id, options);
  assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), index);
  assert.equal(git(f.cwd, "diff", "--cached", "--no-ext-diff"), cached); assert.equal(git(f.cwd, "diff", "--no-ext-diff"), unstaged);
  writeFileSync(file, "staged\nDIFFERENT\n"); assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
  await assert.rejects(commitReader.validate(receipt.id, options), /stale/);
  assert.throws(() => commitReader.assertCurrentSync(receipt.id, options), /stale/);
  await assert.rejects(validate(receipt.id, f.options), /stale/);
});

test("v3 validates actual untracked bytes, physical executable mode and symlink target bytes even with unchanged porcelain", async (t) => {
  for (const change of ["untracked", "mode", "symlink"]) {
    const f = fixture(t), file = join(f.cwd, "checks", "note");
    git(f.cwd, "config", "core.fileMode", "false");
    if (change === "untracked") writeFileSync(join(f.cwd, "new"), "first");
    if (change === "symlink") { unlinkSync(file); symlinkSync("missing-one", file); }
    const receipt = await run(f.options), options = await commitOptions(f), status = git(f.cwd, "status", "--porcelain=v1", "-z");
    assert.equal(await commitReader.validate(receipt.id, options), receipt);
    if (change === "untracked") writeFileSync(join(f.cwd, "new"), "other");
    if (change === "mode") chmodSync(file, 0o755);
    if (change === "symlink") { unlinkSync(file); symlinkSync("missing-two", file); }
    assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
    await assert.rejects(commitReader.validate(receipt.id, options), /stale/);
    assert.throws(() => commitReader.assertCurrentSync(receipt.id, options), /stale/);
  }
});

test("dirty v3 sibling saved commit indexes coexist with different cwd/env and individually native validation", async (t) => {
  const f = fixture(t); writeFileSync(join(f.cwd, "checks", "note"), "dirty workspace\n");
  writeFileSync(join(f.cwd, "untracked"), "input\n");
  f.policy.settings.checks.push({ label: "other", argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", env: { CI: "2" }, requiredStage: "commit" });
  const first = await run(f.options), second = await run({ ...f.options, checkIndex: 1 }), options = await commitOptions(f);
  assert.equal(first.version, 3); assert.equal(second.version, 3);
  assert.equal(first.snapshot.workspaceContentDigest, second.snapshot.workspaceContentDigest);
  assert.notEqual(first.snapshot.cwdIdentity, second.snapshot.cwdIdentity); assert.notEqual(first.environmentDigest, second.environmentDigest);
  assert.equal(await commitReader.validate(first.id, options), first);
  assert.equal(await commitReader.validate(second.id, { ...options, checkIndex: 1 }), second);
  commitReader.assertCurrentSync(first.id, options); commitReader.assertCurrentSync(second.id, { ...options, checkIndex: 1 });
});

test("commit reader rejects genuine v2 evidence, wrong stages/indexes/session, unknown sync context and expired v3 without upgrading", async (t) => {
  const old = fixture(t); old.options.stage = "integration"; old.policy.settings.checks[0].requiredStage = "integration";
  const v2 = await run(old.options), oldOptions = await commitOptions(old);
  assert.equal(v2.version, 2); await assert.rejects(commitReader.validate(v2.id, oldOptions), /stale/);
  const f = fixture(t), v3 = await run(f.options), options = await commitOptions(f);
  assert.throws(() => commitReader.assertCurrentSync(v3.id, options), /stale/, "no earlier native validation fence");
  for (const change of [{ sessionId: "foreign" }, { checkIndex: 1 }, { stage: "integration" }]) await assert.rejects(commitReader.validate(v3.id, { ...options, ...change }), /stale/);
  const now = Date.now;
  try { Date.now = () => v3.expiresAt; await assert.rejects(commitReader.validate(v3.id, options), /stale/); }
  finally { Date.now = now; }
});

test("ordinary v3 refuses locks, all unsafe index flags, conflicts and operation markers before launch", async (t) => {
  for (const unsafe of ["index.lock", "HEAD.lock", "MERGE_HEAD", "skip-worktree", "assume-unchanged", "intent-to-add", "conflict"]) {
    const f = fixture(t), marker = join(f.home, "no-command");
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    if (unsafe.endsWith("lock") || unsafe === "MERGE_HEAD") writeFileSync(join(f.cwd, ".git", unsafe), "blocked");
    else if (unsafe === "intent-to-add") { writeFileSync(join(f.cwd, "intent"), "pending\n"); git(f.cwd, "add", "-N", "intent"); }
    else if (unsafe === "conflict") {
      const oid = git(f.cwd, "rev-parse", "HEAD:checks/note");
      execFileSync("git", ["-C", f.cwd, "update-index", "--index-info"], { input: `0 ${"0".repeat(40)}\tchecks/note\n100644 ${oid} 1\tchecks/note\n100644 ${oid} 2\tchecks/note\n` });
    } else git(f.cwd, "update-index", `--${unsafe}`, "checks/note");
    await assert.rejects(run(f.options)); assert.equal(existsSync(marker), false); assert.equal(existsSync(f.agentDir), false);
  }
});

test("native v3 handoff accepts only its authentic joint owner/FD lock and reads the REAL old index, never candidate lock bytes", async (t) => {
  const f = fixture(t), file = join(f.cwd, "checks", "note");
  writeFileSync(file, "staged\nbase\n"); git(f.cwd, "add", "checks/note"); writeFileSync(file, "staged\nunstaged\n");
  const receipt = await run(f.options), options = await commitOptions(f), originalIndex = readFileSync(join(f.cwd, ".git", "index")), head = git(f.cwd, "rev-parse", "HEAD");
  await commitReader.validate(receipt.id, options);
  const preview = await prepareGitCommit(f.cwd, ["checks/note"], "staged"), reservation = await beginSupervisedGitOperationIntent(options.source, randomUUID(), "commit", f.agentDir);
  let bound, protectedOptions, checked = false;
  try {
    await assert.rejects(confirmGitCommit(preview, "fixture-no-cas", async (_intended, ownedLock) => {
      assert.throws(() => captureGitCommitProtectedBoundary(ownedLock, { ...reservation, assertOwned() {} }, options.source, f.agentDir), /authentic/, "object-shaped/copy owner is not ledger-issued");
      bound = captureGitCommitProtectedBoundary(ownedLock, reservation, options.source, f.agentDir);
      const proof = readGitCommitProtectedBoundary(bound, options.source, f.agentDir);
      assert.ok(proof); assert.equal(proof.indexDigest, hash(originalIndex));
      writeFileSync(proof.indexLockPath, "candidate-only bytes MUST NOT be the check source");
      await assert.rejects(commitReader.validate(receipt.id, options), /stale/, "ordinary capture cannot skip its index.lock/owned admission");
      await assert.rejects(commitReader.validate(receipt.id, { ...options, protectedBoundary: { ...bound } }), /stale/, "copied joint seal fails");
      protectedOptions = { ...options, protectedBoundary: bound };
      assert.equal(await commitReader.validate(receipt.id, protectedOptions), receipt);
      return () => {
        commitReader.assertCurrentSync(receipt.id, protectedOptions); checked = true;
        throw new Error("intentional stop BEFORE CAS");
      };
    }), /intentional stop BEFORE CAS/);
    assert.equal(checked, true); assert.equal(readGitCommitProtectedBoundary(bound, options.source, f.agentDir), undefined, "expired invocation not proof");
    assert.throws(() => commitReader.assertCurrentSync(receipt.id, protectedOptions), /stale/);
    assert.equal(git(f.cwd, "rev-parse", "HEAD"), head); assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), originalIndex);
  } finally { reservation.resolve(); }
});

test("native protected v3 CAS fence rejects replaced lock, changed ref, other marker, same-porcelain bytes and post-await authority revocation", async (t) => {
  for (const change of ["lock", "ref", "marker", "bytes", "authority"]) {
    const f = fixture(t), file = join(f.cwd, "checks", "note"), untracked = join(f.cwd, "untracked");
    writeFileSync(file, "staged\n"); git(f.cwd, "add", "checks/note"); writeFileSync(file, "unstaged\n"); writeFileSync(untracked, "input-one");
    const receipt = await run(f.options); let revision = 1;
    const options = await commitOptions(f, { readAuthorityRevisionSync: () => String(revision), isCheckAuthorized: async () => true }),
      originalIndex = readFileSync(join(f.cwd, ".git", "index")), head = git(f.cwd, "rev-parse", "HEAD"), status = git(f.cwd, "status", "--porcelain=v1", "-z");
    await commitReader.validate(receipt.id, options);
    const preview = await prepareGitCommit(f.cwd, ["checks/note"], "staged"), reservation = await beginSupervisedGitOperationIntent(options.source, randomUUID(), "commit", f.agentDir);
    let checked = false;
    try {
      await assert.rejects(confirmGitCommit(preview, "must-not-cas", async (_intended, ownedLock) => {
        const bound = captureGitCommitProtectedBoundary(ownedLock, reservation, options.source, f.agentDir), protectedOptions = { ...options, protectedBoundary: bound };
        await commitReader.validate(receipt.id, protectedOptions);
        await Promise.resolve(); // awaited journal/authorization has finished
        if (change === "authority") revision++;
        return () => {
          checked = true;
          if (change === "lock") {
            const proof = readGitCommitProtectedBoundary(bound, options.source, f.agentDir);
            renameSync(proof.indexLockPath, `${proof.indexLockPath}-original`); writeFileSync(proof.indexLockPath, "foreign lock");
          }
          if (change === "ref") git(f.cwd, "update-ref", "refs/heads/foreign-ref", "HEAD");
          if (change === "marker") writeFileSync(join(f.cwd, ".git", "HEAD.lock"), "foreign marker");
          if (change === "bytes") { writeFileSync(untracked, "input-two"); assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status); }
          commitReader.assertCurrentSync(receipt.id, protectedOptions);
          assert.fail("a stale source/authority/owner fence must not permit CAS");
        };
      }), /stale/);
      assert.equal(checked, true); assert.equal(git(f.cwd, "rev-parse", "HEAD"), head);
      assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), originalIndex);
    } finally { reservation.resolve(); }
  }
});

test("v3 never releases payload for Git-invisible nonignored specials or hardlinked administrative bytes", async (t) => {
  for (const unsupported of ["fifo", "admin-hardlink"]) {
    const f = fixture(t), marker = join(f.home, "no-payload");
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    if (unsupported === "fifo") execFileSync("mkfifo", [join(f.cwd, "untracked-pipe")]);
    else linkSync(join(f.cwd, ".git", "config"), join(f.cwd, "admin-copy"));
    await assert.rejects(run(f.options)); assert.equal(existsSync(marker), false);
    assert.equal(existsSync(f.agentDir), false, "unsupported inputs fail before owner publication/launcher");
  }
});

test("noncanonical separate Git administrative selectors fail closed before any v3 payload or receipt", async (t) => {
  const f = fixture(t), admin = join(f.cwd, "actual-admin"), marker = join(f.home, "no-command");
  f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
  renameSync(join(f.cwd, ".git"), admin); writeFileSync(join(f.cwd, ".git"), "gitdir: actual-admin\n");
  git(f.cwd, "config", "core.worktree", f.cwd);
  // Git's primary registration no longer identifies this physical selector.
  // The manifest owner's direct compiler tests cover valid internal admin roots;
  // do not broaden canonical resource selection here or fabricate its identities.
  await assert.rejects(selectGitProjectResources(f.cwd), /registered checkout/);
  await assert.rejects(run(f.options)); assert.equal(existsSync(marker), false); assert.equal(existsSync(f.agentDir), false);
});

test("commit reader final awaited authority/source mutations and same-context revision replacement cannot pass its CAS guard", async (t) => {
  for (const change of ["policy", "source", "grant", "env"]) {
    const f = fixture(t), receipt = await run(f.options); let revision = 1, revoke = false;
    const previous = process.env.CI_COMMIT_FENCE_TEST;
    const options = await commitOptions(f, { readAuthorityRevisionSync: () => String(revision), isCheckAuthorized: async () => {
      if (revoke) {
        await Promise.resolve();
        if (change === "source") writeFileSync(join(f.cwd, "checks", "note"), "late changed bytes\n");
        if (change === "policy" || change === "grant") revision++;
        if (change === "env") process.env.CI_COMMIT_FENCE_TEST = "changed";
      }
      return true;
    } });
    try {
      assert.equal(await commitReader.validate(receipt.id, options), receipt);
      revoke = true; await assert.rejects(commitReader.validate(receipt.id, options), /stale/);
      assert.throws(() => commitReader.assertCurrentSync(receipt.id, options), /stale/);
    } finally { if (previous === undefined) delete process.env.CI_COMMIT_FENCE_TEST; else process.env.CI_COMMIT_FENCE_TEST = previous; }
  }
});

test("final awaited actor can revoke policy/env/selection/trust or change source without releasing any payload", async (t) => {
  for (const change of ["policy", "policy-restored", "environment", "selection", "trust", "source"]) {
    const f = fixture(t), marker = join(f.home, `payload-${change}`), base = proofBackend();
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    const cachedPolicy = structuredClone(f.policy);
    let placed = false, gateActors = 0, revision = 0, changed = false;
    const previous = process.env.CI_FENCE_TEST;
    const options = { ...f.options, getPolicy: () => cachedPolicy, readAuthorityRevisionSync: () => String(revision),
      testContainmentBackend: { ...base, async observe(...args) { const state = await base.observe(...args); if (state.launcherPlaced) placed = true; return state; } },
      isActorAuthorized: async () => {
        if (placed && ++gateActors === 2 && !changed) {
          await Promise.resolve(); // final actor answer remains the previously captured Allow
          changed = true;
          if (change === "policy") { f.policy.settings.enabled = false; revision++; }
          if (change === "policy-restored") { f.policy.settings.enabled = false; revision++; await Promise.resolve(); f.policy.settings.enabled = true; revision++; }
          if (change === "selection" || change === "trust") revision++;
          if (change === "environment") process.env.CI_FENCE_TEST = "revoked-inside-final-await";
          if (change === "source") writeFileSync(join(f.cwd, "checks", "note"), "changed inside final authority await\n");
        }
        return true;
      } };
    try {
      await assert.rejects(run(options)); assert.equal(changed, true);
      assert.equal(existsSync(marker), false);
      const selection = await selectGitProjectResources(f.cwd), evidence = recovery(f.agentDir, selection.commonDir);
      assert.equal(evidence.cleanupProof.payload, "prevented-before-write"); assert.equal(evidence.cleanupProof.empty, true);
      assert.equal(evidence.outcome.containmentComplete, false); assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
      if (change === "source") assert.notDeepEqual(evidence.before, evidence.after, "post-await source is not the earlier optimistic capture");
    } finally { if (previous === undefined) delete process.env.CI_FENCE_TEST; else process.env.CI_FENCE_TEST = previous; }
  }
});

test("a trusted synchronous revision adapter supports genuinely asynchronous live authority callbacks", async (t) => {
  const f = fixture(t), revision = { value: 1 };
  const options = { ...f.options, getPolicy: async () => f.policy, isActorAuthorized: async () => true,
    isSelectionAuthorized: async () => true, isTrusted: async () => true, readAuthorityRevisionSync: () => String(revision.value) };
  const receipt = await run(options);
  assert.equal(await validate(receipt.id, options), receipt);
  revision.value++;
  const rejected = { ...options, isActorAuthorized: async () => { revision.value++; return true; } };
  await assert.rejects(validate(receipt.id, rejected), /stale/, "revision changes during final async validation also invalidate use");
});

test("async authority requires a real synchronous revision adapter; a thenable adapter cannot authorize a release", async (t) => {
  for (const stamp of [undefined, async () => "not-synchronous"]) {
    const f = fixture(t), marker = join(f.home, "must-not-run");
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    await assert.rejects(run({ ...f.options, isActorAuthorized: async () => true, readAuthorityRevisionSync: stamp }));
    assert.equal(existsSync(marker), false);
  }
});

test("late selected registration cannot absorb a failed/recovered or pending legacy attempt after owner settlement", async (t) => {
  for (const disposition of ["recovered", "pending"]) {
    const f = fixture(t), feature = join(f.home, "feature");
    git(f.cwd, "worktree", "add", "-qb", "feature", feature); allowFileRoot(feature);
    f.options.selector.checkoutPath = feature;
    let announce, resume;
    const announced = new Promise((resolve) => { announce = resolve; }), paused = new Promise((resolve) => { resume = resolve; });
    const a = run({ ...f.options, testBeforeReceiptRegistration: async () => { announce(); await paused; } });
    await announced;
    const aId = readdirSync(join(f.agentDir, "pi-web", "git-verification-logs"))[0].slice(0, -4);
    // Model a peer process's independent advisory liveness set. Durable owner/
    // original-unit records remain real; A has already released its reservation.
    gitCheckRunningCheckouts().delete(feature);
    const selection = await selectGitProjectResources(feature), legacyPolicy = { mode: "worktree", baseBranch: "main", onCreate: "continue", commits: "manual",
      integration: { targetBranch: "main", method: "merge" }, checks: [{ label: "foreign", argv: [process.execPath, "-e", "process.exit(1)"] }] };
    let announceB, resumeB;
    const announcedB = new Promise((resolve) => { announceB = resolve; }), pausedB = new Promise((resolve) => { resumeB = resolve; });
    const base = proofBackend(); let held = false;
    const bOptions = { sessionId: "foreign-legacy", cwd: feature, agentDir: f.agentDir, review: await reviewGitBranches(feature, "feature", "main"),
      checkIndex: 0, getPolicy: () => legacyPolicy, isTrusted: () => true, testRecoveryEvidence: true,
      testContainmentBackend: disposition === "recovered" ? base : { ...base, async observe(...args) {
        const state = await base.observe(...args); if (state.launcherPlaced && !held) { held = true; announceB(); await pausedB; } return state;
      } } };
    const b = assert.rejects(legacyRun(bOptions));
    if (disposition === "recovered") {
      await b;
      const evidence = recovery(f.agentDir, selection.commonDir);
      resolveReviewed(f.agentDir, selection.commonDir, evidence.id, evidence.actionId, evidence.after,
        evidence.cleanupProof.invocation, { kind: "human-reviewed-git-check-recovery", id: evidence.id, actionId: evidence.actionId,
          resource: selection.commonDir, unit: evidence.unit, proofIdentifier: evidence.cleanupProof.invocation });
      resume(); await assert.rejects(a);
      assert.equal(lookup(aId), undefined);
    } else {
      await announcedB; resume();
      const receipt = await a;
      assert.equal(lookup(receipt.id), undefined, "pending foreign record was not absorbed into a current baseline");
      await assert.rejects(validate(receipt.id, f.options), /stale/);
      resumeB(); await b;
      const evidence = recovery(f.agentDir, selection.commonDir);
      resolveReviewed(f.agentDir, selection.commonDir, evidence.id, evidence.actionId, evidence.after,
        evidence.cleanupProof.invocation, { kind: "human-reviewed-git-check-recovery", id: evidence.id, actionId: evidence.actionId,
          resource: selection.commonDir, unit: evidence.unit, proofIdentifier: evidence.cleanupProof.invocation });
      assert.equal(lookup(receipt.id), undefined);
    }
  }
});

test("empty configured/required stages are facts, not synthetic success or a repository-check waiver", () => {
  assert.deepEqual(select([], "commit"), { status: "no-defined", checkIndexes: [], repositoryChecksWaived: false });
  const recipes = [{ label: "manual", argv: ["node", "test.js"], requiredStage: "none" }];
  assert.deepEqual(select(recipes, "handoff"), { status: "no-required", checkIndexes: [], repositoryChecksWaived: false });
  assert.deepEqual(select([{ label: "legacy", argv: ["node", "test.js"] }], "integration"),
    { status: "required", checkIndexes: [0], repositoryChecksWaived: false });
  assert.throws(() => select([], "none"));
});

test("manual-only none and absent-extension integration defaults are executable only at their exact stage", async (t) => {
  for (const stage of ["none", "integration"]) {
    const f = fixture(t);
    f.policy.settings.checks[0] = { label: "plain", argv: [process.execPath, "-e", "process.exit(0)"], ...(stage === "none" ? { requiredStage: "none" } : {}) };
    await assert.rejects(run(f.options), /invalid-request/);
    assert.equal(existsSync(f.agentDir), false);
    const receipt = await run({ ...f.options, stage });
    assert.equal(receipt.stage, stage); assert.equal(receipt.executionCwd, f.cwd);
  }
});

test("explicit saved index only; zero configured recipes cannot mint a receipt", async (t) => {
  const f = fixture(t); f.policy.settings.checks = [];
  await assert.rejects(run(f.options), /invalid-request/); assert.equal(existsSync(f.agentDir), false);
});

test("selection, trust and actor authorization are separate live requirements, not confirmation:none grants", async (t) => {
  for (const field of ["isTrusted", "isSelectionAuthorized", "isActorAuthorized"]) {
    const f = fixture(t); f.policy.settings.checkConfirmation = "none";
    await assert.rejects(run({ ...f.options, [field]: () => false }));
    await assert.rejects(run({ ...f.options, [field]: undefined }), /invalid-request/);
    assert.equal(existsSync(f.agentDir), false);
  }
});

test("cwd traversal, symlink/physical escape, alias/noncanonical selector and out-of-range recipe refuse before intent", async (t) => {
  const f = fixture(t), outside = join(f.home, "outside"); mkdirSync(outside);
  symlinkSync(outside, join(f.cwd, "ignored-link"));
  for (const cwd of ["..", "checks/..", outside, "ignored-link"]) {
    f.policy.settings.checks[0].cwd = cwd;
    await assert.rejects(run(f.options)); assert.equal(existsSync(f.agentDir), false);
  }
  f.policy.settings.checks[0].cwd = "checks";
  await assert.rejects(run({ ...f.options, checkIndex: 10 }));
  await assert.rejects(run({ ...f.options, selector: { repositoryPath: join(f.cwd, "checks"), checkoutPath: f.cwd } }));
  symlinkSync(f.cwd, join(f.home, "alias")); allowFileRoot(join(f.home, "alias"));
  await assert.rejects(run({ ...f.options, selector: { repositoryPath: join(f.home, "alias"), checkoutPath: join(f.home, "alias") } }));
  assert.equal(existsSync(f.agentDir), false);
});

test("unavailable containment and nonstandard/active-Git commit checkouts publish no intent", async (t) => {
  const f = fixture(t);
  await assert.rejects(run({ ...f.options, testContainmentBackend: { ...proofBackend(), absent: async () => false } }));
  assert.equal(existsSync(f.agentDir), false);
  // Ordinary dirty working bytes are accepted by commit-stage v3, unlike v2.
  writeFileSync(join(f.cwd, "checks", "note"), "dirty");
  git(f.cwd, "update-index", "--assume-unchanged", "checks/note"); await assert.rejects(run(f.options));
  git(f.cwd, "update-index", "--no-assume-unchanged", "checks/note");
  writeFileSync(join(f.cwd, ".git", "MERGE_HEAD"), git(f.cwd, "rev-parse", "HEAD"));
  await assert.rejects(run(f.options)); assert.equal(existsSync(f.agentDir), false);
});

test("exact v2 evidence survives restart, redacts recipe/env, and retains original-cgroup quarantine", async (t) => {
  const f = await failed(t, "process.exit(1)", { stage: "integration" });
  const { evidence } = f;
  assert.equal(evidence.before.version, 2); assert.deepEqual(evidence.before, evidence.after);
  assert.equal(evidence.source, "node-test-simulated"); assert.equal(evidence.outcome.status, 1);
  assert.equal(evidence.cleanupProof.unit, evidence.unit);
  assert.equal(evidence.cleanupProof.cgroupIdentity.includes(evidence.cleanupProof.invocation), true);
  const keys = Object.keys(evidence.before);
  assert.equal(keys.some((key) => /feature|target|review/.test(key)), false);
  assert.equal(keys.filter((key) => key !== "version").every((key) => /^[a-f0-9]{64}$/.test(evidence.before[key])), true);
  const binding = { recipe: f.policy.settings.checks[0], checkIndex: 0, stage: "integration",
    policyDigest: hash(JSON.stringify(f.policy.settings)), policyRevision: f.policy.policyRevision,
    environmentDigest: evidence.before.environmentDigest };
  assert.deepEqual(await capture(f.selection, binding), evidence.before);
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const m=await createJiti(process.cwd()+'/lib/git-checkout-verification.test.mjs').import('./git-operation-admission.ts');
    process.stdout.write(JSON.stringify(m.readUnresolvedGitCheckRecovery(process.argv[1],process.argv[2])));
  })().catch(()=>process.exitCode=1)`;
  const restored = JSON.parse(execFileSync(process.execPath, ["-e", script, f.agentDir, f.selection.commonDir],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8" }));
  assert.deepEqual(restored, evidence);
  assert.equal(admission(f.agentDir, f.selection.commonDir).reason, "unresolved");
  await assert.rejects(assertGitOperationAdmission(f.selection, f.agentDir), /manual recovery/);
  await assert.rejects(run(f.options));
});

test("changed index/status/HEAD/tree/refs are captured and never undone or passed", async (t) => {
  for (const [command, field] of [
    ["require('fs').writeFileSync('note','changed')", "status"],
    ["require('child_process').execFileSync('git',['update-index','--index-version','4'])", "index"],
    ["require('child_process').execFileSync('git',['update-ref','refs/heads/extra','HEAD'])", "refs"],
    ["require('child_process').execFileSync('git',['commit','--allow-empty','-m','new'])", "head"],
  ]) {
    const f = await failed(t, command);
    assert.notEqual(f.evidence.before[field], f.evidence.after[field]);
    assert.equal(admission(f.agentDir, f.selection.commonDir).reason, "unresolved");
  }
});

test("environment, stage, policy revision and recipe changes invalidate exact process-only evidence", async (t) => {
  for (const change of ["revision", "policy", "recipe", "stage", "env", "cwd-instance"]) {
    const f = fixture(t), receipt = await run(f.options);
    if (change === "revision") f.policy.policyRevision = "revision-2";
    if (change === "policy") f.policy.settings.delivery = "pr";
    if (change === "recipe") f.policy.settings.checks[0].label = "renamed";
    if (change === "stage") f.options.stage = "handoff";
    if (change === "cwd-instance") {
      renameSync(join(f.cwd, "checks"), join(f.cwd, "ignored-old")); mkdirSync(join(f.cwd, "checks"));
      writeFileSync(join(f.cwd, "checks", "note"), "base\n");
    }
    const previous = process.env.PI_SELECTED_CHECK_TEST;
    try {
      if (change === "env") process.env.PI_SELECTED_CHECK_TEST = "changed-value";
      await assert.rejects(validate(receipt.id, f.options), /stale/);
    } finally {
      if (previous === undefined) delete process.env.PI_SELECTED_CHECK_TEST; else process.env.PI_SELECTED_CHECK_TEST = previous;
    }
  }
});

test("15-minute expiry cannot clear quarantine or turn a selected receipt into paired evidence", async (t) => {
  const f = fixture(t), receipt = await run(f.options), now = Date.now;
  try { Date.now = () => receipt.expiresAt; assert.equal(lookup(receipt.id), undefined); }
  finally { Date.now = now; }
  assert.equal(legacyLookup(receipt.id), undefined);
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(run(f.options));
  await assert.rejects(validate(receipt.id, f.options));
  assert.equal(admission(f.agentDir, receipt.selection.commonDir).reason, "unresolved");
});

test("failed private output and callback secrets never escape public errors", async (t) => {
  const f = fixture(t), secret = "PRIVATE987value";
  f.policy.settings.checks[0].argv = [process.execPath, "-e", `process.stdout.write('${secret}');process.exit(1)`];
  await assert.rejects(run(f.options), (error) => !String(error).includes(secret));
  const logs = readdirSync(join(f.agentDir, "pi-web", "git-verification-logs"));
  assert.equal(readFileSync(join(f.agentDir, "pi-web", "git-verification-logs", logs[0]), "utf8"), secret);
  const g = fixture(t);
  await assert.rejects(run({ ...g.options, isActorAuthorized: () => { throw new Error(secret); } }),
    (error) => !String(error).includes(secret));
});

test("crash at containment start persists original unit/pre-state, blocks restart and never replays", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.cwd);
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const j=createJiti(process.cwd()+'/lib/git-checkout-verification.test.mjs');
    const m=await j.import('./git-checkout-verification.ts');
    const access=await j.import('./file-access.ts'); access.allowFileRoot(process.argv[1]);
    const fake=await import(process.cwd()+'/lib/git-check-containment-test-backend.mjs');
    const backend={...fake.createTestContainmentBackend(), start(){ process.exit(77); }};
    await m.runGitCheckoutVerification({sessionId:'crashed', selector:{repositoryPath:process.argv[1],checkoutPath:process.argv[1]},
      agentDir:process.argv[2], checkIndex:0, stage:'commit', getPolicy:()=>JSON.parse(process.argv[3]),
      isTrusted:()=>true, isSelectionAuthorized:()=>true, isActorAuthorized:()=>true, testContainmentBackend:backend});
  })().catch(()=>process.exitCode=78)`;
  assert.throws(() => execFileSync(process.execPath, ["-e", script, f.cwd, f.agentDir, JSON.stringify(f.policy)],
    { cwd: join(import.meta.dirname, ".."), stdio: "pipe" }), (error) => error.status === 77);
  const evidence = recovery(f.agentDir, selection.commonDir);
  assert.equal(evidence.before.version, 3); assert.match(evidence.unit, /^pi-web-git-check-.*\.service$/);
  assert.equal(evidence.after, undefined); assert.equal(evidence.cleanupProof, undefined);
  assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
  await assert.rejects(run(f.options)); await assert.rejects(assertGitOperationAdmission(selection, f.agentDir));
  assert.deepEqual(recovery(f.agentDir, selection.commonDir), evidence);
});

test("uncertain original-cgroup cleanup never earns a receipt or releases admission", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.cwd);
  const backend = { ...proofBackend(), terminal: async () => false };
  await assert.rejects(run({ ...f.options, testContainmentBackend: backend }));
  const evidence = recovery(f.agentDir, selection.commonDir);
  assert.equal(evidence.cleanupProof, undefined); assert.equal(evidence.after, undefined);
  assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
});

test("fake cleanup cannot publish production evidence without explicit simulation", async (t) => {
  const f = await failed(t, "process.exit(1)", { testRecoveryEvidence: false });
  assert.equal(f.evidence.after, undefined); assert.equal(f.evidence.cleanupProof, undefined);
  assert.equal(admission(f.agentDir, f.selection.commonDir).reason, "unresolved");
});

async function waitFor(check, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(check(), true);
}
test("abort and live trust/actor/selection/policy revocation stop long checks and retain quarantine", async (t) => {
  for (const revocation of ["abort", "trust", "actor", "selection", "policy"]) {
    const f = fixture(t), controller = new AbortController(); let permitted = true;
    const field = { trust: "isTrusted", actor: "isActorAuthorized", selection: "isSelectionAuthorized" }[revocation];
    f.policy.settings.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('../ignored-running','1');setTimeout(()=>{},20000)"];
    const running = run({ ...f.options, signal: controller.signal, ...(field ? { [field]: () => permitted } : {}) });
    const rejected = assert.rejects(running);
    await waitFor(() => existsSync(join(f.cwd, "ignored-running")));
    if (revocation === "abort") controller.abort();
    else if (revocation === "policy") f.policy.policyRevision = "revoked";
    else permitted = false;
    await rejected;
    const selection = await selectGitProjectResources(f.cwd), evidence = recovery(f.agentDir, selection.commonDir);
    assert.equal(evidence.cleanupProof.empty, true); assert.equal(evidence.outcome.timedOut, true);
    assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
    assert.equal(isGitVerificationRunning(f.cwd), false);
  }
});

test("new and legacy paired runner share same-checkout running contention in both directions", async (t) => {
  for (const firstKind of ["selected", "legacy"]) {
    const f = fixture(t), feature = join(f.home, "feature");
    git(f.cwd, "worktree", "add", "-qb", "feature", feature); allowFileRoot(feature);
    f.options.selector.checkoutPath = feature;
    f.policy.settings.checks[0].argv = [process.execPath, "-e", "setTimeout(()=>{},800)"];
    const oldPolicy = { mode: "worktree", baseBranch: "main", onCreate: "stay", commits: "manual",
      integration: { targetBranch: "main", method: "merge" }, checks: [{ label: "legacy", argv: [process.execPath, "-e", "setTimeout(()=>{},800)"] }] };
    const oldOptions = { sessionId: "old", cwd: feature, agentDir: f.agentDir, review: await reviewGitBranches(feature, "feature", "main"),
      checkIndex: 0, getPolicy: () => oldPolicy, isTrusted: () => true, testContainmentBackend: createTestContainmentBackend() };
    const first = firstKind === "selected" ? run(f.options) : legacyRun(oldOptions);
    await waitFor(() => isGitVerificationRunning(feature));
    await assert.rejects(firstKind === "selected" ? legacyRun(oldOptions) : run(f.options), /already running|running/);
    await first;
  }
});

test("gated startup/placement rechecks live trust, actor, selection, policy and snapshot BEFORE project payload", async (t) => {
  for (const drift of ["trust", "actor", "selection", "policy", "refs"]) {
    const f = fixture(t), marker = join(f.home, "forbidden"); let allowed = true, releases = 0, placements = 0;
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'forbidden')`];
    const base = proofBackend();
    const backend = { ...base, start(options) {
      const transport = base.start(options), release = transport.release;
      return { ...transport, release(payload) { releases++; release(payload); } };
    }, async observe(...args) {
      const state = await base.observe(...args);
      if (state.launcherPlaced && !placements++) {
        allowed = false;
        if (drift === "policy") f.policy.policyRevision = "changed-during-startup";
        if (drift === "refs") git(f.cwd, "update-ref", "refs/heads/new-ref", "HEAD");
      }
      return state;
    } };
    const field = { trust: "isTrusted", actor: "isActorAuthorized", selection: "isSelectionAuthorized" }[drift];
    await assert.rejects(run({ ...f.options, testContainmentBackend: backend, ...(field ? { [field]: () => allowed } : {}) }));
    assert.equal(placements > 0, true); assert.equal(releases, 0); assert.equal(existsSync(marker), false);
    const selection = await selectGitProjectResources(f.cwd), evidence = recovery(f.agentDir, selection.commonDir);
    assert.equal(evidence.cleanupProof.payload, "prevented-before-write");
    assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
  }
});

test("paired legacy runner also rechecks live policy at the contained payload-release gate", async (t) => {
  const f = fixture(t), feature = join(f.home, "feature"), marker = join(f.home, "forbidden-legacy");
  git(f.cwd, "worktree", "add", "-qb", "feature", feature); allowFileRoot(feature);
  const policy = { mode: "worktree", baseBranch: "main", onCreate: "stay", commits: "manual",
    integration: { targetBranch: "main", method: "merge" }, checks: [{ label: "legacy",
      argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'forbidden')`] }] };
  const base = proofBackend(); let released = false;
  const backend = { ...base, start(options) {
    const transport = base.start(options), release = transport.release;
    return { ...transport, release(payload) { released = true; release(payload); } };
  }, async observe(...args) { const state = await base.observe(...args); policy.checks[0].label = "changed-at-placement"; return state; } };
  await assert.rejects(legacyRun({ sessionId: "legacy", cwd: feature, agentDir: f.agentDir,
    review: await reviewGitBranches(feature, "feature", "main"), checkIndex: 0, getPolicy: () => policy,
    isTrusted: () => true, testContainmentBackend: backend, testRecoveryEvidence: true }));
  assert.equal(released, false); assert.equal(existsSync(marker), false);
  const selection = await selectGitProjectResources(feature);
  assert.equal(recovery(f.agentDir, selection.commonDir).cleanupProof.payload, "prevented-before-write");
  assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
});

for (const swap of ["symlink", "replacement"]) test(`startup ${swap}/restore cannot release a launcher in a foreign cwd instance`, async (t) => {
  const f = fixture(t), cwd = join(f.cwd, "checks"), original = join(f.cwd, "ignored-original"), outside = join(f.home, "foreign");
  mkdirSync(outside); writeFileSync(join(outside, "note"), "base\\n");
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('ignored-forbidden','ran')"];
  const base = proofBackend(); let managerFd, releases = 0;
  t.after(() => { if (managerFd !== undefined) closeSync(managerFd); });
  const backend = { ...base, start(options) {
    assert.match(options.workingDirectory, /^\/proc\/\d+\/fd\/\d+$/);
    renameSync(cwd, original);
    if (swap === "symlink") symlinkSync(outside, cwd); else mkdirSync(cwd);
    // Simulate a manager incorrectly resolving the mutable path at startup.
    // Positive actual-instance proof must detect this even after restoration.
    managerFd = openSync(cwd, constants.O_RDONLY | constants.O_DIRECTORY);
    const transport = base.start({ ...options, workingDirectory: `/proc/${process.pid}/fd/${managerFd}` });
    if (swap === "symlink") rmSync(cwd); else rmSync(cwd, { recursive: true });
    renameSync(original, cwd);
    const release = transport.release;
    return { ...transport, release(payload) { releases++; release(payload); } };
  } };
  await assert.rejects(run({ ...f.options, testContainmentBackend: backend }));
  assert.equal(releases, 0); assert.equal(existsSync(join(outside, "ignored-forbidden")), false);
  assert.equal(existsSync(join(cwd, "ignored-forbidden")), false);
  const selection = await selectGitProjectResources(f.cwd), evidence = recovery(f.agentDir, selection.commonDir);
  assert.deepEqual(evidence.before, evidence.after);
  assert.equal(evidence.cleanupProof.payload, "prevented-before-write");
  assert.equal(admission(f.agentDir, selection.commonDir).reason, "unresolved");
});

test("a manager honoring the original proc-FD cwd stays bound through startup symlink swap and restore", async (t) => {
  const f = fixture(t), cwd = join(f.cwd, "checks"), original = join(f.cwd, "ignored-original"), outside = join(f.home, "outside");
  mkdirSync(outside);
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('ignored-marker','bound')"];
  const base = proofBackend(), backend = { ...base, start(options) {
    renameSync(cwd, original); symlinkSync(outside, cwd);
    const transport = base.start(options);
    rmSync(cwd); renameSync(original, cwd);
    return transport;
  } };
  const receipt = await run({ ...f.options, testContainmentBackend: backend });
  assert.equal(receipt.exitStatus, 0); assert.equal(existsSync(join(outside, "ignored-marker")), false);
  assert.equal(readFileSync(join(cwd, "ignored-marker"), "utf8"), "bound");
});

test("v2 success -> legacy failure -> exact reviewed recovery cannot revive the earlier v2 receipt", async (t) => {
  const f = fixture(t), feature = join(f.home, "feature");
  git(f.cwd, "worktree", "add", "-qb", "feature", feature); allowFileRoot(feature); f.options.selector.checkoutPath = feature;
  const receipt = await run(f.options);
  assert.equal(await validate(receipt.id, f.options), receipt);
  const legacyPolicy = { mode: "worktree", baseBranch: "main", onCreate: "stay", commits: "manual",
    integration: { targetBranch: "main", method: "merge" }, checks: [{ label: "failed", argv: [process.execPath, "-e", "process.exit(1)"] }] };
  await assert.rejects(legacyRun({ sessionId: "old", cwd: feature, agentDir: f.agentDir,
    review: await reviewGitBranches(feature, "feature", "main"), checkIndex: 0, getPolicy: () => legacyPolicy,
    isTrusted: () => true, testContainmentBackend: proofBackend(), testRecoveryEvidence: true }));
  const selection = await selectGitProjectResources(feature), evidence = recovery(f.agentDir, selection.commonDir);
  assert.deepEqual(evidence.before, evidence.after); assert.equal(evidence.cleanupProof.empty, true);
  // Explicit node:test-only simulated review; production caller must freshly
  // verify original stopped invocation and exact state under its checkout gate.
  resolveReviewed(f.agentDir, selection.commonDir, evidence.id, evidence.actionId, evidence.after,
    evidence.cleanupProof.invocation, { kind: "human-reviewed-git-check-recovery", id: evidence.id, actionId: evidence.actionId,
      resource: selection.commonDir, unit: evidence.unit, proofIdentifier: evidence.cleanupProof.invocation });
  assert.equal(admission(f.agentDir, selection.commonDir).reason, "clear");
  assert.equal(lookup(receipt.id), undefined, "lookup not called during quarantine: the durable epoch still prevents resurrection");
  await assert.rejects(validate(receipt.id, f.options), /stale/);
});

test("selected integration-stage sibling recipes with different cwd/env retain individually valid exact receipts", async (t) => {
  const f = fixture(t), feature = join(f.home, "feature");
  git(f.cwd, "worktree", "add", "-qb", "feature", feature); allowFileRoot(feature);
  f.options.selector.checkoutPath = feature; f.options.stage = "integration";
  f.policy.settings.targetBranch = "main";
  f.policy.settings.checks[0].requiredStage = "integration";
  f.policy.settings.checks.push({ label: "second", argv: [process.execPath, "-e", "setTimeout(()=>{},150)"],
    cwd: ".", env: { CI: "2" }, requiredStage: "integration" });
  assert.deepEqual(select(f.policy.settings.checks, "integration").checkIndexes, [0, 1]);
  const first = await run(f.options), base = proofBackend(); let pendingObserved = false;
  const backend = { ...base, async observe(...args) {
    const state = await base.observe(...args);
    if (state.launcherPlaced) { pendingObserved = true; assert.equal(lookup(first.id), undefined, "pending sibling is not usable evidence"); }
    return state;
  } };
  const secondOptions = { ...f.options, checkIndex: 1, testContainmentBackend: backend }, second = await run(secondOptions);
  assert.equal(pendingObserved, true);
  assert.equal(lookup(first.id), first); assert.equal(lookup(second.id), second);
  assert.equal(await validate(first.id, f.options), first); assert.equal(await validate(second.id, secondOptions), second);
  assert.notEqual(first.environmentDigest, second.environmentDigest);
  assert.notEqual(first.snapshot.cwdIdentity, second.snapshot.cwdIdentity);
  assert.equal(first.expiresAt - first.finishedAt, 15 * 60_000, "cohort advancement cannot extend expiry or synthesize a new pass");
  assert.equal(Object.hasOwn(second, "attemptId"), false, "internal settlement identity does not change the public receipt schema");
  assert.equal(Object.hasOwn(second, "settlement"), false, "opaque owner attestation never becomes public evidence");
});

test("failed sibling and reviewed recovery permanently fence the successful cohort even after a fresh same-policy success", async (t) => {
  const f = fixture(t);
  f.policy.settings.checks.push({ label: "failed sibling", argv: [process.execPath, "-e", "process.exit(1)"], requiredStage: "commit" });
  const original = await run(f.options);
  await assert.rejects(run({ ...f.options, checkIndex: 1 }));
  const selection = await selectGitProjectResources(f.cwd), evidence = recovery(f.agentDir, selection.commonDir);
  assert.deepEqual(evidence.before, evidence.after);
  resolveReviewed(f.agentDir, selection.commonDir, evidence.id, evidence.actionId, evidence.after,
    evidence.cleanupProof.invocation, { kind: "human-reviewed-git-check-recovery", id: evidence.id, actionId: evidence.actionId,
      resource: selection.commonDir, unit: evidence.unit, proofIdentifier: evidence.cleanupProof.invocation });
  const fresh = await run(f.options);
  assert.equal(lookup(fresh.id), fresh);
  assert.equal(lookup(original.id), undefined, "same-policy success after recovery must not credit the pre-failure cohort");
  await assert.rejects(validate(original.id, f.options), /stale/);
});

test("later v2 attempt also fences an earlier legacy receipt across both lookup and inspection APIs", async (t) => {
  const f = fixture(t), feature = join(f.home, "feature");
  git(f.cwd, "worktree", "add", "-qb", "feature", feature); allowFileRoot(feature); f.options.selector.checkoutPath = feature;
  const policy = { mode: "worktree", baseBranch: "main", onCreate: "stay", commits: "manual",
    integration: { targetBranch: "main", method: "merge" }, checks: [{ label: "legacy", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const old = await legacyRun({ sessionId: "old", cwd: feature, agentDir: f.agentDir,
    review: await reviewGitBranches(feature, "feature", "main"), checkIndex: 0, getPolicy: () => policy, isTrusted: () => true,
    testContainmentBackend: proofBackend(), testRecoveryEvidence: true });
  assert.equal(legacyLookup(old.id), old);
  const fresh = await run(f.options);
  assert.equal(lookup(fresh.id), fresh); assert.equal(legacyLookup(old.id), undefined);
});

test("actual systemd abort drains detached descendants and preserves quarantine across restart (opt-in)",
  { skip: process.env.PI_WEB_TEST_CGROUP !== "1" }, async (t) => {
    const f = fixture(t), controller = new AbortController();
    const descendant = "setInterval(()=>require('fs').appendFileSync('../ignored-ticks','x'),30)";
    f.policy.settings.checks[0].argv = [process.execPath, "-e",
      `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)`];
    const options = { ...f.options, signal: controller.signal, testContainmentBackend: undefined, testRecoveryEvidence: undefined };
    const running = run(options), rejected = assert.rejects(running);
    await waitFor(() => existsSync(join(f.cwd, "ignored-ticks")));
    controller.abort(); await rejected;
    const selection = await selectGitProjectResources(f.cwd), evidence = recovery(f.agentDir, selection.commonDir);
    assert.equal(evidence.source, "linux-systemd"); assert.equal(evidence.cleanupProof.empty, true);
    assert.equal(evidence.outcome.timedOut, true); assert.deepEqual(evidence.before, evidence.after);
    const bytes = readFileSync(join(f.cwd, "ignored-ticks"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(readFileSync(join(f.cwd, "ignored-ticks")), bytes);
    const script = `const {createJiti}=require('jiti'); (async()=>{
      const m=await createJiti(process.cwd()+'/lib/git-checkout-verification.test.mjs').import('./git-operation-admission.ts');
      process.stdout.write(JSON.stringify(m.inspectGitOperationAdmission(process.argv[1],process.argv[2])));
    })()`;
    const status = JSON.parse(execFileSync(process.execPath, ["-e", script, f.agentDir, selection.commonDir],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8" }));
    assert.equal(status.reason, "unresolved");
  });

test("actual systemd selected-checkout success and failed-run original-cgroup evidence (opt-in)",
  { skip: process.env.PI_WEB_TEST_CGROUP !== "1" }, async (t) => {
    const f = fixture(t);
    const rows = [];
    const options = { ...f.options, testContainmentBackend: undefined, testRecoveryEvidence: undefined,
      onExecution: async (row) => {
        assert.equal(nativeExecution(row), row); assert.match(row.launcherIdentity, /^\d+:\d+:\d+:\d+$/);
        assert.ok(row.cgroupIdentity); assert.ok(row.invocation);
        if (row.receipt) assert.equal(lookup(row.receipt.id), undefined);
        rows.push(row);
      } };
    const receipt = await run(options); assert.equal(receipt.exitStatus, 0);
    assert.equal(rows.length, 1); assert.equal(nativeExecution(receipt), rows[0]); assert.equal(rows[0].receipt.id, receipt.id);
    f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
    await assert.rejects(run(options));
    assert.equal(rows.length, 2); assert.equal(rows[1].exitStatus, 1); assert.equal(rows[1].receipt, undefined);
    const evidence = recovery(f.agentDir, receipt.selection.commonDir);
    assert.equal(evidence.source, "linux-systemd"); assert.equal(evidence.cleanupProof.empty, true);
    assert.equal(admission(f.agentDir, receipt.selection.commonDir).reason, "unresolved");
  });
