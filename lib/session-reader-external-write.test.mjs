// Integration check for the exact condition app/api/sessions/[id]/route.ts
// branches on: a live wrapper's SessionManager does NOT know an entry that
// another process appended to the same file. This validates the SDK contract
// (`getEntry()` is backed by an in-memory index, not a disk read) that the
// external-writer detection depends on — issue #632.
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { readLatestSessionEntryId } = await jiti.import("./session-reader.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const header = {
  type: "session",
  version: 3,
  id: "11111111-1111-4111-8111-111111111111",
  cwd: "/tmp",
  timestamp: "2026-01-01T00:00:00.000Z",
};
function entry(id, text) {
  return {
    id,
    parentId: null,
    type: "message",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-eviction-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(
    dir,
    "2026-01-01T00-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl",
  );
  writeFileSync(
    file,
    `${JSON.stringify(header)}\n${JSON.stringify(entry("aaaa1111", "first"))}\n`,
  );
  return file;
}

test("an externally appended entry is unknown to the in-memory manager", (t) => {
  const file = fixture(t);
  const manager = SessionManager.open(file);
  assert.ok(
    manager.getEntry("aaaa1111"),
    "precondition: manager knows its own entry",
  );

  // Simulate the pi TUI appending to the same session file.
  appendFileSync(
    file,
    `${JSON.stringify(entry("bbbb2222", "written by the other process"))}\n`,
  );

  const diskLatestId = readLatestSessionEntryId(file);
  assert.equal(diskLatestId, "bbbb2222");
  // This is the branch condition: unknown disk id => the wrapper is stale.
  assert.equal(manager.getEntry(diskLatestId), undefined);
});

function makeIdleWrapper(file, knownIds, overrides = {}) {
  const known = new Set(knownIds);
  return new AgentSessionWrapper({
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionFile: file,
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    sessionManager: {
      getCwd: () => "/tmp",
      getEntry: (id) => known.has(id) ? { id } : undefined,
    },
    agent: { state: {} },
    dispose() {},
    ...overrides,
  });
}

test("evictIfDiskAhead drops an idle wrapper when disk has an unknown entry", (t) => {
  const file = fixture(t);
  appendFileSync(
    file,
    `${JSON.stringify(entry("bbbb2222", "written by the other process"))}\n`,
  );
  const wrapper = makeIdleWrapper(file, ["aaaa1111"]);
  t.after(() => wrapper.destroy());
  assert.equal(wrapper.evictIfDiskAhead(), true);
  assert.equal(wrapper.isAlive(), false);
});

test("evictIfDiskAhead leaves a running wrapper alone", (t) => {
  const file = fixture(t);
  appendFileSync(
    file,
    `${JSON.stringify(entry("bbbb2222", "written by the other process"))}\n`,
  );
  const wrapper = makeIdleWrapper(file, ["aaaa1111"], { isStreaming: true });
  t.after(() => wrapper.destroy());
  assert.equal(wrapper.evictIfDiskAhead(), false);
  assert.equal(wrapper.isAlive(), true);
});

test("disk-ahead recovery preserves a prompt waiting for extension binding", async (t) => {
  const file = fixture(t);
  appendFileSync(file, `${JSON.stringify(entry("bbbb2222", "restore marker"))}\n`);
  let finishBinding;
  const binding = new Promise((resolve) => { finishBinding = resolve; });
  const wrapper = makeIdleWrapper(file, ["aaaa1111"], {
    bindExtensions: () => binding,
    extensionRunner: {},
  });
  t.after(() => wrapper.destroy());
  wrapper.beginExtensionBinding();
  // Invalid images stop the command after binding without starting a real run.
  const sending = wrapper.send({ type: "prompt", message: "pending", images: "invalid" });
  const rejected = assert.rejects(sending, /images/i);
  assert.equal(wrapper.isRunning(), false, "the prompt has not reached admission yet");
  assert.equal(wrapper.evictIfDiskAhead(), false);
  assert.equal(wrapper.isAlive(), true);
  finishBinding();
  await rejected;
  assert.equal(wrapper.evictIfDiskAhead(), true, "completed admission releases the eviction guard");
});

test("delayed old-wrapper disposal cannot unregister its replacement", async (t) => {
  const file = fixture(t);
  const source = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const registration = source.slice(source.indexOf("function registerRpcWrapper"), source.indexOf("const SUBAGENT_CONTROLLER"));
  const registry = new Map();
  const javascript = ts.transpileModule(registration + "\nreturn registerRpcWrapper;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const register = new Function("getRegistry", "cacheSessionPath", javascript)(() => registry, () => {});
  let finishShutdown;
  const shutdown = new Promise((resolve) => { finishShutdown = resolve; });
  const old = makeIdleWrapper(file, ["aaaa1111"], {
    extensionRunner: { emit: () => shutdown },
  });
  const replacement = makeIdleWrapper(file, ["aaaa1111", "bbbb2222"]);
  for (const wrapper of [old, replacement]) {
    wrapper.start = () => {};
    wrapper.beginExtensionBinding = () => {};
    t.after(() => wrapper.destroy());
  }
  register(old);
  old.destroy();
  assert.equal(old.isAlive(), false);
  register(replacement);
  finishShutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registry.get(replacement.sessionId), replacement);
  replacement.destroy();
  assert.equal(registry.has(replacement.sessionId), false);
});

test("a manager writing its own entries is never flagged as stale", (t) => {
  // The eviction must not fire on pi-web's own appends, or every read would
  // destroy a healthy wrapper in a loop.
  const file = fixture(t);
  const manager = SessionManager.open(file);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "written by pi-web" }],
  });

  const diskLatestId = readLatestSessionEntryId(file);
  assert.ok(diskLatestId, "pi-web's own append must be visible on disk");
  assert.ok(
    manager.getEntry(diskLatestId),
    "and must already be known to the manager",
  );
});
