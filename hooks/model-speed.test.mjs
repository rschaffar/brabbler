import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("useAgentSession.ts", source, ts.ScriptTarget.Latest, true);
const jiti = createJiti(import.meta.url);
const { isModelSpeed } = await jiti.import("../lib/model-speed.ts");
function select(predicate) {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(file);
  assert.equal(found.length, 1, "Extract exactly one production callback");
  return found[0];
}
const initializer = (name) => select((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name).initializer.getText(file);
const recovery = select((node) => ts.isCallExpression(node) && node.expression.getText(file) === "useEffect"
  && node.arguments[0]?.getText(file).includes("if (!modelSpeedRecovery) return;")).arguments[0].getText(file);
function evaluate(expression, bindings) {
  const js = ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness({ ignoreAbort = false } = {}) {
  const requests = [], deadlines = [], intervals = [], notices = [];
  let speed = "standard", changing = false, recoveryId = null, data = { modelSpeed: "standard" };
  const document = new EventTarget(); document.visibilityState = "visible";
  const window = new EventTarget();
  const bindings = {
    isModelSpeed, useCallback: (fn) => fn, document, window, AbortController,
    AbortSignal: {
      timeout: (ms) => { const controller = new AbortController(); deadlines.push({ ms, controller }); return controller.signal; },
      any: (signals) => AbortSignal.any(signals),
    },
    MODEL_SPEED_REQUEST_TIMEOUT_MS: 10_000, AGENT_STATE_RECONCILE_MS: 15_000,
    modelSpeedRef: { current: "standard" }, modelSpeedRevisionRef: { current: 0 }, modelSpeedChangingRef: { current: false },
    agentRunningRef: { current: false }, bashRunningRef: { current: false }, isCompacting: false, modelSwitching: false,
    sessionIdRef: { current: "session-a" }, sessionHookMountedRef: { current: true }, ensuringNewSessionRef: { current: null },
    setModelSpeed: (next) => { speed = next; }, setModelSpeedChanging: (next) => { changing = next; },
    setModelSpeedRecovery: (id) => { recoveryId = id; }, setData: (update) => { data = update(data); },
    setLiveModel() {}, setLiveThinkingLevel() {}, asConcreteThinkingLevel: (level) => level,
    addNotice: (notice) => notices.push(notice),
    setInterval: (fn, ms) => { const interval = { fn, ms, active: true }; intervals.push(interval); return interval; },
    clearInterval: (interval) => { interval.active = false; },
    sendAgentCommand: (id, command, options) => {
      let resolve, reject;
      const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
      const request = { id, command, signal: options?.signal, resolve, reject };
      requests.push(request);
      if (!ignoreAbort && request.signal) {
        const abort = () => reject(request.signal.reason);
        request.signal.addEventListener("abort", abort, { once: true });
        return pending.finally(() => request.signal.removeEventListener("abort", abort));
      }
      return pending;
    },
  };
  const change = evaluate(initializer("handleModelSpeedChange"), bindings);
  const sync = evaluate(initializer("syncLiveModel"), bindings);
  return { change, sync, requests, deadlines, intervals, notices, bindings, document, window,
    state: () => ({ speed, changing, recoveryId, data }),
    recover: () => evaluate(recovery, { ...bindings, modelSpeedRecovery: recoveryId })(),
  };
}

async function loseWrite(h) {
  const change = h.change("fast");
  assert.equal(h.requests[0].command.type, "set_model_speed");
  h.requests[0].reject(new TypeError("Acknowledgement lost after committing Fast"));
  await tick();
  assert.equal(h.requests[1].command.type, "get_state");
  return { change };
}

test("a lost save acknowledgement reconciles Fast before unlocking Send, without SSE", async () => {
  const h = harness();
  const { change } = await loseWrite(h);
  assert.equal(h.state().speed, "fast"); assert.equal(h.state().changing, true);
  h.requests[1].resolve({ modelSpeed: "fast" }); await change;
  assert.equal(h.state().speed, "fast"); assert.equal(h.state().changing, false);
  assert.equal(h.state().data.modelSpeed, "fast"); assert.equal(h.notices.length, 0);
});

test("a state read begun during saving cannot roll back the confirmed speed afterward", async () => {
  const h = harness();
  const change = h.change("fast");
  const revisionDuringSave = h.bindings.modelSpeedRevisionRef.current;
  h.requests[0].resolve({ modelSpeed: "fast" }); await change;
  h.sync({ modelSpeed: "standard" }, revisionDuringSave);
  assert.equal(h.state().speed, "fast"); assert.equal(h.bindings.modelSpeedRef.current, "fast");
  assert.equal(h.state().changing, false);
  h.sync({ modelSpeed: "standard" }, h.bindings.modelSpeedRevisionRef.current);
  assert.equal(h.state().speed, "standard", "A genuinely later authoritative read still applies");
});

test("recreation during failed-save reconciliation keeps Send blocked until the replacement is confirmed", async () => {
  const h = harness();
  const { change } = await loseWrite(h);
  h.bindings.sessionIdRef.current = "session-b";
  h.requests[1].resolve({ modelSpeed: "standard" }); await change;
  assert.equal(h.state().changing, true); assert.equal(h.state().recoveryId, "session-b");
  const cleanup = h.recover();
  try {
    assert.equal(h.requests[2].id, "session-b");
    h.requests[2].resolve({ modelSpeed: "standard" }); await tick();
    assert.equal(h.state().speed, "standard"); assert.equal(h.state().changing, false);
    assert.equal(h.state().recoveryId, null);
  } finally { cleanup(); }
});

test("recreation after acknowledgement also confirms the replacement, rather than guessing its speed", async () => {
  const h = harness(); const change = h.change("fast");
  h.bindings.sessionIdRef.current = "session-b";
  h.requests[0].resolve({ modelSpeed: "fast" }); await change;
  assert.equal(h.state().changing, true); assert.equal(h.state().recoveryId, "session-b");
  const cleanup = h.recover();
  try {
    h.requests[1].resolve({ modelSpeed: "fast" }); await tick();
    assert.equal(h.state().speed, "fast"); assert.equal(h.state().changing, false);
  } finally { cleanup(); }
});

async function enterRecovery(h) {
  const { change } = await loseWrite(h);
  h.requests[1].reject(new TypeError("State read unavailable")); await change;
  assert.equal(h.state().changing, true); assert.equal(h.state().recoveryId, "session-a");
  return h.recover();
}

for (const event of ["online", "visibilitychange"]) test(`${event} supersedes a stalled recovery read; its late response is ignored`, async () => {
  const h = harness({ ignoreAbort: true });
  const cleanup = await enterRecovery(h);
  try {
    assert.equal(h.requests.length, 3);
    (event === "online" ? h.window : h.document).dispatchEvent(new Event(event));
    assert.equal(h.requests[2].signal.aborted, true);
    assert.equal(h.requests.length, 4);
    h.requests[3].resolve({ modelSpeed: "fast" }); await tick();
    assert.equal(h.state().speed, "fast"); assert.equal(h.state().changing, false);
    h.requests[2].resolve({ modelSpeed: "standard" }); await tick();
    assert.equal(h.state().speed, "fast", "An obsolete connection cannot overwrite the recovered value");
  } finally { cleanup(); }
});

test("bounded initial reconciliation enters recovery after timeout, and polling retries timed-out recovery reads", async () => {
  const h = harness();
  const { change } = await loseWrite(h);
  assert.equal(h.deadlines[1].ms, 10_000);
  h.deadlines[1].controller.abort(new Error("Read timeout")); await change;
  assert.equal(h.state().changing, true);
  const cleanup = h.recover();
  try {
    assert.equal(h.deadlines[2].ms, 10_000);
    h.deadlines[2].controller.abort(new Error("Recovery timeout")); await tick();
    assert.equal(h.requests[2].signal.aborted, true);
    assert.equal(h.intervals[0].ms, 15_000);
    h.intervals[0].fn();
    assert.equal(h.requests.length, 4);
    h.requests[3].resolve({ modelSpeed: "fast" }); await tick();
    assert.equal(h.state().speed, "fast"); assert.equal(h.state().changing, false);
  } finally { cleanup(); }
});

test("unmount aborts recovery and a late result cannot update the former composer", async () => {
  const h = harness({ ignoreAbort: true });
  const cleanup = await enterRecovery(h); cleanup();
  assert.equal(h.requests[2].signal.aborted, true);
  h.requests[2].resolve({ modelSpeed: "standard" }); await tick();
  assert.equal(h.state().speed, "fast"); assert.equal(h.state().changing, true);
  assert.equal(h.intervals[0].active, false);
});
