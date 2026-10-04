import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = mkdtempSync(join(tmpdir(), "cleanup-fence-"));
const previous = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, "config"), PI_CODING_AGENT_DIR: join(home, "agent") });
after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(home, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { createGitCheckAuthorityFence, bindGitCheckCleanupCandidate, acceptGitCheckCleanupRemoval } = await jiti.import("./git-check-authority-fence.ts");
const { createGitCleanupEngine, readGitCleanupNativeProof, readGitCleanupCandidateAuthority } = await jiti.import("./git-cleanup-operation.ts");
const { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
const { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof } = await jiti.import("./git-selected-integration.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { createGitProjectTrustStore, getProjectTrustStatus } = await jiti.import("./project-trust.ts");
const { advanceGitScopedAuthority } = await jiti.import("./git-scoped-authority.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function session(cwd) {
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], timestamp: Date.now() });
  const scope = { sessionId: sm.getSessionId(), sessionFile: sm.getSessionFile(), cwd };
  cacheSessionPath(scope.sessionId, scope.sessionFile);
  return { sm, scope };
}
async function fixture(t) {
  const dir = mkdtempSync(join(home, "native-")), repo = join(dir, "repo"), source = join(dir, "feature");
  const agentDir = mkdtempSync(join(home, "agent-")); process.env.PI_CODING_AGENT_DIR = agentDir;
  git(dir, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com"); git(repo, "config", "commit.gpgsign", "false");
  mkdirSync(join(repo, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(repo, ".pi", "extensions", "fixture.ts"), "export default function fixture() {}\n");
  writeFileSync(join(repo, "base"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "base"); allowFileRoot(dir);
  const trust = createGitProjectTrustStore(agentDir); trust.set(dir, true);
  const starter = session(repo), starterFence = createGitCheckAuthorityFence({ scope: starter.scope, agentDir, checkouts: [repo], projectRoots: [repo] });
  const starterRevision = starterFence(), starterOwner = { sessionId: starter.scope.sessionId, sessionFile: starter.scope.sessionFile, generation: randomUUID() };
  const assertStarter = () => { assert.equal(starterFence(), starterRevision); };
  const starterAuthority = { owner: starterOwner, readAuthorityRevisionSync: starterFence,
    assertCurrentSync(binding) { assertStarter(); assert.deepEqual(binding.owner, starterOwner); assert.equal(binding.source.projectRoot, repo); } };
  const select = (cwd) => selectCanonicalGitResources({ repositoryPath: repo, checkoutPath: cwd });
  const originalSource = await select(repo);
  const workspace = await captureGitWorkspaceOperation({ mode: "create", repositoryPath: repo, sourceCheckoutPath: repo,
    destinationPath: source, branch: "feature", baseBranch: "main", expectedBaseOid: git(repo, "rev-parse", "HEAD") }, {}, starterAuthority);
  const creation = await applyGitWorkspaceOperation({ candidate: workspace, authorize: async () => assertStarter() });
  writeFileSync(join(source, "new"), "feature\n");
  git(source, "add", "."); git(source, "commit", "-qm", "feature with trust-requiring resources");
  const feature = await select(source), target = await select(repo);
  const policy = { policyRevision: "fixture-policy", settings: { ...structuredClone(DEFAULT_GIT_WORKFLOW_SETTINGS),
    mainBranch: "main", targetBranch: ":project-main", method: "ff", checks: [] },
    savedProjectSettings: { mainBranch: "main", targetBranch: ":project-main", method: "ff", delivery: "local" } };
  // A new actual authority snapshot for the separate integration invocation.
  const integrationFence = createGitCheckAuthorityFence({ scope: starter.scope, agentDir, checkouts: [source, repo], projectRoots: [repo] });
  const integrationRevision = integrationFence();
  const assertIntegration = () => { assert.equal(integrationFence(), integrationRevision); };
  const integrationAuthority = { owner: { ...starterOwner, generation: randomUUID() }, readAuthorityRevisionSync: integrationFence,
    assertCurrentSync(binding) { assertIntegration(); assert.equal(binding.source.cwd, source); } };
  const plan = await prepareSelectedIntegration({ sessionId: starter.scope.sessionId, agentDir, source: feature, target, receiptIds: [],
    nativeAuthority: integrationAuthority, getPolicy: () => policy, isTrusted: (root) => getProjectTrustStatus(root, agentDir).trusted,
    isSelectionAuthorized: () => { assertIntegration(); return true; }, isCheckAuthorized: () => { assertIntegration(); return true; },
    readAuthorityRevisionSync: integrationFence, authorize: () => { assertIntegration(); return assertIntegration; } });
  const integrated = await confirmSelectedIntegration(plan.planId, plan.planId, starter.scope.sessionId);
  assert.equal(integrated.result.status, "integrated");
  const own = session(source), owner = { sessionId: own.scope.sessionId, sessionFile: own.scope.sessionFile, generation: randomUUID() };
  let tools = ["read", "write", "bash"];
  const inner = { sessionId: own.scope.sessionId, sessionFile: own.scope.sessionFile, sessionManager: own.sm,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }), getActiveToolNames: () => tools,
    setActiveToolsByName(names) { tools = [...names]; }, dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true }), oldSessions = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[own.scope.sessionId, wrapper]]);
  t.after(() => { wrapper.destroy(); globalThis.__piSessions = oldSessions;
    invalidateSessionPathCache(own.scope.sessionId); invalidateSessionPathCache(starter.scope.sessionId); });
  // Own bootstrap starts scoped-empty like runtime; candidate projection must
  // use this ORIGINAL complete map, not capture selected authority at bind.
  const options = { scope: own.scope, agentDir, checkouts: [source], projectRoots: [], invocationOwner: owner };
  const fence = createGitCheckAuthorityFence(options), baseline = fence(), hooks = {};
  const approved = new Set(); let applying = false;
  const nativeAuthority = { owner, readAuthorityRevisionSync: fence, assertCurrentSync(binding) {
    assert.equal(fence(), baseline); assert.deepEqual(binding.owner, owner); assert.deepEqual(binding.source, feature);
    if (applying) assert.ok(approved.has(binding.candidateSha256), "exact original candidate approval");
  } };
  const completedAt = Date.now(), integrationHandle = integrated.nativeHandle;
  const engine = createGitCleanupEngine({ nativeAuthority,
    readCompletedIntegration(handle) {
      if (handle !== integrationHandle) return undefined;
      const p = readSelectedIntegrationNativeProof(handle); if (!p) return undefined;
      return { completedAt, delivery: "selected-local", method: p.method, actualFF: p.actualFF, feature, target,
        featureOid: p.featureOid, previousTargetOid: p.previousTargetOid, resultOid: p.resultOid, resultTree: p.resultTree, parents: p.parents };
    },
    readCreatedWorkspace(handle) {
      if (handle !== creation) return undefined;
      const p = readGitWorkspaceNativeProof(handle); if (!p) return undefined;
      return { mode: p.mode, destination: p.destination, originalSource, branchRef: p.branchRef };
    },
    getProjectMain: async () => target,
    async authorize(phase, candidate, proof) {
      if (phase === "before-delete") {
        assert.equal(readGitCleanupNativeProof(proof).kind, "removed");
        await hooks.beforeAccept?.(candidate, proof);
        acceptGitCheckCleanupRemoval(fence, candidate, proof);
        await hooks.afterAccept?.(candidate, proof);
      }
      assert.equal(fence(), baseline);
      await hooks.authorize?.(phase, candidate, proof);
    },
  });
  return { ...own, owner, options, dir, repo, source, agentDir, feature, target, fence, baseline, hooks, inner, trust,
    capture: () => engine.capture({ integrationHandle, creatorHandle: creation }),
    bind(candidate) { bindGitCheckCleanupCandidate(fence, candidate); },
    apply(candidate) { approved.add(readGitCleanupCandidateAuthority(candidate).binding.candidateSha256); applying = true; return engine.apply(candidate); } };
}
async function partial(f, candidate) {
  await assert.rejects(f.apply(candidate), (error) => {
    assert.equal(error.code, "recovery-required"); assert.equal(error.facts.removeExit, 0);
    assert.equal(error.facts.sourceAbsent, true); assert.equal(error.facts.removalVerified, true);
    assert.equal(error.facts.branchDeleteAttempted, false); return true;
  });
  assert.equal(existsSync(f.source), false);
  assert.equal(git(f.repo, "rev-parse", "feature"), git(f.repo, "rev-parse", "main"));
}

test("genuine native own-cwd removal retains original fence, live trust and saved cwd; another reader cannot poison permissions", async (t) => {
  const f = await fixture(t), candidate = await f.capture(); f.bind(candidate);
  const roots = globalThis.__piAdditionalAllowedRoots, cache = globalThis.__piAllowedRootsCache;
  globalThis.__piAdditionalAllowedRoots = new Set([f.source, f.repo]); globalThis.__piAllowedRootsCache = undefined;
  t.after(() => { globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cache; });
  const other = createGitCheckAuthorityFence({ ...f.options, invocationOwner: undefined }), before = other();
  assert.equal(getProjectTrustStatus(f.source, f.agentDir).requiresTrust, true);
  f.hooks.beforeAccept = () => {
    assert.notEqual(other(), before, "ordinary reader observes source absence BEFORE transition acceptance");
    assert.equal(getProjectTrustStatus(f.source, f.agentDir).requiresTrust, false, "actual SDK discovery changed due ONLY to removal");
  };
  f.hooks.afterAccept = (original, proof) => {
    acceptGitCheckCleanupRemoval(f.fence, original, proof); // SAME authentic pair is idempotent.
    const otherProject = join(f.dir, "unrelated"); mkdirSync(otherProject);
    const doc = readGitWorkflowSettingsDocument(f.agentDir); doc.projects[otherProject] = { enabled: false };
    writeGitWorkflowSettingsDocument(doc, f.agentDir, [{ kind: "project", projectRoot: otherProject }]);
    advanceGitScopedAuthority(f.agentDir, "grants", [{ kind: "chat-project", sessionId: randomUUID(), projectRoot: otherProject }]);
    f.trust.set(otherProject, false);
    assert.equal(f.fence(), f.baseline, "unrelated B settings, grants and trust remain independent after own source removal");
  };
  const result = await f.apply(candidate); assert.equal(result.status, "completed");
  assert.equal(existsSync(f.source), false); assert.equal(existsSync(f.feature.gitDir), false);
  assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  assert.equal(f.fence(), f.baseline); assert.equal(f.fence(), f.baseline, "ordinary post-completion checks do not rebaseline");
  f.sm.appendCustomEntry("pi-web:git-action", { version: 1, actionId: randomUUID() });
  assert.equal(f.fence(), f.baseline);
  assert.equal(f.scope.cwd, f.source); assert.equal(f.sm.getCwd(), f.source); assert.equal(f.sm.getHeader().cwd, f.source);
  assert.equal(JSON.parse(readFileSync(f.scope.sessionFile, "utf8").split("\n")[0]).cwd, f.source);
});

for (const change of ["settings-equal", "settings-deny-restore", "grants", "trust-restore", "sdk-tools-restore", "sdk-trust-restore", "sdk-navigation-restore", "pause", "opt-out", "roots-restore", "target-roots-restore"]) {
  test(`original ${change} at genuine source-gone boundary still prevents branch deletion`, async (t) => {
    const f = await fixture(t), candidate = await f.capture(); f.bind(candidate);
    f.hooks.beforeAccept = () => {
      if (change.startsWith("settings")) {
        const doc = readGitWorkflowSettingsDocument(f.agentDir), original = structuredClone(doc);
        if (change === "settings-deny-restore") doc.projects[f.repo] = { enabled: false };
        writeGitWorkflowSettingsDocument(doc, f.agentDir, [{ kind: "project", projectRoot: f.repo }]);
        if (change === "settings-deny-restore") writeGitWorkflowSettingsDocument(original, f.agentDir, [{ kind: "project", projectRoot: f.repo }]);
      } else if (change === "grants") advanceGitScopedAuthority(f.agentDir, "grants", [{ kind: "chat-project", sessionId: f.scope.sessionId, projectRoot: f.repo }]);
      else if (change === "trust-restore") { f.trust.set(f.dir, false); f.trust.set(f.dir, true); }
      else if (change === "sdk-tools-restore") { f.inner.setActiveToolsByName([]); f.inner.setActiveToolsByName(["read", "write", "bash"]); }
      else if (change === "sdk-trust-restore") { f.inner.settingsManager.setProjectTrusted(false); f.inner.settingsManager.setProjectTrusted(true); }
      else if (change === "sdk-navigation-restore") { const branch = f.sm.getBranch(); f.sm.branch(branch[0].id); f.sm.branch(branch.at(-1).id); }
      else if (change === "pause") {
        const doc = readGitWorkflowSettingsDocument(f.agentDir); doc.paused = true;
        writeGitWorkflowSettingsDocument(doc, f.agentDir, [{ kind: "global" }]);
        doc.paused = false; writeGitWorkflowSettingsDocument(doc, f.agentDir, [{ kind: "global" }]);
      }
      else if (change.endsWith("roots-restore")) {
        const other = createGitCheckAuthorityFence({ ...f.options, invocationOwner: undefined,
          checkouts: change === "target-roots-restore" ? [f.repo] : [f.source] });
        const roots = globalThis.__piAdditionalAllowedRoots, cache = globalThis.__piAllowedRootsCache;
        globalThis.__piAdditionalAllowedRoots = new Set(change === "target-roots-restore" ? [f.source] : []); globalThis.__piAllowedRootsCache = undefined;
        try { other(); } finally { globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cache; }
      } else f.sm.appendCustomEntry("pi-web:git-workflow", { version: 1, policy: null });
    };
    await partial(f, candidate); assert.throws(f.fence, /cleanup.*authority|physical transition/);
  });
}

test("fixed private pair rejects copied, foreign-owner and older-candidate proofs, without poisoning another original fence", async (t) => {
  const f = await fixture(t);
  const olderFence = createGitCheckAuthorityFence(f.options), copyFence = createGitCheckAuthorityFence(f.options);
  const oldCandidate = await f.capture(), candidate = await f.capture();
  bindGitCheckCleanupCandidate(olderFence, oldCandidate); bindGitCheckCleanupCandidate(copyFence, candidate); f.bind(candidate);
  const foreign = createGitCheckAuthorityFence({ ...f.options, invocationOwner: { ...f.owner, generation: randomUUID() } });
  assert.throws(() => bindGitCheckCleanupCandidate(foreign, candidate));
  f.hooks.beforeAccept = (current, proof) => {
    assert.throws(() => acceptGitCheckCleanupRemoval(olderFence, oldCandidate, proof));
    assert.throws(() => acceptGitCheckCleanupRemoval(copyFence, current, structuredClone(proof)));
    assert.throws(olderFence); assert.throws(copyFence); assert.throws(foreign);
  };
  assert.equal((await f.apply(candidate)).status, "completed");
  assert.equal(f.fence(), f.baseline);
});

test("a copied removal proof at the actual own fence leaves truthful source-gone partial state", async (t) => {
  const f = await fixture(t), candidate = await f.capture(); f.bind(candidate);
  f.hooks.beforeAccept = (original, proof) => acceptGitCheckCleanupRemoval(f.fence, original, structuredClone(proof));
  await partial(f, candidate); assert.throws(f.fence);
});

for (const replacement of ["source", "admin", "target", "marker", "parent"]) {
  test(`observed ${replacement} replacement then restoration terminally revokes accepted transition`, async (t) => {
    const f = await fixture(t), candidate = await f.capture(); f.bind(candidate);
    f.hooks.afterAccept = () => {
      assert.equal(f.fence(), f.baseline);
      if (replacement === "source" || replacement === "admin") {
        const file = replacement === "source" ? f.source : f.feature.gitDir;
        mkdirSync(file, { recursive: true }); assert.throws(f.fence); rmSync(file, { recursive: true });
      } else {
        const file = replacement === "target" ? f.repo : replacement === "marker" ? join(f.repo, ".git") : f.dir;
        const moved = `${file}-original`; renameSync(file, moved); mkdirSync(file);
        try { assert.throws(f.fence); } finally { rmSync(file, { recursive: true }); renameSync(moved, file); }
      }
      assert.throws(f.fence, "restoration cannot revive the accepted transition");
    };
    await partial(f, candidate);
  });
}

test("bind projects original pre-await scoped map: relevant writes before candidate binding never rebaseline", async (t) => {
  const f = await fixture(t), candidate = await f.capture();
  advanceGitScopedAuthority(f.agentDir, "settings", [{ kind: "project", projectRoot: f.repo }]);
  assert.throws(() => f.bind(candidate)); assert.throws(f.fence);
  assert.equal(existsSync(f.source), true);
});
