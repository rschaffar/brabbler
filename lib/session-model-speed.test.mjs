import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { appendSessionModelSpeed, readSessionModelSpeed, SESSION_MODEL_SPEED_TYPE } = await jiti.import("./session-model-speed.ts");
const { isModelSpeed, supportsModelSpeed } = await jiti.import("./model-speed.ts");
const entry = (data) => ({ type: "custom", customType: SESSION_MODEL_SPEED_TYPE, data });

test("speed has exactly two validated choices on native ChatGPT models only", () => {
  assert.equal(isModelSpeed("standard"), true);
  assert.equal(isModelSpeed("fast"), true);
  for (const value of ["ultrafast", "priority", "default", "Fast", null, undefined, {}, 1]) assert.equal(isModelSpeed(value), false);
  assert.equal(supportsModelSpeed({ provider: "openai-codex", api: "openai-codex-responses" }), true);
  for (const model of [null, { provider: "openai" }, { provider: "openai", api: "openai-responses" },
    { provider: "anthropic", api: "anthropic-messages" }, { provider: "openai-codex", api: "openai-completions" }]) {
    assert.equal(supportsModelSpeed(model), false);
  }
});

test("legacy and malformed speeds are Standard; invalid newer entries do not erase a valid preference", () => {
  assert.equal(readSessionModelSpeed([]), "standard");
  const invalid = [null, [], "fast", { version: 2, modelSpeed: "fast" }, { version: 1, modelSpeed: "ultrafast" }, { version: 1 }].map(entry);
  assert.equal(readSessionModelSpeed(invalid), "standard");
  assert.equal(readSessionModelSpeed([entry({ version: 1, modelSpeed: "fast" }), ...invalid]), "fast");
  assert.equal(readSessionModelSpeed([entry({ version: 1, modelSpeed: "fast" }), entry({ version: 1, modelSpeed: "standard" })]), "standard");
  assert.equal(readSessionModelSpeed([{ type: "custom", customType: "other", data: { version: 1, modelSpeed: "fast" } }]), "standard");
});

test("speed is append-only, session-wide across branches, and persists without entering model context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-session-speed-"));
  try {
    const manager = SessionManager.create(dir, dir);
    const root = manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], provider: "test", api: "test", model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now() });
    appendSessionModelSpeed(manager, "fast");
    manager.branch(root);
    assert.equal(readSessionModelSpeed(manager.getEntries()), "fast");
    assert.equal(manager.buildSessionContext().messages.some((message) => JSON.stringify(message).includes(SESSION_MODEL_SPEED_TYPE)), false);
    appendSessionModelSpeed(manager, "standard");
    const reopened = SessionManager.open(manager.getSessionFile(), dir);
    assert.equal(readSessionModelSpeed(reopened.getEntries()), "standard");
    assert.equal(reopened.getEntries().filter((value) => value.customType === SESSION_MODEL_SPEED_TYPE).length, 2);
    assert.throws(() => appendSessionModelSpeed(manager, "ultrafast"), /Invalid model speed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
