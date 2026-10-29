import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { createAsyncConditionWaiter, waitForAsyncCondition } from "../e2e/async-condition.mjs";
import { sessionLaunchIdle } from "../e2e/session-launch.mjs";
import { moveSessionWhenReady } from "../e2e/session-move.mjs";
import { createTaskOwner } from "./testing/async.fixture.mjs";

// Unit-level evaluate doubles model its Promise result, not a browser or the
// application's lifecycle. No browser, server, network, or real-time deadlines.
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function observe(promise) {
  const outcome = { status: "pending" };
  void promise.then(
    (value) => { outcome.status = "fulfilled"; outcome.value = value; },
    (error) => { outcome.status = "rejected"; outcome.error = error; },
  );
  return outcome;
}

function manualClock() {
  let time = 0, nextId = 0;
  const timers = new Map();
  const scheduled = [];
  return {
    now: () => time,
    setTimer(callback, ms) {
      assert.ok(Number.isFinite(ms) && ms >= 0);
      const timer = { id: ++nextId, at: time + ms, ms, callback };
      timers.set(timer.id, timer);
      scheduled.push({ at: timer.at, ms });
      return timer.id;
    },
    clearTimer(id) { timers.delete(id); },
    pending: () => [...timers.values()].map(({ at, ms }) => ({ at, ms })),
    scheduled,
    advance(ms) {
      assert.ok(ms >= 0);
      const target = time + ms;
      while (true) {
        const due = [...timers.values()].filter((timer) => timer.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        time = due.at;
        timers.delete(due.id);
        due.callback();
      }
      time = target;
    },
    // Simulate a delayed Node timer callback without moving any deadline.
    elapse(ms) { assert.ok(ms >= 0); time += ms; },
  };
}

function assertTimedOut(outcome, timeout) {
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.error.name, "TimeoutError");
  assert.equal(outcome.error.message, `waitForAsyncCondition: Timeout ${timeout}ms exceeded`);
}

test("a pending or false Promise is not ready; a later truthy result passes unchanged", async () => {
  const clock = manualClock();
  const wait = createAsyncConditionWaiter(clock);
  const first = deferred();
  const ready = { ready: true };
  const predicate = async (id) => Boolean(id);
  const arg = "selected/session";
  let evaluations = 0;
  const page = { evaluate(fn, value) {
    assert.equal(fn, predicate);
    assert.equal(value, arg);
    evaluations++;
    return evaluations === 1 ? first.promise : Promise.resolve(ready);
  } };
  const outcome = observe(wait(page, predicate, arg));
  await nextTurn();
  assert.equal(evaluations, 1);
  assert.equal(outcome.status, "pending", "the Promise object must not count as truthy readiness");

  first.resolve(false);
  await nextTurn();
  assert.equal(outcome.status, "pending", "a resolved false must not pass");
  assert.deepEqual(clock.pending(), [{ at: 100, ms: 100 }]);
  clock.advance(99);
  await nextTurn();
  assert.equal(evaluations, 1, "do not start a concurrent read or poll before the interval");
  clock.advance(1);
  await nextTurn();
  assert.equal(evaluations, 2);
  assert.equal(outcome.status, "fulfilled");
  assert.equal(outcome.value, ready);
  assert.deepEqual(clock.pending(), []);
});

test("synchronous throws and rejected evaluations propagate the same error without polling", async () => {
  for (const mode of ["throw", "reject"]) {
    const clock = manualClock();
    const wait = createAsyncConditionWaiter(clock);
    const original = new Error(`original ${mode}`, { cause: new Error("original cause") });
    let evaluations = 0;
    const page = { evaluate() {
      evaluations++;
      if (mode === "throw") throw original;
      return Promise.reject(original);
    } };
    const outcome = observe(wait(page, async () => false));
    await nextTurn();
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error, original);
    assert.equal(evaluations, 1);
    assert.equal(clock.now(), 0, "no poll delay is needed to propagate an error");
    assert.deepEqual(clock.pending(), []);
    assert.deepEqual(clock.scheduled, [{ at: 30_000, ms: 30_000 }]);
  }
});

test("resolved falsy values keep the original truthiness semantics, without retrying errors", async () => {
  const clock = manualClock();
  const wait = createAsyncConditionWaiter(clock);
  const values = [false, undefined, null, 0, "", "ready"];
  let evaluations = 0;
  const page = { evaluate: () => Promise.resolve(values[evaluations++]) };
  const outcome = observe(wait(page, async () => false));
  await nextTurn();
  for (let index = 1; index < values.length; index++) {
    assert.equal(outcome.status, "pending");
    assert.equal(evaluations, index);
    clock.advance(100);
    await nextTurn();
  }
  assert.equal(outcome.status, "fulfilled");
  assert.equal(outcome.value, "ready");
  assert.equal(evaluations, values.length);
  assert.deepEqual(clock.pending(), []);
});

test("one absolute budget includes evaluation and polling; explicit options and args are preserved", async () => {
  const clock = manualClock();
  const wait = createAsyncConditionWaiter(clock);
  const first = deferred(), second = deferred();
  const predicate = async (arg) => arg.ready;
  const arg = Object.freeze({ ready: false });
  const options = Object.freeze({ timeout: 250, polling: 100 });
  const calls = [];
  const page = { evaluate(...args) {
    calls.push(args);
    return calls.length === 1 ? first.promise : second.promise;
  } };
  const outcome = observe(wait(page, predicate, arg, options));
  await nextTurn();
  clock.advance(80);
  first.resolve(false);
  await nextTurn();
  assert.deepEqual(clock.pending(), [{ at: 180, ms: 100 }]);
  clock.advance(100);
  await nextTurn();
  assert.equal(calls.length, 2);
  assert.deepEqual(clock.scheduled, [
    { at: 250, ms: 250 },
    { at: 180, ms: 100 },
    { at: 250, ms: 70 },
  ], "the second evaluation gets only the remaining 70ms, not a fresh 250ms");
  clock.advance(69);
  await nextTurn();
  assert.equal(outcome.status, "pending");
  clock.advance(1);
  await nextTurn();
  assertTimedOut(outcome, 250);
  assert.deepEqual(options, { timeout: 250, polling: 100 });
  for (const args of calls) {
    assert.equal(args.length, 2, "options belong to the Node waiter, not page.evaluate");
    assert.equal(args[0], predicate);
    assert.equal(args[1], arg);
  }
  second.resolve(true);
  await nextTurn();
  assertTimedOut(outcome, 250);
  assert.equal(calls.length, 2, "a late success must neither pass nor start another poll");
  assert.deepEqual(clock.pending(), []);
});

test("a poll delay is clamped to the same deadline and starts no evaluation at expiry", async () => {
  const clock = manualClock();
  const wait = createAsyncConditionWaiter(clock);
  let evaluations = 0;
  const page = { evaluate() { evaluations++; return Promise.resolve(false); } };
  const outcome = observe(wait(page, async () => false, undefined, { timeout: 60, polling: 100 }));
  await nextTurn();
  assert.deepEqual(clock.pending(), [{ at: 60, ms: 60 }]);
  clock.advance(60);
  await nextTurn();
  assertTimedOut(outcome, 60);
  assert.equal(evaluations, 1);
  assert.deepEqual(clock.pending(), []);
});

test("a truthy evaluation after the deadline cannot beat a delayed Node timer", async () => {
  const clock = manualClock();
  const wait = createAsyncConditionWaiter(clock);
  const read = deferred();
  const outcome = observe(wait({ evaluate: () => read.promise }, async () => true, undefined, { timeout: 100 }));
  await nextTurn();
  clock.elapse(101);
  read.resolve(true);
  await nextTurn();
  assertTimedOut(outcome, 100);
  assert.deepEqual(clock.pending(), []);
});

test("a stalled evaluate is default-budget bounded and its later rejection stays observed", async (t) => {
  const clock = manualClock();
  const wait = createAsyncConditionWaiter(clock);
  const read = deferred();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));
  let evaluations = 0;
  const page = { evaluate() { evaluations++; return read.promise; } };
  const outcome = observe(wait(page, async () => false));
  await nextTurn();
  clock.advance(29_999);
  await nextTurn();
  assert.equal(outcome.status, "pending");
  clock.advance(1);
  await nextTurn();
  assertTimedOut(outcome, 30_000);
  const timeoutError = outcome.error;
  assert.deepEqual(clock.pending(), []);

  read.reject(new Error("late browser read rejection"));
  await nextTurn(); // Let native Promise/unhandled-rejection bookkeeping complete.
  assert.deepEqual(unhandled, []);
  assert.equal(outcome.error, timeoutError);
  clock.advance(1000);
  await nextTurn();
  assert.equal(evaluations, 1);
  assert.deepEqual(clock.pending(), []);
});

test("omitted and empty options keep 30 seconds; explicit numeric options are unchanged", async () => {
  for (const options of [undefined, {}, { timeout: 700, polling: 25 }]) {
    const clock = manualClock();
    const wait = createAsyncConditionWaiter(clock);
    const before = options && { ...options };
    const predicate = async (arg) => arg;
    const page = { evaluate: (fn, arg) => fn(arg) };
    const outcome = observe(wait(page, predicate, "ready", options));
    await nextTurn();
    assert.equal(outcome.status, "fulfilled");
    assert.equal(outcome.value, "ready");
    assert.deepEqual(options, before);
    const timeout = options?.timeout ?? 30_000;
    assert.deepEqual(clock.scheduled, [{ at: timeout, ms: timeout }]);
    assert.deepEqual(clock.pending(), []);
  }
});

test("Session Launch idle readiness reads the real registered-wrapper response envelope", async () => {
  const snapshots = [{ running: false }, { running: true },
    { running: false, isStreaming: false, isPromptRunning: false },
    { running: true, state: { isStreaming: true, isPromptRunning: false } },
    { running: true, state: { isStreaming: false, isPromptRunning: true } },
    { running: true, state: { isStreaming: false, isPromptRunning: false } }];
  let snapshot;
  const check = new Script(`(${sessionLaunchIdle.toString()})`).runInNewContext({ fetch: async (url) => {
    assert.equal(url, "/api/agent/parent%2Fselected");
    return { ok: true, json: async () => snapshot };
  } });
  const observed = [];
  for (snapshot of snapshots) observed.push(await check("parent/selected"));
  assert.deepEqual(observed, [false, false, false, false, false, true]);
  const failed = new Script(`(${sessionLaunchIdle.toString()})`).runInNewContext({
    fetch: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(failed("selected"), /Session launch readiness HTTP 503/);
});

test("the default exported waiter refuses unbounded or unsupported options before evaluating", async () => {
  const page = { evaluate() { assert.fail("invalid options must not start a browser read"); } };
  for (const options of [{ timeout: 0 }, { timeout: -1 }, { timeout: Infinity }, { timeout: NaN },
    { polling: 0 }, { polling: "raf" }]) {
    await assert.rejects(waitForAsyncCondition(page, async () => true, undefined, options), RangeError);
  }
  await assert.rejects(waitForAsyncCondition(page, async () => true, undefined, { unknown: true }), TypeError);
});

// Actual move-helper composition with external browser/readiness/body gates only.
// This proves ordering and ownership, not native RPC startup or GUI relocation.
function moveFixture(t, { status = 200, clickError } = {}) {
  const owner = createTaskOwner();
  const gates = Object.fromEntries(["ready", "readinessEntered", "response", "clicked", "body", "bodyEntered"].map(name => [name, deferred()]));
  const sessionId = "selected/session", cwd = "/synthetic/destination";
  const accepted = { ok: true, movedIds: [sessionId] };
  const seen = { clicks: 0, responseWaits: 0, bodies: 0, detached: 0 };
  const response = {
    url: () => `http://fixture.invalid/api/sessions/${encodeURIComponent(sessionId)}/move`,
    request: () => ({ method: () => "POST", postDataJSON: () => ({ cwd }) }),
    status: () => status,
    json: async () => { seen.bodies++; gates.bodyEntered.resolve(); return gates.body.promise; },
  };
  const page = { waitForResponse(matcher) { seen.responseWaits++; seen.matcher = matcher; return gates.response.promise; } };
  const dialog = {
    getByRole(role, options) {
      assert.equal(role, "button"); assert.deepEqual(options, { name: "Move", exact: true });
      return { click: async () => {
        seen.clicks++; gates.clicked.resolve(); gates.response.resolve(response);
        if (clickError) throw clickError;
      } };
    },
    waitFor: async options => { assert.deepEqual(options, { state: "detached" }); seen.detached++; },
  };
  const waitUntil = async (actualPage, predicate, id) => {
    assert.equal(actualPage, page); assert.equal(predicate, sessionLaunchIdle); assert.equal(id, sessionId);
    gates.readinessEntered.resolve(); return gates.ready.promise;
  };
  t.after(async () => {
    gates.ready.resolve(true); gates.response.resolve(response); gates.body.resolve(accepted);
    await owner.join();
  });
  return { owner, gates, seen, response, accepted, cwd, sessionId,
    start: () => moveSessionWhenReady(page, dialog, { sessionId, cwd }, { waitUntil }) };
}

test("mobile move waits for live readiness and the full acknowledgement before dialog closure", async t => {
  const f = moveFixture(t), work = f.owner.track("successful move", f.start());
  await f.gates.readinessEntered.promise;
  assert.equal(f.seen.clicks, 0, "startup must settle before Move is dispatched");
  assert.equal(f.seen.responseWaits, 0);
  f.gates.ready.resolve(true);
  await f.gates.clicked.promise; await f.gates.bodyEntered.promise;
  assert.equal(f.seen.detached, 0, "an admitted response body must settle before dialog closure");
  assert.equal(f.seen.matcher(f.response), true);
  assert.equal(f.seen.matcher({ ...f.response, url: () => "http://fixture.invalid/api/sessions/foreign/move" }), false);
  assert.equal(f.seen.matcher({ ...f.response, request: () => ({ method: () => "GET" }) }), false);
  for (const body of [{ cwd: "/other" }, { cwd: f.cwd, extra: true }]) {
    assert.equal(f.seen.matcher({ ...f.response, request: () => ({ method: () => "POST", postDataJSON: () => body }) }), false);
  }
  f.gates.body.resolve(f.accepted); await work;
  assert.equal(f.seen.clicks, 1); assert.equal(f.seen.bodies, 1); assert.equal(f.seen.detached, 1);
});

test("failed live readiness admits no move and preserves its original error", async t => {
  const f = moveFixture(t), original = new Error("Session launch readiness HTTP 503");
  const checked = f.owner.track("readiness rejection", assert.rejects(f.start(), error => error === original));
  await f.gates.readinessEntered.promise; f.gates.ready.reject(original); await checked;
  assert.equal(f.seen.clicks, 0); assert.equal(f.seen.responseWaits, 0);
});

test("a starting-session refusal is reported directly without waiting for closure or retrying", async t => {
  const f = moveFixture(t, { status: 409 });
  const checked = f.owner.track("starting-session refusal", assert.rejects(f.start(), /Move acknowledgement failed:.*Wait for sessions to finish starting/));
  f.gates.ready.resolve(true); await f.gates.bodyEntered.promise;
  f.gates.body.resolve({ error: "Wait for sessions to finish starting before moving" }); await checked;
  assert.equal(f.seen.clicks, 1); assert.equal(f.seen.bodies, 1); assert.equal(f.seen.detached, 0);
});

test("click and admitted response-body failures are both joined and preserved", async t => {
  const click = new Error("click failed"), body = new Error("body failed");
  const f = moveFixture(t, { clickError: click });
  const checked = f.owner.track("combined action/body rejection", assert.rejects(f.start(), error => {
    assert.equal(error instanceof AggregateError, true); assert.deepEqual(error.errors, [click, body]); return true;
  }));
  f.gates.ready.resolve(true); await f.gates.bodyEntered.promise; f.gates.body.reject(body); await checked;
  assert.equal(f.seen.clicks, 1); assert.equal(f.seen.bodies, 1); assert.equal(f.seen.detached, 0);
});

test("a successful HTTP status must acknowledge the selected moved session", async t => {
  for (const body of [{ ok: false, movedIds: [] }, { ok: true, movedIds: ["foreign"] }]) {
    const f = moveFixture(t);
    const checked = f.owner.track("invalid acknowledgement", assert.rejects(f.start(), /Move acknowledgement must/));
    f.gates.ready.resolve(true); await f.gates.bodyEntered.promise; f.gates.body.resolve(body); await checked;
    assert.equal(f.seen.clicks, 1); assert.equal(f.seen.detached, 0);
  }
});
