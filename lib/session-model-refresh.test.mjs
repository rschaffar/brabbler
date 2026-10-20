import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { acquireModelRuntimeUse, applySessionModelDefinition, assertModelRuntimeSessionReady,
  modelRuntimeRefreshState, registerModelRuntimeSession, withModelRuntimeAccess } = await jiti.import("./session-model-refresh.ts");
const done = () => ({ aborted: false, errors: new Map() });
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
  const original = { provider: "fixture", id: "one", baseUrl: "http://127.0.0.1:9/old" };
  let models = [original], failure, refresh = async () => done(), refreshCalls = 0;
  const runtime = { getModel: (provider, id) => models.find(m => m.provider === provider && m.id === id),
    getError: () => failure, refresh: async options => { refreshCalls++; return refresh(options); } };
  const sessions = [], releases = [];
  const member = (view = runtime, extras = {}) => {
    let busy = false, alive = true;
    const writes = [];
    const session = { modelRuntime: view, model: original, agent: { state: { thinkingLevel: "high" } },
      scopedModels: [{ model: original, thinkingLevel: "medium" }],
      async setModel(model) { session.model = model; session.agent.state.thinkingLevel = "off"; writes.push(model); },
      setThinkingLevel(level) { session.agent.state.thinkingLevel = level; },
      setScopedModels(scope) { session.scopedModels = scope; },
      async prompt() {}, async compact() {}, async executeBash() {}, async reload() {},
      async sendCustomMessage() {}, async sendUserMessage() {}, async steer() {}, async followUp() {}, async navigateTree() {},
      ...extras,
    };
    releases.push(registerModelRuntimeSession(session, () => busy, () => alive)); sessions.push(session);
    return { session, writes, busy: value => { busy = value; }, close: () => { alive = false; } };
  };
  return { runtime, member, sessions, setModels: value => { models = value; }, fail: value => { failure = value; },
    refresh: value => { refresh = value; }, calls: () => refreshCalls, dispose: () => releases.forEach(release => release()) };
}

test("unchanged reselection is a no-op; changed shared definitions retain each identity, scope pins and thinking", async t => {
  const f = fixture(); t.after(f.dispose);
  const parent = f.member();
  const child = f.member(withModelRuntimeAccess(f.runtime, new Proxy(f.runtime, {})));
  const root = parent.session.model;
  await applySessionModelDefinition(parent.session, "fixture", "one");
  assert.equal(parent.session.model, root); assert.equal(parent.writes.length, 0); assert.equal(child.writes.length, 0);
  const edited = { ...root, baseUrl: "http://127.0.0.1:9/new", compat: { forceAdaptiveThinking: false } };
  f.setModels([edited]);
  await applySessionModelDefinition(parent.session, "fixture", "one");
  for (const { session, writes } of [parent, child]) {
    assert.equal(session.model, edited); assert.equal(writes.length, 1);
    assert.equal(session.agent.state.thinkingLevel, "high");
    assert.equal(session.scopedModels[0].model, edited); assert.equal(session.scopedModels[0].thinkingLevel, "medium");
  }
});

test("busy sharing members, construction/title leases and native background refresh exclude reselection before SDK mutation", async t => {
  const f = fixture(); t.after(f.dispose);
  const parent = f.member(), child = f.member(withModelRuntimeAccess(f.runtime, new Proxy(f.runtime, {})));
  child.busy(true);
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /sharing this runtime is busy/);
  child.busy(false);
  const release = acquireModelRuntimeUse(child.session.modelRuntime);
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /busy/);
  release(); assert.equal(f.calls(), 0);
  const held = gate(); f.refresh(() => held.promise);
  const background = f.runtime.refresh({ allowNetwork: false });
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /busy/);
  held.resolve(done()); await background;
});

test("refresh excludes competing SDK effects and callers, then resumes after real settlement", async t => {
  const f = fixture(); t.after(f.dispose);
  const parent = f.member(), child = f.member(); const held = gate();
  f.refresh(options => { assert.equal(options.allowNetwork, false); assert.deepEqual(options.providers, ["fixture"]); return held.promise; });
  const applying = applySessionModelDefinition(parent.session, "fixture", "one");
  for (const method of ["prompt", "compact", "executeBash", "reload", "sendCustomMessage", "sendUserMessage", "setModel", "navigateTree", "steer", "followUp"]) {
    await assert.rejects(child.session[method]({}), /being applied/);
  }
  await assert.rejects(applySessionModelDefinition(child.session, "fixture", "one"), /busy/);
  assert.throws(() => acquireModelRuntimeUse(f.runtime), /being applied/);
  held.resolve(done()); await applying;
  await child.session.prompt("allowed"); assert.doesNotThrow(() => assertModelRuntimeSessionReady(parent.session));
});

test("timeout does not release an ignored refresh or permit late rebind; explicit repair is required", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); t.after(f.dispose);
  const parent = f.member(), held = gate(); f.refresh(() => held.promise);
  f.setModels([{ ...parent.session.model, baseUrl: "http://127.0.0.1:9/late" }]);
  const applying = applySessionModelDefinition(parent.session, "fixture", "one");
  const rejected = assert.rejects(applying, /timed out/);
  t.mock.timers.tick(15_000); await rejected;
  assert.equal(modelRuntimeRefreshState(f.runtime).refreshing, true);
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /busy/);
  held.resolve(done()); await new Promise(setImmediate);
  assert.equal(parent.writes.length, 0); assert.equal(modelRuntimeRefreshState(f.runtime).refreshing, false);
  await assert.rejects(parent.session.prompt(), /could not be applied/);
  f.refresh(async () => done());
  await applySessionModelDefinition(parent.session, "fixture", "one");
  assert.equal(parent.writes.length, 1); await parent.session.prompt();
});

test("configuration, provider and missing-model errors fail closed without leaking underlying errors", async t => {
  const f = fixture(); t.after(f.dispose); const parent = f.member();
  for (const fail of [
    () => f.fail("private provider error sentinel"),
    () => { f.fail(undefined); f.refresh(async () => ({ aborted: false, errors: new Map([["fixture", new Error("private provider error sentinel")]]) })); },
    () => f.refresh(async () => { throw new Error("private provider error sentinel"); }),
  ]) {
    fail();
    await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), error => /could not be applied/.test(error.message) && !/sentinel/.test(error.message));
    await assert.rejects(parent.session.compact(), /could not be applied/);
  }
  f.refresh(async () => done());
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "absent"), /Model not found/);
  await applySessionModelDefinition(parent.session, "fixture", "one");
  assert.equal(modelRuntimeRefreshState(f.runtime).error, undefined);
});

test("removed sibling selections require their own explicit repair without changing provider identity", async t => {
  const f = fixture(); t.after(f.dispose); const parent = f.member(), child = f.member();
  child.session.model = { provider: "fixture", id: "removed" };
  await applySessionModelDefinition(parent.session, "fixture", "one");
  await assert.rejects(child.session.prompt(), /model was removed/);
  assert.equal(child.session.model.id, "removed");
  await applySessionModelDefinition(child.session, "fixture", "one");
  await child.session.prompt();
});

test("repair reconciles all providers and unrelated selections do not clear removed-model blocks", async t => {
  const f = fixture(); t.after(f.dispose);
  const parent = f.member(), child = f.member();
  const old = child.session.model;
  const edited = { ...old, baseUrl: "http://127.0.0.1:9/repaired" };
  const other = { provider: "other", id: "two" };
  f.setModels([edited, other]);
  f.refresh(async () => { throw new Error("synthetic refresh failure"); });
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /could not be applied/);
  f.refresh(async options => { assert.equal(options.providers, undefined, "repair must rebuild every provider, including stale global composition errors"); return done(); });
  await applySessionModelDefinition(parent.session, "other", "two");
  assert.equal(child.session.model, edited); assert.equal(parent.session.model, other);
  parent.session.scopedModels[0].model = old;
  f.refresh(async () => done());
  await applySessionModelDefinition(child.session, "fixture", "one");
  assert.equal(parent.session.scopedModels[0].model, edited, "a different current provider must not leave stale scope objects");
  child.session.model = { provider: "fixture", id: "removed" };
  f.refresh(async () => done());
  await applySessionModelDefinition(parent.session, "fixture", "one");
  await assert.rejects(child.session.prompt(), /model was removed/);
  await applySessionModelDefinition(parent.session, "other", "two");
  await assert.rejects(child.session.prompt(), /model was removed/);
});

test("public extension tool-context and registry effects share admission, including retained nonconfigurable contexts", async t => {
  const f = fixture(); t.after(f.dispose); const execution = gate();
  const tools = { setActiveTools() {}, refreshTools() {} };
  const context = {};
  Object.defineProperty(context, "executeTool", { value: async () => execution.promise, enumerable: false });
  const parent = f.member(f.runtime, { extensionRunner: { createToolContext: () => context }, resourceLoader: { getExtensions: () => ({ runtime: tools }) } });
  const retained = parent.session.extensionRunner.createToolContext();
  const held = gate(); f.refresh(() => held.promise);
  const applying = applySessionModelDefinition(parent.session, "fixture", "one");
  assert.throws(() => tools.setActiveTools([]), /being applied/);
  assert.throws(() => tools.refreshTools(), /being applied/);
  await assert.rejects(retained.executeTool("read", {}), /being applied/);
  held.resolve(done()); await applying;
  const nested = retained.executeTool("read", {});
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /busy/);
  execution.resolve({ content: [] }); await nested;
  await applySessionModelDefinition(parent.session, "fixture", "one");
});

test("reload guards replacement tool contexts before session_start and retains the caller's callback", async t => {
  const f = fixture(); t.after(f.dispose); const execution = gate(); let retained, beforeCalled = false;
  const tools = { setActiveTools() {}, refreshTools() {} };
  const makeRunner = () => ({ createToolContext() {
    const context = {};
    Object.defineProperty(context, "executeTool", { value: async () => execution.promise });
    return context;
  } });
  const parent = f.member(f.runtime, { extensionRunner: makeRunner(), resourceLoader: { getExtensions: () => ({ runtime: tools }) },
    async reload(options) {
      this.extensionRunner = makeRunner();
      tools.setActiveTools = () => {}; tools.refreshTools = () => {};
      await options.beforeSessionStart?.();
      retained = this.extensionRunner.createToolContext(); // captured by session_start
    },
  });
  await parent.session.reload({ beforeSessionStart() { beforeCalled = true; } });
  assert.equal(beforeCalled, true);
  const held = gate(); f.refresh(() => held.promise);
  const applying = applySessionModelDefinition(parent.session, "fixture", "one");
  await assert.rejects(retained.executeTool("read", {}), /being applied/);
  held.resolve(done()); await applying;
  const nested = retained.executeTool("read", {});
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /busy/);
  execution.resolve({}); await nested;
});

test("cross-model model_select may configure tools synchronously but cannot inject a run during rebind", async t => {
  const f = fixture(); t.after(f.dispose); let toolChanges = 0;
  const tools = { setActiveTools() { toolChanges++; }, refreshTools() { toolChanges++; } };
  const parent = f.member(f.runtime, { resourceLoader: { getExtensions: () => ({ runtime: tools }) }, async setModel(model) {
    tools.setActiveTools(["read"]); tools.refreshTools();
    await assert.rejects(this.prompt("not admitted"), /being applied/);
    this.model = model; this.agent.state.thinkingLevel = "off";
  } });
  f.setModels([{ provider: "fixture", id: "two" }]);
  await applySessionModelDefinition(parent.session, "fixture", "two");
  assert.equal(toolChanges, 2); assert.equal(parent.session.model.id, "two");
  assert.equal(parent.session.agent.state.thinkingLevel, "off", "different model retains native switch policy");
});

test("a never-UI-bound Chat-only survivor can repair its failed runtime after the original member retires", async () => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  let fail = true, bindingCalls = 0;
  const model = { provider: "fixture", id: "one" };
  const runtime = { getModel: () => model, getError: () => undefined, refresh: async () => { if (fail) throw new Error("synthetic failure"); return done(); } };
  const make = id => {
    const inner = { sessionId: id, model, modelRuntime: runtime, agent: { state: { thinkingLevel: "high" } },
      sessionManager: { getSessionFile: () => undefined }, isStreaming: false, isCompacting: false, isBashRunning: false,
      extensionRunner: { emit: async () => {} }, async bindExtensions() { bindingCalls++; },
      async setModel(next) { inner.model = next; }, setThinkingLevel() {}, dispose() {},
    };
    return new AgentSessionWrapper(inner, { chatOnly: true });
  };
  const parent = make("chat-only-original"), survivor = make("chat-only-survivor");
  try {
    await assert.rejects(parent.send({ type: "set_model", provider: "fixture", modelId: "one" }), /could not be applied/);
    await parent.shutdown(); fail = false;
    assert.deepEqual(await survivor.send({ type: "set_model", provider: "fixture", modelId: "one" }), { provider: "fixture", id: "one" });
    assert.equal(bindingCalls, 0); assert.equal(modelRuntimeRefreshState(runtime).error, undefined);
  } finally { await parent.shutdown(); await survivor.shutdown(); }
});

test("ordinary shutdown/disposal waits for native model binding settlement before deletion can continue", async () => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const held = gate(), entered = gate(); let disposed = 0, writes = 0;
  const edited = { provider: "fixture", id: "one", baseUrl: "http://127.0.0.1:9/new" };
  const inner = { sessionId: "definition-retirement-fixture", isStreaming: false, isCompacting: false, isBashRunning: false,
    model: { provider: "fixture", id: "one" }, agent: { state: { thinkingLevel: "high" } },
    modelRuntime: { refresh: async () => done(), getError: () => undefined, getModel: () => edited },
    extensionRunner: { emit: async () => {} },
    async setModel(model) { entered.resolve(); await held.promise; inner.model = model; writes++; },
    setThinkingLevel() {}, dispose() { disposed++; },
  };
  const wrapper = new AgentSessionWrapper(inner, { chatOnly: true });
  await wrapper.waitUntilReady();
  const applying = applySessionModelDefinition(inner, "fixture", "one");
  const refused = assert.rejects(applying, /could not be applied/);
  await entered.promise;
  const shutdown = wrapper.shutdown();
  assert.equal(disposed, 0); assert.equal(writes, 0);
  await assert.rejects(wrapper.send({ type: "prompt", message: "not while retiring" }), /shutting down/);
  held.resolve(); await refused; await shutdown;
  assert.equal(writes, 1); assert.equal(disposed, 1); assert.equal(wrapper.isAlive(), false);
});

test("auxiliary streams hold runtime use until their result settles, not just until stream creation", async t => {
  const f = fixture(); t.after(f.dispose); const held = gate();
  f.runtime.streamSimple = () => ({ result: () => held.promise });
  const view = withModelRuntimeAccess(f.runtime, new Proxy(f.runtime, {}));
  const parent = f.member(view); view.streamSimple();
  await assert.rejects(applySessionModelDefinition(parent.session, "fixture", "one"), /busy/);
  held.resolve({}); await new Promise(setImmediate);
  await applySessionModelDefinition(parent.session, "fixture", "one");
});
