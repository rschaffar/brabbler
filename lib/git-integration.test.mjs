import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const configHome = mkdtempSync(join(tmpdir(), "native-integration-config-"));
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  rmSync(configHome, { recursive: true, force: true }); });
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const { createJiti } = await import("jiti"), jiti = createJiti(import.meta.url);
const { prepareIntegration, confirmIntegration, prepareFastForwardIntegration, confirmFastForwardIntegration, readGitIntegrationNativeOutcome, retireGitIntegrationPlan } = await jiti.import("./git-integration.ts");
const { runGitVerification, lookupGitVerificationReceipt } = await jiti.import("./git-verification.ts");
const { createGitCheckCohort, retireGitCheckCohort } = await jiti.import("./git-check-runner.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, method = "merge") {
  const home = mkdtempSync(join(tmpdir(), "native-paired-integration-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const target = join(home, "target"), feature = join(home, "feature"), agentDir = join(home, "agent"); mkdirSync(agentDir);
  git(home, "init", "-qb", "target", target); git(target, "config", "user.name", "Test"); git(target, "config", "user.email", "test@example.com");
  git(target, "config", "core.autocrlf", "false"); writeFileSync(join(target, "note"), "base\n"); git(target, "add", "."); git(target, "commit", "-qm", "base");
  git(target, "worktree", "add", "-qb", "feature", feature); writeFileSync(join(feature, "note"), "feature\n"); git(feature, "add", "."); git(feature, "commit", "-qm", "feature");
  allowFileRoot(target); allowFileRoot(feature);
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual", integration: { targetBranch: "target", method },
    checks: [{ label: "required", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const owner = { sessionId: "paired-session", sessionFile: join(home, "session.json"), generation: "generation-1" }; writeFileSync(owner.sessionFile, JSON.stringify(owner));
  const live = { revision: 1, allowed: true, applying: false, digest: undefined, approved: undefined };
  const read = () => String(live.revision);
  const options = { sessionId: owner.sessionId, cwd: feature, agentDir, featureBranch: "feature", receiptIds: [], getPolicy: () => policy,
    nativeAuthority: { owner, readAuthorityRevisionSync: read, assertCurrentSync(binding) {
      assert.ok(live.allowed); assert.deepEqual(binding.owner, owner); assert.equal(readFileSync(owner.sessionFile, "utf8"), JSON.stringify(owner));
      if (live.applying) assert.equal(binding.candidateSha256, live.approved); else live.digest = binding.candidateSha256;
    } } };
  const check = async (checkIndex = 0, cohort, sessionId = owner.sessionId) => runGitVerification({ sessionId, cwd: feature, agentDir,
    review: await reviewGitBranches(feature, "feature", "target"), checkIndex, ...(cohort ? { cohort } : {}),
    getPolicy: () => policy, isTrusted: () => live.allowed, readAuthorityRevisionSync: read,
    testContainmentBackend: createTestContainmentBackend() });
  const verified = async () => { const r = await check(); options.receiptIds = [r.id]; return options; };
  const apply = (plan) => { live.applying = true; live.approved = live.digest;
    return (method === "ff" ? confirmFastForwardIntegration : confirmIntegration)(plan.planId, plan.planId, owner.sessionId); };
  return { target, feature, policy, options, live, verified, check, apply };
}
for (const method of ["merge", "ff"]) test(`paired ${method} requires actual receipts and applies exact requested commit semantics`, async (t) => {
  const f = fixture(t, method), prepare = method === "ff" ? prepareFastForwardIntegration : prepareIntegration;
  await assert.rejects(prepare(f.options)); const p = await prepare(await f.verified());
  const exact = structuredClone(p); p.review.featureOid = p.review.targetOid; // returned plan is not private execution authority
  const result = await f.apply(p); assert.equal(result.status, "integrated");
  assert.equal(git(f.target, "rev-parse", "HEAD"), method === "ff" ? exact.featureOid : exact.mergeOid);
  assert.equal(git(f.target, "show", "-s", "--format=%P", "HEAD"), method === "ff" ? exact.parents.join(" ") : `${exact.review.targetOid} ${exact.review.featureOid}`);
  assert.equal(readGitIntegrationNativeOutcome(result).status, "complete"); assert.equal(readGitIntegrationNativeOutcome({ ...result }), undefined);
  assert.equal(git(f.target, "status", "--porcelain"), ""); assert.equal(existsSync(join(f.target, ".git", "index.lock")), false);
  await assert.rejects(f.apply(p));
});
test("legacy callers missing genuine owner cannot regain effects through reservation callbacks", async (t) => {
  const f = fixture(t); await f.verified(); await assert.rejects(prepareIntegration({ ...f.options, nativeAuthority: undefined }), /original native invocation/);
  const p = await prepareIntegration(f.options), before = git(f.target, "rev-parse", "HEAD");
  await assert.rejects(confirmIntegration(p.planId, p.planId, f.options.sessionId, async () => { throw Error("must not execute"); }), /legacy/);
  assert.equal(git(f.target, "rev-parse", "HEAD"), before);
});
test("same own required failed recipe cannot integrate with empty receipts", async (t) => {
  const f = fixture(t); f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(f.verified()); await assert.rejects(prepareIntegration(f.options));
});
for (const side of ["feature", "target"]) test(`paired original ${side} receipt index cannot be freshly rebased before native capture`, async (t) => {
  const f = fixture(t); await f.verified();
  const cwd = f[side], index = git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index"), previous = readFileSync(index);
  const targetOid = git(f.target, "rev-parse", "HEAD");
  const time = new Date("2001-01-01T00:00:00Z"); utimesSync(join(cwd, "note"), time, time); git(cwd, "update-index", "--refresh");
  assert.notDeepEqual(readFileSync(index), previous); assert.equal(git(cwd, "status", "--porcelain"), "");
  assert.ok(lookupGitVerificationReceipt(f.options.receiptIds[0]), "lookup authenticates authority/cohort, intentionally not source freshness");
  await assert.rejects(prepareIntegration(f.options), /source changed/);
  assert.equal(git(f.target, "rev-parse", "HEAD"), targetOid); assert.equal(existsSync(join(f.target, ".git", "index.lock")), false);
});
test("paired preflight original errors have private no-checkout-effect facts and generic plan retirement is identity-only", async (t) => {
  const f = fixture(t), p = await prepareIntegration(await f.verified());
  assert.equal(retireGitIntegrationPlan({ ...p }), false); assert.equal(retireGitIntegrationPlan(p.planId), false);
  assert.equal(retireGitIntegrationPlan(p), true); assert.equal(retireGitIntegrationPlan(p), true);
  await assert.rejects(f.apply(p), (e) => {
    assert.equal(readGitIntegrationNativeOutcome(e).status, "no-checkout-effect"); assert.equal(readGitIntegrationNativeOutcome(e).refPrepared, false);
    assert.equal(readGitIntegrationNativeOutcome({ ...e }), undefined); return true;
  });
});
test("legacy paired extended recipes still refuse, including explicit none; no check waiver", async (t) => {
  const f = fixture(t); f.policy.checks[0].requiredStage = "none";
  await assert.rejects(f.verified(), /extended check recipe execution unsupported/);
  await assert.rejects(prepareIntegration(f.options));
});
for (const method of ["ff", "merge"]) test(`paired batch ${method}: reject two genuine independent cohorts, accept one complete original batch`, async (t) => {
  const f = fixture(t, method), prepare = method === "ff" ? prepareFastForwardIntegration : prepareIntegration;
  f.policy.checks.push({ label: "second", argv: [process.execPath, "-e", "process.exit(0)"] });
  const independent = [await f.check(0), await f.check(1)]; f.options.receiptIds = independent.map((r) => r.id);
  assert.ok(independent.every((r) => lookupGitVerificationReceipt(r.id) === r));
  await assert.rejects(prepare(f.options), /batch|cohort/);
  const cohort = createGitCheckCohort([0, 1]), first = await f.check(0, cohort), second = await f.check(1, cohort);
  f.options.receiptIds = [first.id]; await assert.rejects(prepare(f.options));
  f.options.receiptIds = [first.id, first.id]; await assert.rejects(prepare(f.options));
  f.options.receiptIds = [second.id, first.id]; await assert.rejects(prepare(f.options));
  f.options.receiptIds = [first.id, second.id]; const p = await prepare(f.options);
  assert.equal((await f.apply(p)).status, "integrated");
});
test("paired batch failed/retired own siblings cannot qualify; independent other-session failure preserves original batch", async (t) => {
  const f = fixture(t), flag = join(f.options.agentDir, "fail-second");
  f.policy.checks.push({ label: "second", argv: [process.execPath, "-e", "process.exit(require('node:fs').existsSync(process.argv[1])?1:0)", flag] });
  const valid = createGitCheckCohort([0, 1]), rows = [await f.check(0, valid), await f.check(1, valid)];
  const failed = createGitCheckCohort([0, 1]), member = await f.check(0, failed);
  writeFileSync(flag, "fail"); await assert.rejects(f.check(1, failed));
  f.options.receiptIds = [member.id, rows[1].id]; await assert.rejects(prepareIntegration(f.options));
  const unrelated = createGitCheckCohort([0, 1]); await f.check(0, unrelated, "other-session");
  await assert.rejects(f.check(1, unrelated, "other-session"));
  assert.ok(rows.every((r) => lookupGitVerificationReceipt(r.id) === r));
  f.options.receiptIds = rows.map((r) => r.id); const p = await prepareIntegration(f.options);
  assert.equal((await f.apply(p)).status, "integrated");
});
for (const phase of ["before-apply", "after-checkout"]) test(`paired batch retirement at ${phase} never reauthorizes a captured native plan`, async (t) => {
  const f = fixture(t), cohort = createGitCheckCohort([0, 1]);
  f.policy.checks.push({ label: "second", argv: [process.execPath, "-e", "process.exit(0)"] });
  f.options.receiptIds = [(await f.check(0, cohort)).id, (await f.check(1, cohort)).id];
  if (phase === "after-checkout") f.options.afterCheckout = () => retireGitCheckCohort(cohort);
  const p = await prepareIntegration(f.options), old = git(f.target, "rev-parse", "HEAD");
  if (phase === "before-apply") retireGitCheckCohort(cohort);
  await assert.rejects(f.apply(p), (e) => {
    const measured = readGitIntegrationNativeOutcome(e); assert.equal(measured.checkoutAttempted, phase === "after-checkout");
    assert.equal(measured.refCommitSent, false); return true;
  });
  assert.equal(git(f.target, "rev-parse", "HEAD"), old); assert.equal(existsSync(join(f.target, ".git", "index.lock")), false);
});
test("unrelated ref movement is not paired evidence invalidation", async (t) => {
  const f = fixture(t); await f.verified(); const p = await prepareIntegration(f.options);
  git(f.target, "branch", "unrelated", "target"); assert.equal((await f.apply(p)).status, "integrated");
});
