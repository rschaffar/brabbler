import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { createSubagentController, cancelQueuedSubagentForPause } = await jiti.import("./subagent-runtime.ts");
const { installSessionPauseBoundary } = await jiti.import("./session-pause-boundary.ts");
const { readSubagentRun, readSubagentSessionResources } = await jiti.import("./subagents.ts");
const { subagentFinalText } = await jiti.import("./subagent-extension.ts");
const { appendSessionAccounts, readSessionAccounts } = await jiti.import("./session-accounts.ts");
const { appendSessionModelSpeed, readSessionModelSpeed } = await jiti.import("./session-model-speed.ts");
const answer = text => fauxAssistantMessage([fauxText(text)]);
const readFact = (path, text) => fauxAssistantMessage([...(text ? [fauxText(text)] : []), fauxToolCall("read", { path })], { stopReason: "toolUse" });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const readBack = run => {
  const manager = SessionManager.open(run.sessionPath);
  assert.equal(manager.getSessionId(), run.sessionId);
  return readSubagentRun(manager.getEntries(), run.sessionId, run.sessionPath);
};

async function withRuntime(check, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-native-"));
  const agentDir = join(dir, "agent"), cwd = join(dir, "project");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const sessions = new Map(), allSessions = new Set();
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await mkdir(join(agentDir, "agents"), { recursive: true });
    await mkdir(cwd);
    await writeFile(join(agentDir, "agents", "settings.json"), JSON.stringify({ builtInEnabled: true, maxConcurrent: 1 }));
    const profile = async (name, fields = []) => writeFile(join(agentDir, "agents", `${name}.md`), [
      "---", "description: Native lifecycle fixture", ...(fields.some(field => field.startsWith("tools:")) ? [] : ["tools: read"]), "load_skills: false", ...(fields.some(field => field.startsWith("load_extensions:")) ? [] : ["load_extensions: false"]), ...fields, "---", "Complete the task.",
    ].join("\n"));
    await profile("fixture", ["max_turns: 1"]);
    await profile("unlimited");
    await profile("profile-level", ["model: faux/faux-model:high", "thinking: low"]);
    const fact = join(cwd, "fact.txt");
    await writeFile(fact, "Fixture value: 42\n");
    if (options.repo) {
      const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
      git("init", "-qb", "main");
      git("add", "fact.txt");
      git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "initial");
    }
    const faux = fauxProvider({ models: [
      { id: "faux-model", reasoning: true, contextWindow: 200_000 },
      { id: "small", reasoning: true, contextWindow: 8000 },
      { id: "literal:high", reasoning: true },
    ] });
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager: SettingsManager.inMemory(),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true } });
    const { session: parentInner } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.create(cwd, join(agentDir, "parent-sessions")), model: faux.getModel("faux-model") });
    parentInner.sessionManager.appendMessage({ role: "user", content: "Synthetic parent context", timestamp: Date.now() });
    appendSessionAccounts(parentInner.sessionManager, {});
    appendSessionModelSpeed(parentInner.sessionManager, "fast");
    let configured = 0;
    const registerSession = inner => {
      allSessions.add(inner);
      if (inner !== parentInner) options.configureChild?.(inner, configured++);
      const wrapper = { inner, cwd: inner.sessionManager.getCwd(), sessionFile: inner.sessionFile,
        isAlive: () => true, isRunning: () => inner.isStreaming || inner.isCompacting,
        waitUntilReady: async () => {}, beginCheckoutPromptAdmission: () => () => {} };
      options.configureWrapper?.(wrapper);
      sessions.set(inner.sessionId, wrapper);
      return wrapper;
    };
    registerSession(parentInner);
    const controller = createSubagentController({ getSession: id => sessions.get(id), registerSession,
      resolveSessionPath: async id => paths.get(id) ?? sessions.get(id)?.sessionFile ?? null,
      reopenSession: async (_id, file) => {
        const manager = SessionManager.open(file);
        const resources = readSubagentSessionResources(manager.getEntries());
        assert.ok(resources);
        const { session: inner } = await createAgentSessionFromServices({ services, sessionManager: manager,
          model: faux.getModel("faux-model"), tools: resources.tools, excludeTools: ["Agent", "get_subagent_result", "steer_subagent"] });
        return registerSession(inner);
      }, invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true });
    const paths = new Map();
    const request = { parentContext: { sessionManager: parentInner.sessionManager }, parentToolCallId: "fixture-tool-call", profile: "fixture", task: "Report the result", description: "Native child" };
    await check({ runtime: controller.extensionRuntime, controller, request, faux, sessions, paths, cwd, agentDir, dir, fact, modelRuntime, parentInner, profile });
  } finally {
    for (const inner of allSessions) { await inner.abort(); inner.dispose(); }
    globalThis.__piSubagentRuns?.clear();
    globalThis.__piSubagentQueue = undefined;
    globalThis.__piSubagentNotifications?.clear();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(dir, { recursive: true, force: true });
  }
}

const resumeRequest = (request, run) => ({ parentContext: request.parentContext, parentToolCallId: "resume-tool-call", sessionId: run.sessionId, task: "Continue explicitly", description: "Resumed child" });

test("model Bash inherits the public SSH socket but not host secrets on fresh children and live resume", async t => {
  for (const loadExtensions of [false, true]) await t.test(`load_extensions: ${loadExtensions}`, async () => {
    await withRuntime(async ({ runtime, request, faux, sessions, profile, dir }) => {
      await profile("bash-env", ["tools: bash", "disallowed_tools: ext:*", `load_extensions: ${loadExtensions}`]);
      const environment = {
        SSH_AUTH_SOCK: join(dir, "synthetic-public-agent.sock"),
        PI_WEB_PASSWORD: "synthetic-subagent-password-not-a-credential",
        // Presence skips legacy browser-agent lookup; no socket/runtime is created.
        PI_DESK_SSH_RUNTIME: join(dir, "synthetic-managed-runtime"),
      };
      const previous = Object.fromEntries(Object.keys(environment).map(name => [name, process.env[name]]));
      Object.assign(process.env, environment);
      try {
        const command = `printf 'sock=%s\\npassword=%s\\nruntime=%s\\n' "$SSH_AUTH_SOCK" "\${PI_WEB_PASSWORD+x}" "\${PI_DESK_SSH_RUNTIME+x}"`;
        const expected = `sock=${environment.SSH_AUTH_SOCK}\npassword=\nruntime=`;
        let observed = 0;
        const probe = () => fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" });
        const verify = context => {
          const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "bash");
          assert.ok(result, "the model must receive a native Bash result");
          assert.notEqual(result.isError, true);
          assert.equal(result.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim(), expected);
          observed++;
          return answer("environment verified");
        };
        // Two independent fresh children and a second model-issued Bash in each
        // retained session must all see the same inherited public path.
        for (let childIndex = 0; childIndex < 2; childIndex++) {
          faux.setResponses([probe(), verify]);
          const first = await (await runtime.start({ ...request, profile: "bash-env" })).completion;
          assert.equal(first.status, "completed");
          const child = sessions.get(first.sessionId).inner;
          assert.deepEqual(child.getActiveToolNames(), ["bash"]);
          assert.equal(child.getAllTools().find(tool => tool.name === "bash")?.sourceInfo?.path, "<inline:pi-web-project-command-environment>");
          const resources = readSubagentSessionResources(SessionManager.open(first.sessionPath).getEntries());
          assert.deepEqual(resources.tools, ["bash"]);
          assert.equal(resources.loadExtensions, loadExtensions);
          faux.setResponses([probe(), verify]);
          const resumed = await (await runtime.resume(resumeRequest(request, first))).completion;
          assert.equal(resumed.status, "completed");
          assert.equal(resumed.sessionId, first.sessionId);
          assert.equal(sessions.get(first.sessionId).inner, child, "this is live resume, not production cold reopen");
          assert.deepEqual(child.getActiveToolNames(), ["bash"]);
        }
        assert.equal(observed, 4, "every model turn must inspect the actual Bash output");
      } finally {
        for (const [name, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    });
  });
});

test("installing host Bash never widens a subagent's explicit read-only profile", async t => {
  for (const loadExtensions of [false, true]) await t.test(`load_extensions: ${loadExtensions}`, async () => {
    await withRuntime(async ({ runtime, request, faux, sessions, profile }) => {
      // ext:* must not turn the replacement of a forbidden built-in into a grant.
      await profile("read-only", ["tools: read", `load_extensions: ${loadExtensions}`]);
      faux.setResponses([answer("read-only profile retained")]);
      const result = await (await runtime.start({ ...request, profile: "read-only" })).completion;
      assert.equal(result.status, "completed");
      const child = sessions.get(result.sessionId).inner;
      assert.ok(child.getActiveToolNames().includes("read"));
      assert.equal(child.resourceLoader.getExtensions().extensions.some(extension => extension.path === "<inline:pi-web-project-command-environment>"), true);
      assert.equal(child.getActiveToolNames().includes("bash"), false);
      const resources = readSubagentSessionResources(SessionManager.open(result.sessionPath).getEntries());
      assert.equal(resources.tools.includes("bash"), false);
      assert.equal(resources.loadExtensions, loadExtensions);
    });
  });
});

test("a chat-only subagent keeps its exact profile prompt and installs no host Bash", async () => {
  await withRuntime(async ({ runtime, request, faux, sessions, profile }) => {
    await profile("chat-only", ["tools: none"]);
    faux.setResponses([answer("chat-only profile retained")]);
    const result = await (await runtime.start({ ...request, profile: "chat-only" })).completion;
    assert.equal(result.status, "completed");
    const child = sessions.get(result.sessionId).inner;
    assert.deepEqual(child.getActiveToolNames(), []);
    assert.equal(child.resourceLoader.getExtensions().extensions.some(extension => extension.path === "<inline:pi-web-project-command-environment>"), false);
    const resources = readSubagentSessionResources(SessionManager.open(result.sessionPath).getEntries());
    assert.deepEqual(resources.tools, []);
    assert.equal(resources.exactSystemPrompt, "Complete the task.");
  });
});

test("cooperative child pause retains worktree and partial output and never wakes a paused parent", async () => {
  const entered = deferred(), release = deferred(), paused = new Set(), settled = new Set();
  await withRuntime(async ({ runtime, request, faux, sessions, fact, parentInner }) => {
    faux.setResponses([readFact(fact, "Partial finding"), answer("must not run")]);
    const execution = await runtime.start({ ...request, profile: "unlimited", isolation: "worktree", runInBackground: true });
    await entered.promise;
    paused.add(execution.run.sessionId);
    release.resolve();
    const result = await execution.completion;
    assert.equal(result.status, "paused");
    assert.equal(readBack(result).status, "paused");
    assert.match(result.result, /Partial finding/);
    assert.equal(existsSync(result.worktreePath), true);
    assert.equal(result.worktreeExists, true);
    assert.equal(settled.has(result.sessionId), true);
    assert.match(subagentFinalText(result), /paused by the user, not completed/);
    assert.match(subagentFinalText(result), /Partial finding/);
    paused.add(parentInner.sessionId);
    const calls = faux.state.callCount;
    await runtime.notifyParent(result);
    assert.equal(faux.state.callCount, calls);
    assert.ok(parentInner.sessionManager.getEntries().some(entry => entry.type === "custom_message" && entry.customType === "pi-web:subagent-notification"));
    assert.equal(sessions.get(result.sessionId).isRunning(), false);
  }, { repo: true,
    configureWrapper(wrapper) {
      wrapper.isPauseRequested = () => paused.has(wrapper.inner.sessionId);
      wrapper.requestPause = () => paused.add(wrapper.inner.sessionId);
      wrapper.finishPause = () => settled.add(wrapper.inner.sessionId);
      installSessionPauseBoundary(wrapper.inner, wrapper.isPauseRequested, error => { throw error; });
    },
    configureChild(inner) { inner.agent.subscribe(async event => { if (event.type === "tool_execution_start") { entered.resolve(); await release.promise; } }); },
  });
});

test("failed paused-child persistence never restores authority to wake an idle parent", async () => {
  const paused = new Set(); let childId;
  await withRuntime(async ({ runtime, request, faux, parentInner }) => {
    faux.setResponses([() => { paused.add(childId); return answer("Partial evidence"); }, answer("must not wake parent")]);
    const result = await (await runtime.start({ ...request, runInBackground: true })).completion;
    assert.equal(result.status, "failed"); assert.match(result.error, /Could not persist subagent result/);
    const calls = faux.state.callCount; await runtime.notifyParent(result);
    assert.equal(faux.state.callCount, calls);
    assert.ok(parentInner.sessionManager.getEntries().some(entry => entry.type === "custom_message" && entry.customType === "pi-web:subagent-notification"));
  }, { configureChild(inner) {
    childId = inner.sessionId;
    const append = inner.sessionManager.appendCustomEntry.bind(inner.sessionManager);
    inner.sessionManager.appendCustomEntry = (type, data) => { if (type === "pi-web:subagent-result") throw new Error("Synthetic result write failure"); return append(type, data); };
  }, configureWrapper(wrapper) { wrapper.isPauseRequested = () => paused.has(wrapper.inner.sessionId); } });
});

test("queued child pause records incomplete work without dispatching its task", async () => {
  const entered = deferred(), release = deferred(), paused = new Set();
  await withRuntime(async ({ runtime, request, faux }) => {
    faux.setResponses([answer("first done")]);
    const first = await runtime.start(request); await entered.promise;
    await cancelQueuedSubagentForPause(first.run.sessionId); // stale queue snapshot must not Stop a running child
    try {
      const second = await runtime.start(request); paused.add(second.run.sessionId);
      await cancelQueuedSubagentForPause(second.run.sessionId);
      const result = await second.completion;
      assert.equal(result.status, "paused"); assert.equal(readBack(result).status, "paused");
      assert.equal(SessionManager.open(result.sessionPath).getEntries().some(entry => entry.type === "message" && entry.message.role === "user"), false);
    } finally { release.resolve(); assert.equal((await first.completion).status, "completed"); }
  }, { configureWrapper(wrapper) { wrapper.isPauseRequested = () => paused.has(wrapper.inner.sessionId); },
    configureChild(inner, index) { if (index === 0) { const prompt = inner.prompt.bind(inner); inner.prompt = async (...args) => { entered.resolve(); await release.promise; return prompt(...args); }; } },
  });
});

test("a child created during parent Pause inherits it even while its queue is full", async () => {
  const entered = deferred(), release = deferred(), paused = new Set(); let parentId, firstId;
  await withRuntime(async ({ runtime, request, faux, parentInner }) => {
    parentId = parentInner.sessionId; faux.setResponses([answer("First partial")]);
    const first = await runtime.start(request); firstId = first.run.sessionId; await entered.promise;
    try {
      const second = await runtime.start({ ...request, task: "Created during Pause" });
      assert.equal(second.run.status, "paused"); assert.equal((await second.completion).status, "paused");
      assert.equal(faux.state.callCount, 0);
    } finally { release.resolve(); await first.completion; }
    assert.equal(faux.state.callCount, 1);
  }, {
    configureWrapper: wrapper => { wrapper.isPauseRequested = () => paused.has(wrapper.inner.sessionId); wrapper.requestPause = () => paused.add(wrapper.inner.sessionId); wrapper.finishPause = () => {}; },
    configureChild: (inner, index) => {
      if (index === 0) { const prompt = inner.prompt.bind(inner); inner.prompt = async (...args) => { entered.resolve(); await release.promise; return prompt(...args); }; }
      else { paused.add(parentId); paused.add(firstId); }
    },
  });
});

test("queued cancellation persists a never-prompted child and outlives its wrapper", async () => {
  const entered = deferred(), release = deferred();
  await withRuntime(async ({ runtime, controller, request, faux, sessions, paths }) => {
    faux.setResponses([answer("first done")]);
    const first = await runtime.start(request);
    await entered.promise;
    try {
      const second = await runtime.start(request);
      assert.equal(second.run.status, "queued");
      assert.ok(existsSync(second.run.sessionPath));
      await controller.abort(second.run.sessionId);
      const result = await second.completion;
      assert.equal(result.status, "aborted");
      assert.equal(readBack(result).runId, result.runId);
      assert.equal(SessionManager.open(result.sessionPath).getEntries().some(entry => entry.type === "message" && entry.message.role === "user"), false);
      paths.set(result.sessionId, result.sessionPath);
      const inner = sessions.get(result.sessionId).inner;
      inner.dispose(); sessions.delete(result.sessionId);
      assert.equal((await runtime.get(result.sessionId)).status, "aborted");
      await unlink(result.sessionPath);
      assert.equal(await runtime.get(result.sessionId), null);
      await assert.rejects(runtime.resume(resumeRequest(request, result)), /Subagent not found/);
    } finally { release.resolve(); await first.completion; }
  }, { configureChild(inner, index) { if (index === 0) {
    const prompt = inner.prompt.bind(inner);
    inner.prompt = async (...args) => { entered.resolve(); await release.promise; return prompt(...args); };
  } } });
});

test("orphaned queued/running records become interrupted without changing durable history", async () => {
  await withRuntime(async ({ runtime, request, faux, sessions, paths }) => {
    faux.setResponses([answer("done")]);
    const result = await (await runtime.start(request)).completion;
    const child = sessions.get(result.sessionId).inner;
    for (const status of ["running", "queued"]) {
      child.sessionManager.appendCustomEntry("pi-web:subagent-status", { version: 1, status, runId: result.runId });
      assert.equal((await runtime.get(result.sessionId)).status, "interrupted");
    }
    paths.set(result.sessionId, result.sessionPath);
    child.dispose(); sessions.delete(result.sessionId);
    assert.equal((await runtime.get(result.sessionId)).status, "interrupted");
    assert.equal(readBack(result).status, "queued", "lookup must not fabricate a terminal disk entry");
  });
});

test("context budget refuses known small children before isolation and rechecks late model discovery", async () => {
  await withRuntime(async ({ runtime, request, cwd, modelRuntime, faux, profile }) => {
    await writeFile(join(cwd, "large.txt"), "x".repeat(3201));
    await assert.rejects(runtime.start({ ...request, model: "faux/small", inputFiles: ["large.txt"], isolation: "worktree" }), /3200-byte.*faux\/small/);
    assert.equal(existsSync(`${cwd}-worktrees`), false);
    // The parent's catalog has not seen this provider. Child services discover it offline.
    await profile("late", ["load_extensions: true", "model: late/tiny"]);
    await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
    await writeFile(join(cwd, ".pi", "extensions", "late.js"), `export default pi => pi.registerProvider("late", { baseUrl: "http://127.0.0.1:1", apiKey: "synthetic-unused", api: "openai-completions", models: [{ id: "tiny", name: "Tiny", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });`);
    const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
    new ProjectTrustStore(process.env.PI_CODING_AGENT_DIR).set(cwd, true);
    assert.equal(modelRuntime.getModel("late", "tiny"), undefined);
    await assert.rejects(runtime.start({ ...request, profile: "late", inputFiles: ["large.txt"] }), /3200-byte.*late\/tiny/);
    faux.setResponses([answer("within limit")]);
    await writeFile(join(cwd, "large.txt"), "x".repeat(3200));
    const result = await (await runtime.start({ ...request, model: "faux/small", inputFiles: ["large.txt"] })).completion;
    assert.equal(result.status, "completed");
  }, { repo: true });
});

test("model suffix precedence preserves literal IDs, explicit overrides, accounts, speed and tools", async () => {
  await withRuntime(async ({ runtime, request, faux, sessions }) => {
    for (const [overrides, expectedModel, thinking] of [
      [{ model: "faux/faux-model:high" }, "faux-model", "high"],
      [{ profile: "profile-level" }, "faux-model", "low"],
      [{ profile: "profile-level", model: "faux/faux-model:max", thinking: "minimal" }, "faux-model", "minimal"],
      [{ model: "faux/literal:high", thinking: "low" }, "literal:high", "low"],
    ]) {
      faux.setResponses([answer("selected")]);
      const result = await (await runtime.start({ ...request, ...overrides })).completion;
      assert.equal(result.status, "completed");
      const child = sessions.get(result.sessionId).inner;
      assert.equal(child.model.id, expectedModel);
      assert.equal(child.thinkingLevel, thinking);
      assert.deepEqual(readSessionAccounts(child.sessionManager.getEntries()), {});
      assert.equal(readSessionModelSpeed(child.sessionManager.getEntries()), "fast");
      assert.deepEqual(child.getActiveToolNames(), ["read"]);
      assert.ok(!child.getAllTools().some(tool => ["Agent", "get_subagent_result", "steer_subagent"].includes(tool.name)));
    }
    await assert.rejects(runtime.start({ ...request, model: "faux/faux-model:typo" }), /not found/);
  });
});

test("isolated results retain cleanup observations on disk and missing folders refuse live/cold resume", async () => {
  await withRuntime(async ({ runtime, request, faux, sessions, paths, cwd }) => {
    faux.setResponses([answer("clean")]);
    const clean = await (await runtime.start({ ...request, isolation: "worktree" })).completion;
    assert.equal(clean.worktreeExists, false);
    assert.equal(subagentFinalText(readBack(clean)), subagentFinalText(clean));
    assert.match(subagentFinalText(clean), /no longer present.*branch pi-web-agent-/s);
    for (const cold of [false, true]) {
      if (cold) { paths.set(clean.sessionId, clean.sessionPath); sessions.get(clean.sessionId).inner.dispose(); sessions.delete(clean.sessionId); }
      await assert.rejects(runtime.resume(resumeRequest(request, clean)), /Directory does not exist/);
      assert.equal(existsSync(clean.worktreePath), false);
    }
    faux.setResponses([async () => { const child = [...sessions.values()].findLast(value => value.cwd !== cwd); await writeFile(join(child.cwd, "untracked.txt"), "keep"); return answer("dirty"); }]);
    const dirty = await (await runtime.start({ ...request, isolation: "worktree" })).completion;
    assert.equal(dirty.worktreeExists, true);
    assert.match(subagentFinalText(dirty), /uncommitted or untracked/);
    assert.doesNotMatch(subagentFinalText(dirty), /--force/);
    assert.equal(await readFile(join(dirty.worktreePath, "untracked.txt"), "utf8"), "keep");
    faux.setResponses([answer("resumed")]);
    const resumed = await (await runtime.resume(resumeRequest(request, dirty))).completion;
    assert.equal(resumed.sessionId, dirty.sessionId);
    assert.notEqual(resumed.runId, dirty.runId);
    assert.equal(resumed.worktreeCleanupError, undefined);
    assert.equal(resumed.worktreeExists, true);
    assert.equal(readBack(resumed).parentToolCallId, "resume-tool-call");
    assert.equal(readBack(resumed).description, "Resumed child");
    assert.equal(existsSync(dirty.worktreePath), true, "resume does not remove a retained worktree");
  }, { repo: true });
});

test("turn budgets preserve final answers and give every resume a fresh saved budget", async () => {
  await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
    faux.setResponses([answer("natural final")]);
    const first = await (await runtime.start(request)).completion;
    assert.equal(first.status, "completed");
    const child = sessions.get(first.sessionId).inner;
    assert.equal(child.agent.hasQueuedMessages(), false);
    const previousHook = child.agent.finishTurn;
    faux.setResponses([readFact(fact, "work"), answer("wrap-up final")]);
    const resumed = await (await runtime.resume(resumeRequest(request, first))).completion;
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.result, "wrap-up final");
    assert.equal(child.agent.finishTurn, previousHook);
    assert.equal(readBack(resumed).turnLimit, 1);
    faux.setResponses([readFact(fact, "first partial"), readFact(fact, "last partial")]);
    const exhausted = await (await runtime.resume(resumeRequest(request, resumed))).completion;
    assert.equal(exhausted.status, "failed");
    assert.match(exhausted.error, /turn limit \(1\)/);
    assert.equal(exhausted.result, "last partial");
    assert.equal(child.agent.hasQueuedMessages(), false);
    assert.match(subagentFinalText(exhausted), /Partial output/);
    assert.notEqual(exhausted.runId, resumed.runId);
    assert.equal(child.agent.finishTurn, previousHook);
  });
});

test("child-chat Stop is aborted on start and resume, not completed or failed", async () => {
  let stopChild;
  await withRuntime(async ({ runtime, request, faux, sessions }) => {
    faux.setResponses([async () => { await stopChild(); return answer("not a completed answer"); }]);
    const first = await (await runtime.start(request)).completion;
    assert.equal(first.status, "aborted");
    stopChild = () => { sessions.get(first.sessionId).inner.agent.abort(); };
    faux.setResponses([async () => { await stopChild(); return answer("not complete"); }]);
    const resumed = await (await runtime.resume(resumeRequest(request, first))).completion;
    assert.equal(resumed.status, "aborted");
  }, { configureChild(inner) { stopChild = () => { inner.agent.abort(); }; } });
});

test("finalized terminating tools finish successfully on the limit and wrap-up turn", async t => {
  for (const terminalTurn of [1, 2]) await t.test(`terminal turn ${terminalTurn}`, async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([...(terminalTurn === 2 ? [readFact(fact)] : []), readFact(fact, "terminal result"), answer("must not run")]);
      const result = await (await runtime.start(request)).completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "terminal result");
      assert.equal(faux.state.callCount, terminalTurn);
    }, { configureChild(inner) {
      const previous = inner.agent.afterToolCall;
      let calls = 0;
      inner.agent.afterToolCall = async (context, signal) => ({ ...await previous?.(context, signal), terminate: ++calls === terminalTurn });
    } });
  });
});

test("existing boundary hooks cannot queue work past an exhausted budget or leak it into resume", async () => {
  await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
    faux.setResponses([readFact(fact), readFact(fact, "last partial"), answer("past limit")]);
    const result = await (await runtime.start(request)).completion;
    assert.equal(faux.state.callCount, 2);
    assert.equal(result.status, "failed");
    assert.match(result.error, /LATE_HANDOFF/);
    const child = sessions.get(result.sessionId).inner;
    assert.equal(child.agent.hasQueuedMessages(), false);
    faux.setResponses([context => {
      assert.equal(JSON.stringify(context.messages).includes("LATE_HANDOFF"), false);
      return answer("resumed normally");
    }]);
    assert.equal((await (await runtime.resume(resumeRequest(request, result))).completion).status, "completed");
  }, { configureChild(inner) {
    const previous = inner.agent.finishTurn;
    inner.agent.finishTurn = async (turn, signal) => {
      const decision = await previous?.(turn, signal);
      if (turn.message.content.some(block => block.text === "last partial")) {
        await inner.steer("LATE_HANDOFF");
        return { action: "continue" };
      }
      return decision;
    };
  } });
});

test("earlier steering shares the one wrap-up turn and later steering is refused", async () => {
  await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
    let sessionId, late;
    faux.setResponses([async () => { await runtime.steer(sessionId, "EARLY_NOTE"); return readFact(fact); }, context => {
      const text = JSON.stringify(context.messages);
      assert.match(text, /EARLY_NOTE/);
      assert.match(text, /You have reached your turn limit/);
      return readFact(fact, "partial");
    }, answer("past limit")]);
    const execution = await runtime.start(request);
    sessionId = execution.run.sessionId;
    sessions.get(sessionId).inner.subscribe(event => {
      if (event.type === "turn_end" && faux.state.callCount === 2) late ??= runtime.steer(sessionId, "too late").then(() => "accepted", error => error.message);
    });
    const result = await execution.completion;
    assert.equal(result.status, "failed");
    assert.equal(faux.state.callCount, 2);
    assert.match(await late, /turn limit/);
  });
});

test("a pre-execution isolated cancellation is durable and reports removed worktree", async () => {
  await withRuntime(async ({ runtime, request }) => {
    const abort = new AbortController();
    const execution = await runtime.start({ ...request, isolation: "worktree", signal: abort.signal,
      onUpdate: run => { if (run.status === "queued") abort.abort(); } });
    const result = await execution.completion;
    assert.equal(result.status, "aborted");
    assert.equal(result.worktreeExists, false);
    assert.equal(subagentFinalText(readBack(result)), subagentFinalText(result));
  }, { repo: true });
});

test("provider failures remain failures on start/resume, and legacy resumes stay unlimited", async () => {
  await withRuntime(async ({ runtime, request, faux, sessions, paths, fact }) => {
    faux.setResponses([fauxAssistantMessage("partial", { stopReason: "error", errorMessage: "synthetic provider failure" })]);
    const first = await (await runtime.start(request)).completion;
    assert.equal(first.status, "failed");
    faux.setResponses([fauxAssistantMessage("retry partial", { stopReason: "error", errorMessage: "synthetic retry failure" })]);
    const retry = await (await runtime.resume(resumeRequest(request, first))).completion;
    assert.equal(retry.status, "failed");
    assert.match(retry.error, /retry failure/);
    const entries = (await readFile(retry.sessionPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    delete entries.find(entry => entry.customType === "pi-web:subagent").data.turnLimit;
    sessions.get(retry.sessionId).inner.dispose(); sessions.delete(retry.sessionId); paths.set(retry.sessionId, retry.sessionPath);
    await writeFile(retry.sessionPath, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    faux.setResponses([readFact(fact), readFact(fact), answer("legacy completed")]);
    const legacy = await (await runtime.resume(resumeRequest(request, retry))).completion;
    assert.equal(legacy.status, "completed");
    assert.equal(legacy.turnLimit, undefined);
    assert.equal(legacy.result, "legacy completed");
  });
});

test("late model budget refusal rolls back a clean isolated checkout before child publication", async () => {
  await withRuntime(async ({ runtime, request, agentDir, cwd, profile, sessions, parentInner, modelRuntime }) => {
    await profile("late-global", ["load_extensions: true", "model: late/tiny"]);
    await mkdir(join(agentDir, "extensions"), { recursive: true });
    await writeFile(join(agentDir, "extensions", "late.js"), `export default pi => pi.registerProvider("late", { baseUrl: "http://127.0.0.1:1", apiKey: "synthetic-unused", api: "openai-completions", models: [{ id: "tiny", name: "Tiny", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });`);
    await writeFile(join(cwd, "oversized.txt"), "x".repeat(3201));
    execFileSync("git", ["-C", cwd, "add", "oversized.txt"]);
    execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "input snapshot"]);
    assert.equal(modelRuntime.getModel("late", "tiny"), undefined);
    await assert.rejects(runtime.start({ ...request, profile: "late-global", inputFiles: ["oversized.txt"], isolation: "worktree" }), /3200-byte.*late\/tiny/);
    assert.deepEqual([...sessions.keys()], [parentInner.sessionId]);
    const registrations = execFileSync("git", ["-C", cwd, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    assert.equal((registrations.match(/^worktree /gm) ?? []).length, 1);
  }, { repo: true });
});

test("simultaneous resumes admit only one execution of the same child", async () => {
  const entered = deferred(), release = deferred();
  let hold = false;
  await withRuntime(async ({ runtime, request, faux }) => {
    faux.setResponses([answer("first")]);
    const first = await (await runtime.start(request)).completion;
    hold = true;
    faux.setResponses([answer("continued")]);
    try {
      const attempts = await Promise.allSettled([runtime.resume(resumeRequest(request, first)), runtime.resume(resumeRequest(request, first))]);
      assert.equal(attempts.filter(attempt => attempt.status === "fulfilled").length, 1);
      assert.match(attempts.find(attempt => attempt.status === "rejected").reason.message, /already running/);
      await entered.promise;
      release.resolve();
      assert.equal((await attempts.find(attempt => attempt.status === "fulfilled").value.completion).status, "completed");
    } finally { release.resolve(); }
  }, { configureChild(inner) {
    const prompt = inner.prompt.bind(inner);
    inner.prompt = async (...args) => { if (hold) { entered.resolve(); await release.promise; } return prompt(...args); };
  } });
});

test("queued-record failure refuses provider dispatch; terminal-write failure is honest and not a deleted-session cache", async t => {
  await t.test("queued entry", async () => {
    await withRuntime(async ({ runtime, request, faux }) => {
      const result = await (await runtime.start(request)).completion;
      assert.equal(result.status, "failed");
      assert.match(result.error, /synthetic queue write/);
      assert.equal(faux.state.callCount, 0);
      assert.equal(readBack(result).status, "failed");
    }, { configureChild(inner) {
      const append = inner.sessionManager.appendCustomEntry.bind(inner.sessionManager);
      inner.sessionManager.appendCustomEntry = (type, data) => { if (type === "pi-web:subagent-status" && data.status === "queued") throw new Error("synthetic queue write"); return append(type, data); };
    } });
  });
  await t.test("terminal entry", async () => {
    await withRuntime(async ({ runtime, request, faux, sessions, paths }) => {
      faux.setResponses([answer("finished provider work")]);
      const result = await (await runtime.start(request)).completion;
      assert.equal(result.status, "failed");
      assert.match(result.error, /Could not persist.*synthetic result write/);
      assert.equal((await runtime.get(result.sessionId)).status, "failed");
      paths.set(result.sessionId, result.sessionPath);
      sessions.get(result.sessionId).inner.dispose(); sessions.delete(result.sessionId);
      await unlink(result.sessionPath);
      assert.equal(await runtime.get(result.sessionId), null);
    }, { configureChild(inner) {
      const append = inner.sessionManager.appendCustomEntry.bind(inner.sessionManager);
      inner.sessionManager.appendCustomEntry = (type, data) => { if (type === "pi-web:subagent-result") throw new Error("synthetic result write"); return append(type, data); };
    } });
  });
});
