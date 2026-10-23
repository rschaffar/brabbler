import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("useAgentSession.ts", readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function find(predicate, node = source) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(predicate, child));
}
const compile = node => ts.transpileModule(`(${node.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const callback = name => compile(find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name).initializer.arguments[0]);
const effect = compile(find(node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
  && node.arguments[0]?.getText(source).includes("if (!opts.persistNewSession || !isNew) return")).arguments[0]);
function fixture({ explicit = true, fail = false } = {}) {
  const pending = Promise.withResolvers(), calls = [];
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
  return { context, calls, pending, start };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test("explicit New saves once across Strict Mode replay and concurrent ensure, without sending a prompt", async () => {
  const f = fixture();
  f.start(); f.start();
  const shared = f.context.ensureNewSession();
  assert.equal(f.calls.filter(([name]) => name === "request").length, 1);
  assert.equal(f.calls[0][1].type, "ensure_session");
  assert.equal(Object.hasOwn(f.calls[0][1], "message"), false);
  assert.equal(f.calls.some(([name]) => name === "created"), false);
  f.pending.resolve(); await shared; await settled();
  assert.deepEqual(f.calls.filter(([name]) => name === "input-rekey"), [["input-rekey", "new:temporary:/new-project", "saved"]]);
  assert.equal(f.calls.filter(([name]) => name === "created").length, 1);
  assert.equal(f.calls.find(([name]) => name === "created")[1].messageCount, 0);
});

test("layout-hydrated restrictive preferences reach creation before React commits their state update", async () => {
  const layout = compile(find(node => ts.isCallExpression(node) && node.expression.getText(source) === "useLayoutEffect"
    && node.arguments[0]?.getText(source).includes("toolPresetRef.current = getPreferredToolPreset()")).arguments[0]);
  for (const preset of ["none", "read-only"]) {
    const f = fixture();
    f.context.existingSessionId = undefined;
    f.context.getPreferredToolPreset = () => preset;
    f.context.setToolPresetState = () => {}; // Deliberately no rerender before passive effects.
    vm.runInContext(layout, f.context)();
    f.start();
    assert.deepEqual(f.calls[0][1].toolNames, preset === "none" ? [] : ["read"]);
    f.pending.resolve(); await settled();
  }
});

test("an account change during creation applies to its saved ID rather than an unused provisional ref", async () => {
  const f = fixture(); f.start();
  const requests = [];
  const originalFetch = f.context.fetch;
  f.context.fetch = async (...args) => {
    if (args[0] !== "/api/auth/accounts/selection") return originalFetch(...args);
    requests.push(JSON.parse(args[1].body));
    return { ok: true, json: async () => ({ sessionId: "saved" }) };
  };
  const change = vm.runInContext(callback("handleSessionAccountChange"), f.context);
  const selection = change("fixture-provider", "new-account", { "fixture-provider": "new-account" });
  assert.equal(requests.length, 0);
  f.pending.resolve(); await selection;
  assert.deepEqual(requests, [{ scope: "session", sessionId: "saved", provider: "fixture-provider", accountId: "new-account" }]);
});

test("an account selection cannot mutate the outgoing session after navigation during creation", async () => {
  const f = fixture(); f.start();
  const change = vm.runInContext(callback("handleSessionAccountChange"), f.context);
  const selection = change("fixture-provider", "new-account", { "fixture-provider": "new-account" });
  f.context.sessionHookMountedRef.current = false;
  f.pending.resolve();
  await assert.rejects(selection, /Session selection changed/);
  assert.equal(f.calls.filter(([name]) => name === "request").length, 1, "only creation, never an account PUT");
});

test("passive project browsing does not create sessions", async () => {
  const f = fixture({ explicit: false }); f.start(); await settled();
  assert.deepEqual(f.calls, []);
});

test("navigation during creation rekeys only stored outgoing text, not the next chat's input", async () => {
  const f = fixture(); f.start(); f.context.sessionHookMountedRef.current = false;
  f.pending.resolve(); await settled();
  assert.equal(f.calls.some(([name]) => name === "input-rekey"), false);
  assert.deepEqual(f.calls.find(([name]) => name === "stored-rekey"), ["stored-rekey", "new:temporary:/new-project", "saved"]);
  assert.equal(f.calls.find(([name]) => name === "created")[2], "new:temporary:/new-project");
});

test("a rejected send after leaving an in-flight explicit New restores its outgoing draft, never the next input", () => {
  for (const explicit of [true, false]) {
    const f = fixture({ explicit });
    f.context.sessionHookMountedRef.current = false;
    f.context.resolveComposerDraftKey = key => key;
    f.context.restoreDraftSubmission = (...args) => f.calls.push(["restore", ...args]);
    const restore = vm.runInContext(callback("restoreSubmission"), f.context);
    restore("rejected text", undefined, f.context.newSessionDraftKey);
    assert.equal(f.calls.length, explicit ? 1 : 0);
    if (explicit) assert.deepEqual(f.calls[0], ["restore", f.context.newSessionDraftKey, "rejected text", undefined]);
  }
});

test("failed creation reports an error without promotion or clearing/rekeying the draft", async () => {
  const f = fixture({ fail: true }); f.start(); f.pending.resolve(); await settled();
  assert.deepEqual(f.calls.map(([name]) => name), ["request", "error"]);
  assert.match(f.calls[1][1], /HTTP 500/);
  assert.equal(f.context.ensuringNewSessionRef.current, null);
});
