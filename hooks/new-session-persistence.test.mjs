import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { act, createElement } from "react";
import { createJiti } from "jiti";
import { mount } from "../lib/testing/react.fixture.mjs";
import { createTaskOwner, deferred } from "../lib/testing/async.fixture.mjs";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" }, tsconfigPaths: true, fsCache: false,
});
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { I18nProvider } = await jiti.import("./useI18n.tsx");

// The probe only exposes the real production hook. No copied startup algorithm,
// event stream, SDK, browser transport or native layout is supplied here.
function SessionProbe({ options, capture }) {
  const session = useAgentSession(options);
  capture(session);
  return createElement("output", null, session.error ?? "ready");
}

let mountedId = 0;
async function mountedFixture(t, { preset = "configured", leaving = false } = {}) {
  const owner = createTaskOwner(), response = deferred(), promoted = deferred();
  const requests = [], created = [], inputRekeys = [];
  // A production module singleton outlives DOM realms. Do not reuse draft IDs
  // across cases, including when a failed assertion promotes during cleanup.
  const id = ++mountedId;
  const draftKey = `new:mounted-${id}:/new-project`, savedId = `saved-mounted-${id}`;
  const storageKey = key => `pi-web:composer-draft:v1:${key}`;
  let view, current, operation, createResponse;
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  // Registered before render/request admission. Unmount stops React admission;
  // releasing the response and joining the public operation precede DOM disposal.
  t.after(async () => {
    const errors = [];
    try { await view?.unmount(); } catch (error) { errors.push(error); }
    try {
      await act(async () => {
        response.resolve();
        await Promise.allSettled([createResponse, operation]);
        await owner.join();
      });
    } catch (error) { errors.push(error); }
    try { await view?.dispose(); } catch (error) { errors.push(error); }
    try {
      if (previousFetch) Object.defineProperty(globalThis, "fetch", previousFetch);
      else delete globalThis.fetch;
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Mounted session cleanup failed");
  });
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body });
    if (url === "/api/agent/new") {
      createResponse = owner.track("delayed ensure_session response", response.promise.then(() => ({
        ok: true, json: async () => ({ sessionId: savedId }),
      })));
      return createResponse;
    }
    if (url.startsWith("/api/models?")) {
      // Immediate, successful metadata: no retry timer or real network. The
      // public operation below owns creation; act owns the resulting commits.
      return Promise.resolve({ ok: true, json: async () => ({ models: {}, modelList: [] }) });
    }
    if (url === `/api/agent/${savedId}` && body?.type === "get_commands") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { commands: [] } }) });
    }
    assert.fail(`Unexpected mounted request: ${url} ${JSON.stringify(body)}`);
  } });
  const options = {
    session: null, newSessionCwd: "/new-project", newSessionDraftKey: draftKey,
    persistNewSession: true,
    chatInputRef: { current: { rekeyDraft: (...args) => inputRekeys.push(args) } },
    onSessionCreated: (...args) => { created.push(args); promoted.resolve(); },
  };
  view = await mount(t, createElement(I18nProvider, null,
    createElement(SessionProbe, { options, capture: value => { current = value; } })), {
    strict: true,
    setup(window) {
      window.localStorage.setItem("pi-tool-preset", preset);
      window.localStorage.setItem(storageKey(draftKey), JSON.stringify({ value: "outgoing unsent text" }));
      window.localStorage.setItem(storageKey("next-chat"), JSON.stringify({ value: "next input" }));
    },
  });
  const eagerRequests = requests.filter(request => request.url === "/api/agent/new").length;
  // Invoke a real public action only AFTER observing eager startup. Its complete
  // promise includes ensure's finally and command/error handlers, not just fetch.
  operation = leaving
    ? owner.track("account selection rejects after real unmount", assert.rejects(
      current.handleSessionAccountChange("fixture-provider", "account", { "fixture-provider": "account" }),
      /Session selection changed/,
    ))
    : owner.track("concurrent slash-command initialization", current.loadSlashCommands());
  return {
    view, requests, created, inputRekeys, draftKey, savedId, storageKey, eagerRequests,
    async complete() {
      await act(async () => { response.resolve(); await operation; await promoted.promise; });
    },
  };
}

test("mounted production hook: eager StrictMode startup and concurrent initialization share one non-prompt creation", async t => {
  const f = await mountedFixture(t);
  assert.equal(f.eagerRequests, 1, "creation starts before any public action, despite Strict Effects replay");
  assert.equal(f.created.length, 0);
  assert.equal(f.requests.filter(request => request.url === "/api/agent/new").length, 1);
  const request = f.requests.find(request => request.url === "/api/agent/new");
  assert.equal(request.body.type, "ensure_session");
  assert.equal(Object.hasOwn(request.body, "message"), false);
  assert.equal(Object.hasOwn(request.body, "toolNames"), false);
  await f.complete();
  assert.deepEqual(f.inputRekeys, [[f.draftKey, f.savedId]]);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0][0].messageCount, 0);
  assert.equal(f.created[0][1], f.draftKey);
  assert.deepEqual(f.requests.filter(request => request.url === `/api/agent/${f.savedId}`).map(request => request.body),
    [{ type: "get_commands" }], "initialization never sends a prompt");
});

for (const [preset, toolNames] of [["none", []], ["read-only", ["read", "grep", "find", "ls"]]]) {
  test(`mounted production hook: layout-hydrated ${preset} reaches eager creation`, async t => {
    const f = await mountedFixture(t, { preset });
    assert.equal(f.eagerRequests, 1);
    assert.deepEqual(f.requests.find(request => request.url === "/api/agent/new").body.toolNames, toolNames);
    await f.complete();
    assert.equal(f.created.length, 1);
  });
}

test("mounted production hook: unmount before delayed response rekeys outgoing stored text, never the next input", async t => {
  const f = await mountedFixture(t, { preset: "none", leaving: true });
  assert.equal(f.eagerRequests, 1);
  assert.equal(f.created.length, 0);
  await f.view.unmount();
  await f.complete();
  assert.deepEqual(f.inputRekeys, []);
  assert.equal(f.view.window.localStorage.getItem(f.storageKey(f.draftKey)), null);
  assert.deepEqual(JSON.parse(f.view.window.localStorage.getItem(f.storageKey(f.savedId))), { value: "outgoing unsent text" });
  assert.deepEqual(JSON.parse(f.view.window.localStorage.getItem(f.storageKey("next-chat"))), { value: "next input" });
  assert.equal(f.created.length, 1, "outgoing promotion is delivered for AppShell's separate adoption guard");
  assert.equal(f.created[0][1], f.draftKey);
  assert.equal(f.requests.some(request => request.url === "/api/auth/accounts/selection"), false);
});

// Extracted production-callback matrices below are NOT mounted-hook/StrictMode
// proof. They retain narrow account, restoration and error-policy coverage.
const source = ts.createSourceFile("useAgentSession.ts", readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function find(predicate, node = source) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(predicate, child));
}
const compile = node => ts.transpileModule(`(${node.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const callback = name => compile(find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name).initializer.arguments[0]);
const effectSource = compile(find(node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
  && node.arguments[0]?.getText(source).includes("if (!opts.persistNewSession || !isNew) return")).arguments[0]);
assert.match(effectSource, /void ensureNewSession\(\)/);
// Expose the existing complete then/catch chain to the test owner; change no
// callback policy. A fetch response or setImmediate is not effect settlement.
const effect = effectSource.replace("void ensureNewSession()", "return ensureNewSession()");
function fixture(t, { explicit = true, fail = false } = {}) {
  const owner = createTaskOwner(), pending = deferred(), calls = [];
  t.after(async () => { pending.resolve(); await owner.join(); });
  const context = vm.createContext({
    opts: { persistNewSession: explicit, chatInputRef: { current: { rekeyDraft: (...args) => calls.push(["input-rekey", ...args]) } } },
    isNew: true, newSessionCwd: "/new-project", newSessionDraftKey: "new:temporary:/new-project", toolPreset: "configured",
    toolPresetRef: { current: "configured" },
    sessionIdRef: { current: null }, ensuringNewSessionRef: { current: null }, newSessionPromotedRef: { current: false },
    sessionHookMountedRef: { current: true }, draftKeyAliasesRef: { current: new Map() },
    newSessionModelOverrideRef: { current: null }, thinkingLevelOverrideRef: { current: null },
    modelSpeedRef: { current: "standard" }, modelSpeedRevisionRef: { current: 0 }, newSessionAccountsRef: { current: null },
    sessionToolsPinnedRef: { current: false }, loadModelsRef: { current: null },
    getToolNamesForPreset: preset => preset === "none" ? [] : preset === "read-only" ? ["read"] : undefined, isModelSpeed: () => false,
    rekeyDraft: (...args) => calls.push(["stored-rekey", ...args]),
    onSessionCreated: (...args) => calls.push(["created", ...args]), setError: error => calls.push(["error", error]),
    setPendingModel() {}, setModelSpeed() {}, setNewSessionDefaultModel() {}, setLiveThinkingLevel() {}, setNewSessionDefaultThinkingLevel() {},
    fetch: async (_url, options) => { calls.push(["request", JSON.parse(options.body)]); await pending.promise;
      return fail ? { ok: false, status: 500 } : { ok: true, json: async () => ({ sessionId: "saved" }) }; },
  });
  context.promoteNewSession = vm.runInContext(callback("promoteNewSession"), context);
  context.ensureNewSession = vm.runInContext(callback("ensureNewSession"), context);
  const start = vm.runInContext(effect, context);
  return { context, calls, pending, owner, start: () => owner.track("complete extracted startup effect", start()) };
}

test("extracted callbacks: account change during creation applies to its saved ID", async t => {
  const f = fixture(t); const startup = f.start();
  const requests = [];
  const originalFetch = f.context.fetch;
  f.context.fetch = async (...args) => {
    if (args[0] !== "/api/auth/accounts/selection") return originalFetch(...args);
    requests.push(JSON.parse(args[1].body));
    return { ok: true, json: async () => ({ sessionId: "saved" }) };
  };
  const change = vm.runInContext(callback("handleSessionAccountChange"), f.context);
  const selection = f.owner.track("account selection including PUT handlers", change("fixture-provider", "new-account", { "fixture-provider": "new-account" }));
  assert.equal(requests.length, 0);
  f.pending.resolve(); await selection; await startup;
  assert.deepEqual(requests, [{ scope: "session", sessionId: "saved", provider: "fixture-provider", accountId: "new-account" }]);
});

test("extracted callbacks: account selection cannot mutate the outgoing session after navigation", async t => {
  const f = fixture(t); const startup = f.start();
  const change = vm.runInContext(callback("handleSessionAccountChange"), f.context);
  const rejection = f.owner.track("observed account rejection", assert.rejects(
    change("fixture-provider", "new-account", { "fixture-provider": "new-account" }), /Session selection changed/));
  f.context.sessionHookMountedRef.current = false;
  f.pending.resolve(); await rejection; await startup;
  assert.equal(f.calls.filter(([name]) => name === "request").length, 1, "only creation, never an account PUT");
});

test("extracted effect: passive project browsing does not create sessions", async t => {
  const f = fixture(t, { explicit: false }); await f.start();
  assert.deepEqual(f.calls, []);
});

test("extracted callbacks: navigation rekeys only stored outgoing text", async t => {
  const f = fixture(t); const startup = f.start(); f.context.sessionHookMountedRef.current = false;
  f.pending.resolve(); await startup;
  assert.equal(f.calls.some(([name]) => name === "input-rekey"), false);
  assert.deepEqual(f.calls.find(([name]) => name === "stored-rekey"), ["stored-rekey", "new:temporary:/new-project", "saved"]);
  assert.equal(f.calls.find(([name]) => name === "created")[2], "new:temporary:/new-project");
});

test("extracted callback: rejected send after leaving restores only the outgoing explicit-New draft", t => {
  for (const explicit of [true, false]) {
    const f = fixture(t, { explicit });
    f.context.sessionHookMountedRef.current = false;
    f.context.resolveComposerDraftKey = key => key;
    f.context.restoreDraftSubmission = (...args) => f.calls.push(["restore", ...args]);
    const restore = vm.runInContext(callback("restoreSubmission"), f.context);
    restore("rejected text", undefined, f.context.newSessionDraftKey);
    assert.equal(f.calls.length, explicit ? 1 : 0);
    if (explicit) assert.deepEqual(f.calls[0], ["restore", f.context.newSessionDraftKey, "rejected text", undefined]);
  }
});

test("extracted effect: failed creation reports an error without promotion or draft rekey", async t => {
  const f = fixture(t, { fail: true }); const startup = f.start(); f.pending.resolve(); await startup;
  assert.deepEqual(f.calls.map(([name]) => name), ["request", "error"]);
  assert.match(f.calls[1][1], /HTTP 500/);
  assert.equal(f.context.ensuringNewSessionRef.current, null);
});
