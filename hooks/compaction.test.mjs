import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("useAgentSession.ts", source, ts.ScriptTarget.Latest, true);
function select(predicate, tree = file) {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(tree); assert.equal(found.length, 1, "Extract exactly one production callback");
  return found[0];
}
const callback = select((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === "reconcileAgentState").initializer.getText(file);
const phaseSetter = select((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === "setCompactionState").initializer.getText(file);
const effect = select((node) => ts.isCallExpression(node) && node.expression.getText(file) === "useEffect"
  && node.arguments[0]?.getText(file).includes("void reconcileAgentState(sid)")).arguments[0].getText(file);
function evaluate(expression, bindings) {
  const js = ts.transpileModule(`return (${expression});`, { fileName: "probe.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}
const inputSource = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const inputFile = ts.createSourceFile("ChatInput.tsx", inputSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const status = select((node) => ts.isBinaryExpression(node) && node.left.getText(inputFile) === "isCompacting"
  && node.right.getText(inputFile).includes('data-testid="compaction-status"'), inputFile).getText(inputFile);

test("composer compaction status is accessible and independent of streaming and collapsed controls", () => {
  const bindings = { React, t: (key) => key };
  assert.equal(renderToStaticMarkup(evaluate(status, { ...bindings, isCompacting: false })), "");
  const html = renderToStaticMarkup(evaluate(status, { ...bindings, isCompacting: true }));
  assert.match(html, /role="status"/); assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/); assert.match(html, /aria-hidden="true"/);
  assert.match(html, /chat.compactionInProgress/); assert.match(html, /chat.compactionProgressHelp/);
  assert.doesNotMatch(html, /role="progressbar"|aria-valuenow/);
  const busy = select((node) => ts.isJsxAttribute(node) && node.name.getText(inputFile) === "aria-busy"
    && node.parent.parent.tagName?.getText(inputFile) === "fieldset", inputFile).initializer.expression.getText(inputFile);
  assert.equal(evaluate(busy, { builtinCommandPending: true, isCompacting: true }), false, "The live region has no busy composer ancestor, including during /compact");
  assert.equal(evaluate(busy, { builtinCommandPending: true, isCompacting: false }), true);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ agentRunning = false, compacting = true } = {}) {
  const calls = [], updates = [], intervals = [];
  const document = new EventTarget(); document.visibilityState = "visible";
  const window = new EventTarget();
  let response = { running: true, state: { isCompacting: true } };
  let finished = 0;
  const bindings = {
    useCallback: (fn) => fn, agentRunning, isCompacting: compacting,
    agentRunningRef: { current: agentRunning }, sessionIdRef: { current: "session-a" },
    promptRunIdRef: { current: 1 }, modelSpeedRevisionRef: { current: 0 },
    compactionVersionRef: { current: 0 }, compactionPhaseRef: { current: { active: compacting, generation: 0 } },
    sdkAgentActiveRef: { current: false }, rpcPromptPendingRef: { current: false },
    fetch: async (url) => { calls.push(url); return { ok: true, json: async () => response }; },
    syncLiveModel() {}, setIsCompacting: (value) => updates.push(value), setAutoCompactionEnabled() {},
    setQueuedMessages() {}, normalizeQueuedMessages: (value) => value,
    setContextUsage() {}, setSystemPrompt() {}, setExtensionStatuses() {}, setExtensionWidgets() {},
    finishPromptWithoutStream: async () => { finished++; },
    document, window, AGENT_STATE_RECONCILE_MS: 15000,
    setInterval: (fn, ms) => { const interval = { fn, ms, active: true }; intervals.push(interval); return interval; },
    clearInterval: (interval) => { interval.active = false; },
  };
  bindings.setCompactionState = evaluate(phaseSetter, bindings);
  const reconcile = evaluate(callback, bindings);
  return { bindings, calls, updates, intervals, document, window, reconcile,
    setResponse: (value) => { response = value; }, finished: () => finished,
    start: () => evaluate(effect, { ...bindings, reconcileAgentState: reconcile })(),
  };
}

test("compaction-only state reconciles missed completion without requiring a running prompt", async () => {
  const h = fixture();
  await h.reconcile("session-a");
  assert.equal(h.calls.length, 1); assert.deepEqual(h.updates, [true]);
  h.setResponse({ running: false, state: { isCompacting: false } });
  await h.reconcile("session-a");
  assert.deepEqual(h.updates, [true, false]);
  assert.equal(h.finished(), 0, "manual compaction does not manufacture a completed prompt");
});

test("compaction-only polling also recovers on visibility and network return", async () => {
  const h = fixture(), cleanup = h.start();
  assert.equal(h.intervals.length, 1); assert.equal(h.intervals[0].ms, 15000);
  h.intervals[0].fn(); await tick();
  h.document.dispatchEvent(new Event("visibilitychange")); await tick();
  h.window.dispatchEvent(new Event("online")); await tick();
  assert.equal(h.calls.length, 3);
  cleanup(); assert.equal(h.intervals[0].active, false);
  h.window.dispatchEvent(new Event("online")); await tick();
  assert.equal(h.calls.length, 3, "unmount removes recovery listeners");
});

test("idle sessions do not poll or fetch, and a destroyed wrapper clears compaction", async () => {
  const idle = fixture({ compacting: false });
  assert.equal(idle.start(), undefined); await idle.reconcile("session-a");
  assert.equal(idle.calls.length, 0);
  const compacting = fixture(); compacting.setResponse({ running: false });
  await compacting.reconcile("session-a");
  assert.deepEqual(compacting.updates, [false]);
});

test("late reads from another session or prompt cannot overwrite current compaction", async () => {
  for (const change of ["session", "run"]) {
    const h = fixture();
    let resolve;
    h.bindings.fetch = () => new Promise((done) => { resolve = done; });
    const reconcile = evaluate(callback, h.bindings);
    const pending = reconcile("session-a");
    assert.equal(typeof resolve, "function");
    if (change === "session") h.bindings.sessionIdRef.current = "session-b";
    else h.bindings.promptRunIdRef.current++;
    resolve({ ok: true, json: async () => ({ running: false, state: { isCompacting: false } }) });
    await pending; assert.deepEqual(h.updates, []);
  }
});

function event(h, type) {
  const clause = select((node) => ts.isCaseClause(node) && node.expression.text === type).getText(file);
  evaluate(`() => { switch (event.type) { ${clause} } }`, { ...h.bindings,
    event: { type, aborted: true }, setCompactError() {}, setCompactResult() {},
  })();
}

test("a late snapshot cannot clear a newer compaction or resurrect an ended one in the same prompt", async () => {
  for (const restart of [false, true]) {
    const h = fixture();
    let resolve;
    const reconcile = evaluate(callback, { ...h.bindings, fetch: () => new Promise((done) => { resolve = done; }) });
    const pending = reconcile("session-a");
    event(h, "compaction_end");
    if (restart) event(h, "compaction_start");
    resolve({ ok: true, json: async () => ({ running: true, state: { isCompacting: !restart } }) });
    await pending;
    assert.deepEqual(h.updates, restart ? [false, true] : [false]);
  }
});

test("only the newest recovery read can apply, and cleanup invalidates pending reads", async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const h = fixture(), resolve = [];
    const reconcile = evaluate(callback, { ...h.bindings, fetch: () => new Promise((done) => resolve.push(done)) });
    const pending = [reconcile("session-a"), reconcile("session-a")];
    for (const index of order) {
      resolve[index]({ ok: true, json: async () => ({ running: true, state: { isCompacting: index === 0 } }) });
      await pending[index];
    }
    assert.deepEqual(h.updates, [false]);
  }
  const h = fixture(), cleanup = h.start();
  let resolve;
  const reconcile = evaluate(callback, { ...h.bindings, fetch: () => new Promise((done) => { resolve = done; }) });
  const pending = reconcile("session-a");
  cleanup();
  resolve({ ok: true, json: async () => ({ running: true, state: { isCompacting: true } }) });
  await pending; assert.deepEqual(h.updates, []);
});

test("manual completion preserves its own outcomes but cannot clear, overwrite or reload a later phase", async () => {
  for (const name of ["handleCompact", "handleBuiltinSlashCommand"]) {
    for (const phase of ["rpc-only", "own-sse", "superseded"]) {
      for (const fails of [false, true]) {
        const h = fixture(), errors = [], results = [], reloads = [];
        let resolveRead, resolveCommand, rejectCommand;
        const reconcile = evaluate(callback, { ...h.bindings, fetch: () => new Promise((done) => { resolveRead = done; }) });
        const pendingRead = reconcile("session-a");
        h.bindings.compactionPhaseRef.current.active = false;
        const fn = select((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name).initializer.arguments[0].getText(file);
        const command = evaluate(fn, { ...h.bindings, isCompacting: false,
          sendAgentCommand: () => new Promise((resolve, reject) => { resolveCommand = resolve; rejectCommand = reject; }),
          setCompactError: (value) => errors.push(value), setCompactResult: (value) => results.push(value),
          readCompactResult: () => "completed A", loadSession: async (...args) => { reloads.push(args); return null; },
          addNotice() {}, promoteNewSession() {},
        });
        const pendingCommand = command("/compact");
        assert.equal(typeof resolveCommand, "function");
        resolveRead({ ok: true, json: async () => ({ running: false, state: { isCompacting: false } }) });
        await pendingRead; assert.deepEqual(h.updates, [true]);
        if (phase !== "rpc-only") {
          event(h, "compaction_start");
          event(h, "compaction_end");
        }
        if (phase === "superseded") event(h, "compaction_start");
        if (fails) rejectCommand(new Error("A failed")); else resolveCommand({});
        await pendingCommand;
        if (phase === "superseded") {
          assert.deepEqual(h.updates, [true, true, false, true]);
          assert.deepEqual(results, [null]); assert.deepEqual(errors, [null]);
          assert.deepEqual(reloads, [], "An old command must not hide the newer composer behind loading");
        } else {
          assert.equal(h.updates.at(-1), false);
          assert.deepEqual(reloads, fails ? [] : [["session-a", true]]);
          assert.deepEqual(results, !fails ? [null, "completed A"] : name === "handleCompact" ? [null, null] : [null]);
          assert.deepEqual(errors, fails && name === "handleCompact" ? [null, "A failed"] : [null]);
        }
      }
    }
  }
});

test("a rejected /compact does not hide compaction already in progress", async () => {
  const h = fixture();
  const fn = select((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === "handleBuiltinSlashCommand").initializer.arguments[0].getText(file);
  const command = evaluate(fn, { ...h.bindings, addNotice() {} });
  assert.ok((await command("/compact")).error);
  assert.deepEqual(h.updates, []);
});

test("initial state restoration cannot overwrite compaction events received during the read", () => {
  const restore = select((node) => ts.isIfStatement(node)
    && node.expression.getText(file).includes("agentState.state.isCompacting !== undefined")
    && node.expression.getText(file).includes("compactionVersion")).getText(file);
  for (const compacting of [true, false]) {
    const updates = [], bindings = { compactionVersion: 1, compactionVersionRef: { current: 2 },
      agentState: { state: { isCompacting: compacting } }, setCompactionState: (value) => updates.push(value) };
    evaluate(`() => { ${restore} }`, bindings)();
    assert.deepEqual(updates, []);
    bindings.compactionVersion = 2;
    evaluate(`() => { ${restore} }`, bindings)();
    assert.deepEqual(updates, [compacting]);
  }
});
