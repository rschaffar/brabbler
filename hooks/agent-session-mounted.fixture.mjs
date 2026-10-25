// SOURCE-ONLY UNION, UNEXECUTED. See packet REPORT.md before adopting.
// This fixture exposes the same production hook/I18n seam as
// new-session-persistence.test.mjs. It supplies transport, not hook policy.
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { mount } from "../lib/testing/react.fixture.mjs";
import { createTaskOwner, deferred } from "../lib/testing/async.fixture.mjs";

// No production hook/component import at module evaluation. One cached loader
// graph is initialized only after each fixture registers cleanup and guards.
let productionGraph;
function loadProductionGraph() {
  if (!productionGraph) productionGraph = (async () => {
    const jiti = createJiti(import.meta.url, {
      jsx: { runtime: "automatic" }, tsconfigPaths: true, fsCache: false,
      alias: { './ChatMinimap.module.css': fileURLToPath(new URL('../components/chat-minimap-style.fixture.mjs', import.meta.url)),
        [fileURLToPath(new URL('../components/ChatMinimap.module.css', import.meta.url))]: fileURLToPath(new URL('../components/chat-minimap-style.fixture.mjs', import.meta.url)) },
    });
    const { useAgentSession } = await jiti.import("./useAgentSession.ts");
    const { I18nProvider } = await jiti.import("./useI18n.tsx");
    const drafts = await jiti.import("../lib/draft-store.ts");
    const receipts = await jiti.import("../lib/interaction-receipts.ts");
    const operations = await jiti.import("../lib/operation-receipts.ts");
    const questionDrafts = await jiti.import("../lib/question-set-drafts.ts");
    const { AgentEventConnection } = await jiti.import("../lib/agent-event-connection.ts");
    return { useAgentSession, I18nProvider, AgentEventConnection, ...drafts, receipts, operations, questionDrafts,
      loadComposer: () => jiti.import("../components/ChatInput.tsx"),
      loadQuestionSet: () => jiti.import("../components/QuestionSetDialog.tsx"),
      loadNativeControl: () => jiti.import("../components/session-tools-session.fixture.tsx"),
      loadDefault: () => jiti.import("../components/ChatWindow.tsx") };
  })();
  return productionGraph;
}
const ORIGIN = "https://fixture.invalid";

// Bounded DISPLAY only; failure ledgers retain original objects/cause graphs.
// Do not pass retained graphs to diagnostic inspection or replace them with text.
function scalar(value, depth = 0) {
  try {
    if (value === null || typeof value !== "object") return String(value).slice(0, 6000);
    if (typeof value.nodeType === "number") return `${value.nodeName ?? "DOM"}#${value.id ?? ""} ${String(value.textContent ?? "").slice(0, 160)}`;
    if (typeof value.message === "string") {
      const children = depth < 2 && Array.isArray(value.errors) ? value.errors.slice(0, 10).map(error => scalar(error, depth + 1)).join(" | ") : "";
      const cause = depth < 2 && value.cause !== undefined ? ` cause: ${scalar(value.cause, depth + 1)}` : "";
      return `${value.name ?? "Error"}: ${value.message}\n${typeof value.stack === "string" ? value.stack.slice(0, 6000) : ""}${children}${cause}`;
    }
    return Object.prototype.toString.call(value);
  } catch { return "<unprintable diagnostic>"; }
}
let sequence = 0;
export const provider = "mounted-fixture";
export const selected = modelId => ({ provider, modelId });
export const storageKey = key => `pi-web:composer-draft:v1:${key}`;
export const command = type => request => request.method === "POST" && request.body?.type === type;
export const detail = request => request.method === "GET" && /^\/api\/sessions\/[^/]+$/.test(request.path);
export const models = request => request.path === "/api/models";

function Probe({ subject, options, capture, composer, ownComposer, composerRef, viewport, questionSet, observeSubmission, NativeControl, ownControl, nativePeer, modelControls }) {
  const { useAgentSession } = subject;
  const value = useAgentSession(options);
  capture(value);
  const output = createElement("output", { "data-testid": "session-probe" }, JSON.stringify({
    model: value.displayModel, thinking: value.thinkingLevel,
    switching: value.modelSwitching, error: value.error, running: value.agentRunning,
  }));
  if (questionSet) return createElement('div', null, output,
    value.extensionDialog?.method === 'ask_user_batch' && createElement(questionSet, {
      key: value.extensionDialog.id, request: value.extensionDialog,
      sessionId: options.session?.id ?? '', onRespond: value.respondToExtensionUi,
      onSubmissionWork: observeSubmission,
    }));
  if (NativeControl) {
    const control = createElement(NativeControl, { value, options, onWork: ownControl });
    if (nativePeer) return createElement("div", null, output, control,
      createElement("div", { "data-native-peer": nativePeer.options.session.id },
        createElement(Probe, { subject, options: nativePeer.options, capture: nativePeer.capture })));
    return viewport
      ? createElement("div", { ref: value.scrollContainerRef, "data-testid": "hook-viewport" }, output, control)
      : createElement("div", null, output, control);
  }
  if (!composer) return viewport
    ? createElement("div", { ref: value.scrollContainerRef, "data-testid": "hook-viewport" }, output)
    : output;
  return createElement("div", null, output, createElement(composer, {
    ref: composerRef, cwd: null, compact: false, isStreaming: value.agentRunning,
    // Sparse actual hook -> actual ChatInput composition. This is deliberately
    // not AppShell/ChatWindow navigation and supplies no native authority.
    ...(modelControls ? {
      model: value.displayModel, modelNames: value.modelNames, modelList: value.modelList,
      modelError: value.modelError, modelScopeWarnings: value.modelScopeWarnings,
      modelSwitching: value.modelSwitching, isAutoModelSelection: value.isAutoModelSelection,
      onModelChange: (provider, modelId) => ownControl("actual model control", value.handleModelChange(provider, modelId)),
      thinkingLevel: value.thinkingLevel, isAutoThinkingSelection: value.isAutoThinkingSelection,
      onThinkingLevelChange: level => ownControl("actual thinking control", value.handleThinkingLevelChange(level)),
      modelSpeed: value.modelSpeed, modelSpeedChanging: value.modelSpeedChanging,
      onModelSpeedChange: speed => ownControl("actual speed control", value.handleModelSpeedChange(speed)),
    } : {}),
    isCompacting: value.isCompacting, compactError: value.compactError, compactResult: value.compactResult,
    onSend: text => ownComposer("composer Send", value.handleSend(text)), onAbort: value.handleAbort,
    onCompact: () => ownComposer("composer Compact", value.handleCompact()),
    onBuiltinCommand: text => ownComposer("composer builtin including hook finally", value.handleBuiltinSlashCommand(text)),
  }));
}

// Finite caller port: receive the real onSessionCreated argument as public
// props without changing Probe's key/fiber. This is NOT AppShell/navigation.
// Ordinary callers retain the original Probe tree and all lifetime machinery.
function CreatedSessionReceiver(props) {
  const [received, setReceived] = useState(null);
  const original = props.options;
  const options = received
    ? { ...original, session: received, newSessionCwd: null, newSessionDraftKey: null }
    : original;
  return createElement(Probe, { ...props, options: { ...options,
    onSessionCreated(session, sourceDraftKey) {
      original.onSessionCreated?.(session, sourceDraftKey);
      setReceived(session);
    },
  } });
}

export async function sessionFixture(t, { preset = "configured", policyTime = null, composer = false, mobile = false, viewport = false,
  questionSets = false, nativeControl = false, nativeMetadata, nativeDefault, nativePeerSessionId = null, modelControls = false,
  fixtureProvider = provider, modelIds = ["A", "B", "canonical", "old"], modelRefs = null, savedSessionId = null, fixtureCwd = null,
  observeProduction = null, ownGraceTimers = false, defaultChat = false, receiveCreatedSession = false, clipboard = null,
  numeric = { height: 2000, client: 600 },
} = {}) {
  // Transport vocabulary only: preserve legacy literal identities without copying hook policy.
  const provider = fixtureProvider;
  const selected = (modelId, owner = provider) => ({ provider: owner, modelId });
  const id = `mounted-draft-${++sequence}`;
  const cwd = fixtureCwd ?? `/synthetic/${id}`;
  const draftKey = `new:${id}:${cwd}`, savedId = savedSessionId ?? `${id}-saved`;
  const requests = [], sources = [], failures = [], promotions = [], rekeys = [], restores = [];
  const observedFrames = [], scrollCalls = [];
  let frameWitness;
  const publicOwner = createTaskOwner(), transportOwner = createTaskOwner();
  const rules = [], requestWaiters = [], sourceWaiters = [], sessions = new Map();
  // A navigation key owns a distinct hook/ledger. Keep the actual completion
  // handles captured before React unmounts an outgoing incarnation.
  const maintenanceHandles = new Map();
  const composerHandles = new Set(), intersections = new Set();
  const defaultOwners = new Set(), viewWorks = [], viewPending = new Set(), pendingTransports = new Set();
  let observationVersion = 0, composerCurrent = null;
  // A real React object-ref assignment captures even a mount that later fails.
  const composerRef = {
    get current() { return composerCurrent; },
    set current(value) {
      composerCurrent = value;
      if ((defaultChat || modelControls) && value && !composerHandles.has(value.whenSettled)) {
        composerHandles.add(value.whenSettled); observationVersion++;
      }
    },
  };
  const defaultObserver = {
    owners(owners) {
      if (!defaultOwners.has(owners)) { defaultOwners.add(owners); observationVersion++; }
      maintenanceHandles.set(incarnation, owners.whenMaintenanceSettled);
    },
    started(name, promise) {
      const entry = { name, promise, settled: null };
      viewWorks.push(entry); observationVersion++;
      entry.settled = promise.then(
        () => { viewPending.delete(entry.settled); },
        error => { rememberFailure(new Error(`Observed full view work ${name}: ${scalar(error)}`, { cause: error })); viewPending.delete(entry.settled); },
      );
      viewPending.add(entry.settled);
    },
  };
  // Same existing default view ledger/joins; no new lifetime or dispatcher.
  function observeDefaultCopy(observation) {
    if (observation.kind !== 'started') return;
    const entry = { name: 'tool-copy', promise: observation.work, observation, finished: false, error: undefined, settled: null };
    viewWorks.push(entry); observationVersion++;
    entry.settled = observation.work.then(() => {
      entry.finished = true; viewPending.delete(entry.settled);
    }, error => {
      entry.finished = true; entry.error = error;
      rememberFailure(error); // SAME unknown original outer-handler error, never a transport ACK.
      viewPending.delete(entry.settled);
    });
    viewPending.add(entry.settled);
  }
  let DefaultChat, realmWindow;
  let Composer, QuestionSet, NativeControl, composerOperation, mountedOptions, leafChange;
  const controlWorks = [];
  const submissionWorks = [], submissionWaiters = [];
  const observeSubmission = work => {
    const entry = { promise: publicOwner.track('complete question-set send/catch/finally', work) };
    submissionWorks.push(entry);
    for (const waiter of submissionWaiters.splice(0)) waiter.resolve(entry);
  };
  let view, current, nativePeerCurrent, subject, incarnation = 0, systemLoader, stopping = false, transportClosed = false, importing = true;
  let catalogDefault = "B", catalogThinking = "medium", pins = { [`${provider}/B`]: "high" };
  const restorations = [], listenerRemovals = [], expectedConsole = [], consoleEvents = [], lateTransports = new Set();
  const observationFinalizers = [];
  const connections = new Set(), connectionWaits = new Set();
  let cleanupStarted = false, explicitUnmount = false;
  const knownSessions = new Set([savedId]);
  let consoleDepth = 0;
  const getDraft = (...args) => subject.getDraft(...args);
  const setDraft = (...args) => subject.setDraft(...args);
  const rekeyDraft = (...args) => subject.rekeyDraft(...args);
  const restoreDraftSubmission = (...args) => subject.restoreDraftSubmission(...args);

  const rememberFailure = error => { failures.push(error); };
  // Opt-in ownership ONLY of handles directly reported by the three actual
  // grace assignments. No global timer port, callback wrapper or delay promise.
  const graceTimers = new Set();
  const nativeGraceClear = ownGraceTimers ? globalThis.clearTimeout : null;
  let graceTimersClosing = false;
  const clearObservedGraceTimer = handle => {
    try {
      Reflect.apply(nativeGraceClear, globalThis, [handle]);
      graceTimers.delete(handle); // native clear ACK only, never a body join
    } catch (error) { rememberFailure(new Error("Grace timer clear failed", { cause: error })); }
  };
  const observeGraceTimer = handle => {
    try {
      graceTimers.add(handle);
      if (graceTimersClosing) clearObservedGraceTimer(handle);
    } catch (error) { rememberFailure(new Error("Grace timer collector failed", { cause: error })); }
  };
  const closeObservedGraceTimers = () => {
    if (!ownGraceTimers) return;
    graceTimersClosing = true;
    for (const handle of graceTimers) clearObservedGraceTimer(handle);
  };
  const install = (target, name, value, last = false, phase = "host") => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    // Register restoration BEFORE attempting installation, so partial setup is owned.
    restorations.push({ target, name, descriptor, last, phase });
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
  };
  const installRealm = (target, name, value, last = false) => install(target, name, value, last, "realm");
  const replace = (name, value) => install(globalThis, name, value);
  const listen = (target, name, listener, node = false) => {
    listenerRemovals.push(() => node ? target.off(name, listener) : target.removeEventListener(name, listener));
    if (node) target.on(name, listener); else target.addEventListener(name, listener);
  };
  function guardConsole(target, phase = "host") {
    for (const level of ["error", "warn"]) {
      const original = target[level];
      install(target, level, function (...args) {
        if (consoleDepth === 0) {
          const event = { level, args: args.map(value => scalar(value)) };
          consoleEvents.push(event);
          let expected;
          try { expected = expectedConsole.find(item => !item.used && level === "error" && item.match(args)); }
          catch (error) { rememberFailure(error); }
          if (expected) expected.used = true;
          else rememberFailure(new Error(`Unexpected console.${level}: ${event.args.join(" ")}`, { cause: args }));
        }
        // Never suppress feedback; forward same severity/count with scalar diagnostics.
        consoleDepth++;
        try { return Reflect.apply(original, target, args.map(value => scalar(value))); }
        finally { consoleDepth--; }
      }, true, phase);
    }
  }
  function unsupported(kind, realm) {
    return function forbiddenTransport() {
      // Record both constructor and accidental function-call admission; do not
      // rely on a class-call TypeError that production could catch unnoticed.
      const error = new Error(`Unsupported ${realm} ${kind} admission${importing ? " during production import" : ""}`);
      rememberFailure(error);
      throw error;
    };
  }
  // Expected transport errors remain production input. Track their settlement,
  // not a second failing assertion; unexpected admission is recorded separately.
  const io = (label, promise) => {
    const settled = Promise.resolve(promise).then(() => {}, () => {});
    if (defaultChat) {
      observationVersion++; pendingTransports.add(settled);
      void settled.then(() => pendingTransports.delete(settled));
    }
    if (transportClosed) {
      rememberFailure(new Error(`Transport admitted after owned join: ${label}`));
      lateTransports.add(settled);
      void settled.then(() => lateTransports.delete(settled));
    } else transportOwner.track(label, settled);
    return promise;
  };
  const record = sid => {
    if (!sessions.has(sid)) sessions.set(sid, { model: "B", thinking: "off", window: 128000, revision: 0,
      speed: "standard", running: false, compacting: false, leaf: null, messages: [], entryIds: [], tree: [] });
    return sessions.get(sid);
  };
  const snapshot = (sid, overrides = {}) => {
    const row = record(sid);
    return {
      sessionId: sid, filePath: "", totalActiveMs: 0, tree: row.tree, leafId: row.leaf,
      modelSpeed: row.speed, snapshotRevision: `${id}:${sid}:${row.revision}`,
      ...(Object.hasOwn(row, "toolNames") ? { toolNames: row.toolNames } : {}),
      ...(Object.hasOwn(row, "nativeResources") ? { nativeResources: row.nativeResources } : {}),
      context: { messages: row.messages, entryIds: row.entryIds, oldestEntryId: row.entryIds[0] ?? null, hasMore: false,
        model: row.model ? selected(row.model, row.provider ?? provider) : null, thinkingLevel: row.thinking },
      ...overrides,
    };
  };
  const live = sid => {
    const row = record(sid);
    return { model: row.model ? { provider: row.provider ?? provider, id: row.model } : undefined, thinkingLevel: row.thinking, modelSpeed: row.speed, isCompacting: row.compacting,
      contextUsage: { contextWindow: row.window, percent: 0, tokens: 0 },
      systemPrompt: `system:${sid}`, nativeResources: row.nativeResources ?? { version: 1, codeMode: false, mcpServers: [] },
      isStreaming: false, isPromptRunning: false, ...row.state };
  };
  const metadata = () => ({
    models: Object.fromEntries((modelRefs ?? modelIds.map(name => ({ provider, id: name, name })))
      .map(ref => [`${ref.provider}:${ref.id}`, ref.name])),
    modelList: (modelRefs ?? modelIds.map(name => ({ provider, id: name, name }))).map(ref => ({ ...ref })),
    defaultModel: selected(catalogDefault), defaultThinkingLevel: catalogThinking,
    thinkingLevelPins: pins, thinkingLevels: { [`${provider}:A`]: ["off", "high"] },
    thinkingLevelMaps: { [`${provider}:A`]: { high: "low" } },
  });
  const result = data => ({ success: true, data });
  const keys = (value, allowed, required = []) => {
    assert.ok(value && typeof value === "object" && !Array.isArray(value), "expected record body");
    assert.ok(Object.keys(value).every(key => allowed.includes(key)), "unknown body/init key");
    for (const key of required) assert.ok(Object.hasOwn(value, key), `missing ${key}`);
  };
  const query = (request, allowed, required = {}) => {
    const names = [...request.query.keys()];
    assert.equal(new Set(names).size, names.length, "duplicate query key");
    assert.ok(names.every(key => allowed.includes(key)), "unknown query key");
    for (const [key, value] of Object.entries(required)) assert.equal(request.query.get(key), value, `query ${key}`);
  };
  const choice = body => {
    if (modelRefs) {
      assert.ok(modelRefs.some(ref => ref.provider === body.provider && ref.id === body.modelId), "unknown provider/model reference");
      return;
    }
    assert.equal(body.provider, provider);
    assert.ok(modelIds.includes(body.modelId), "unknown model identity");
  };
  const thinking = level => assert.ok(["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level));
  function nativeSelection(value) {
    keys(value, ["version", "codeMode", "mcpServers"], ["version", "codeMode", "mcpServers"]);
    assert.equal(value.version, 1); assert.equal(typeof value.codeMode, "boolean");
    assert.ok(Array.isArray(value.mcpServers)); assert.ok(value.mcpServers.length <= 128);
    for (const server of value.mcpServers) {
      keys(server, ["scope", "name"], ["scope", "name"]);
      assert.ok(["global", "project"].includes(server.scope));
      assert.match(server.name, /^[A-Za-z0-9_-]{1,128}$/);
    }
  }
  function sessionPath(parsed, family, suffix = "") {
    const match = new RegExp(`^/api/${family}/([^/]+)${suffix}$`).exec(parsed.pathname);
    assert.ok(match, "unexpected session path");
    const sid = decodeURIComponent(match[1]);
    assert.ok(knownSessions.has(sid), "unknown session identity");
    assert.equal(parsed.pathname, `/api/${family}/${encodeURIComponent(sid)}${suffix}`, "noncanonical session path");
    return sid;
  }
  function validateRequest(input, init) {
    assert.ok(typeof input === "string" || input instanceof URL, "unsupported fetch input");
    keys(init, ["method", "headers", "body", "signal", "cache"]);
    const parsed = new URL(String(input), ORIGIN);
    assert.equal(parsed.origin, ORIGIN, "wrong fixture origin");
    assert.equal(parsed.username + parsed.password + parsed.hash, "", "URL authority/fragment not admitted");
    const request = { url: String(input), path: parsed.pathname, query: parsed.searchParams,
      method: init.method ?? "GET", serializedBody: init.body, body: init.body === undefined ? undefined : JSON.parse(init.body),
      signal: init.signal, duringTeardown: stopping };
    const headers = [...new Headers(init.headers).entries()];
    const json = request.method === "PUT" || (request.method === "POST" && !request.path.endsWith("/lease"));
    assert.deepEqual(headers, json ? [["content-type", "application/json"]] : [], "request header identity");
    if (json) assert.equal(typeof init.body, "string", "JSON body must be literal serialized input");
    else assert.equal(init.body, undefined, "body on read/lease");
    const nativeRepair = request.method === "GET" && (parsed.search === "?tree=summary&tail=1" || parsed.search === "?tools=1");
    if (request.path.endsWith("/lease") || request.path === "/api/native-tools" && request.method === "GET" || nativeRepair) assert.equal(init.cache, "no-store");
    else if (defaultChat && request.method === "GET" && /^\/api\/agent\/[^/]+$/.test(request.path)) assert.ok(init.cache === undefined || init.cache === "no-store");
    else assert.equal(init.cache, undefined);
    if (request.path === "/api/native-tools") {
      assert.equal(nativeControl, true, "explicit control capability only");
      if (request.method === "POST") {
        assert.equal(typeof nativeDefault, "function", "explicit default-write response capability");
        query(request, []);
        keys(request.body, ["cwd", "revision", "nativeResources"], ["cwd", "revision", "nativeResources"]);
        assert.equal(request.body.cwd, cwd); assert.match(request.body.revision, /^[a-f0-9]{64}$/);
        if (request.body.nativeResources !== null) nativeSelection(request.body.nativeResources);
      } else {
        assert.equal(request.method, "GET");
        query(request, ["cwd", "sessionId"], { cwd });
        if (request.query.has("sessionId")) assert.ok(knownSessions.has(request.query.get("sessionId")));
      }
    } else if (request.path === "/api/models") {
      assert.equal(request.method, "GET");
      query(request, ["cwd", "sessionId", "accounts"], { cwd });
      assert.ok(!(request.query.has("sessionId") && request.query.has("accounts")), "mixed account/session identity");
      if (request.query.has("sessionId")) assert.ok(knownSessions.has(request.query.get("sessionId")));
      if (request.query.has("accounts")) {
        const accounts = JSON.parse(request.query.get("accounts"));
        keys(accounts, [provider]);
        assert.ok(Object.values(accounts).every(value => typeof value === "string" && value.length > 0));
      }
    } else if (request.path === "/api/agent/new") {
      assert.equal(request.method, "POST"); query(request, []);
      keys(request.body, ["cwd", "type", "modelSpeed", "accounts", "toolNames", "provider", "modelId", "thinkingLevel", "nativeResources"], ["cwd", "type", "modelSpeed"]);
      if (Object.hasOwn(request.body, "nativeResources")) nativeSelection(request.body.nativeResources);
      assert.equal(request.body.cwd, cwd); assert.equal(request.body.type, "ensure_session");
      assert.ok(["standard", "fast"].includes(request.body.modelSpeed));
      if (Object.hasOwn(request.body, "provider") || Object.hasOwn(request.body, "modelId")) choice(request.body);
      if (Object.hasOwn(request.body, "thinkingLevel")) thinking(request.body.thinkingLevel);
      if (Object.hasOwn(request.body, "toolNames")) {
        assert.ok(Array.isArray(request.body.toolNames));
        assert.ok(request.body.toolNames.every(name => ["read", "grep", "find", "ls", "bash", "edit", "write"].includes(name)));
      }
      if (Object.hasOwn(request.body, "accounts")) { keys(request.body.accounts, [provider]); assert.ok(Object.values(request.body.accounts).every(value => typeof value === "string" && value.length > 0)); }
    } else if (/^\/api\/sessions\/[^/]+$/.test(request.path)) {
      sessionPath(parsed, "sessions"); assert.equal(request.method, "GET");
      if (nativeRepair) query(request, ["tree", "tail"], { tree: "summary", tail: "1" });
      else {
        query(request, ["deferThinking", "deferMedia", "tree", "force"], { deferThinking: "1", deferMedia: "1", tree: "summary" });
        if (request.query.has("force")) assert.equal(request.query.get("force"), "1");
      }
    } else if (/^\/api\/sessions\/[^/]+\/state$/.test(request.path)) {
      sessionPath(parsed, "sessions", "/state"); assert.equal(request.method, "GET"); query(request, []);
    } else if (/^\/api\/sessions\/[^/]+\/context$/.test(request.path)) {
      sessionPath(parsed, "sessions", "/context"); assert.equal(request.method, "GET");
      query(request, ["deferThinking", "deferMedia", "ancestorId", "leafId", "before", "tail"], { deferThinking: "1", deferMedia: "1" });
      if (request.query.has("tail")) assert.match(request.query.get("tail"), /^[1-9][0-9]*$/);
      for (const name of ["ancestorId", "leafId"]) if (request.query.has(name)) assert.ok(request.query.get(name));
    } else if (/^\/api\/agent\/[^/]+\/lease$/.test(request.path)) {
      sessionPath(parsed, "agent", "/lease"); assert.equal(request.method, "POST"); query(request, []);
    } else if (/^\/api\/agent\/[^/]+$/.test(request.path)) {
      sessionPath(parsed, "agent");
      if (nativeRepair) query(request, ["tools"], { tools: "1" }); else query(request, []);
      if (request.method !== "GET") {
        assert.equal(request.method, "POST");
        switch (request.body?.type) {
          case "get_commands": case "get_tools": case "get_state": keys(request.body, ["type"], ["type"]); break;
          case "extension_ui_response": {
            keys(request.body, ["type", "id", "answers", "cancelled"], ["type", "id"]);
            assert.equal(typeof request.body.id, "string");
            assert.notEqual(Object.hasOwn(request.body, "answers"), Object.hasOwn(request.body, "cancelled"));
            if (Object.hasOwn(request.body, "answers")) assert.ok(Array.isArray(request.body.answers));
            else assert.equal(request.body.cancelled, true);
            assert.ok(request.signal instanceof AbortSignal, "batch acknowledgement owns a deadline signal");
            break;
          }
          case "set_model": keys(request.body, ["type", "provider", "modelId"], ["type", "provider", "modelId"]); choice(request.body); break;
          case "compact": keys(request.body, ["type", "customInstructions"], ["type"]); break;
          case "set_auto_compaction": keys(request.body, ["type", "enabled"], ["type", "enabled"]); assert.equal(typeof request.body.enabled, "boolean"); break;
          case "set_model_speed": keys(request.body, ["type", "modelSpeed"], ["type", "modelSpeed"]); assert.ok(["standard", "fast"].includes(request.body.modelSpeed)); break;
          case "set_tools": keys(request.body, ["type", "toolNames"], ["type"]); if (request.body.toolNames !== undefined) {
            assert.ok(Array.isArray(request.body.toolNames));
            assert.ok(request.body.toolNames.every(name => ["read", "grep", "find", "ls", "bash", "edit", "write"].includes(name)));
          } break;
          case "set_native_resources": keys(request.body, ["type", "nativeResources"], ["type", "nativeResources"]); nativeSelection(request.body.nativeResources); break;
          case "fork": keys(request.body, ["type", "entryId"], ["type", "entryId"]); assert.equal(typeof request.body.entryId, "string"); break;
          case "clone": keys(request.body, ["type", "leafId"], ["type", "leafId"]); assert.ok(request.body.leafId === null || typeof request.body.leafId === "string"); break;
          case "bash": keys(request.body, ["type", "command", "excludeFromContext"], ["type", "command", "excludeFromContext"]); assert.equal(typeof request.body.command, "string"); assert.equal(typeof request.body.excludeFromContext, "boolean"); break;
          case "abort": case "abort_bash": keys(request.body, ["type"], ["type"]); break;
          case "navigate_tree": keys(request.body, ["type", "targetId"], ["type", "targetId"]); assert.equal(typeof request.body.targetId, "string"); break;
          case "set_thinking_level": keys(request.body, ["type", "level"], ["type", "level"]); thinking(request.body.level); break;
          case "set_session_name": keys(request.body, ["type", "name"], ["type", "name"]); assert.equal(typeof request.body.name, "string"); break;
          case "prompt":
            keys(request.body, ["type", "message", "images", "streamingBehavior"], ["type", "message"]);
            assert.equal(typeof request.body.message, "string");
            if (request.body.images !== undefined) assert.ok(Array.isArray(request.body.images));
            if (request.body.streamingBehavior !== undefined) assert.ok(["steer", "followUp"].includes(request.body.streamingBehavior));
            break;
          default: throw new Error("unknown agent command");
        }
      }
    } else if (defaultChat && request.path === "/api/auth/providers") {
      assert.equal(request.method, "GET"); query(request, []);
    } else if (defaultChat && request.path === "/api/auth/accounts/selection" && request.method === "GET") {
      query(request, ["cwd", "sessionId"], { cwd });
      assert.ok(knownSessions.has(request.query.get("sessionId")));
    } else if (request.path === "/api/auth/accounts/selection") {
      assert.equal(request.method, "PUT"); query(request, []);
      keys(request.body, ["scope", "sessionId", "provider", "accountId"], ["scope", "sessionId", "provider", "accountId"]);
      assert.equal(request.body.scope, "session"); assert.ok(knownSessions.has(request.body.sessionId)); assert.equal(request.body.provider, provider);
      assert.ok(request.body.accountId === null || typeof request.body.accountId === "string" && request.body.accountId.length > 0);
    } else throw new Error(`unknown route ${request.path}`);
    return request;
  }
  function defaultPayload(request) {
    const sid = decodeURIComponent(request.path.split("/")[3] ?? "");
    if (request.path === "/api/native-tools") {
      if (request.method === "POST") return nativeDefault(request);
      assert.equal(typeof nativeMetadata, "function", "explicit metadata response capability");
      return nativeMetadata(request);
    }
    if (defaultChat && request.path === "/api/auth/providers") return { providers: [], oauthProviders: [], apiKeyProviders: [] };
    if (defaultChat && request.path === "/api/auth/accounts/selection" && request.method === "GET") return { accounts: [], project: {}, session: {} };
    if (models(request)) return metadata();
    if (request.path === "/api/agent/new" && request.body?.type === "ensure_session") {
      const row = record(savedId);
      row.model = request.body.modelId ?? catalogDefault;
      if (modelRefs) row.provider = request.body.provider ?? provider;
      row.thinking = request.body.thinkingLevel ?? pins[`${provider}/${row.model}`] ?? catalogThinking;
      if (Object.hasOwn(request.body, "toolNames")) row.toolNames = request.body.toolNames;
      if (Object.hasOwn(request.body, "nativeResources")) row.nativeResources = request.body.nativeResources;
      return { sessionId: savedId, model: selected(row.model), thinkingLevel: row.thinking, modelSpeed: "standard" };
    }
    if (detail(request)) return snapshot(sid);
    if (/^\/api\/sessions\/[^/]+\/state$/.test(request.path)) return { running: record(sid).running, state: live(sid) };
    if (/^\/api\/sessions\/[^/]+\/context$/.test(request.path)) return { context: snapshot(sid).context };
    if (/^\/api\/agent\/[^/]+\/lease$/.test(request.path) && request.method === "POST") return { renewed: 1 };
    if (/^\/api\/agent\/[^/]+$/.test(request.path) && request.method === "GET") return { running: record(sid).running, state: live(sid) };
    if (/^\/api\/agent\/[^/]+$/.test(request.path) && request.method === "POST") {
      switch (request.body?.type) {
        case "get_commands": return result({ commands: [] });
        case "get_tools": return result(record(sid).tools ?? []);
        case "get_state": return result(live(sid));
        case "extension_ui_response": return result({ accepted: true });
        case "set_model": {
          const row = record(sid); row.model = request.body.modelId; row.revision++;
          if (modelRefs) row.provider = request.body.provider;
          return result({ provider: row.provider ?? provider, id: row.model });
        }
        case "compact": return result({ tokensBefore: 1000, estimatedTokensAfter: 500 });
        case "set_auto_compaction": record(sid).state = { ...record(sid).state, autoCompactionEnabled: request.body.enabled }; return result({});
        case "set_model_speed": record(sid).speed = request.body.modelSpeed; return result({ modelSpeed: request.body.modelSpeed });
        case "set_tools": {
          const row = record(sid);
          if (Object.hasOwn(request.body, "toolNames")) row.toolNames = request.body.toolNames;
          else delete row.toolNames;
          return result({ sessionId: sid, recreated: false });
        }
        case "set_native_resources": record(sid).nativeResources = request.body.nativeResources; return result({ sessionId: sid, nativeResources: request.body.nativeResources });
        case "fork": case "clone": return result({ cancelled: true });
        case "bash": case "abort": case "abort_bash": return result({});
        case "navigate_tree": return result({ cancelled: false });
        case "set_thinking_level": record(sid).thinking = request.body.level; return result({});
        case "set_session_name": return result({});
        case "prompt": return result({});
      }
    }
    if (request.path === "/api/auth/accounts/selection" && request.method === "PUT") {
      assert.equal(request.body.scope, "session");
      return { sessionId: request.body.sessionId };
    }
    throw new Error(`Unexpected mounted request: ${request.method} ${request.path}`);
  }

  // Rules are one-shot unless explicitly grouped for a freshness-header window.
  // Header/body barriers are distinct; default delivery deliberately ignores abort.
  function hold(predicate, { stage = "body", status = 200, fallback, abort = "ignore", beforeJson, repeat = false } = {}) {
    const admitted = deferred(), entered = deferred(), release = deferred();
    const rule = { predicate, stage, status, abort, beforeJson, repeat, admitted, entered, release, used: false, done: false,
      resolve(payload) { rule.done = true; release.resolve({ payload }); },
      reject(error) { rule.done = true; release.resolve({ error }); },
      cleanup() { if (!rule.done) rule.resolve(fallback ? fallback(rule.request) : defaultPayload(rule.request)); },
    };
    rules.push(rule);
    return rule;
  }
  async function delivery(rule, request) {
    if (rule.abort !== "reject" || !request.signal) return await rule.release.promise;
    let onAbort;
    try {
      return await new Promise((resolve, reject) => {
        onAbort = () => reject(request.signal.reason);
        if (request.signal.aborted) { onAbort(); return; }
        request.signal.addEventListener("abort", onAbort, { once: true });
        rule.release.promise.then(resolve, reject);
      });
    } finally { if (onAbort) request.signal.removeEventListener("abort", onAbort); }
  }
  function response(request, rule, resolved) {
    const clonePayload = payload => {
      try { return JSON.parse(JSON.stringify(payload)); }
      catch (cause) {
        rememberFailure(new Error(`Fixture JSON generation failed: ${request.method} ${request.path}`, { cause }));
        throw cause;
      }
    };
    const status = rule?.status ?? 200;
    let consumed = false;
    return { ok: status >= 200 && status < 300, status,
      json() {
        if (consumed) {
          const error = new Error(`Repeated JSON consumption: ${request.method} ${request.path}`);
          rememberFailure(error);
          return io("rejected repeated body consumption", Promise.reject(error));
        }
        consumed = true;
        const body = (async () => {
          if (rule?.stage === "body") {
            rule.entered.resolve(request);
            const received = await delivery(rule, request);
            if (received.error) throw received.error;
            try { rule.beforeJson?.(request); }
            catch (cause) { rememberFailure(new Error(`Fixture delivery callback failed: ${request.method} ${request.path}`, { cause })); throw cause; }
            return clonePayload(received.payload);
          }
          return clonePayload(resolved);
        })();
        if (rule) rule.bodyPromise = body;
        return io(`JSON ${request.method} ${request.url}`, body);
      },
    };
  }
  const releaseRule = rule => {
    try { if (rule.used) rule.cleanup(); }
    catch (error) { rememberFailure(error); try { rule.reject(error); } catch (nested) { rememberFailure(nested); } }
  };
  const releasePeers = () => {
    try { policyTime?.releaseForCleanup(); } catch (error) { rememberFailure(error); }
    for (const rule of rules) releaseRule(rule);
  };
  // Join only actually exposed owners/admitted work. A commit during one async
  // act may admit another chain: repeat only when that admission is witnessed.
  // No owner is closed here, so nested continuations cannot be rejected as late.
  async function joinDefault() {
    assert.equal(defaultChat, true);
    const joinedFailures = [];
    let before;
    do {
      before = observationVersion;
      let invoked = false, operation;
      const start = () => {
        invoked = true;
        operation = (async () => {
          const joins = [];
          const add = join => { try { joins.push(Promise.resolve(join())); } catch (error) { joins.push(Promise.reject(error)); } };
          for (const owners of defaultOwners) {
            add(owners.whenMaintenanceSettled); add(owners.work.whenSettled);
          }
          for (const join of composerHandles) add(join);
          joins.push(...viewPending, ...pendingTransports, ...observedFrames.map(frame => frame.promise));
          for (const result of await Promise.allSettled(joins)) if (result.status === "rejected") joinedFailures.push(result.reason);
        })();
        void operation.catch(() => {});
        return operation;
      };
      try { await act(start); } catch (error) { joinedFailures.push(error); }
      // An act failure cannot skip any real owner's join.
      if (!invoked) start();
      try { await operation; } catch (error) { joinedFailures.push(error); }
    } while (observationVersion !== before || viewPending.size || pendingTransports.size || observedFrames.some(frame => !frame.finished));
    if (joinedFailures.length) throw new AggregateError(joinedFailures, "Actual default owner joins failed");
  }
  // Domain work is separately idempotent so failed mount can join it before
  // restoring its realm, without recursively calling the realm disposer.
  const errors = [];
  const stage = async (label, action, react = false) => {
      let invoked = false, operation, actFailure;
      const start = () => {
        invoked = true;
        try { operation = Promise.resolve(action()); } catch (error) { operation = Promise.reject(error); }
        void operation.catch(() => {});
        return operation;
      };
      if (react) {
        try { await act(start); } catch (error) { actFailure = error; errors.push(new Error(`${label}/act: ${scalar(error)}`, { cause: error })); }
      }
      // Even act throwing before callback admission cannot skip the actual join.
      if (!invoked) start();
      const [result] = await Promise.allSettled([operation]);
      if (result.status === "rejected" && result.reason !== actFailure) errors.push(new Error(`${label}: ${scalar(result.reason)}`, { cause: result.reason }));
  };
  // Independent release BEFORE any React/public/maintenance await. Keep this
  // cleanup-only scope distinct from deliberate public-unmount product proof.
  const stopForCleanup = () => {
    cleanupStarted = true;
    stopping = true;
    releasePeers();
    for (const rule of rules) {
      rule.admitted.reject(new Error("Fixture cleanup before held request admission"));
      rule.entered.reject(new Error("Fixture cleanup before held transport phase entry"));
    }
    for (const waiter of requestWaiters) waiter.reject(new Error("Fixture cleanup before request admission"));
    for (const waiter of sourceWaiters) waiter.reject(new Error("Fixture cleanup before source admission"));
    // Actual class close rejects the original attempt and clears its real timer;
    // closing a Source double alone cannot release the original ensure promise.
    for (const connection of connections) {
      try { connection.close(); } catch (error) { rememberFailure(error); }
    }
  };
  let domainSettlement;
  const settleDomain = () => {
    // Called only after the automatic unmount boundary (including failed mount
    // disposal). Deliberate public unmount/its clear assertions get no rescue.
    closeObservedGraceTimers();
    stopForCleanup();
    if (!domainSettlement) {
      domainSettlement = (async () => {
    await stage("release policy delays", () => policyTime?.releaseForCleanup());
    await stage("release all admitted gates", () => { for (const rule of rules) releaseRule(rule); });
    await stage("public operations", () => publicOwner.join(), true);
    if (defaultChat) await stage("actual default transitive hook/view/input/HTTP/frame owners", joinDefault);
    await stage("all captured real input incarnations", async () => {
      const results = await Promise.allSettled([...composerHandles].map(join => Promise.resolve().then(join)));
      for (const result of results) if (result.status === "rejected") errors.push(new Error(`input: ${scalar(result.reason)}`, { cause: result.reason }));
    }, true);
    await stage("all captured hook incarnations", async () => {
      const joins = [];
      for (const join of maintenanceHandles.values()) {
        try { joins.push(Promise.resolve(join())); } catch (error) { joins.push(Promise.reject(error)); }
      }
      const results = await Promise.allSettled(joins);
      for (const item of results) if (item.status === "rejected") errors.push(new Error(`maintenance: ${scalar(item.reason)}`, { cause: item.reason }));
    }, true);
    await stage("original connection waiters", async () => {
      while (connectionWaits.size) await Promise.all([...connectionWaits]);
    });
    await stage("observed native animation frames", () => Promise.all(observedFrames.map(entry => entry.promise)));
    await stage("transport and body drain", async () => {
      transportClosed = true;
      try { await transportOwner.join(); }
      finally { while (lateTransports.size) await Promise.all([...lateTransports]); }
    }, true);
    await stage("source closure", () => {
      for (const source of sources) {
        try {
          if (source.readyState !== 2) { rememberFailure(new Error(`Production did not close source ${source.url}`)); source.close(); }
        } catch (error) { rememberFailure(error); }
      }
    });
      })();
      void domainSettlement.catch(() => {});
    }
    return domainSettlement;
  };
  const restoreDescriptors = phase => {
    for (const last of [false, true]) for (const item of [...restorations].reverse()) {
      if (item.phase !== phase || Boolean(item.last) !== last || item.restored) continue;
      item.restored = true;
      try {
        if (item.descriptor) Object.defineProperty(item.target, item.name, item.descriptor);
        else delete item.target[item.name];
      } catch (error) { rememberFailure(error); }
    }
  };
  // Also called by mount's failed-setup disposer before it closes/restores its
  // realm. Host guards stay installed through that close and global restoration.
  let realmSettlement;
  const beforeRealmDispose = () => {
    if (!realmSettlement) {
      realmSettlement = (async () => {
        await stage("domain settlement", settleDomain);
        for (const finalize of [...observationFinalizers].reverse()) await stage("passive observation finalizer", finalize);
        await stage("restore realm descriptors", () => restoreDescriptors("realm"));
      })();
      void realmSettlement.catch(() => {});
    }
    return realmSettlement;
  };
  // Registered before ANY global guard installation or production import.
  t.after(async () => {
    stopForCleanup();
    await stage("unmount", () => view?.unmount());
    await stage("realm settlement", beforeRealmDispose);
    await stage("DOM disposal", () => view?.dispose());
    await stage("late admitted transport", async () => { while (lateTransports.size) await Promise.all([...lateTransports]); });
    // Every realm descriptor was restored before realm close. Host/prototype
    // descriptors restore afterward, console last; listeners remain live here.
    await stage("restore host descriptors", () => restoreDescriptors("host"));
    await stage("remove error listeners", () => {
      for (const remove of listenerRemovals.reverse()) { try { remove(); } catch (error) { rememberFailure(error); } }
    });
    for (const expected of expectedConsole) if (!expected.used) rememberFailure(new Error(`Missing expected operational console.error: ${expected.label}`));
    errors.push(...failures);
    if (errors.length) throw new AggregateError(errors,
      `Mounted session teardown failed: ${errors.slice(0, 3).map(error => scalar(error).slice(0, 4000)).join(' | ')}`);
  });

  guardConsole(console);
  listen(process, "unhandledRejection", reason => rememberFailure(new Error(`process unhandled rejection: ${scalar(reason)}`, { cause: reason })), true);
  // Monitor, not an uncaughtException handler: never suppress Node's own failure.
  listen(process, "uncaughtExceptionMonitor", error => rememberFailure(new Error(`process uncaught error: ${scalar(error)}`, { cause: error })), true);
  replace("WebSocket", unsupported("WebSocket", "host"));
  replace("XMLHttpRequest", unsupported("XMLHttpRequest", "host"));
  if (nativeControl) for (const name of ["Worker", "Audio", "AudioContext"]) replace(name, unsupported(name, "host"));

  const guardedFetch = (input, init = {}) => {
    let request;
    try {
      if (importing) throw new Error("Fetch admitted during production import");
      request = validateRequest(input, init);
    } catch (error) {
      rememberFailure(new Error(`Fetch admission rejected: ${scalar(error)}`, { cause: error }));
      return io("rejected fetch admission", Promise.reject(error));
    }
    const url = request.url;
    requests.push(request);
    let rule;
    try {
      for (const waiter of requestWaiters) if (waiter.predicate(request)) waiter.resolve(request);
      rule = rules.find(item => (!item.used || (item.repeat && !item.done)) && item.predicate(request));
    } catch (error) {
      rememberFailure(new Error(`Fetch routing admission rejected: ${scalar(error)}`, { cause: error }));
      return io("rejected routing admission", Promise.reject(error));
    }
    if (rule) {
      rule.used = true; rule.request = request; rule.admitted.resolve(request);
      // A valid already-admitted parent's continuation may reach another named
      // gate during drain. Release it too, without closing observer registration.
      if (stopping) releaseRule(rule);
    }
    const work = (async () => {
      try {
        if (rule?.stage === "headers") {
          rule.entered.resolve(request);
          const received = await delivery(rule, request);
          if (received.error) throw received.error;
          return response(request, rule, received.payload);
        }
        return response(request, rule, rule ? undefined : defaultPayload(request));
      } catch (error) {
        // Explicit rule rejections are intended transport inputs. Every default
        // dispatch failure remains visible even if production catches it.
        if (!rule) rememberFailure(error);
        throw error;
      }
    })();
    if (rule) rule.fetchPromise = work;
    return io(`fetch ${request.method} ${url}`, work);
  };
  replace("fetch", guardedFetch);

  class Source {
    readyState = 0;
    onmessage = null;
    onerror = null;
    closeCount = 0;
    constructor(url, init) {
      try {
        if (importing) throw new Error("EventSource admitted during production import");
        assert.equal(init, undefined);
        const parsed = new URL(String(url), ORIGIN);
        assert.equal(parsed.origin, ORIGIN); assert.equal(parsed.username + parsed.password + parsed.hash + parsed.search, "");
        sessionPath(parsed, "agent", "/events");
      } catch (error) { rememberFailure(new Error(`EventSource admission rejected: ${scalar(error)}`, { cause: error })); throw error; }
      this.url = String(url);
      if (stopping) rememberFailure(new Error(`Source admitted during teardown: ${this.url}`));
      sources.push(this);
      for (const waiter of sourceWaiters) if (waiter.predicate(this)) waiter.resolve(this);
    }
    close() { this.readyState = 2; this.closeCount++; }
    message(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
    connected(isStreaming = false) { this.readyState = 1; this.message({ type: "connected", isStreaming }); }
    error() { this.readyState = 2; this.onerror?.(new Event("error")); }
  }
  replace("EventSource", Source);

  // Production modules are loaded only now: cleanup, host transport admission,
  // console and process error guards are already installed. No graph reload or
  // import-error suppression; a failed import remains a failed shared graph.
  subject = await loadProductionGraph();
  // Delegate the actual same-graph method with identical this/args and return
  // its EXACT original promise. Separate observers own only admitted ensures.
  const prototype = subject.AgentEventConnection.prototype;
  const ensureDescriptor = Object.getOwnPropertyDescriptor(prototype, "ensureConnected");
  restorations.push({ target: prototype, name: "ensureConnected", descriptor: ensureDescriptor, last: false, phase: "host" });
  Object.defineProperty(prototype, "ensureConnected", { ...ensureDescriptor, value: function (...args) {
    connections.add(this);
    const original = Reflect.apply(ensureDescriptor.value, this, args);
    const settled = original.then(() => connectionWaits.delete(settled), () => connectionWaits.delete(settled));
    connectionWaits.add(settled);
    if (cleanupStarted) { try { this.close(); } catch (error) { rememberFailure(error); } }
    return original;
  } });
  observeProduction?.({ AgentEventConnection: subject.AgentEventConnection,
    afterSettlement(finalize) { observationFinalizers.push(finalize); } });
  if (composer || modelControls) ({ ChatInput: Composer } = await subject.loadComposer());
  if (questionSets) ({ QuestionSetDialog: QuestionSet } = await subject.loadQuestionSet());
  if (nativeControl) ({ SessionToolsSession: NativeControl } = await subject.loadNativeControl());
  if (defaultChat) ({ ChatWindow: DefaultChat } = await subject.loadDefault());
  importing = false;

  const api = {
    id, cwd, draftKey, savedId, requests, sources, promotions, rekeys, restores, consoleEvents, scrollCalls,
    expectConsoleError(prefix, matchError) {
      expectedConsole.push({ label: prefix,
        match: args => args.length === 2 && args[0] === prefix && matchError(args[1]), used: false });
    },
    // Optional passive witness: deliver/cancel only via the original JSDOM RAF,
    // never a manual frame scheduler or a React timer replacement.
    watchFrames() {
      if (frameWitness) return frameWitness;
      const nativeRequest = globalThis.requestAnimationFrame, nativeCancel = globalThis.cancelAnimationFrame;
      const request = callback => {
        const completed = deferred(), entry = { handle: null, cancelled: false, finished: false, promise: completed.promise, completed };
        entry.handle = nativeRequest(timestamp => {
          try { return callback(timestamp); }
          catch (error) { rememberFailure(error); throw error; }
          finally { entry.finished = true; completed.resolve(); }
        });
        observedFrames.push(entry); observationVersion++;
        return entry.handle;
      };
      const cancel = handle => {
        const entry = observedFrames.find(item => item.handle === handle && !item.finished);
        try { return nativeCancel(handle); }
        finally { if (entry) { entry.cancelled = true; entry.finished = true; entry.completed.resolve(); } }
      };
      replace("requestAnimationFrame", request); replace("cancelAnimationFrame", cancel);
      if (defaultChat) {
        installRealm(realmWindow, "requestAnimationFrame", request); installRealm(realmWindow, "cancelAnimationFrame", cancel);
      }
      frameWitness = { frames: observedFrames };
      return frameWitness;
    },
    get view() { return view; }, get current() { return current; },
    get nativePeerCurrent() { return nativePeerCurrent; },
    controlWorks,
    async settleControl() {
      await act(async () => {
        let cursor = 0;
        while (cursor < controlWorks.length) {
          const batch = controlWorks.slice(cursor); cursor = controlWorks.length;
          await Promise.all(batch.map(work => work.promise));
        }
      });
    },
    get loader() { return systemLoader; },
    get maintenanceHandle() { return maintenanceHandles.get(incarnation); },
    get mountedOptions() { return mountedOptions; },
    // These are the actual key/options used below, not a replacement selection
    // controller. Captured keys/owners distinguish a returned A from its old A.
    get keyedProps() { return { key: incarnation, options: mountedOptions }; },
    get currentContext() { return { sessionId: current?.sessionIdRef.current ?? null,
      key: incarnation, owner: maintenanceHandles.get(incarnation) }; },
    get leafChange() { return leafChange; },
    get composerOperation() { return composerOperation; },
    get defaultViewport() { return view?.container.querySelector(".overflow-y-auto.scrollbar-subtle"); },
    numeric, viewWorks, defaultOwners,
    get copyWorks() { return viewWorks.filter(entry => entry.name === 'tool-copy'); },
    async settleDefault() { await joinDefault(); api.assertNoFailures(); },
    async intersect() {
      await act(async () => { for (const observer of intersections) observer.callback([{ isIntersecting: true }]); });
    },
    composerRef, submissionWorks,
    nextSubmission() { const gate = deferred(); submissionWaiters.push(gate); return gate.promise; },
    async finishSubmission(entry, release) {
      await act(async () => { release?.(); await entry.promise; });
    },
    receipts: subject.receipts, operations: subject.operations, questionDrafts: subject.questionDrafts,
    declareSession(sid) { knownSessions.add(sid); return record(sid); },
    snapshot, live, metadata, record, hold,
    setCatalog({ model = catalogDefault, thinking = catalogThinking, thinkingPins = pins } = {}) {
      catalogDefault = model; catalogThinking = thinking; pins = thinkingPins;
    },
    getDraft, setDraft,
    newOptions(overrides = {}) {
      return { session: null, newSessionCwd: cwd, newSessionDraftKey: draftKey, persistNewSession: false,
        ...(policyTime ? { policyClock: policyTime.clock } : {}),
        onBranchDataChange(_tree, _leaf, change) { leafChange = change; },
        chatInputRef: { current: {
          rekeyDraft(from, to) { rekeys.push([from, to]); rekeyDraft(from, to); },
          restoreSubmission(text, images, key) { restores.push([text, images, key]); restoreDraftSubmission(key, text, images); },
        } },
        onSessionCreated(session, key) { promotions.push({ session, key, draftAtCallback: getDraft(session.id) }); },
        onSystemInfoLoaderChange(loader) { systemLoader = loader; }, ...overrides };
    },
    existingOptions(sid = savedId) {
      knownSessions.add(sid);
      record(sid);
      return api.newOptions({ session: { id: sid, cwd, messageCount: 0, firstMessage: "", path: "", created: "", modified: "" },
        newSessionCwd: null, newSessionDraftKey: null });
    },
    async mount(options = api.newOptions(), sameInstance = false) {
      mountedOptions = options;
      const key = sameInstance ? incarnation : ++incarnation;
      const hookOptions = ownGraceTimers ? { ...options, onGraceTimer: observeGraceTimer } : options;
      const element = createElement(subject.I18nProvider, null, defaultChat
        ? createElement(DefaultChat, { archivedRootSessionId: null, archiveActionBusy: false, onSessionRestored() {},
          ...hookOptions, key, chatInputRef: composerRef, workObserver: {
            ...defaultObserver,
            ...(options.workObserver?.copy ? { copy(observation) {
              try {
                observeDefaultCopy(observation);
                options.workObserver.copy(observation); // Actual current public observer, not a cloned handler.
              } catch (error) { rememberFailure(error); } // Unknown callback errors remain fatal through joins.
            } } : {}),
          } })
        : createElement(receiveCreatedSession ? CreatedSessionReceiver : Probe, {
        subject, key, options: hookOptions, composer: Composer, composerRef, viewport,
        questionSet: QuestionSet, observeSubmission, NativeControl, modelControls,
        nativePeer: nativePeerSessionId ? {
          options: api.existingOptions(nativePeerSessionId),
          capture(value) {
            nativePeerCurrent = value;
            maintenanceHandles.set(`native-peer:${key}`, value.whenMaintenanceSettled);
          },
        } : null,
        ownControl(label, promise) {
          const work = { label, promise: publicOwner.track(label, promise), settled: false };
          controlWorks.push(work);
          promise.then(() => { work.settled = true; }, () => { work.settled = true; });
          return promise;
        },
        ownComposer(label, promise) { composerOperation = { promise: publicOwner.track(label, promise) }; return composerOperation.promise; },
        capture(value) {
          current = value;
          assert.equal(typeof value.whenMaintenanceSettled, "function", "adopt the production completion seam with this fixture");
          maintenanceHandles.set(key, value.whenMaintenanceSettled);
        },
      }));
      if (view) await view.rerender(element);
      else view = await mount(t, element, { strict: true, beforeUnmount() {
        // Explicit public unmount must exercise production cleanup unaided.
        // Only failed setup/fixture disposal may use emergency actual close.
        if (!explicitUnmount) stopForCleanup();
      }, beforeDispose: beforeRealmDispose, setup(window) {
        realmWindow = window;
        // The fresh DOM realm has its own constructors/console. Install guards
        // before React render; do not leave JSDOM's native XHR/WebSocket usable.
        installRealm(window, "fetch", guardedFetch);
        installRealm(window, "EventSource", Source);
        installRealm(window, "WebSocket", unsupported("WebSocket", "realm"));
        installRealm(window, "XMLHttpRequest", unsupported("XMLHttpRequest", "realm"));
        if (nativeControl) {
          for (const name of ["Worker", "Audio", "AudioContext"]) installRealm(window, name, unsupported(name, "realm"));
          installRealm(window.navigator, "sendBeacon", unsupported("beacon", "realm"));
          installRealm(window.HTMLDialogElement.prototype, "showModal", function () { this.open = true; });
          installRealm(window.HTMLDialogElement.prototype, "close", function () {
            this.open = false; this.dispatchEvent(new window.Event("close"));
          });
        }
        guardConsole(window.console, "realm");
        listen(window, "error", event => rememberFailure(new Error(`window error: ${scalar(event.error ?? event.message)}`, { cause: event.error ?? event.message })));
        listen(window, "unhandledrejection", event => rememberFailure(new Error(`window unhandled rejection: ${scalar(event.reason)}`, { cause: event.reason })));
        listen(window, "securitypolicyviolation", event => rememberFailure(new Error(
          `window CSP violation: ${String(event.violatedDirective)} ${String(event.blockedURI)}`)));
        if (clipboard !== null) {
          assert.equal(defaultChat, true, 'clipboard is an explicit per-instance default-owner external port');
          assert.equal(typeof clipboard.writeText, 'function');
          installRealm(window.navigator, 'clipboard', clipboard);
        }
        if (defaultChat) {
          const isViewport = node => node.classList?.contains("scrollbar-subtle") && node.classList.contains("overflow-y-auto");
          for (const [name, read] of [["scrollHeight", () => numeric.height], ["clientHeight", () => numeric.client]]) {
            const original = Object.getOwnPropertyDescriptor(window.Element.prototype, name);
            restorations.push({ target: window.Element.prototype, name, descriptor: original, last: false, phase: "realm" });
            Object.defineProperty(window.Element.prototype, name, { configurable: true, get() {
              return isViewport(this) ? read() : original?.get?.call(this) ?? 0;
            } });
          }
          const rect = window.HTMLElement.prototype.getBoundingClientRect;
          installRealm(window.HTMLElement.prototype, "getBoundingClientRect", function () {
            if (isViewport(this)) return { top: 100, bottom: 100 + numeric.client, left: 0, right: 800, width: 800, height: numeric.client };
            if (this.hasAttribute("data-entry-id")) {
              const index = [...this.parentElement.children].filter(node => node.hasAttribute("data-entry-id")).indexOf(this);
              const top = 100 + 100 * index - (this.closest(".scrollbar-subtle")?.scrollTop ?? 0);
              return { top, bottom: top + 80, left: 0, right: 800, width: 800, height: 80 };
            }
            if (this.classList.contains("text-center")) return { top: 100, bottom: 101 };
            return rect.call(this);
          });
          installRealm(window.HTMLElement.prototype, "scrollTo", function (options) {
            assert.equal(isViewport(this), true);
            assert.deepEqual(Object.keys(options).sort(), ["behavior", "top"]);
            assert.ok(["auto", "instant", "smooth"].includes(options.behavior));
            scrollCalls.push({ top: options.top, behavior: options.behavior });
            this.scrollTop = Math.max(0, Math.min(options.top, numeric.height - numeric.client));
          });
          class IntersectionPort {
            constructor(callback) { this.callback = callback; intersections.add(this); }
            observe() {} disconnect() { intersections.delete(this); }
          }
          replace("IntersectionObserver", IntersectionPort); installRealm(window, "IntersectionObserver", IntersectionPort);
          installRealm(window.Element.prototype, "animate", function () { return { cancel() {} }; });
          replace("CSS", { escape: value => window.CSS?.escape ? window.CSS.escape(value) : value });
        }
        if (viewport) installRealm(window.HTMLElement.prototype, "scrollTo", function (options) {
          try {
            assert.equal(this.getAttribute("data-testid"), "hook-viewport", "only the declared hook viewport can scroll");
            assert.deepEqual(Object.keys(options).sort(), ["behavior", "top"]);
            assert.ok(["instant", "auto", "smooth"].includes(options.behavior));
            assert.equal(Number.isFinite(options.top), true);
            scrollCalls.push({ top: options.top, behavior: options.behavior });
            // Supplied geometry only. This is not native scrolling/layout proof.
            this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight));
          } catch (error) { rememberFailure(error); throw error; }
        });
        if (questionSets) installRealm(window.HTMLElement.prototype, 'getClientRects', function () {
          // JSDOM has no layout. Only the existing BlockingCard visibility/focus
          // capability is supplied, matching cards-git.fixture; no bounds proof.
          return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()];
        });
        if (composer || modelControls || defaultChat) {
          class ResizeObservation { observe() {} disconnect() {} }
          replace("ResizeObserver", ResizeObservation); installRealm(window, "ResizeObserver", ResizeObservation);
          installRealm(window.HTMLElement.prototype, "scrollIntoView", function (options) {
            // Unsupported DOM capability, not proof of native scrolling/layout.
            try {
              assert.equal(this.isConnected, true);
              assert.deepEqual(options, { block: "nearest", inline: "nearest" });
            } catch (error) { rememberFailure(error); throw error; }
          });
          installRealm(window, "matchMedia", query => ({ matches: mobile && query.includes("max-width"), media: query,
            addEventListener() {}, removeEventListener() {} }));
        }
        window.localStorage.setItem("pi-tool-preset", preset);
        replace("requestAnimationFrame", window.requestAnimationFrame.bind(window));
        replace("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
        if (defaultChat) api.watchFrames();
      } });
      return current;
    },
    async rerender(options) { return await api.mount(options, true); },
    async mountReady(options = api.newOptions()) {
      await api.mount(options);
      if (options.session) {
        const active = sources.filter(source => source.readyState !== 2);
        assert.equal(active.length, nativePeerSessionId ? 2 : 1, "production must own each declared source before readiness");
        for (const source of active) await api.connect(source, source.url === `/api/agent/${nativePeerSessionId}/events` && record(nativePeerSessionId).running);
      }
      await api.settleMaintenance();
      if (nativePeerSessionId) await api.settleMaintenance(nativePeerCurrent.whenMaintenanceSettled);
      return current;
    },
    async start(label, action, { rejects } = {}) {
      let operation;
      await act(async () => {
        const promise = Promise.resolve(action(current));
        operation = publicOwner.track(label, rejects ? assert.rejects(promise, rejects) : promise);
      });
      return operation ? { promise: operation } : undefined;
    },
    async finish(operation, release) {
      await act(async () => { release?.(); await operation.promise; });
    },
    async run(label, action, { rejects } = {}) {
      // Ungated public operations own ONE complete async React boundary; splitting
      // start/finish lets an already-ready command's finally publish between them.
      await act(async () => {
        const promise = Promise.resolve(action(current));
        await publicOwner.track(label, rejects ? assert.rejects(promise, rejects) : promise);
      });
    },
    async deliver(rule, payload) {
      // A transport-phase React boundary, not a handler/idle join. Terminal
      // assertions still await the actual captured maintenance/public promise.
      await act(async () => { rule.resolve(payload); await (rule.bodyPromise ?? rule.fetchPromise); });
    },
    async settleMaintenance(handle = api.maintenanceHandle) {
      assert.equal(typeof handle, "function", "a real committed hook owner must be captured");
      await act(async () => { await handle(); });
    },
    async unmount(release) {
      stopping = true;
      explicitUnmount = true;
      try {
        if (defaultChat) { release?.(); releasePeers(); }
        await view.unmount();
      } finally { explicitUnmount = false; }
    },
    nextRequest(predicate) {
      const waiter = deferred(); requestWaiters.push({ predicate, resolve: waiter.resolve, reject: waiter.reject }); return waiter.promise;
    },
    nextSource(predicate = () => true) {
      const waiter = deferred(); sourceWaiters.push({ predicate, resolve: waiter.resolve, reject: waiter.reject }); return waiter.promise;
    },
    async event(source, event) { await act(() => source.message(event)); },
    async connect(source, isStreaming = false) { await act(() => source.connected(isStreaming)); },
    assertNoFailures() { assert.deepEqual(failures, []); },
  };
  return api;
}
