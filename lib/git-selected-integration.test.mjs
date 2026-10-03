import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
const configHome = mkdtempSync(join(tmpdir(), "selected-integration-config-"));
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  rmSync(configHome, { recursive: true, force: true });
});
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof,
  readSelectedIntegrationNativeTargetMove } = await jiti.import("./git-selected-integration.ts");
const { prepareIntegration, confirmIntegration, invalidateGitIntegrationPlansForResource,
  GitIntegrationTargetMovedError } = await jiti.import("./git-integration.ts");
const { createGitAction, transitionGitAction, releaseGitAction, readGitAction } = await jiti.import("./git-action-journal.ts");
const { gitActionAttribution } = await jiti.import("./git-action-controller.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS, resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { runGitCheckoutVerification, lookupGitCheckoutVerificationReceipt } = await jiti.import("./git-checkout-verification.ts");
const { lookupGitVerificationReceipt } = await jiti.import("./git-verification.ts");
const { beginGitOperationIntent, beginSupervisedGitOperationIntent, inspectGitOperationAdmission,
  readGitOperationReservationOwner } = await jiti.import("./git-operation-admission.ts");
const { createGitWorkspaceAdmission } = await jiti.import("./git-workspace-admission.ts");
const { captureGitWorkspaceOperation, applyGitWorkspaceOperationWithAuthority, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t, { method = "ff", sourceDirect = false, features = 2, targetMain = false, nativeWorkspace = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-selected-integration-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = join(home, "project"), agentDir = join(home, "agent");
  mkdirSync(agentDir, { mode: 0o700 });
  git(home, "init", "-q", "-b", "main", project);
  git(project, "config", "core.autocrlf", "false");
  git(project, "config", "commit.gpgsign", "false");
  git(project, "config", "user.name", "Test"); git(project, "config", "user.email", "test@example.com");
  writeFileSync(join(project, "note"), "base\n"); git(project, "add", "note"); git(project, "commit", "-qm", "base");
  const source = sourceDirect ? project : nativeWorkspace ? join(`${project}-worktrees`, "feature") : join(home, "feature");
  let workspaceHandle;
  if (sourceDirect) git(project, "switch", "-qc", "feature");
  else if (nativeWorkspace) {
    allowFileRoot(project);
    const durable = createGitWorkspaceAdmission({ agentDir,
      async onIntent(e) { writeFileSync(join(agentDir, `${e.actionId}.workspace-intent`), JSON.stringify(e), { flag: "wx", mode: 0o600, flush: true }); },
      async onCompleted(p) { writeFileSync(join(agentDir, `${p.actionId}.workspace-completed`), JSON.stringify(p), { flag: "wx", mode: 0o600, flush: true }); },
    });
    const admission = { ...durable, async beginIntent(e) {
      const held = await durable.beginIntent(e);
      return { ...held, assertOwned(proof) { held.assertOwned(proof); if (proof) workspaceHandle = proof; } };
    } }; // Retain the actual leaf identity, not the publisher's JSON measurement.
    const candidate = await captureGitWorkspaceOperation({ repositoryPath: project, sourceCheckoutPath: project,
      destinationPath: source, branch: "feature", baseBranch: "main", expectedBaseOid: git(project, "rev-parse", "HEAD"), mode: "create" }, admission);
    const live = { allowed: true, revision: 1 }, captured = live.revision;
    const created = await applyGitWorkspaceOperationWithAuthority({ candidate, authorize: async () => {
      if (!live.allowed) throw Error("workspace authority denied");
    }, assertCurrentSync() {
      if (!live.allowed || live.revision !== captured) throw Error("workspace authority changed");
    } });
    assert.equal(created.status, "created"); assert.equal(created.knownParentCreation.path, `${project}-worktrees`);
    assert.equal(readGitWorkspaceNativeProof(workspaceHandle).destination.cwd, source);
    assert.equal(inspectGitOperationAdmission(agentDir, join(project, ".git")).admitted, true);
  } else git(project, "worktree", "add", "-qb", "feature", source);
  const target = targetMain ? project : join(home, "delivery");
  if (!targetMain) git(project, "worktree", "add", "-qb", "delivery", target, "main");
  const siblings = [];
  for (let i = 1; i < features; i++) {
    const path = join(home, `sibling-${i}`);
    git(project, "worktree", "add", "-qb", `sibling-${i}`, path, "main"); siblings.push(path);
  }
  writeFileSync(join(source, "note"), "feature\n"); git(source, "add", "note"); git(source, "commit", "-qm", "feature");
  for (const path of [project, source, target, ...siblings]) allowFileRoot(path);
  const settings = { ...structuredClone(DEFAULT_GIT_WORKFLOW_SETTINGS), mainBranch: "main", targetBranch: targetMain ? ":project-main" : "delivery", method,
    baseBranch: ":project-main", checks: [] };
  const policy = { policyRevision: "saved-1", settings, savedProjectSettings: { mainBranch: "main", targetBranch: settings.targetBranch, method, delivery: "local" } };
  // Real mutable server-owned authority source. Guards reread it synchronously;
  // these are not no-op closures or capture-time Allow answers.
  const authority = new Proxy({ version: 1, known: true, grant: "allow", trusted: true, sourceAllowed: true, targetAllowed: true }, {
    set(state, key, value) {
      if (key !== "version" && state[key] !== value) state.version++; // Including revoke-and-restore.
      state[key] = value; return true;
    },
  });
  function readAuthorityStamp() {
    if (!authority.known || authority.grant !== "allow" || !authority.trusted || !authority.sourceAllowed || !authority.targetAllowed) throw Error("live authority unavailable or revoked");
    return JSON.stringify({ authority, policy });
  }
  function captureAuthorityGuard() {
    const captured = readAuthorityStamp();
    return () => { if (readAuthorityStamp() !== captured) throw Error("captured authority revision changed"); };
  }
  const options = { sessionId: "caller-from-other-project", agentDir,
    source: await selectCanonicalGitResources({ repositoryPath: project, checkoutPath: source }),
    target: await selectCanonicalGitResources({ repositoryPath: project, checkoutPath: target }), receiptIds: [],
    getPolicy: () => policy, isTrusted: () => authority.trusted,
    isSelectionAuthorized: (selection) => selection.cwd === source ? authority.sourceAllowed : authority.targetAllowed,
    isCheckAuthorized: () => authority.known && authority.grant === "allow", readAuthorityRevisionSync: readAuthorityStamp,
    authorize: () => captureAuthorityGuard() };
  const backend = createTestContainmentBackend();
  async function check(index, stage = "integration", sessionId = options.sessionId, selection = options.source) {
    return runGitCheckoutVerification({ sessionId, agentDir,
      selector: { repositoryPath: selection.projectRoot, checkoutPath: selection.cwd }, checkIndex: index, stage,
      getPolicy: () => ({ policyRevision: policy.policyRevision, settings: policy.settings }),
      isTrusted: () => true, isSelectionAuthorized: () => true, isActorAuthorized: () => true,
      readAuthorityRevisionSync: readAuthorityStamp, testContainmentBackend: backend });
  }
  let intent;
  async function apply(plan) {
    return confirmSelectedIntegration(plan.planId, plan.planId, options.sessionId, async () => {
      intent = await beginSupervisedGitOperationIntent(options.source, randomUUID(), "integration", agentDir); return intent;
    });
  }
  return { home, project, source, target, siblings, policy, settings, authority, captureAuthorityGuard, workspaceHandle,
    options, check, apply, get intent() { return intent; } };
}
const recipe = (stage = "integration") => ({ label: `check ${stage}`, argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: stage });
const ledgerDir = (f) => join(f.options.agentDir, "pi-web", "git-operation-admission", "v1",
  createHash("sha256").update(f.options.source.commonDir).digest("hex"));

async function contenderPlans(f) {
  const source = f.siblings[0];
  writeFileSync(join(source, "winner-content"), "real competing feature\n"); git(source, "add", "."); git(source, "commit", "-qm", "competing feature");
  const options = { ...f.options, sessionId: "actual-other-winner", source: await selectCanonicalGitResources({ repositoryPath: f.project, checkoutPath: source }) };
  const loser = await prepareSelectedIntegration(f.options), winner = await prepareSelectedIntegration(options);
  return { loser, winner, options };
}
async function completeContender(f, captured, { journal = true, settle = true } = {}) {
  const { options, winner } = captured;
  let action = journal ? await createGitAction({ sessionId: options.sessionId, source: "agent", candidate: {
    kind: "integration", repositoryRoot: options.source.cwd, ...gitActionAttribution(options.source, options.target),
    featureBranch: options.source.branch, targetBranch: options.target.branch, featureOid: winner.review.featureOid,
    targetOid: winner.review.targetOid, integrationMethod: "method" in winner ? "ff" : "merge",
    ...("method" in winner ? {} : { mergeOid: winner.mergeOid, message: winner.message }), checks: [], diff: winner.diff,
  } }, options.agentDir) : undefined;
  let held;
  const out = await confirmSelectedIntegration(winner.planId, winner.planId, options.sessionId, async () => {
    held = await beginSupervisedGitOperationIntent(options.source, action?.id ?? randomUUID(), "integration", options.agentDir);
    if (action) action = await transitionGitAction(action.id, action.revision, { state: "executing" }, options.agentDir);
    return held;
  });
  assert.equal(out.result.status, "integrated");
  const proof = readSelectedIntegrationNativeProof(out.nativeHandle);
  if (action) {
    action = await transitionGitAction(action.id, action.revision, { state: "succeeded", outcome: {
      status: "integrated", mergeOid: proof.resultOid, tree: proof.resultTree, parents: proof.parents,
      featureOid: proof.featureOid, targetOid: proof.previousTargetOid, targetBranch: proof.target.branch,
    } }, options.agentDir);
    assert.equal((await readGitAction(action.id, {}, options.agentDir)).record.state, "succeeded");
    releaseGitAction(action.id, options.agentDir);
  }
  if (settle) held.resolve();
  return { out, proof, held, action };
}

for (const method of ["ff", "merge"]) test(`${method} actual native winner plus durable journal/admission issues only the original loser's bound target-move proof`, async (t) => {
  const f = await fixture(t, { method, nativeWorkspace: true }), captured = await contenderPlans(f);
  const winner = await completeContender(f, captured);
  assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).admitted, true);
  let cause;
  await assert.rejects(f.apply(captured.loser), (error) => { cause = error; return error.code === "target_moved"; });
  assert.equal(f.intent, undefined); // Loser never published intent or began checkout.
  const proof = readSelectedIntegrationNativeTargetMove(cause);
  assert.equal(proof.code, "target_moved"); assert.equal(proof.noEffect, true);
  assert.equal(proof.planId, captured.loser.planId); assert.equal(proof.sessionId, f.options.sessionId);
  assert.deepEqual(proof.context, captured.loser.selectedContext);
  assert.equal(proof.featureOid, captured.loser.review.featureOid);
  assert.equal(proof.previousTargetOid, captured.loser.review.targetOid);
  assert.equal(proof.observedTargetOid, winner.proof.resultOid);
  assert.equal(proof.otherStateBefore, proof.otherStateAfter); assert.match(proof.otherStateBefore, /^[a-f0-9]{64}$/);
  proof.context.target.branch = "tampered"; assert.deepEqual(readSelectedIntegrationNativeTargetMove(cause).context, captured.loser.selectedContext);
  const counterfeit = Object.assign(new GitIntegrationTargetMovedError(), cause);
  for (const symbol of Object.getOwnPropertySymbols(cause)) Object.defineProperty(counterfeit, symbol, Object.getOwnPropertyDescriptor(cause, symbol));
  for (const value of [undefined, null, true, "target_moved", new GitIntegrationTargetMovedError(), counterfeit,
    { ...cause }, new Error(cause.message), JSON.parse(JSON.stringify(cause)), winner.proof, winner.out,
    (await readGitAction(winner.action.id, { includeArtifact: true }, f.options.agentDir)).record]) {
    assert.equal(readSelectedIntegrationNativeTargetMove(value), undefined);
  }
  assert.equal(git(f.source, "rev-parse", "HEAD"), captured.loser.review.featureOid);
  assert.equal(git(f.target, "rev-parse", "HEAD"), winner.proof.resultOid);
  assert.equal(git(f.source, "status", "--porcelain"), ""); assert.equal(git(f.target, "status", "--porcelain"), "");
  await assert.rejects(f.apply(captured.loser), /plan/);
});

function cachedSource(f) {
  git(f.project, "config", "core.trustctime", "false"); git(f.project, "config", "core.checkstat", "minimal");
  const file = join(f.source, "note"), old = new Date("2001-01-01T00:00:00Z");
  utimesSync(file, old, old); git(f.source, "update-index", "--refresh");
  const index = readFileSync(join(f.options.source.gitDir, "index")), head = git(f.source, "rev-parse", "HEAD");
  assert.equal(readFileSync(file, "utf8"), "feature\n");
  return () => {
    writeFileSync(file, "damaged\n"); utimesSync(file, old, old); // Same byte length, restored mtime.
    assert.equal(git(f.source, "status", "--porcelain=v1", "--untracked-files=all"), "", "real lying Git stat cache");
    assert.equal(git(f.source, "diff-files", "--name-only"), "");
    assert.deepEqual(readFileSync(join(f.options.source.gitDir, "index")), index, "actual index bytes stayed identical");
    assert.equal(git(f.source, "rev-parse", "HEAD"), head);
    assert.equal(readFileSync(file, "utf8"), "damaged\n");
  };
}
for (const method of ["ff", "merge"]) test(`${method} cached-clean physical source changes deny capture, apply and genuine-winner target-only proof`, async (t) => {
  for (const where of ["capture", "apply", "winner", "winner-await", "winner-postguard"]) {
    const f = await fixture(t, { method, nativeWorkspace: true }), mutate = cachedSource(f);
    let armed = false;
    if (where === "winner-await") f.options.isSelectionAuthorized = async () => {
      await Promise.resolve(); if (armed) mutate(); return true;
    };
    if (where === "winner-postguard") f.options.authorize = () => {
      const live = f.captureAuthorityGuard(); return () => { live(); if (armed) mutate(); };
    };
    if (where === "capture") {
      mutate(); await assert.rejects(prepareSelectedIntegration(f.options)); assert.equal(f.intent, undefined); continue;
    }
    const captured = where.startsWith("winner") ? await contenderPlans(f) : { loser: await prepareSelectedIntegration(f.options) };
    const winner = where.startsWith("winner") ? await completeContender(f, captured) : undefined;
    const target = git(f.target, "rev-parse", "HEAD"), epochFiles = readdirSync(ledgerDir(f));
    if (winner) {
      assert.equal(winner.action.state, "succeeded");
      assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).admitted, true);
      assert.equal(target, winner.proof.resultOid);
    }
    if (where === "winner-await" || where === "winner-postguard") armed = true; else mutate();
    let cause;
    await assert.rejects(f.apply(captured.loser), (error) => {
      cause = error; assert.notEqual(error.code, "target_moved");
      assert.equal(readSelectedIntegrationNativeTargetMove(error), undefined); return true;
    }, where);
    assert.ok(cause); assert.equal(f.intent, undefined, "no loser admission/checkout effect");
    assert.equal(readSelectedIntegrationNativeProof(cause), undefined);
    assert.equal(readFileSync(join(f.source, "note"), "utf8"), "damaged\n");
    assert.equal(git(f.source, "rev-parse", "HEAD"), captured.loser.review.featureOid);
    assert.equal(git(f.target, "rev-parse", "HEAD"), target);
    assert.deepEqual(readdirSync(ledgerDir(f)), epochFiles, "no fabricated passing evidence or quarantine release");
    await assert.rejects(f.apply(captured.loser), /plan/);
  }
});

test("completed winner cannot relabel changed source/policy/authority, dirty target, unsafe aliases or unknown ledger publications as movement", async (t) => {
  for (const kind of ["source-oid", "source-config", "policy", "authority", "dirty-target", "target-flags", "target-operation", "target-lock", "dangling-target-lock", "target-ref-symlink", "target-index-symlink", "unrelated-resolved", "unrelated-ref"]) {
    const f = await fixture(t, { nativeWorkspace: true }), captured = await contenderPlans(f), winner = await completeContender(f, captured);
    if (kind === "source-oid") git(f.source, "commit", "--allow-empty", "-qm", "source changed");
    if (kind === "source-config") git(f.source, "config", "user.name", "Changed source configuration");
    if (kind === "policy") f.policy.policyRevision = "changed-policy";
    if (kind === "authority") { f.authority.grant = "deny"; f.authority.grant = "allow"; }
    if (kind === "dirty-target") writeFileSync(join(f.target, "note"), "dirty after real winner\n");
    if (kind === "target-flags") git(f.target, "update-index", "--assume-unchanged", "note");
    if (kind === "target-operation") writeFileSync(join(f.options.target.gitDir, "MERGE_HEAD"), "uncertain operation\n");
    if (kind === "target-lock") writeFileSync(join(f.options.target.gitDir, "index.lock"), "foreign lock\n");
    if (kind === "dangling-target-lock") symlinkSync(join(f.home, "absent-lock-target"), join(f.options.target.gitDir, "index.lock"));
    if (kind === "target-ref-symlink" || kind === "target-index-symlink") {
      const file = kind === "target-ref-symlink" ? join(f.options.target.commonDir, "refs", "heads", "delivery") : join(f.options.target.gitDir, "index");
      const copy = join(f.home, "unsafe-alias"); renameSync(file, copy); symlinkSync(copy, file);
    }
    if (kind === "unrelated-resolved") beginGitOperationIntent(f.options.agentDir, f.options.source.commonDir, randomUUID(), "integration").resolve();
    if (kind === "unrelated-ref") git(f.target, "branch", "unrelated-publication");
    await assert.rejects(f.apply(captured.loser), (error) => {
      assert.notEqual(error.code, "target_moved", kind); assert.equal(readSelectedIntegrationNativeTargetMove(error), undefined); return true;
    }, kind);
    assert.equal(f.intent, undefined); assert.equal(git(f.target, "rev-parse", "HEAD"), winner.proof.resultOid);
    await assert.rejects(f.apply(captured.loser), /plan/);
  }
});

test("native completion alone and a journal-succeeded but unsettled winner never waive admission history", async (t) => {
  for (const missing of ["journal", "settlement"]) {
    const f = await fixture(t, { nativeWorkspace: true }), captured = await contenderPlans(f);
    const winner = await completeContender(f, captured, { journal: missing !== "journal", settle: missing !== "settlement" });
    await assert.rejects(f.apply(captured.loser), (error) => {
      assert.notEqual(error.code, "target_moved"); assert.equal(readSelectedIntegrationNativeTargetMove(error), undefined); return true;
    });
    assert.equal(f.intent, undefined); assert.equal(git(f.target, "rev-parse", "HEAD"), winner.proof.resultOid);
    if (missing === "settlement") assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
    await assert.rejects(f.apply(captured.loser), /plan/);
  }
});

for (const method of ["ff", "merge"]) test(`${method} genuine sealed workspace history and actual checkout-check proofs allow integration`, async (t) => {
  const f = await fixture(t, { method, nativeWorkspace: true, targetMain: true });
  f.settings.checks = [recipe("commit"), recipe()];
  f.options.receiptIds = [(await f.check(1)).id];
  const names = readdirSync(ledgerDir(f));
  // This backend executes real commands but cannot issue OS cgroup cleanup
  // evidence (.post). Never manufacture it just to exercise a filename.
  for (const suffix of ["binding", "completed", "pre"]) assert.ok(names.some((name) => name.endsWith(`.${suffix}`)), suffix);
  const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
  assert.equal(out.result.status, "integrated"); assert.deepEqual(plan.selectedContext.checkIndexes, [1]);
  const proof = readSelectedIntegrationNativeProof(out.nativeHandle), held = readGitOperationReservationOwner(f.intent);
  assert.equal(held.kind, "integration"); assert.deepEqual(held.selection, f.options.source);
  assert.equal(proof.admissionActionId, held.actionId);
  assert.equal(proof.resultOid, git(f.target, "rev-parse", "HEAD"));
  assert.equal(proof.resultTree, git(f.target, "write-tree"));
  assert.deepEqual(proof.parents, method === "ff" ? plan.parents : [plan.review.targetOid, plan.review.featureOid]);
  assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: true, indexInstalled: true, completionVerified: true });
  // Only the genuine workspace publisher settled ITS intent. Native integration
  // facts still cannot settle this new action or create cleanup authority.
  assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
  assert.equal(readSelectedIntegrationNativeProof(f.workspaceHandle), undefined);
  f.intent.resolve(); await assert.rejects(f.apply(plan), /plan/);
});

for (const method of ["ff", "merge"]) test(`${method} only an authentic held integration owner for the exact source may apply`, async (t) => {
  for (const kind of ["raw-id", "copy", "parsed", "wrong-kind", "wrong-source", "wrong-repository", "wrong-action", "wrong-id", "resolved", "historical-proof"]) {
    const f = await fixture(t, { method, nativeWorkspace: true });
    const plan = await prepareSelectedIntegration(f.options); let intent;
    await assert.rejects(confirmSelectedIntegration(plan.planId, plan.planId, f.options.sessionId, async () => {
      const selection = kind === "wrong-source" ? f.options.target : kind === "wrong-repository" ?
        (await fixture(t)).options.source : f.options.source;
      intent = kind === "raw-id" ? beginGitOperationIntent(f.options.agentDir, selection.commonDir, randomUUID(), "integration") :
        await beginSupervisedGitOperationIntent(selection, randomUUID(), kind === "wrong-kind" ? "review" : "integration", f.options.agentDir);
      if (kind === "copy") return { ...intent };
      if (kind === "parsed") return JSON.parse(JSON.stringify(intent));
      if (kind === "wrong-action") intent.actionId = randomUUID();
      if (kind === "wrong-id") intent.id = randomUUID();
      if (kind === "resolved") intent.resolve();
      if (kind === "historical-proof") return f.workspaceHandle;
      return intent;
    }), (error) => {
      assert.match(error.code, /^integration-admission-(?:unavailable|mismatch)$/);
      assert.match(error.message, /checkout unchanged/); assert.doesNotMatch(error.message, /\/|feature|agent/);
      return true;
    }, kind);
    assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid, kind);
    assert.equal(git(f.target, "status", "--porcelain"), "", kind);
    assert.equal(git(f.source, "rev-parse", "HEAD"), plan.review.featureOid, kind);
    assert.equal(readSelectedIntegrationNativeProof(intent), undefined);
    await assert.rejects(f.apply(plan), /plan/);
    if (kind !== "resolved" && kind !== "wrong-repository") assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved", kind);
  }
});

test("unknown ledger suffixes and unsafe known evidence files are never accepted as workspace proof", async (t) => {
  for (const kind of ["unknown", "backup", "uppercase", "orphan-binding", "orphan-removal", "orphan-post", "symlink", "hardlink", "directory", "corrupt", "missing-completed"]) {
    const f = await fixture(t, { nativeWorkspace: true }), dir = ledgerDir(f);
    const completed = join(dir, readdirSync(dir).find((name) => name.endsWith(".completed")));
    if (kind === "unknown") writeFileSync(join(dir, `${randomUUID()}.workspace`), "unknown");
    if (kind === "backup") writeFileSync(`${completed}.bak`, "unknown");
    if (kind === "uppercase") writeFileSync(join(dir, `${randomUUID().toUpperCase()}.json`), "unknown");
    if (kind.startsWith("orphan-")) writeFileSync(join(dir, `${randomUUID()}.${kind.slice(7)}`), "orphan");
    if (["symlink", "directory", "missing-completed"].includes(kind)) {
      const saved = join(f.home, "original-completed"); renameSync(completed, saved);
      if (kind === "symlink") symlinkSync(saved, completed);
      if (kind === "directory") mkdirSync(completed, { mode: 0o700 });
    }
    if (kind === "hardlink") linkSync(completed, join(f.home, "extra-completed-link"));
    if (kind === "corrupt") writeFileSync(completed, "corrupt proof");
    assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unavailable", kind);
    const old = git(f.target, "rev-parse", "HEAD");
    await assert.rejects(prepareSelectedIntegration(f.options), (error) => error.code !== "target_moved", kind);
    assert.equal(git(f.target, "rev-parse", "HEAD"), old); assert.equal(f.intent, undefined);
  }
});

for (const method of ["ff", "merge"]) test(`${method} failed genuine workspace publication remains foreign quarantine, not an executing-entry waiver`, async (t) => {
  const f = await fixture(t, { method, nativeWorkspace: true }), plan = await prepareSelectedIntegration(f.options);
  let proof;
  const durable = createGitWorkspaceAdmission({ agentDir: f.options.agentDir,
    async onIntent(e) { writeFileSync(join(f.home, `${e.actionId}.unsealed-intent`), JSON.stringify(e), { flag: "wx", mode: 0o600, flush: true }); },
    async onCompleted() { throw Error("durable outer completion failed"); },
  });
  const admission = { ...durable, async beginIntent(e) {
    const held = await durable.beginIntent(e);
    return { ...held, assertOwned(native) { held.assertOwned(native); if (native) proof = native; } };
  } };
  const candidate = await captureGitWorkspaceOperation({ repositoryPath: f.project, sourceCheckoutPath: f.project,
    destinationPath: join(`${f.project}-worktrees`, "unsealed"), branch: "unsealed", baseBranch: "main",
    expectedBaseOid: git(f.project, "rev-parse", "HEAD"), mode: "create" }, admission);
  const stamp = f.options.readAuthorityRevisionSync();
  await assert.rejects(applyGitWorkspaceOperationWithAuthority({ candidate,
    authorize: async () => { f.captureAuthorityGuard()(); },
    assertCurrentSync() { assert.equal(f.options.readAuthorityRevisionSync(), stamp); },
  }), (error) => error.code === "recovery-required");
  assert.ok(readGitWorkspaceNativeProof(proof));
  assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
  const out = () => confirmSelectedIntegration(plan.planId, plan.planId, f.options.sessionId, async () => proof);
  await assert.rejects(out()); await assert.rejects(out(), /plan/);
  await assert.rejects(prepareSelectedIntegration(f.options));
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readSelectedIntegrationNativeProof(proof), undefined);
});

for (const method of ["ff", "merge"]) for (const sourceDirect of [false, true]) {
  test(`${method} selected ${sourceDirect ? "direct" : "linked"} source, explicit saved non-main target, three features and private native proof`, async (t) => {
    const f = await fixture(t, { method, sourceDirect, features: 3 });
    const siblingHeads = f.siblings.map((p) => git(p, "rev-parse", "HEAD"));
    const plan = await prepareSelectedIntegration(f.options);
    assert.equal(plan.selectedContext.kind, "selected-local");
    assert.equal(plan.selectedContext.checkStatus, "no-defined");
    assert.equal(plan.selectedContext.repositoryChecksWaived, false);
    assert.deepEqual(plan.receiptIds, []);
    assert.equal(plan.review.targetBranch, "delivery"); // NOT designated main or a captured task
    assert.equal(plan.review.featureOid, git(f.source, "rev-parse", "HEAD"));
    const expected = structuredClone(plan);
    plan.selectedContext.target.branch = "main"; plan.review.featureOid = plan.review.targetOid;
    await assert.rejects(confirmIntegration(plan.planId, plan.planId, f.options.sessionId, async () => {}), /selected|plan/);
    const out = await f.apply(plan);
    assert.equal(out.result.status, "integrated");
    assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: true, indexInstalled: true, completionVerified: true });
    assert.ok(out.nativeHandle);
    const proof = readSelectedIntegrationNativeProof(out.nativeHandle);
    assert.equal(proof.method, method); assert.equal(proof.actualFF, method === "ff");
    assert.equal(proof.delivery, "selected-local");
    assert.equal(proof.resultOid, method === "ff" ? expected.featureOid : expected.mergeOid);
    assert.deepEqual(proof.parents, method === "ff" ? expected.parents : [expected.review.targetOid, expected.review.featureOid]);
    assert.equal(proof.resultTree, git(f.target, "write-tree"));
    assert.equal(proof.resultTree, git(f.target, "rev-parse", "HEAD^{tree}"));
    assert.equal(proof.resultOid, git(f.target, "rev-parse", "HEAD"));
    assert.equal(git(f.target, "show", "-s", "--format=%P", "HEAD"), proof.parents.join(" "));
    assert.equal(git(f.source, "rev-parse", "HEAD"), expected.review.featureOid);
    assert.equal(git(f.source, "status", "--porcelain"), ""); assert.equal(git(f.target, "status", "--porcelain"), "");
    assert.deepEqual(f.siblings.map((p) => git(p, "rev-parse", "HEAD")), siblingHeads);
    assert.equal(readSelectedIntegrationNativeProof(out.result), undefined);
    assert.equal(readSelectedIntegrationNativeProof(structuredClone(out.nativeHandle)), undefined);
    proof.parents = []; assert.notDeepEqual(readSelectedIntegrationNativeProof(out.nativeHandle).parents, []);
    // Native completion has NOT resolved admission or sealed cleanup authority.
    assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
    f.intent.resolve();
    await assert.rejects(f.apply(plan), /plan/);
  });
}

test("no-required is explicit and never executes/fabricates manual, commit or handoff receipts", async (t) => {
  const f = await fixture(t);
  f.settings.checks = [recipe("none"), recipe("commit"), recipe("handoff")];
  const plan = await prepareSelectedIntegration(f.options);
  assert.equal(plan.selectedContext.checkStatus, "no-required");
  assert.deepEqual(plan.selectedContext.checkIndexes, []);
  assert.equal(plan.selectedContext.repositoryChecksWaived, false);
  assert.deepEqual(plan.receiptIds, []);
  assert.equal((await f.apply(plan)).result.status, "integrated");
});

test("real selected integration receipt uses saved index 1, not submitted position 0, including primary-target lock", async (t) => {
  const f = await fixture(t, { targetMain: true });
  f.settings.checks = [recipe("commit"), recipe()];
  const r = await f.check(1);
  f.options.receiptIds = [r.id];
  assert.ok(lookupGitCheckoutVerificationReceipt(r.id));
  assert.equal(lookupGitVerificationReceipt(r.id), undefined);
  const plan = await prepareSelectedIntegration(f.options);
  assert.deepEqual(plan.selectedContext.checkIndexes, [1]);
  assert.equal(plan.selectedContext.checkStatus, "required");
  assert.equal((await f.apply(plan)).result.status, "integrated");
});

for (const method of ["ff", "merge"]) test(`${method} omitted Project delivery accepts default and inherited resolved local`, async (t) => {
  for (const global of [{}, { delivery: "local", integrateConfirmation: "none" }]) {
    const f = await fixture(t, { method });
    delete f.policy.savedProjectSettings.delivery;
    f.policy.settings = resolveGitWorkflowSettings(global, f.policy.savedProjectSettings).values;
    const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
    assert.equal(out.result.status, "integrated"); assert.ok(out.nativeHandle);
    assert.equal(readSelectedIntegrationNativeProof(out.nativeHandle).method, method);
  }
});
test("omitted Project delivery cannot defeat resolved global/session PR/leave or caller restrictions with Global Allow", async (t) => {
  for (const delivery of ["pr", "leave"]) for (const scope of ["global", "session", "project", "caller"]) {
    const f = await fixture(t); delete f.policy.savedProjectSettings.delivery;
    // Confirmation:none plus a successful authorization reader represents Global
    // Allow, not an override of selected/caller delivery policy.
    const global = { integrateConfirmation: "none", ...(scope === "global" ? { delivery } : {}) };
    const project = { ...f.policy.savedProjectSettings, ...(scope === "project" ? { delivery } : {}) };
    const session = scope === "session" ? { delivery } : scope === "project" ? { delivery: "local" } : {};
    f.policy.savedProjectSettings = project;
    f.policy.settings = resolveGitWorkflowSettings(global, project, session).values;
    if (scope === "caller") f.options.authorize = () => { throw Error("caller delivery is not local; saved Allow cannot override it"); };
    await assert.rejects(prepareSelectedIntegration(f.options), /local|Project/);
    assert.equal(f.intent, undefined);
    assert.equal(git(f.target, "rev-parse", "HEAD"), git(f.project, "rev-parse", "main"));
  }
});
for (const delivery of ["pr", "leave"]) test(`${delivery} never locally integrates`, async (t) => {
  const f = await fixture(t); f.settings.delivery = delivery; f.policy.savedProjectSettings.delivery = delivery;
  await assert.rejects(prepareSelectedIntegration(f.options), /saved Project/);
});
test("disabled, missing explicit Project target/method, squash and untrusted resources fail closed", async (t) => {
  for (const mutate of [
    (f) => { f.settings.integrateConfirmation = "disabled"; },
    (f) => { delete f.policy.savedProjectSettings.targetBranch; },
    (f) => { delete f.policy.savedProjectSettings.method; },
    (f) => { f.settings.method = "squash"; f.policy.savedProjectSettings.method = "squash"; },
    (f) => { f.options.isTrusted = () => false; },
    (f) => { f.options.target = f.options.source; },
  ]) { const f = await fixture(t); mutate(f); await assert.rejects(prepareSelectedIntegration(f.options)); }
});

test("receipt duplicates, foreign checkout/session, stage mismatch and missing rows are refused", async (t) => {
  for (const kind of ["duplicate", "foreign-session", "foreign-checkout", "stage", "missing"]) {
    const f = await fixture(t); f.settings.checks = [recipe("handoff"), recipe()];
    const r = await f.check(kind === "stage" ? 0 : 1, kind === "stage" ? "handoff" : "integration",
      kind === "foreign-session" ? "someone-else" : f.options.sessionId, kind === "foreign-checkout" ? f.options.target : f.options.source);
    f.options.receiptIds = kind === "duplicate" ? [r.id, r.id] : kind === "missing" ? [] : [r.id];
    await assert.rejects(prepareSelectedIntegration(f.options), /receipt|stale/);
  }
});
test("stale policy revision, recipe or source ref refuses before intent", async (t) => {
  for (const kind of ["revision", "recipe", "source"]) {
    const f = await fixture(t); f.settings.checks = [recipe()]; f.options.receiptIds = [(await f.check(0)).id];
    const plan = await prepareSelectedIntegration(f.options);
    if (kind === "revision") f.policy.policyRevision = "saved-2";
    if (kind === "recipe") f.settings.checks[0].label = "changed";
    if (kind === "source") git(f.source, "commit", "--allow-empty", "-qm", "moved source");
    await assert.rejects(f.apply(plan), (e) => e.code !== "target_moved");
    assert.equal(f.intent, undefined); assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  }
});
for (const method of ["ff", "merge"]) test(`${method} real receipt target movement is positively pre-effect target_moved only`, async (t) => {
  const f = await fixture(t, { method }); f.settings.checks = [recipe()]; f.options.receiptIds = [(await f.check(0)).id];
  const plan = await prepareSelectedIntegration(f.options);
  git(f.target, "commit", "--allow-empty", "-qm", "moved target");
  await assert.rejects(f.apply(plan), (e) => e.code === "target_moved");
  assert.equal(f.intent, undefined); assert.equal(readFileSync(join(f.target, "note"), "utf8"), "base\n");
});
test("target movement with a changed source config/policy or unrelated ref is not target_moved", async (t) => {
  for (const kind of ["config", "policy", "ref"]) {
    const f = await fixture(t); f.settings.checks = [recipe()]; f.options.receiptIds = [(await f.check(0)).id];
    const plan = await prepareSelectedIntegration(f.options);
    git(f.target, "commit", "--allow-empty", "-qm", "moved target");
    if (kind === "config") git(f.source, "config", "user.name", "Changed");
    if (kind === "policy") f.policy.policyRevision = "saved-2";
    if (kind === "ref") git(f.source, "branch", "unexpected");
    await assert.rejects(f.apply(plan), (e) => e.code !== "target_moved");
    assert.equal(f.intent, undefined);
  }
});
for (const method of ["ff", "merge"]) test(`${method} live grant revocation at final CAS quarantines, never issues proof`, async (t) => {
  const f = await fixture(t, { method }); const phases = [];
  f.options.authorize = (phase) => { phases.push(phase); if (phase === "before-ref-cas") throw Error("revoked"); return f.captureAuthorityGuard(); };
  const plan = await prepareSelectedIntegration(f.options);
  const out = await f.apply(plan);
  assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
  assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: false, indexInstalled: false, completionVerified: false });
  assert.ok(phases.includes("before-checkout")); assert.ok(phases.includes("before-ref-cas"));
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
  assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
});
for (const method of ["ff", "merge"]) test(`${method} async final authorization mutations are postchecked before ref CAS or proof`, async (t) => {
  for (const kind of ["unrelated-ref", "trust", "source-selection", "target-selection", "marker", "source-oid", "target-files", "index-flags", "invalid-postguard", "async-postguard"]) {
    const f = await fixture(t, { method, targetMain: true });
    f.settings.checks = [recipe("commit"), recipe()]; f.options.receiptIds = [(await f.check(1)).id];
    let finalCalled = false;
    f.options.isTrusted = async () => f.authority.trusted;
    f.options.isSelectionAuthorized = async (selection) => selection.cwd === f.source ? f.authority.sourceAllowed : f.authority.targetAllowed;
    f.options.authorize = async (phase) => {
      const guard = f.captureAuthorityGuard();
      if (phase !== "before-ref-cas") return guard;
      finalCalled = true;
      assert.equal(readFileSync(join(f.target, "note"), "utf8"), "feature\n");
      await Promise.resolve(); // Mutation occurs within the final authorization await.
      if (kind === "unrelated-ref") git(f.source, "branch", "auth-mutated-ref");
      if (kind === "trust") f.authority.trusted = false;
      if (kind === "source-selection") f.authority.sourceAllowed = false;
      if (kind === "target-selection") f.authority.targetAllowed = false;
      if (kind === "marker") writeFileSync(join(f.options.target.gitDir, "MERGE_HEAD"), "unfinished\n");
      if (kind === "source-oid") git(f.source, "update-ref", "refs/heads/feature", git(f.source, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "changed source"));
      if (kind === "target-files") writeFileSync(join(f.target, "note"), "changed during authorization\n");
      if (kind === "index-flags") {
        const alternate = join(f.home, "changed-index");
        writeFileSync(alternate, readFileSync(join(f.options.target.gitDir, "index")));
        execFileSync("git", ["-C", f.target, "update-index", "--assume-unchanged", "note"],
          { env: { ...process.env, GIT_INDEX_FILE: alternate }, stdio: ["ignore", "pipe", "pipe"] });
        writeFileSync(join(f.options.target.gitDir, "index"), readFileSync(alternate));
      }
      if (kind === "invalid-postguard") return { assertOwned() {} };
      if (kind === "async-postguard") return async () => {};
      return guard;
    };
    const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
    assert.equal(finalCalled, true, kind);
    assert.equal(out.result.status, "partial-state", kind); assert.equal(out.result.code, undefined);
    assert.equal(out.nativeHandle, undefined, kind); assert.equal(readSelectedIntegrationNativeProof(out.result), undefined);
    assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: false, indexInstalled: false, completionVerified: false }, kind);
    assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid, kind);
    assert.equal(JSON.parse(readFileSync(out.result.recoveryPath, "utf8")).phase, "prepared");
    assert.match(out.result.reason, /do not retry/);
    assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
    await assert.rejects(f.apply(plan), /plan/);
  }
});
for (const method of ["ff", "merge"]) test(`${method} final authorization postguard fences revocation during async post-validation`, async (t) => {
  const f = await fixture(t, { method }); let finalReturned = false, asserted = false;
  f.options.authorize = async (phase) => {
    const guard = f.captureAuthorityGuard();
    if (phase !== "before-ref-cas") return guard;
    await Promise.resolve(); finalReturned = true;
    return () => { asserted = true; guard(); };
  };
  f.options.isTrusted = async () => { if (finalReturned) f.authority.grant = "deny"; return f.authority.trusted; };
  const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
  assert.equal(asserted, true); assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
  assert.equal(out.nativeOutcome.refUpdateCompleted, false);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
});
for (const method of ["ff", "merge"]) test(`${method} last policy-reader await cannot revoke grant/access behind a void or live authorizer`, async (t) => {
  for (const returnKind of ["void", "live-guard"]) {
    const f = await fixture(t, { method, targetMain: true });
    f.settings.checks = [recipe("commit"), recipe()]; f.options.receiptIds = [(await f.check(1)).id];
    let finalReturned = false, policyReads = 0, revoked = false, accessObservedAllowed = false;
    f.options.isSelectionAuthorized = async (selection) => {
      const allowed = selection.cwd === f.source ? f.authority.sourceAllowed : f.authority.targetAllowed;
      if (finalReturned && selection.cwd === f.target) accessObservedAllowed = allowed;
      return allowed;
    };
    f.options.getPolicy = async () => {
      if (finalReturned && ++policyReads === 3) {
        // selectedAuthorization's context read, then selectedReceipts' context
        // read, then its LAST second policy read. Policy and Git remain identical.
        await Promise.resolve();
        assert.equal(accessObservedAllowed, true);
        f.authority.grant = "deny"; f.authority.targetAllowed = false; f.authority.version++;
        revoked = true;
      }
      return f.policy;
    };
    f.options.authorize = async (phase) => {
      const guard = f.captureAuthorityGuard(); // Truthfully allowed at capture.
      if (phase !== "before-ref-cas") return guard;
      await Promise.resolve(); finalReturned = true;
      return returnKind === "void" ? undefined : guard; // Untyped void is intentionally invalid.
    };
    const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
    assert.equal(revoked, true, returnKind); assert.ok(policyReads >= 3);
    assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
    assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: false, indexInstalled: false, completionVerified: false });
    assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
    assert.equal(git(f.source, "rev-parse", "HEAD"), plan.review.featureOid);
    assert.equal(readSelectedIntegrationNativeProof(out.result), undefined);
    assert.equal(JSON.parse(readFileSync(out.result.recoveryPath, "utf8")).phase, "prepared");
    assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
    await assert.rejects(f.apply(plan), /plan/);
  }
});
for (const method of ["ff", "merge"]) test(`${method} cached-hooks await reasserts live guards at actual ref transaction launch`, async (t) => {
  const f = await fixture(t, { method }); let queued = false, revoked = false, assertions = 0;
  f.options.authorize = async (phase) => {
    const live = f.captureAuthorityGuard();
    if (phase !== "before-ref-cas") return live;
    return () => {
      assertions++; live(); // First assertion is truthfully allowed.
      if (!queued) {
        queued = true;
        queueMicrotask(() => { f.authority.grant = "deny"; f.authority.version++; revoked = true; });
      }
    };
  };
  const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
  assert.equal(queued, true); assert.equal(revoked, true); assert.equal(assertions, 2);
  assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
  assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: false, indexInstalled: false, completionVerified: false });
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(readSelectedIntegrationNativeProof(out.result), undefined);
  assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
  await assert.rejects(f.apply(plan), /plan/);
});
test("prepare captures a mandatory synchronous guard; void, unknown, async, thenable and failing guards deny before effects", async (t) => {
  for (const method of ["ff", "merge"]) for (const kind of ["void", "unknown", "async", "thenable", "failure", "unknown-live-source"]) {
    const f = await fixture(t, { method });
    f.options.authorize = () => {
      if (kind === "void") return;
      if (kind === "unknown") return { assertOwned() {} };
      if (kind === "async") return async () => {};
      if (kind === "thenable") return () => Promise.resolve();
      if (kind === "failure") return () => { throw Error("live reservation unavailable"); };
      const live = f.captureAuthorityGuard(); f.authority.known = false; return live;
    };
    const old = git(f.target, "rev-parse", "HEAD");
    await assert.rejects(prepareSelectedIntegration(f.options));
    assert.equal(f.intent, undefined); assert.equal(git(f.target, "rev-parse", "HEAD"), old);
    assert.equal(git(f.target, "status", "--porcelain"), "");
  }
});
test("a real synchronous authority source is mandatory; absent, unknown, thenable or failing readers deny", async (t) => {
  for (const kind of ["absent", "unknown", "thenable", "number", "empty", "failure"]) {
    const f = await fixture(t);
    if (kind === "absent") delete f.options.readAuthorityRevisionSync;
    if (kind === "unknown") f.options.readAuthorityRevisionSync = () => undefined;
    if (kind === "thenable") f.options.readAuthorityRevisionSync = () => Promise.resolve(f.authority.version);
    if (kind === "number") f.options.readAuthorityRevisionSync = () => f.authority.version;
    if (kind === "empty") f.options.readAuthorityRevisionSync = () => "";
    if (kind === "failure") f.options.readAuthorityRevisionSync = () => { throw Error("source unknown"); };
    const before = git(f.target, "rev-parse", "HEAD");
    await assert.rejects(prepareSelectedIntegration(f.options));
    assert.equal(f.intent, undefined); assert.equal(git(f.target, "rev-parse", "HEAD"), before);
    assert.equal(git(f.target, "status", "--porcelain"), "");
  }
});
for (const method of ["ff", "merge"]) test(`${method} saved prepare guard rejects a fresh Allow from another authority revision`, async (t) => {
  const f = await fixture(t, { method });
  const plan = await prepareSelectedIntegration(f.options);
  f.authority.version++; // Still Allow, but not the authority captured with this exact plan.
  await assert.rejects(f.apply(plan), /pre-apply/);
  assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
  assert.equal(git(f.target, "status", "--porcelain"), "");
  await assert.rejects(f.apply(plan), /plan/);
});
for (const method of ["ff", "merge"]) test(`${method} empty-stage final authorization still binds all refs without fabricated receipts`, async (t) => {
  const f = await fixture(t, { method });
  f.options.authorize = async (phase) => {
    const guard = f.captureAuthorityGuard();
    if (phase === "before-ref-cas") { await Promise.resolve(); git(f.source, "branch", "unexpected"); }
    return guard;
  };
  const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
  assert.deepEqual(plan.receiptIds, []); assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
  assert.equal(out.nativeOutcome.refUpdateCompleted, false); assert.equal(git(f.target, "rev-parse", "HEAD"), plan.review.targetOid);
});
test("after-checkout competing ref and real-index failures cannot earn completion proof", async (t) => {
  for (const kind of ["target", "index", "files", "source"]) {
    const f = await fixture(t);
    f.options.afterCheckout = () => {
      if (kind === "target") git(f.target, "update-ref", "refs/heads/delivery", git(f.target, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "winner"));
      if (kind === "index") writeFileSync(join(f.options.target.gitDir, "index"), "bad index");
      if (kind === "files") writeFileSync(join(f.target, "note"), "changed\n");
      if (kind === "source") git(f.source, "commit", "--allow-empty", "-qm", "changed source");
    };
    const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
    assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
    assert.equal(readSelectedIntegrationNativeProof(out), undefined);
    assert.equal(JSON.parse(readFileSync(out.result.recoveryPath, "utf8")).phase, "prepared");
  }
});
for (const method of ["ff", "merge"]) test(`${method} ref-CAS failure and post-ref index failure have truthful known checkpoints, no native handle`, async (t) => {
  for (const kind of ["ref-cas", "index-install", "final-source"]) {
    const f = await fixture(t, { method });
    if (kind === "ref-cas") f.options.authorize = (phase) => {
      if (phase === "before-ref-cas") writeFileSync(join(f.options.target.commonDir, "refs", "heads", "delivery.lock"), "competing writer");
      return f.captureAuthorityGuard();
    };
    if (kind === "index-install") f.options.afterRefUpdate = () => { throw Error("index installer unavailable"); };
    if (kind === "final-source") f.options.afterRefUpdate = () => git(f.source, "commit", "--allow-empty", "-qm", "late source writer");
    const plan = await prepareSelectedIntegration(f.options), out = await f.apply(plan);
    assert.equal(out.result.status, "partial-state"); assert.equal(out.nativeHandle, undefined);
    assert.deepEqual(out.nativeOutcome, { checkoutAttempted: true, refUpdateCompleted: kind !== "ref-cas",
      indexInstalled: kind === "final-source", completionVerified: false });
    assert.equal(git(f.target, "rev-parse", "HEAD"), kind === "ref-cas" ? plan.review.targetOid : method === "ff" ? plan.featureOid : plan.mergeOid);
    assert.equal(inspectGitOperationAdmission(f.options.agentDir, f.options.source.commonDir).reason, "unresolved");
    assert.equal(readSelectedIntegrationNativeProof(out.result), undefined);
  }
});
test("expired receipts and clean-but-rewritten source index do not satisfy the exact saved snapshot", async (t) => {
  for (const kind of ["expiry", "index"]) {
    const f = await fixture(t); f.settings.checks = [recipe()];
    const r = await f.check(0); f.options.receiptIds = [r.id];
    if (kind === "index") {
      git(f.source, "update-index", "--index-version", "3");
      // Add/remove an extension by rewriting to v4; tree and checkout stay clean.
      git(f.source, "update-index", "--index-version", "4");
      assert.equal(git(f.source, "status", "--porcelain"), "");
      await assert.rejects(prepareSelectedIntegration(f.options), /stale/);
    } else {
      const now = Date.now; Date.now = () => r.expiresAt;
      try { await assert.rejects(prepareSelectedIntegration(f.options), /receipt|stale/); }
      finally { Date.now = now; }
    }
  }
});
test("exact approval/session binds and captured candidate includes actual OIDs, parents, policy and admission epoch", async (t) => {
  const f = await fixture(t); const candidates = [];
  f.options.authorize = (phase, candidate) => { candidates.push({ phase, candidate }); return f.captureAuthorityGuard(); };
  const plan = await prepareSelectedIntegration(f.options);
  await assert.rejects(confirmSelectedIntegration(plan.planId, "wrong", f.options.sessionId, async () => {}), /exact/);
  await assert.rejects(confirmSelectedIntegration(plan.planId, plan.planId, "other-session", async () => {}), /another session/);
  const out = await f.apply(plan); assert.equal(out.result.status, "integrated");
  for (const { candidate } of candidates) {
    assert.equal(candidate.planId, plan.planId); assert.equal(candidate.sourceOid, plan.review.featureOid);
    assert.equal(candidate.targetOid, plan.review.targetOid); assert.equal(candidate.resultOid, plan.featureOid);
    assert.deepEqual(candidate.parents, plan.parents); assert.equal(candidate.context.policyRevision, f.policy.policyRevision);
    assert.match(candidate.admissionEpoch, /^[a-f0-9]{64}$/);
  }
  assert.ok(candidates.some(({ phase }) => phase === "before-checkout"));
  assert.ok(candidates.some(({ phase }) => phase === "before-ref-cas"));
});
test("new resolved admission epoch and recovery invalidation consume selected candidates", async (t) => {
  const f = await fixture(t); const plan = await prepareSelectedIntegration(f.options);
  beginGitOperationIntent(f.options.agentDir, f.options.source.commonDir, randomUUID(), "integration").resolve();
  await assert.rejects(f.apply(plan), /predates/);
  const next = await prepareSelectedIntegration(f.options); invalidateGitIntegrationPlansForResource(f.options.source.commonDir);
  await assert.rejects(f.apply(next), /plan/);
});
test("legacy empty checks remain refused and never receive selected zero-check permission", async (t) => {
  const f = await fixture(t);
  await assert.rejects(prepareIntegration({ sessionId: "legacy", agentDir: f.options.agentDir, cwd: f.source,
    featureBranch: "feature", receiptIds: [], getPolicy: () => ({ mode: "current", onCreate: "continue", commits: "manual", checks: [],
      integration: { targetBranch: "delivery", method: "merge" } }) }), /receipt/);
});
