// Exercise the real GET boundary: tail parsing/capping belongs to the route,
// whereas cumulative statistics must still include the complete saved forest.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./[id]/route.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionManagerCache } = await jiti.import("../../../lib/session-reader.ts");

test("detail GET bounds omitted, invalid, normal and oversized tails without truncating all-entry statistics", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-detail-route-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  mkdirSync(process.env.PI_CODING_AGENT_DIR);
  const id = randomUUID(), file = join(root, `${id}.jsonl`), count = 1200;
  const timestamp = index => new Date(1_700_000_000_000 + index * 1000).toISOString();
  const usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, totalTokens: 16,
    cost: { input: 0.25, output: 0.25, cacheRead: 0, cacheWrite: 0, total: 0.5 } };
  const message = (role, text, index) => role === "user"
    ? { role, content: [{ type: "text", text }], timestamp: Date.parse(timestamp(index)) }
    : { role, content: [{ type: "text", text }], provider: "fixture", api: "openai-completions", model: "fixture",
      stopReason: "stop", usage, timestamp: Date.parse(timestamp(index)) };
  // An abandoned branch has usage outside every active-tail window.
  const entries = [
    { type: "message", id: "dead0000", parentId: null, timestamp: timestamp(0), message: message("user", "Abandoned task", 0) },
    { type: "message", id: "dead0001", parentId: "dead0000", timestamp: timestamp(1), message: message("assistant", "Abandoned answer", 1) },
  ];
  for (let i = 0; i < count; i++) entries.push({
    type: "message", id: i.toString(16).padStart(8, "0"), parentId: i === 0 ? null : (i - 1).toString(16).padStart(8, "0"),
    timestamp: timestamp(i + 2), message: message(i % 2 === 0 ? "user" : "assistant", `Message ${i}`, i + 2),
  });
  writeFileSync(file, [{ type: "session", version: 3, id, cwd: root, timestamp: timestamp(0) }, ...entries].map(row => JSON.stringify(row)).join("\n") + "\n");
  cacheSessionPath(id, file);
  try {
    // One saved session and one imported handler, not an SDK startup per parameter.
    for (const [query, expected] of [["", 50], ["?tail=NaN", 50], ["?tail=Infinity", 50], ["?tail=0", 50], ["?tail=-1", 50], ["?tail=75", 75], ["?tail=5000", 1000]]) {
      const response = await GET(new Request(`http://localhost/api/sessions/${id}${query}`), { params: Promise.resolve({ id }) });
      assert.equal(response.status, 200, query);
      const body = await response.json();
      assert.equal(body.sessionId, id);
      assert.equal(body.context.messages.length, expected, query);
      assert.deepEqual(body.context.entryIds, entries.slice(-expected).map(entry => entry.id), query);
      assert.equal(body.context.hasMore, true);
      assert.equal(body.context.messages.at(-1).content[0].text, "Message 1199");
      assert.equal(body.info.messageCount, 1202);
      assert.deepEqual(body.stats, {
        userMessages: 601, assistantMessages: 601, toolCalls: 0, toolResults: 0, totalMessages: 1202,
        tokens: { input: 6010, output: 1202, cacheRead: 1803, cacheWrite: 601, total: 9616 }, cost: 300.5,
      });
    }
  } finally {
    invalidateSessionPathCache(id); invalidateSessionManagerCache(file);
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
