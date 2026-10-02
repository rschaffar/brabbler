import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { runGitCheckoutVerification: run, lookupGitCheckoutVerificationReceipt: lookup,
  validateGitCheckoutVerificationReceipt: validate, selectGitCheckoutVerificationChecks: select,
  captureGitCheckoutCheckRecoverySnapshot: capture } = await jiti.import("./git-checkout-verification.ts");
const { runGitVerification: legacyRun, lookupGitVerificationReceipt: legacyLookup, isGitVerificationRunning } = await jiti.import("./git-verification.ts");
const { gitCheckRunningCheckouts } = await jiti.import("./git-check-runner.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { assertGitOperationAdmission, inspectGitOperationAdmission: admission, readUnresolvedGitCheckRecovery: recovery,
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
function fixture(t, delivery = "local") {
  const home = mkdtempSync(join(tmpdir(), "pi-web-selected-check-"));
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
  f.policy.settings.checks[0].argv = [process.execPath, "-e", command];
  const selection = await selectGitProjectResources(f.cwd);
  await assert.rejects(run({ ...f.options, ...extra }));
  return { ...f, selection, evidence: recovery(f.agentDir, selection.commonDir) };
}

for (const delivery of ["local", "pr", "leave"]) test(`single direct-main checkout verifies ${delivery}, without any target/base or GitReview`, async (t) => {
  const f = fixture(t, delivery);
  if (delivery !== "local") { f.options.stage = "handoff"; f.policy.settings.checks[0].requiredStage = "handoff"; }
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.stdout.write(JSON.stringify([process.cwd(),process.env.CI,process.env['PI_WEB_'+'P'+'ASSWORD'],process.env.NEXT_RUNTIME,process.env.PORT]))"];
  const prior = Object.fromEntries(["PI_WEB_PASSWORD", "NEXT_RUNTIME", "PORT"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { PI_WEB_PASSWORD: "private-value", NEXT_RUNTIME: "server", PORT: "9999" });
  try {
    const receipt = await run(f.options);
    assert.equal(receipt.kind, "selected-checkout-verification"); assert.equal(receipt.version, 2);
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

test("unavailable containment and dirty/nonstandard/active-Git checkouts publish no intent", async (t) => {
  const f = fixture(t);
  await assert.rejects(run({ ...f.options, testContainmentBackend: { ...proofBackend(), absent: async () => false } }));
  assert.equal(existsSync(f.agentDir), false);
  writeFileSync(join(f.cwd, "checks", "note"), "dirty"); await assert.rejects(run(f.options));
  writeFileSync(join(f.cwd, "checks", "note"), "base\n");
  git(f.cwd, "update-index", "--assume-unchanged", "checks/note"); await assert.rejects(run(f.options));
  git(f.cwd, "update-index", "--no-assume-unchanged", "checks/note");
  writeFileSync(join(f.cwd, ".git", "MERGE_HEAD"), git(f.cwd, "rev-parse", "HEAD"));
  await assert.rejects(run(f.options)); assert.equal(existsSync(f.agentDir), false);
});

test("exact v2 evidence survives restart, redacts recipe/env, and retains original-cgroup quarantine", async (t) => {
  const f = await failed(t);
  const { evidence } = f;
  assert.equal(evidence.before.version, 2); assert.deepEqual(evidence.before, evidence.after);
  assert.equal(evidence.source, "node-test-simulated"); assert.equal(evidence.outcome.status, 1);
  assert.equal(evidence.cleanupProof.unit, evidence.unit);
  assert.equal(evidence.cleanupProof.cgroupIdentity.includes(evidence.cleanupProof.invocation), true);
  const keys = Object.keys(evidence.before);
  assert.equal(keys.some((key) => /feature|target|review/.test(key)), false);
  assert.equal(keys.filter((key) => key !== "version").every((key) => /^[a-f0-9]{64}$/.test(evidence.before[key])), true);
  const binding = { recipe: f.policy.settings.checks[0], checkIndex: 0, stage: "commit",
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
  assert.equal(evidence.before.version, 2); assert.match(evidence.unit, /^pi-web-git-check-.*\.service$/);
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
    const options = { ...f.options, testContainmentBackend: undefined, testRecoveryEvidence: undefined };
    const receipt = await run(options); assert.equal(receipt.exitStatus, 0);
    f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.exit(1)"];
    await assert.rejects(run(options));
    const evidence = recovery(f.agentDir, receipt.selection.commonDir);
    assert.equal(evidence.source, "linux-systemd"); assert.equal(evidence.cleanupProof.empty, true);
    assert.equal(admission(f.agentDir, receipt.selection.commonDir).reason, "unresolved");
  });
