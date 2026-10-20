import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("useAgentSession.ts", readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleModelChange") return node.initializer.arguments[0];
  return ts.forEachChild(node, find);
}
const script = new Script(ts.transpileModule(find(source).getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ isNew = false, sid = "one", creation = null, send = async () => ({ provider: "fixture", id: "new" }) } = {}) {
  const calls = [], values = {};
  const set = key => value => { values[key] = value; calls.push([key, value]); };
  const context = {
    isNew, currentModelOverride: null,
    sessionHookMountedRef: { current: true }, sessionIdRef: { current: sid }, modelSelectionVersionRef: { current: 0 },
    modelSwitchPendingRef: { current: false }, modelSpeedRevisionRef: { current: 0 },
    loadModelsRef: { current: async () => { calls.push(["loadModels"]); } },
    newSessionModelOverrideRef: { current: null }, thinkingLevelOverrideRef: { current: null },
    thinkingLevelPinsRef: { current: {} }, defaultThinkingLevelRef: { current: "medium" }, ensuringNewSessionRef: { current: creation },
    setModelSwitching: set("switching"), setNewSessionModel: set("newModel"), setPendingModel: set("pending"),
    setNewSessionDefaultThinkingLevel: set("defaultThinking"), setNewSessionThinkingLevel: set("thinking"),
    setModelDefinitionError: set("definitionError"), setLiveModel: set("liveModel"), setCurrentModelOverride: set("override"),
    asConcreteThinkingLevel: value => value ?? null,
    syncLiveModel: (state, revision) => calls.push(["liveState", state, revision]),
    loadSession: async (...args) => { calls.push(["loadSession", ...args]); },
    sendAgentCommand: async (id, command) => { calls.push(["command", id, command.type, command.modelId]); return send(id, command); },
    addNotice: notice => calls.push(["notice", notice.message]), console: { error() {} },
  };
  return { context, calls, values, change: script.runInNewContext(context) };
}

test("pending composer creation serializes before optimistic selection so the second click cannot silently replace the displayed choice", async () => {
  const created = gate();
  const f = fixture({ isNew: true, sid: null, creation: created.promise, send: async (_sid, command) => command.type === "get_state"
    ? { model: { provider: "fixture", id: "A" }, thinkingLevel: "off" } : { provider: "fixture", id: "A" } });
  const first = f.change("fixture", "A");
  await f.change("fixture", "B");
  assert.equal(f.values.newModel.modelId, "A"); assert.equal(f.values.switching, true);
  f.context.sessionIdRef.current = "warmed"; created.resolve("warmed"); await first;
  assert.deepEqual(f.calls.filter(c => c[0] === "command").map(c => c.slice(2)), [["set_model", "A"], ["get_state", undefined]]);
  assert.equal(f.values.newModel.modelId, "A"); assert.equal(f.values.defaultThinking, "off"); assert.equal(f.values.switching, false);
});

test("warmed new composers reconcile canonical model/thinking after a lost selection acknowledgement", async () => {
  const f = fixture({ isNew: true, sid: "warmed", send: async (_sid, command) => {
    if (command.type === "set_model") throw new Error("synthetic lost acknowledgement");
    return { model: { provider: "fixture", id: "actually-saved" }, thinkingLevel: "off" };
  } });
  f.context.thinkingLevelOverrideRef.current = "high";
  await f.change("fixture", "requested");
  assert.equal(f.values.newModel.modelId, "actually-saved"); assert.equal(f.context.newSessionModelOverrideRef.current.modelId, "actually-saved");
  assert.equal(f.values.thinking, "off"); assert.equal(f.context.thinkingLevelOverrideRef.current, "off");
  assert.ok(f.calls.some(c => c[0] === "notice" && /lost acknowledgement/.test(c[1])));
  assert.ok(f.calls.some(c => c[0] === "loadModels"));
  assert.equal(f.values.switching, false);
});

test("successful existing-session reselection requests canonical disk and live state for context limits and clamped thinking", async () => {
  const f = fixture(); await f.change("fixture", "new");
  const read = f.calls.find(c => c[0] === "loadSession");
  assert.deepEqual(read.slice(0, 4), ["loadSession", "one", false, true]); assert.equal(read[4].fresh, true);
  assert.ok(f.calls.some(c => c[0] === "loadModels"));
  assert.equal(f.values.liveModel.modelId, "new"); assert.equal(f.values.switching, false);
});

test("existing-session lost acknowledgement also reconciles canonical disk and live state", async () => {
  const f = fixture({ send: async () => { throw new Error("synthetic lost acknowledgement"); } });
  await f.change("fixture", "new");
  const read = f.calls.find(c => c[0] === "loadSession");
  assert.deepEqual(read.slice(0, 4), ["loadSession", "one", false, true]); assert.equal(read[4].fresh, true);
  assert.ok(f.calls.some(c => c[0] === "notice")); assert.ok(f.calls.some(c => c[0] === "loadModels"));
  assert.equal(f.values.switching, false);
});

test("actual canonical loader bypasses old coalesced reads without extra disk probes and ignores a pre-selection disk-only response", async () => {
  function findLoad(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadSession") return node.initializer.arguments[0];
    return ts.forEachChild(node, findLoad);
  }
  const loader = new Script(ts.transpileModule(findLoad(source).getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);
  const held = gate(), writes = [], requests = [];
  const snapshot = id => ({ sessionId: "one", leafId: id, tree: [], stats: {}, snapshotRevision: id,
    context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false, thinkingLevel: "off", model: { provider: "fixture", modelId: id } } });
  let diskReads = 0;
  const context = {
    URLSearchParams, console, sessionIdRef: { current: "one" }, modelSelectionVersionRef: { current: 0 },
    modelSpeedRevisionRef: { current: 0 }, modelSpeedChangingRef: { current: false }, modelSpeedRef: { current: "standard" },
    activeLeafIdRef: { current: null }, branchViewRevisionRef: { current: 0 }, dataRef: { current: null },
    messagesRef: { current: [] }, entryIdsRef: { current: [] }, historyCursorRef: { current: null }, hasEarlierMessagesRef: { current: false },
    modelSwitchPendingRef: { current: false }, pendingHistoryReadsRef: { current: 0 }, loadFlightsRef: { current: new Map() },
    sessionToolsPinnedRef: { current: false }, eventConnectionRef: { current: null },
    getSessionViewSnapshot: () => undefined, deleteSessionViewSnapshot() {}, setSessionViewSnapshot() {},
    receiptBranchContains: () => false, alignEntryIds: () => [], CONFIGURED_TOOL_PRESET: "configured",
    getPresetFromToolNames: () => "configured", isModelSpeed: value => value === "standard" || value === "fast",
    syncLiveModel: state => writes.push(["live", state]), setTranscript: update => update({ messages: [], entryIds: [] }),
    fetch: async url => {
      requests.push(url);
      if (url.endsWith("/state")) return Response.json({ running: true, state: { thinkingLevel: "off", contextUsage: { contextWindow: 256000 } } });
      if (++diskReads === 1) { await held.promise; return Response.json(snapshot("stale")); }
      return Response.json(snapshot("fresh"));
    },
  };
  for (const name of ["Data", "ActiveLeafId", "Messages", "EntryIds", "HistoryCursor", "HasEarlierMessages", "PossibleInterruptedRun", "Error", "Loading",
    "ModelSpeed", "ToolPresetState", "CurrentModelOverride", "CurrentThinkingOverride", "LiveThinkingLevel", "SessionStatsOverride", "ContextUsage", "SystemPrompt",
    "ExtensionStatuses", "ExtensionWidgets", "QueuedMessages", "AutoCompactionEnabled"]) context[`set${name}`] = value => writes.push([name, value]);
  const load = loader.runInNewContext(context);
  const stale = load("one", false, false);
  context.modelSelectionVersionRef.current++;
  await load("one", false, true, { fresh: true });
  assert.equal(diskReads, 2); assert.equal(requests.some(url => url.includes("force=1")), false);
  assert.ok(writes.some(([name, value]) => name === "live" && value.thinkingLevel === "off"));
  assert.ok(writes.some(([name, value]) => name === "ContextUsage" && value.contextWindow === 256000));
  const before = writes.length; held.resolve(); assert.equal(await stale, "superseded");
  assert.equal(writes.length, before); assert.equal(context.dataRef.current.context.model.modelId, "fresh");
  assert.equal(context.pendingHistoryReadsRef.current, 0);
});

for (const outcome of ["success", "failure"]) test(`late ${outcome} cannot mutate a different session or clear its pending switch`, async () => {
  const held = gate();
  const f = fixture({ send: async () => { await held.promise; if (outcome === "failure") throw new Error("old failure"); return { provider: "fixture", id: "old" }; } });
  const changing = f.change("fixture", "old");
  f.context.sessionIdRef.current = "different"; f.context.modelSelectionVersionRef.current++;
  const before = f.calls.length;
  held.resolve(); await changing;
  assert.equal(f.calls.length, before);
});

test("unmounted pending composer creation never dispatches a selection or publishes late UI state", async () => {
  const held = gate(); const f = fixture({ isNew: true, sid: null, creation: held.promise });
  const changing = f.change("fixture", "A");
  f.context.sessionHookMountedRef.current = false;
  const before = f.calls.length; held.resolve("warmed"); await changing;
  assert.equal(f.calls.length, before); assert.equal(f.calls.filter(c => c[0] === "command").length, 0);
});
