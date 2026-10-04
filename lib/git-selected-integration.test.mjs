import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
const configHome = mkdtempSync(join(tmpdir(), "native-selected-config-"));
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  rmSync(configHome, { recursive: true, force: true }); });
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const { createJiti } = await import("jiti"), jiti = createJiti(import.meta.url);
const { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof, readSelectedIntegrationNativeTargetMove, retireSelectedIntegrationPlan } = await jiti.import("./git-selected-integration.ts");
const { readGitIntegrationNativeOutcome } = await jiti.import("./git-integration.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { runGitCheckoutVerification, lookupGitCheckoutVerificationReceipt } = await jiti.import("./git-checkout-verification.ts");
const { createGitCheckCohort, retireGitCheckCohort } = await jiti.import("./git-check-runner.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t, method = "ff") {
  const home = mkdtempSync(join(tmpdir(), "native-integration-leaf-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent"); mkdirSync(agentDir);
  git(home, "init", "-qb", "main", main); git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  git(main, "config", "commit.gpgsign", "false"); git(main, "config", "core.autocrlf", "false");
  writeFileSync(join(main, "base"), "base\n"); git(main, "add", "."); git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-qb", "feature", feature); writeFileSync(join(feature, "feature"), "feature\n"); git(feature, "add", "."); git(feature, "commit", "-qm", "feature");
  allowFileRoot(main); allowFileRoot(feature);
  const owner = { sessionId: "fixture-session", sessionFile: join(home, "session.json"), generation: "fixture-generation-1" };
  writeFileSync(owner.sessionFile, JSON.stringify(owner));
  const live = { revision: 1, allowed: true, owner, approvals: new Set(), applying: false };
  const readAuthorityRevisionSync = () => String(live.revision);
  const nativeAuthority = { owner, readAuthorityRevisionSync, assertCurrentSync(binding) {
    if (live.failure) throw live.failure;
    assert.equal(live.allowed, true); assert.deepEqual(binding.owner, live.owner);
    assert.deepEqual(JSON.parse(readFileSync(owner.sessionFile)), owner);
    if (live.applying) assert.ok(live.approvals.has(binding.candidateSha256), "independent exact approval required");
    else live.candidate = binding.candidateSha256;
  } };
  const policy = { policyRevision: "policy-1", settings: { ...structuredClone(DEFAULT_GIT_WORKFLOW_SETTINGS), mainBranch: "main", targetBranch: ":project-main", method, checks: [] },
    savedProjectSettings: { mainBranch: "main", targetBranch: ":project-main", method, delivery: "local" } };
  const options = { sessionId: owner.sessionId, agentDir, source: await selectCanonicalGitResources({ repositoryPath: main, checkoutPath: feature }),
    target: await selectCanonicalGitResources({ repositoryPath: main, checkoutPath: main }), receiptIds: [], nativeAuthority,
    getPolicy: () => policy, isTrusted: () => live.allowed, isSelectionAuthorized: () => live.allowed, isCheckAuthorized: () => live.allowed,
    readAuthorityRevisionSync, authorize: () => { const revision = live.revision; return () => { assert.ok(live.allowed); assert.equal(live.revision, revision); }; } };
  const apply = (plan) => { live.approvals.add(live.candidate); live.applying = true; return confirmSelectedIntegration(plan.planId, plan.planId, owner.sessionId); };
  const before = () => ({ head: git(main, "rev-parse", "HEAD"), index: readFileSync(join(main, ".git", "index")), files: git(main, "status", "--porcelain") });
  return { home, main, feature, options, policy, live, owner, apply, before };
}
async function checkSelected(f, checkIndex, cohort, sessionId = f.owner.sessionId) {
  return runGitCheckoutVerification({ sessionId, agentDir: f.options.agentDir, selector: { repositoryPath: f.main, checkoutPath: f.feature },
    checkIndex, stage: "integration", ...(cohort ? { cohort } : {}), getPolicy: () => ({ settings: f.policy.settings, policyRevision: f.policy.policyRevision }),
    isTrusted: () => f.live.allowed, isSelectionAuthorized: () => f.live.allowed, isActorAuthorized: () => f.live.allowed,
    readAuthorityRevisionSync: f.options.readAuthorityRevisionSync, testContainmentBackend: createTestContainmentBackend() });
}
function stagedRecipes() {
  return ["none", "integration", "commit", "integration"].map((requiredStage, i) => ({ label: `check-${i}`, requiredStage,
    argv: [process.execPath, "-e", requiredStage === "integration" ? "process.exit(0)" : "process.exit(1)"] }));
}
for (const method of ["ff", "merge"]) test(`selected batch ${method}: original complete stage-index cohort required, none cannot waive siblings`, async (t) => {
  const f = await fixture(t, method); f.policy.settings.checks = stagedRecipes();
  const independent = [await checkSelected(f, 1), await checkSelected(f, 3)]; f.options.receiptIds = independent.map((r) => r.id);
  assert.ok(independent.every((r) => lookupGitCheckoutVerificationReceipt(r.id) === r));
  await assert.rejects(prepareSelectedIntegration(f.options), /batch|cohort/);
  const cohort = createGitCheckCohort([1, 3]), first = await checkSelected(f, 1, cohort);
  f.options.receiptIds = [first.id]; await assert.rejects(prepareSelectedIntegration(f.options));
  const second = await checkSelected(f, 3, cohort);
  f.options.receiptIds = [first.id, first.id]; await assert.rejects(prepareSelectedIntegration(f.options));
  f.options.receiptIds = [second.id, first.id]; await assert.rejects(prepareSelectedIntegration(f.options));
  f.options.receiptIds = [first.id, second.id]; const p = await prepareSelectedIntegration(f.options);
  assert.deepEqual(p.selectedContext.checkIndexes, [1, 3]); assert.equal((await f.apply(p)).result.status, "integrated");
});
test("selected batch failed members never qualify; other-session failed batch leaves exact original successful batch current", async (t) => {
  const f = await fixture(t), flag = join(f.options.agentDir, "fail-check"); f.policy.settings.checks = stagedRecipes();
  f.policy.settings.checks[3].argv = [process.execPath, "-e", "process.exit(require('node:fs').existsSync(process.argv[1])?1:0)", flag];
  const good = createGitCheckCohort([1, 3]), rows = [await checkSelected(f, 1, good), await checkSelected(f, 3, good)];
  const ownFailed = createGitCheckCohort([1, 3]), ownFirst = await checkSelected(f, 1, ownFailed);
  writeFileSync(flag, "fail"); await assert.rejects(checkSelected(f, 3, ownFailed));
  f.options.receiptIds = [ownFirst.id, rows[1].id]; await assert.rejects(prepareSelectedIntegration(f.options));
  const other = createGitCheckCohort([1, 3]); await checkSelected(f, 1, other, "other-session");
  await assert.rejects(checkSelected(f, 3, other, "other-session"));
  assert.ok(rows.every((r) => lookupGitCheckoutVerificationReceipt(r.id) === r));
  f.options.receiptIds = rows.map((r) => r.id); const p = await prepareSelectedIntegration(f.options);
  assert.equal((await f.apply(p)).result.status, "integrated");
});
for (const phase of ["before-apply", "after-checkout"]) test(`selected batch retirement at ${phase} is checked by original native invocation`, async (t) => {
  const f = await fixture(t); f.policy.settings.checks = stagedRecipes(); const cohort = createGitCheckCohort([1, 3]);
  f.options.receiptIds = [(await checkSelected(f, 1, cohort)).id, (await checkSelected(f, 3, cohort)).id];
  if (phase === "after-checkout") f.options.afterCheckout = () => retireGitCheckCohort(cohort);
  const p = await prepareSelectedIntegration(f.options), old = f.before().head;
  if (phase === "before-apply") retireGitCheckCohort(cohort);
  await assert.rejects(f.apply(p), (e) => { const measured = readGitIntegrationNativeOutcome(e);
    assert.equal(measured.checkoutAttempted, phase === "after-checkout"); assert.equal(measured.refCommitSent, false); return true; });
  assert.equal(git(f.main, "rev-parse", "HEAD"), old); assert.equal(existsSync(join(f.main, ".git", "index.lock")), false);
});
test("selected zero integration requirements needs no fake empty batch", async (t) => {
  const f = await fixture(t); f.policy.settings.checks = [{ label: "optional", requiredStage: "none", argv: [process.execPath, "-e", "process.exit(1)"] }];
  const p = await prepareSelectedIntegration(f.options); assert.deepEqual(p.selectedContext.checkIndexes, []);
  assert.equal((await f.apply(p)).result.status, "integrated");
});
for (const method of ["ff", "merge"]) test(`native ${method} preserves requested object/parents; original proof survives retire, not copies`, async (t) => {
  const f = await fixture(t, method), old = f.before().head, plan = await prepareSelectedIntegration(f.options);
  const outcome = await f.apply(plan), proof = readSelectedIntegrationNativeProof(outcome.nativeHandle);
  assert.equal(outcome.result.status, "integrated"); assert.equal(outcome.nativeOutcome.native.status, "complete");
  assert.equal(proof.resultOid, git(f.main, "rev-parse", "HEAD")); assert.deepEqual(proof.invocationOwner, f.owner);
  assert.equal(proof.resultTree, plan.review.featureTreeOid);
  assert.deepEqual(proof.parents, method === "ff" ? [old] : [old, plan.review.featureOid]);
  assert.equal(git(f.main, "show", "-s", "--format=%P", "HEAD"), proof.parents.join(" "));
  assert.equal(readSelectedIntegrationNativeProof({ ...outcome.nativeHandle }), undefined);
  assert.equal(readSelectedIntegrationNativeProof(JSON.parse(JSON.stringify(outcome.nativeHandle))), undefined);
  assert.equal(readGitIntegrationNativeOutcome(outcome.result).refAcknowledged, true);
  assert.equal(existsSync(join(f.main, ".git", "index.lock")), false);
  await assert.rejects(f.apply(plan));
});
test("missing original caller, wrong approval and obsolete reservation callback refuse without effects", async (t) => {
  const f = await fixture(t), before = f.before();
  await assert.rejects(prepareSelectedIntegration({ ...f.options, nativeAuthority: undefined }), /original native invocation/);
  const p = await prepareSelectedIntegration(f.options);
  await assert.rejects(confirmSelectedIntegration(p.planId, "wrong", f.owner.sessionId));
  await assert.rejects(confirmSelectedIntegration(p.planId, p.planId, f.owner.sessionId, () => { throw Error("must not run"); }), /legacy/);
  assert.deepEqual(f.before(), before);
});
test("change-and-restore during first async policy read rejects ORIGINAL revision", async (t) => {
  const f = await fixture(t), before = f.before(), getPolicy = f.options.getPolicy;
  f.options.getPolicy = async () => { f.live.allowed = false; f.live.revision++; await Promise.resolve(); f.live.allowed = true; f.live.revision++; return getPolicy(); };
  await assert.rejects(prepareSelectedIntegration(f.options), /authority changed/); assert.deepEqual(f.before(), before);
});
test("unrelated ref/history progress is neutral, relevant target movement never grants retry provenance", async (t) => {
  const f = await fixture(t), p = await prepareSelectedIntegration(f.options);
  git(f.main, "branch", "unrelated", "main");
  const ledger = join(f.options.agentDir, "pi-web", "git-operation-admission", "v1"); mkdirSync(ledger, { recursive: true }); writeFileSync(join(ledger, "foreign-corrupt"), "bad");
  assert.equal((await f.apply(p)).result.status, "integrated");
  const g = await fixture(t), q = await prepareSelectedIntegration(g.options);
  writeFileSync(join(g.main, "new"), "unrelated target advance\n"); git(g.main, "add", "."); git(g.main, "commit", "-qm", "advance");
  const before = g.before(); await assert.rejects(g.apply(q), (e) => { assert.equal(readSelectedIntegrationNativeTargetMove(e), undefined); return true; });
  assert.deepEqual(g.before(), before);
});
test("real required integration receipt remains necessary and authentic narrowed evidence works", async (t) => {
  const f = await fixture(t);
  f.policy.settings.checks = [{ label: "required", argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "integration" }];
  await assert.rejects(prepareSelectedIntegration(f.options), /receipts required/);
  const receipt = await runGitCheckoutVerification({ sessionId: f.owner.sessionId, agentDir: f.options.agentDir,
    selector: { repositoryPath: f.main, checkoutPath: f.feature }, checkIndex: 0, stage: "integration",
    getPolicy: () => ({ settings: f.policy.settings, policyRevision: f.policy.policyRevision }), isTrusted: () => true,
    isSelectionAuthorized: () => true, isActorAuthorized: () => true, readAuthorityRevisionSync: f.options.readAuthorityRevisionSync,
    testContainmentBackend: createTestContainmentBackend() });
  f.options.receiptIds = [receipt.id];
  const p = await prepareSelectedIntegration(f.options); assert.equal((await f.apply(p)).result.status, "integrated");
});
for (const change of ["foreign-lock", "source-ref", "target-symref", "hook", "path-swap", "raw-file"]) test(`pre-effect ${change} refuses without target effects`, async (t) => {
  const f = await fixture(t), p = await prepareSelectedIntegration(f.options), before = f.before();
  if (change === "foreign-lock") writeFileSync(join(f.main, ".git", "index.lock"), "foreign");
  if (change === "source-ref") git(f.feature, "update-ref", "refs/heads/feature", git(f.main, "rev-parse", "HEAD"));
  if (change === "target-symref") { git(f.main, "branch", "alias", "main"); git(f.main, "symbolic-ref", "refs/heads/main", "refs/heads/alias"); }
  if (change === "hook") writeFileSync(join(f.main, ".git", "hooks", "reference-transaction"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  if (change === "path-swap") { renameSync(f.feature, `${f.feature}.old`); symlinkSync(`${f.feature}.old`, f.feature); }
  if (change === "raw-file") writeFileSync(join(f.feature, "base"), "evil\n");
  await assert.rejects(f.apply(p));
  assert.equal(git(f.main, "rev-parse", "HEAD"), before.head); assert.deepEqual(readFileSync(join(f.main, ".git", "index")), before.index);
  assert.equal(existsSync(join(f.main, "feature")), false);
  if (change === "foreign-lock") assert.equal(readFileSync(join(f.main, ".git", "index.lock"), "utf8"), "foreign");
});
for (const phase of ["afterCheckout", "afterRefUpdate"]) test(`${phase} failure reports actual partial outcome and removes only owned index lock`, async (t) => {
  const f = await fixture(t); f.options[phase] = () => { throw Error("injected fixture failure"); };
  const p = await prepareSelectedIntegration(f.options), before = f.before();
  await assert.rejects(f.apply(p), (error) => {
    const outcome = readGitIntegrationNativeOutcome(error); assert.equal(outcome.checkoutAttempted, true);
    assert.equal(outcome.refAcknowledged, phase === "afterRefUpdate"); assert.equal(outcome.indexInstalled, false);
    assert.equal(readGitIntegrationNativeOutcome({ ...error }), undefined); return true;
  });
  assert.equal(existsSync(join(f.main, ".git", "index.lock")), false); assert.deepEqual(readFileSync(join(f.main, ".git", "index")), before.index);
});
test("final guard revoke-and-restore rejects before ref commit after real checkout", async (t) => {
  const f = await fixture(t); f.options.afterCheckout = () => { f.live.allowed = false; f.live.revision++; f.live.allowed = true; f.live.revision++; };
  const p = await prepareSelectedIntegration(f.options), old = f.before().head;
  await assert.rejects(f.apply(p), (e) => { const x = readGitIntegrationNativeOutcome(e); assert.equal(x.checkoutAttempted, true); assert.equal(x.refCommitSent, false); return true; });
  assert.equal(git(f.main, "rev-parse", "HEAD"), old); assert.equal(existsSync(join(f.main, ".git", "index.lock")), false);
});
for (const cause of ["expired", "stale", "authority"]) test(`original ${cause} confirm refusal has authentic pre-native checkpoints`, async (t) => {
  const f = await fixture(t), p = await prepareSelectedIntegration(f.options);
  if (cause === "expired") t.mock.method(Date, "now", () => p.expiresAt + 1);
  if (cause === "authority") f.live.revision++;
  if (cause === "stale") { writeFileSync(join(f.main, "new"), "new\n"); git(f.main, "add", "."); git(f.main, "commit", "-qm", "advance"); }
  const before = f.before();
  await assert.rejects(f.apply(p), (error) => {
    const facts = readGitIntegrationNativeOutcome(error);
    assert.deepEqual(facts, { status: "no-checkout-effect", checkoutAttempted: false, refPrepared: false, refCommitSent: false,
      refAcknowledged: false, indexInstalled: false, indexSynced: false, directorySyncFailed: false, childReaped: true });
    assert.ok(Object.isFrozen(facts)); assert.equal(readGitIntegrationNativeOutcome({ ...error }), undefined);
    assert.equal(readGitIntegrationNativeOutcome(new Error(error.message)), undefined);
    assert.equal(readSelectedIntegrationNativeTargetMove(error), undefined); return true;
  });
  assert.deepEqual(f.before(), before); assert.equal(retireSelectedIntegrationPlan(p), true);
});
test("unused selected plan retirement is original-identity/idempotent and cannot erase completed facts", async (t) => {
  const f = await fixture(t), first = await prepareSelectedIntegration(f.options), second = await prepareSelectedIntegration(f.options);
  assert.equal(retireSelectedIntegrationPlan(structuredClone(first)), false); assert.equal(retireSelectedIntegrationPlan(first.planId), false);
  const id = first.planId; first.planId = "not-a-capability";
  assert.equal(retireSelectedIntegrationPlan(first), true); assert.equal(retireSelectedIntegrationPlan(first), true);
  await assert.rejects(confirmSelectedIntegration(id, id, f.owner.sessionId), (e) => readGitIntegrationNativeOutcome(e)?.status === "no-checkout-effect");
  const completed = await f.apply(second), proof = readSelectedIntegrationNativeProof(completed.nativeHandle);
  assert.equal(retireSelectedIntegrationPlan(second), true); assert.equal(retireSelectedIntegrationPlan(second), true);
  assert.deepEqual(readSelectedIntegrationNativeProof(completed.nativeHandle), proof); assert.equal(readGitIntegrationNativeOutcome(completed.result).status, "complete");
});
test("preflight rethrow never overwrites an original helper error's actual partial checkpoints", async (t) => {
  const f = await fixture(t); f.options.afterCheckout = () => { throw Error("actual checkout failure"); };
  const p = await prepareSelectedIntegration(f.options); let nativeError;
  await assert.rejects(f.apply(p), (e) => { nativeError = e; return readGitIntegrationNativeOutcome(e)?.status === "partial"; });
  const original = readGitIntegrationNativeOutcome(nativeError), g = await fixture(t), q = await prepareSelectedIntegration(g.options);
  g.live.failure = nativeError;
  await assert.rejects(g.apply(q), (e) => e === nativeError);
  assert.deepEqual(readGitIntegrationNativeOutcome(nativeError), original); assert.equal(original.checkoutAttempted, true);
});
test("prepared native source ref lock blocks a real competing source writer", async (t) => {
  const f = await fixture(t); let attempted = false;
  f.options.afterCheckout = () => {
    attempted = true; assert.throws(() => git(f.feature, "update-ref", "refs/heads/feature", git(f.main, "rev-parse", "HEAD")));
  };
  const p = await prepareSelectedIntegration(f.options); assert.equal((await f.apply(p)).result.status, "integrated");
  assert.equal(attempted, true); assert.equal(git(f.feature, "rev-parse", "HEAD"), p.review.featureOid);
});
test("cached-clean unchanged source bytes still refuse before target checkout", async (t) => {
  const f = await fixture(t), old = new Date("2001-01-01T00:00:00Z"), file = join(f.feature, "base");
  git(f.main, "config", "core.trustctime", "false"); git(f.main, "config", "core.checkstat", "minimal");
  utimesSync(file, old, old); git(f.feature, "update-index", "--refresh");
  const p = await prepareSelectedIntegration(f.options), before = f.before();
  writeFileSync(file, "evil\n"); utimesSync(file, old, old);
  assert.equal(git(f.feature, "status", "--porcelain"), "", "fixture demonstrates lying Git stat cache");
  await assert.rejects(f.apply(p), (e) => { const x = readGitIntegrationNativeOutcome(e); if (x) assert.equal(x.checkoutAttempted, false); return true; });
  assert.deepEqual(f.before(), before); assert.equal(existsSync(join(f.main, "feature")), false);
});
test("late hook after checkout is an actual guarded partial refusal, not storage failure", async (t) => {
  const f = await fixture(t); f.options.afterCheckout = () => writeFileSync(join(f.main, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  const p = await prepareSelectedIntegration(f.options);
  await assert.rejects(f.apply(p), (e) => { const x = readGitIntegrationNativeOutcome(e); assert.equal(x.checkoutAttempted, true); assert.equal(x.refCommitSent, false); return true; });
  assert.equal(existsSync(join(f.main, ".git", "index.lock")), false);
});
for (const method of ["ff", "merge"]) test(`two genuine concurrent ${method} processes with different approved results: only one target winner`, async (t) => {
  const f = await fixture(t, method), sibling = join(f.home, "sibling"); git(f.main, "worktree", "add", "-qb", "sibling", sibling, "main");
  writeFileSync(join(sibling, "sibling"), "sibling\n"); git(sibling, "add", "."); git(sibling, "commit", "-qm", "sibling");
  const script = join(f.home, "contender.mjs");
  writeFileSync(script, `import {createRequire} from 'node:module'; import {writeFileSync,readFileSync} from 'node:fs';
const require=createRequire(${JSON.stringify(import.meta.url)}); const {createJiti}=require('jiti');const j=createJiti(${JSON.stringify(import.meta.url)});
const {prepareSelectedIntegration,confirmSelectedIntegration}=await j.import(${JSON.stringify(resolve("lib/git-selected-integration.ts"))});
const {readGitIntegrationNativeOutcome}=await j.import(${JSON.stringify(resolve("lib/git-integration.ts"))});
const {selectCanonicalGitResources}=await j.import(${JSON.stringify(resolve("lib/git-project-resources.ts"))});
const {allowFileRoot}=await j.import(${JSON.stringify(resolve("lib/file-access.ts"))});
const [main,source,id]=process.argv.slice(2);allowFileRoot(main);allowFileRoot(source);
const owner={sessionId:id,sessionFile:source+'-session.json',generation:'generation-1'};writeFileSync(owner.sessionFile,JSON.stringify(owner));
const state={revision:1,allowed:true,executing:false,approved:undefined,candidate:undefined};const read=()=>String(state.revision);
const policy=${JSON.stringify(f.policy)};
const options={sessionId:id,agentDir:${JSON.stringify(f.options.agentDir)},source:await selectCanonicalGitResources({repositoryPath:main,checkoutPath:source}),target:await selectCanonicalGitResources({repositoryPath:main,checkoutPath:main}),receiptIds:[],getPolicy:()=>policy,isTrusted:()=>state.allowed,isSelectionAuthorized:()=>state.allowed,isCheckAuthorized:()=>state.allowed,readAuthorityRevisionSync:read,authorize:()=>{const v=state.revision;return()=>{if(!state.allowed||state.revision!==v)throw Error('revoked')}},nativeAuthority:{owner,readAuthorityRevisionSync:read,assertCurrentSync(b){if(!state.allowed||readFileSync(owner.sessionFile,'utf8')!==JSON.stringify(owner))throw Error('owner');if(state.candidate&&state.candidate!==b.candidateSha256)throw Error('candidate');if(state.executing&&state.approved!==b.candidateSha256)throw Error('approval');state.candidate=b.candidateSha256;}}};
try{const p=await prepareSelectedIntegration(options);process.send({ready:true});await new Promise(r=>process.once('message',r));state.approved=state.candidate;state.executing=true;const out=await confirmSelectedIntegration(p.planId,p.planId,id);process.send({status:out.result.status,native:out.nativeOutcome.native});}catch(e){process.send({status:'refused',native:readGitIntegrationNativeOutcome(e),error:e.message});}finally{process.disconnect();}
`);
  const children = [f.feature, sibling].map((source, i) => fork(script, [f.main, source, `child-${i}`], { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
  t.after(() => children.forEach((c) => c.kill()));
  const done = children.map((child) => new Promise((resolve, reject) => { child.on("error", reject); child.on("message", (m) => { if (!m.ready) resolve(m); }); child.on("exit", (code) => { if (code) reject(Error(`child ${code}`)); }); }));
  await Promise.all(children.map((child) => new Promise((resolve, reject) => { child.on("message", (m) => m.ready ? resolve() : reject(Error(JSON.stringify(m)))); })));
  children.forEach((child) => child.send("go")); const outcomes = await Promise.all(done);
  assert.equal(outcomes.filter((x) => x.status === "integrated").length, 1, JSON.stringify(outcomes));
  const loser = outcomes.find((x) => x.status === "refused"); if (loser.native) assert.equal(loser.native.checkoutAttempted, false);
  assert.notEqual(existsSync(join(f.main, "feature")), existsSync(join(f.main, "sibling")));
  assert.equal(git(f.main, "status", "--porcelain"), ""); assert.equal(existsSync(join(f.main, ".git", "index.lock")), false);
});
