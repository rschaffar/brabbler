import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto, { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test, { after, mock } from "node:test";
// Install the delegating fixture shim before Jiti captures built-in exports.
// Outside the one collision test it always calls the real UUID generator.
let collisionId;
const actualUUID = crypto.randomUUID;
const uuidMock = mock.method(crypto, "randomUUID", (...args) => collisionId ?? actualUUID(...args));
syncBuiltinESMExports();
after(() => { uuidMock.mock.restore(); syncBuiltinESMExports(); });
const home = mkdtempSync(join(tmpdir(), "cleanup-config-")), oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = home; process.env.XDG_CONFIG_HOME = home;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  rmSync(home, { recursive: true, force: true });
});
const { createJiti } = await import("jiti"), jiti = createJiti(import.meta.url);
const { createGitCleanupEngine, readGitCleanupNativeProof: proofOf, readGitCleanupCandidateEvidence: evidenceOf,
  readGitCleanupCandidateAuthority: authorityOf, readGitCleanupRemovalAuthority: removalAuthorityOf } = await jiti.import("./git-cleanup-operation.ts");
const { createGitCleanupAdmission, assertGitCleanupNativeStateSync } = await jiti.import("./git-cleanup-admission.ts");
const { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
const { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof } = await jiti.import("./git-selected-integration.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t, { method = "ff", attach = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-native-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo"), source = join(dir, "feature"), agentDir = join(dir, "agent"); mkdirSync(agentDir);
  git(dir, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com"); git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "base"), "base\n"); writeFileSync(join(repo, ".gitignore"), "ignored\ncache/\n");
  git(repo, "add", "."); git(repo, "commit", "-qm", "base"); allowFileRoot(dir);
  const owner = { sessionId: randomUUID(), sessionFile: join(agentDir, "owner.jsonl"), generation: randomUUID() };
  writeFileSync(owner.sessionFile, JSON.stringify({ type: "session", id: owner.sessionId, cwd: source }) + "\n");
  const live = { revision: 0, allowed: true, generation: owner.generation, applying: false, approvals: new Set(), removal: undefined };
  const hooks = {}, readAuthorityRevisionSync = () => `scope:${live.revision}`;
  const nativeAuthority = { owner, readAuthorityRevisionSync, assertCurrentSync(binding) {
    assert.equal(live.allowed, true, "independent own permission"); assert.equal(live.generation, owner.generation);
    assert.deepEqual(binding.owner, owner); assert.equal(binding.source.projectRoot, repo);
    assert.equal(JSON.parse(readFileSync(owner.sessionFile, "utf8")).id, owner.sessionId);
    if (live.applying) assert.equal(live.approvals.has(binding.candidateSha256), true, "exact approval required");
    else live.candidate = binding.candidateSha256;
    if (binding.kind === "cleanup" && !existsSync(source)) {
      assert.ok(live.removal, "own removal transition must be explicitly bound");
      const native = proofOf(live.removal); assert.equal(native.kind, "removed");
      assert.equal(native.sourcePath, binding.source.cwd); assert.deepEqual(native.sourceIdentity, binding.source.identities.checkout);
      assert.equal(existsSync(native.adminPath), false);
    }
    hooks.guard?.(binding);
  } };
  const select = (cwd) => selectCanonicalGitResources({ repositoryPath: repo, checkoutPath: cwd });
  const originalSource = await select(repo), baseOid = git(repo, "rev-parse", "HEAD");
  if (attach) git(repo, "branch", "feature");
  const wc = await captureGitWorkspaceOperation({ mode: attach ? "attach" : "create", repositoryPath: repo, sourceCheckoutPath: repo,
    destinationPath: source, branch: "feature", baseBranch: "main", expectedBaseOid: baseOid,
    ...(attach ? { expectedTipOid: baseOid } : {}) }, {}, nativeAuthority);
  live.approvals.add(live.candidate); live.applying = true;
  const creation = await applyGitWorkspaceOperation({ candidate: wc, authorize: async () => assert.equal(live.allowed, true) });
  live.applying = false;
  writeFileSync(join(source, "new"), "feature\n"); git(source, "add", "."); git(source, "commit", "-qm", "feature");
  const feature = await select(source), target = await select(repo);
  const policy = { policyRevision: "policy-1", settings: { ...structuredClone(DEFAULT_GIT_WORKFLOW_SETTINGS), mainBranch: "main", targetBranch: ":project-main", method, checks: [] },
    savedProjectSettings: { mainBranch: "main", targetBranch: ":project-main", method, delivery: "local" } };
  const plan = await prepareSelectedIntegration({ sessionId: owner.sessionId, agentDir, source: feature, target, receiptIds: [], nativeAuthority,
    getPolicy: () => policy, isTrusted: () => live.allowed, isSelectionAuthorized: () => live.allowed, isCheckAuthorized: () => live.allowed,
    readAuthorityRevisionSync, authorize: () => { const revision = live.revision; return () => { assert.ok(live.allowed); assert.equal(live.revision, revision); }; } });
  live.approvals.add(live.candidate); live.applying = true;
  const integrated = await confirmSelectedIntegration(plan.planId, plan.planId, owner.sessionId);
  const ih = integrated.nativeHandle, ch = creation, completedAt = Date.now(); live.applying = false;
  assert.equal(integrated.result.status, "integrated");
  let evidence, removal, completion, failure;
  const diagnostics = createGitCleanupAdmission({ agentDir,
    async onIntent(e) { evidence = e; await hooks.intent?.(e); },
    async onRemoval(p) { removal = p; assert.equal(proofOf(p).kind, "removed"); await hooks.removal?.(p); },
    async onCompleted(p) { completion = p; assert.equal(proofOf(p).kind, "completed"); await hooks.completed?.(p); },
    async onFailure(f) { failure = f; await hooks.failure?.(f); },
  });
  const adapters = { ...diagnostics, nativeAuthority,
    readCompletedIntegration(handle) {
      if (handle !== ih) return undefined;
      const p = readSelectedIntegrationNativeProof(handle); if (!p) return undefined;
      return { completedAt, delivery: "selected-local", method: p.method, actualFF: p.actualFF, feature, target,
        featureOid: p.featureOid, previousTargetOid: p.previousTargetOid, resultOid: p.resultOid, resultTree: p.resultTree, parents: p.parents };
    },
    readCreatedWorkspace(handle) {
      if (handle !== ch) return undefined;
      const p = readGitWorkspaceNativeProof(handle); if (!p) return undefined;
      return { mode: p.mode, destination: p.destination, originalSource, branchRef: p.branchRef };
    },
    getProjectMain: async () => target,
    async authorize(phase, candidate, proof) {
      assert.equal(live.allowed, true);
      if (candidate) assert.equal(candidate.sourcePath, source);
      if (phase === "before-delete") {
        assert.equal(proofOf(proof).kind, "removed");
        live.removal = proof; // explicit genuine physical transition, not source-exists fiction
      }
      await hooks.authorize?.(phase, candidate, proof);
    },
    testPrepareNativeLaunch: (phase) => hooks.launch?.(phase),
    testAfterDeleteSpawn: () => hooks.afterDeleteSpawn?.(),
  };
  const engine = createGitCleanupEngine(adapters), request = { integrationHandle: ih, creatorHandle: ch };
  return { ...engine, dir, repo, source, feature, target, baseOid, owner, live, hooks, adapters, creation, integrated,
    prepare: (extra = {}) => { live.applying = false; return engine.capture({ ...request, ...extra }); },
    execute: (c) => { live.approvals.add(live.candidate); live.applying = true; return engine.apply(c); },
    evidence: () => evidence, removal: () => removal, completion: () => completion, failure: () => failure,
    revoke() { live.allowed = false; live.revision++; }, restore() { live.allowed = true; live.revision++; } };
}
test("post-handoff original native fence precedes caller reads and rejects changes during callback await", async (t) => {
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { createGitCheckAuthorityFence, bindGitCheckCleanupCandidate, acceptGitCheckCleanupRemoval } = await jiti.import("./git-check-authority-fence.ts");
  const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
  const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  for (const change of ["none", "deny", "stop", "retire", "target", "branch", "replacement"]) await t.test(change, async (t) => {
    const f = await fixture(t), agentDir = join(f.dir, "agent");
    const manager = SessionManager.create(f.source, join(f.dir, "sessions"));
    manager.appendMessage({ role: "user", content: "Original caller cleanup fence fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], timestamp: Date.now() });
    const scope = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), cwd: f.source };
    cacheSessionPath(scope.sessionId, scope.sessionFile);
    t.after(() => invalidateSessionPathCache(scope.sessionId));
    const owner = { sessionId: scope.sessionId, sessionFile: scope.sessionFile, generation: randomUUID() };
    const fence = createGitCheckAuthorityFence({ scope, agentDir, checkouts: [f.source], projectRoots: [], invocationOwner: owner });
    const originalRevision = fence();
    let handedOff = false, postHandoffReads = 0;
    // Use the genuine transitioning fence AS the original revision reader, not
    // a constant wrapper. Both native authority and live(getProjectMain) read it.
    f.adapters.nativeAuthority = { owner, readAuthorityRevisionSync: fence, assertCurrentSync(binding) {
      assert.equal(fence(), originalRevision); assert.deepEqual(binding.owner, owner);
      assert.deepEqual(binding.source, f.feature); assert.equal(f.live.allowed, true);
      if (f.live.applying) assert.equal(f.live.approvals.has(binding.candidateSha256), true);
      else f.live.candidate = binding.candidateSha256;
    } };
    f.adapters.getProjectMain = async () => {
      assert.equal(fence(), originalRevision); // OLD order permanently revoked here after native removal.
      if (!existsSync(f.source)) { assert.equal(handedOff, true); postHandoffReads++; }
      return f.target;
    };
    const authorize = f.adapters.authorize;
    f.adapters.authorize = async (phase, original, proof) => {
      if (phase === "before-delete") {
        assert.equal(proofOf(proof).kind, "removed");
        acceptGitCheckCleanupRemoval(fence, original, proof); // before ANY ordinary fence read
        handedOff = true;
      }
      await authorize(phase, original, proof);
    };
    const candidate = await f.prepare(); bindGitCheckCleanupCandidate(fence, candidate);
    const expectedFeature = evidenceOf(candidate).source.oid;
    f.hooks.removal = () => { throw Error("optional removal publication unavailable"); };
    f.hooks.authorize = async (phase) => {
      if (phase !== "before-delete") return;
      await Promise.resolve();
      if (change === "deny" || change === "stop") {
        const document = readGitWorkflowSettingsDocument(agentDir);
        if (change === "deny") document.projects[f.repo] = { enabled: false };
        else document.paused = true;
        writeGitWorkflowSettingsDocument(document, agentDir, change === "deny"
          ? [{ kind: "project", projectRoot: f.repo }] : [{ kind: "global" }]);
      }
      if (change === "retire") f.retire(candidate);
      if (change === "target") { writeFileSync(join(f.repo, "late-target"), "later commit\n"); git(f.repo, "add", "."); git(f.repo, "commit", "-qm", "target advanced"); }
      if (change === "branch") git(f.repo, "update-ref", "refs/heads/feature", f.baseOid);
      if (change === "replacement") { mkdirSync(f.source); writeFileSync(join(f.source, "keep"), "replacement\n"); }
      // Returning successfully is NOT permission: the leaf must reassert the
      // original invocation/fence/state after this await and before branch CAS.
    };
    if (change === "none") {
      const result = await f.execute(candidate);
      assert.equal(result.status, "completed"); assert.equal(result.diagnostics, "unavailable");
      assert.ok(postHandoffReads > 0); assert.equal(fence(), originalRevision);
      assert.equal(git(f.repo, "branch", "--list", "feature"), "");
    } else {
      await assert.rejects(f.execute(candidate), (error) => {
        assert.equal(error.code, "recovery-required"); assert.equal(error.facts.removeExit, 0);
        assert.equal(error.facts.removalVerified, true); assert.equal(error.facts.branchDeleteAttempted, false);
        assert.equal(error.facts.sourceAbsent, change !== "replacement"); assert.equal(error.facts.adminAbsent, true); return true;
      });
      assert.equal(git(f.repo, "rev-parse", "feature"), change === "branch" ? f.baseOid : expectedFeature);
      if (change === "replacement") assert.equal(readFileSync(join(f.source, "keep"), "utf8"), "replacement\n");
    }
    assert.equal(handedOff, true); assert.equal(manager.getCwd(), f.source);
    assert.equal(manager.getHeader().cwd, f.source); assert.equal(existsSync(f.feature.gitDir), false);
  });
});

for (const method of ["ff", "merge"]) test(`actual native create + selected ${method} + independently approved cleanup`, async (t) => {
  const f = await fixture(t, { method }), candidate = await f.prepare(), result = await f.execute(candidate);
  assert.equal(result.status, "completed"); assert.equal(result.diagnostics, "recorded");
  assert.equal(existsSync(f.source), false); assert.equal(existsSync(f.feature.gitDir), false);
  assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  assert.equal(proofOf(result).kind, "completed"); assert.equal(proofOf(f.removal()).kind, "removed");
  for (const p of [result, result.proof, f.removal()]) {
    assert.equal(proofOf({ ...p }), undefined); assert.equal(proofOf(JSON.parse(JSON.stringify(p))), undefined);
    assert.equal(proofOf(proofOf(p)), undefined);
  }
  f.retire(candidate); f.retire(candidate);
  await assert.rejects(f.execute(candidate), { code: "stale" });
  assert.equal(evidenceOf(candidate).integration.featureOid, result.proof.deletedOid);
  assert.equal(proofOf(result).deletedOid, result.proof.deletedOid);
});

test("cleanup candidate reader returns only detached immutable original facts, never provenance", async (t) => {
  const f = await fixture(t), candidate = await f.prepare(), original = evidenceOf(candidate), next = evidenceOf(candidate);
  assert.equal(f.evidence(), undefined, "review facts do not depend on diagnostic callback publication");
  assert.equal(original.version, 2); assert.equal(original.actionId, candidate.actionId);
  assert.equal(original.target.oid, git(f.repo, "rev-parse", "HEAD"));
  assert.equal(original.integration.feature.cwd, f.source);
  assert.deepEqual(next, original); assert.notEqual(next, original); assert.notEqual(next.integration, original.integration);
  assert.equal(Object.isFrozen(original), true); assert.equal(Object.isFrozen(original.main.identities.checkout), true);
  assert.throws(() => { original.main.cwd = f.source; }, TypeError);
  assert.throws(() => { original.source.ignored.push({ path: "forged" }); }, TypeError);
  const copy = structuredClone(original); copy.target.oid = f.baseOid;
  assert.deepEqual(evidenceOf(candidate), original);
  for (const unknown of [{ ...candidate }, JSON.parse(JSON.stringify(candidate)), candidate.actionId, null, undefined, original, copy]) {
    assert.equal(evidenceOf(unknown), undefined);
    assert.throws(() => f.retire(unknown), { code: "stale" });
    await assert.rejects(f.apply(unknown), { code: "stale" });
  }
  assert.equal(proofOf(original), undefined);
  assert.equal(f.adapters.readCreatedWorkspace(original.creator), undefined);
  assert.equal(f.adapters.readCompletedIntegration(original.integration), undefined);
  const otherEngine = createGitCleanupEngine(f.adapters);
  assert.throws(() => otherEngine.retire(candidate), { code: "stale" });
  const result = await f.execute(candidate); // copies and the other engine did not retire the original
  assert.equal(result.status, "completed"); assert.deepEqual(evidenceOf(candidate), original);
  assert.throws(() => f.retire(result), { code: "stale" });
  assert.equal(evidenceOf(result), undefined);
});

test("declined cleanup original retires without authority/effects but facts remain readable", async (t) => {
  const f = await fixture(t), candidate = await f.prepare(), before = evidenceOf(candidate);
  f.revoke();
  f.retire(candidate); f.retire(candidate);
  assert.deepEqual(evidenceOf(candidate), before); assert.equal(f.evidence(), undefined);
  assert.equal(existsSync(f.source), true); assert.equal(git(f.repo, "rev-parse", "feature"), before.source.oid);
  f.restore();
  await assert.rejects(f.execute(candidate), { code: "stale" });
  assert.equal((await f.execute(await f.prepare())).status, "completed");
  assert.deepEqual(evidenceOf(candidate), before, "retired facts are not reconstructed from current absent source");
});

test("retiring cleanup after native removal preserves genuine partial proof and denies later effects", async (t) => {
  const f = await fixture(t), candidate = await f.prepare(), before = evidenceOf(candidate);
  f.hooks.removal = () => { f.retire(candidate); f.retire(candidate); };
  let partial;
  await assert.rejects(f.execute(candidate), (error) => {
    partial = error; assert.equal(error.code, "recovery-required");
    assert.equal(error.facts.removeExit, 0); assert.equal(error.facts.removalVerified, true);
    assert.equal(error.facts.branchDeleteAttempted, false); assert.equal(error.facts.sourceAbsent, true); return true;
  });
  const facts = structuredClone(partial.facts), nativeRemoval = proofOf(f.removal());
  f.retire(candidate); f.retire(candidate);
  assert.deepEqual(partial.facts, facts); assert.deepEqual(evidenceOf(candidate), before);
  assert.deepEqual(proofOf(f.removal()), nativeRemoval);
  assert.equal(existsSync(f.source), false); assert.equal(git(f.repo, "rev-parse", "feature"), before.source.oid);
  await assert.rejects(f.execute(candidate), { code: "stale" });
});

test("fixed cleanup authority readers reject same-field originals from a different private invocation", async (t) => {
  const f = await fixture(t), fixedId = randomUUID();
  // Deliberately collide ALL public candidate/binding fields. Both candidates
  // are real captures; only their private native invocation objects differ.
  collisionId = fixedId;
  let oldCandidate, candidate;
  try { oldCandidate = await f.prepare(); candidate = await f.prepare(); }
  finally { collisionId = undefined; }
  assert.notEqual(oldCandidate, candidate); assert.deepEqual(oldCandidate, candidate);
  const originalAuthority = authorityOf(candidate), oldAuthority = authorityOf(oldCandidate);
  assert.deepEqual(originalAuthority.binding, oldAuthority.binding);
  assert.deepEqual(originalAuthority.binding.owner, f.owner);
  assert.deepEqual(originalAuthority.binding.source, f.feature);
  assert.deepEqual(originalAuthority.binding.target, f.target);
  assert.equal(originalAuthority.binding.kind, "cleanup");
  assert.equal(originalAuthority.binding.candidateSha256,
    crypto.createHash("sha256").update(JSON.stringify(candidate)).digest("hex"));
  assert.deepEqual(originalAuthority.evidence, evidenceOf(candidate));
  assert.notEqual(authorityOf(candidate).binding, originalAuthority.binding);
  assert.equal(Object.isFrozen(originalAuthority.binding.owner), true);
  assert.equal(Object.isFrozen(originalAuthority.evidence.source), true);
  assert.throws(() => { originalAuthority.binding.owner.generation = "forged"; }, TypeError);
  const altered = structuredClone(originalAuthority); altered.binding.owner.generation = "forged";
  altered.evidence.source.oid = f.baseOid;
  assert.deepEqual(authorityOf(candidate), originalAuthority);
  const fakeCandidates = [{ ...candidate }, JSON.parse(JSON.stringify(candidate)), candidate.actionId,
    originalAuthority, Object.freeze(structuredClone(originalAuthority)), altered, () => originalAuthority, null, undefined];
  for (const fake of fakeCandidates) assert.equal(authorityOf(fake), undefined);
  assert.equal(removalAuthorityOf(candidate, candidate), undefined, "capture alone is no native removal");
  f.retire(oldCandidate);
  let removal;
  f.hooks.authorize = (phase, original, proof) => {
    if (phase !== "before-delete") return;
    removal = proof; assert.equal(original, candidate);
    assert.deepEqual(removalAuthorityOf(candidate, proof), originalAuthority);
    assert.equal(removalAuthorityOf(oldCandidate, proof), undefined, "same owner/action/hash/resources is not same invocation");
    for (const fake of fakeCandidates) assert.equal(removalAuthorityOf(fake, proof), undefined);
    for (const fake of [{ ...proof }, JSON.parse(JSON.stringify(proof)), proofOf(proof), Object.freeze(structuredClone(proof)),
      proof.actionId, () => proof, null, undefined]) assert.equal(removalAuthorityOf(candidate, fake), undefined);
    const detached = removalAuthorityOf(candidate, proof);
    assert.notEqual(detached, originalAuthority); assert.notEqual(detached.evidence, originalAuthority.evidence);
    assert.throws(() => { detached.evidence.integration.feature.cwd = f.repo; }, TypeError);
    assert.equal(proofOf(proof).sourcePath, f.source);
    assert.equal(proofOf(detached), undefined); assert.equal(authorityOf(detached), undefined);
    assert.throws(() => f.retire(detached), { code: "stale" });
  };
  const result = await f.execute(candidate);
  f.retire(candidate); f.retire(candidate);
  assert.deepEqual(authorityOf(candidate), originalAuthority);
  assert.deepEqual(removalAuthorityOf(candidate, removal), originalAuthority, "historical private link survives retirement");
  assert.equal(removalAuthorityOf(oldCandidate, removal), undefined);
  assert.equal(removalAuthorityOf(candidate, result.proof), undefined, "completion is not a removal handle");
  assert.equal(removalAuthorityOf(candidate, result), undefined);
  await assert.rejects(f.execute(candidate), { code: "stale" });
  await assert.rejects(f.apply(removalAuthorityOf(candidate, removal)), { code: "stale" });
});

test("native attach is never create-only selected cleanup provenance", async (t) => {
  const f = await fixture(t, { attach: true }); await assert.rejects(f.prepare()); assert.equal(existsSync(f.source), true);
});

test("copied lineage, candidate and JSON native removal proof cannot authorize", async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  await assert.rejects(f.apply({ ...candidate }));
  await assert.rejects(f.prepare({ creatorHandle: { ...f.creation } }));
  await assert.rejects(f.prepare({ integrationHandle: { ...f.integrated.nativeHandle } }));
  f.hooks.removal = (p) => {
    for (const copy of [{ ...p }, JSON.parse(JSON.stringify(p)), { ...p, durable: true }]) {
      assert.equal(proofOf(copy), undefined); assert.throws(() => assertGitCleanupNativeStateSync(f.evidence(), copy));
    }
    assertGitCleanupNativeStateSync(f.evidence(), p);
  };
  assert.equal((await f.execute(candidate)).status, "completed");
  assert.throws(() => assertGitCleanupNativeStateSync(f.evidence(), f.removal()), "historical removal cannot replay after branch deletion");
});

test("missing proper authority fails before first asynchronous authority/candidate work", async (t) => {
  const f = await fixture(t); let called = false;
  const engine = createGitCleanupEngine({ ...f.adapters, nativeAuthority: undefined, getProjectMain: async () => { called = true; return f.target; } });
  await assert.rejects(engine.capture({}), /authority required/); assert.equal(called, false);
  assert.equal(existsSync(f.source), true);
});

test("capture-time authority change-and-restore never silently rebaselines", async (t) => {
  const f = await fixture(t), pending = f.prepare(); f.revoke(); f.restore(); await assert.rejects(pending);
  assert.equal((await f.execute(await f.prepare())).status, "completed");
});

test("diagnostics failure at begin/removal/completion is independent of native success", async (t) => {
  for (const phase of ["intent", "removal", "completed"]) await t.test(phase, async (t) => {
    const f = await fixture(t); f.hooks[phase] = () => { throw Error("record unavailable"); };
    const result = await f.execute(await f.prepare());
    assert.equal(result.status, "completed"); assert.equal(result.diagnostics, "unavailable");
    assert.equal(proofOf(result).deletedOid, result.proof.deletedOid);
    assert.equal(existsSync(f.source), false); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  });
});

test("original removal transition needs no diagnostic publisher or ACK", async (t) => {
  const f = await fixture(t);
  for (const key of ["onIntent", "onRemoval", "onCompleted", "onFailure"]) f.adapters[key] = undefined;
  const result = await f.execute(await f.prepare());
  assert.equal(result.diagnostics, "not-requested"); assert.equal(proofOf(result).kind, "completed");
  assert.equal(f.removal(), undefined); assert.equal(proofOf(f.live.removal).kind, "removed");
});

test("independent persisted active sessions/terminal use, corrupt history and unrelated refs are not vetoes", async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  const sessions = join(f.dir, "sessions"); mkdirSync(sessions);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const terminal = await jiti.import("./terminal-manager.ts");
  const manager = SessionManager.create(f.source, sessions);
  manager.appendMessage({ role: "user", content: "Disposable active cleanup fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], api: "openai-responses", provider: "fixture", model: "fixture",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  assert.equal(existsSync(manager.getSessionFile()), true);
  const oldSessions = globalThis.__piSessions, oldShell = process.env.SHELL;
  globalThis.__piSessions = new Map([[manager.getSessionId(), { isRunning: () => true, inner: { sessionManager: manager } }]]);
  process.env.SHELL = "/bin/sh";
  let terminalId;
  try {
    terminalId = terminal.createTerminal(f.source, 80, 24);
    assert.equal(terminal.hasTerminal(terminalId), true);
    const ledger = join(f.dir, "agent", "pi-web", "git-operation-admission", "v1"); mkdirSync(ledger, { recursive: true });
    writeFileSync(join(ledger, "corrupt"), "{broken failed uncertain historical record");
    git(f.repo, "branch", "unrelated"); git(f.repo, "worktree", "add", "-q", join(f.dir, "unrelated"), "unrelated");
    assert.equal((await f.execute(candidate)).status, "completed");
    assert.equal(manager.getCwd(), f.source, "no automatic session move");
    assert.equal(terminal.getTerminalCwd(terminalId), f.source, "no automatic terminal move");
    assert.equal(existsSync(manager.getSessionFile()), true);
  } finally {
    if (terminalId) terminal.killTerminal(terminalId, true);
    globalThis.__piSessions = oldSessions;
    if (oldShell === undefined) delete process.env.SHELL; else process.env.SHELL = oldShell;
  }
});

test("unchanged ignored manifest requires explicit complete names; new ignored data refuses", async (t) => {
  const f = await fixture(t); mkdirSync(join(f.source, "cache")); writeFileSync(join(f.source, "ignored"), "private");
  await assert.rejects(f.prepare(), { code: "ignored-blocked" });
  await assert.rejects(f.prepare({ ignoredNames: ["cache/*", "ignored"] }));
  const candidate = await f.prepare({ ignoredNames: ["cache", "ignored"] });
  f.hooks.launch = (phase) => { if (phase === "remove") writeFileSync(join(f.source, "cache", "new"), "new private bytes"); };
  await assert.rejects(f.execute(candidate)); assert.equal(existsSync(f.source), true);
  f.hooks.launch = undefined;
  assert.equal((await f.execute(await f.prepare({ ignoredNames: ["cache", "cache/new", "ignored"] }))).status, "completed");
});

for (const change of ["feature-ref", "target-ref", "tracked", "untracked", "replacement", "marker", "hook", "permission"]) test(`pre-effect ${change} refuses without removal`, async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  f.hooks.launch = (phase) => {
    if (phase !== "remove") return;
    if (change === "feature-ref") git(f.repo, "update-ref", "refs/heads/feature", f.baseOid);
    if (change === "target-ref") { writeFileSync(join(f.repo, "new-target"), "new\n"); git(f.repo, "add", "."); git(f.repo, "commit", "-qm", "advance"); }
    if (change === "tracked") writeFileSync(join(f.source, "base"), "changed");
    if (change === "untracked") writeFileSync(join(f.source, "unknown"), "unapproved");
    if (change === "replacement") { renameSync(f.source, `${f.source}.old`); mkdirSync(f.source); }
    if (change === "marker") writeFileSync(join(f.feature.gitDir, "index.lock"), "unowned");
    if (change === "hook") writeFileSync(join(f.repo, ".git/hooks/post-checkout"), "unsupported");
    if (change === "permission") { f.revoke(); f.restore(); }
  };
  await assert.rejects(f.execute(candidate)); assert.equal(existsSync(f.source), true);
  await assert.rejects(f.execute(candidate), { code: "stale" });
});

for (const change of ["target", "branch", "path-reuse", "owner", "permission", "native-lock"]) test(`post-removal ${change} preserves partial truth and never rolls back`, async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  f.hooks.authorize = (phase) => {
    if (phase !== "before-delete") return;
    if (change === "target") { writeFileSync(join(f.repo, "new-target"), "new\n"); git(f.repo, "add", "."); git(f.repo, "commit", "-qm", "advance"); }
    if (change === "branch") git(f.repo, "update-ref", "refs/heads/feature", f.baseOid);
    if (change === "path-reuse") { mkdirSync(f.source); writeFileSync(join(f.source, "keep"), "replacement"); }
    if (change === "owner") f.live.generation = randomUUID();
    if (change === "permission") { f.revoke(); f.restore(); }
    if (change === "native-lock") writeFileSync(join(f.repo, ".git/refs/heads/feature.lock"), "unowned");
  };
  await assert.rejects(f.execute(candidate), (error) => {
    assert.equal(error.code, "recovery-required"); assert.equal(error.facts.removalVerified, true);
    assert.equal(error.facts.branchDeleteVerified, false); assert.equal(error.facts.adminAbsent, true); return true;
  });
  assert.notEqual(git(f.repo, "branch", "--list", "feature"), "");
  assert.equal(existsSync(f.source), change === "path-reuse");
  if (change === "path-reuse") assert.equal(readFileSync(join(f.source, "keep"), "utf8"), "replacement");
  if (change === "native-lock") assert.equal(readFileSync(join(f.repo, ".git/refs/heads/feature.lock"), "utf8"), "unowned");
});

test("real expected-old branch CAS loss is measured partial, not rollback or repository veto", async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  f.hooks.afterDeleteSpawn = () => git(f.repo, "update-ref", "refs/heads/feature", f.baseOid);
  await assert.rejects(f.execute(candidate), (error) => {
    assert.equal(error.code, "recovery-required");
    assert.equal(error.facts.removeExit, 0); assert.equal(error.facts.removalVerified, true);
    assert.equal(error.facts.branchDeleteAttempted, true); assert.equal(error.facts.branchDeleteVerified, false);
    assert.equal(error.facts.sourceAbsent, true); assert.equal(error.facts.observedFeatureOid, f.baseOid); return true;
  });
  assert.equal(git(f.repo, "rev-parse", "feature"), f.baseOid); assert.equal(existsSync(f.source), false);
  // A new genuinely authorized operation is independent of this failed attempt.
  f.live.applying = false;
  const fresh = await captureGitWorkspaceOperation({ mode: "create", repositoryPath: f.repo, sourceCheckoutPath: f.repo,
    destinationPath: join(f.dir, "independent"), branch: "independent", baseBranch: "main", expectedBaseOid: git(f.repo, "rev-parse", "HEAD") }, {}, f.adapters.nativeAuthority);
  f.live.approvals.add(f.live.candidate); f.live.applying = true;
  assert.equal((await applyGitWorkspaceOperation({ candidate: fresh, authorize: async () => assert.ok(f.live.allowed) })).status, "created");
});

test("unsupported ignored symlinks and object-store indirection retain data", async (t) => {
  const f = await fixture(t); symlinkSync(join(f.repo, "base"), join(f.source, "ignored"));
  await assert.rejects(f.prepare({ ignoredNames: ["ignored"] })); assert.equal(existsSync(f.source), true);
  rmSync(join(f.source, "ignored")); writeFileSync(join(f.repo, ".git/objects/info/alternates"), "/unapproved/store\n");
  await assert.rejects(f.prepare()); assert.equal(existsSync(f.source), true);
});
