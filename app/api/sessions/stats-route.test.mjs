import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST } = await jiti.import("./stats/route.ts");
const { cacheSessionPath, invalidateSessionListCache, invalidateSessionPathCache, invalidateSessionManagerCache } = await jiti.import("../../../lib/session-reader.ts");
const start = Date.parse("2026-10-01T00:00:00.000Z");
const at = (seconds) => new Date(start + seconds * 1000).toISOString();
const usage = (input, cost) => ({ input, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: cost } });
function exchange(prefix, parentId = null, offset = 0) {
  return [
    { type: "message", id: `${prefix}-u`, parentId, timestamp: at(offset), message: { role: "user", content: "go", timestamp: start + offset * 1000 } },
    { type: "message", id: `${prefix}-a`, parentId: `${prefix}-u`, timestamp: at(offset + 30), message: {
      role: "assistant", content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }], usage: usage(10, 0.1), timestamp: start + (offset + 30) * 1000,
    } },
  ];
}
function post(body, headers = { host: "localhost", "Content-Type": "application/json" }) {
  return POST(new Request("http://localhost/api/sessions/stats", { method: "POST", headers,
    body: typeof body === "string" ? body : JSON.stringify(body) }));
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "brabbler-agent-usage-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR, previousRegistry = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = root;
  globalThis.__piSessions = new Map();
  invalidateSessionListCache(); invalidateSessionManagerCache();
  const ids = [];
  t.after(async () => {
    globalThis.__piSessions = previousRegistry;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    for (const id of ids) invalidateSessionPathCache(id);
    invalidateSessionListCache(); invalidateSessionManagerCache();
    await rm(root, { recursive: true, force: true });
  });
  const dir = join(root, "sessions", "--work-fixture--");
  await mkdir(dir, { recursive: true });
  return { root, async write(id, entries) {
    ids.push(id);
    const path = join(dir, `2026-10-01T00-00-00-000Z_${id}.jsonl`);
    const header = { type: "session", version: 3, id, timestamp: at(0), cwd: "/work/fixture" };
    await writeFile(path, [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return path;
  } };
}

test("reads all recorded usage including compaction, branches and warming without creating wrappers; disk appends refresh", async (t) => {
  const f = await fixture(t);
  const entries = [
    ...exchange("first"),
    { type: "compaction", id: "compact", parentId: "first-a", timestamp: at(40), firstKeptEntryId: "first-u", summary: "summary", tokensBefore: 10, usage: usage(1, 0.02) },
    { type: "branch_summary", id: "branch", parentId: "compact", timestamp: at(45), fromId: "first-a", summary: "branch", usage: usage(2, 0.03) },
    { type: "usage", id: "warm", parentId: "branch", timestamp: at(46), kind: "cache_warm", usage: usage(3, 0.04) },
  ];
  const path = await f.write("stats-main", entries);
  await f.write("stats-zero", []);
  const response = await post({ ids: ["stats-main", "stats-zero", "missing", "stats-main"] });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const { stats } = await response.json();
  assert.deepEqual(Object.keys(stats).sort(), ["stats-main", "stats-zero"]);
  assert.deepEqual(stats["stats-main"].tokens, { input: 16, output: 8, cacheRead: 12, cacheWrite: 16, total: 52 });
  assert.equal(stats["stats-main"].toolCalls, 1);
  assert.ok(Math.abs(stats["stats-main"].cost - 0.19) < 1e-9);
  assert.equal(stats["stats-main"].totalActiveMs, 45_000);
  assert.equal(stats["stats-zero"].tokens.total, 0);
  assert.equal(globalThis.__piSessions.size, 0, "read-only endpoint never starts a wrapper");
  await appendFile(path, exchange("second", "warm", 100).map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const next = (await (await post({ ids: ["stats-main"] })).json()).stats["stats-main"];
  assert.equal(next.tokens.total, 71); assert.equal(next.totalActiveMs, 75_000);
  assert.equal(globalThis.__piSessions.size, 0);
});

test("prefers an alive manager, isolates unreadable IDs and refreshes its append-keyed cache without commands", async (t) => {
  const f = await fixture(t);
  await f.write("stats-live", exchange("disk"));
  let entries = exchange("live");
  entries[1].message.usage = usage(100, 1);
  let reads = 0;
  const manager = { getEntries: () => { reads++; return entries; } };
  const forbidden = () => { throw new Error("Usage must not start, send, evict or renew a wrapper"); };
  globalThis.__piSessions.set("stats-live", { isAlive: () => true, inner: { sessionManager: manager },
    send: forbidden, evictIfDiskAhead: forbidden, touch: forbidden });
  globalThis.__piSessions.set("stats-broken", { isAlive: () => true, inner: { sessionManager: { getEntries() { throw new Error("unreadable"); } } } });
  const first = (await (await post({ ids: ["stats-live", "stats-broken", "stats-live"] })).json()).stats;
  assert.equal(first["stats-live"].tokens.input, 100);
  assert.equal(Object.hasOwn(first, "stats-broken"), false);
  assert.equal(reads, 1, "duplicate IDs are read once");
  assert.deepEqual((await (await post({ ids: ["stats-live"] })).json()).stats, first);
  entries = [...entries, ...exchange("more", "live-a", 100)];
  assert.equal((await (await post({ ids: ["stats-live"] })).json()).stats["stats-live"].tokens.input, 110);
  entries = [...entries.slice(0, -1), { ...entries.at(-1), id: "replacement", message: { ...entries.at(-1).message, usage: usage(20, 2) } }];
  assert.equal((await (await post({ ids: ["stats-live"] })).json()).stats["stats-live"].tokens.input, 120);
  assert.equal(globalThis.__piSessions.size, 2);
});

test("legacy, unterminated, empty and disappeared files remain byte-for-byte read-only", async t => {
  const f = await fixture(t);
  const legacy = await f.write("stats-legacy", exchange("old"));
  const original = (await readFile(legacy, "utf8")).replace('"version":3', '"version":1').trimEnd();
  await writeFile(legacy, original);
  const empty = await f.write("stats-empty", []);
  await writeFile(empty, "");
  cacheSessionPath("stats-empty", empty);
  const removed = await f.write("stats-removed", exchange("removed"));
  await post({ ids: ["stats-removed"] }); // prime the authoritative ID→path cache
  await rm(removed);
  const replaced = await f.write("stats-replaced", exchange("replaced"));
  await post({ ids: ["stats-replaced"] });
  await writeFile(replaced, JSON.stringify({ type: "session", version: 3, id: "another-id", timestamp: at(0), cwd: "/work/fixture" }) + "\n");
  const fifo = await f.write("stats-fifo", []);
  await rm(fifo);
  execFileSync("mkfifo", [fifo]); // uncached candidate must not block targeted header discovery
  const before = await readdir(join(legacy, ".."));
  const rootBefore = await readdir(f.root);
  const stats = (await (await post({ ids: ["stats-legacy", "stats-empty", "stats-removed", "stats-replaced", "stats-fifo", "stats-uncached-missing"] })).json()).stats;
  assert.equal(stats["stats-legacy"].tokens.input, 10);
  assert.equal(Object.hasOwn(stats, "stats-empty"), false);
  assert.equal(Object.hasOwn(stats, "stats-removed"), false);
  assert.equal(Object.hasOwn(stats, "stats-replaced"), false);
  assert.equal(Object.hasOwn(stats, "stats-fifo"), false);
  assert.equal(Object.hasOwn(stats, "stats-uncached-missing"), false);
  assert.equal(await readFile(legacy, "utf8"), original, "no migration or final-newline repair");
  assert.equal(await readFile(empty, "utf8"), "", "no header initialization");
  assert.deepEqual(await readdir(join(legacy, "..")), before, "no files or directories created");
  assert.deepEqual(await readdir(f.root), rootBefore, "no persisted catalogue index from metrics discovery");
});

test("validates ID-only bounds and request trust before reads, with no-store on refusals", async (t) => {
  await fixture(t);
  for (const body of ["{", null, [], {}, { ids: [] }, { ids: ["../etc"] }, { ids: ["a"], path: "/tmp/a" },
    { ids: [1] }, { ids: Array.from({ length: 201 }, (_, i) => `s${i}`) }]) {
    const response = await post(body);
    assert.equal(response.status, 400); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const accepted = await post({ ids: Array(200).fill("missing") });
  assert.equal(accepted.status, 200);
  for (const [headers, status] of [
    [{ host: "localhost", "Content-Type": "text/plain" }, 415],
    [{ host: "attacker.invalid", "Content-Type": "application/json" }, 403],
    [{ host: "localhost", origin: "https://attacker.invalid", "Content-Type": "application/json" }, 403],
  ]) {
    const response = await post({ ids: ["a"] }, headers);
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(globalThis.__piSessions.size, 0);
});
