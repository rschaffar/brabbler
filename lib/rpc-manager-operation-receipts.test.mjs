import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate as afterMessageEndMicrotasks } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "brabbler-operation-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { AgentSessionWrapper, hasBusyRpcSessionWithin, hasBusyRpcSessionForCwd } = await jiti.import("./rpc-manager.ts");
const { hasActiveTerminalWithin } = await jiti.import("./terminal-manager.ts");
const { OPERATION_REVIEW_TYPE, findOperationReview, operationReviewReference } = await jiti.import("./plugins/review-metadata.ts");
const { resolveSessionPath } = await jiti.import("./session-reader.ts");
const { resolveSessionReview } = await jiti.import("./plugins/review-access.ts");
const { requestSessionPause, getSessionPause, removeSessionPause } = await jiti.import("./session-pause.ts");
const receipt = { version: 1, operationId: "a046677d-8293-4445-9a2b-558317345abc", toolCallId: "tool-call",
  card: { title: "Perform operation", text: "Exact candidate", actions: [] }, phase: "prepared",
  authorization: { mode: "allow", source: "session", revision: "policy-revision", decision: "policy-authorized" },
  checks: [{ name: "tests", status: "pending" }], effectStarted: false };

function setup(t, inMemory = false, Wrapper = AgentSessionWrapper) {
  const directory = mkdtempSync(join(agentDir, "session-"));
  const manager = inMemory ? SessionManager.inMemory(directory) : SessionManager.create(directory, directory);
  let boundUi, sdkListener, disposals = 0;
  const inner = {
    sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    agent: { state: {}, abort() {} }, abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose() { disposals++; },
    extensionRunner: {}, bindExtensions: async ({ uiContext }) => { boundUi = uiContext; },
    subscribe: listener => { sdkListener = listener; return () => { sdkListener = undefined; }; },
  };
  const wrapper = new Wrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, ui: wrapper.createExtensionUiContext(), manager, events, boundUi: () => boundUi, disposals: () => disposals,
    emitSdk: event => { assert.equal(typeof sdkListener, "function", "start the actual wrapper subscriber first"); sdkListener(event); } };
}

// Callback-owner fixture: real host/SDK manager and files, supplied SDK events.
// runtime.test.mjs retains the actual SDK/model/native event-ordering bridge.
function startedCallbackOwner(t) {
  const fixture = setup(t);
  fixture.wrapper.persistInitialSession();
  fixture.wrapper.start();
  return fixture;
}

function failCallbackOwnerSave({ manager, ui }) {
  manager.appendCustomEntry = () => { throw new Error("callback-owner save EIO"); };
  assert.throws(() => ui.operationReceipt("example", receipt), /callback-owner save EIO/);
  assert.throws(() => manager.getEntries(), /quarantined/);
}

test("production extension binding exposes synchronous operationReceipt and observed directory use", async (t) => {
  const fixture = setup(t);
  fixture.wrapper.beginExtensionBinding();
  await fixture.wrapper.waitUntilReady();
  assert.equal(typeof fixture.boundUi().operationReceipt, "function");
  assert.equal(typeof fixture.boundUi().isDirectoryInUse, "function");
  assert.equal(typeof fixture.boundUi().reserveDirectory, "function");
});

test("operation snapshots persist before SSE, remain append-only after reload, and never enter SDK context", (t) => {
  const { wrapper, ui, manager } = setup(t);
  const observed = [];
  wrapper.onEvent((event) => {
    if (event.type !== "operation_receipt") return;
    const disk = SessionManager.open(manager.getSessionFile());
    assert.deepEqual(disk.getEntry(event.entry.id), event.entry, "emission only after persistence");
    assert.deepEqual(disk.buildSessionContext().messages, [], "custom entries never become LLM user messages");
    observed.push(event.entry);
  });
  const input = structuredClone(receipt);
  assert.equal(ui.operationReceipt("example", input), undefined);
  const initial = readFileSync(manager.getSessionFile(), "utf8");
  input.card.text = "Changed afterwards";
  input.checks[0].status = "failed";
  assert.equal(manager.getEntries()[0].data.card.text, "Exact candidate");
  ui.operationReceipt("example", { ...receipt, phase: "executing", effectStarted: true });
  // An already-aborted extension channel must not suppress the result of an effect.
  wrapper.extensionUiAbortController.abort(new Error("Stopped"));
  ui.operationReceipt("example", { ...receipt, phase: "succeeded", effectStarted: true, summary: "Done" });
  assert.ok(readFileSync(manager.getSessionFile(), "utf8").startsWith(initial));
  assert.deepEqual(observed.map((entry) => entry.data.phase), ["prepared", "executing", "succeeded"]);
  assert.deepEqual(observed.map((entry) => entry.data.sequence), [1, 2, 3]);
  assert.equal(observed[0].data.card.operationId, receipt.operationId);
  assert.deepEqual(SessionManager.open(manager.getSessionFile()).getEntries(), observed);
});

test("validation, append errors, first flush failures and non-persisting sessions fail closed without SSE", (t) => {
  const { ui, manager, events } = setup(t);
  assert.throws(() => ui.operationReceipt("example", { ...receipt, version: 2 }), /Invalid operation receipt/);
  assert.equal(manager.getEntries().length, 0);
  const append = manager.appendCustomEntry.bind(manager);
  manager.appendCustomEntry = () => { throw new Error("append failed"); };
  assert.throws(() => ui.operationReceipt("example", receipt), /append failed/);
  manager.appendCustomEntry = append;
  assert.throws(() => ui.operationReceipt("example", receipt), /quarantined/, "a partly appended SDK channel cannot be read or retried");
  // A separate healthy wrapper proves the first-flush fault independently.
  const initial = setup(t);
  rmSync(initial.manager.getSessionDir(), { recursive: true, force: true });
  assert.throws(() => initial.ui.operationReceipt("example", receipt), /ENOENT/);
  assert.equal(events.some((event) => event.type === "operation_receipt"), false);
  assert.equal(initial.events.some((event) => event.type === "operation_receipt"), false);
  const memory = setup(t, true);
  assert.throws(() => memory.ui.operationReceipt("example", receipt), /persistent session/);
  assert.equal(memory.manager.getEntries().length, 0);
});

test("managed directory-use callback checks physical descendants, starts, running wrappers and live terminals only", (t) => {
  const directory = mkdtempSync(join(agentDir, "use-"));
  const child = join(directory, "child");
  const sibling = `${directory}-sibling`;
  const alias = `${directory}-alias`;
  mkdirSync(child); mkdirSync(sibling); symlinkSync(directory, alias, "dir");
  t.after(() => { rmSync(alias, { force: true }); rmSync(sibling, { recursive: true, force: true }); });
  const previous = [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__brabblerTerminals];
  const sessions = globalThis.__piSessions = new Map();
  const starts = globalThis.__piStartingSessionCwds = new Map();
  const terminals = globalThis.__brabblerTerminals = new Map();
  t.after(() => { [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__brabblerTerminals] = previous; });
  const { ui } = setup(t);
  let destroyed = 0;
  const idle = { cwd: child, sessionId: "idle", isRunning: () => false, destroy: () => { destroyed++; } };
  sessions.set("idle", idle);
  assert.equal(ui.isDirectoryInUse(directory), false);
  sessions.set("running", { ...idle, sessionId: "running", cwd: join(alias, "child"), isRunning: () => true });
  assert.equal(hasBusyRpcSessionWithin(directory), true);
  assert.equal(hasBusyRpcSessionForCwd(directory), false, "existing exact-cwd semantics unchanged");
  assert.equal(ui.isDirectoryInUse(directory), true);
  assert.equal(ui.isDirectoryInUse(sibling), false);
  sessions.delete("running");
  starts.set(join(alias, "child", "not-created-yet"), 1);
  assert.equal(ui.isDirectoryInUse(directory), true, "starting sessions resolve physical existing ancestors");
  starts.clear();
  terminals.set("terminal", { cwd: join(alias, "child"), exited: false });
  assert.equal(hasActiveTerminalWithin(directory), true);
  assert.equal(ui.isDirectoryInUse(directory), true);
  assert.equal(hasActiveTerminalWithin(child), true);
  assert.equal(hasActiveTerminalWithin(sibling), false);
  terminals.get("terminal").exited = true;
  assert.equal(ui.isDirectoryInUse(directory), false, "exited terminals do not block cleanup");
  assert.equal(destroyed, 0, "observations never destroy idle wrappers");
});

const withReview = review => ({ ...receipt, card: { ...receipt.card, operationId: review.operationId, review }, operationId: review.operationId });
test("real host saves detached complete metadata before prepared/card/decision/terminal publication", async t => {
  const { wrapper, ui, manager, events } = setup(t);
  const payload = { kind: "proposal", message: "m".repeat(2 * 1024 * 1024), files: Array.from({ length: 5000 }, (_, i) => `selected-${i}`) };
  const original = structuredClone(payload);
  const ref = await ui.saveOperationReview("example", receipt.operationId, "example/v1", payload);
  assert.deepEqual(Object.keys(ref).sort(), ["id", "operationId", "version"]);
  assert.equal(events.length, 0, "hidden metadata emits no SSE");
  payload.message = "caller changed"; payload.files.pop();
  const disk = SessionManager.open(manager.getSessionFile());
  assert.deepEqual(structuredClone(findOperationReview(disk.getEntries(), "example", ref, disk.getLeafId()).payload), original);
  assert.deepEqual(disk.buildSessionContext().messages, []);
  const publication = [];
  wrapper.onEvent(event => {
    if (!["operation_receipt", "interaction_receipt", "extension_ui_request"].includes(event.type)) return;
    const reopened = SessionManager.open(manager.getSessionFile());
    const reference = event.type === "extension_ui_request" ? event.review : event.entry.data.card?.review ?? event.entry.data.request?.review;
    if (reference) assert.ok(findOperationReview(reopened.getEntries(), "example", reference, reopened.getLeafId()), "saved ancestry precedes every publication");
    publication.push(event.type);
  });
  ui.operationReceipt("example", withReview(ref));
  const waiting = ui.pluginCard("example", { ...withReview(ref).card, actions: [{ id: "approve", label: "Approve" }] });
  t.after(() => { for (const pending of wrapper.pendingUiResponses.values()) pending.cancel(); });
  const request = events.find(event => event.type === "extension_ui_request");
  await wrapper.send({ type: "extension_ui_response", id: request.id, action: "approve" });
  assert.equal(await waiting, "approve");
  const result = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "settlement", proposal: ref, observed: "done" });
  ui.operationReceipt("example", { ...withReview(result), phase: "succeeded", effectStarted: true });
  const entries = SessionManager.open(manager.getSessionFile()).getEntries();
  assert.deepEqual(entries.filter(entry => entry.customType === OPERATION_REVIEW_TYPE).map(entry => entry.data.payload.kind), ["proposal", "settlement"]);
  assert.deepEqual(publication, ["operation_receipt", "extension_ui_request", "interaction_receipt", "operation_receipt"]);
  assert.equal(events.some(event => JSON.stringify(event).includes(original.message.slice(0, 100))), false, "metadata bodies never enter SSE");
});

test("v2 publication rejects absent, wrong-owner and sibling metadata at both card ports and receipt port", async t => {
  const { ui, manager, events } = setup(t);
  const ref = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "proposal" });
  ui.operationReceipt("example", withReview(ref));
  const prepared = manager.getLeafId();
  const result = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "settlement", proposal: ref });
  manager.branch(prepared);
  for (const [owner, review] of [["example", { ...ref, id: randomUUID() }], ["foreign", ref], ["example", result]]) {
    assert.throws(() => ui.operationReceipt(owner, withReview(review)), /referring ancestry/);
    assert.throws(() => ui.pluginCard(owner, withReview(review).card), /referring ancestry/);
    assert.throws(() => ui.pluginCardWithDetails(owner, withReview(review).card), /referring ancestry/);
  }
  assert.equal(events.filter(event => event.type === "operation_receipt").length, 1);
  assert.equal(events.some(event => event.type === "extension_ui_request"), false);
});

test("real metadata-only fork_branch flushes copied ancestry before reopening; prepared fork cannot inherit a sibling result", async t => {
  const { wrapper, ui, manager } = setup(t);
  const proposal = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "proposal", selected: ["a", "b"] });
  ui.operationReceipt("example", withReview(proposal));
  const prepared = manager.getLeafId();
  const result = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "settlement", proposal });
  ui.operationReceipt("example", { ...withReview(result), phase: "succeeded", effectStarted: true });
  const terminal = manager.getLeafId(), id = manager.getSessionId();
  const before = await wrapper.send({ type: "fork_branch", entryId: prepared });
  const after = await wrapper.send({ type: "fork_branch", entryId: terminal });
  assert.notEqual(before.newSessionId, id); assert.notEqual(before.newSessionId, after.newSessionId);
  assert.equal(manager.getSessionId(), id); assert.equal(manager.getLeafId(), terminal, "source wrapper remains unchanged");
  const preparedPath = await resolveSessionPath(before.newSessionId), terminalPath = await resolveSessionPath(after.newSessionId);
  const fork = SessionManager.open(preparedPath), completed = SessionManager.open(terminalPath);
  assert.ok(findOperationReview(fork.getEntries(), "example", proposal, fork.getLeafId()));
  assert.equal(findOperationReview(fork.getEntries(), "example", result, fork.getLeafId()), null);
  assert.ok(findOperationReview(completed.getEntries(), "example", proposal, completed.getLeafId()));
  assert.ok(findOperationReview(completed.getEntries(), "example", result, completed.getLeafId()));
  assert.ok(fork.getEntry(prepared)); assert.ok(completed.getEntry(terminal));
  rmSync(manager.getSessionFile());
  assert.ok((await resolveSessionReview(before.newSessionId, proposal.id)).metadata);
  assert.equal(await resolveSessionReview(before.newSessionId, result.id), null);
  const owned = await resolveSessionReview(after.newSessionId, result.id);
  assert.equal(owned.metadata.payload.kind, "settlement");
  assert.equal(owned.resolveLinked(proposal).payload.kind, "proposal");
});

test("failed SDK append/first flush/save barrier never authorizes leftover metadata or retries publication", async t => {
  for (const fault of ["append-after-memory", "first-flush", "barrier"]) await t.test(fault, async st => {
    let restore, Wrapper = AgentSessionWrapper;
    if (fault === "barrier") {
      const mock = st.mock.method(fs, "fsyncSync", () => { throw new Error("save barrier failed"); });
      syncBuiltinESMExports(); restore = () => { mock.mock.restore(); syncBuiltinESMExports(); };
      st.after(restore);
      // Jiti's existing graph already captured the native named export. Bind a
      // fresh real host graph AFTER installing the external filesystem fault.
      ({ AgentSessionWrapper: Wrapper } = await createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false, moduleCache: false }).import("./rpc-manager.ts"));
    }
    const { ui, manager, events } = setup(st, false, Wrapper);
    // Retain a pre-fault witness only for this assertion; ordinary manager reads
    // must be unavailable once the host quarantines rejected SDK memory.
    const unsafeEntries = manager.getEntries.bind(manager), append = manager.appendCustomEntry.bind(manager);
    if (fault === "append-after-memory") manager.appendCustomEntry = (...args) => { append(...args); throw new Error("append failed after memory"); };
    if (fault === "first-flush") rmSync(manager.getSessionDir(), { recursive: true, force: true });
    try { await assert.rejects(ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "proposal" }), /append failed|ENOENT|barrier failed/); }
    finally { restore?.(); manager.appendCustomEntry = append; }
    const entry = unsafeEntries().find(entry => entry.customType === OPERATION_REVIEW_TYPE);
    assert.ok(entry, "failed SDK persistence may retain metadata in memory");
    const leaked = operationReviewReference(entry.data);
    assert.throws(() => manager.getEntries(), /quarantined/);
    assert.throws(() => manager.getTree(), /quarantined/);
    assert.throws(() => manager.buildSessionContext(), /quarantined/);
    assert.throws(() => manager.appendMessage({ role: "user", content: "must not parent the unsafe tail", timestamp: Date.now() }), /quarantined/);
    assert.throws(() => ui.operationReceipt("example", withReview(leaked)), /quarantined/);
    assert.throws(() => ui.pluginCard("example", withReview(leaked).card), /quarantined/);
    await assert.rejects(ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "retry" }), /previously failed/);
    assert.equal(unsafeEntries().filter(entry => entry.customType === OPERATION_REVIEW_TYPE).length, 1, "quarantine preserves rejected data for recovery without parenting another entry");
    assert.equal(events.length, 0, "no card, receipt or success SSE from failed save");
  });
});

test("started deferred bindings and settlement contain one failed owner without affecting a healthy owner", async t => {
  const failed = startedCallbackOwner(t), healthy = startedCallbackOwner(t);
  let failedCompletions = 0, healthyCompletions = 0;
  failed.wrapper.onAgentRunComplete = () => { failedCompletions++; };
  healthy.wrapper.onAgentRunComplete = () => { healthyCompletions++; };
  failed.emitSdk({ type: "agent_start" }); healthy.emitSdk({ type: "agent_start" });
  failCallbackOwnerSave(failed);
  const result = { role: "toolResult", toolCallId: "completed-tool", toolName: "example", content: [{ type: "text", text: "Completed; receipt not saved. Do not repeat." }],
    isError: true, details: { completed: true, receiptPersisted: false }, timestamp: Date.now() };
  failed.emitSdk({ type: "message_end", message: result });
  assert.throws(() => failed.manager.appendMessage(result), /quarantined/);
  const message = { role: "user", content: "Healthy saved continuation", timestamp: Date.now() };
  healthy.emitSdk({ type: "message_end", message });
  const id = healthy.manager.appendMessage(message);
  failed.emitSdk({ type: "agent_settled" }); healthy.emitSdk({ type: "agent_settled" });
  await afterMessageEndMicrotasks();
  const liveResult = failed.events.find(event => event.type === "message_end" && event.message === result);
  assert.ok(liveResult, "truthful live result still reaches listeners");
  assert.equal(Object.hasOwn(liveResult, "entryId"), false, "uncertain memory cannot supply a saved binding");
  assert.equal(healthy.events.find(event => event.type === "message_end" && event.message === message)?.entryId, id);
  assert.ok(SessionManager.open(healthy.manager.getSessionFile()).getEntry(id));
  assert.equal(failedCompletions, 0, "refused persistence is not a normally saved completion");
  assert.equal(healthyCompletions, 1, "unrelated owner completes normally");
});

test("started paused-child microtasks acknowledge only a healthy, still-owned saved handoff", async t => {
  for (const state of ["healthy", "quarantined", "destroyed"]) await t.test(state, async st => {
    const fixture = startedCallbackOwner(st), pauseId = randomUUID(), handoffId = randomUUID();
    const message = { role: "custom", customType: "brabbler:paused-subsession-context", content: "Saved child context", display: false, details: { pauseId, handoffId } };
    fixture.wrapper.pendingChildHandoffs.set(pauseId, { anchor: null, id: handoffId });
    fixture.emitSdk({ type: "message_end", message });
    fixture.manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    if (state === "quarantined") failCallbackOwnerSave(fixture);
    if (state === "destroyed") fixture.wrapper.destroy();
    // The subscriber's synchronous history callback was queued before this turn.
    await afterMessageEndMicrotasks();
    assert.equal(fixture.wrapper.pendingChildHandoffs.has(pauseId), state !== "healthy",
      "failed/disposed owners retain the pending handoff rather than acknowledging rejected memory");
  });
});

test("a started deferred Resume waiter rejects uncertainty without observing or acknowledging SDK memory", async t => {
  const fixture = startedCallbackOwner(t), refused = [];
  let accepted = 0;
  const attempt = { message: "Literal Resume", resolve: () => { accepted++; }, reject: error => refused.push(error) };
  fixture.wrapper.pendingResume = attempt;
  failCallbackOwnerSave(fixture);
  fixture.emitSdk({ type: "message_end", message: { role: "user", content: attempt.message, timestamp: Date.now() } });
  await afterMessageEndMicrotasks();
  assert.equal(accepted, 0); assert.equal(refused.length, 1);
  assert.match(refused[0].message, /Resume cannot be confirmed.*quarantined/);
  assert.equal(attempt.error, refused[0]);
  assert.equal(attempt.observed, undefined, "unwritten literal text is not persistence evidence");
});

test("started settlement keeps an uncertain Pause unconfirmed with an owned error", async t => {
  for (const state of ["healthy", "quarantined"]) await t.test(state, async st => {
    const fixture = startedCallbackOwner(st), id = fixture.manager.getSessionId();
    const pause = requestSessionPause(id);
    st.after(() => removeSessionPause(id, pause.id));
    fixture.wrapper.pause = pause; // Supply the actual persisted pausing record.
    if (state === "quarantined") failCallbackOwnerSave(fixture);
    assert.doesNotThrow(() => fixture.emitSdk({ type: "agent_settled" }));
    await afterMessageEndMicrotasks();
    const saved = getSessionPause(id);
    assert.equal(saved.state, state === "healthy" ? "paused" : "pausing");
    assert.equal(fixture.events.some(event => event.type === "session_paused"), state === "healthy");
    if (state === "quarantined") {
      assert.match(saved.error, /Pause cannot be confirmed.*quarantined/);
      assert.equal(fixture.events.some(event => event.type === "pause_error"), true);
    }
  });
});

test("clone barriers cover the final copied append and preserve source on failure; healthy v2 copies recover independently", async t => {
  for (const fault of ["file", "directory", "none"]) await t.test(fault, async st => {
    let cloning = false, fixture, copied, sawFile = false, sawDirectory = false;
    const fsync = fs.fsyncSync;
    const mock = st.mock.method(fs, "fsyncSync", fd => {
      if (cloning) {
        const stat = fs.fstatSync(fd);
        const children = fs.readdirSync(fixture.manager.getSessionDir()).filter(name => name.endsWith(".jsonl") && !fixture.manager.getSessionFile().endsWith(name));
        assert.equal(children.length, 1);
        copied = join(fixture.manager.getSessionDir(), children[0]);
        const records = readFileSync(copied, "utf8").trim().split("\n").map(JSON.parse);
        assert.equal(records.at(-1).customType, "brabbler:native-resources", "barrier occurs after the final copied preference append");
        if (stat.isFile()) { sawFile = true; if (fault === "file") throw new Error("copied file barrier failed"); }
        if (stat.isDirectory()) { sawDirectory = true; if (fault === "directory") throw new Error("copied directory barrier failed"); }
      }
      return fsync(fd);
    });
    const restore = () => { mock.mock.restore(); syncBuiltinESMExports(); };
    st.after(restore); syncBuiltinESMExports();
    const { AgentSessionWrapper: Wrapper } = await createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false, moduleCache: false }).import("./rpc-manager.ts");
    fixture = setup(st, false, Wrapper);
    const { manager, ui, wrapper, events } = fixture;
    manager.appendMessage({ role: "user", content: "saved conversation", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "saved response" }], api: "test", provider: "test", model: "test", stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() });
    const proposal = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "proposal", files: ["selected"] });
    ui.operationReceipt("example", withReview(proposal));
    const settlement = await ui.saveOperationReview("example", receipt.operationId, "example/v1", { kind: "settlement", proposal });
    ui.operationReceipt("example", { ...withReview(settlement), phase: "succeeded", effectStarted: true });
    const terminal = manager.getLeafId(); manager.appendSessionInfo("unrelated source-only metadata");
    const sourceFile = manager.getSessionFile(), sourceBytes = readFileSync(sourceFile), sourceId = manager.getSessionId(), sourceLeaf = manager.getLeafId();
    cloning = true;
    if (fault !== "none") {
      await assert.rejects(wrapper.send({ type: "clone", leafId: terminal }), /copied .* barrier failed/);
      assert.equal(wrapper.isAlive(), true); assert.equal(fixture.disposals(), 0);
      assert.equal(events.some(event => event.type === "session_shutdown"), false);
      assert.equal(manager.getSessionId(), sourceId); assert.equal(manager.getLeafId(), sourceLeaf);
      assert.equal(readFileSync(sourceFile).equals(sourceBytes), true, "failed copy leaves source and unrelated history untouched");
    } else {
      const result = await wrapper.send({ type: "clone", leafId: terminal });
      assert.equal(result.cancelled, false); assert.notEqual(result.newSessionId, sourceId);
      assert.equal(wrapper.isAlive(), false); assert.equal(fixture.disposals(), 1);
      assert.equal(readFileSync(sourceFile).equals(sourceBytes), true);
      const clonedPath = await resolveSessionPath(result.newSessionId);
      assert.ok(clonedPath, "published clone identity resolves independently of the barrier observer");
      const clone = SessionManager.open(clonedPath);
      assert.ok(findOperationReview(clone.getEntries(), "example", proposal, clone.getLeafId()));
      assert.ok(findOperationReview(clone.getEntries(), "example", settlement, clone.getLeafId()));
      assert.ok(clone.getEntry(terminal));
      rmSync(sourceFile);
      const owner = await resolveSessionReview(result.newSessionId, settlement.id);
      assert.equal(owner.metadata.payload.kind, "settlement"); assert.equal(owner.resolveLinked(proposal).payload.kind, "proposal");
    }
    assert.equal(sawFile, true); assert.equal(sawDirectory, fault !== "file");
    cloning = false; restore();
  });
});
