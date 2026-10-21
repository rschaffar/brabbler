import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager, createAgentSessionServices, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import { normalizeContext } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const rpc = await jiti.import("./rpc-manager.ts");
const { writeModelsConfig } = await jiti.import("./models-config-store.ts");
const { readSessionAccounts, appendSessionAccounts } = await jiti.import("./session-accounts.ts");
const { readSessionModelSpeed, appendSessionModelSpeed } = await jiti.import("./session-model-speed.ts");
const { withSessionModelSpeed } = await jiti.import("./session-model-speed-runtime.ts");
const { withModelRuntimeAccess } = await jiti.import("./session-model-refresh.ts");
const { addProviderAccount, accountCredentialStore } = await jiti.import("./provider-accounts.ts");

test("native SDK 1.3 applies saved definitions only on reselection and durably retains account/speed/thinking without HTTP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-model-definition-"));
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
  const previous = { dir: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE, fetch: globalThis.fetch };
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("No HTTP is permitted in model-definition fixtures"); };
  const owned = new Set();
  const model = { id: "definition-fixture", name: "Definition fixture", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192 };
  const config = { providers: { anthropic: { api: "anthropic-messages", baseUrl: "http://127.0.0.1:9/provider", compat: { forceAdaptiveThinking: true }, models: [model,
    { ...model, id: "sibling-fixture", name: "Sibling" }] } } };
  const settingsPath = join(agentDir, "settings.json");
  let stage = "startup";
  try {
    await writeFile(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: model.id, defaultThinkingLevel: "medium",
      enabledModels: ["anthropic/definition-fixture:medium", "anthropic/sibling-fixture"], cacheWarming: "off", enableInstallTelemetry: false }), { mode: 0o600 });
    writeModelsConfig(config);
    const account = await addProviderAccount("anthropic", "Synthetic definition account", "api_key");
    await accountCredentialStore({ anthropic: account.id }).modify("anthropic", async () => ({ type: "api_key", key: "synthetic-not-a-real-key" }));
    const settingsBefore = await readFile(settingsPath, "utf8");
    let started = await rpc.startRpcSession(`__new__${randomUUID()}`, "", cwd, { accounts: { anthropic: account.id }, toolNames: [],
      initialModel: { provider: "anthropic", modelId: model.id }, thinkingLevel: "high", modelSpeed: "fast", persistPreferences: false });
    owned.add(started.session);
    await started.session.waitUntilReady();
    const wrapper = started.session, inner = wrapper.inner, runtime = inner.modelRuntime;
    const original = inner.model, entries = inner.sessionManager.getEntries().length;
    assert.equal(original.id, model.id);
    assert.equal(inner.thinkingLevel, "high");
    stage = "unchanged reselect";
    await wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(inner.model, original); assert.equal(inner.sessionManager.getEntries().length, entries);
    assert.equal(existsSync(wrapper.sessionFile), false, "unchanged reselection must not force persistence");

    const childManager = SessionManager.create(cwd, join(root, "child-sessions"));
    appendSessionAccounts(childManager, { anthropic: account.id }); appendSessionModelSpeed(childManager, "fast");
    const childServices = await createAgentSessionServices({ cwd, agentDir, modelRuntime: runtime, resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    } });
    let childAgent;
    childServices.modelRuntime = withModelRuntimeAccess(childServices.modelRuntime,
      withSessionModelSpeed(childServices.modelRuntime, childManager, () => childAgent));
    const { session: childInner } = await createAgentSessionFromServices({ services: childServices, sessionManager: childManager,
      model: runtime.getModel("anthropic", "sibling-fixture"), thinkingLevel: "medium", scopedModels: [...inner.scopedModels], tools: [] });
    childAgent = childInner.agent;
    const child = new rpc.AgentSessionWrapper(childInner); owned.add(child);
    await assert.rejects(wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id }), /sharing this runtime is busy/, "unfinished sibling initialization excludes reselection");
    child.beginExtensionBinding();
    await child.waitUntilReady();
    const releaseChild = child.beginCheckoutPromptAdmission();
    try { await assert.rejects(wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id }), /sharing this runtime is busy/); }
    finally { releaseChild(); }

    config.providers.anthropic.models[0] = { ...model, baseUrl: "http://127.0.0.1:9/edited", contextWindow: 256000,
      compat: { forceAdaptiveThinking: false }, thinkingLevelMap: { high: "low" }, cost: { input: 1, output: 2 } };
    writeModelsConfig(config);
    assert.equal(inner.model, original, "save alone does not rebind a loaded session");
    stage = "resource reload";
    await wrapper.send({ type: "reload" });
    assert.equal(inner.model, original, "resource reload is not model reselection");
    stage = "changed reselect";
    await wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(inner.modelRuntime, runtime, "preserve the session/account-bound runtime");
    assert.notEqual(inner.model, original);
    assert.equal(inner.model.baseUrl, "http://127.0.0.1:9/edited");
    assert.equal(inner.model.contextWindow, 256000);
    assert.equal(inner.model.compat.forceAdaptiveThinking, false);
    assert.equal(inner.thinkingLevel, "high");
    assert.deepEqual(inner.scopedModels[0].model, inner.model);
    assert.notEqual(inner.scopedModels[0].model, original);
    assert.equal(inner.scopedModels[0].thinkingLevel, "medium");
    assert.equal(runtime.getModel("anthropic", "sibling-fixture").baseUrl, "http://127.0.0.1:9/provider");
    assert.equal(childInner.model.provider, "anthropic"); assert.equal(childInner.model.id, "sibling-fixture");
    assert.equal(childInner.thinkingLevel, "medium");
    assert.equal(childInner.scopedModels[0].model.contextWindow, 256000);
    assert.deepEqual(readSessionAccounts(childManager.getEntries()), { anthropic: account.id });
    assert.equal(readSessionModelSpeed(childManager.getEntries()), "fast");
    assert.deepEqual(readSessionAccounts(inner.sessionManager.getEntries()), { anthropic: account.id });
    assert.equal(readSessionModelSpeed(inner.sessionManager.getEntries()), "fast");
    assert.equal(await readFile(settingsPath, "utf8"), settingsBefore, "reselection never changes global defaults");

    // Inspect the actual rebound model's native payload, stopping before HTTP.
    const payloadFor = async effective => {
      let payload;
      const stream = anthropicMessagesApi().streamSimple(effective, normalizeContext({ messages: [{ role: "user", content: "Synthetic fixture", timestamp: 1 }] }), {
        apiKey: "synthetic-not-a-real-key", env: {}, reasoning: "high", thinkingBudgets: { high: 2048 }, cacheRetention: "none", maxRetries: 0,
        fetch: globalThis.fetch, onPayload(body) { payload = structuredClone(body); throw new Error("fixture-stop-before-http"); },
      });
      assert.equal((await stream.result()).errorMessage, "fixture-stop-before-http"); return payload;
    };
    assert.equal((await payloadFor(inner.model)).thinking.type, "enabled");
    const file = wrapper.sessionFile;
    assert.equal(existsSync(file), true, "edited selection must persist even before the first assistant message");
    stage = "reopen";
    await wrapper.shutdown();
    started = await rpc.startRpcSession(inner.sessionId, file, undefined, { persistPreferences: false }); owned.add(started.session);
    assert.equal(started.session.inner.model.id, model.id);
    assert.equal(started.session.inner.thinkingLevel, "high");
    assert.equal((await started.session.send({ type: "get_state" })).modelSpeed, "fast");
    assert.deepEqual(readSessionAccounts(SessionManager.open(file).getEntries()), { anthropic: account.id });

    stage = "restore inheritance";
    delete config.providers.anthropic.models[0].baseUrl;
    delete config.providers.anthropic.models[0].compat;
    writeModelsConfig(config);
    await started.session.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(started.session.inner.model.baseUrl, "http://127.0.0.1:9/provider");
    assert.equal(started.session.inner.model.compat.forceAdaptiveThinking, true);
    assert.equal((await payloadFor(started.session.inner.model)).thinking.type, "adaptive");

    stage = "capability clamp and metadata-only reopen";
    config.providers.anthropic.models[0].reasoning = false;
    writeModelsConfig(config);
    await started.session.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(started.session.inner.thinkingLevel, "off");
    const clampedId = started.realSessionId, clampedFile = started.session.sessionFile;
    await started.session.shutdown();
    started = await rpc.startRpcSession(clampedId, clampedFile, undefined, { persistPreferences: false }); owned.add(started.session);
    await started.session.waitUntilReady();
    assert.equal(started.session.inner.thinkingLevel, "off");
    const reopenedEntries = started.session.inner.sessionManager.getEntries().length;
    await started.session.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(started.session.inner.sessionManager.getEntries().length, reopenedEntries);
    await started.session.send({ type: "set_model", provider: "anthropic", modelId: "sibling-fixture" });
    assert.equal(started.session.inner.model.id, "sibling-fixture");
    assert.equal(started.session.inner.thinkingLevel, "medium", "different models retain native switch policy");
    await started.session.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(started.session.inner.thinkingLevel, "off");
    assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);

    stage = "invalid config";
    const validConfig = await readFile(join(agentDir, "models.json"), "utf8");
    await writeFile(join(agentDir, "models.json"), "{ invalid fixture");
    await assert.rejects(started.session.send({ type: "set_model", provider: "anthropic", modelId: model.id }), /could not be applied/);
    assert.match((await started.session.send({ type: "get_state" })).modelDefinitionRefresh.error, /could not be applied/);
    await assert.rejects(started.session.send({ type: "prompt", message: "must not reach SDK preflight" }), /could not be applied/);
    const retainedContext = started.session.inner.extensionRunner.createToolContext("synthetic-parent-call", new AbortController().signal);
    await assert.rejects(retainedContext.executeTool("read", { path: settingsPath }), /could not be applied/);
    assert.throws(() => started.session.inner.resourceLoader.getExtensions().runtime.refreshTools(), /could not be applied/);
    stage = "repair config";
    await writeFile(join(agentDir, "models.json"), validConfig);
    await started.session.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal((await started.session.send({ type: "get_state" })).modelDefinitionRefresh.error, undefined);

    stage = "native binding retirement";
    const retiring = started.session;
    const boundRuntime = retiring.inner.modelRuntime;
    const checkAuth = boundRuntime.checkAuth.bind(boundRuntime);
    let releaseAuth, enteredAuth;
    const authGate = new Promise(resolve => { releaseAuth = resolve; });
    const authEntered = new Promise(resolve => { enteredAuth = resolve; });
    boundRuntime.checkAuth = async (...args) => { enteredAuth(); await authGate; return checkAuth(...args); };
    config.providers.anthropic.models[0].contextWindow += 1024;
    writeModelsConfig(config);
    const applying = retiring.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    const refused = assert.rejects(applying, /could not be applied/);
    await authEntered;
    let shutdownDone = false;
    const closing = retiring.shutdown().then(() => { shutdownDone = true; });
    await new Promise(setImmediate);
    assert.equal(shutdownDone, false, "native authentication/rebinding must settle before disposal/deletion");
    releaseAuth(); await refused; await closing;
    await rm(retiring.sessionFile);
    await new Promise(setImmediate);
    assert.equal(existsSync(retiring.sessionFile), false, "a settled native bind cannot recreate the deleted file");
    assert.equal(fetchCalls, 0);
  } catch (error) {
    throw new Error(`${stage}: ${error.message}`, { cause: error });
  } finally {
    for (const wrapper of owned) await wrapper.shutdown();
    if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.dir;
    if (previous.offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previous.offline;
    globalThis.fetch = previous.fetch;
    await rm(root, { recursive: true, force: true });
  }
});
