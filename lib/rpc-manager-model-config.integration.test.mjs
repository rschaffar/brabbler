import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTaskOwner } from "./testing/async.fixture.mjs";
import { rpcModelConfigNative } from "./rpc-model-config-native.fixture.mjs";
import { SessionManager, createAgentSessionServices, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import { normalizeContext, fauxProvider, fauxAssistantMessage, fauxToolCall, getCurrentTools, getCurrentSystemPrompt } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const rpc = await jiti.import("./rpc-manager.ts");
const { writeModelsConfig } = await jiti.import("./models-config-store.ts");
const { readSessionAccounts, appendSessionAccounts } = await jiti.import("./session-accounts.ts");
const { readSessionModelSpeed, appendSessionModelSpeed } = await jiti.import("./session-model-speed.ts");
const { withSessionModelSpeed } = await jiti.import("./session-model-speed-runtime.ts");
const { withModelRuntimeAccess } = await jiti.import("./session-model-refresh.ts");
const { addProviderAccount, accountCredentialStore } = await jiti.import("./provider-accounts.ts");
const { SUBAGENT_META_TYPE, SUBAGENT_CONTROL_TOOL_NAMES, readSubagentSessionResources } = await jiti.import("./subagents.ts");
const { persistChildSession } = await jiti.import("./subagent-lifecycle.ts");

test("native SDK 1.3 applies saved definitions only on reselection and durably retains account/speed/thinking without HTTP", async t => {
  const native = rpcModelConfigNative(t, { prefix: "brabbler-model-definition-", label: "Model-definition fixture teardown failed" });
  const root = await native.provision();
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  const previous = { dir: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE, fetch: globalThis.fetch };
  let fetchCalls = 0;
  const owned = native.owned, retirement = createTaskOwner();
  let releaseAuth, primaryError;
  native.release(() => releaseAuth?.());
  native.join(() => retirement.join());
  native.restore(() => { if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.dir; });
  native.restore(() => { if (previous.offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previous.offline; });
  native.restore(() => { globalThis.fetch = previous.fetch; });
  const model = { id: "definition-fixture", name: "Definition fixture", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192 };
  const config = { providers: { anthropic: { api: "anthropic-messages", baseUrl: "http://127.0.0.1:9/provider", compat: { forceAdaptiveThinking: true }, models: [model,
    { ...model, id: "sibling-fixture", name: "Sibling" }] } } };
  const settingsPath = join(agentDir, "settings.json");
  let stage = "startup";
  try {
    await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
    process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
    globalThis.fetch = async () => { fetchCalls++; throw new Error("No HTTP is permitted in model-definition fixtures"); };
    await writeFile(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: model.id, defaultThinkingLevel: "medium",
      enabledModels: ["anthropic/definition-fixture:medium", "anthropic/sibling-fixture"], cacheWarming: "off", enableInstallTelemetry: false }), { mode: 0o600 });
    writeModelsConfig(config);
    const account = await addProviderAccount("anthropic", "Synthetic definition account", "api_key");
    await accountCredentialStore({ anthropic: account.id }).modify("anthropic", async () => ({ type: "api_key", key: "synthetic-not-a-real-key" }));
    const settingsBefore = await readFile(settingsPath, "utf8");
    stage = "ordinary first-command startup reselection";
    const ordinary = await native.start(rpc, `__new__${randomUUID()}`, "", cwd, { accounts: { anthropic: account.id }, toolNames: ["read"],
      initialModel: { provider: "anthropic", modelId: model.id }, persistPreferences: false });
    owned.add(ordinary.session);
    // Deliberately no waitUntilReady: the first RPC must await the complete
    // extension binding lease, including default-off hidden plugin definitions.
    await ordinary.session.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.ok(ordinary.session.inner.getActiveToolNames().every(name => !name.startsWith("acceptance_")));
    await ordinary.session.shutdown();
    stage = "chat-only startup";
    let started = await native.start(rpc, `__new__${randomUUID()}`, "", cwd, { accounts: { anthropic: account.id }, toolNames: [],
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
    const childServices = await native.servicesStart(() => createAgentSessionServices({ cwd, agentDir, modelRuntime: runtime, resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    } }));
    let childAgent;
    childServices.modelRuntime = withModelRuntimeAccess(childServices.modelRuntime,
      withSessionModelSpeed(childServices.modelRuntime, childManager, () => childAgent));
    const { session: childInner } = await native.rawStart(() => createAgentSessionFromServices({ services: childServices, sessionManager: childManager,
      model: runtime.getModel("anthropic", "sibling-fixture"), thinkingLevel: "medium", scopedModels: [...inner.scopedModels], tools: [] }));
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

    // Exact Markdown appendix delta, in this existing genuine native lifetime.
    // The original 128000 -> 256000 inputs/assertions above remain unchanged.
    stage = "Markdown same-row context metadata plus 1024";
    const beforeBudget = await wrapper.send({ type: "get_state" });
    const priorWindow = beforeBudget.contextUsage.contextWindow;
    assert.equal(priorWindow, 256000);
    const nextWindow = priorWindow + 1024;
    config.providers.anthropic.models[0].contextWindow = nextWindow;
    writeModelsConfig(config);
    assert.equal((await wrapper.send({ type: "get_state" })).contextUsage.contextWindow, priorWindow, "save is not model reapplication");
    await wrapper.send({ type: "reload" });
    assert.equal((await wrapper.send({ type: "get_state" })).contextUsage.contextWindow, priorWindow, "resource reload is not model reapplication");
    await wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    const afterBudget = await wrapper.send({ type: "get_state" });
    assert.equal(afterBudget.contextUsage.contextWindow, nextWindow);
    assert.equal(afterBudget.thinkingLevel, beforeBudget.thinkingLevel);
    assert.equal(inner.modelRuntime, runtime, "same account-bound native runtime");
    assert.deepEqual(readSessionAccounts(inner.sessionManager.getEntries()), { anthropic: account.id });
    const budgetTranscript = await readFile(wrapper.sessionFile, "utf8");
    await wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal(await readFile(wrapper.sessionFile, "utf8"), budgetTranscript, "unchanged same-row selection writes no transcript metadata");
    assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);
    // Return to the original native case's 256000 continuation, without resetting
    // a loader/page cache, replacing its inputs or starting a second SDK runtime.
    config.providers.anthropic.models[0].contextWindow = priorWindow;
    writeModelsConfig(config);
    await wrapper.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    assert.equal((await wrapper.send({ type: "get_state" })).contextUsage.contextWindow, priorWindow);

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
    started = await native.start(rpc, inner.sessionId, file, undefined, { persistPreferences: false }); owned.add(started.session);
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
    started = await native.start(rpc, clampedId, clampedFile, undefined, { persistPreferences: false }); owned.add(started.session);
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
    let enteredAuth;
    const authGate = new Promise(resolve => { releaseAuth = resolve; });
    const authEntered = new Promise(resolve => { enteredAuth = resolve; });
    boundRuntime.checkAuth = async (...args) => { enteredAuth(); await authGate; return checkAuth(...args); };
    config.providers.anthropic.models[0].contextWindow += 1024;
    writeModelsConfig(config);
    const applying = retiring.send({ type: "set_model", provider: "anthropic", modelId: model.id });
    const refused = retirement.track("native rebinding refusal", assert.rejects(applying, /could not be applied/));
    await Promise.race([
      authEntered,
      applying.then(
        () => { throw new Error("Native rebinding completed before held authentication admission"); },
        () => { throw new Error("Native rebinding failed before held authentication admission"); },
      ),
    ]);
    let shutdownDone = false;
    const closing = retirement.track("native retirement closure", retiring.shutdown().then(() => { shutdownDone = true; }));
    await new Promise(setImmediate);
    assert.equal(shutdownDone, false, "native authentication/rebinding must settle before disposal/deletion");
    releaseAuth(); await refused; await closing;
    await rm(retiring.sessionFile);
    await new Promise(setImmediate);
    assert.equal(existsSync(retiring.sessionFile), false, "a settled native bind cannot recreate the deleted file");
    assert.equal(fetchCalls, 0);
  } catch (error) {
    native.fail(error); // Preserve the source body's original identity too.
    primaryError = new Error(`${stage}: ${error.message}`, { cause: error });
    native.fail(primaryError);
    throw primaryError;
  } finally {
    await native.finish();
  }
});

test("cold RPC subagents retain host Bash sanitation and their saved resource policy", async t => {
  const native = rpcModelConfigNative(t, { prefix: "brabbler-cold-subagent-bash-", label: "Cold subagent fixture teardown failed" });
  const root = await native.provision();
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  const previousEnvironment = process.env, previousFetch = globalThis.fetch;
  const previousActivityFailure = globalThis.__piActivityReviewPersistenceFailed;
  native.restore(() => { process.env = previousEnvironment; });
  native.restore(() => { globalThis.fetch = previousFetch; });
  native.restore(() => {
    if (previousActivityFailure === undefined) delete globalThis.__piActivityReviewPersistenceFailed;
    else globalThis.__piActivityReviewPersistenceFailed = previousActivityFailure;
  });
  let fetchCalls = 0;
  const owned = native.owned, close = native.close;
  const hostPath = "<inline:brabbler-project-command-environment>";
  const profilePrompt = "Synthetic saved child profile. Use only the explicitly selected tools.";
  try {
    native.watchLoader();
    // Keep even startup authentication discovery away from ambient credentials.
    // Only PATH is inherited; it is needed to locate the real native Bash binary.
    process.env = {
      PATH: previousEnvironment.PATH ?? "", HOME: root, XDG_CONFIG_HOME: join(root, "config"),
      TMPDIR: root, TMP: root, TEMP: root,
      // Preserve the runner's disabled transform cache across this env swap;
      // exceptional ESM-temp work is owned locally, not credited to W/tmp.
      JITI_FS_CACHE: "0",
      PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"), PI_OFFLINE: "1",
      SSH_AUTH_SOCK: join(root, "synthetic-public-agent.sock"),
      BRABBLER_PASSWORD: "synthetic-cold-password-not-a-credential",
      // Presence skips legacy browser-agent lookup; neither path needs to exist.
      BRABBLER_SSH_RUNTIME: join(root, "synthetic-managed-runtime"),
    };
    globalThis.fetch = async () => { fetchCalls++; throw new Error("Cold subagent fixtures must not use HTTP"); };
    await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
    await mkdir(join(agentDir, "extensions"), { mode: 0o700 });
    const fixtureExtension = join(agentDir, "extensions", "synthetic-outside-allowlist.js");
    await writeFile(fixtureExtension, `export default pi => {
      pi.registerTool({ name: "synthetic_not_in_saved_tools", label: "Synthetic forbidden tool", description: "Must stay outside the saved allowlist",
        parameters: { type: "object", properties: {} }, execute: async () => { throw new Error("Not admitted by the saved profile"); } });
    };`, { mode: 0o600 });
    await writeFile(join(agentDir, "auth.json"), "{}", { mode: 0o600 });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ cacheWarming: "off", enableInstallTelemetry: false,
      compaction: { enabled: false }, retry: { enabled: false }, defaultProvider: "synthetic-ssh-bootstrap", defaultModel: "bootstrap",
      enabledModels: ["synthetic-ssh-bootstrap/bootstrap"] }), { mode: 0o600 });
    // Startup restores a configured, synthetic model without loading a provider
    // extension. That also works when the saved profile forbids extensions.
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "synthetic-ssh-bootstrap": {
      api: "anthropic-messages", baseUrl: "https://synthetic-unused.invalid", apiKey: "synthetic-unused-key",
      models: [{ id: "bootstrap", name: "Synthetic startup only", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
    } } }), { mode: 0o600 });
    for (const loadExtensions of [false, true]) for (const tools of [["bash"], ["read"], []]) {
      await t.test(`saved tools=${JSON.stringify(tools)}, loadExtensions=${loadExtensions}`, async () => {
        try {
        const manager = SessionManager.create(cwd, join(agentDir, "child-sessions"));
        const snapshot = { version: 1, appendSystemPrompt: [profilePrompt], tools, loadSkills: false, loadExtensions,
          exactSystemPrompt: profilePrompt };
        manager.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: "synthetic-parent",
          parentSessionPath: join(agentDir, "synthetic-parent.jsonl"), parentToolCallId: "synthetic-parent-call",
          profile: "synthetic-cold-child", description: "Synthetic cold child", task: "Probe the synthetic environment",
          runInBackground: false, createdAt: new Date().toISOString(), turnLimit: 0, resourceSnapshot: snapshot });
        manager.appendModelChange("synthetic-ssh-bootstrap", "bootstrap");
        // Use the production publication helper: setup-only SDK entries do not
        // otherwise flush. No fabricated conversation or private SDK mutation.
        persistChildSession(manager);
        const id = manager.getSessionId(), file = manager.getSessionFile();
        assert.equal(rpc.getRpcSession(id), undefined);
        const first = (await native.start(rpc, id, file, undefined, { persistPreferences: false })).session;
        owned.add(first);
        await first.waitUntilReady();
        await close(first); owned.delete(first);
        assert.equal(rpc.getRpcSession(id), undefined, "no warm wrapper may satisfy the reopen");
        const { session: wrapper, realSessionId } = await native.start(rpc, id, file, undefined, { persistPreferences: false });
        owned.add(wrapper);
        const rowErrors = [];
        try {
          await wrapper.waitUntilReady();
          const inner = wrapper.inner, chatOnly = tools.length === 0 && !loadExtensions;
          assert.notEqual(wrapper, first); assert.notEqual(inner, first.inner);
          assert.equal(realSessionId, id); assert.equal(wrapper.sessionFile, file); assert.equal(wrapper.cwd, cwd);
          assert.equal(inner.model.provider, "synthetic-ssh-bootstrap");
          assert.equal(wrapper.isChatOnly(), chatOnly);
          assert.deepEqual(inner.getActiveToolNames(), tools);
          assert.ok(inner.getAllTools().every(tool => tools.includes(tool.name)), "saved SDK allowlist must not widen");
          assert.ok(!inner.getAllTools().some(tool => SUBAGENT_CONTROL_TOOL_NAMES.includes(tool.name)));
          const loaded = inner.resourceLoader.getExtensions();
          assert.deepEqual(loaded.errors, []);
          assert.equal(loaded.extensions.some(extension => extension.path === fixtureExtension), loadExtensions);
          const host = loaded.extensions.find(extension => extension.path === hostPath);
          assert.equal(Boolean(host), !chatOnly);
          if (host) assert.equal(host.tools.get("bash")?.definition.defaultActive, false);
          if (chatOnly) assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, profilePrompt);
          const resources = { ...snapshot }; delete resources.version;
          assert.deepEqual(readSubagentSessionResources(inner.sessionManager.getEntries()), resources);
          if (tools.includes("bash")) {
            // Assert production ownership BEFORE fixture model setup, so an SDK
            // built-in child-env fix cannot mask a missing host fallback.
            assert.equal(inner.getAllTools().find(tool => tool.name === "bash")?.sourceInfo?.path, hostPath);
            const faux = fauxProvider({ provider: "synthetic-ssh-faux", models: [{ id: "cold-bash" }] });
            inner.modelRuntime.registerNativeProvider(faux.provider);
            await inner.modelRuntime.refresh({ allowNetwork: false });
            await inner.setModel(faux.getModel("cold-bash"));
            const command = `printf 'sock=%s\\npassword=%s\\nruntime=%s\\n' "$SSH_AUTH_SOCK" "\${BRABBLER_PASSWORD+x}" "\${BRABBLER_SSH_RUNTIME+x}"`;
            const expected = `sock=${process.env.SSH_AUTH_SOCK}\npassword=\nruntime=`;
            let observed = 0;
            for (let round = 0; round < 2; round++) {
              const callId = `synthetic-cold-bash-${loadExtensions}-${round}`;
              faux.setResponses([
                context => {
                  assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ["bash"]);
                  assert.equal(getCurrentSystemPrompt(context.messages), profilePrompt);
                  return fauxAssistantMessage([fauxToolCall("bash", { command, timeout: 5 }, { id: callId })], { stopReason: "toolUse" });
                },
                context => {
                  const result = context.messages.find(message => message.role === "toolResult" && message.toolCallId === callId);
                  assert.ok(result, "the model must receive this round's real Bash result");
                  assert.equal(result.toolName, "bash"); assert.equal(result.isError, false);
                  assert.equal(result.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim(), expected);
                  observed++;
                  return fauxAssistantMessage("synthetic cold environment verified");
                },
              ]);
              // Unlike send(prompt)'s acceptance acknowledgement, public SDK
              // prompt resolves after the native model/tool loop has finished.
              await inner.prompt("Run the synthetic environment probe", { source: "rpc" });
              assert.equal(inner.getLastAssistantText(), "synthetic cold environment verified");
            }
            assert.equal(observed, 2); assert.equal(faux.state.callCount, 4);
            assert.deepEqual(inner.getActiveToolNames(), ["bash"]);
          }
          const persisted = SessionManager.open(file).getEntries();
          assert.deepEqual(persisted.find(entry => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE).data.resourceSnapshot, snapshot);
        } catch (error) {
          rowErrors.push(error); native.fail(error);
        } finally {
          try { await close(wrapper); owned.delete(wrapper); }
          catch (error) { rowErrors.push(error); }
        }
        if (rowErrors.length) throw new AggregateError(rowErrors, "Cold subagent row body/closure failed");
        assert.equal(rpc.getRpcSession(id), undefined);
        } catch (error) { native.fail(error); throw error; }
      });
    }
    assert.equal(fetchCalls, 0);
  } catch (error) {
    native.fail(error); throw error;
  } finally {
    await native.finish();
  }
});
