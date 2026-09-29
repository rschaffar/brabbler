// These exercise the actual SDK, not Pi Web's intentionally different UI reader.
// No AgentSession, provider registration or fake model call is involved.
import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { GIT_ACTION_ANCHOR_TYPE } from "./git-action-types.ts";

const actionId = "12345678-1234-1234-1234-123456789abc";
const payload = { version: 1, actionId };
const assertExcluded = (manager) => {
  const context = manager.buildSessionContext();
  assert.doesNotMatch(JSON.stringify(context.messages), new RegExp(`${actionId}|${GIT_ACTION_ANCHOR_TYPE}`));
  assert.ok(manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === GIT_ACTION_ANCHOR_TYPE));
  return context;
};

test("SessionManager.buildSessionContext excludes plain anchors while custom_message enters context", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "ordinary user turn", timestamp: 1 });
  manager.appendCustomEntry(GIT_ACTION_ANCHOR_TYPE, payload);
  manager.appendCustomMessageEntry("control-message", "custom messages DO enter model context", true);
  const context = assertExcluded(manager);
  assert.match(JSON.stringify(context.messages), /ordinary user turn/);
  assert.match(JSON.stringify(context.messages), /custom messages DO enter model context/);
});

test("SDK compaction, branch navigation and fork never convert an anchor into provider context", () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendMessage({ role: "user", content: "old turn", timestamp: 1 });
  manager.appendCustomEntry(GIT_ACTION_ANCHOR_TYPE, payload);
  const kept = manager.appendMessage({ role: "user", content: "kept turn", timestamp: 2 });
  manager.appendCompaction("short summary", kept, 100);
  manager.appendCustomEntry(GIT_ACTION_ANCHOR_TYPE, payload);
  const leaf = manager.getLeafId();
  const context = assertExcluded(manager);
  assert.doesNotMatch(JSON.stringify(context.messages), /old turn/);
  assert.match(JSON.stringify(context.messages), /short summary|kept turn/);
  manager.branch(root);
  assertExcluded(manager);
  manager.branch(leaf);
  manager.createBranchedSession(leaf);
  assertExcluded(manager);
  assert.equal(manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === GIT_ACTION_ANCHOR_TYPE).length, 2);
});
