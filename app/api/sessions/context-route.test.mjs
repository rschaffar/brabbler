import "../../../lib/testing/client-native-boundary.fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
  fsCache: false,
});
const { buildSessionContext } = await jiti.import("@/lib/session-context");
import { contextHandler } from "./context-handler.fixture.mjs";

test("context route: ?before pages upward without duplicating the boundary", () => {
  const entries = [];
  for (let i = 0; i < 100; i++) {
    entries.push({ id: `e${i}`, parentId: i === 0 ? null : `e${i - 1}`, type: "message", timestamp: new Date(1000 + i * 1000).toISOString(), message: { role: "user", content: `m${i}` } });
  }
  const page1 = buildSessionContext(entries, "e99", { tail: 5 }).entryIds;
  assert.deepEqual(page1, ["e95", "e96", "e97", "e98", "e99"]);
  const oldest = page1[0]; // e95
  const page2 = buildSessionContext(entries, oldest, { tail: 5, excludeLeaf: true }).entryIds;
  assert.equal(page2[page2.length - 1], "e94");
  assert.ok(!page2.includes(oldest), "boundary `before` must not be duplicated");
  assert.ok(page1.every((id) => !page2.includes(id)), "adjacent pages share no entry");
});

test("context route data reports when pagination reaches the root", () => {
  const entries = [
    { id: "e0", parentId: null, type: "message", timestamp: new Date(1000).toISOString(), message: { role: "user", content: "root" } },
  ];
  const page = buildSessionContext(entries, "e0", { tail: 50, excludeLeaf: true });
  assert.deepEqual(page.entryIds, []);
  assert.equal(page.hasMore, false);
});


test("context GET parses tail matrix and calls the production projection", async t => {
  const f = await contextHandler(t);
  for (const [query, tail] of [["", 50], ["?tail=0", 50], ["?tail=-1", 50], ["?tail=NaN", 50], ["?tail=Infinity", 50], ["?tail=5", 5], ["?tail=1001", 1000], ["?tail=1.5", 1.5]]) {
    const result = await f.get(query);
    assert.equal(result.status, 200); assert.equal(result.body.tail, tail);
    assert.deepEqual(f.calls.at(-1), ["build", undefined, { tail, excludeLeaf: false, deferThinking: false, deferToolResultImages: false, sessionId: "session" }]);
    assert.equal(result.body.context.entryIds.at(-1), "e1099");
  }
  assert.equal(f.calls.some(([name]) => name === "path" || name === "open"), false);
});

test("context GET before wins over leaf and ancestor; boundary never duplicates", async t => {
  const f = await contextHandler(t);
  const first = await f.get("?tail=5&leafId=e99");
  assert.deepEqual(first.body.context.entryIds, ["e95", "e96", "e97", "e98", "e99"]);
  const second = await f.get("?tail=5&before=e95&leafId=e99&ancestorId=e0&deferThinking&deferMedia");
  assert.equal(second.status, 200); assert.equal(second.body.before, "e95");
  assert.deepEqual(second.body.context.entryIds, ["e90", "e91", "e92", "e93", "e94"]);
  assert.deepEqual(f.calls.at(-1), ["build", "e95", { tail: 5, excludeLeaf: true, deferThinking: true, deferToolResultImages: true, sessionId: "session" }]);
  await f.get("?ancestorId=e0"); assert.equal(f.calls.at(-1)[1], "e1099");
  await f.get("?ancestorId=e0&leafId=e99"); assert.equal(f.calls.at(-1)[1], "e99");
  const root = await f.get("?before=e0"); assert.deepEqual(root.body.context.entryIds, []); assert.equal(root.body.context.hasMore, false);
});

test("context GET validates full ancestry before a bounded page and retains sibling conflict", async t => {
  const f = await contextHandler(t);
  assert.equal((await f.get("?tail=1&ancestorId=e0")).status, 200);
  const before = f.calls.filter(([name]) => name === "build").length;
  const sibling = await f.get("?tail=1&leafId=sibling&ancestorId=e0");
  assert.equal(sibling.status, 409); assert.deepEqual(sibling.body, { error: "Branch changed" });
  assert.equal(f.calls.filter(([name]) => name === "build").length, before);
});

test("context GET probes only missing anchors, and opens disk only after proven eviction", async t => {
  for (const evict of [false, true]) await t.test(String(evict), async t => {
    const f = await contextHandler(t, { evict });
    await f.get(""); await f.get("?ancestorId=e0");
    assert.equal(f.calls.some(([name]) => name === "evict"), false);
    const response = await f.get("?ancestorId=fresh-anchor");
    assert.equal(response.status, evict ? 200 : 409);
    assert.equal(f.calls.filter(([name]) => name === "evict").length, 1);
    assert.equal(f.calls.some(([name]) => name === "open"), evict);
  });
});

test("context GET disk, missing and reader failures retain distinct responses", async t => {
  for (const [options, status] of [[{ live: false }, 200], [{ live: false, missing: true }, 404], [{ live: false, failure: new Error("read failed") }, 500], [{ evict: true, missing: true }, 404]]) {
    const f = await contextHandler(t, options); const result = await f.get(options.evict ? "?ancestorId=fresh-anchor" : "");
    assert.equal(result.status, status);
    if (status === 500) assert.match(result.body.error, /read failed/);
  }
});
