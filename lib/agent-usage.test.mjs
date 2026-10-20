import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createAgentUsageCoordinator, sumAgentUsage, isSessionUsageSummary, readAgentUsage,
  formatAgentCost, formatAgentDuration, formatAgentTokens } = await createJiti(import.meta.url).import("./agent-usage.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const summary = (total = 0, cost = 0, time = 0) => ({
  tokens: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
  cost, totalActiveMs: time, toolCalls: 1,
});

function fixture(initiallyVisible = true) {
  let visible = initiallyVisible, active = 0, maximum = 0, serial = 0;
  const requests = [], writes = [], timers = new Map();
  const coordinator = createAgentUsageCoordinator({
    visible: () => visible,
    publish: (value) => writes.push(value),
    read: (ids, signal) => {
      const gate = Promise.withResolvers();
      active++; maximum = Math.max(maximum, active);
      requests.push({ ids, signal, ...gate });
      return gate.promise.finally(() => active--);
    },
    schedule: (callback, ms) => { assert.equal(ms, 3000); timers.set(++serial, callback); return serial; },
    cancel: (id) => timers.delete(id),
  });
  return { coordinator, requests, writes, timers,
    get latest() { return writes.at(-1); }, get maximum() { return maximum; },
    visibility(value) { visible = value; coordinator.visibilityChanged(); },
    fire() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); },
  };
}

test("hidden initial mount, visibility return, cancellation and final-stop reads stay single-flight", async () => {
  const f = fixture(false);
  f.coordinator.update(["root", "child"], "child");
  assert.equal(f.requests.length, 0);
  f.visibility(true);
  assert.equal(f.requests.length, 1);
  f.visibility(false);
  assert.equal(f.requests[0].signal.aborted, true);
  f.visibility(true);
  assert.equal(f.requests.length, 1, "aborting does not release the flight before settlement");
  f.requests[0].resolve({ root: summary(999) });
  await tick();
  assert.equal(f.requests.length, 2);
  assert.equal(f.latest.get("root").status, "loading", "obsolete response cannot publish");
  f.requests[1].resolve({ root: summary(), child: summary(10) });
  await tick();
  assert.equal(f.latest.get("root").status, "fresh", "zero usage is available");
  assert.equal(f.timers.size, 1);
  f.fire();
  assert.equal(f.requests.length, 3);
  f.coordinator.update(["child", "root"], "");
  assert.equal(f.requests[2].signal.aborted, true);
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve({ root: summary(999) });
  await tick();
  assert.equal(f.requests.length, 4, "the queued final-stop read is not dropped");
  f.requests[3].resolve({ root: summary(20), child: summary(10) });
  await tick();
  assert.equal(f.timers.size, 0, "idle panels do not poll");
  f.visibility(false); f.visibility(true);
  assert.equal(f.requests.length, 5, "even idle panels refresh on visibility return");
  const count = f.writes.length;
  f.coordinator.dispose();
  f.requests[4].resolve({ root: summary(500) });
  await tick();
  assert.equal(f.writes.length, count);
  assert.equal(f.maximum, 1);
});

test("deduplicates and sequentially chunks families over 200; one failed chunk remains partial", async () => {
  const f = fixture();
  const ids = Array.from({ length: 402 }, (_, i) => `s${String(i).padStart(3, "0")}`);
  f.coordinator.update([...ids, ids[0]], "");
  assert.equal(f.requests[0].ids.length, 200);
  f.requests[0].resolve(Object.fromEntries(f.requests[0].ids.map((id) => [id, summary(1, 0.01, 1000)])));
  await tick();
  assert.equal(f.requests[1].ids.length, 200);
  f.requests[1].reject(new Error("offline"));
  await tick();
  assert.equal(f.requests[2].ids.length, 2);
  f.requests[2].resolve(Object.fromEntries(f.requests[2].ids.map((id) => [id, summary()])));
  await tick();
  assert.deepEqual(f.requests.flatMap(({ ids }) => ids), ids);
  const sum = sumAgentUsage([...ids, ids[0]], f.latest);
  assert.equal(sum.total, 402);
  assert.equal(sum.available, 202);
  assert.equal(sum.loading, 0);
  assert.equal(sum.summary.tokens.total, 200);
  assert.equal(sum.summary.totalActiveMs, 200_000);
  assert.equal(f.latest.get(ids[200]).status, "unavailable");
  assert.equal(f.maximum, 1);
  f.coordinator.dispose();
});

test("failed reads retain marked stale values; successful omission clears them; family changes reject late data", async () => {
  const f = fixture();
  f.coordinator.update(["a", "b"], "a");
  f.requests[0].resolve({ a: summary(0, 0.1), b: summary(5, 0, 1000) });
  await tick();
  f.fire(); f.requests[1].reject(new Error("unavailable")); await tick();
  assert.equal(f.latest.get("a").status, "stale");
  const stale = sumAgentUsage(["a", "b"], f.latest);
  assert.equal(stale.stale, 2); assert.equal(stale.available, 2);
  assert.equal(stale.summary.cost, 0.1, "cost/tool-only values must not disappear");
  f.fire(); f.requests[2].resolve({ a: summary() }); await tick();
  assert.equal(f.latest.get("b").status, "unavailable");
  assert.equal(sumAgentUsage(["a", "b"], f.latest).available, 1);
  f.fire();
  f.coordinator.update(["new-family"], "");
  assert.equal(f.latest.has("a"), false);
  f.requests[3].resolve({ a: summary(999) }); await tick();
  f.requests[4].resolve({ "new-family": summary(7) }); await tick();
  assert.equal(f.latest.size, 1);
  assert.equal(f.latest.get("new-family").summary.tokens.total, 7);
  assert.equal(f.maximum, 1);
  f.coordinator.dispose();
});

test("validates response numbers and formats recorded zero, small cost and active duration", () => {
  assert.equal(isSessionUsageSummary(summary()), true);
  for (const value of [null, {}, { ...summary(), cost: NaN }, { ...summary(), totalActiveMs: -1 },
    { ...summary(), tokens: { ...summary().tokens, input: Infinity } }]) assert.equal(isSessionUsageSummary(value), false);
  assert.equal(formatAgentCost(0), "$0.00");
  assert.equal(formatAgentCost(0.001), "<$0.01");
  assert.equal(formatAgentTokens(1200), "1k");
  assert.equal(formatAgentDuration(3_665_000), "1h 1m");
});

test("fetch adapter sends only IDs with no-store and signal; malformed envelopes fail rather than zeroing totals", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/sessions/stats");
    assert.equal(options.method, "POST"); assert.equal(options.cache, "no-store");
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(JSON.parse(options.body), { ids: ["a"] });
    return Response.json({ stats: { a: summary() } });
  };
  assert.deepEqual(await readAgentUsage(["a"], controller.signal), { a: summary() });
  for (const body of [{}, { stats: [] }]) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(readAgentUsage(["a"], controller.signal), /Invalid agent usage/);
  }
});
