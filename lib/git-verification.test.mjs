import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const { runGitVerification, lookupGitVerificationReceipt, inspectGitVerificationReceipts } = await createJiti(import.meta.url).import("./git-verification.ts");
const { reviewGitBranches } = await import("./git-review.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-verify-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const target = join(home, "target"), feature = join(home, "feature"), agentDir = join(home, "agent");
  git(home, "init", "-q", "-b", "target", target);
  git(target, "config", "user.name", "Test");
  git(target, "config", "user.email", "test@example.com");
  writeFileSync(join(target, "note"), "base\n");
  git(target, "add", "note");
  git(target, "commit", "-qm", "base");
  git(target, "worktree", "add", "-qb", "feature", feature);
  writeFileSync(join(feature, "note"), "feature\n");
  git(feature, "add", "note");
  git(feature, "commit", "-qm", "feature");
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" }, checks: [{ label: "check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const options = async (extra = {}) => ({ sessionId: "test-session", cwd: feature, agentDir,
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
  await assert.rejects(runGitVerification(options), /already running/);
  f.policy.checks[0].label = "changed";
  await assert.rejects(first, /policy changed|check failed/);
  assert.equal(inspectGitVerificationReceipts("test-session").filter((r) => r.cwd === f.feature).length, 0);
});
