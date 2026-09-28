import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const { GIT_ACTION_ANCHOR_TYPE } = await jiti.import("./git-action-types.ts");
const actionId = "12345678-1234-1234-1234-123456789abc";
const timestamp = "2026-09-28T12:00:00.000Z";
const anchor = (id, parentId, data = { version: 1, actionId }) => ({ id, parentId, timestamp, type: "custom", customType: GIT_ACTION_ANCHOR_TYPE, data });
const user = (id, parentId) => ({ id, parentId, timestamp, type: "message", message: { role: "user", content: id } });

test("plain custom anchors project small UI-only messages with parallel entry IDs", () => {
  const entries = [user("u", null), anchor("card", "u"), user("v", "card")];
  const context = buildSessionContext(entries);
  assert.deepEqual(context.entryIds, ["u", "card", "v"]);
  assert.deepEqual(context.messages[1], { role: "custom", customType: GIT_ACTION_ANCHOR_TYPE, content: "", display: true, details: { actionId }, timestamp: Date.parse(timestamp) });
  assert.deepEqual(entries[1].data, { version: 1, actionId });
  assert.equal(entries[1].type, "custom");
});

test("unrelated and malformed metadata are invisible and do not consume the tail budget", () => {
  const entries = [user("u", null), anchor("valid", "u")];
  for (const data of [{ version: 2, actionId }, { version: 1, actionId: "bad" }, { version: 1, actionId, patch: "private" }, null]) {
    entries.push(anchor(`bad-${entries.length}`, entries.at(-1).id, data));
  }
  entries.push({ ...anchor("other", entries.at(-1).id), customType: "unrelated" });
  const context = buildSessionContext(entries, undefined, { tail: 2 });
  assert.deepEqual(context.entryIds, ["u", "valid"]);
  assert.equal(context.messages.length, 2);
  assert.equal(context.hasMore, false);
});

test("anchor-only history is bounded by the visible tail and pages without duplicates", () => {
  const entries = Array.from({ length: 75 }, (_, i) => anchor(`a${i}`, i ? `a${i - 1}` : null));
  let page = buildSessionContext(entries, undefined, { tail: 7 });
  const ids = [...page.entryIds];
  while (page.hasMore) {
    assert.equal(page.messages.length, 7);
    page = buildSessionContext(entries, page.oldestEntryId, { tail: 7, excludeLeaf: true });
    ids.unshift(...page.entryIds);
  }
  assert.deepEqual(ids, entries.map((entry) => entry.id));
});

test("compaction and context edits do not erase raw branch anchors, siblings stay separate", () => {
  const entries = [user("u", null), anchor("old-card", "u"), user("kept", "old-card"),
    { id: "compact", parentId: "kept", type: "compaction", timestamp, summary: "summary", tokensBefore: 100, firstKeptEntryId: "kept" },
    { id: "edit", parentId: "compact", type: "context_edit", timestamp, targetId: "u", replacement: null },
    anchor("new-card", "edit"), anchor("sibling-card", "u")];
  const context = buildSessionContext(entries, "new-card");
  assert.deepEqual(context.entryIds, ["u", "old-card", "kept", "compact", "new-card"]);
  assert.deepEqual(buildSessionContext(entries, "sibling-card").entryIds, ["u", "sibling-card"]);
  const page = buildSessionContext(entries, "new-card", { tail: 2 });
  assert.deepEqual(page.entryIds, ["compact", "new-card"]);
  assert.deepEqual(buildSessionContext(entries, page.oldestEntryId, { tail: 3, excludeLeaf: true }).entryIds, ["u", "old-card", "kept"]);
  assert.deepEqual(buildSessionContext(entries, null).messages, []);
});

test("SDK history forks retain the selected branch's read-only references", () => {
  const manager = SessionManager.inMemory("/removed-checkout");
  manager.appendMessage({ role: "user", content: "before", timestamp: 1 });
  const entryId = manager.appendCustomEntry(GIT_ACTION_ANCHOR_TYPE, { version: 1, actionId });
  const leaf = manager.appendMessage({ role: "user", content: "after", timestamp: 2 });
  manager.appendCustomEntry(GIT_ACTION_ANCHOR_TYPE, { version: 1, actionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
  const owner = manager.getSessionId();
  manager.createBranchedSession(leaf);
  assert.notEqual(manager.getSessionId(), owner);
  const context = buildSessionContext(manager.getEntries(), manager.getLeafId());
  assert.equal(context.messages.filter((message) => message.customType === GIT_ACTION_ANCHOR_TYPE).length, 1);
  assert.deepEqual(context.messages[context.entryIds.indexOf(entryId)].details, { actionId });
});
