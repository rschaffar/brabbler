import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";

const { createJiti } = await import("jiti");
const { runGitVerification, lookupGitVerificationReceipt, inspectGitVerificationReceipts, invalidateGitVerificationReceiptsForCheckout, isGitVerificationRunning,
  captureGitCheckRecoverySnapshot, gitCheckRecoveryDigest } =  await createJiti(import.meta.url).import("./git-verification.ts");
const { reviewGitBranches } = await import("./git-review.ts");
const { allowFileRoot } = await createJiti(import.meta.url).import("./file-access.ts");
const { selectGitProjectResources } = await createJiti(import.meta.url).import("./git-project-resources.ts");
const { assertGitOperationAdmission, inspectGitOperationAdmission, readGitCheckRecoveryEvidence, readUnresolvedGitCheckRecovery } =  await createJiti(import.meta.url).import("./git-operation-admission.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-verify-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const target = join(home, "target"), feature = join(home, "feature"), agentDir = join(home, "agent");
  const testContainmentBackend = createTestContainmentBackend();
  git(home, "init", "-q", "-b", "target", target);
  git(target, "config", "user.name", "Test");
  git(target, "config", "user.email", "test@example.com");
  writeFileSync(join(target, "note"), "base\n");
  git(target, "add", "note");
  git(target, "commit", "-qm", "base");
  git(target, "worktree", "add", "-qb", "feature", feature);
  allowFileRoot(target); allowFileRoot(feature);
  writeFileSync(join(feature, "note"), "feature\n");
  git(feature, "add", "note");
  git(feature, "commit", "-qm", "feature");
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" }, checks: [{ label: "check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const options = async (extra = {}) => ({ sessionId: "test-session", cwd: feature, agentDir, testContainmentBackend,
    review: await reviewGitBranches(feature, "feature", "target"), checkIndex: 0,
    getPolicy: () => policy, isTrusted: () => true, ...extra });
  return { home, target, feature, agentDir, policy, options };
}

test("one saved argv yields a private log and process-local receipt, not an all-checks approval", async (t) => {
  const f = fixture(t);
  f.policy.checks.push({ label: "not run", argv: [process.execPath, "-e", "process.exit(9)"] });
  const receipt = await runGitVerification(await f.options());
  assert.equal(receipt.exitStatus, 0);
  assert.equal(receipt.checkIndex, 0);
  assert.deepEqual(receipt.argv, f.policy.checks[0].argv);
  assert.equal(lookupGitVerificationReceipt(receipt.id), receipt);
  assert.deepEqual(inspectGitVerificationReceipts("test-session").filter((r) => r.id === receipt.id), [receipt]);
  assert.equal(lookupGitVerificationReceipt("unknown"), undefined);
  const log = join(f.agentDir, "pi-web", "git-verification-logs", `${receipt.id}.log`);
  assert.equal(readFileSync(log, "utf8"), "");
  if (process.platform !== "win32") {
    assert.equal(statSync(log).mode & 0o777, 0o600);
    assert.equal(statSync(join(f.agentDir, "pi-web", "git-verification-logs")).mode & 0o777, 0o700);
  }
});

test("human recovery invalidates old process-local receipts for that checkout", async (t) => {
  const f = fixture(t);
  const receipt = await runGitVerification(await f.options());
  assert.equal(lookupGitVerificationReceipt(receipt.id)?.exitStatus, 0);
  invalidateGitVerificationReceiptsForCheckout(f.feature);
  assert.equal(lookupGitVerificationReceipt(receipt.id), undefined);
  assert.equal(inspectGitVerificationReceipts("test-session").some((item) => item.id === receipt.id), false);
});

test("unavailable containment refuses the saved command before publishing a ledger intent", async (t) => {
  const f = fixture(t);
  const marker = join(f.home, "must-not-run");
  f.policy.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
  const unavailable = { ...createTestContainmentBackend(), absent: async () => false,
    start() { throw new Error("must not launch"); } };
  await assert.rejects(runGitVerification(await f.options({ testContainmentBackend: unavailable })), /containment unavailable/);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(f.agentDir), false, "unsupported hosts must not leave an operation ledger");
});

test("failure and private credential output never escape via return or error", async (t) => {
  const f = fixture(t);
  const secret = "SENSITIVEVALUE987xyz";
  f.policy.checks[0].argv = [process.execPath, "-e", `process.stdout.write(${JSON.stringify(secret)});process.exit(1)`];
  const opts = await f.options();
  await assert.rejects(runGitVerification(opts), (error) => !String(error).includes(secret));
  assert.equal(inspectGitVerificationReceipts("test-session").filter((r) => r.cwd === f.feature).length, 0);
  const logs = readdirSync(join(f.agentDir, "pi-web", "git-verification-logs"));
  assert.equal(logs.length, 1);
  assert.equal(readFileSync(join(f.agentDir, "pi-web", "git-verification-logs", logs[0]), "utf8"), secret);
});

test("a later failed check quarantines the resource even when an older receipt passed", async (t) => {
  const f = fixture(t);
  const good = await runGitVerification(await f.options());
  f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(runGitVerification(await f.options()), /recovery|inspect/);
  assert.equal(lookupGitVerificationReceipt(good.id)?.exitStatus, 0, "an old receipt is not admission authority");
  const selection = await selectGitProjectResources(f.feature);
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unresolved");
  await assert.rejects(assertGitOperationAdmission(selection, f.agentDir), /manual recovery/);
});

// A fake must explicitly opt into labeled simulated evidence. Its proof is
// never published as linux-systemd, even when it claims a positive empty pin.
function proofBackend() {
  const fake = createTestContainmentBackend();
  return { ...fake, async observe(...args) {
    const observation = await fake.observe(...args);
    return { ...observation, identity: `1:2:${observation.unit.InvocationID}:${observation.unit.ControlGroup}` };
  }, async originalEmpty() { return "pinned-populated-zero"; } };
}
function artifact(f, selection) {
  const dir = join(f.agentDir, "pi-web", "git-operation-admission", "v1");
  const resource = join(dir, readdirSync(dir)[0]);
  const id = readdirSync(resource).find((name) => name.endsWith(".json")).slice(0, -5);
  return { resource, id, evidence: () => readGitCheckRecoveryEvidence(f.agentDir, selection.commonDir, id) };
}

test("failed check pre/post recovery snapshots persist across restart without clearing", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.feature);
  f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(runGitVerification(await f.options({ testContainmentBackend: proofBackend(), testRecoveryEvidence: true })), /check failed/);
  const { resource, id, evidence } = artifact(f, selection);
  const saved = evidence();
  const intent = JSON.parse(readFileSync(join(resource, `${id}.json`), "utf8")).record;
  assert.deepEqual(readUnresolvedGitCheckRecovery(f.agentDir, selection.commonDir), {
    id, actionId: intent.actionId, unit: intent.checkUnit, ...saved,
  });
  assert.equal(saved.source, "node-test-simulated");
  assert.equal(saved.cleanupProof.empty, true);
  assert.equal(saved.cleanupProof.payload, "release-attempted");
  assert.equal(saved.outcome.status, 1);
  assert.deepEqual(saved.before, saved.after);
  const current = await captureGitCheckRecoverySnapshot(f.feature, f.target, await f.options().then((o) => o.review),
    createHash("sha256").update(JSON.stringify(f.policy)).digest("hex"), gitCheckRecoveryDigest(0, f.policy.checks[0].argv));
  assert.deepEqual(current, saved.after);
  assert.equal(Object.isFrozen(saved.cleanupProof), true);
  assert.equal(statSync(join(resource, `${id}.pre`)).mode & 0o777, 0o600);
  assert.equal(statSync(join(resource, `${id}.post`)).mode & 0o777, 0o600);
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const m=await createJiti(process.cwd()+'/lib/git-verification.test.mjs').import('./git-operation-admission.ts');
    process.stdout.write(JSON.stringify(m.readGitCheckRecoveryEvidence(process.argv[1],process.argv[2],process.argv[3])));
  })().catch(e=>{console.error(e);process.exitCode=1})`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ["-e", script, f.agentDir, selection.commonDir, id],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8" })), saved);
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unresolved");
  await assert.rejects(assertGitOperationAdmission(selection, f.agentDir), /manual recovery/);
  await assert.rejects(runGitVerification(await f.options()), /recovery|inspect manually/);
});

test("successful check retains its owned settlement, without a manual recovery clear", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.feature);
  const receipt = await runGitVerification(await f.options({ testContainmentBackend: proofBackend(), testRecoveryEvidence: true }));
  assert.equal(receipt.exitStatus, 0);
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "clear");
  assert.throws(() => readUnresolvedGitCheckRecovery(f.agentDir, selection.commonDir));
  await assertGitOperationAdmission(selection, f.agentDir);
});

test("fake cleanup claims do not become production proof without explicit test seam", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.feature);
  f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(runGitVerification(await f.options({ testContainmentBackend: proofBackend() })), /check failed/);
  const { resource, id, evidence } = artifact(f, selection);
  assert.equal(evidence().cleanupProof, undefined);
  assert.equal(readdirSync(resource).includes(`${id}.post`), false);
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unresolved");
});

test("dirty status, changed index bytes and changed refs are captured, never released", async (t) => {
  for (const change of ["status", "index", "refs"]) {
    const f = fixture(t), selection = await selectGitProjectResources(f.feature);
    let command;
    if (change === "status") command = "require('fs').writeFileSync('extra','untracked')";
    else if (change === "index") command = "require('child_process').execFileSync('git',['update-index','--index-version','4'])";
    else command = "require('child_process').execFileSync('git',['update-ref','refs/heads/extra','HEAD'])";
    f.policy.checks[0].argv = [process.execPath, "-e", command];
    await assert.rejects(runGitVerification(await f.options({ testContainmentBackend: proofBackend(), testRecoveryEvidence: true })),
      /check failed|recovery/);
    const { evidence } = artifact(f, selection), saved = evidence();
    assert.ok(saved.cleanupProof);
    if (change === "status") assert.notEqual(saved.before.featureStatus, saved.after.featureStatus);
    if (change === "index") assert.notEqual(saved.before.featureIndex, saved.after.featureIndex);
    if (change === "refs") assert.notEqual(saved.before.refs, saved.after.refs);
    assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unresolved");
  }
});

test("corrupt proof and orphan artifacts fail closed without repair", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.feature);
  f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(runGitVerification(await f.options({ testContainmentBackend: proofBackend(), testRecoveryEvidence: true })), /check failed/);
  const { resource, id, evidence } = artifact(f, selection);
  const post = join(resource, `${id}.post`), original = readFileSync(post);
  writeFileSync(post, original.toString().replace("pinned-populated-zero", "verified-removed"));
  assert.throws(evidence);
  assert.throws(() => readUnresolvedGitCheckRecovery(f.agentDir, selection.commonDir));
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unavailable");
  assert.deepEqual(readFileSync(post), Buffer.from(original.toString().replace("pinned-populated-zero", "verified-removed")));
  writeFileSync(post, original);
  assert.equal(evidence().cleanupProof.empty, true);
  rmSync(join(resource, `${id}.pre`));
  assert.throws(evidence);
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unavailable");
});

test("abort after launch retains cleanup proof but never clears admission", async (t) => {
  const f = fixture(t), selection = await selectGitProjectResources(f.feature), controller = new AbortController();
  f.policy.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('running','1');setTimeout(()=>{},10000)"];
  const running = runGitVerification(await f.options({ testContainmentBackend: proofBackend(), testRecoveryEvidence: true,
    signal: controller.signal }));
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(f.feature, "running")) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(existsSync(join(f.feature, "running")), true, "check actually launched before abort");
  controller.abort();
  await assert.rejects(running, /check failed|recovery/);
  const { evidence } = artifact(f, selection);
  assert.equal(evidence().cleanupProof.empty, true);
  assert.equal(inspectGitOperationAdmission(f.agentDir, selection.commonDir).reason, "unresolved");
});

test("rejects missing checks, untrusted project, and stale review before running anything", async (t) => {
  const f = fixture(t);
  const marker = join(f.home, "marker");
  f.policy.checks = [];
  await assert.rejects(runGitVerification(await f.options()));
  f.policy.checks = [{ label: "check", argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`] }];
  await assert.rejects(runGitVerification(await f.options({ isTrusted: () => false })));
  const stale = await f.options();
  writeFileSync(join(f.feature, "note"), "next\n");
  git(f.feature, "add", "note");
  git(f.feature, "commit", "-qm", "next");
  await assert.rejects(runGitVerification(stale));
  assert.throws(() => readFileSync(marker));
});

test("checkout/index modifications made by a command remain visible and cannot earn a receipt", async (t) => {
  const f = fixture(t);
  f.policy.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('note','changed')"];
  const opts = await f.options();
  await assert.rejects(runGitVerification(opts), /inspect the worktrees manually/);
  assert.equal(readFileSync(join(f.feature, "note"), "utf8"), "changed");
  assert.equal(inspectGitVerificationReceipts("test-session").filter((r) => r.cwd === f.feature).length, 0);
});

test("a check that moves a ref fails closed without undoing its side effect", async (t) => {
  const f = fixture(t);
  const opts = await f.options();
  f.policy.checks[0].argv = [process.execPath, "-e", "require('child_process').execFileSync('git',['update-ref','refs/heads/feature','refs/heads/target'])"];
  await assert.rejects(runGitVerification(opts), /inspect the worktrees manually/);
  assert.equal(git(f.feature, "rev-parse", "feature"), opts.review.targetOid);
  assert.equal(inspectGitVerificationReceipts("test-session").filter((r) => r.cwd === f.feature).length, 0);
});

test("dirty target and a timed-out command cannot earn a receipt", async (t) => {
  const f = fixture(t);
  const opts = await f.options();
  writeFileSync(join(f.target, "note"), "dirty\n");
  await assert.rejects(runGitVerification(opts));
  assert.equal(existsSync(f.agentDir), false);
  writeFileSync(join(f.target, "note"), "base\n");
  f.policy.checks[0].argv = [process.execPath, "-e", "setTimeout(()=>{},10000)"];
  await assert.rejects(runGitVerification({ ...opts, timeoutMs: 100 }), /timed out/);
  assert.equal(inspectGitVerificationReceipts("test-session").filter((r) => r.cwd === f.feature).length, 0);
});

test("policy drift and concurrent submissions fail closed", async (t) => {
  const f = fixture(t);
  f.policy.checks[0].argv = [process.execPath, "-e", "setTimeout(()=>process.exit(0),500)"];
  const options = await f.options();
  const first = runGitVerification(options);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(isGitVerificationRunning(f.feature), true);
  await assert.rejects(runGitVerification(options), /already running/);
  f.policy.checks[0].label = "changed";
  await assert.rejects(first, /policy changed|check failed|policy or check cancelled/);
  assert.equal(isGitVerificationRunning(f.feature), false);
  assert.equal(inspectGitVerificationReceipts("test-session").filter((r) => r.cwd === f.feature).length, 0);
});
