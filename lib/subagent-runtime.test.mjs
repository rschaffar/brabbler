import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false });
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { SUBAGENT_NOTIFICATION_PREFIX } = await jiti.import("./subagent-extension.ts");

function completedRun() {
  return {
    sessionId: "child-session",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Inspect parser",
    task: "Find the parser",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  };
}

test("completion notification reopens an idle parent and uses its current session", async () => {
  const delivered = [];
  const reopened = [];
  let ready = false;
  let parent;
  const liveParent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => { ready = true; },
    inner: {
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async (sessionId, sessionFile) => {
      reopened.push([sessionId, sessionFile]);
      parent = liveParent;
      return liveParent;
    },
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });

  await controller.extensionRuntime.notifyParent(completedRun());

  assert.deepEqual(reopened, [["parent-session", "/tmp/parent.jsonl"]]);
  assert.equal(ready, true);
  assert.equal(delivered.length, 1);
  assert.equal(
    delivered[0].message.content,
    `${SUBAGENT_NOTIFICATION_PREFIX}Subagent child-session completed.\n\nParser found`,
  );
  // Compaction reads custom messages as user turns, so the report must announce that it is not one (#875).
  assert.match(delivered[0].message.content, /^The following is a background subagent's report/);
  assert.equal(delivered[0].message.details.sessionId, "child-session");
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("disabled built-in subagents reject stale Agent calls before starting", async () => {
  const controller = createSubagentController({
    getSession: () => { throw new Error("must not inspect a parent"); },
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => false,
  });

  await assert.rejects(
    controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Inspect",
      description: "Inspect",
    }),
    /built-in sub-agents are disabled/,
  );
});

async function childFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-resume-mock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "child.jsonl");
  await writeFile(file, `${JSON.stringify({ type: "session", version: 3, id: "child", cwd: dir, timestamp: new Date().toISOString() })}\n`);
  return file;
}

test("resume reuses the persisted child session and keeps its session id", async (t) => {
  const owner = backendCase(t);
  const file = await childFile(t);
  const calls = [];
  const entries = [
    { type: "custom", customType: "brabbler:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "brabbler:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: file,
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt: async (task) => { calls.push(task); },
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: "/tmp", isAlive: () => true, isRunning: () => false,
    beginCheckoutPromptAdmission: () => () => {}, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "child",
    task: "continue this",
    description: "Continue task",
  });
  owner.join(() => execution.settled);
  const result = await execution.completion;
  await execution.settled;
  assert.equal(execution.run.sessionId, "child");
  assert.equal(result.sessionId, "child");
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["continue this"]);
});

test("resume rejects a child owned by another parent", async () => {
  const controller = createSubagentController({
    getSession: (id) => id === "parent" ? { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} } : undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  await assert.rejects(controller.extensionRuntime.resume({
    parentContext: { sessionManager: { getSessionId: () => "parent" } },
    parentToolCallId: "call",
    sessionId: "missing",
    task: "continue",
    description: "Continue",
  }), /Subagent not found/);
});

test("a run whose last assistant message ended with a provider error is reported as failed, not completed", async (t) => {
  const owner = backendCase(t);
  const file = await childFile(t);
  const entries = [
    { type: "custom", customType: "brabbler:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "builder",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "brabbler:subagent-result", data: { version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z" } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: file,
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    // pi's agent loop records a provider stream error as an assistant message and resolves prompt() normally.
    prompt: async () => {
      entries.push({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "edit", arguments: {} }], stopReason: "error", errorMessage: "stream error: stream disconnected before completion" } });
    },
    getLastAssistantText: () => undefined,
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: "/tmp", isAlive: () => true, isRunning: () => false,
    beginCheckoutPromptAdmission: () => () => {}, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "child",
    task: "continue this",
    description: "Continue task",
  });
  owner.join(() => execution.settled);
  const result = await execution.completion;
  await execution.settled;
  assert.equal(result.status, "failed");
  assert.match(result.error, /stream disconnected/);
  const persisted = entries.at(-1);
  assert.equal(persisted.customType, "brabbler:subagent-result");
  assert.equal(persisted.data.status, "failed");
  assert.match(persisted.data.error, /stream disconnected/);
});

function idleParentDependencies(delivered, overrides = {}) {
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
    inner: {
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    ...overrides,
  };
  return {
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  };
}

test("a result already collected with get_subagent_result is never delivered again", async () => {
  const delivered = [];
  const controller = createSubagentController(idleParentDependencies(delivered));
  const run = { ...completedRun(), sessionId: "collected-child" };

  controller.extensionRuntime.expectNotification(run);
  controller.extensionRuntime.markResultConsumed(run);
  await controller.extensionRuntime.notifyParent(run);

  assert.equal(delivered.length, 0);

  // The mark is consumed, so a later run reusing that session ID still notifies.
  await controller.extensionRuntime.notifyParent(run);
  assert.equal(delivered.length, 1);
});


import { backendCase, deferred, loadBackend } from "./backend-ownership.fixture.mjs";
import { subagentCreation } from "./subagent-creation.fixture.mjs";

for (const consume of [false, true]) test(`busy-parent notification waits for the actual policy timer; consumed=${consume}`, async t => {
  const owner = backendCase(t), scheduled = deferred(), rescheduled = deferred(), timers = [], delivered = [];
  let running = true, polls = 0;
  owner.release(() => { running = false; for (const timer of timers.splice(0)) timer(); });
  const loadedRuntime = await loadBackend(new URL("./subagent-runtime.ts", import.meta.url), {}, { actual: true, globals: {
    setTimeout(callback, ms) { assert.equal(ms, 200); timers.push(callback); if (++polls === 1) scheduled.resolve(); else rescheduled.resolve(); return polls; },
  } });
  const controller = loadedRuntime.createSubagentController(idleParentDependencies(delivered, { isRunning: () => running }));
  const run = { ...completedRun(), sessionId: consume ? "racing-child" : "waiting-child" };
  const notified = owner.work(controller.extensionRuntime.notifyParent(run));
  await scheduled.promise;
  assert.equal(delivered.length, 0, "the held 200ms policy timer cannot deliver to a busy parent");
  timers.shift()();
  await Promise.race([rescheduled.promise, notified.then(() => { if (running) throw new Error("notification completed while parent was still busy"); })]);
  assert.equal(delivered.length, 0, "an elapsed poll must recheck the still-busy parent, not deliver");
  if (consume) controller.extensionRuntime.markResultConsumed(run);
  running = false; timers.shift()(); await notified;
  assert.equal(delivered.length, consume ? 0 : 1);
  if (!consume) {
    assert.equal(delivered[0].message.content, `${SUBAGENT_NOTIFICATION_PREFIX}Subagent waiting-child completed.\n\nParser found`);
    assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
  }
});

for (const loadExtensions of [false, true]) for (const loadSkills of [false, true]) for (const promptMode of ["append", "replace"]) test(`child creation keeps own preflight, account/speed and resource policy ${loadExtensions}/${loadSkills}/${promptMode}`, async t => {
  const f = await subagentCreation(t, { loadExtensions, loadSkills, promptMode });
  const execution = await f.start();
  const preflight = await f.entered.promise;
  assert.equal(f.admissions.size, 1, "child owns its admission while SDK preflight waits");
  const input = f.input(), construction = f.construct(), child = f.child();
  assert.equal(input.cwd, f.parent.cwd); assert.equal(input.modelRuntime, f.parent.inner.modelRuntime);
  assert.equal(input.resourceLoaderOptions.noExtensions, !loadExtensions);
  assert.equal(input.resourceLoaderOptions.noSkills, !loadSkills);
  assert.deepEqual(construction.tools, loadExtensions ? ["read", "External"] : ["read"]);
  assert.deepEqual(construction.excludeTools, ["Agent", "get_subagent_result", "steer_subagent"]);
  const bytes = await f.readChild(); const saved = bytes.trim().split("\n").map(JSON.parse);
  assert.equal(saved[0].parentSession, f.parent.sessionFile); assert.equal(saved[0].cwd, f.parent.cwd);
  assert.deepEqual(f.accounts.readSessionAccounts(child.sessionManager.getEntries()), { synthetic: "bound-parent-account" });
  assert.equal(f.speed.readSessionModelSpeed(child.sessionManager.getEntries()), "fast");
  const resources = f.subagents.readSubagentSessionResources(child.sessionManager.getEntries());
  assert.deepEqual(resources.tools, construction.tools); assert.equal(resources.loadSkills, loadSkills); assert.equal(resources.loadExtensions, loadExtensions);
  const registration = f.calls.find(([name]) => name === "register")[1];
  assert.equal(registration.exactSystemPrompt, promptMode === "replace" ? "Exact profile" : undefined);
  assert.equal(input.resourceLoaderOptions.extensionFactories.some(factory => factory.name === "brabbler-exact-system-prompt"), promptMode === "replace");
  assert.equal(input.resourceLoaderOptions.extensionFactories.some(factory => factory.name === "brabbler-local-file-link-guidance"), promptMode === "append");
  if (promptMode === "replace") {
    const exact = input.resourceLoaderOptions.extensionFactories.find(factory => factory.name === "brabbler-exact-system-prompt");
    let callback; exact.factory({ on: (event, handler) => { assert.equal(event, "before_agent_start"); callback = handler; } });
    assert.deepEqual(callback(), { systemPrompt: "Exact profile" });
  }
  // Actual session-local adapter must bind to the *child* agent before registry
  // publication; no provider transport runs. Parent runtime itself stays simple.
  const codex = { ...f.model, provider: "openai-codex", api: "openai-codex-responses" };
  const options = { sessionId: child.sessionId, signal: child.agent.signal, onPayload: child.agent.onPayload };
  await child.modelRuntime.streamSimple(codex, { messages: [], systemPrompt: "" }, options).result();
  assert.equal(f.calls.findLast(([name]) => name === "full")[3].serviceTier, "priority");
  await f.runtime.streamSimple(codex, { messages: [], systemPrompt: "" }, options).result(); assert.equal(f.calls.at(-1)[0], "simple");
  preflight.preflightResult(); assert.equal(f.admissions.size, 0);
  f.promptGate.resolve(); const result = await execution.completion;
  await execution.settled;
  assert.equal(result.status, "completed");
  const persisted = child.sessionManager.getEntries().at(-1);
  assert.equal(persisted.customType, "brabbler:subagent-result"); assert.equal(persisted.data.status, "completed");
  assert.equal(persisted.data.runId, execution.run.runId);
  const durable = (await f.readChild()).trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(durable.customType, "brabbler:subagent-result"); assert.equal(durable.data.status, "completed");
});

test("child prompt rejection releases admission and durably records failure", async t => {
  const f = await subagentCreation(t, { failPrompt: true }); const execution = await f.start(); await f.entered.promise;
  f.promptGate.resolve(); const result = await execution.completion;
  await execution.settled;
  assert.equal(result.status, "failed"); assert.match(result.error, /controlled child prompt failure/);
  assert.equal(f.admissions.size, 0); assert.equal(f.child().sessionManager.getEntries().at(-1).data.status, "failed");
  assert.equal(JSON.parse((await f.readChild()).trim().split("\n").at(-1)).data.status, "failed");
});


test("actual queue settlement joins rejected runs and cancelled peers through their complete handlers", async t => {
  const owner = backendCase(t), runEntered = deferred(), releaseRun = deferred(), cancelEntered = deferred(), releaseCancel = deferred();
  owner.release(() => releaseRun.resolve()); owner.release(() => releaseCancel.resolve());
  const { SubagentQueue } = await jiti.import("./subagent-queue.ts"); const queue = new SubagentQueue();
  const failure = new Error("controlled queue failure");
  const first = queue.enqueue("parent", 1, async () => { runEntered.resolve(); await releaseRun.promise; throw failure; }, () => {});
  owner.work(assert.rejects(first.promise, error => error === failure)); owner.join(() => first.settled);
  const second = queue.enqueue("parent", 1, async () => { assert.fail("cancelled peer must not run"); }, () => {}, async () => { cancelEntered.resolve(); await releaseCancel.promise; });
  owner.work(second.promise); owner.join(() => second.settled);
  let cancelledSettled = false; second.settled.then(() => { cancelledSettled = true; });
  await runEntered.promise; assert.equal(second.cancel(), true); await cancelEntered.promise;
  assert.equal(cancelledSettled, false, "cancel result is not cancellation-handler settlement");
  releaseRun.resolve(); await first.settled;
  assert.equal(cancelledSettled, false, "a rejected peer cannot release the cancelled peer's ownership");
  releaseCancel.resolve(); await second.settled; assert.equal(cancelledSettled, true);
});


for (const synchronous of [false, true]) test(`queue cancellation failure preserves result publication and joins handler; synchronous=${synchronous}`, async t => {
  const owner = backendCase(t), releaseRun = deferred(), entered = deferred(), releaseCancel = deferred();
  owner.release(() => releaseRun.resolve()); owner.release(() => releaseCancel.resolve());
  const { SubagentQueue } = await jiti.import("./subagent-queue.ts"); const queue = new SubagentQueue();
  const first = queue.enqueue("parent", 1, () => releaseRun.promise, () => {});
  owner.work(first.promise); owner.join(() => first.settled);
  const failure = new Error("controlled cancellation reporter failure");
  const second = queue.enqueue("parent", 1, async () => { assert.fail("cancelled work must never run"); }, () => {}, synchronous
    ? () => { throw failure; }
    : async () => { entered.resolve(); await releaseCancel.promise; throw failure; });
  if (synchronous) {
    assert.throws(() => second.cancel(), error => error === failure);
    await owner.work(assert.rejects(second.settled, error => error === failure));
    // Preserve the existing queue contract: a synchronous callback throw does
    // not fabricate a result for an operation that never started.
    let published = false; second.promise.then(() => { published = true; });
    releaseRun.resolve(); await first.settled; assert.equal(published, false);
  } else {
    const rejected = owner.work(assert.rejects(second.promise, error => error === failure));
    assert.equal(second.cancel(), true); await entered.promise;
    let fullySettled = false; const joined = owner.work(second.settled.then(() => { fullySettled = true; }));
    assert.equal(fullySettled, false);
    releaseCancel.resolve(); await rejected; await joined; assert.equal(fullySettled, true);
  }
});

test("queue settlement includes a throwing next-peer pump reporter without inventing its result", async t => {
  const owner = backendCase(t), release = deferred(); owner.release(() => release.resolve());
  const { SubagentQueue } = await jiti.import("./subagent-queue.ts"); const queue = new SubagentQueue();
  const first = queue.enqueue("parent", 1, () => release.promise, () => {});
  const failure = new Error("controlled pump reporter failure");
  const second = queue.enqueue("parent", 1, async () => { assert.fail("reporter refused before run"); }, state => { if (state === "running") throw failure; });
  const firstJoined = owner.work(assert.rejects(first.settled, error => error === failure));
  const secondJoined = owner.work(assert.rejects(second.settled, error => error === failure));
  let published = false; second.promise.then(() => { published = true; });
  release.resolve(); await first.promise; await Promise.all([firstJoined, secondJoined]);
  assert.equal(published, false, "bookkeeping failure is not durable result publication");
});
