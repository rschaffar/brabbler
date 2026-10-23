import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as promiseReactionsSettled } from "node:timers/promises";
import { createJiti } from "jiti";
import { deferred } from "./testing/async.fixture.mjs";

const { createActivityClientController } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./activity-client-controller.ts");
const session = (id, extra = {}) => ({ id, path: id, cwd: "/project", created: "2026-01-01", modified: "2026-01-01", messageCount: 0, firstMessage: "", ...extra });
const completion = (sessionId, at) => ({ sessionId, at });
const question = (sessionId, requestId) => ({ sessionId, requestId, method: "input", summary: "Question", since: 1 });
const poll = (extra = {}) => ({ sessionListVersion: 1, ...extra });
const options = { concurrency: false, timeout: 10_000 };

/** Private transport: real Response.json(), independently gated headers and body.
 * Abort is recorded but deliberately ignored, including after JSON has started.
 * Every gate is released on failure, and cleanup joins the production owner.
 */
function fixture(t, { legacy = [], sessions = [session("a"), session("b"), session("c"), session("q")] } = {}) {
  const calls = [];
  const gates = new Set();
  const timers = new Map();
  const listeners = new Set();
  const unsubs = new Set();
  const privateTasks = [];
  function track(work) {
    const task = Promise.resolve(work);
    privateTasks.push(task);
    void task.catch(() => {});
    return task;
  }
  let changed = deferred();
  let nextIndex = 0;
  let nextTimer = 0;
  let visible = true;
  let closing = false;
  let legacyReads = 0;
  let legacyClears = 0;
  let listens = 0;
  let unlistens = 0;
  let scheduleFailure;

  function wait(promise) {
    if (t.signal.aborted) return Promise.reject(t.signal.reason);
    return new Promise((resolve, reject) => {
      const abort = () => reject(t.signal.reason);
      t.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => t.signal.removeEventListener("abort", abort));
    });
  }
  function gate() {
    const result = deferred();
    gates.add(result);
    return result;
  }
  const ports = {
    request(path, init) {
      const headers = deferred();
      const bodyStarted = deferred();
      const bodyDone = deferred();
      let stream;
      let headerSent = false;
      let bodySent = false;
      const command = init.body ? JSON.parse(init.body) : undefined;
      const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), {
        headers: { "Content-Type": "application/json" },
      });
      const originalJson = response.json.bind(response);
      response.json = () => track((async () => {
        bodyStarted.resolve();
        try { return await originalJson(); }
        finally { bodyDone.resolve(); }
      })());
      const call = {
        path, init, command, bodyStarted: bodyStarted.promise, bodyDone: bodyDone.promise,
        header(status = 200) {
          if (headerSent) return;
          headerSent = true;
          // Status is immutable on a real Response; transport tests only override
          // these two metadata getters, not JSON parsing/body delivery.
          Object.defineProperties(response, { status: { value: status }, ok: { value: status >= 200 && status < 300 } });
          headers.resolve(response);
        },
        finish(data = defaultReply(command), status = 200) {
          call.header(status);
          if (bodySent) return;
          bodySent = true;
          stream.enqueue(new TextEncoder().encode(JSON.stringify(data)));
          stream.close();
        },
        fail(error = new Error("lost reply")) {
          call.header();
          if (bodySent) return;
          bodySent = true;
          stream.error(error);
        },
        rejectTransport(error = new Error("connection lost")) {
          assert.equal(headerSent, false);
          headerSent = true;
          bodySent = true;
          stream.close();
          headers.reject(error);
        },
      };
      calls.push(call);
      changed.resolve();
      changed = deferred();
      if (closing) call.finish();
      return headers.promise;
    },
    schedule(callback, ms) { if (scheduleFailure) throw scheduleFailure; const handle = ++nextTimer; timers.set(handle, { callback, ms }); return handle; },
    cancel(handle) { timers.delete(handle); },
    visible: () => visible,
    listen(callback) {
      listens++;
      listeners.add(callback);
      return () => { unlistens++; listeners.delete(callback); };
    },
    legacy: { read() { legacyReads++; return legacy; }, clear() { legacyClears++; } },
  };
  function defaultReply(command) {
    if (!command) return poll();
    if (command.op === "ack") return { reviewedRuns: command.entries, laterRuns: [] };
    if (command.op === "later") return { reviewedRuns: [], laterRuns: command.entries };
    if (command.op === "later-request") return { laterRequests: command.entries };
    return { reviewedRuns: [], laterRuns: [] };
  }
  const controller = createActivityClientController(ports);
  const constructionSnapshot = controller.getSnapshot();
  function observeCatalogue(listener) {
    return controller.observeCatalogue((version) => {
      // Independently own test callback promises too: failure cleanup must join
      // them even if a regression makes the production owner fail fast.
      try { return track(listener(version)); }
      catch (error) { return track(Promise.reject(error)); }
    });
  }
  // Catalogue publication is explicit; it never starts transport effects.
  controller.setSessions(sessions);
  async function take() {
    while (!calls[nextIndex]) await wait(changed.promise);
    return calls[nextIndex++];
  }
  async function snapshotWhere(predicate) {
    if (predicate(controller.getSnapshot())) return controller.getSnapshot();
    const found = gate();
    const unsubscribe = controller.subscribe(() => {
      const value = controller.getSnapshot();
      if (predicate(value)) found.resolve(value);
    });
    unsubs.add(unsubscribe);
    try { return await wait(found.promise); }
    finally { unsubscribe(); unsubs.delete(unsubscribe); }
  }
  async function start(data = poll()) {
    const release = controller.retain();
    const imported = await take();
    assert.equal(imported.command.op, "import");
    imported.finish();
    const observed = await take();
    assert.equal(observed.path, "/api/agent/running");
    observed.finish(data);
    await wait(controller.whenIdle());
    return release;
  }
  t.after(async () => {
    // Settle even effects admitted while an earlier write was gated. No test
    // abandons fetch/body promises or catalogue callbacks after an assertion.
    closing = true;
    changed.resolve();
    for (const unsubscribe of unsubs) unsubscribe();
    for (const pending of gates) pending.resolve();
    const disposed = controller.dispose();
    for (const call of calls) call.finish();
    const disposalResult = await Promise.allSettled([disposed]);
    for (let offset = 0; offset < privateTasks.length;) {
      const batch = privateTasks.slice(offset);
      offset = privateTasks.length;
      await Promise.allSettled(batch);
    }
    assert.equal(timers.size, 0, "cleanup removes every scheduled poll");
    assert.equal(listeners.size, 0, "cleanup removes browser listeners");
    if (disposalResult[0].status === "rejected") throw disposalResult[0].reason;
  });
  return {
    controller, constructionSnapshot, calls, timers, gate, wait, take, snapshotWhere, start, track, observeCatalogue,
    get stats() { return { legacyReads, legacyClears, listens, unlistens }; },
    failScheduling(error) { scheduleFailure = error; },
    emit() { for (const listener of [...listeners]) listener(); },
    visibility(value) { visible = value; for (const listener of [...listeners]) listener(); },
    tick() {
      assert.equal(timers.size, 1);
      const [handle, { callback, ms }] = [...timers][0];
      assert.equal(ms, 2500);
      timers.delete(handle);
      callback();
    },
  };
}

test("construction is inert; shared retainers and Strict replay do not reimport or duplicate observation", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.stats, { legacyReads: 0, legacyClears: 0, listens: 0, unlistens: 0 });
  assert.equal(c.getSnapshot(), c.getSnapshot());
  assert.equal(f.constructionSnapshot.authoritative, false);
  const first = c.retain();
  const second = c.retain();
  const imported = await f.take();
  assert.deepEqual(imported.command, { op: "import", entries: [] });
  first(); first();
  assert.equal(f.stats.unlistens, 0);
  imported.finish();
  const observed = await f.take();
  observed.finish(poll());
  await f.wait(c.whenIdle());
  assert.equal(f.timers.size, 1);
  second();
  assert.equal(f.timers.size, 0);
  const replayDisposal = c.disposeWhenUnobserved();
  const replayRelease = c.retain();
  await replayDisposal;
  const replayPoll = await f.take();
  assert.equal(replayPoll.path, "/api/agent/running");
  replayPoll.finish(poll({ sessionListVersion: 2 }));
  await f.wait(c.whenIdle());
  assert.deepEqual(f.stats, { legacyReads: 1, legacyClears: 1, listens: 2, unlistens: 1 });
  replayRelease();
  await c.disposeWhenUnobserved();
  const count = f.calls.length;
  c.retain()(); c.refresh(); c.setSessions([session("new")]);
  c.markRead("a", 1); c.markLater("a", undefined, 1);
  assert.equal(f.calls.length, count);
});

test("unexpected observer/subscriber errors remain diagnostic failures rather than being silently swallowed", options, async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const f = fixture(t);
  const c = f.controller;
  await f.start();
  const subscriberError = new Error("subscriber defect");
  const unsubscribe = c.subscribe(() => { throw subscriberError; });
  let peerCalled = false;
  const peer = c.subscribe(() => { peerCalled = true; });
  c.setSessions([session("a")]);
  assert.equal(peerCalled, true, "one failed subscriber cannot block peers");
  assert.deepEqual(errors, [["Activity subscriber failed", subscriberError]]);
  unsubscribe(); peer(); errors.length = 0;
  const schedulerError = new Error("scheduler defect");
  f.failScheduling(schedulerError);
  f.tick(); (await f.take()).finish(poll());
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(errors, [["Activity observer failed", schedulerError]]);
});

test("activation imports only valid timestamp receipts, in 1000-entry chunks, before observation", options, async (t) => {
  const legacy = Array.from({ length: 1001 }, (_, i) => completion(`s${i}`, i + 1));
  legacy.push(completion("", 1), completion("x".repeat(257), 1), completion("fraction", 1.5), completion("zero", 0));
  const f = fixture(t, { legacy });
  const release = f.controller.retain();
  const a = await f.take();
  assert.equal(a.command.entries.length, 1000);
  a.header(); await f.wait(a.bodyStarted);
  assert.equal(f.calls.length, 1, "no poll while import JSON is incomplete");
  release();
  const replay = f.controller.retain();
  a.finish();
  const b = await f.take();
  assert.deepEqual(b.command, { op: "import", entries: [completion("s1000", 1001)] });
  assert.equal(f.stats.legacyClears, 0);
  b.finish();
  const read = await f.take();
  read.finish(poll());
  await f.wait(f.controller.whenIdle());
  assert.equal(f.stats.legacyReads, 1);
  assert.equal(f.stats.legacyClears, 1);
  replay();
});

test("failed legacy import retains storage but allows authoritative observation", options, async (t) => {
  const f = fixture(t, { legacy: [completion("a", 10)] });
  f.controller.retain();
  (await f.take()).finish({ error: "unavailable" }, 500);
  const read = await f.take();
  read.finish(poll({ completedRuns: [completion("a", 10)] }));
  await f.wait(f.controller.whenIdle());
  assert.equal(f.stats.legacyClears, 0);
  assert.equal(f.controller.getSnapshot().reviewIds.has("a"), true, "legacy receipts are not local authority");
});

for (const staleFailure of [false, true]) {
  test(`A/B/A read generations ignore late aborted JSON ${staleFailure ? "failure" : "success"} and stale finally`, options, async (t) => {
    const f = fixture(t);
    const c = f.controller;
    await f.start(poll({ completedRuns: [completion("a", 1)] }));
    const original = c.getSnapshot();
    c.refresh();
    const a = await f.take(); a.header(); await f.wait(a.bodyStarted);
    c.refresh();
    const b = await f.take(); b.header(); await f.wait(b.bodyStarted);
    c.refresh();
    const latestA = await f.take();
    assert.equal(a.init.signal.aborted, true);
    assert.equal(b.init.signal.aborted, true);
    latestA.finish(poll({ completedRuns: [completion("a", 30)], runningSessionIds: ["b"] }));
    const newest = await f.snapshotWhere((s) => s.completedRunTimes.get("a") === 30);
    b.finish(poll({ completedRuns: [completion("a", 20)] }));
    if (staleFailure) a.fail(new Error("late aborted JSON failure"));
    else a.finish(poll({ completedRuns: [completion("a", 10)] }));
    await f.wait(c.whenIdle());
    assert.equal(c.getSnapshot(), newest, "stale success/error/finally cannot publish");
    assert.equal(newest.available, true);
    assert.deepEqual([...newest.runningIds], ["b"]);
    assert.equal(original.completedRunTimes.get("a"), 1, "old snapshots retain their own maps");
    assert.equal(original.runningIds.size, 0);
    assert.equal(f.timers.size, 1, "only the accepted generation schedules");
    f.tick();
    (await f.take()).finish(poll());
    await f.wait(c.whenIdle());
    assert.equal(f.timers.size, 1);
  });
}

test("hidden event invalidates ignored-abort bodies; visible/activity event observes immediately at native cadence", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ runningSessionIds: ["a"] }));
  c.refresh();
  const hiddenRead = await f.take(); hiddenRead.header(); await f.wait(hiddenRead.bodyStarted);
  const before = c.getSnapshot();
  f.visibility(false);
  assert.equal(hiddenRead.init.signal.aborted, true);
  hiddenRead.finish(poll({ runningSessionIds: ["b"] }));
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot(), before);
  assert.equal(f.timers.size, 0);
  const count = f.calls.length;
  f.emit();
  assert.equal(f.calls.length, count);
  f.visibility(true);
  const visibleRead = await f.take();
  assert.equal(visibleRead.init.cache, "no-store");
  visibleRead.finish(poll({ runningSessionIds: ["c"] }));
  await f.wait(c.whenIdle());
  assert.deepEqual([...c.getSnapshot().runningIds], ["c"]);
  f.emit();
  (await f.take()).finish(poll());
  await f.wait(c.whenIdle());
  assert.equal(f.timers.size, 1);
  assert.ok(f.calls.every((call) => ["/api/agent/running", "/api/activity/review"].includes(call.path)), "no journal/catalogue scans");
});

test("catalogue remains external; fallback only seeds pre-authority and accepted polls await observers", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  c.setSessions([session("a")], { sessionListVersion: 1, runningSessionIds: ["a"], completionNotificationSuppressedSessionIds: ["a"] });
  assert.deepEqual([...c.getSnapshot().runningIds], ["a"]);
  const callbackGate = f.gate();
  const callbackStarted = f.gate();
  const versions = [];
  const unsubscribe = f.observeCatalogue(async (version) => {
    versions.push(version);
    callbackStarted.resolve();
    await callbackGate.promise;
    c.setSessions([session("a"), session("child", { relation: { kind: "subagent", parentSessionId: "a" } })], {
      sessionListVersion: version, runningSessionIds: ["a"], completionNotificationSuppressedSessionIds: ["a"],
    });
  });
  c.retain(); (await f.take()).finish();
  (await f.take()).finish(poll({ sessionListVersion: 4, runningSessionIds: ["b"], queuedSessionIds: ["q"],
    completionNotificationSuppressedSessionIds: ["b"], completedRuns: [completion("a", 10), completion("child", 11)],
    attention: [question("q", "pending")], pauses: [{ id: "pause", sessionId: "b", state: "paused", requestedAt: 1, interrupted: true }] }));
  await f.wait(callbackStarted.promise);
  assert.equal(f.timers.size, 0, "no next poll before catalogue callback completion");
  assert.deepEqual([...c.getSnapshot().reviewIds], ["a"], "unknown child awaits external catalogue");
  callbackGate.resolve();
  await f.wait(c.whenIdle());
  const s = c.getSnapshot();
  assert.deepEqual(versions, [4]);
  assert.deepEqual([...s.runningIds], ["b"], "late catalogue fallback cannot replace authoritative running state");
  assert.deepEqual([...s.suppressedCompletionIds], ["b"]);
  assert.deepEqual([...s.queuedIds], ["q"]);
  assert.ok(Array.isArray(s.attention));
  assert.ok(Array.isArray(s.pauses));
  assert.deepEqual(s.attention, [question("q", "pending")]);
  assert.equal(s.pauses[0].interrupted, true);
  assert.deepEqual([...s.rootReviewIds], ["a"]);
  assert.deepEqual([...s.subagentReviewIds], ["child"]);
  assert.equal(f.timers.size, 1);
  unsubscribe();
  c.refresh(); (await f.take()).finish(poll()); await f.wait(c.whenIdle());
  assert.deepEqual(versions, [4]);
});

test("Read/Later require the exact rendered completion and reject live, reviewed and absent identities", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ completedRuns: [completion("a", 10), completion("b", 20), completion("c", 30)],
    runningSessionIds: ["b"], reviewedRuns: [completion("c", 30)] }));
  const before = c.getSnapshot();
  const count = f.calls.length;
  for (const at of [undefined, 9, 11, NaN]) { c.markRead("a", at); c.markLater("a", undefined, at); }
  c.markRead("b", 20); c.markLater("b", undefined, 20);
  c.markRead("c", 30); c.markLater("c", undefined, 30);
  c.markRead("missing", 10); c.markLater("missing", undefined, 10);
  assert.equal(f.calls.length, count);
  assert.equal(c.getSnapshot(), before);
  c.markLater("a", undefined, 10);
  const later = await f.take();
  assert.deepEqual(later.command, { op: "later", entries: [completion("a", 10)] });
  assert.equal(c.getSnapshot().laterIds.has("a"), true);
  assert.equal(c.getSnapshot().reviewIds.has("a"), true, "Later is not Read");
  assert.equal(c.isUnreviewedCompletion("a"), true);
  later.finish(); await f.wait(c.whenIdle());
  c.markRead("a", 10);
  const read = await f.take();
  assert.deepEqual(read.command, { op: "ack", entries: [completion("a", 10)] });
  assert.equal(c.getSnapshot().reviewIds.has("a"), false, "Read is optimistic");
  assert.equal(c.getSnapshot().laterIds.has("a"), false);
  assert.equal(c.isUnreviewedCompletion("a"), false);
  read.finish(); await f.wait(c.whenIdle());
  assert.equal(before.reviewIds.has("a"), true, "optimism cannot mutate an older snapshot");
});

test("B admitted during A drains serially in native ack/later/later-request cycles without a timer", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ completedRuns: [completion("a", 10), completion("b", 20), completion("c", 30)], attention: [question("q", "one")] }));
  c.markRead("a", 10);
  const a = await f.take();
  a.header(); await f.wait(a.bodyStarted);
  c.markRead("b", 20);
  c.markLater("c", undefined, 30);
  c.markLater("q", "one");
  assert.equal(f.calls.filter((call) => call.command?.op !== "import" && call.command).length, 1, "one in-flight POST");
  a.finish();
  const later = await f.take(); assert.deepEqual(later.command, { op: "later", entries: [completion("c", 30)] }); later.finish();
  const request = await f.take(); assert.deepEqual(request.command, { op: "later-request", entries: [{ sessionId: "q", requestId: "one" }] }); request.finish();
  const b = await f.take(); assert.deepEqual(b.command, { op: "ack", entries: [completion("b", 20)] }); b.finish();
  await f.wait(c.whenIdle());
  assert.deepEqual(f.calls.filter((call) => call.command && call.command.op !== "import").map((call) => call.command.op), ["ack", "later", "later-request", "ack"]);
  assert.equal(c.getSnapshot().laterAttentionIds.has("q"), true);
});

test("old completion/request writes and stale rendered actions cannot hide replacement identities", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ completedRuns: [completion("a", 10)], attention: [question("q", "one")] }));
  c.markRead("a", 10);
  const oldAck = await f.take();
  c.markLater("q", "one");
  c.refresh();
  const next = await f.take();
  next.finish(poll({ completedRuns: [completion("a", 11)], attention: [question("q", "two")] }));
  await f.snapshotWhere((s) => s.completedRunTimes.get("a") === 11);
  const replacement = c.getSnapshot();
  assert.equal(replacement.reviewIds.has("a"), true);
  assert.equal(replacement.laterAttentionIds.has("q"), false);
  c.markRead("a", 10); c.markLater("a", undefined, 10); c.markLater("q", "one");
  assert.equal(c.getSnapshot(), replacement);
  oldAck.finish({ reviewedRuns: [completion("a", 10)], laterRuns: [] });
  await f.wait(c.whenIdle());
  assert.equal(f.calls.filter((call) => call.command?.op === "later-request").length, 0, "poll prunes obsolete pending question before its first POST");
  assert.equal(c.getSnapshot().reviewIds.has("a"), true);
  c.markLater("q", "two");
  const newRequest = await f.take(); newRequest.header(); await f.wait(newRequest.bodyStarted);
  c.refresh();
  const third = await f.take(); third.finish(poll({ completedRuns: [completion("a", 12)], attention: [question("q", "three")] }));
  await f.snapshotWhere((s) => s.attention[0]?.requestId === "three");
  newRequest.finish({ laterRequests: [{ sessionId: "q", requestId: "two" }] });
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().laterAttentionIds.has("q"), false, "late confirmation is keyed to the old question");
  assert.equal(c.getSnapshot().reviewIds.has("a"), true);
});

test("lost durable reply recovers from poll confirmation before any retry POST", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ completedRuns: [completion("a", 10)] }));
  c.markRead("a", 10);
  const write = await f.take(); write.header(); await f.wait(write.bodyStarted); write.fail();
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, false);
  assert.equal(c.getSnapshot().reviewIds.has("a"), false, "failed reply retains optimistic receipt");
  const posts = f.calls.filter((call) => call.command?.op === "ack").length;
  c.refresh();
  const observed = await f.take();
  observed.finish(poll({ completedRuns: [completion("a", 10)], reviewedRuns: [completion("a", 10)] }));
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, true);
  assert.equal(f.calls.filter((call) => call.command?.op === "ack").length, posts);
});

test("rejected writes retain pending commands; only a successful visible poll validates a serialized retry", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  const data = poll({ completedRuns: [completion("a", 10), completion("b", 20)] });
  await f.start(data);
  c.markRead("a", 10);
  (await f.take()).finish({ error: "storage" }, 500);
  await f.wait(c.whenIdle());
  const count = f.calls.length;
  c.markRead("b", 20);
  assert.equal(f.calls.length, count, "new command does not blindly retry failed pending receipts");
  c.refresh(); (await f.take()).fail(new Error("poll offline")); await f.wait(c.whenIdle());
  assert.equal(f.calls.filter((call) => call.command?.op === "ack").length, 1);
  f.visibility(false); f.visibility(true);
  const valid = await f.take(); valid.finish(data);
  const retry = await f.take();
  assert.deepEqual(retry.command, { op: "ack", entries: [completion("a", 10), completion("b", 20)] });
  retry.finish(); await f.wait(c.whenIdle());
  // Preserve Sidebar availability semantics: a subsequent authoritative poll
  // clears the failure indicator after successful mutation completion.
  c.refresh(); (await f.take()).finish(poll({ ...data, reviewedRuns: data.completedRuns }));
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, true);
});

for (const operation of ["later", "later-request"]) {
  test(`lost ${operation} reply is reconciled durably before retry; replacement identity stays visible`, options, async (t) => {
    const f = fixture(t);
    const c = f.controller;
    await f.start(poll({ completedRuns: [completion("a", 10)], attention: [question("q", "one")] }));
    if (operation === "later") c.markLater("a", undefined, 10);
    else c.markLater("q", "one");
    const write = await f.take();
    assert.equal(write.command.op, operation);
    write.fail();
    await f.wait(c.whenIdle());
    assert.equal(c.getSnapshot().available, false);
    c.refresh();
    (await f.take()).finish(poll({ completedRuns: [completion("a", 10)], attention: [question("q", "one")],
      laterRuns: operation === "later" ? [completion("a", 10)] : [],
      laterRequests: operation === "later-request" ? [{ sessionId: "q", requestId: "one" }] : [] }));
    await f.wait(c.whenIdle());
    assert.equal(c.getSnapshot().available, true);
    assert.equal(f.calls.filter((call) => call.command?.op === operation).length, 1);
    assert.equal(operation === "later" ? c.getSnapshot().laterIds.has("a") : c.getSnapshot().laterAttentionIds.has("q"), true);
    c.refresh();
    (await f.take()).finish(poll({ completedRuns: [completion("a", 11)], attention: [question("q", "two")],
      laterRuns: [completion("a", 10)], laterRequests: [{ sessionId: "q", requestId: "one" }] }));
    await f.wait(c.whenIdle());
    assert.equal(c.getSnapshot().laterIds.has("a"), false);
    assert.equal(c.getSnapshot().laterAttentionIds.has("q"), false);
    assert.equal(c.getSnapshot().reviewIds.has("a"), true);
  });
}

test("whenIdle owns full JSON and callback completion but does not wait for a scheduled timer", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start();
  const callback = f.gate(), entered = f.gate();
  f.observeCatalogue(async () => { entered.resolve(); await callback.promise; });
  c.refresh();
  const read = await f.take(); read.header(); await f.wait(read.bodyStarted);
  let idle = false;
  const joined = f.track(c.whenIdle().then(() => { idle = true; }));
  await promiseReactionsSettled();
  assert.equal(idle, false, "headers alone do not complete owned work");
  read.finish(poll());
  await f.wait(entered.promise);
  await promiseReactionsSettled();
  assert.equal(idle, false, "accepted JSON alone does not complete catalogue work");
  callback.resolve();
  await f.wait(joined);
  assert.equal(idle, true);
  assert.equal(f.timers.size, 1, "future timers are not owned promises");
});

test("current read failure preserves the last projection but marks unavailable; later success recovers", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ runningSessionIds: ["a"] }));
  c.refresh(); (await f.take()).rejectTransport(new Error("current request failed"));
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, false);
  assert.deepEqual([...c.getSnapshot().runningIds], ["a"]);
  assert.equal(f.timers.size, 1);
  f.tick(); (await f.take()).finish(poll({ runningSessionIds: ["b"], activityReviewPersistenceFailed: true }));
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, false, "backend persistence health remains authoritative");
  assert.deepEqual([...c.getSnapshot().runningIds], ["b"]);
  f.tick(); (await f.take()).finish(poll({ runningSessionIds: ["c"] }));
  await f.wait(c.whenIdle());
  assert.equal(c.getSnapshot().available, true);
});

test("success without receipt confirmation is not a blind drain-loop retry", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  const data = poll({ completedRuns: [completion("a", 10), completion("b", 20)] });
  await f.start(data);
  c.markRead("a", 10);
  (await f.take()).finish({ reviewedRuns: [], laterRuns: [] });
  await f.wait(c.whenIdle());
  c.markRead("b", 20);
  await f.wait(c.whenIdle());
  assert.equal(f.calls.filter((call) => call.command?.op === "ack").length, 1, "another command cannot blindly retry the unconfirmed A");
  c.refresh(); (await f.take()).finish(data);
  const validated = await f.take();
  assert.deepEqual(validated.command.entries, [completion("a", 10), completion("b", 20)]);
  validated.finish();
  await f.wait(c.whenIdle());
  assert.equal(f.calls.filter((call) => call.command?.op === "ack").length, 2);
});

for (const rejectCallback of [false, true]) {
  test(`terminal disposal joins all admitted catalogue callbacks including gated ${rejectCallback ? "failure" : "success"}`, options, async (t) => {
    const f = fixture(t);
    const c = f.controller;
    const first = f.gate(), second = f.gate(), started = f.gate(), firstDone = f.gate();
    let entered = 0;
    f.observeCatalogue(async () => {
      if (++entered === 2) started.resolve();
      try { await first.promise; } finally { firstDone.resolve(); }
    });
    f.observeCatalogue(async () => { if (++entered === 2) started.resolve(); await second.promise; });
    c.retain(); (await f.take()).finish(); (await f.take()).finish(poll({ completedRuns: [completion("a", 10)] }));
    await f.wait(started.promise);
    const accepted = c.getSnapshot();
    let finished = false;
    const disposed = f.track(c.dispose().then(() => { finished = true; }));
    assert.equal(c.dispose(), c.dispose(), "dispose is idempotent");
    if (rejectCallback) first.reject(new Error("callback failed")); else first.resolve();
    await f.wait(firstDone.promise);
    // One event-loop boundary lets all rejection/teardown reactions finish;
    // it does not advance the controlled production polling scheduler.
    await promiseReactionsSettled();
    assert.equal(finished, false, "a fail-fast callback join would lose the still-gated second callback");
    const count = f.calls.length;
    c.refresh(); c.retain()(); c.markRead("a", 10); c.markLater("q", "x");
    c.setSessions([]); c.observeCatalogue(() => assert.fail("closed callback"));
    assert.equal(f.calls.length, count);
    second.resolve();
    await f.wait(disposed);
    assert.equal(finished, true);
    assert.equal(c.getSnapshot(), accepted, "stale callback failure cannot publish after teardown");
    assert.equal(f.timers.size, 0);
  });
}

test("release is replayable; terminal teardown joins ignored-abort body delivery from every generation", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  const release = await f.start(poll({ completedRuns: [completion("a", 1)] }));
  c.refresh(); const old = await f.take(); old.header(); await f.wait(old.bodyStarted);
  release();
  assert.equal(old.init.signal.aborted, true);
  c.retain(); const replay = await f.take(); replay.header(); await f.wait(replay.bodyStarted);
  const before = c.getSnapshot();
  let disposed = false;
  const teardown = f.track(c.dispose().then(() => { disposed = true; }));
  assert.equal(replay.init.signal.aborted, true);
  old.finish(poll({ completedRuns: [completion("a", 99)] }));
  await f.wait(old.bodyDone);
  await promiseReactionsSettled();
  assert.equal(disposed, false, "teardown still owns the replay JSON body");
  replay.fail(new Error("ignored abort eventually failed"));
  await f.wait(teardown);
  assert.equal(c.getSnapshot(), before);
  assert.equal(f.timers.size, 0);
});

test("dispose does not abort admitted writes; it drains pre-close B and joins complete mutation bodies without retry", options, async (t) => {
  const f = fixture(t);
  const c = f.controller;
  await f.start(poll({ completedRuns: [completion("a", 10), completion("b", 20), completion("c", 30)] }));
  c.markRead("a", 10);
  const a = await f.take(); a.header(); await f.wait(a.bodyStarted);
  c.markRead("b", 20);
  let done = false;
  const disposal = f.track(c.dispose().then(() => { done = true; }));
  c.markRead("c", 30);
  assert.equal(a.init.signal, undefined, "native writes are not tied to observation abort");
  assert.equal(done, false);
  a.finish();
  const b = await f.take();
  assert.deepEqual(b.command, { op: "ack", entries: [completion("b", 20)] });
  b.header(); await f.wait(b.bodyStarted);
  await promiseReactionsSettled();
  assert.equal(done, false);
  b.fail(new Error("terminal lost reply"));
  await f.wait(disposal);
  assert.equal(done, true);
  assert.equal(f.calls.filter((call) => call.command?.op === "ack").length, 2, "no terminal retry or post-close C");
  assert.equal(f.timers.size, 0);
});
