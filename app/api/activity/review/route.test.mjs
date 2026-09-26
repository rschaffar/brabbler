import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-activity-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { POST } = await jiti.import("./route.ts");
const { recordActivityCompletion, readActivityReview, activityReviewPath } = await jiti.import("../../../../lib/activity-review-server.ts");

test("review route shares receipts, rejects cross-site requests and refuses unrecorded results", async () => {
  const path = activityReviewPath(agentDir);
  const completion = recordActivityCompletion("root", path, 123);
  const request = (body, headers = {}) => new Request("http://localhost/api/activity/review", {
    method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request({ op: "ack", entries: [completion] }, { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(new Request("http://localhost/api/activity/review", { method: "POST", headers: { Host: "localhost" }, body: "{}" }))).status, 415);
  assert.equal((await POST(request({ op: "replace", entries: [completion] }))).status, 400);
  assert.equal((await POST(request({ op: "ack", entries: [{ sessionId: "", at: 123 }] }))).status, 400);
  assert.equal((await POST(request({ op: "ack", entries: [{ sessionId: "root", at: Number.MAX_SAFE_INTEGER }] }))).status, 409);
  assert.equal((await POST(request({ op: "ack", entries: [{ sessionId: "unknown", at: 123 }] }))).status, 409);
  assert.equal((await POST(request({ op: "ack", entries: [completion] }))).status, 200);
  assert.deepEqual(readActivityReview(path).reviewedRuns, [completion]);
});
