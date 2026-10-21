import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { nativeCallSnapshot } = await jiti.import("./native-call-display.ts");
const { toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");

test("native snapshots preserve order and duplicate temporary IDs without merging", () => {
  const details = { calls: [
    { id: "parent/?", name: "read", args: '{"path":"a"}', status: "running" },
    { id: "parent/?", name: "read", args: '{"path":"b"}', status: "running" },
  ] };
  const before = JSON.stringify(details), result = nativeCallSnapshot(details);
  assert.equal(result.calls.length, 2); assert.match(result.calls[0].preview, /"a"/); assert.match(result.calls[1].preview, /"b"/);
  assert.equal(JSON.stringify(details), before); assert.equal("id" in result.calls[0], false);
});
test("settled snapshots replace progress and child failure never rewrites parent success", () => {
  const parent = { isError: false, details: { calls: [{ name: "read", args: "missing", status: "error", error: "synthetic", durationMs: 2 }] } };
  assert.equal(nativeCallSnapshot(parent.details).calls[0].status, "error"); assert.equal(parent.isError, false);
  assert.equal(nativeCallSnapshot({ calls: [] }).calls.length, 0);
});
test("display bounds rows/previews/errors and never treats output paths as authority", () => {
  const details = { fullOutputPath: "/synthetic/private", calls: Array.from({ length: 300 }, () => ({ name: "n".repeat(300), args: "a".repeat(500), status: "cancelled", error: "e".repeat(900) })) };
  const result = nativeCallSnapshot(details);
  assert.equal(result.calls.length, 256); assert.equal(result.omitted, 44);
  assert.equal(result.calls[0].name.length, 256); assert.equal(result.calls[0].preview.length, 200); assert.equal(result.calls[0].error.length, 500);
  assert.equal(JSON.stringify(result).includes("/synthetic/private"), false); assert.equal(details.calls[0].args.length, 500);
});
test("malformed/foreign nested metadata falls back while invalid numeric chrome is omitted", () => {
  for (const value of [null, [], { calls: null }, { calls: [{}] }, { calls: [{ name: "x", args: {}, status: "ok" }] }, { calls: [{ name: "x", args: "", status: "unfinished" }] }]) assert.equal(nativeCallSnapshot(value), null);
  assert.deepEqual(nativeCallSnapshot({ calls: [{ name: "x", args: "", status: "ok", durationMs: -1, cost: Infinity }] }).calls, [{ name: "x", preview: "", status: "ok" }]);
});
test("wire retains nested parent identity and complete parent snapshots without copying raw args", () => {
  const partialResult = { content: [], details: { calls: [{ id: "parent/?", name: "read", args: "preview", status: "running" }] } };
  const nested = toClientAgentEvent({ type: "tool_execution_update", toolCallId: "child", toolName: "read", parentToolCallId: "parent", partialResult, args: { private: "not in update wire" } });
  assert.equal(nested.parentToolCallId, "parent"); assert.equal(nested.partialResult, partialResult); assert.equal("args" in nested, false);
  const parent = toClientAgentEvent({ type: "tool_execution_update", toolCallId: "parent", toolName: "codemode", partialResult });
  assert.equal(parent.partialResult.details.calls.length, 1); assert.equal("parentToolCallId" in parent, false);
});
