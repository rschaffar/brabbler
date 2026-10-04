import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { createGitCleanupAdmission } = await jiti.import("./git-cleanup-admission.ts");
const { readGitCleanupNativeProof } = await jiti.import("./git-cleanup-operation.ts");

test("cleanup diagnostics expose no reservation, durable ACK, usage or generic proof authority", async () => {
  let read = false, began = false;
  const adapter = createGitCleanupAdmission({ agentDir: "/missing/never-read",
    readNativeProof() { read = true; return { kind: "removed", durable: true }; },
    beginIntent() { began = true; },
  });
  assert.deepEqual(Object.keys(adapter).sort(), ["onCompleted", "onFailure", "onIntent", "onRemoval"]);
  assert.equal(adapter.readRecordedRemoval, undefined); assert.equal(adapter.beginIntent, undefined);
  assert.equal(adapter.assertAdmission, undefined); assert.equal(read, false); assert.equal(began, false);
  assert.equal(readGitCleanupNativeProof({ kind: "removed", durable: true, sourceAbsent: true, adminAbsent: true }), undefined);
});

test("diagnostic callbacks are preserved without fabricating native proof or success ACK", async () => {
  const calls = [];
  const callbacks = Object.fromEntries(["onIntent", "onRemoval", "onCompleted", "onFailure"].map((key) => [key, async (value) => { calls.push([key, value]); }]));
  const adapter = createGitCleanupAdmission(callbacks), data = Object.freeze({ actionId: "historical-only" });
  for (const key of Object.keys(callbacks)) {
    assert.equal(adapter[key], callbacks[key]); assert.equal(await adapter[key](data), undefined);
  }
  assert.equal(calls.length, 4); assert.equal(readGitCleanupNativeProof(data), undefined);
});
