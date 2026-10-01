import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";

const { createJiti } = await import("jiti");
const { prepareIntegration, confirmIntegration, prepareFastForwardIntegration, confirmFastForwardIntegration,
  GitIntegrationTargetMovedError, invalidateGitIntegrationPlansForResource } = await createJiti(import.meta.url).import("./git-integration.ts");
const { runGitVerification } = await createJiti(import.meta.url).import("./git-verification.ts");
const { beginGitOperationIntent, inspectGitOperationAdmission } = await createJiti(import.meta.url).import("./git-operation-admission.ts");
const { allowFileRoot } = await createJiti(import.meta.url).import("./file-access.ts");
const { reviewGitBranches } = await import("./git-review.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-integrate-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const target = join(home, "target"), feature = join(home, "feature"), agentDir = join(home, "agent");
  mkdirSync(agentDir, { mode: 0o700 });
  git(home, "init", "-q", "-b", "target", target);
  git(target, "config", "core.autocrlf", "false");
  git(target, "config", "user.name", "Test");
  git(target, "config", "user.email", "test@example.com");
  writeFileSync(join(target, "note"), "base\n");
  git(target, "add", "note"); git(target, "commit", "-qm", "base");
  git(target, "worktree", "add", "-qb", "feature", feature);
  allowFileRoot(target); allowFileRoot(feature);
  writeFileSync(join(feature, "note"), "feature\n");
  git(feature, "add", "note"); git(feature, "commit", "-qm", "feature");
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" },
    checks: [{ label: "check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const testContainmentBackend = createTestContainmentBackend();
  const options = { sessionId: "test", cwd: feature, agentDir, featureBranch: "feature", receiptIds: [], getPolicy: () => policy };
  async function verified() {
    const receipt = await runGitVerification({ sessionId: "test", cwd: feature, agentDir,
      review: await reviewGitBranches(feature, "feature", "target"), checkIndex: 0,
      getPolicy: () => policy, isTrusted: () => true, testContainmentBackend });
    options.receiptIds = [receipt.id];
    return options;
  }
  const commonDir = git(feature, "rev-parse", "--path-format=absolute", "--git-common-dir");
  // Native tests reserve a real durable ledger; route tests additionally cover
  // action-journal admission and recovery.
  async function confirm(plan, sessionId = "test") {
    let reservation;
    const result = await confirmIntegration(plan.planId, plan.planId, sessionId, async () => {
      reservation = beginGitOperationIntent(agentDir, commonDir, randomUUID(), "integration");
      return reservation;
    });
    if (result.status === "integrated") reservation.resolve();
    return result;
  }
  async function confirmFF(plan) {
    let reservation;
    const result = await confirmFastForwardIntegration(plan.planId, plan.planId, "test", async () => {
      reservation = beginGitOperationIntent(agentDir, commonDir, randomUUID(), "integration");
      return reservation;
    });
    if (result.status === "integrated") reservation.resolve();
    return result;
  }
  return { home, target, feature, agentDir, policy, options, verified, confirm, confirmFF, commonDir, testContainmentBackend };
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
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "test"), /durable intent/);
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "other-session", async () => { throw Error("unexpected"); }), /another session/);
  const result = await f.confirm(plan);
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

test("FF-only installs the actual feature tip with its real parent and tree, not a merge commit", async (t) => {
  const f = fixture(t);
  f.policy.integration.method = "ff";
  const plan = await prepareFastForwardIntegration(await f.verified());
  assert.equal(plan.method, "ff");
  assert.equal(plan.mergeOid, undefined);
  assert.equal(plan.message, undefined);
  assert.equal(plan.featureOid, git(f.feature, "rev-parse", "HEAD"));
  assert.equal(plan.treeOid, git(f.feature, "rev-parse", "HEAD^{tree}"));
  assert.deepEqual(plan.parents, [plan.review.targetOid]);
  assert.match(plan.diff.patch, /feature/);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  const result = await f.confirmFF(plan);
  assert.deepEqual(result, { status: "integrated", method: "ff", featureOid: plan.featureOid,
    treeOid: plan.treeOid, parents: plan.parents, targetBranch: "target" });
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.featureOid);
  assert.equal(git(f.target, "rev-parse", "HEAD^{tree}"), plan.treeOid);
  assert.equal(git(f.target, "rev-list", "--parents", "-n", "1", "HEAD"), `${plan.featureOid} ${plan.parents.join(" ")}`);
  assert.equal(git(f.target, "status", "--porcelain", "--untracked-files=all"), "");
  assert.equal(git(f.feature, "status", "--porcelain", "--untracked-files=all"), "");
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
  await assert.rejects(f.confirmFF(plan), /plan/);
});

test("FF rejects a moved target before apply; no fallback, catch-up merge or checkout change", async (t) => {
  const f = fixture(t);
  f.policy.integration.method = "ff";
  const plan = await prepareFastForwardIntegration(await f.verified());
  writeFileSync(join(f.target, "other"), "new\n");
  git(f.target, "add", "other"); git(f.target, "commit", "-qm", "concurrent target");
  const moved = git(f.target, "rev-parse", "HEAD");
  let intentCalled = false;
  await assert.rejects(confirmFastForwardIntegration(plan.planId, plan.planId, "test", async () => {
    intentCalled = true; throw Error("unexpected intent");
  }), (error) => error instanceof GitIntegrationTargetMovedError && error.code === "target_moved" && /refresh review/.test(error.message));
  assert.equal(intentCalled, false);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "clear");
  assert.equal(git(f.target, "rev-parse", "HEAD"), moved);
  assert.equal(git(f.feature, "rev-parse", "HEAD"), plan.featureOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "base\n");
  await assert.rejects(prepareFastForwardIntegration(f.options), /ancestor|first-parent/);
});

test("merge refuses a clean moved target before intent or checkout apply", async (t) => {
  const f = fixture(t);
  const plan = await prepareIntegration(await f.verified());
  writeFileSync(join(f.target, "other"), "new\n");
  git(f.target, "add", "other"); git(f.target, "commit", "-qm", "concurrent target");
  const moved = git(f.target, "rev-parse", "HEAD");
  let intentCalled = false;
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "test", async () => {
    intentCalled = true; throw Error("unexpected intent");
  }), (error) => error instanceof GitIntegrationTargetMovedError && error.code === "target_moved");
  assert.equal(intentCalled, false);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "clear");
  assert.equal(git(f.target, "rev-parse", "HEAD"), moved);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "base\n");
});

test("merge identity change plus a clean moved target cannot be labelled target_moved", async (t) => {
  const f = fixture(t);
  const plan = await prepareIntegration(await f.verified());
  git(f.target, "commit", "--allow-empty", "-qm", "concurrent target");
  git(f.feature, "config", "user.name", "Different Author");
  let intentCalled = false;
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "test", async () => {
    intentCalled = true; throw Error("unexpected intent");
  }), (error) => error.code !== "target_moved");
  assert.equal(intentCalled, false);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "clear");
  assert.equal(git(f.target, "show", "-s", "--format=%s", "HEAD"), "concurrent target");
});

test("replaced linked target checkout at the same path plus moved ref is not target_moved", async (t) => {
  for (const method of ["merge", "ff"]) {
    const f = fixture(t);
    f.policy.integration.method = method;
    git(f.target, "switch", "-qc", "holding");
    const linkedTarget = join(f.home, "linked-target");
    git(f.target, "worktree", "add", "-q", linkedTarget, "target");
    allowFileRoot(linkedTarget);
    const plan = method === "ff" ? await prepareFastForwardIntegration(await f.verified()) : await prepareIntegration(await f.verified());
    const displaced = `${linkedTarget}-original`;
    renameSync(linkedTarget, displaced);
    cpSync(displaced, linkedTarget, { recursive: true }); // same path, branch and Git-dir path, different directory/marker instance
    git(linkedTarget, "commit", "--allow-empty", "-qm", "concurrent target");
    let intentCalled = false;
    const confirm = method === "ff" ? confirmFastForwardIntegration : confirmIntegration;
    await assert.rejects(confirm(plan.planId, plan.planId, "test", async () => {
      intentCalled = true; throw Error("unexpected intent");
    }), (error) => error.code !== "target_moved");
    assert.equal(intentCalled, false);
    assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "clear");
    assert.equal(git(linkedTarget, "show", "-s", "--format=%s", "HEAD"), "concurrent target");
  }
});

test("target movement during the locked pre-intent recheck is still a typed refusal", async (t) => {
  for (const method of ["merge", "ff"]) {
    const f = fixture(t);
    f.policy.integration.method = method;
    const options = await f.verified();
    let confirmCalls = 0, move = false, moved;
    options.getPolicy = () => {
      if (move && ++confirmCalls === 2) {
        moved = git(f.target, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "concurrent target");
        git(f.target, "update-ref", "refs/heads/target", moved, git(f.target, "rev-parse", "HEAD"));
      }
      return f.policy;
    };
    const plan = method === "ff" ? await prepareFastForwardIntegration(options) : await prepareIntegration(options);
    move = true;
    let intentCalled = false;
    const confirm = method === "ff" ? confirmFastForwardIntegration : confirmIntegration;
    await assert.rejects(confirm(plan.planId, plan.planId, "test", async () => {
      intentCalled = true; throw Error("unexpected intent");
    }), (error) => error.code === "target_moved");
    assert.equal(intentCalled, false);
    assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "clear");
    assert.equal(git(f.target, "rev-parse", "HEAD"), moved);
    assert.equal(existsSync(join(f.target, ".git", "index.lock")), false);
  }
});

test("target movement alongside policy or feature change is not a typed safe refusal", async (t) => {
  for (const change of ["policy", "feature"]) {
    const f = fixture(t);
    const plan = await prepareIntegration(await f.verified());
    writeFileSync(join(f.target, "other"), "new\n");
    git(f.target, "add", "other"); git(f.target, "commit", "-qm", "concurrent target");
    if (change === "policy") f.policy.checks[0].label = "different";
    else {
      writeFileSync(join(f.feature, "new"), "next\n");
      git(f.feature, "add", "new"); git(f.feature, "commit", "-qm", "new feature");
    }
    await assert.rejects(f.confirm(plan), (error) => error.code !== "target_moved");
  }
});

test("moved target plus tampered selected checkout identity is not target_moved", async (t) => {
  const f = fixture(t);
  const plan = await prepareIntegration(await f.verified());
  git(f.target, "commit", "--allow-empty", "-qm", "concurrent target");
  // Retargeting the feature worktree's Git file must not turn an invalid
  // selection into a safe stale-target diagnosis.
  writeFileSync(join(f.feature, ".git"), "gitdir: /nonexistent/foreign-git-dir\n");
  await assert.rejects(f.confirm(plan), (error) => error.code !== "target_moved");
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "clear");
});

test("FF refuses stale policy/receipt and changed feature before touching the target", async (t) => {
  const f = fixture(t);
  f.policy.integration.method = "ff";
  const options = await f.verified();
  const plan = await prepareFastForwardIntegration(options);
  f.policy.checks[0].label = "changed recipe";
  await assert.rejects(f.confirmFF(plan), /receipt|stale|policy/);
  f.policy.checks[0].label = "check";
  const fresh = await prepareFastForwardIntegration(options);
  writeFileSync(join(f.feature, "new-file"), "next\n");
  git(f.feature, "add", "new-file"); git(f.feature, "commit", "-qm", "new tip");
  await assert.rejects(f.confirmFF(fresh));
  assert.equal(git(f.target, "rev-parse", "HEAD"), fresh.review.targetOid);
  await assert.rejects(prepareFastForwardIntegration(options), /receipt/);
});

test("FF target moving during apply returns partial-state without overwriting the winner", async (t) => {
  const f = fixture(t);
  f.policy.integration.method = "ff";
  const options = await f.verified();
  let competingTip;
  options.afterCheckout = () => {
    competingTip = git(f.target, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "competing update");
    git(f.target, "update-ref", "refs/heads/target", competingTip, git(f.target, "rev-parse", "HEAD"));
  };
  const plan = await prepareFastForwardIntegration(options);
  const result = await f.confirmFF(plan);
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), competingTip);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "unresolved");
  assert.equal(JSON.parse(readFileSync(result.recoveryPath, "utf8")).phase, "prepared");
});

test("FF partial apply preserves truthful recovery and invalidates old receipts and plans", async (t) => {
  const f = fixture(t);
  f.policy.integration.method = "ff";
  const options = await f.verified();
  const older = await prepareFastForwardIntegration(options);
  invalidateGitIntegrationPlansForResource(f.commonDir);
  await assert.rejects(f.confirmFF(older), /plan/);
  options.afterCheckout = () => { throw new Error("injected failure"); };
  const plan = await prepareFastForwardIntegration(options);
  const result = await f.confirmFF(plan);
  assert.equal(result.status, "partial-state");
  assert.equal(result.featureOid, plan.featureOid);
  assert.deepEqual(result.parents, plan.parents);
  assert.equal(result.mergeOid, undefined);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
  const recovery = JSON.parse(readFileSync(result.recoveryPath, "utf8"));
  assert.equal(recovery.method, "ff");
  assert.equal(recovery.newTargetOid, plan.featureOid);
  assert.equal(recovery.mergeOid, undefined);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "unresolved");
  await assert.rejects(prepareFastForwardIntegration(options), /dirty|recovery|admission/i);
});

test("FF refuses a receipt for a different method and a feature merge topology", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  f.policy.integration.method = "ff";
  await assert.rejects(prepareFastForwardIntegration(options), /receipt/);
  await f.verified();
  // Merge a side branch into the feature: ancestry alone must not silently authorize its topology.
  git(f.feature, "branch", "side");
  git(f.feature, "switch", "side");
  writeFileSync(join(f.feature, "side-note"), "side\n");
  git(f.feature, "add", "side-note"); git(f.feature, "commit", "-qm", "side");
  git(f.feature, "switch", "feature");
  writeFileSync(join(f.feature, "note"), "next\n");
  git(f.feature, "add", "note"); git(f.feature, "commit", "-qm", "next");
  git(f.feature, "merge", "--no-ff", "-m", "side merge", "side");
  await f.verified();
  await assert.rejects(prepareFastForwardIntegration(options), /nonlinear/);
});

test("check recovery invalidates an earlier process-local exact merge proposal", async (t) => {
  const f = fixture(t);
  const plan = await prepareIntegration(await f.verified());
  invalidateGitIntegrationPlansForResource(f.commonDir);
  await assert.rejects(f.confirm(plan), /plan|unavailable/i);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
});

test("no receipts, failed receipt and unsupported policy cannot prepare", async (t) => {
  const f = fixture(t);
  await assert.rejects(prepareIntegration(f.options), /receipt/);
  f.policy.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
  await assert.rejects(f.verified());
  f.policy.integration.method = "ff";
  await assert.rejects(prepareIntegration(f.options), /ff\/squash/);
  f.policy.integration.method = "squash";
  await assert.rejects(prepareFastForwardIntegration(f.options), /squash/);
});

test("every saved check needs its own matching receipt", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  f.policy.checks.push({ label: "second", argv: [process.execPath, "-e", "process.exit(0)"] });
  await assert.rejects(prepareIntegration(options), /receipt/);
  const second = await runGitVerification({ sessionId: "test", cwd: f.feature, agentDir: f.agentDir,
    review: await reviewGitBranches(f.feature, "feature", "target"), checkIndex: 1,
    getPolicy: () => f.policy, isTrusted: () => true, testContainmentBackend: f.testContainmentBackend });
  options.receiptIds.push(second.id);
  await assert.rejects(prepareIntegration(options), /receipt/); // first receipt belongs to old policy
  const first = await runGitVerification({ sessionId: "test", cwd: f.feature, agentDir: f.agentDir,
    review: await reviewGitBranches(f.feature, "feature", "target"), checkIndex: 0,
    getPolicy: () => f.policy, isTrusted: () => true, testContainmentBackend: f.testContainmentBackend });
  options.receiptIds[0] = first.id;
  assert.equal((await prepareIntegration(options)).receiptIds.length, 2);
});

test("stale ref, stale index and changed policy invalidate an approved plan before mutation", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  const p = await prepareIntegration(options);
  f.policy.checks[0].label = "changed";
  await assert.rejects(f.confirm(p));
  f.policy.checks[0].label = "check";
  const q = await prepareIntegration(options);
  git(f.target, "update-index", "--assume-unchanged", "note");
  await assert.rejects(f.confirm(q));
  git(f.target, "update-index", "--no-assume-unchanged", "note");
  const r = await prepareIntegration(options);
  git(f.target, "update-ref", "refs/heads/target", r.review.featureOid, r.review.targetOid);
  await assert.rejects(f.confirm(r));
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
  const result = await f.confirm(plan);
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "intervening change\n");
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "unresolved");
  assert.equal(JSON.parse(readFileSync(result.recoveryPath, "utf8")).mergeOid, plan.mergeOid);
});

test("new untracked file after apply also refuses ref update", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  options.afterCheckout = () => writeFileSync(join(f.target, "untracked"), "new\n");
  const plan = await prepareIntegration(options);
  const result = await f.confirm(plan);
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
  const result = await f.confirm(plan);
  assert.equal(result.status, "integrated");
  assert.equal(existsSync(marker), false);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.mergeOid);
});

test("a plan cannot pass a newly unresolved resource admission", async (t) => {
  const f = fixture(t);
  const plan = await prepareIntegration(await f.verified());
  beginGitOperationIntent(f.agentDir, f.commonDir, randomUUID(), "integration");
  await assert.rejects(f.confirm(plan), /recovery|admission/i);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  await assert.rejects(prepareIntegration(f.options), /recovery|admission/i);
});

test("a resolved operation invalidates an older plan even if refs and index are identical", async (t) => {
  const f = fixture(t);
  const plan = await prepareIntegration(await f.verified());
  beginGitOperationIntent(f.agentDir, f.commonDir, randomUUID(), "integration").resolve();
  await assert.rejects(f.confirm(plan), /predates another Git operation/);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
});

test("merge, rebase and sequencer markers in either worktree refuse plans", async (t) => {
  for (const marker of ["MERGE_HEAD", "rebase-merge", "sequencer"]) {
    for (const where of ["feature", "target"]) {
      const f = fixture(t);
      await f.verified();
      const metadata = git(f[where], "rev-parse", "--absolute-git-dir");
      writeFileSync(join(metadata, marker), "unfinished\n");
      await assert.rejects(prepareIntegration(f.options), /unfinished Git operation state/);
    }
  }
});

test("a dangling worktree-local marker symlink is unresolved operation state", async (t) => {
  const f = fixture(t);
  await f.verified();
  symlinkSync(join(f.home, "missing-marker"), join(git(f.target, "rev-parse", "--absolute-git-dir"), "MERGE_HEAD"));
  await assert.rejects(prepareIntegration(f.options), /unfinished Git operation state/);
});

test("a marker appearing after checkout blocks ref CAS and retains uncertain recovery", async (t) => {
  const f = fixture(t);
  const metadata = git(f.target, "rev-parse", "--absolute-git-dir");
  f.options.afterCheckout = () => writeFileSync(join(metadata, "MERGE_HEAD"), "unfinished\n");
  const plan = await prepareIntegration(await f.verified());
  const result = await f.confirm(plan);
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "unresolved");
});

test("a merge target ref changed after read-tree begins remains recovery-required", async (t) => {
  const f = fixture(t);
  let competingTip;
  f.options.afterCheckout = () => {
    competingTip = git(f.target, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "competing update");
    git(f.target, "update-ref", "refs/heads/target", competingTip, git(f.target, "rev-parse", "HEAD"));
  };
  const plan = await prepareIntegration(await f.verified());
  const result = await f.confirm(plan);
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), competingTip);
  assert.equal(inspectGitOperationAdmission(f.agentDir, f.commonDir).reason, "unresolved");
  assert.equal(JSON.parse(readFileSync(result.recoveryPath, "utf8")).phase, "prepared");
});

test("failure after read-tree begins preserves partial state and private recovery record", async (t) => {
  const f = fixture(t);
  const options = await f.verified();
  options.afterCheckout = () => { throw new Error("injected failure"); };
  const plan = await prepareIntegration(options);
  const result = await f.confirm(plan);
  assert.equal(result.status, "partial-state");
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
  assert.equal(JSON.parse(readFileSync(result.recoveryPath, "utf8")).mergeOid, plan.mergeOid);
  if (process.platform !== "win32") assert.equal(statSync(result.recoveryPath).mode & 0o777, 0o600);
  assert.equal(existsSync(join(f.target, ".git", "index.lock")), false);
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, "test"));
});
