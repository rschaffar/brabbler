import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const { prepareIntegration, confirmIntegration } = await createJiti(import.meta.url).import("./git-integration.ts");
const { runGitVerification } = await createJiti(import.meta.url).import("./git-verification.ts");
const { reviewGitBranches } = await import("./git-review.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-integrate-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const target = join(home, "target"), feature = join(home, "feature"), agentDir = join(home, "agent");
  git(home, "init", "-q", "-b", "target", target);
  git(target, "config", "core.autocrlf", "false");
  git(target, "config", "user.name", "Test");
  git(target, "config", "user.email", "test@example.com");
  writeFileSync(join(target, "note"), "base\n");
  git(target, "add", "note"); git(target, "commit", "-qm", "base");
  git(target, "worktree", "add", "-qb", "feature", feature);
  writeFileSync(join(feature, "note"), "feature\n");
  git(feature, "add", "note"); git(feature, "commit", "-qm", "feature");
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" },
    checks: [{ label: "check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const options = { sessionId: "test", cwd: feature, agentDir, featureBranch: "feature", receiptIds: [], getPolicy: () => policy };
  async function verified() {
    const receipt = await runGitVerification({ sessionId: "test", cwd: feature, agentDir,
      review: await reviewGitBranches(feature, "feature", "target"), checkIndex: 0,
      getPolicy: () => policy, isTrusted: () => true });
    options.receiptIds = [receipt.id];
    return options;
  }
  return { home, target, feature, agentDir, policy, options, verified };
}

test("explicit approval installs unsigned two-parent merge and leaves both checkouts clean", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  const plan = await prepareIntegration(options);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.match(plan.diff.patch, /feature/);
  const expected = structuredClone(plan);
  plan.review.featureOid = plan.review.targetOid; // caller cannot mutate server-side approval
  plan.mergeOid = plan.review.targetOid;
  await assert.rejects(confirmIntegration(plan.planId, "wrong", "test"));
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "other-session"), /another session/);
  const result = await confirmIntegration(plan.planId, plan.planId, "test");
  assert.deepEqual(result, { status: "integrated", mergeOid: expected.mergeOid, targetBranch: "target" });
  assert.equal(git(f.target, "rev-parse", "HEAD"), expected.mergeOid);
  assert.equal(git(f.target, "rev-parse", "HEAD^{tree}"), expected.review.featureTreeOid);
  assert.equal(git(f.target, "rev-list", "--parents", "-n", "1", "HEAD"),
    `${expected.mergeOid} ${expected.review.targetOid} ${expected.review.featureOid}`);
  assert.match(git(f.target, "cat-file", "-p", expected.mergeOid), /author Test <test@example.com>/);
  assert.doesNotMatch(git(f.target, "cat-file", "-p", expected.mergeOid), /gpgsig/);
  assert.equal(git(f.target, "status", "--porcelain", "--untracked-files=all"), "");
  assert.equal(git(f.feature, "status", "--porcelain", "--untracked-files=all"), "");
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "test"));
});

test("no receipts, failed receipt and unsupported policy cannot prepare", async (t) => {
  const f = fixture(t);
  await assert.rejects(prepareIntegration(f.options), /receipt/);
  f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(f.verified());
  f.policy.integration.method = "ff";
  await assert.rejects(prepareIntegration(f.options), /ff\/squash/);
  f.policy.integration.method = "squash";
  await assert.rejects(prepareIntegration(f.options), /ff\/squash/);
});

test("every saved check needs its own matching receipt", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  f.policy.checks.push({ label: "second", argv: [process.execPath, "-e", "process.exit(0)"] });
  await assert.rejects(prepareIntegration(options), /receipt/);
  const second = await runGitVerification({ sessionId: "test", cwd: f.feature, agentDir: f.agentDir,
    review: await reviewGitBranches(f.feature, "feature", "target"), checkIndex: 1,
    getPolicy: () => f.policy, isTrusted: () => true });
  options.receiptIds.push(second.id);
  await assert.rejects(prepareIntegration(options), /receipt/); // first receipt belongs to old policy
  const first = await runGitVerification({ sessionId: "test", cwd: f.feature, agentDir: f.agentDir,
    review: await reviewGitBranches(f.feature, "feature", "target"), checkIndex: 0,
    getPolicy: () => f.policy, isTrusted: () => true });
  options.receiptIds[0] = first.id;
  assert.equal((await prepareIntegration(options)).receiptIds.length, 2);
});

test("stale ref, stale index and changed policy invalidate an approved plan before mutation", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  const p = await prepareIntegration(options);
  f.policy.checks[0].label = "changed";
  await assert.rejects(confirmIntegration(p.planId, p.planId, "test"));
  f.policy.checks[0].label = "check";
  const q = await prepareIntegration(options);
  git(f.target, "update-index", "--assume-unchanged", "note");
  await assert.rejects(confirmIntegration(q.planId, q.planId, "test"));
  git(f.target, "update-index", "--no-assume-unchanged", "note");
  const r = await prepareIntegration(options);
  git(f.target, "update-ref", "refs/heads/target", r.review.featureOid, r.review.targetOid);
  await assert.rejects(confirmIntegration(r.planId, r.planId, "test"));
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "base\n");
});

test("hook and ignored collision refuse without touching checkout", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  const hooks = git(f.target, "rev-parse", "--path-format=absolute", "--git-path", "hooks");
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 0\n");
  await assert.rejects(prepareIntegration(options), /hook/);
  rmSync(join(hooks, "pre-commit"));
  // An ignored path in target that is tracked only on feature must not be overwritten.
  writeFileSync(join(f.feature, "collision"), "tracked\n");
  git(f.feature, "add", "collision"); git(f.feature, "commit", "-qm", "collision");
  writeFileSync(join(f.target, ".git", "info", "exclude"), "collision\n");
  writeFileSync(join(f.target, "collision"), "ignored secret\n");
  // Old receipt is stale now; get a fresh one for the new feature tip.
  await f.verified();
  await assert.rejects(prepareIntegration(options), /ignored collision/);
  assert.equal(readFileSync(join(f.target, "collision"), "utf8"), "ignored secret\n");
});

test("changed working file after apply refuses ref update and preserves recovery", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  options.afterCheckout = () => writeFileSync(join(f.target, "note"), "intervening change\n");
  const plan = await prepareIntegration(options);
  const result = await confirmIntegration(plan.planId, plan.planId, "test");
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "intervening change\n");
  assert.equal(JSON.parse(readFileSync(result.recoveryPath, "utf8")).mergeOid, plan.mergeOid);
});

test("new untracked file after apply also refuses ref update", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  options.afterCheckout = () => writeFileSync(join(f.target, "untracked"), "new\n");
  const plan = await prepareIntegration(options);
  const result = await confirmIntegration(plan.planId, plan.planId, "test");
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "untracked"), "utf8"), "new\n");
});

test("hook installed after checkout cannot execute during update-ref", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  const hooks = git(f.target, "rev-parse", "--path-format=absolute", "--git-path", "hooks");
  const marker = join(f.home, "hook-ran");
  options.afterCheckout = () => {
    const hook = join(hooks, "reference-transaction");
    writeFileSync(hook, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`);
    chmodSync(hook, 0o755);
  };
  const plan = await prepareIntegration(options);
  const result = await confirmIntegration(plan.planId, plan.planId, "test");
  assert.equal(result.status, "integrated");
  assert.equal(existsSync(marker), false);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.mergeOid);
});

test("failure after read-tree begins preserves partial state and private recovery record", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  options.afterCheckout = () => { throw new Error("injected failure"); };
  const plan = await prepareIntegration(options);
  const result = await confirmIntegration(plan.planId, plan.planId, "test");
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
  assert.equal(JSON.parse(readFileSync(result.recoveryPath, "utf8")).mergeOid, plan.mergeOid);
  if (process.platform !== "win32") assert.equal(statSync(result.recoveryPath).mode & 0o777, 0o600);
  assert.equal(existsSync(join(f.target, ".git", "index.lock")), false);
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "test"));
});
