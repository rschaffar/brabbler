import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { deferred } from "./testing/async.fixture.mjs";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { AgentEventConnection } = await jiti.import("./agent-event-connection.ts");
const { createAgentSessionMaintenanceScope } = await jiti.import("./agent-session-maintenance.ts");

class Source {
  readyState = 0;
  onmessage = null;
  onerror = null;
  close() { this.readyState = 2; }
  connected() { this.readyState = 1; this.onmessage?.({ data: JSON.stringify({ type: "connected" }) }); }
  error() { this.readyState = 2; this.onerror?.(new Event("error")); }
}

test("maintain returns and observes the exact caught attempt without deferring source admission", async t => {
  const scope = createAgentSessionMaintenanceScope(), observed = [], sources = [], order = [];
  const connection = new AgentEventConnection({
    shouldMaintain: () => true, readinessTimeoutMs: 1000, reconnectDelayMs: 1,
    createSource() { order.push("source A"); const source = new Source(); sources.push(source); return source; },
    onEvent() {}, onMaintenanceWork(work) { observed.push(work); scope.observe("event-maintenance", work); },
  });
  t.after(async () => { connection.close(); await scope.whenSettled(); });
  const attempt = connection.maintain("A");
  order.push("caller B");
  assert.deepEqual(order, ["source A", "caller B"]);
  assert.equal(attempt, observed[0]);
  sources[0].connected();
  await attempt;
  await scope.whenSettled();
});

test("maintenance close joins its caught closed attempt; no demand creates no attempt", async t => {
  const scope = createAgentSessionMaintenanceScope(), observed = [], sources = [];
  let demand = false;
  const connection = new AgentEventConnection({
    shouldMaintain: () => demand, readinessTimeoutMs: 1000, reconnectDelayMs: 1,
    createSource() { const source = new Source(); sources.push(source); return source; }, onEvent() {},
    onMaintenanceWork(work) { observed.push(work); scope.observe("event-maintenance", work); },
  });
  t.after(async () => { connection.close(); await scope.whenSettled(); });
  await connection.maintain("A");
  assert.equal(observed.length, 0);
  assert.equal(sources.length, 0);
  demand = true;
  const caught = connection.maintain("A");
  connection.close();
  await caught;
  await scope.whenSettled();
  assert.equal(sources[0].readyState, 2);
});

test("a dispatched passive retry also reports its actual caught maintenance promise", { timeout: 5000 }, async t => {
  const scope = createAgentSessionMaintenanceScope(), observed = [], sources = [], retryEntered = deferred();
  const connection = new AgentEventConnection({
    shouldMaintain: () => true, readinessTimeoutMs: 1000, reconnectDelayMs: 1,
    createSource() {
      const source = new Source(); sources.push(source);
      if (sources.length === 2) retryEntered.resolve(source);
      return source;
    }, onEvent() {},
    onMaintenanceWork(work) { observed.push(work); scope.observe("event-maintenance", work); },
  });
  t.after(async () => { connection.close(); await scope.whenSettled(); });
  connection.maintain("A");
  sources[0].error();
  const replacement = await retryEntered.promise; // genuine existing 1ms retry, not a sleep-as-settlement
  assert.equal(observed.length, 2);
  let complete = false;
  const joining = scope.whenSettled().then(() => { complete = true; });
  assert.equal(complete, false);
  replacement.connected();
  await joining;
  assert.equal(complete, true);
});

test("an unexpected maintenance-handler failure preserves callback feedback and rejects exact promise/join", async t => {
  const scope = createAgentSessionMaintenanceScope(), raw = new Error("synthetic ready-state failure"), terminal = new Error("synthetic callback failure");
  const seen = [];
  let readyState = 0, failRead = false, onmessage;
  const source = {
    get readyState() { if (failRead) throw raw; return readyState; },
    get onmessage() { return onmessage; }, set onmessage(value) { onmessage = value; },
    onerror: null, close() {},
  };
  const connection = new AgentEventConnection({
    shouldMaintain: () => true, readinessTimeoutMs: 1000, reconnectDelayMs: 1,
    createSource: () => source, onEvent() {},
    onUnexpectedError(error) { seen.push(error); throw terminal; },
    onMaintenanceWork(work) { scope.observe("event-maintenance", work); },
  });
  const check = error => error instanceof AggregateError && error.errors.some(item => item.cause === terminal);
  t.after(async () => { connection.close(); await assert.rejects(scope.whenSettled(), check); });
  const first = connection.maintain("A");
  readyState = 1;
  source.onmessage({ data: JSON.stringify({ type: "connected" }) });
  await first;
  // The ready handshake deliberately advanced retryGeneration. Only AFTER that
  // attempt settles, fail a second maintain without another connected event.
  failRead = true;
  await assert.rejects(connection.maintain("A"), error => error === terminal);
  await assert.rejects(scope.whenSettled(), check);
  assert.deepEqual(seen, [raw]);
});
