import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { settleFixtureRpc } from "./backend-ownership.fixture.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { AgentSessionWrapper, setRpcSessionAccount } = await jiti.import("./rpc-manager.ts");
const { appendSessionAccounts, readSessionAccounts } = await jiti.import("./session-accounts.ts");
const { appendSessionModelSpeed, readSessionModelSpeed } = await jiti.import("./session-model-speed.ts");

test("ordinary empty creation saves real SDK setup entries and subsequent writes without a model turn", async t => {
  const owner = backendCase(t);
  const root = await mkdtemp(join(tmpdir(), "pi-web-empty-session-"));
  owner.remove(() => rm(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const wrapper = new AgentSessionWrapper({ sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(),
    sessionManager: manager, agent: { state: {} }, subscribe: () => () => {}, extensionRunner: {}, dispose() {} });
  owner.join(() => settleFixtureRpc(wrapper));
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  {
    manager.appendCustomEntry("empty-setup", { version: 1 });
    await assert.rejects(readFile(manager.getSessionFile()), { code: "ENOENT" });
    wrapper.persistInitialSession();
    const entries = (await readFile(manager.getSessionFile(), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(entries[0].id, manager.getSessionId());
    assert.equal(entries[1].customType, "empty-setup");
    assert.equal(entries.some(entry => entry.type === "message"), false);
    wrapper.persistInitialSession(); // Idempotent; do not rewrite existing history.
    manager.appendCustomEntry("later-setup", { version: 2 });
    const reopened = SessionManager.open(manager.getSessionFile());
    assert.deepEqual(reopened.getEntries().map(entry => entry.customType), ["empty-setup", "later-setup"]);
  }
});

test("RPC reads, prompts and bash retain ordinary session safety", async () => {
  const cwd = join(tmpdir(), "pi-web-checkout-gate-test");
  const calls = [];
  const inner = {
    sessionId: "gate-test", sessionManager: { getCwd: () => cwd, getSessionFile: () => "", getEntries: () => [] }, agent: { state: {} },
    getContextUsage: () => null, getSteeringMessages: () => [], getFollowUpMessages: () => [],
    settingsManager: { getShellPath: () => undefined },
    getAllTools: () => [], getActiveToolNames: () => [], dispose: () => {}, abortBash() {},
    prompt: async (message, options) => { calls.push(message); options.preflightResult(); },
    executeBash: async (command) => { calls.push(command); return { output: "ok", exitCode: 0 }; },
  };
  const session = new AgentSessionWrapper(inner);

  try {
    assert.equal((await session.send({ type: "get_state" })).sessionId, "gate-test");
    assert.deepEqual(await session.send({ type: "get_tools" }), []);
    await session.send({ type: "prompt", message: "test" });
    await session.send({ type: "bash", command: "fixture command" });
    assert.deepEqual(calls, ["test", "fixture command"]);
    inner.isBashRunning = true;
    await assert.rejects(session.send({ type: "prompt", message: "unsafe" }), /shell command is running/);
  } finally { await session.shutdown(); }
});

test("direct subagent preflight tracks its own running session", () => {
  const cwd = join(tmpdir(), `rpc-subagent-checkout-${randomUUID()}`);
  const wrapper = new AgentSessionWrapper({ sessionId: "preflight", sessionManager: { getCwd: () => cwd },
    agent: { state: {} }, isStreaming: false, isCompacting: false, isBashRunning: false, dispose() {} });

  try {
    assert.equal(wrapper.isRunning(), false);
    const release = wrapper.beginCheckoutPromptAdmission();
    assert.equal(wrapper.isRunning(), true);
    release(); release();
    assert.equal(wrapper.isRunning(), false);
  } finally { wrapper.destroy(); }
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

test("live message IDs are emitted only after the SDK append and match by identity", async () => {
  let notify;
  let leaf;
  const events = [];
  const wrapper = new AgentSessionWrapper({
    sessionId: "live-entry-test",
    dispose: () => {},
    sessionManager: { getLeafEntry: () => leaf },
    subscribe: (listener) => { notify = listener; return () => {}; },
  });
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  try {
    const message = { role: "user", content: "same text", timestamp: 100 };
    const event = { type: "message_end", message };
    notify(event); // The real SDK notifies before its synchronous append.
    assert.equal(events.length, 0);
    leaf = { type: "message", id: "saved", message };
    await Promise.resolve();
    assert.deepEqual(events, [{ ...event, entryId: "saved" }]);
    for (const unrelated of [undefined, { type: "custom", id: "custom" },
      { type: "message", id: "duplicate-text", message: { ...message } }]) {
      notify(event);
      leaf = unrelated;
      await Promise.resolve();
      assert.equal(events.at(-1), event, "Never infer a target from a different leaf");
    }
    assert.equal(events.length, 4);
    notify(event);
    wrapper.destroy();
    await Promise.resolve();
    assert.equal(events.filter((item) => item.type === "message_end").length, 4);
  } finally {
    wrapper.destroy();
  }
});

test("per-message forks preserve the source during active work", async (t) => {
  for (const mode of ["idle", "streaming", "compacting", "bash", "prompt", "preflight", "subagent-preflight"]) {
    await t.test(mode, async t => {
      const owner = backendCase(t);
      const root = await mkdtemp(join(tmpdir(), "pi-web-live-fork-"));
      owner.remove(() => rm(root, { recursive: true, force: true }));
      const sessionDir = join(root, "sessions");
      const manager = SessionManager.create(root, sessionDir);
      const assistant = (text) => ({
        role: "assistant", content: [{ type: "text", text }], api: "test", provider: "test", model: "test",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      });
      const priorUser = manager.appendMessage({ role: "user", content: "prior prompt", timestamp: Date.now() });
      const priorAnswer = manager.appendMessage(assistant("prior answer"));
      const selectedUser = manager.appendMessage({ role: "user", content: "fork here", timestamp: Date.now() });
      const selectedAnswer = manager.appendMessage(assistant("quote this answer"));
      const currentUser = manager.appendMessage({ role: "user", content: "current run", timestamp: Date.now() });
      // Current session-wide preferences lie outside either copied path.
      appendSessionAccounts(manager, { anthropic: "current-account" });
      appendSessionModelSpeed(manager, "fast");
      const sourceFile = manager.getSessionFile();
      const sourceId = manager.getSessionId();
      const sourceLeaf = manager.getLeafId();
      const sourceEntries = manager.getEntries();
      const sourceBytes = await readFile(sourceFile, "utf8");
      let disposed = 0, aborted = 0, shutdowns = 0, unsubscribed = 0;
      let notify, acceptPrompt, finishPrompt, promptCommand, releaseAdmission, promptAdmitted = false;
      const promptEntered = deferred(), promptDone = deferred();
      const events = [];
      const inner = {
        sessionId: sourceId, sessionFile: sourceFile, sessionManager: manager,
        isStreaming: mode === "streaming", isCompacting: mode === "compacting", isBashRunning: mode === "bash",
        agent: { state: { streamingMessage: { role: "assistant", content: [{ type: "text", text: "partial response" }] } } },
        getSteeringMessages: () => ["queued steering"], getFollowUpMessages: () => ["queued follow-up"],
        prompt: (_message, options) => new Promise((resolve) => {
          finishPrompt = resolve;
          acceptPrompt = () => { options.preflightResult("started"); promptAdmitted = true; };
          if (mode !== "preflight") acceptPrompt();
          promptEntered.resolve();
        }),
        subscribe: (listener) => { notify = listener; return () => { unsubscribed++; }; },
        extensionRunner: { emit: async () => { shutdowns++; } },
        abortBash: () => { aborted++; }, dispose: () => { disposed++; },
      };
      const wrapper = new AgentSessionWrapper(inner);
      wrapper.onEvent((event) => { events.push(event); if (event.type === "prompt_done") promptDone.resolve(); });
      owner.release(() => acceptPrompt?.()); owner.release(() => finishPrompt?.()); owner.release(() => releaseAdmission?.());
      owner.join(async () => {
        await Promise.allSettled([promptCommand, ...(promptAdmitted ? [promptDone.promise] : [])]);
        inner.isBashRunning = false;
        await wrapper.shutdown();
      });
      wrapper.start();
      {
        if (mode === "prompt" || mode === "preflight") {
          promptCommand = owner.work(wrapper.send({ type: "prompt", message: "held prompt" }));
          if (mode === "prompt") await promptCommand;
          else await Promise.race([promptEntered.promise, promptCommand.then(() => { throw new Error("preflight acknowledged before its native gate"); })]);
          assert.ok(finishPrompt);
        } else if (mode === "subagent-preflight") {
          releaseAdmission = wrapper.beginCheckoutPromptAdmission();
        }
        const wasRunning = wrapper.isRunning();
        assert.equal(wasRunning, mode !== "idle");
        const childIds = new Set();
        for (const [type, entryId] of [["fork", selectedUser], ["fork_branch", selectedAnswer]]) {
          await assert.rejects(wrapper.send({ type, entryId: "missing" }), /Invalid entry ID for forking/);
          const result = await wrapper.send({ type, entryId });
          assert.equal(result.cancelled, false);
          assert.notEqual(result.newSessionId, sourceId);
          childIds.add(result.newSessionId);
          const info = (await SessionManager.list(root, sessionDir)).find((session) => session.id === result.newSessionId);
          assert.ok(info);
          const child = SessionManager.open(info.path, sessionDir);
          assert.equal(child.getHeader().parentSession, sourceFile);
          assert.ok(child.getEntry(priorUser));
          assert.ok(child.getEntry(priorAnswer));
          assert.equal(!!child.getEntry(selectedUser), type === "fork_branch");
          assert.equal(!!child.getEntry(selectedAnswer), type === "fork_branch");
          assert.equal(child.getEntry(currentUser), undefined);
          assert.deepEqual(readSessionAccounts(child.getEntries()), { anthropic: "current-account" });
          assert.equal(readSessionModelSpeed(child.getEntries()), "fast");
          assert.equal(wrapper.sessionId, sourceId);
          assert.equal(wrapper.sessionFile, sourceFile);
          assert.equal(manager.getLeafId(), sourceLeaf);
          assert.deepEqual(manager.getEntries(), sourceEntries);
          assert.equal(await readFile(sourceFile, "utf8"), sourceBytes);
          assert.equal(wrapper.isAlive(), true);
          assert.equal(wrapper.isRunning(), wasRunning);
          assert.deepEqual(inner.getSteeringMessages(), ["queued steering"]);
          assert.deepEqual(inner.getFollowUpMessages(), ["queued follow-up"]);
          assert.deepEqual([disposed, aborted, shutdowns, unsubscribed], [0, 0, 0, 0]);
        }
        assert.equal(childIds.size, 2, "Repeated copies remain children of the original, not of each other");
        const continuedAnswer = assistant("source continues");
        const continuedEntryId = manager.appendMessage(continuedAnswer);
        notify({ type: "message_end", message: continuedAnswer });
        assert.equal(SessionManager.open(sourceFile, sessionDir).getEntry(continuedEntryId).message.content[0].text, "source continues");
        for (const childId of childIds) {
          const info = (await SessionManager.list(root, sessionDir)).find((session) => session.id === childId);
          assert.equal(SessionManager.open(info.path, sessionDir).getEntry(continuedEntryId), undefined);
        }
        assert.equal(events.at(-1).message.content[0].text, "source continues");
        assert.equal(events.some((event) => event.type === "session_shutdown"), false);
      }
    });
  }
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
  appendSessionModelSpeed(manager, "fast");

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

    assert.ok(forked.getEntry(selectedEntryId));
    assert.equal(readSessionModelSpeed(forked.getEntries()), "fast");
    assert.equal(manager.getLeafId(), sourceLeafId);
    assert.equal(disposed, false);
  } finally {
    await wrapper.shutdown();
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
  appendSessionModelSpeed(manager, "fast");

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
    assert.equal(readSessionModelSpeed(forked.getEntries()), "fast");
    assert.deepEqual(readSessionAccounts(forked.getEntries()), { anthropic: "account-from-parent" });

  } finally {
    await wrapper.shutdown();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("clone replacement rejects active work and writes one reopenable child", async t => {
  const owner = backendCase(t);
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
  appendSessionModelSpeed(manager, "fast");


  const sourceFile = manager.getSessionFile();
  let clonedFile, firstClone, promptCommand;
  const promptDone = deferred(), disposed = deferred();
  owner.remove(() => rm(root, { recursive: true, force: true }));
  let releaseModelRefresh;
  let signalModelRefresh;
  const modelRefreshStarted = new Promise((resolve) => { signalModelRefresh = resolve; });
  const modelRefreshHeld = new Promise((resolve) => { releaseModelRefresh = resolve; });
  let releaseShutdown;
  let signalShutdown;
  const shutdownStarted = new Promise((resolve) => { signalShutdown = resolve; });
  const shutdownHeld = new Promise((resolve) => { releaseShutdown = resolve; });
  let finishPrompt, promptAdmitted = false;
  let availableModel;
  const wrapper = new AgentSessionWrapper({
    model: undefined,
    async setModel(model) { this.model = model; },
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    prompt: (_message, options) => new Promise((resolve) => {
      finishPrompt = resolve;
      options.preflightResult?.("started");
      promptAdmitted = true;
    }),
    modelRuntime: {
      getModel: () => availableModel,
      getError: () => undefined,
      refresh: async () => {
        signalModelRefresh();
        await modelRefreshHeld;
        return { aborted: false, errors: new Map() };
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
    dispose() { disposed.resolve(); },
  });
  wrapper.onEvent(event => { if (event.type === "prompt_done") promptDone.resolve(); });
  owner.release(() => releaseModelRefresh());
  owner.release(() => releaseShutdown());
  owner.release(() => finishPrompt?.());
  let rejectedModelChange;
  owner.join(async () => {
    await Promise.allSettled([rejectedModelChange, promptCommand, firstClone, ...(promptAdmitted ? [promptDone.promise] : [])]);
    // The deliberately failing extension still must reach actual public dispose.
    await assert.rejects(wrapper.shutdown(), /fixture shutdown failure/);
    await disposed.promise;
  });

  {
    const modelChange = wrapper.send({ type: "set_model", provider: "test", modelId: "missing" });
    rejectedModelChange = owner.work(assert.rejects(modelChange, /Model not found/));
    await modelRefreshStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Cannot clone while another session command is running/,
    );
    releaseModelRefresh();
    await rejectedModelChange;
    await assert.rejects(wrapper.send({ type: "prompt", message: "blocked until repair" }), /could not be applied/);
    availableModel = { provider: "test", id: "restored" };
    await wrapper.send({ type: "set_model", provider: "test", modelId: "restored" });

    promptCommand = owner.work(wrapper.send({ type: "prompt", message: "keep this run active" }));
    await promptCommand;
    await assert.rejects(
      wrapper.send({ type: "clone", leafId: cloneLeafId }),
      /Cannot clone while the session is running/,
    );
    assert.ok(finishPrompt);
    finishPrompt();
    await promptDone.promise;

    firstClone = owner.work(wrapper.send({ type: "clone", leafId: cloneLeafId }));
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
    assert.equal(readSessionModelSpeed(cloned.getEntries()), "fast");
    assert.deepEqual(readSessionAccounts(cloned.getEntries()), { anthropic: "account-from-parent" });

    assert.deepEqual(cloned.buildSessionContext().messages, manager.buildSessionContext().messages);
  }
});

test("cancelled fork leaves the source available for other commands", async () => {
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

test("clone cancels an assistant-free branch without creating another file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-empty-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "no assistant yet", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  const existingFiles = await readdir(sessionDir);
  assert.equal(existingFiles.length, 1); // Pi 0.99 persists the first user message.
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
    assert.equal((await SessionManager.list(root, sessionDir)).length, 1);
    assert.deepEqual(await readdir(sessionDir), existingFiles);
  } finally {
    await wrapper.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});


// These prohibit retired capability/API ownership, not event/order spellings.
test("generic RPC owns no retired Git transition or unsupported SDK prompt-state mutation", async () => {
  for (const file of ["./rpc-manager.ts", "./subagent-runtime.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /scheduledGitWorkspace|claimGitWorkspaceTransition|recordGitWorkspaceForkId|moveSessionFamily|createGitWorkspaceStartExtension|createGitCheckoutOperationGuard|beginGitWorkspacePlacement/);
    assert.doesNotMatch(source, /state\.systemPrompt =|prepareNextTurnWithContext/);
  }
});

import { rpcStartup } from "./rpc-startup.fixture.mjs";
import { deferred, backendCase, loadBackend, next } from "./backend-ownership.fixture.mjs";

test("startup awaits extension services and native model scope before SDK construction, preserving explicit preferences", async t => {
  const f = await rpcStartup(t, { holdServices: true });
  const pending = f.start("", { toolNames: ["read"], initialModel: { provider: "synthetic", modelId: "fixture" }, thinkingLevel: "low" });
  const services = await f.serviceEntered.promise;
  assert.equal(f.calls.some(([name]) => name === "construct"), false);
  assert.equal(services.cwd, f.cwd); assert.equal(services.agentDir, f.agentDir);
  assert.equal(globalThis.__piStartingSessionCwds.size, 1, "startup reserves its cwd before SDK services await");
  f.serviceGate.resolve(); const { session } = await pending; await session.waitUntilReady();
  const construction = f.calls.find(([name]) => name === "construct")[1];
  assert.ok(f.calls.findIndex(([name]) => name === "models") < f.calls.findIndex(([name]) => name === "construct"));
  assert.equal(construction.model, f.model); assert.equal(construction.thinkingLevel, "low");
  assert.deepEqual(construction.scopedModels, [{ model: f.model, thinkingLevel: "high" }]);
  assert.equal(construction.tools, undefined, "ordinary preset does not suppress extension definitions");
  assert.deepEqual(f.calls.filter(([name]) => name === "save-model" || name === "save-thinking" || name === "settings-flushed"), [
    ["save-model", "synthetic", "fixture"], ["save-thinking", "low"], ["settings-flushed"],
  ]);
  assert.equal(f.modelInvalidations.length, 1); assert.equal(globalThis.__piStartingSessionCwds.size, 0);
  const all = f.inners[0].getAllTools(); const projected = await session.send({ type: "get_tools" });
  assert.deepEqual(projected, all.map(tool => ({ ...tool, active: true })));
  assert.equal(projected[0].parameters, all[0].parameters, "SDK schema object survives projection");
  f.inners[0].setActiveToolsByName([]);
  assert.deepEqual((await session.send({ type: "get_tools" })).map(tool => tool.active), [false, false], "inactive SDK definitions remain inactive");
});

test("startup continuing matrix distinguishes no messages, system-only, saved model and conversation", async t => {
  for (const kind of ["empty", "system", "saved", "conversation"]) await t.test(kind, async t => {
    const f = await rpcStartup(t, { seed(manager) {
      if (kind === "system") manager.appendMessage({ role: "system", content: "setup", timestamp: 1 });
      if (kind === "conversation") manager.appendMessage({ role: "user", content: "already started", timestamp: 1 });
      if (kind === "saved") { manager.appendModelChange("synthetic", "fixture"); manager.appendThinkingLevelChange("medium"); }
    } });
    const { session } = await f.start("/fixture/saved.jsonl"); await session.waitUntilReady();
    const construction = f.calls.find(([name]) => name === "construct")[1];
    assert.equal(construction.model, kind === "conversation" ? undefined : f.model);
    assert.equal(construction.thinkingLevel, kind === "saved" ? "medium" : kind === "conversation" ? undefined : "high");
    assert.deepEqual(f.calls.filter(([name]) => name === "open"), [["open", "/fixture/saved.jsonl"]]);
    assert.equal(f.calls.find(([name]) => name === "services")[1].cwd, f.cwd, "saved manager cwd, never URL cwd");
    assert.equal(f.calls.some(([name]) => name === "project-accounts"), false, "reopen never adopts project account defaults");
    assert.equal(f.calls.some(([name]) => name.startsWith("save-")), false, "implicit restoration does not change defaults");
  });
});

test("persisted tools beat request, Chat-only is decided before services, and exact factory reads current context", async t => {
  for (const selected of [[], ["read"]]) await t.test(JSON.stringify(selected), async t => {
    const f = await rpcStartup(t, { seed(manager, { tools }) { tools.appendSessionToolSelection(manager, selected); } });
    const { session } = await f.start("/fixture/saved.jsonl", { toolNames: ["bash"] });
    await session.waitUntilReady(); const input = f.captures[0].input;
    assert.equal(session.isChatOnly(), selected.length === 0);
    assert.equal(f.tools.readSessionToolSelection(f.manager.getEntries())[0], selected[0]);
    if (!selected.length) {
      assert.equal(input.resourceLoaderOptions.noExtensions, true); assert.equal(input.resourceLoaderOptions.noSkills, true);
      assert.deepEqual(f.calls.find(([name]) => name === "construct")[1].tools, []);
      assert.equal(f.inners[0].bindings, undefined, "Chat-only does not bind extension UI");
      const exact = input.resourceLoaderOptions.extensionFactories.find(factory => factory.name === "pi-web-exact-system-prompt");
      assert.ok(exact); let before; exact.factory({ on(event, callback) { assert.equal(event, "before_agent_start"); before = callback; } });
      assert.deepEqual(before(), { systemPrompt: "Exact context" });
      f.inners[0].resourceLoader.getAgentsFiles = () => ({ agentsFiles: [{ path: "AGENTS.md", content: "Changed context" }] });
      assert.deepEqual(before(), { systemPrompt: "Changed context" });
    } else assert.deepEqual(f.inners[0].getActiveToolNames(), ["read", "external"]);
  });
});

test("cold child startup restores resource snapshot, exact prompt, reserved exclusions and suppressed notification", async t => {
  for (const loadExtensions of [false, true]) for (const loadSkills of [false, true]) await t.test(`${loadExtensions}/${loadSkills}`, async t => {
    const resourceSnapshot = { version: 1, tools: ["read"], appendSystemPrompt: ["profile context"], loadExtensions, loadSkills, exactSystemPrompt: "Exact child" };
    const f = await rpcStartup(t, { seed(manager) { manager.appendCustomEntry("pi-web:subagent", {
      version: 1, parentSessionId: "parent", parentSessionPath: "/fixture/parent.jsonl", resourceSnapshot,
    }); } });
    await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
    const { session } = await f.start("/fixture/child.jsonl"); await session.waitUntilReady();
    const input = f.captures[0].input, resources = input.resourceLoaderOptions;
    assert.equal(Boolean(input.resourceLoaderReloadOptions), loadExtensions || loadSkills);
    if (input.resourceLoaderReloadOptions) assert.equal(await input.resourceLoaderReloadOptions.resolveProjectTrust(), false);
    assert.equal(resources.noExtensions, !loadExtensions); assert.equal(resources.noSkills, !loadSkills);
    assert.deepEqual(resources.appendSystemPrompt, ["profile context"]);
    const construct = f.calls.find(([name]) => name === "construct")[1];
    assert.deepEqual(construct.tools, ["read"]); assert.deepEqual(construct.excludeTools, ["Agent", "get_subagent_result", "steer_subagent"]);
    assert.equal(session.hasSuppressedCompletionNotifications(), true);
    const exact = resources.extensionFactories.find(factory => factory.name === "pi-web-exact-system-prompt");
    let before; exact.factory({ on: (_event, fn) => { before = fn; } }); assert.deepEqual(before(), { systemPrompt: "Exact child" });
  });
});

test("wrapper settlement not agent_end owns notification; message deltas never reset idle maintenance", async t => {
  const f = await rpcStartup(t); const { session } = await f.start(); await session.waitUntilReady();
  const inner = f.inners[0]; const initialTimer = [...f.timers.keys()][0];
  for (let i = 0; i < 1000; i++) inner.notify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } });
  assert.equal([...f.timers.keys()][0], initialTimer);
  inner.notify({ type: "agent_start" }); inner.notify({ type: "agent_end" });
  assert.equal(f.calls.some(([name]) => name === "push"), false);
  assert.notEqual([...f.timers.keys()][0], initialTimer);
  inner.notify({ type: "agent_settled" });
  assert.deepEqual(f.calls.filter(([name]) => name === "push"), [["push", session.sessionId]]);
  inner.notify({ type: "agent_settled" }); assert.equal(f.calls.filter(([name]) => name === "push").length, 1);
});

for (const action of ["rpc", "extension"]) for (const failing of [false, true]) test(`reload ${action} refreshes trust and invalidates listing/models even on failure=${failing}`, async t => {
  const f = await rpcStartup(t, { reloadFailure: failing ? new Error("controlled reload failure") : undefined });
  await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const { session } = await f.start(); await session.waitUntilReady();
  // Real persisted trust, reread by the actual wrapper on each reload.
  const { setProjectTrust } = await jiti.import("./project-trust.ts");
  setProjectTrust(f.cwd, f.agentDir, "worktree", false);
  f.calls.length = 0; f.modelInvalidations.length = 0;
  const invoke = () => action === "rpc" ? session.send({ type: "reload" }) : f.inners[0].bindings.commandContextActions.reload();
  if (failing) await assert.rejects(invoke(), /controlled reload failure/); else await invoke();
  assert.deepEqual(f.calls.slice(0, 3), [["trusted", false], ["listing-invalidated"], ["reload"]]);
  assert.equal(f.calls.filter(([name]) => name === "listing-invalidated").length, 2);
  assert.equal(f.modelInvalidations.length, 1);
  setProjectTrust(f.cwd, f.agentDir, "worktree", true); f.calls.length = 0;
  if (failing) await assert.rejects(invoke(), /controlled reload failure/); else await invoke();
  assert.deepEqual(f.calls[0], ["trusted", true]);
});

test("idle teardown and Chat-only boundary replacement wait for graceful extension shutdown", async t => {
  const f = await rpcStartup(t, { holdShutdown: true }); const { session } = await f.start(); await session.waitUntilReady();
  const changed = f.owner.work(f.rpc.setRpcSessionTools(session.sessionId, undefined, []));
  await f.shutdownEntered.promise;
  assert.deepEqual(f.tools.readSessionToolSelection(f.manager.getEntries()), []);
  assert.equal(f.calls.filter(([name]) => name === "construct").length, 1);
  f.shutdownGate.resolve(); const result = await changed;
  assert.equal(result.recreated, true); assert.equal(result.sessionId, result.session.sessionId);
  assert.equal(result.session.isChatOnly(), true); assert.notEqual(result.session, session);
  assert.equal(f.calls.filter(([name]) => name === "construct").length, 2);
  assert.equal(f.calls.findIndex(([name]) => name === "dispose") < f.calls.findLastIndex(([name]) => name === "construct"), true);
  const timer = [...f.timers.values()][0]; assert.ok(timer); timer.callback();
  await result.session.shutdown(); assert.equal(result.session.isAlive(), false);
});

test("custom UI factory receives the actual fixed headless facade at the requested width", async t => {
  const f = await rpcStartup(t); const { session } = await f.start(); await session.waitUntilReady();
  const rendered = deferred(); let done, facade;
  f.owner.release(() => done?.("cleanup"));
  const custom = f.owner.work(f.inners[0].bindings.uiContext.custom((tui, _theme, _keys, finish) => {
    facade = tui; done = finish; return { render(width) { rendered.resolve(width); return ["fixture"]; } };
  }, { overlayOptions: { width: 88 } }));
  const width = await rendered.promise;
  assert.equal(width, 88); assert.equal(facade.terminal.columns, width); assert.equal(Object.isFrozen(facade.terminal), true);
  assert.equal(facade.terminal.kittyProtocolActive, false); done("done"); assert.equal(await custom, "done");
});


import { rpcRoutes } from "./rpc-routes.fixture.mjs";

test("new handler constructs explicit scope once, sends only literal prompt, and returns effective startup state", async t => {
  const f = await rpcRoutes(t); const result = f.post("new", {
    cwd: "/fixture", type: "prompt", message: "literal", provider: "requested", modelId: "requested-model", thinkingLevel: "low", toolNames: ["read"], modelSpeed: "fast",
  });
  const sent = await f.entered.promise;
  assert.deepEqual(sent, { type: "prompt", message: "literal" }); f.assertNoSetters();
  assert.deepEqual(f.calls.find(([name]) => name === "start"), ["start", "__new__request-id", "", "/fixture", {
    toolNames: ["read"], initialModel: { provider: "requested", modelId: "requested-model" }, thinkingLevel: "low", modelSpeed: "fast",
  }]);
  assert.equal(f.calls.findIndex(([name]) => name === "persist") < f.calls.findIndex(([name]) => name === "send"), true);
  f.release.resolve(); const response = await result;
  assert.equal(response.status, 200); assert.equal(response.body.sessionId, "actual-sdk-id");
  assert.deepEqual(response.body.model, { provider: "effective", modelId: "effective-model" });
  assert.equal(response.body.thinkingLevel, "medium"); assert.equal(response.body.modelSpeed, "fast");
  f.assertNoSetters();
});

for (const kind of ["new", "existing-cold", "existing-warm"]) for (const stage of ["success", "preflight", "after-acceptance"]) test(`prompt handler ${kind} distinguishes ${stage} without a false rejection receipt`, async t => {
  const f = await rpcRoutes(t, { warm: kind === "existing-warm", preflightFailure: stage === "preflight", serializationFailure: stage === "after-acceptance" });
  let complete = false;
  const work = f.post(kind === "new" ? "new" : "existing", { ...(kind === "new" ? { cwd: "/fixture" } : {}), type: "prompt", message: "literal" }).then(result => { complete = true; return result; });
  await f.entered.promise; assert.equal(complete, false, "acknowledgement waits for send/preflight, not just startup");
  f.release.resolve(); const result = await work;
  assert.equal(result.status, stage === "success" ? 200 : 500);
  if (stage === "preflight") { assert.equal(result.body.accepted, false); assert.equal(result.body.code, "prompt_rejected"); }
  else { assert.equal(Object.hasOwn(result.body, "accepted"), false); assert.equal(Object.hasOwn(result.body, "code"), false); }
  if (kind === "existing-warm") assert.equal(f.calls.some(([name]) => name === "path" || name === "start"), false);
  if (kind === "existing-cold") assert.deepEqual(f.calls.find(([name]) => name === "start"), ["start", "session", "/fixture/saved.jsonl", undefined, {}]);
  f.assertNoSetters();
});

test("actual suppressed-running getter reaches both running and catalogue handlers", async t => {
  const f = await rpcStartup(t);
  const entries = [
    ["normal", true, false], ["suppressed", true, true], ["idle-suppressed", false, true], ["idle-normal", false, false],
  ];
  globalThis.__piSessions = new Map(entries.map(([id, running, suppressed]) => [id, {
    isRunning: () => running, hasSuppressedCompletionNotifications: () => suppressed, shutdown: async () => {},
  }]));
  assert.deepEqual(f.rpc.getCompletionNotificationSuppressedRpcSessionIds(), ["suppressed"]);
  const capability = { ...f.rpc, getRpcSessionInfos: () => [], getRpcSessionAttention: () => [], activityReviewPersistenceFailed: () => false };
  const common = { "next/server": next, "@/lib/rpc-manager": capability };
  const running = await loadBackend(new URL("../app/api/agent/running/route.ts", import.meta.url), { ...common,
    "@/lib/session-reader": { getSessionListVersion: () => 1 },
    "@/lib/session-pause-runtime": { getSessionPauseSnapshot: () => [] },
    "@/lib/activity-review-server": { readActivityReview: () => ({ completedRuns: [], reviewedRuns: [], laterRuns: [], laterRequests: [] }) },
    "@/lib/subagent-runtime": { getQueuedSubagentSessionIds: () => [] },
  });
  const catalogue = await loadBackend(new URL("../app/api/sessions/route.ts", import.meta.url), { ...common,
    "@/lib/perf": { startServerPerf: () => undefined },
    "@/lib/json-response": { jsonResponse: (_request, body, init) => Response.json(body, init) },
    "@/lib/session-reader": { getSessionListVersion: () => 1, listAllSessions: async () => [], attachSessionProjectInfo: async rows => rows, mergeSessionLists: (await jiti.import("./session-reader.ts")).mergeSessionLists },
  });
  for (const work of [running.GET(), catalogue.GET(new Request("http://localhost/api/sessions"))]) {
    const response = await f.owner.response(work); const body = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(body.completionNotificationSuppressedSessionIds, ["suppressed"]);
  }
});

test("ordinary startup factory supplies current cwd profiles, live toggle and real legacy conflict composition", async t => {
  const f = await rpcStartup(t);
  await mkdir(join(f.agentDir, "agents"), { recursive: true });
  await mkdir(join(f.cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(f.agentDir, "agents", "settings.json"), JSON.stringify({ builtInEnabled: true }));
  await writeFile(join(f.cwd, ".pi", "agents", "scoped-unique.md"), "---\nname: scoped-unique\ndescription: Current saved cwd profile\ntools: read\n---\nScoped prompt");
  const { session } = await f.start("/fixture/saved.jsonl"); await session.waitUntilReady();
  const resources = f.captures[0].input.resourceLoaderOptions;
  const factory = resources.extensionFactories.find(factory => factory.name === "pi-web-subagents"); assert.ok(factory);
  const registered = []; factory.factory({ registerTool: tool => registered.push(tool) });
  assert.deepEqual(registered.map(tool => tool.name), ["Agent", "get_subagent_result", "steer_subagent"]);
  assert.match(registered[0].description, /scoped-unique/);
  await writeFile(join(f.agentDir, "agents", "settings.json"), JSON.stringify({ builtInEnabled: false }));
  const afterDisable = []; factory.factory({ registerTool: tool => afterDisable.push(tool) }); assert.deepEqual(afterDisable, []);
  const host = { path: "<inline:pi-web-subagents>", tools: new Map([["Agent", {}]]) };
  const legacy = { path: "/packages/pi-subagents/index.ts", tools: new Map([["Agent", {}]]), sourceInfo: { source: "npm:pi-subagents" } };
  const unrelated = { path: "/packages/unrelated.ts", tools: new Map([["Other", {}]]) };
  const selected = resources.extensionsOverride({ extensions: [host, legacy, unrelated], errors: [] });
  assert.deepEqual(selected.extensions.map(extension => extension.path), [host.path, unrelated.path]);
});

test("actual wrapper validates SDK preflight before acknowledgement and joins prompt completion", async t => {
  const entered = deferred(), accept = deferred(), finish = deferred(), done = deferred();
  const f = await rpcStartup(t, { prompt: async (_message, options) => {
    entered.resolve(); await accept.promise; options.preflightResult("started"); await finish.promise;
  } });
  f.owner.release(() => accept.resolve()); f.owner.release(() => finish.resolve());
  const { session } = await f.start(); await session.waitUntilReady();
  session.onEvent(event => { if (event.type === "prompt_done") done.resolve(); });
  f.owner.join(() => done.promise);
  const validated = []; let acknowledged = false;
  const sending = f.owner.work(session.send({ type: "prompt", message: "literal" }, { validate: disposition => validated.push(disposition) }).then(() => { acknowledged = true; }));
  await entered.promise; assert.deepEqual(validated, [undefined]); assert.equal(acknowledged, false);
  accept.resolve(); await sending;
  assert.deepEqual(validated, [undefined, "started"]); assert.equal(session.isRunning(), true);
  finish.resolve(); await done.promise; assert.equal(session.isRunning(), false);
});


test("same-policy tool changes keep the actual wrapper; default reset rebuilds without losing the SDK result identity", async t => {
  const f = await rpcStartup(t); const { session } = await f.start("", { toolNames: ["read"] }); await session.waitUntilReady();
  assert.deepEqual(f.tools.readSessionToolSelection(f.manager.getEntries()), ["read"]);
  const same = await f.owner.work(f.rpc.setRpcSessionTools(session.sessionId, undefined, ["grep"]));
  assert.equal(same.session, session); assert.equal(same.recreated, false);
  assert.deepEqual(f.tools.readSessionToolSelection(f.manager.getEntries()), ["grep"]);
  assert.deepEqual(f.inners[0].getActiveToolNames(), ["grep", "external"]);
  const defaults = await f.owner.work(f.rpc.setRpcSessionTools(session.sessionId, undefined, undefined));
  assert.equal(defaults.recreated, true); assert.notEqual(defaults.session, session);
  assert.equal(defaults.sessionId, defaults.session.sessionId);
  assert.equal(f.tools.readSessionToolSelection(f.manager.getEntries()), undefined);
});

test("transient account recreation uses explicit next snapshot and never reapplies ordinary project defaults", async t => {
  const f = await rpcStartup(t); const { session } = await f.start(); await session.waitUntilReady();
  const lookups = f.calls.filter(([name]) => name === "project-accounts").length;
  const id = await f.owner.work(f.rpc.setRpcSessionAccount(session.sessionId, undefined, "synthetic", null));
  const replacement = f.rpc.getRpcSession(id); await replacement.waitUntilReady();
  assert.equal(replacement.sessionId, id); assert.notEqual(replacement, session);
  assert.equal(f.calls.filter(([name]) => name === "project-accounts").length, lookups);
  assert.deepEqual(f.accounts.readSessionAccounts(replacement.inner.sessionManager.getEntries()), {});
  assert.equal(session.isAlive(), false);
});


for (const leafChoice of ["selected", "default", "nonstring"]) test(`clone actual SDK leaf choice ${leafChoice} preserves cache/list and graceful replacement`, async t => {
  const owner = backendCase(t), root = await mkdtemp(join(tmpdir(), "pi-web-clone-leaf-"));
  owner.remove(() => rm(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "first", timestamp: 1 });
  const selected = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], api: "test", provider: "test", model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
  const later = manager.appendMessage({ role: "user", content: "later", timestamp: 3 });
  const held = deferred(), shutdownEntered = deferred(); owner.release(() => held.resolve());
  const disposed = deferred();
  const wrapper = new AgentSessionWrapper({ sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
    isStreaming: false, isCompacting: false, isBashRunning: false, agent: { state: {} },
    extensionRunner: { emit: async () => { shutdownEntered.resolve(); await held.promise; } }, dispose: () => disposed.resolve(),
  });
  owner.join(async () => { await wrapper.shutdown(); await disposed.promise; });
  const reader = await jiti.import("./session-reader.ts");
  const ids = [manager.getSessionId()];
  owner.final(() => { for (const id of ids) reader.invalidateSessionPathCache(id); });
  const version = reader.getSessionListVersion();
  const command = { type: "clone", ...(leafChoice === "selected" ? { leafId: selected } : leafChoice === "nonstring" ? { leafId: 17 } : {}) };
  let acknowledged = false;
  const result = owner.work(wrapper.send(command).then(result => { acknowledged = true; return result; }));
  await shutdownEntered.promise; assert.equal(acknowledged, false); assert.equal(wrapper.isAlive(), true);
  held.resolve(); const cloned = await result; await disposed.promise;
  assert.equal(cloned.cancelled, false); ids.push(cloned.newSessionId);
  const path = await reader.resolveSessionPath(cloned.newSessionId); assert.equal(typeof path, "string");
  const child = SessionManager.open(path);
  assert.equal(child.getHeader().parentSession, manager.getSessionFile()); assert.ok(child.getEntry(selected));
  assert.equal(Boolean(child.getEntry(later)), leafChoice !== "selected");
  assert.equal(reader.getSessionListVersion() > version, true); assert.equal(wrapper.isAlive(), false);
});


for (const chatOnly of [false, true]) test(`fresh-child default host registration suppresses completion and preserves exact prompt; chatOnly=${chatOnly}`, async t => {
  const f = await rpcStartup(t), manager = SessionManager.inMemory(f.cwd);
  let bindings = 0;
  const inner = { sessionId: manager.getSessionId(), sessionManager: manager, agent: { state: {} },
    getContextUsage: () => null, getSteeringMessages: () => [], getFollowUpMessages: () => [],
    subscribe: () => () => {}, bindExtensions: async () => { bindings++; }, extensionRunner: {}, dispose() {},
  };
  f.rpc.registerSubagentSession(inner, { chatOnly, exactSystemPrompt: "Exact fresh child" });
  const wrapper = f.rpc.getRpcSession(inner.sessionId); assert.ok(wrapper); await wrapper.waitUntilReady();
  assert.equal(wrapper.hasSuppressedCompletionNotifications(), true); assert.equal(wrapper.isChatOnly(), chatOnly);
  assert.equal(bindings, chatOnly ? 0 : 1);
  assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, "Exact fresh child");
});


test("Chat-only startup installs actual context/reference/observer factories and invokes current prompt observer", async t => {
  const f = await rpcStartup(t), observed = [];
  const { session } = await f.start("", { toolNames: [], observePrompt: prompt => observed.push(prompt) });
  await session.waitUntilReady();
  const factories = f.captures[0].input.resourceLoaderOptions.extensionFactories;
  assert.deepEqual(factories.map(factory => factory.name), ["pi-web-exact-system-prompt", "pi-web-session-references", "pi-web-launch-prompt-observer"]);
  let before; factories[2].factory({ on: (event, callback) => { assert.equal(event, "before_agent_start"); before = callback; } });
  before({ messageType: "user", prompt: "literal current prompt" }); before({ messageType: "custom", prompt: "not user" });
  assert.deepEqual(observed, ["literal current prompt"]);
});

test("cold append-mode child startup installs guidance rather than an exact replacement prompt", async t => {
  const f = await rpcStartup(t, { seed(manager) { manager.appendCustomEntry("pi-web:subagent", {
    version: 1, parentSessionId: "parent", parentSessionPath: "/fixture/parent.jsonl",
    resourceSnapshot: { version: 1, tools: ["read"], appendSystemPrompt: ["append profile"], loadSkills: false, loadExtensions: false },
  }); } });
  const { session } = await f.start("/fixture/child.jsonl"); await session.waitUntilReady();
  const factories = f.captures[0].input.resourceLoaderOptions.extensionFactories;
  assert.equal(factories.some(factory => factory.name === "pi-web-exact-system-prompt"), false);
  const guidance = factories.find(factory => factory.name === "pi-web-local-file-link-guidance"); assert.ok(guidance);
  let before; guidance.factory({ on: (_event, callback) => { before = callback; } });
  const promptGuidelines = []; before({ systemPromptOptions: { promptGuidelines } });
  assert.equal(promptGuidelines.some(rule => rule.includes("absolute filesystem destinations")), true);
});


import { autoNameRoute } from "./auto-name-route.fixture.mjs";

for (const mode of ["warm", "cold", "dead", "legacy-warm"]) test(`auto-name actual handler preserves no-reopen startup ownership and selected bindings: ${mode}`, async t => {
  const f = await autoNameRoute(t, { mode }); const request = f.post();
  if (mode !== "legacy-warm") {
    await f.until(f.readyEntered, request, "selected wrapper readiness");
    assert.equal(f.calls.some(([name]) => name === "lease" || name === "title"), false, "title cannot run before selected wrapper readiness");
    f.readyGate.resolve();
  }
  await f.until(f.titleEntered, request, "title generation");
  assert.deepEqual(f.calls[0], ["path", "session"], "auto-name resolves the saved path before choosing its wrapper");
  assert.deepEqual(f.calls[1], ["get", "session"]);
  const starts = f.calls.filter(([name]) => name === "start");
  assert.deepEqual(starts, mode === "cold" || mode === "dead" ? [["start", "session", "/fixture/saved.jsonl", undefined]] : [], "warm wrapper is reused; cold/dead wrapper starts once from the exact saved path, not a route-side SDK reopen");
  assert.equal(f.calls.filter(([name]) => name === "ready").length, mode === "legacy-warm" ? 0 : 1);
  assert.equal(f.calls.some(([name]) => name === "name" || name === "invalidate"), false, "no publication while title work is held");
  f.titleGate.resolve(); const response = await request;
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body, { title: "Generated fixture title", usage: f.usage });
  assert.deepEqual(f.calls.slice(-3), [["release"], ["name", "Generated fixture title"], ["invalidate"]], "actual runtime lease releases before successful name/cache publication");
});

for (const outcome of ["title-error", "selected-closed", "missing-path"]) test(`auto-name actual handler joins error/no-write outcome: ${outcome}`, async t => {
  const f = await autoNameRoute(t, { missing: outcome === "missing-path", titleFailure: outcome === "title-error" });
  const request = f.post();
  if (outcome === "missing-path") {
    const response = await request;
    assert.equal(response.status, 404); assert.deepEqual(response.body, { error: "Session not found" });
    assert.deepEqual(f.calls, [["path", "session"]]);
  } else {
    f.readyGate.resolve(); await f.until(f.titleEntered, request, "error title generation");
    if (outcome === "selected-closed") f.closeSelected();
    f.titleGate.resolve(); const response = await request;
    assert.equal(response.status, outcome === "title-error" ? 500 : 409, JSON.stringify(response.body));
    if (outcome === "title-error") assert.deepEqual(response.body, { error: "controlled title-provider failure" });
    else assert.match(response.body.error, /session was closed while its title was being generated/);
    assert.deepEqual(f.calls.filter(([name]) => name === "lease" || name === "release"), [["lease"], ["release"]]);
    assert.equal(f.calls.some(([name]) => name === "name" || name === "invalidate"), false, "error/closed selection cannot publish a title or successful cache invalidation");
  }
});
