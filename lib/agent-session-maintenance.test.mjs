import './testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { deferred } from "./testing/async.fixture.mjs";
const { createAgentSessionMaintenanceScope } = await createJiti(import.meta.url, { fsCache: false })
  .import("./agent-session-maintenance.ts");

test("maintenance observation is inert and preserves already-started A before B and original promise", async t => {
  const scope = createAgentSessionMaintenanceScope(), gate = deferred(), events = [];
  t.after(async () => { gate.resolve(); await scope.whenSettled(); });
  const started = (async () => { events.push("A"); await gate.promise; events.push("A done"); return 42; })();
  assert.equal(scope.observe("mount-session", started), started);
  events.push("B");
  assert.deepEqual(events, ["A", "B"]);
  gate.resolve();
  assert.equal(await started, 42);
  await scope.whenSettled();
  assert.deepEqual(events, ["A", "B", "A done"]);
});

test("maintenance join includes observed child delivery and full finally work", async t => {
  const scope = createAgentSessionMaintenanceScope();
  const parent = deferred(), child = deferred(), childEntered = deferred(), final = deferred(), finalEntered = deferred();
  t.after(async () => { parent.resolve(); child.resolve(); final.resolve(); await scope.whenSettled(); });
  scope.observe("mount-session", parent.promise.then(() => {
    scope.observe("mount-tools", (async () => { childEntered.resolve(); await child.promise; })());
  }).finally(() => {
    scope.observe("receipt-reconciliation", (async () => { finalEntered.resolve(); await final.promise; })());
  }));
  let joined = false;
  const joining = scope.whenSettled().then(() => { joined = true; });
  parent.resolve();
  await Promise.all([childEntered.promise, finalEntered.promise]);
  assert.equal(joined, false);
  child.resolve();
  assert.equal(joined, false, "finally-delivered work still owns completion");
  final.resolve();
  await joining;
  assert.equal(joined, true);
});

test("a join awaits child and finally work with their own admitted callback completion", async t => {
  const scope = createAgentSessionMaintenanceScope();
  const parent = deferred(), child = deferred(), final = deferred(), handles = new Set();
  let closing = false, childCompleted = false, finalCompleted = false;
  // These callbacks ARE the admitted work, not a flush of an unknown queue.
  const callbackWork = (gate, complete) => {
    if (closing) { gate.resolve(); return gate.promise; }
    const handle = setImmediate(() => { handles.delete(handle); complete(); gate.resolve(); });
    handles.add(handle);
    return gate.promise;
  };
  t.after(async () => {
    closing = true;
    for (const handle of handles) clearImmediate(handle);
    handles.clear();
    parent.resolve(); child.resolve(); final.resolve();
    await scope.whenSettled();
  });
  scope.observe("mount-session", parent.promise.then(() => {
    scope.observe("mount-tools", callbackWork(child, () => { childCompleted = true; }).finally(() => {
      scope.observe("receipt-reconciliation", callbackWork(final, () => { finalCompleted = true; }));
    }));
  }));
  const joining = scope.whenSettled();
  parent.resolve();
  await joining;
  assert.deepEqual([childCompleted, finalCompleted], [true, true]);
});

test("maintenance failure stays observable and does not abandon a pending peer", async t => {
  const scope = createAgentSessionMaintenanceScope();
  const failed = deferred(), peer = deferred(), delivered = deferred(), expected = new Error("synthetic unexpected failure");
  const check = error => error instanceof AggregateError
    && error.errors.some(item => item.message.includes("mount-session") && item.cause === expected);
  t.after(async () => { failed.reject(expected); peer.resolve(); await assert.rejects(scope.whenSettled(), check); });
  scope.observe("mount-session", failed.promise);
  scope.observe("mount-tools", peer.promise);
  // A caller handling its own returned failure must not erase scope evidence.
  void failed.promise.catch(() => delivered.resolve());
  let complete = false;
  const joining = assert.rejects(scope.whenSettled().finally(() => { complete = true; }), check);
  failed.reject(expected);
  await delivered.promise;
  assert.equal(complete, false, "a failed peer does not finish or cancel another peer");
  peer.resolve();
  await joining;
  await assert.rejects(scope.whenSettled(), check, "a previous join cannot erase unexpected failures");
});

test("operational catch feedback and finally are observed unchanged, not rethrown as new policy", async t => {
  const scope = createAgentSessionMaintenanceScope(), gate = deferred(), feedback = [];
  t.after(async () => { gate.reject(new Error("synthetic operational error")); await scope.whenSettled(); });
  scope.observe("eager-creation", gate.promise.catch(error => { feedback.push(error.message); })
    .finally(() => { feedback.push("existing finally"); }));
  gate.reject(new Error("synthetic operational error"));
  await scope.whenSettled();
  assert.deepEqual(feedback, ["synthetic operational error", "existing finally"]);
});

test("maintenance completion is stable but neither closes admission nor caches universal idle", async t => {
  const scope = createAgentSessionMaintenanceScope(), gate = deferred();
  t.after(async () => { gate.resolve(); await scope.whenSettled(); });
  const join = scope.whenSettled;
  await join();
  scope.observe("lease-renewal", gate.promise);
  let firstDone = false, secondDone = false;
  const first = join().then(() => { firstDone = true; });
  const second = join().then(() => { secondDone = true; });
  assert.equal(scope.whenSettled, join);
  assert.equal(firstDone, false);
  assert.equal(secondDone, false);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(firstDone, true);
  assert.equal(secondDone, true);
});

test("unexpected maintenance rejection reports immediately without any join request", async t => {
  const entered = deferred(), gate = deferred(), peer = deferred(), seen = [], failure = new Error("unexpected full-chain failure");
  const scope = createAgentSessionMaintenanceScope({ reportUnexpected(name, error) { seen.push([name, error]); entered.resolve(); } });
  const check = error => error instanceof AggregateError && error.errors.some(item => item.cause === failure);
  t.after(async () => { gate.reject(failure); peer.resolve(); await assert.rejects(scope.whenSettled(), check); });
  scope.observe("mount-session", gate.promise);
  scope.observe("mount-tools", peer.promise);
  gate.reject(failure);
  await entered.promise; // No call to whenSettled has occurred before this witness.
  assert.deepEqual(seen, [["mount-session", failure]]);
  let complete = false;
  const joining = assert.rejects(scope.whenSettled().finally(() => { complete = true; }), check);
  assert.equal(complete, false, "diagnostic delivery does not finish a held peer");
  peer.resolve();
  await joining;
  await assert.rejects(scope.whenSettled(), check);
  assert.equal(seen.length, 1, "repeated joins do not duplicate ordinary diagnostics");
});

for (const kind of ["throws", "rejects"]) test(`diagnostic reporter that ${kind} cannot strand maintenance or create an ignored rejection`, async t => {
  const entered = deferred(), gate = deferred(), peer = deferred();
  const failure = new Error("unexpected operation"), reporting = new Error("diagnostic failed");
  const scope = createAgentSessionMaintenanceScope({ reportUnexpected() {
    entered.resolve();
    if (kind === "throws") throw reporting;
    return Promise.reject(reporting);
  } });
  const check = error => error instanceof AggregateError
    && error.errors.some(item => item.cause === failure)
    && error.errors.some(item => item.cause?.cause === reporting);
  t.after(async () => { gate.reject(failure); peer.resolve(); await assert.rejects(scope.whenSettled(), check); });
  scope.observe("mount-session", gate.promise);
  scope.observe("mount-tools", peer.promise);
  gate.reject(failure);
  await entered.promise;
  peer.resolve();
  await assert.rejects(scope.whenSettled(), check);
  await assert.rejects(scope.whenSettled(), check);
});
