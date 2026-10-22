import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const receipts = await jiti.import("./operation-receipts.ts");
const interactions = await jiti.import("./interaction-receipts.ts");
const { buildSessionContext } = await jiti.import("./session-context.ts");
const { isMessageGroupAnchor } = await jiti.import("./message-display.ts");
const operationId = "a046677d-8293-4445-9a2b-558317345abc";
const receipt = { version: 1, operationId, toolCallId: "call-1", card: {
  title: "Example operation", fields: [{ label: "Target", value: "exact target" }], patch: "exact patch",
  actions: [{ id: "approve", label: "Approve" }],
}, phase: "prepared", authorization: { mode: "allow", source: "session", revision: "revision-1", decision: "pending" },
checks: [{ name: "tests", status: "pending" }], effectStarted: false };
const entry = (id, parentId, sequence, phase = "prepared", overrides = {}) => ({
  type: "custom", customType: receipts.OPERATION_RECEIPT_TYPE, id, parentId, timestamp: "2026-10-08T10:00:00.000Z",
  data: receipts.snapshotOperationReceipt("example", { ...receipt, phase, ...overrides }, sequence),
});
const message = (id, parentId) => ({ type: "message", id, parentId, timestamp: "2026-10-08T10:00:00.000Z", message: { role: "user", content: id } });
const prepared = entry("prepared", "root", 1);
const terminal = entry("terminal", "prepared", 2, "succeeded", {
  authorization: { ...receipt.authorization, decision: "policy-authorized" }, checks: [{ name: "tests", status: "passed" }], effectStarted: true, summary: "Done",
});
const empty = () => ({ messages: [], entryIds: [] });

test("complete immutable display snapshots strip actions, correlate cards, and never claim Allow was user approval", () => {
  const input = structuredClone(receipt);
  const snapshot = receipts.snapshotOperationReceipt("example", input, 1);
  input.card.fields[0].value = "mutated";
  input.checks[0].status = "failed";
  assert.equal(snapshot.card.fields[0].value, "exact target");
  assert.equal(snapshot.checks[0].status, "pending");
  assert.deepEqual(snapshot.card.actions, []);
  assert.equal(snapshot.card.operationId, operationId);
  assert.equal(receipts.operationAuthorizationLabel(terminal.data), "Policy authorized");
  assert.match(receipts.operationOutcomeLabel(snapshot), /No terminal outcome recorded.*outcome unknown/);
  assert.equal(receipts.operationOutcomeLabel(terminal.data), "Succeeded");
  const projected = receipts.operationReceiptMessage(terminal);
  assert.equal(projected.content, receipt.card.title);
  assert.equal(projected.timestamp, Date.parse(terminal.timestamp));
  assert.equal(isMessageGroupAnchor(projected), true);
  assert.equal(projected.details.card.patch, "exact patch", "terminal needs no preceding snapshot");
});

test("malformed or unsupported receipts and unbounded card/authorization/check data stay hidden", () => {
  for (const data of [null, [], {}, { ...prepared.data, version: 2 }, { ...prepared.data, sequence: 0 },
    { ...prepared.data, sequence: Infinity }, { ...prepared.data, pluginId: "../bad" },
    { ...prepared.data, operationId: "not-a-uuid" }, { ...prepared.data, phase: "done" },
    { ...prepared.data, toolCallId: "x".repeat(257) }, { ...prepared.data, summary: "x".repeat(16385) },
    { ...prepared.data, effectStarted: "false" }, { ...prepared.data, checks: [null] },
    { ...prepared.data, checks: [{ name: "check", status: "done" }] },
    { ...prepared.data, authorization: { ...receipt.authorization, source: "x".repeat(257) } },
    { ...prepared.data, authorization: { ...receipt.authorization, revision: "" } },
    { ...prepared.data, authorization: { ...receipt.authorization, decision: "user-approved" } },
    { ...prepared.data, card: { ...receipt.card, operationId: "bad" } },
    { ...prepared.data, card: { ...receipt.card, operationId: "b046677d-8293-4445-9a2b-558317345abc" } },
    { ...prepared.data, card: { ...receipt.card, actions: null } },
    { ...prepared.data, card: { ...receipt.card, sections: Array(17).fill({ title: "section" }) } },
  ]) assert.equal(receipts.operationReceiptMessage({ ...prepared, data }), null, JSON.stringify(data)?.slice(0, 200));
  assert.equal(receipts.operationReceiptMessage({ ...prepared, timestamp: "invalid" }), null);
  const decision = { version: 1, outcome: "answered", response: { action: "approve" }, request: {
    ...receipt.card, operationId, type: "extension_ui_request", method: "plugin_card", id: "decision", pluginId: "example",
  } };
  assert.equal(interactions.readInteractionReceipt(decision).request.operationId, operationId);
  assert.equal(interactions.readInteractionReceipt({ ...decision, request: { ...decision.request, operationId: "bad" } }), null);
});

test("branch-local history chooses one latest snapshot with latest entry identity, including standalone terminals", () => {
  const entries = [message("root", null), prepared, terminal, message("after", "terminal"), message("sibling", "root")];
  assert.deepEqual(buildSessionContext(entries, "after").entryIds, ["root", "terminal", "after"]);
  assert.deepEqual(buildSessionContext(entries, "prepared").entryIds, ["root", "prepared"]);
  assert.deepEqual(buildSessionContext(entries, "sibling").entryIds, ["root", "sibling"]);
  assert.deepEqual(buildSessionContext([terminal], "terminal").entryIds, ["terminal"]);
  const failedBranch = entry("failed-branch", "prepared", 3, "failed");
  entries.push(failedBranch);
  assert.equal(buildSessionContext(entries, "terminal").messages.at(-1).details.phase, "succeeded");
  assert.equal(buildSessionContext(entries, "failed-branch").messages.at(-1).details.phase, "failed");
});

test("pagination and compaction never resurrect a preceding stage or misalign transcript IDs", () => {
  const entries = [message("root", null), prepared, message("between", "prepared"), { ...terminal, parentId: "between" },
    { type: "compaction", id: "compact", parentId: "terminal", firstKeptEntryId: "terminal", timestamp: terminal.timestamp, summary: "Summary", tokensBefore: 10 }];
  const recent = buildSessionContext(entries, "compact", { tail: 2 });
  assert.deepEqual(recent.entryIds, ["terminal", "compact"]);
  const older = buildSessionContext(entries, recent.oldestEntryId, { tail: 2, excludeLeaf: true });
  assert.deepEqual(older.entryIds, ["prepared", "between"]);
  const merged = receipts.collapseOperationReceipts({ messages: [...older.messages, ...recent.messages], entryIds: [...older.entryIds, ...recent.entryIds] });
  assert.deepEqual(merged.entryIds, ["between", "terminal", "compact"]);
  assert.equal(merged.messages.length, merged.entryIds.length);
  assert.equal(older.oldestEntryId, "prepared", "paging cursor still advances through removed stages");
  assert.deepEqual(buildSessionContext(entries, older.oldestEntryId, { tail: 1, excludeLeaf: true }).entryIds, ["root"]);
});

test("SSE dedupe and stale history cannot overwrite a newer stage even with identical or skewed timestamps", () => {
  let live = receipts.appendOperationReceipt(empty(), prepared);
  live = receipts.appendOperationReceipt(live, terminal);
  assert.deepEqual(live.entryIds, ["terminal"]);
  assert.equal(receipts.appendOperationReceipt(live, terminal), live);
  assert.equal(receipts.appendOperationReceipt(live, { ...terminal, id: "replayed" }), live);
  assert.equal(receipts.appendOperationReceipt(live, prepared), live);
  const oldHistory = receipts.appendOperationReceipt(empty(), prepared);
  assert.equal(interactions.mergeInteractionReceiptHistory(live, oldHistory), live);
  const saved = interactions.mergeInteractionReceiptHistory(oldHistory, live, Date.parse(terminal.timestamp) + 10000);
  assert.deepEqual(saved.entryIds, ["terminal"], "known operation updates survive history window timestamp cutoff");
  const newer = entry("newer-checking", "prepared", 4, "checking");
  const older = entry("older-checking", "prepared", 3, "checking");
  const repeatedStage = receipts.appendOperationReceipt(empty(), { ...newer, timestamp: "2026-10-08T09:00:00.000Z" });
  assert.equal(receipts.appendOperationReceipt(repeatedStage, older), repeatedStage);
  assert.equal(receipts.nextOperationReceiptSequence([entry("forked", null, 100)]), 101);
});

test("same operation IDs from different plugins remain independent and ordinary messages stay in place", () => {
  const first = receipts.appendOperationReceipt(empty(), prepared);
  const other = receipts.appendOperationReceipt(first, { ...prepared, id: "other-plugin", data: { ...prepared.data, pluginId: "other" } });
  assert.deepEqual(other.entryIds, ["prepared", "other-plugin"]);
  const branch = [message("root", null), prepared,
    { ...prepared, id: "other-plugin", parentId: "prepared", data: { ...prepared.data, pluginId: "other" } }];
  assert.deepEqual(buildSessionContext(branch, "other-plugin", { tail: 2 }).entryIds, ["prepared", "other-plugin"],
    "each plugin's operation consumes its own visible history slot");
  const ordinary = { role: "user", content: "middle", timestamp: Date.parse(prepared.timestamp) };
  const history = { messages: [first.messages[0], ordinary, receipts.operationReceiptMessage(terminal)], entryIds: ["prepared", "middle", "terminal"] };
  const merged = interactions.mergeInteractionReceiptHistory({ messages: [ordinary], entryIds: ["middle"] }, history);
  assert.deepEqual(merged.entryIds, ["middle", "terminal"]);
  assert.equal(merged.messages[0], ordinary);
});
