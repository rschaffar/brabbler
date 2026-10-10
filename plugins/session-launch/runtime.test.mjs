import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url);
const { startRpcSession, getRpcSession, getRpcSessionInfos } = await jiti.import("../../lib/rpc-manager.ts");
const { updatePluginSettings, readPluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
const { sessionLaunchManifest } = await jiti.import("./manifest.ts");
const { listAllSessions, getSessionEntries } = await jiti.import("../../lib/session-reader.ts");
const { sessionLaunchHost, launchBuiltinTools } = await jiti.import("../../lib/session-launch-runtime.ts");
const { executeSessionLaunch } = await jiti.import("./server.ts");

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-launch-sdk-"));
  const previous = process.env.PI_CODING_AGENT_DIR, previousOffline = process.env.PI_OFFLINE;
  const agentDir = join(root, "agent"), cwd = join(root, "project"); mkdirSync(join(agentDir, "extensions"), { recursive: true }); mkdirSync(cwd);
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
  const faux = fauxProvider({ provider: "session-launch-sdk", api: "session-launch-sdk", models: [{ id: "faux-1", reasoning: true }, { id: "faux-2", reasoning: true }] });
  globalThis.__sessionLaunchFaux = faux;
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: faux.provider.id, defaultModel: faux.getModel().id,
    cacheWarming: "off", compaction: { enabled: false }, retry: { enabled: false } }));
  writeFileSync(join(agentDir, "extensions", "launch-fixture.js"), `export default function (pi) {
    pi.registerProvider(globalThis.__sessionLaunchFaux.provider);
    pi.on("before_agent_start", async (event, ctx) => {
      if (globalThis.__sessionLaunchHook) await globalThis.__sessionLaunchHook(event, ctx, pi);
    });
    pi.on("input", async (event, ctx) => {
      if (globalThis.__sessionLaunchInputHook) return await globalThis.__sessionLaunchInputHook(event, ctx);
    });
    pi.registerCommand("launch-child", { handler: async (_args, ctx) => {
      const answer = await ctx.ui.input("Child independent input");
      ctx.ui.notify("Child input: " + answer);
    } });
  }`);
  const wrappers = [];
  const start = async (tools) => {
    const started = await startRpcSession("__fixture__" + Math.random(), "", cwd, { initialModel: { provider: faux.provider.id, modelId: faux.getModel().id }, thinkingLevel: "off", ...(tools ? { toolNames: tools } : {}) });
    wrappers.push(started.session); return started.session;
  };
  t.after(async () => {
    const sessions = [...new Set([...wrappers, ...(globalThis.__piSessions?.values() ?? [])])];
    for (const wrapper of sessions) if (wrapper.cwd.startsWith(root)) await wrapper.shutdown();
    // SDK abort settles before wrapper completion handlers necessarily finish.
    const deadline = Date.now() + 10000;
    while (sessions.some((wrapper) => wrapper.pendingPromptCount > 0) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(sessions.some((wrapper) => wrapper.pendingPromptCount > 0), false, "owned prompts settled before fixture/environment removal");
    delete globalThis.__sessionLaunchFaux; delete globalThis.__sessionLaunchHook; delete globalThis.__sessionLaunchInputHook;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
    rmSync(root, { recursive: true, force: true });
    globalThis.__piSessionListCache = undefined; globalThis.__piSessionListPromise = undefined;
    globalThis.__piWebScanIndex = undefined; globalThis.__piWebScanIndexLoaded = undefined;
  });
  return { root, cwd, agentDir, faux, start, wrappers };
}
async function settled(wrapper) {
  const deadline = Date.now() + 10000;
  while (wrapper.isRunning() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(wrapper.isRunning(), false);
}

test("real model-issued launch uses ordinary independent SDK sessions, exact approval, persistence and reload", async (t) => {
  const f = await fixture(t), parent = await f.start(["read", "bash"]), events = [];
  parent.onEvent((event) => events.push(event));
  const settingsBefore = readFileSync(join(f.agentDir, "settings.json"), "utf8");
  const childOrParent = (context) => context.messages.some((message) => message.role === "toolResult" && message.toolName === "start_session")
    ? fauxAssistantMessage("Launched.")
    : fauxAssistantMessage([fauxToolCall("ask_user", { question: "Child independent input" }, { id: "child-input" })], { stopReason: "toolUse" });
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("start_session", { prompt: "Independent child task" }, { id: "spawn-one" })], { stopReason: "toolUse" }), childOrParent, childOrParent, fauxAssistantMessage("Child completed.")]);
  const cardWait = new Promise((resolve) => parent.onEvent((event) => { if (event.method === "plugin_card") resolve(event); }));
  await parent.send({ type: "prompt", message: "Please start a new session for this task." });
  const card = await cardWait;
  assert.equal(card.title, "Start a new session"); assert.equal(card.sections[0].text, "Independent child task");
  assert.equal(card.fields.find((field) => field.label === "Tools").value, "read, bash");
  const approval = await parent.send({ type: "extension_ui_response", id: card.id, action: "approve" });
  assert.equal(approval.accepted, true);
  await settled(parent);
  const result = parent.inner.sessionManager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === "spawn-one").message;
  assert.equal(result.isError, false, JSON.stringify(result)); assert.equal(result.details.accepted, true);
  const child = getRpcSession(result.details.sessionId); f.wrappers.push(child);
  assert.notEqual(child.sessionId, parent.sessionId); assert.equal(child.isRunning(), true);
  assert.equal(child.inner.getActiveToolNames().includes("start_session"), true);
  const childEntries = getSessionEntries(child.sessionFile);
  assert.equal(childEntries.some((entry) => entry.type === "custom" && entry.customType === "pi-web:session-spawn" && entry.data.creatorSessionId === parent.sessionId), true);
  assert.equal(childEntries.some((entry) => entry.type === "message" && entry.message.content === "Please start a new session for this task."), false);
  assert.equal(readFileSync(join(f.agentDir, "settings.json"), "utf8"), settingsBefore, "inherited preferences are not global user defaults");
  const info = (await listAllSessions({ force: true })).find((session) => session.id === child.sessionId);
  assert.equal(info.spawnedBy, parent.sessionId); assert.equal(info.relation, undefined); assert.equal(info.parentSessionId, undefined);
  assert.equal(getRpcSessionInfos().find((session) => session.id === child.sessionId).spawnedBy, parent.sessionId);
  const replay = []; child.onEvent((event) => replay.push(event))();
  const request = replay.find((event) => event.method === "ask_user");
  assert.ok(request);
  await parent.shutdown(); assert.equal(child.isAlive(), true); assert.equal(child.isRunning(), true);
  await child.send({ type: "extension_ui_response", id: request.id, answer: { kind: "freeform", text: "Independent" } }); await settled(child);
  const file = child.sessionFile, id = child.sessionId; await child.shutdown();
  const reopened = await startRpcSession(id, file, undefined); f.wrappers.push(reopened.session);
  assert.equal(reopened.realSessionId, id); assert.equal(SessionManager.open(file).getEntries().filter((entry) => entry.customType === "pi-web:session-spawn").length, 1);
});

test("real Allow launch skips approval, new IDs do not inherit overrides, disabled tools update live", async (t) => {
  const f = await fixture(t), parent = await f.start(["read"]);
  updatePluginSettings(sessionLaunchManifest, "session", f.cwd, { launch: "allow" }, [], undefined, { id: parent.sessionId, cwd: f.cwd });
  let cards = 0; parent.onEvent((event) => { if (event.method === "plugin_card") cards++; });
  const childOrParent = (context) => context.messages.some((message) => message.role === "toolResult" && message.toolName === "start_session")
    ? fauxAssistantMessage("Done.")
    : fauxAssistantMessage([fauxToolCall("ask_user", { question: "Child independent input" }, { id: "child-allow-input" })], { stopReason: "toolUse" });
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("start_session", { prompt: "Independent child task" }, { id: "spawn-allow" })], { stopReason: "toolUse" }), childOrParent, childOrParent]);
  await parent.send({ type: "prompt", message: "Start another session." }); await settled(parent);
  const result = parent.inner.sessionManager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === "spawn-allow").message;
  assert.equal(result.isError, false, JSON.stringify(result)); assert.equal(cards, 0);
  const child = getRpcSession(result.details.sessionId); f.wrappers.push(child);
  assert.equal(readPluginSettings(sessionLaunchManifest, f.cwd, undefined, { id: child.sessionId, cwd: f.cwd }).effective.launch, "ask");
  updatePluginSettings(sessionLaunchManifest, "global", undefined, { enabled: false }, []);
  assert.equal(parent.inner.getActiveToolNames().includes("start_session"), false);
  assert.equal(child.inner.getActiveToolNames().includes("start_session"), false);
  assert.equal(parent.inner.getAllTools().find((tool) => tool.name === "start_session").exposure, "hidden");
});

test("Chat-only callers have no launch tool; missing selected account and unavailable models fail closed", async (t) => {
  const f = await fixture(t);
  const { session: chat } = await startRpcSession("__chat__" + Math.random(), "", f.cwd, { toolNames: [] }); f.wrappers.push(chat);
  assert.equal(chat.inner.getAllTools().some((tool) => tool.name === "start_session"), false);
  await assert.rejects(sessionLaunchHost.resolve({ prompt: "Task", cwd: f.cwd }, { id: chat.sessionId, cwd: f.cwd }), /ordinary live coding/);
  const parent = await f.start(["read"]);
  await assert.rejects(sessionLaunchHost.resolve({ prompt: "Task", cwd: f.cwd, accounts: { [f.faux.provider.id]: "deleted-account" } }, { id: parent.sessionId, cwd: f.cwd }), /Selected account is unavailable/);
  await assert.rejects(sessionLaunchHost.resolve({ prompt: "Task", cwd: f.cwd, provider: "missing", modelId: "missing" }, { id: parent.sessionId, cwd: f.cwd }), /not available/);
});

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
test("launch revalidates Stop and permission after delayed SDK hooks, before any provider call", async (t) => {
  for (const mode of ["stop", "deny"]) await t.test(mode, async (st) => {
    const f = await fixture(st), parent = await f.start(["read"]), entered = deferred(), gate = deferred(), controller = new AbortController();
    updatePluginSettings(sessionLaunchManifest, "global", undefined, { launch: "allow" }, []);
    globalThis.__sessionLaunchHook = async () => { entered.resolve(); await gate.promise; };
    const receipts = [];
    const pending = executeSessionLaunch({ prompt: "Delayed task" }, { id: parent.sessionId, cwd: f.cwd }, {
      sessionLaunchHost, operationReceipt(_id, receipt) { receipts.push(structuredClone(receipt)); },
    }, controller.signal);
    await entered.promise;
    if (mode === "stop") controller.abort();
    else updatePluginSettings(sessionLaunchManifest, "global", undefined, { launch: "deny" }, []);
    gate.resolve();
    const result = await pending;
    assert.equal(result.isError, true); assert.equal(result.details.accepted, false); assert.ok(result.details.sessionId);
    assert.equal(f.faux.state.callCount, 0, "no provider request after stale admission");
    assert.equal(receipts.at(-1).phase, "failed");
  });
});
test("literal launch refuses transformed/intercepted prompts and late model/tool changes", async (t) => {
  for (const mode of ["transform", "handled", "tools", "thinking", "model"]) await t.test(mode, async (st) => {
    const f = await fixture(st), parent = await f.start(["read"]);
    updatePluginSettings(sessionLaunchManifest, "global", undefined, { launch: "allow" }, []);
    if (mode === "transform") globalThis.__sessionLaunchInputHook = () => ({ action: "transform", text: "Different prompt" });
    if (mode === "handled") globalThis.__sessionLaunchInputHook = () => ({ action: "handled" });
    if (mode === "tools") globalThis.__sessionLaunchHook = (_event, _ctx, pi) => { pi.setActiveTools(["bash"]); };
    if (mode === "thinking") globalThis.__sessionLaunchHook = (_event, _ctx, pi) => { pi.setThinkingLevel("high"); };
    if (mode === "model") globalThis.__sessionLaunchHook = async (_event, ctx, pi) => { await pi.setModel(ctx.modelRegistry.find("session-launch-sdk", "faux-2")); };
    const result = await executeSessionLaunch({ prompt: "Exact task" }, { id: parent.sessionId, cwd: f.cwd }, { sessionLaunchHost, operationReceipt() {} });
    assert.equal(result.isError, true); assert.equal(result.details.accepted, false); assert.ok(result.details.sessionId);
    assert.equal(f.faux.state.callCount, 0);
  });
});
test("first launch prompt is literal even if its text names an extension command", async (t) => {
  const f = await fixture(t), parent = await f.start(["read"]);
  updatePluginSettings(sessionLaunchManifest, "global", undefined, { launch: "allow" }, []);
  f.faux.setResponses([fauxAssistantMessage("Literal initial prompt delivered")]);
  const result = await executeSessionLaunch({ prompt: "/launch-child" }, { id: parent.sessionId, cwd: f.cwd }, { sessionLaunchHost, operationReceipt() {} });
  assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal(result.details.accepted, true);
  const child = getRpcSession(result.details.sessionId); await settled(child);
  assert.equal(child.getPendingAttention(), null, "command was not dispatched");
  assert.equal(f.faux.state.callCount, 1);
  const firstUser = child.inner.sessionManager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "user");
  assert.equal(firstUser.message.content[0].text, "/launch-child");
});
test("destination preview uses startup trust; incomplete subagent metadata fails closed", async (t) => {
  const f = await fixture(t), parent = await f.start(["read"]), destination = join(f.root, "destination");
  const settingsPath = join(f.agentDir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, "utf8")), enabledModels: ["session-launch-sdk/faux-1"] }));
  mkdirSync(join(destination, ".pi"), { recursive: true });
  writeFileSync(join(destination, ".pi", "settings.json"), JSON.stringify({ enabledModels: ["session-launch-sdk/faux-2"] }));
  const request = { prompt: "Task", cwd: destination, provider: "session-launch-sdk", modelId: "faux-2" }, caller = { id: parent.sessionId, cwd: f.cwd };
  await assert.rejects(sessionLaunchHost.resolve(request, caller), /not available.*enabled scope/);
  const { trustProject } = await jiti.import("../../lib/project-trust.ts");
  trustProject(destination, f.agentDir);
  assert.equal((await sessionLaunchHost.resolve(request, caller)).modelId, "faux-2");
  parent.inner.sessionManager.appendCustomEntry("pi-web:subagent", { version: 1 });
  await assert.rejects(sessionLaunchHost.resolve({ prompt: "Task", cwd: f.cwd }, caller), /ordinary live coding/);
});

test("PowerShell active loadouts retain the canonical shell selector", () => {
  assert.deepEqual(launchBuiltinTools(["powershell", "read", "start_session"]), ["bash", "read"]);
  assert.deepEqual(launchBuiltinTools(["powershell"]), ["bash"]);
});
