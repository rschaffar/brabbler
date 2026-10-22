import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "pi-review-tests-"));
const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { preparePluginReview, reviewManifest, reviewPage, reviewEntry, reviewPreview, reviewStream } = await jiti.import("./review-store.ts");
const { validatePluginCard } = await jiti.import("./ui.ts");
const { snapshotOperationReceipt } = await jiti.import("../operation-receipts.ts");
const { cacheSessionPath } = await jiti.import("../session-reader.ts");
const { resolveSessionReview } = await jiti.import("./review-access.ts");
const { GET } = await jiti.import("../../app/api/sessions/[id]/reviews/[reviewId]/route.ts");
async function bundle(size = 100) {
  const operationId = randomUUID();
  const ref = await preparePluginReview("example", operationId, async (writer) => {
    for (let i = 0; i < 45; i++) { await writer.begin(`Entry ${i}`, i === 0 ? "text" : "patch"); await writer.write(Buffer.from("x".repeat(size) + "\n")); await writer.end(); }
  });
  return ref;
}
function session(ref, id = randomUUID()) {
  const file = join(root, `${id}.jsonl`);
  const card = { title: "Review", operationId: ref.operationId, review: ref, actions: [] };
  const receipt = snapshotOperationReceipt("example", { version: 1, operationId: ref.operationId, card, phase: "prepared",
    authorization: { mode: "ask", source: "builtin", revision: "test", decision: "pending" }, checks: [], effectStarted: false }, 1);
  writeFileSync(file, [JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: root }),
    JSON.stringify({ type: "custom", id: "abcd1234", parentId: null, timestamp: new Date().toISOString(), customType: "pi-web:operation-receipt", data: receipt })].join("\n") + "\n");
  cacheSessionPath(id, file); return { id, file };
}
const request = (id, reviewId, query = "") => GET(new Request(`http://localhost/api/sessions/${id}/reviews/${reviewId}${query}`), { params: Promise.resolve({ id, reviewId }) });
test("immutable review pagination and exact downloads are bound to saved prepared receipts", async () => {
  const ref = await bundle(); const owner = session(ref);
  validatePluginCard({ title: "Review", operationId: ref.operationId, review: ref, actions: [] });
  assert.equal((await reviewManifest(ref, "example")).entries, 45);
  assert.equal((await reviewPage(ref, 0)).entries.length, 40); assert.equal((await reviewPage(ref, 40)).entries.length, 5);
  assert.deepEqual(await resolveSessionReview(owner.id, ref.id), { ref, pluginId: "example" });
  const page = await request(owner.id, ref.id); assert.equal(page.status, 200); assert.equal((await page.json()).total, 45);
  const patch = await request(owner.id, ref.id, "?patch=1&download=1");
  try {
    assert.equal(patch.status, 200);
    assert.equal(await patch.text(), ("x".repeat(100) + "\n").repeat(44), "download excludes the text entry and consumes every patch stream");
  } finally { if (!patch.bodyUsed) await patch.body?.cancel(); }
  const download = await request(owner.id, ref.id, "?download=1"); assert.equal((await download.text()).length, ref.bytes);
  assert.equal((await request(randomUUID(), ref.id)).status, 404);
  const unrelated = session(await bundle()); assert.equal((await request(unrelated.id, ref.id)).status, 404);
  assert.equal((await request(owner.id, ref.id, "?entry=../../secret")).status, 400);
  await assert.rejects(reviewManifest(ref, "wrong-plugin"), /mismatch/);
  assert.equal(statSync(join(root, "pi-web/reviews", ref.id, "data")).mode & 0o777, 0o600);
});
test("copied receipts retain access after parent deletion and session-file movement", async () => {
  const ref = await bundle(), parent = session(ref), fork = session(ref);
  rmSync(parent.file);
  assert.equal(await resolveSessionReview(parent.id, ref.id), null);
  const moved = join(root, "moved.jsonl"); renameSync(fork.file, moved); cacheSessionPath(fork.id, moved);
  assert.equal((await request(fork.id, ref.id, "?entry=1")).status, 200);
  // A stale cache path must not adopt another header's identity.
  writeFileSync(moved, JSON.stringify({ type: "session", version: 3, id: randomUUID(), cwd: root }) + "\n");
  assert.equal(await resolveSessionReview(fork.id, ref.id), null);
});
test("large entries remain exactly downloadable with bounded previews; corruption fails closed", async () => {
  const ref = await preparePluginReview("example", randomUUID(), async (writer) => {
    await writer.begin("Large", "patch"); for (let i = 0; i < 48; i++) await writer.write(Buffer.alloc(65536, 120)); await writer.end();
  });
  const owner = session(ref), entry = await reviewEntry(ref, 0);
  const preview = await reviewPreview(ref, entry); assert.equal(preview.complete, false); assert.equal(preview.text.length, 256 * 1024);
  const stream = await reviewStream(ref, entry), closed = once(stream, "close");
  let bytes = 0;
  try { for await (const chunk of stream) bytes += chunk.length; }
  finally { stream.destroy(); await closed; }
  assert.equal(bytes, ref.bytes); assert.equal(stream.closed, true); assert.equal(stream.fd, null);
  // Cancellation also owns the no-follow descriptor, not only successful EOF.
  const cancelled = await reviewStream(ref, entry), cancelledClosed = once(cancelled, "close");
  cancelled.destroy(); await cancelledClosed;
  assert.equal(cancelled.closed, true); assert.equal(cancelled.fd, null);
  await reviewManifest(ref, "example");
  const data = join(root, "pi-web/reviews", ref.id, "data"); const changed = readFileSync(data); changed[0] = 121; writeFileSync(data, changed);
  assert.equal((await request(owner.id, ref.id, "?patch=1")).status, 400);
  await assert.rejects(reviewManifest(ref, "example"), /integrity/);
});
test("unpublished failures are removed, completed attachments are never TTL-evicted", async () => {
  const before = readdirSync(join(root, "pi-web/reviews"));
  await assert.rejects(preparePluginReview("example", randomUUID(), async (writer) => { await writer.begin("Incomplete", "text"); throw new Error("failed build"); }), /failed build/);
  assert.deepEqual(readdirSync(join(root, "pi-web/reviews")), before);
  await assert.rejects(reviewPage({ id: "../secret", entries: 1 }, 0));
});
