import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const receipts = await jiti.import("./interaction-receipts.ts");
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const { isMessageGroupAnchor } = await jiti.import("./message-display.ts");
const request = { type: "extension_ui_request", id: "request", method: "confirm", title: "Continue?", message: "Details" };
const receipt = { version: 1, request, outcome: "answered", response: { confirmed: true } };
const entry = { type: "custom", customType: receipts.INTERACTION_RECEIPT_TYPE, id: "receipt", parentId: "user",
  timestamp: "2026-10-06T10:00:00.000Z", data: receipt };

const message = (id, parentId, text) => ({ type: "message", id, parentId, timestamp: entry.timestamp,
  message: { role: "user", content: text } });

test("UI projection recognizes only valid versioned receipts and preserves entry timestamps", () => {
  const projected = receipts.interactionReceiptMessage(entry);
  assert.equal(projected.role, "custom");
  assert.equal(projected.display, true);
  assert.equal(projected.content, "Continue?");
  assert.equal(projected.timestamp, Date.parse(entry.timestamp));
  assert.deepEqual(projected.details, receipt);
  assert.equal(isMessageGroupAnchor(projected), true, "saved cards cannot disappear inside collapsed process details");
  for (const data of [null, [], {}, { ...receipt, version: 2 }, { ...receipt, outcome: "completed" },
    { ...receipt, response: { value: "not a confirmation" } }, { ...receipt, request: { ...request, message: null } },
    { ...receipt, outcome: "cancelled" }, { ...receipt, response: { cancelled: true } }]) {
    assert.equal(receipts.interactionReceiptMessage({ ...entry, data }), null);
  }
  assert.equal(receipts.interactionReceiptMessage({ ...entry, customType: "other" }), null);
});

test("receipt history follows active branches, remains after compaction and pages without duplicates", () => {
  const root = message("user", null, "Start");
  const next = message("next", "receipt", "After approval");
  const alternative = message("alternative", "user", "Other branch");
  const compact = { type: "compaction", id: "compact", parentId: "next", firstKeptEntryId: "next",
    timestamp: entry.timestamp, summary: "Summary", tokensBefore: 10 };
  const entries = [root, entry, next, alternative, compact];
  assert.deepEqual(buildSessionContext(entries, "alternative").entryIds, ["user", "alternative"]);
  assert.deepEqual(buildSessionContext(entries, "receipt").entryIds, ["user", "receipt"]);
  assert.deepEqual(buildSessionContext(entries, "compact").entryIds, ["user", "receipt", "next", "compact"]);
  const recent = buildSessionContext(entries, "compact", { tail: 2 });
  assert.deepEqual(recent.entryIds, ["next", "compact"]);
  const older = buildSessionContext(entries, recent.oldestEntryId, { tail: 1, excludeLeaf: true });
  assert.deepEqual(older.entryIds, ["receipt"], "receipt counts as a visible history entry");
  assert.equal(older.hasMore, true);
  assert.deepEqual(buildSessionContext(entries, older.oldestEntryId, { tail: 1, excludeLeaf: true }).entryIds, ["user"]);
});

test("live receipt delivery deduplicates both persisted IDs and stable interaction IDs", () => {
  const empty = { messages: [], entryIds: [] };
  const live = receipts.appendInteractionReceipt(empty, entry);
  assert.equal(live.messages.length, 1);
  assert.deepEqual(live.entryIds, [entry.id]);
  assert.equal(receipts.appendInteractionReceipt(live, entry), live);
  assert.equal(receipts.appendInteractionReceipt(live, { ...entry, id: "replayed" }), live);
  assert.equal(receipts.appendInteractionReceipt(empty, { ...entry, data: {} }), empty);
  const other = receipts.appendInteractionReceipt(live, { ...entry, id: "other", data: {
    ...receipt, request: { ...request, id: "other-request" },
  } });
  assert.equal(other.messages.length, 2);
  assert.equal(other.messages.length, other.entryIds.length);
});

test("questions keep descriptions and comments, plugin decisions keep their supplied labels", () => {
  const question = { ...request, method: "ask_user", question: "Which?", context: "Context",
    options: [{ title: "A", description: "Explanation" }], allowMultiple: false, allowFreeform: true,
    allowComment: true, contextExpanded: false };
  const answered = receipts.readInteractionReceipt({ version: 1, request: question, outcome: "answered",
    response: { answer: { kind: "selection", selections: ["A"], comment: " note " } } });
  assert.equal(receipts.interactionTitle(question), "Which?");
  assert.equal(receipts.interactionAnswer(answered), "A — note");
  assert.deepEqual(answered.request.options, question.options);
  const plugin = { ...request, method: "plugin_card", pluginId: "example", actions: [{ id: "reject", label: "Reject exact candidate" }], patch: "exact patch" };
  assert.equal(receipts.interactionAnswer({ version: 1, request: plugin, outcome: "answered", response: { action: "reject" } }), "Reject exact candidate");
  assert.equal(receipts.readInteractionReceipt({ version: 1, request: { ...plugin, actions: null }, outcome: "aborted" }), null);
});

test("snapshots detach presentation data and omit live deadlines", () => {
  const live = { ...request, method: "select", options: ["A"], timeout: 100, expiresAt: 123 };
  const snapshot = receipts.snapshotInteractionRequest(live);
  live.options.push("B");
  assert.deepEqual(snapshot.options, ["A"]);
  assert.equal(snapshot.timeout, undefined);
  assert.equal(snapshot.expiresAt, undefined);
});

test("canonical receipt merging rejects siblings and respects contracted branch IDs", () => {
  const tree = [{ entry: { id: "root" }, children: [
    { entry: { id: "a-leaf" }, compressedEntryIds: ["a", "a-next"], children: [] },
    { entry: { id: "b-leaf" }, compressedEntryIds: ["b"], children: [] },
  ] }];
  assert.equal(receipts.receiptBranchContains(tree, "a-leaf", "a"), true);
  assert.equal(receipts.receiptBranchContains(tree, "b-leaf", "a"), false);
  assert.equal(receipts.receiptBranchContains(tree, "a", "a-next"), false);
  assert.equal(receipts.receiptBranchContains(tree, "a-leaf", "unknown"), false);
});

test("receipt-only history merge keeps ordinary messages and chronological order with aligned IDs", () => {
  const before = { role: "user", content: "Before", timestamp: Date.parse(entry.timestamp) - 1000 };
  const after = { role: "assistant", content: [], timestamp: Date.parse(entry.timestamp) + 1000 };
  const live = { messages: [before, after], entryIds: ["user", "after"] };
  const card = receipts.interactionReceiptMessage(entry);
  const history = { messages: [before, card, after], entryIds: ["user", "receipt", "after"] };
  const merged = receipts.mergeInteractionReceiptHistory(live, history);
  assert.deepEqual(merged.entryIds, ["user", "receipt", "after"]);
  assert.equal(merged.messages[0], before);
  assert.equal(merged.messages[2], after);
  assert.equal(receipts.mergeInteractionReceiptHistory(merged, history), merged);
  const unloaded = { messages: [after], entryIds: ["after"] };
  assert.equal(receipts.mergeInteractionReceiptHistory(unloaded, history), unloaded, "do not pull old cards outside the displayed history window");
});
