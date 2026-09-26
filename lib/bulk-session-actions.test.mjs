import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { runBulkSessionAction } = await jiti.import("./bulk-session-actions.ts");

test("archives selected IDs once and sequentially, reporting conflicts without aborting", async () => {
  const requests = [];
  const progress = [];
  let inFlight = false;
  const result = await runBulkSessionAction(["a/b", "a/b", "busy", "third"], "archive", async (url, options) => {
    assert.equal(inFlight, false);
    inFlight = true;
    requests.push({ url, options });
    await Promise.resolve();
    inFlight = false;
    return { ok: url !== "/api/sessions/busy", status: url === "/api/sessions/busy" ? 409 : 200 };
  }, (completed) => progress.push(completed));
  assert.deepEqual(requests.map(({ url }) => url), ["/api/sessions/a%2Fb", "/api/sessions/busy", "/api/sessions/third"]);
  assert.ok(requests.every(({ options }) => options.method === "PATCH" && JSON.parse(options.body).archived === true));
  assert.deepEqual(result, { succeeded: ["a/b", "third"], failed: [{ id: "busy", status: 409 }] });
  assert.deepEqual(progress, [1, 2, 3]);
});

test("restore writes false, and delete keeps network failures for retry", async () => {
  const restore = await runBulkSessionAction(["root"], "restore", async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { archived: false });
    return { ok: true };
  });
  assert.deepEqual(restore.succeeded, ["root"]);
  const deleteCalls = [];
  const deleted = await runBulkSessionAction(["one", "two"], "delete", async (url, options) => {
    deleteCalls.push({ url, options });
    if (url.endsWith("one")) throw new Error("offline");
    return { ok: true };
  });
  assert.deepEqual(deleteCalls.map(({ options }) => options), [{ method: "DELETE" }, { method: "DELETE" }]);
  assert.deepEqual(deleted, { succeeded: ["two"], failed: [{ id: "one", status: "network" }] });
});
