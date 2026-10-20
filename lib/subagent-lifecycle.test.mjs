import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { persistChildSession, recordSubagentResult, assertSubagentDirectory } = await jiti.import("./subagent-lifecycle.ts");
const { readSubagentRun } = await jiti.import("./subagents.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { subagentFinalText } = await jiti.import("./subagent-extension.ts");

test("setup-only persistence preserves IDs and enables later result appends without a fake conversation", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-child-persist-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  manager.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: "parent", parentSessionPath: "/fixture/parent.jsonl", resourceSnapshot: { version: 1, tools: [], appendSystemPrompt: [], loadSkills: false, loadExtensions: false }, turnLimit: 1 });
  const id = manager.getSessionId(), file = manager.getSessionFile(), leaf = manager.getLeafId();
  assert.equal(existsSync(file), false);
  persistChildSession(manager);
  assert.equal(manager.getSessionId(), id);
  assert.equal(manager.getLeafId(), leaf);
  assert.throws(() => persistChildSession(manager), /already exists/);
  const result = recordSubagentResult(manager, { sessionId: id, sessionPath: file, runId: "exact-run", parentSessionId: "parent", parentToolCallId: "call", profile: "fixture", task: "task", description: "description", runInBackground: false, createdAt: "created", completedAt: "completed", status: "aborted" });
  const entries = SessionManager.open(file).getEntries();
  assert.equal(entries.some(entry => entry.type === "message"), false);
  assert.equal(readSubagentRun(entries, id, file).runId, result.runId);
});

test("directory admission rejects missing and non-directory paths without recreation", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-child-directory-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "file"), "fixture");
  assertSubagentDirectory(dir);
  assert.throws(() => assertSubagentDirectory(join(dir, "missing")), /Directory does not exist/);
  assert.throws(() => assertSubagentDirectory(join(dir, "file")), /not a directory/);
  assert.equal(existsSync(join(dir, "missing")), false);
});

test("consumption identifies rapid successive runs and preserves every held run's suppression", async () => {
  const delivered = [];
  let busy = true;
  const parent = { isAlive: () => true, isRunning: () => busy, waitUntilReady: async () => {},
    inner: { sendCustomMessage: async message => delivered.push(message) } };
  const runtime = createSubagentController({ getSession: () => parent, registerSession() {}, resolveSessionPath: async () => null,
    reopenSession: async () => parent, invalidateSessionList() {} }).extensionRuntime;
  const run = runId => ({ sessionId: "same-child", runId, parentSessionId: "parent", parentToolCallId: "call", profile: "fixture", description: "fixture", task: "fixture", runInBackground: true,
    status: "failed", createdAt: "same-time", completedAt: "same-millisecond", error: `failure ${runId}` });
  const first = run("first"), second = run("second"), third = { ...run("third"), resumed: true };
  const oldNotification = runtime.notifyParent(first);
  runtime.expectNotification(second);
  runtime.markResultConsumed(first);
  runtime.markResultConsumed(second);
  busy = false;
  await oldNotification;
  await runtime.notifyParent(second);
  await runtime.notifyParent(third);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].details.runId, "third");
  assert.match(delivered[0].content, /not a message from the user.*resumed run.*failure third/s);
  assert.equal(subagentFinalText({ ...third, status: "queued" }), "Subagent same-child is queued.");
  runtime.markResultConsumed(third);
  assert.equal(globalThis.__piSubagentNotifications.size, 0, "post-delivery collection leaves no accumulating run marks");
});
