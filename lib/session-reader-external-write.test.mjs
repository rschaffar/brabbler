// Integration check for the exact condition app/api/sessions/[id]/route.ts
// branches on: a live wrapper's SessionManager does NOT know an entry that
// another process appended to the same file. This validates the SDK contract
// (`getEntry()` is backed by an in-memory index, not a disk read) that the
// external-writer detection depends on — issue #632.
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
  fsCache: false,
});
const { readLatestSessionEntryId } = await jiti.import("./session-reader.ts");
const { AgentSessionWrapper, registerRpcWrapper } = await jiti.import("./rpc-manager.ts");

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

function fixture(t, owner = backendCase(t)) {
  // The same actual domain owner joins native work and decides root removal.
  // Its after-hook is registered before provisioning; no independent rm hook.
  try {
    const dir = mkdtempSync(join(tmpdir(), "brabbler-eviction-"));
    owner.remove(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(
      dir,
      "2026-01-01T00-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl",
    );
    writeFileSync(
      file,
      `${JSON.stringify(header)}\n${JSON.stringify(entry("aaaa1111", "first"))}\n`,
    );
    return file;
  } catch (error) {
    // A partial synchronous setup is uncertainty too; retain the original error
    // in the real cleanup operation so its conditional removal cannot run.
    owner.join(() => { throw error; });
    throw error;
  }
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
  const owner = backendCase(t);
  const file = fixture(t, owner);
  appendFileSync(
    file,
    `${JSON.stringify(entry("bbbb2222", "written by the other process"))}\n`,
  );
  const wrapper = makeIdleWrapper(file, ["aaaa1111"]);
  owner.join(() => settleFixtureRpc(wrapper));
  assert.equal(wrapper.evictIfDiskAhead(), true);
  assert.equal(wrapper.isAlive(), false);
});

test("evictIfDiskAhead leaves a running wrapper alone", (t) => {
  const owner = backendCase(t);
  const file = fixture(t, owner);
  appendFileSync(
    file,
    `${JSON.stringify(entry("bbbb2222", "written by the other process"))}\n`,
  );
  const wrapper = makeIdleWrapper(file, ["aaaa1111"], { isStreaming: true });
  owner.join(() => settleFixtureRpc(wrapper));
  assert.equal(wrapper.evictIfDiskAhead(), false);
  assert.equal(wrapper.isAlive(), true);
});

test("disk-ahead recovery preserves a prompt waiting for extension binding", async (t) => {
  const owner = backendCase(t);
  const file = fixture(t, owner);
  appendFileSync(file, `${JSON.stringify(entry("bbbb2222", "restore marker"))}\n`);
  let finishBinding;
  const binding = new Promise((resolve) => { finishBinding = resolve; });
  const wrapper = makeIdleWrapper(file, ["aaaa1111"], {
    bindExtensions: () => binding,
    extensionRunner: {},
  });
  owner.release(() => finishBinding());
  owner.join(() => settleFixtureRpc(wrapper));
  wrapper.beginExtensionBinding();
  // Invalid images stop the command after binding without starting a real run.
  const sending = wrapper.send({ type: "prompt", message: "pending", images: "invalid" });
  const rejected = owner.work(assert.rejects(sending, /images/i));
  assert.equal(wrapper.isRunning(), false, "the prompt has not reached admission yet");
  assert.equal(wrapper.evictIfDiskAhead(), false);
  assert.equal(wrapper.isAlive(), true);
  finishBinding();
  await rejected;
  assert.equal(wrapper.evictIfDiskAhead(), true, "completed admission releases the eviction guard");
});

import { backendCase, deferred, settleFixtureRpc } from "./backend-ownership.fixture.mjs";

test("delayed old-wrapper disposal cannot unregister its replacement", async t => {
  const owner = backendCase(t);
  const file = fixture(t, owner), previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  owner.final(() => { globalThis.__piSessions = previous; });
  const shutdown = deferred(), entered = deferred(), oldDisposed = deferred(), replacementDisposed = deferred();
  owner.release(() => shutdown.resolve());
  const old = makeIdleWrapper(file, ["aaaa1111"], {
    subscribe: () => () => {},
    extensionRunner: { emit: async () => { entered.resolve(); await shutdown.promise; } },
    dispose: () => oldDisposed.resolve(),
  });
  const replacement = makeIdleWrapper(file, ["aaaa1111", "bbbb2222"], {
    subscribe: () => () => {}, extensionRunner: {}, dispose: () => replacementDisposed.resolve(),
  });
  owner.join(async () => {
    const outcomes = await Promise.allSettled([settleFixtureRpc(old), settleFixtureRpc(replacement)]);
    const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
    // Every actual peer gets its readiness/shutdown attempt. Failed retirement
    // retains the root rather than waiting for an acknowledgment that may never
    // arrive; clean retirement still requires both actual disposal callbacks.
    if (errors.length) throw new AggregateError(errors, 'External-writer wrapper cleanup failed');
    await Promise.all([oldDisposed.promise, replacementDisposed.promise]);
  });
  registerRpcWrapper(old); await old.waitUntilReady();
  old.destroy(); assert.equal(old.isAlive(), false);
  registerRpcWrapper(replacement); await replacement.waitUntilReady();
  await entered.promise;
  assert.equal(globalThis.__piSessions.get(replacement.sessionId), replacement);
  shutdown.resolve(); await oldDisposed.promise;
  assert.equal(globalThis.__piSessions.get(replacement.sessionId), replacement);
  await replacement.shutdown(); await replacementDisposed.promise;
  assert.equal(globalThis.__piSessions.has(replacement.sessionId), false);
});

test("a manager writing its own entries is never flagged as stale", (t) => {
  // The eviction must not fire on brabbler's own appends, or every read would
  // destroy a healthy wrapper in a loop.
  const file = fixture(t);
  const manager = SessionManager.open(file);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "written by brabbler" }],
  });

  const diskLatestId = readLatestSessionEntryId(file);
  assert.ok(diskLatestId, "brabbler's own append must be visible on disk");
  assert.ok(
    manager.getEntry(diskLatestId),
    "and must already be known to the manager",
  );
});

// Optional Parent-only seventh case; not included by remedy.patch.
// Observes the ACTUAL backendCase cleanup once, not a synthetic idle flag.
test("external-writer root is retained after failed cleanup and an independent native peer joins", { timeout: 10000 }, async t => {
  const outer = backendCase(t), hooks = [], gate = deferred();
  const failure = new Error("exact external-writer cleanup fault");
  let root, nativePeer, closing;
  const closeActualHooks = () => closing ??= (async () => {
    const errors = [];
    // Like independent test after-hooks: a failed owner cannot suppress the
    // next hook. The one-line unsafe-rm fault therefore reaches actual removal.
    for (const hook of hooks) {
      try { await hook(); } catch (error) { errors.push(error); }
    }
    return errors;
  })();
  const assertExpectedFailure = errors => {
    assert.equal(errors.length, 1);
    assert.equal(errors[0] instanceof AggregateError, true);
    assert.equal(errors[0].errors.length, 1);
    assert.equal(errors[0].errors[0], failure, "original cleanup error identity retained");
  };
  // Outer removal is itself conditional on actual complete native work and
  // the exact expected uncertainty. Setup/unknown failures retain the root.
  outer.release(() => gate.resolve());
  outer.join(async () => {
    const errors = await closeActualHooks();
    if (nativePeer) await nativePeer;
    assertExpectedFailure(errors);
    assert.ok(root);
  });
  outer.remove(() => rmSync(root, { recursive: true, force: true }));
  const scope = { after: hook => hooks.push(hook) };
  const owner = backendCase(scope);
  owner.release(() => gate.resolve());
  owner.join(() => { throw failure; });
  const file = fixture(scope, owner);
  root = dirname(file);
  nativePeer = owner.work((async () => {
    await gate.promise;
    writeFileSync(join(root, "cleanup-peer-joined"), "actual private peer write\n");
  })());
  const errors = await closeActualHooks();
  await nativePeer;
  assertExpectedFailure(errors);
  // Primary old/new discriminator: false with unconditional separate rm,
  // true with the actual domain owner's guarded removal. No deep graph check.
  assert.equal(existsSync(root), true, "actual private root retained after injected cleanup failure");
  assert.equal(readFileSync(join(root, "cleanup-peer-joined"), "utf8"), "actual private peer write\n");
});
