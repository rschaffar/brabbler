import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, setRpcSessionAccount, withExtensionTools } = await jiti.import("./rpc-manager.ts");
const { appendSessionAccounts, readSessionAccounts } = await jiti.import("./session-accounts.ts");
const { appendSessionGitWorkflow, readSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const worktreePolicy = { mode: "worktree", baseBranch: "main", onCreate: "fork", commits: "manual" };

test("post-run workspace transition is owned by settlement, not agent_end or browser events", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const start = source.slice(source.indexOf("  start(): void"), source.indexOf("  beginExtensionBinding(): void"));
  assert.match(start, /event\.type === "agent_settled"\) this\.notifyAgentRunCompleteIfIdle\(\)/);
  assert.doesNotMatch(start.slice(0, start.indexOf("  private notifyAgentRunCompleteIfIdle")), /agent_end"\) this\.notifyAgentRunCompleteIfIdle/);
  assert.match(start, /this\.scheduledGitWorkspace = null/);
  assert.match(start, /claimGitWorkspaceTransition\(this\.sessionId, transition\.nonce\)/);
  assert.match(start, /acquireGitCheckoutGate\(/);
  assert.match(start, /recordGitWorkspaceForkId\(this\.sessionId, transition\.nonce, newSessionId\)/);
  assert.match(start, /readSessionGitWorkflow\(manager\.getEntries\(\) as SessionEntry\[\]\)\?\.mode !== "worktree"/);
  assert.match(start, /readSessionGitWorkflow\(manager\.getEntries\(\) as SessionEntry\[\]\)\?\.onCreate !== transition\.onCreate/);
});

test("only this run's settlement claims a receipt; a failed check is manual and never replayed", async (t) => {
  const { readGitWorkspaceTransitionStatus } = await jiti.import("./git-workspace-transition.ts");
  const id = randomUUID();
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-run-end-"));
  t.after(() => rm(cwd, { force: true, recursive: true }));
  t.after(() => rm(join(getAgentDir(), "pi-web", "git-workspace-transitions", "v1", id), { force: true, recursive: true }));
  const sessionFile = join(cwd, "session.jsonl");
  await writeFile(sessionFile, "saved");
  let emit;
  const inner = {
    sessionId: id, sessionFile, isStreaming: false, isCompacting: false, isBashRunning: false,
    sessionManager: { getCwd: () => cwd }, agent: { state: {} },
    subscribe: (listener) => { emit = listener; return () => {}; }, dispose: () => {},
  };
  const wrapper = new AgentSessionWrapper(inner, { suppressCompletionNotifications: true });
  wrapper.start();
  t.after(() => wrapper.destroy());
  const nonce = randomUUID();
  const transition = { version: 1, originCwd: cwd, destinationPath: join(cwd, "destination"),
    branch: "feature", baseOid: "a".repeat(40), onCreate: "continue", featureTip: "a".repeat(40),
    createdAt: new Date().toISOString(), nonce };
  await assert.rejects(wrapper.scheduleGitWorkspaceTransition(transition), /No active persisted run/);
  emit({ type: "agent_start" });
  await wrapper.scheduleGitWorkspaceTransition(transition);
  emit({ type: "agent_end" });
  assert.equal((await readGitWorkspaceTransitionStatus(id)).status, "pending");
  emit({ type: "agent_settled" });
  for (let i = 0; i < 100 && (await readGitWorkspaceTransitionStatus(id)).status !== "manual-recovery"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await readGitWorkspaceTransitionStatus(id)).status, "manual-recovery");
  emit({ type: "agent_settled" });
  assert.equal((await readGitWorkspaceTransitionStatus(id)).status, "manual-recovery");
});

test("checkout gate rejects RPC commands while allowing get_state; release restores admission", async () => {
  const { acquireGitCheckoutGate } = await jiti.import("./git-checkout-gate.ts");
  const cwd = join(tmpdir(), "pi-web-checkout-gate-test");
  const inner = {
    sessionId: "gate-test", sessionManager: { getCwd: () => cwd }, agent: { state: {} },
    getContextUsage: () => null, getSteeringMessages: () => [], getFollowUpMessages: () => [],
    getAllTools: () => [], getActiveToolNames: () => [], dispose: () => {},
  };
  const session = new AgentSessionWrapper(inner);
  const release = acquireGitCheckoutGate([cwd]);
  try {
    const state = await session.send({ type: "get_state" });
    assert.equal(state.sessionId, "gate-test");
    await assert.rejects(session.send({ type: "get_tools" }), /Git checkout is busy/);
    await assert.rejects(session.send({ type: "prompt", message: "test" }), /Git checkout is busy/);
  } finally { release(); }
  try { assert.ok(await session.send({ type: "get_tools" })); }
  finally { session.destroy(); }
});

test("active sessions reject account changes before mutating their snapshot", async () => {
  const id = "busy-account-selection-test";
  globalThis.__piSessions ??= new Map();
  globalThis.__piSessions.set(id, { isRunning: () => true });
  try {
    await assert.rejects(setRpcSessionAccount(id, undefined, "anthropic", null), /Cannot switch accounts while the session is running/);
  } finally {
    globalThis.__piSessions.delete(id);
  }
});

test("get_tools preserves the SDK tool definition fields", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const getToolsSource = source.slice(
    source.indexOf('case "get_tools"'),
    source.indexOf('case "get_commands"'),
  );

  assert.match(getToolsSource, /\.getAllTools\(\)/);
  assert.match(getToolsSource, /\.\.\.t,/);
  assert.match(getToolsSource, /active: active\.has\(t\.name\)/);
});

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("built-in subagents persist their selected resource policy", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const subagentSource = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(subagentSource, /SessionManager\.create\(parent\.cwd, undefined, \{ parentSession: parent\.sessionFile \}\)/);
  assert.match(subagentSource, /appendCustomEntry\(SUBAGENT_META_TYPE/);
  assert.match(subagentSource, /appendCustomEntry\(SUBAGENT_RESULT_TYPE/);
  assert.match(subagentSource, /dependencies\.registerSession\(inner, \{/);
  assert.match(subagentSource, /noExtensions: !profile\.loadExtensions/);
  assert.match(subagentSource, /noSkills: !profile\.loadSkills/);
  assert.match(subagentSource, /excludeTools: \[\.\.\.SUBAGENT_CONTROL_TOOL_NAMES\]/);
  assert.match(subagentSource, /withSubagentExtensionTools\(profile\.tools, extensionToolNames\)/);
  assert.match(subagentSource, /resourceSnapshot:/);
  assert.match(startupSource, /readSubagentSessionResources\(/);
  assert.match(startupSource, /resourceLoaderOptions: subagentResources/);
  assert.match(startupSource, /appendSystemPrompt: subagentResources\.appendSystemPrompt/);
  assert.match(startupSource, /noExtensions: !subagentResources\.loadExtensions/);
  assert.match(startupSource, /noSkills: !subagentResources\.loadSkills/);
  assert.match(startupSource, /excludeTools: \[\.\.\.SUBAGENT_CONTROL_TOOL_NAMES\]/);
  assert.match(startupSource, /let toolsOption: string\[\] \| undefined = subagentResources\?\.tools/);
  assert.match(source, /createSubagentController\(/);
  assert.match(source, /suppressCompletionNotifications: true/);
  assert.match(source, /suppressCompletionNotifications: Boolean\(subagentResources\)/);
  assert.match(startupSource, /createSubagentExtension\([\s\S]*?SUBAGENT_CONTROLLER\.extensionRuntime,[\s\S]*?\(\) => listSubagentProfiles\(sessionCwd\),[\s\S]*?isBuiltInSubagentsEnabled/);
  assert.match(startupSource, /preferPiWebSubagentExtension\(base\)/);
});

test("running snapshots expose sessions with suppressed completion notifications", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const runningRouteSource = await readFile(new URL("../app/api/agent/running/route.ts", import.meta.url), "utf8");
  const sessionsRouteSource = await readFile(new URL("../app/api/sessions/route.ts", import.meta.url), "utf8");
  const snapshotSource = source.slice(
    source.indexOf("export function getCompletionNotificationSuppressedRpcSessionIds"),
    source.indexOf("// ----------------------------------------------------------------------------", source.indexOf("export function getCompletionNotificationSuppressedRpcSessionIds")),
  );

  assert.match(snapshotSource, /session\.isRunning\(\) && session\.hasSuppressedCompletionNotifications\(\)/);
  assert.match(runningRouteSource, /completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds\(\)/);
  assert.match(sessionsRouteSource, /completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds\(\)/);
});

test("RPC session startup resolves and passes the SDK-native enabled model scope", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const resolveIndex = startupSource.indexOf("resolveVisibleModels(");
  const createIndex = startupSource.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  assert.match(startupSource, /selectInitialModelScope\(/);
  assert.match(startupSource, /scopedModels: \[\.\.\.scope\.scopedModels\]/);
  assert.match(startupSource, /model: startupModel/);
  assert.match(startupSource, /thinkingLevel: initial\.thinkingLevel/);
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(
    startupSource,
    /const hasExistingMessages = branch\.some\(\(entry\) => entry\.type === "message" && entry\.message\.role !== "system"\)/,
  );
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.match(startupSource, /getLatestModelChange\(branch as unknown as SessionEntry\[\]\)/);
  assert.match(startupSource, /model: startupModel/);
  assert.doesNotMatch(startupSource, /const initial = sessionFile/);
  assert.doesNotMatch(startupSource, /sessionManager\.buildSessionContext\(\)/);
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const routeSource = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventRouteSource = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  const autoNameRouteSource = await readFile(new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.slice(0, startupSource.indexOf("const sessionCwd")).match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  for (const route of [routeSource, eventRouteSource, autoNameRouteSource]) {
    assert.doesNotMatch(route, /SessionManager\.open\(/);
  }
});

test("RPC wrapper avoids per-chunk idle maintenance", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startSource = source.slice(
    source.indexOf("  start(): void"),
    source.indexOf("  beginExtensionBinding"),
  );

  assert.match(startSource, /IDLE_RESET_EVENT_TYPES\.has\(event\.type\)/);
  assert.doesNotMatch(startSource, /subscribe\(\(event: AgentEvent\) => \{\s*this\.resetIdleTimer\(\)/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const idleSource = source.slice(
    source.indexOf("  private resetIdleTimer"),
    source.indexOf("  private persistBashOnlySession"),
  );
  const forkSource = source.slice(
    source.indexOf('case "fork"'),
    source.indexOf('case "clone"'),
  );
  const cloneSource = source.slice(
    source.indexOf('case "clone"'),
    source.indexOf('case "navigate_tree"'),
  );
  const replacementShutdownSource = source.slice(
    source.indexOf("  private async shutdownAfterSessionReplacement"),
    source.indexOf("  async send("),
  );

  assert.match(idleSource, /this\.shutdown\(\)/);
  assert.match(replacementShutdownSource, /await this\.shutdown\(\)/);
  assert.match(forkSource, /shutdownAfterSessionReplacement\("fork"\)/);
  assert.match(cloneSource, /shutdownAfterSessionReplacement\("clone"\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("clone copies the requested leaf into a child session", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const cloneSource = source.slice(
    source.indexOf('case "clone"'),
    source.indexOf('case "navigate_tree"'),
  );

  assert.match(cloneSource, /typeof command\.leafId === "string"/);
  assert.match(cloneSource, /branchHasAssistant/);
  assert.match(cloneSource, /createBranchedSession\(leafId\)/);
  assert.match(cloneSource, /cacheSessionPath\(newSessionId, clonedPath\)/);
  assert.match(cloneSource, /invalidateSessionListCache\(\)/);
  assert.match(cloneSource, /return \{ cancelled: false, newSessionId \}/);
});

test("fork_branch copies the selected assistant entry without replacing the source session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-quoted-branch-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "source prompt", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "selected response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const selectedEntryId = manager.getLeafId();
  appendSessionGitWorkflow(manager, worktreePolicy);
  const sourceLeafId = manager.getLeafId();
  const sourceFile = manager.getSessionFile();
  let forkedFile;
  let disposed = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: {},
    agent: { state: {} },
    dispose() { disposed = true; },
  });

  try {
    const result = await wrapper.send({ type: "fork_branch", entryId: selectedEntryId });
    const sessions = await SessionManager.list(root, sessionDir);
    const forkedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(forkedInfo);
    forkedFile = forkedInfo.path;
    const forked = SessionManager.open(forkedFile, sessionDir);
    assert.deepEqual(readSessionGitWorkflow(forked.getEntries()), worktreePolicy);
    assert.ok(forked.getEntry(selectedEntryId));
    assert.equal(manager.getLeafId(), sourceLeafId);
    assert.equal(disposed, false);
  } finally {
    wrapper.destroy();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("fork before the first message persists a reopenable message-free child session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-root-fork-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  const settingsEntryId = manager.appendModelChange("test", "test-model");
  const firstEntryId = manager.appendMessage({ role: "user", content: "source prompt", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "source response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  appendSessionAccounts(manager, { anthropic: "account-from-parent" });
  appendSessionGitWorkflow(manager, worktreePolicy);
  const sourceFile = manager.getSessionFile();
  let forkedFile;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    const result = await wrapper.send({ type: "fork", entryId: firstEntryId });
    const sessions = await SessionManager.list(root, sessionDir);
    const forkedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(forkedInfo);
    forkedFile = forkedInfo.path;

    const forked = SessionManager.open(forkedFile, sessionDir);
    assert.equal(forked.getHeader().parentSession, sourceFile);
    assert.equal(forked.getEntries()[0].id, settingsEntryId);
    assert.deepEqual(readSessionAccounts(forked.getEntries()), { anthropic: "account-from-parent" });
    assert.deepEqual(readSessionGitWorkflow(forked.getEntries()), worktreePolicy);
  } finally {
    wrapper.destroy();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("session replacement rejects active work and clone writes one reopenable child", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "clone fixture", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "fixture response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const cloneLeafId = manager.getLeafId();
  manager.appendSessionInfo("source-only metadata");
  appendSessionAccounts(manager, { anthropic: "account-from-parent" });
  appendSessionGitWorkflow(manager, null);

  const sourceFile = manager.getSessionFile();
  let clonedFile;
  let releaseModelRefresh;
  let signalModelRefresh;
  const modelRefreshStarted = new Promise((resolve) => { signalModelRefresh = resolve; });
  const modelRefreshHeld = new Promise((resolve) => { releaseModelRefresh = resolve; });
  let releaseShutdown;
  let signalShutdown;
  const shutdownStarted = new Promise((resolve) => { signalShutdown = resolve; });
  const shutdownHeld = new Promise((resolve) => { releaseShutdown = resolve; });
  let finishPrompt;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    prompt: (_message, options) => new Promise((resolve) => {
      finishPrompt = resolve;
      options.preflightResult?.(true);
    }),
    modelRuntime: {
      getModel: () => undefined,
      refresh: async () => {
        signalModelRefresh();
        await modelRefreshHeld;
      },
    },
    extensionRunner: {
      emit: async () => {
        signalShutdown();
        await shutdownHeld;
        throw new Error("fixture shutdown failure");
      },
    },
    agent: { state: {} },
    dispose() {},
  });

  try {
    const modelChange = wrapper.send({ type: "set_model", provider: "test", modelId: "missing" });
    await modelRefreshStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Cannot clone while another session command is running/,
    );
    releaseModelRefresh();
    await assert.rejects(modelChange, /Model not found/);

    await wrapper.send({ type: "prompt", message: "keep this run active" });
    await assert.rejects(
      wrapper.send({ type: "fork", entryId: manager.getLeafId() }),
      /Cannot fork while the session is running/,
    );
    assert.ok(finishPrompt);
    finishPrompt();
    await new Promise((resolve) => setImmediate(resolve));

    const firstClone = wrapper.send({ type: "clone", leafId: cloneLeafId });
    await shutdownStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Session is being copied to a new session/,
    );
    let shutdownErrorLog = "";
    const originalConsoleError = console.error;
    console.error = (...args) => { shutdownErrorLog = args.join(" "); };
    let result;
    try {
      releaseShutdown();
      result = await firstClone;
    } finally {
      console.error = originalConsoleError;
    }
    assert.match(shutdownErrorLog, /clone succeeded, but source session shutdown failed/);

    const sessions = await SessionManager.list(root, sessionDir);
    const clonedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(clonedInfo);
    clonedFile = clonedInfo.path;

    const cloned = SessionManager.open(clonedFile, sessionDir);
    assert.equal(cloned.getHeader().parentSession, sourceFile);
    assert.ok(cloned.getEntry(cloneLeafId));
    assert.deepEqual(readSessionAccounts(cloned.getEntries()), { anthropic: "account-from-parent" });
    assert.equal(readSessionGitWorkflow(cloned.getEntries()), null);
    assert.deepEqual(cloned.buildSessionContext().messages, manager.buildSessionContext().messages);
  } finally {
    wrapper.destroy();
    if (clonedFile) await unlink(clonedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("cancelled session replacement releases its lock", async () => {
  const manager = SessionManager.inMemory(tmpdir());
  let autoRetryEnabled = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    setAutoRetryEnabled: (enabled) => { autoRetryEnabled = enabled; },
    extensionRunner: {},
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "fork", entryId: "missing" }), { cancelled: true });
    await wrapper.send({ type: "set_auto_retry", enabled: true });
    assert.equal(autoRetryEnabled, true);
  } finally {
    wrapper.destroy();
  }
});

test("clone cancels an assistant-free branch without creating a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-empty-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "no assistant yet", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "clone" }), { cancelled: true });
    assert.equal((await SessionManager.list(root, sessionDir)).length, 0);
  } finally {
    wrapper.destroy();
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("read-only defaults filter incoming SDK Git extension names as well as newly added tools", () => {
  const readOnly = ["read", "grep", "find", "ls"];
  const gitTools = ["git_commit", "git_workflow", "git_workspace_start"];
  const session = { settingsManager: { getDefaultTools: () => readOnly },
    getAllTools: () => [...readOnly, ...gitTools, "custom_lookup"].map((name) => ({ name })) };
  assert.deepEqual(withExtensionTools(session, [...readOnly, ...gitTools]), [...readOnly, "custom_lookup"]);
  assert.deepEqual(withExtensionTools(session, []), []);
  assert.ok(withExtensionTools(session, ["read", "write"]).includes("git_commit"));
});

test("Git workflow startup restores snapshots, saves new defaults and explicit opt-outs", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
  const startup = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startup, /if \(!sessionFile\) \{\s*if \(options\.gitWorkflow === undefined\)/);
  assert.match(startup, /const defaults = await loadGitWorkflowSettings\(sessionCwd\)/);
  assert.match(startup, /snapshotManagedSessionGitWorkflow\(sessionManager, defaults\.resolved\.project\.values\)/);
  assert.match(startup, /options\.gitWorkflow === null \? null : validateGitWorkflowPolicy\(options\.gitWorkflow\)/);
  assert.match(startup, /createGitWorkflowExtension\(\(\) => readSessionGitWorkflow\(sessionManager\.getEntries\(\)/);
  assert.match(route, /Object\.hasOwn\(command, "gitWorkflow"\)/);
  assert.match(route, /gitWorkflow === null \? null : validateGitWorkflowPolicy\(gitWorkflow\)/);
  assert.match(route, /explicitGitWorkflow !== undefined \? \{ gitWorkflow: explicitGitWorkflow \}/);
  assert.match(route, /accounts, gitWorkflow, \.\.\.promptCommand/);
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});

test("prompt routes mark only preflight failures as rejected", async () => {
  const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  for (const source of [existingRoute, newRoute]) {
    assert.match(source, /let promptAccepted = false/);
    assert.match(source, /await .*\.send\(/);
    assert.match(source, /promptAccepted = .*\.type === "prompt"/);
    assert.match(source, /commandType === "prompt" && !promptAccepted/);
  }
});

test("exact prompts are sent through before_agent_start instead of the SDK prompt state", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const subagentSource = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const promptSource = source.slice(
    source.indexOf('case "prompt"'),
    source.indexOf('case "abort"'),
  );

  // Pi 0.86 replays agent.state.systemPrompt from the transcript: assigning it throws,
  // and the loop's request context no longer carries a systemPrompt field.
  assert.doesNotMatch(source, /state\.systemPrompt =/);
  assert.doesNotMatch(source, /prepareNextTurnWithContext/);
  assert.doesNotMatch(subagentSource, /state\.systemPrompt =/);
  assert.match(startupSource, /const exactSystemPromptExtension = createExactSystemPromptExtension\(\(\) => exactSystemPromptRef\.current\?\.\(\)\)/);
  assert.match(startupSource, /exactSystemPromptRef\.current = exactSystemPrompt;/);
  assert.match(startupSource, /\{ \.\.\.CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: \[exactSystemPromptExtension, createSessionReferenceExtension\(\)\] \}/);
  assert.match(startupSource, /usesExactSystemPrompt \? \[exactSystemPromptExtension\] : \[\]/);
  assert.match(subagentSource, /promptPlan\.exactSystemPrompt !== undefined[\s\S]*?\[createExactSystemPromptExtension\(\(\) => promptPlan\.exactSystemPrompt\)\] : \[\]/);
  assert.match(promptSource, /preflightResult: \(success\) => \{[\s\S]*?if \(success\) acceptPreflight\(\);/);
  assert.doesNotMatch(promptSource, /requestedToolNames/);
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /persistExplicitStartupPreferences\(/);
  assert.match(startupSource, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  assert.match(reloadSource, /await this\.inner\.reload\(\)/);
  assert.match(reloadSource, /await this\.inner\.reload\(\);[\s\S]*?invalidateModelsCache\(\)/);
});

test("normal sessions restore persisted tool selections before loading resources", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const registrationSource = source.slice(
    source.indexOf("function registerRpcWrapper"),
    source.indexOf("const SUBAGENT_CONTROLLER"),
  );

  assert.match(startupSource, /readSessionToolSelection\(sessionManager\.getEntries\(\)/);
  assert.match(startupSource, /const selectedToolNames = subagentResources\?\.tools \?\? persistedToolNames \?\? requestedToolNames/);
  assert.match(startupSource, /appendSessionToolSelection\(sessionManager, requestedToolNames\)/);
  assert.ok(startupSource.indexOf("const chatOnly") < startupSource.indexOf("createAgentSessionServices("));
  assert.match(startupSource, /chatOnly\s*\? \{ \.\.\.CHAT_ONLY_RESOURCE_LOADER_OPTIONS/);
  assert.match(startupSource, /const trustReloadOptions = subagentResources[\s\S]*?subagentLoadsResources[\s\S]*?projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(registrationSource, /if \(!wrapper\.isChatOnly\(\)\) wrapper\.beginExtensionBinding\(\)/);
});

test("crossing the Chat-only boundary persists and rebuilds the wrapper", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const switchSource = source.slice(
    source.indexOf("export async function setRpcSessionTools"),
    source.indexOf("export function getRunningRpcSessionIds"),
  );

  assert.match(switchSource, /!hasCurrentResourcePolicy\s*\|\| existing\.isChatOnly\(\) !== \(toolNames\.length === 0\)/);
  assert.match(switchSource, /appendSessionToolSelection\(existing\.inner\.sessionManager, toolNames\)/);
  assert.match(switchSource, /await existing\.shutdown\(\)/);
  assert.match(switchSource, /__recreate__\$\{randomUUID\(\)\}/);
  assert.match(switchSource, /sessionId: started\.realSessionId/);
});
