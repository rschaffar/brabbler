import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-extension-ui-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, getRecentRpcSessionCompletions } = await jiti.import("./rpc-manager.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, handler = async () => {}, manager = SessionManager.inMemory("/tmp")) {
  let ui;
  const errors = [];
  const inner = {
    sessionId: "extension-ui-test",
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: manager,
    agent: { state: {}, abort() {} },
    abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose() {},
    // Use the SDK's actual command dispatch and idle-agent abort paths.
    prompt: AgentSession.prototype.prompt,
    _tryExecuteExtensionCommand: AgentSession.prototype._tryExecuteExtensionCommand,
    abort: AgentSession.prototype.abort,
    waitForIdle: AgentSession.prototype.waitForIdle,
    _extensionRunner: {
      getCommand: () => ({ handler: () => handler(ui) }),
      createCommandContext: () => ({}),
      emitError: (error) => errors.push(error),
    },
    extensionRunner: {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  ui = wrapper.createExtensionUiContext();
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, ui, events, errors, manager };
}

for (const method of ["select", "confirm", "input", "editor", "custom", "plugin_card"]) {
  test(`Stop unwinds a command waiting on ${method} and closes its UI`, async (t) => {
    let continued = false;
    let disposed = 0;
    const { wrapper, events, errors } = setup(t, async (ui) => {
      if (method === "plugin_card") {
        await ui.pluginCard("example", { title: "Choose", actions: [{ id: "approve", label: "Approve" }] });
      } else if (method === "custom") {
        await ui.custom(() => ({ render: () => ["Choose"], dispose: () => { disposed += 1; } }));
      } else {
        await ui[method]("Choose", method === "select" ? ["A", "B"] : "Details");
      }
      continued = true;
    });
    const sending = wrapper.send({ type: "prompt", message: "/choose" });
    await nextTurn();
    const request = events.find((event) => event.method === method);
    assert.ok(request);
    assert.equal(wrapper.isRunning(), true);

    await wrapper.send({ type: "abort" });
    await sending;
    await nextTurn();
    assert.equal(continued, false);
    assert.equal(wrapper.isRunning(), false);
    assert.equal(wrapper.pendingUiRequests.size, 0);
    assert.equal(wrapper.pendingUiResponses.size, 0);
    assert.equal(wrapper.activeCustomUis.size, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /cancelled by Stop/);
    assert.ok(events.some((event) => event.id === request.id && (event.type === "extension_ui_closed" || event.closed)));
    assert.ok(events.some((event) => event.type === "prompt_done"));
    assert.equal(disposed, method === "custom" ? 1 : 0);
    const replay = [];
    wrapper.onEvent((event) => replay.push(event))();
    assert.equal(replay.some((event) => event.id === request.id), false);

    // A later explicit command can ask again; answering still resumes it.
    const nextSending = wrapper.send({ type: "prompt", message: "/choose" });
    await nextTurn();
    const nextRequest = events.findLast((event) => event.method === method && !event.closed);
    assert.notEqual(nextRequest.id, request.id);
    if (method === "custom") wrapper.closeCustomUi(nextRequest.id, "A");
    else if (method === "plugin_card") await wrapper.send({ type: "extension_ui_response", id: nextRequest.id, action: "approve" });
    else await wrapper.send({ type: "extension_ui_response", id: nextRequest.id, value: "A", confirmed: true });
    await nextSending;
    assert.equal(continued, true);
  });
}

test("activity attention reports only live blocking requests and clears after response or Stop", async (t) => {
  const { wrapper, ui, events } = setup(t, async (context) => {
    await context.select("Need approval", ["Yes"]);
  });
  assert.equal(wrapper.getPendingAttention(), null);
  const pending = ui.askUser({ question: "  Which  option?  ", options: [], allowMultiple: false, allowFreeform: true, allowComment: false, contextExpanded: false });
  assert.deepEqual(wrapper.getPendingAttention(), {
    sessionId: "extension-ui-test", method: "ask_user", summary: "Which option?", since: wrapper.getPendingAttention().since,
  });
  const question = events.at(-1);
  await wrapper.send({ type: "extension_ui_response", id: question.id, cancelled: true });
  await pending;
  assert.equal(wrapper.getPendingAttention(), null);

  const custom = ui.custom(() => ({ render: () => ["Interactive panel"] }));
  await nextTurn();
  const first = wrapper.getPendingAttention();
  assert.equal(first.method, "custom");
  assert.equal(first.summary, "");
  wrapper.closeCustomUi(events.at(-1).id, undefined);
  await custom;
  assert.equal(wrapper.getPendingAttention(), null);

  const sending = wrapper.send({ type: "prompt", message: "/choose" });
  await nextTurn();
  assert.equal(wrapper.getPendingAttention().summary, "Need approval");
  await wrapper.send({ type: "abort" });
  await sending;
  assert.equal(wrapper.getPendingAttention(), null);
  assert.ok(getRecentRpcSessionCompletions().some((event) =>
    event.sessionId === wrapper.sessionId && Number.isFinite(event.at)));
});

test("activity attention expires with timed requests and disappears on teardown", async (t) => {
  const { wrapper, ui } = setup(t);
  const pending = ui.select("Timeout", ["A"], { timeout: 10 });
  assert.equal(wrapper.getPendingAttention().method, "select");
  await pending;
  assert.equal(wrapper.getPendingAttention(), null);
  const ignored = ui.input("Still waiting");
  assert.equal(wrapper.getPendingAttention().method, "input");
  wrapper.destroy();
  await ignored;
  assert.equal(wrapper.getPendingAttention(), null);
});

test("normal cancel and caller abort keep UI defaults and notify all subscribers", async (t) => {
  const { wrapper, ui, events } = setup(t);
  const pending = ui.select("Choose", ["A"]);
  const request = events.at(-1);
  await wrapper.send({ type: "extension_ui_response", id: request.id, cancelled: true });
  assert.equal(await pending, undefined);
  assert.deepEqual(events.at(-1), { type: "extension_ui_closed", id: request.id });

  const controller = new AbortController();
  const confirm = ui.confirm("Confirm", "Continue?", { signal: controller.signal });
  controller.abort();
  assert.equal(await confirm, false);
  assert.equal(wrapper.pendingUiRequests.size, 0);
});

test("Stop cancels a custom UI factory that has not mounted yet", async (t) => {
  const { wrapper, ui, events } = setup(t);
  let finishFactory;
  let disposed = false;
  const pending = ui.custom(() => new Promise((resolve) => { finishFactory = resolve; }));
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await nextTurn();
  await wrapper.send({ type: "abort" });
  await rejected;
  finishFactory({ render: () => ["Late panel"], dispose: () => { disposed = true; } });
  await nextTurn();
  assert.equal(disposed, true);
  assert.equal(events.some((event) => event.method === "custom"), false);
  assert.equal(wrapper.activeCustomUis.size, 0);
  await assert.rejects(ui.select("Reopen after Stop", ["A"]), { name: "AbortError" });
});

test("ask_user replays its structured question, validates responses, and closes on answer", async (t) => {
  const { wrapper, ui, events } = setup(t);
  const question = { question: "Which?", context: "Context", options: [{ title: "A", description: "Details" }, { title: "B" }], allowMultiple: false, allowFreeform: true, allowComment: true, contextExpanded: false };
  const pending = ui.askUser(question, 1000);
  const request = events.at(-1);
  assert.equal(request.method, "ask_user");
  assert.deepEqual(request.options, question.options);
  const replay = [];
  wrapper.onEvent((event) => replay.push(event))();
  assert.deepEqual(replay[0], request);
  await wrapper.send({ type: "extension_ui_response", id: request.id, answer: { kind: "selection", selections: ["unknown"] } });
  assert.equal(wrapper.pendingUiRequests.size, 1, "invalid browser response must not dismiss the question");
  await wrapper.send({ type: "extension_ui_response", id: request.id, answer: { kind: "selection", selections: ["B"], comment: " ok " } });
  assert.deepEqual(await pending, { kind: "selection", selections: ["B"], comment: "ok" });
  assert.equal(wrapper.pendingUiRequests.size, 0);
  assert.ok(events.some((event) => event.type === "extension_ui_closed" && event.id === request.id));
});

test("ask_user cancellation, server expiry, and Stop settle without stale UI", async (t) => {
  const { wrapper, ui, events } = setup(t, async (context) => {
    await context.askUser({ question: "Stop?", options: [], allowMultiple: false, allowFreeform: true, allowComment: false, contextExpanded: false });
  });
  const question = { question: "Wait?", options: [], allowMultiple: false, allowFreeform: true, allowComment: false, contextExpanded: false };
  const timed = ui.askUser(question, 10);
  assert.equal(await timed, null);
  assert.equal(wrapper.pendingUiRequests.size, 0);
  const pending = ui.askUser(question);
  const id = events.at(-1).id;
  await wrapper.send({ type: "extension_ui_response", id, cancelled: true });
  assert.equal(await pending, null);
  const sending = wrapper.send({ type: "prompt", message: "/choose" });
  await nextTurn();
  const request = events.findLast((event) => event.method === "ask_user");
  await wrapper.send({ type: "abort" });
  await sending;
  assert.equal(wrapper.pendingUiRequests.size, 0);
  assert.ok(events.some((event) => event.type === "extension_ui_closed" && event.id === request.id));
});

test("plugin cards replay only live requests, validate matching actions and cancel on teardown", async (t) => {
  const { wrapper, ui, events } = setup(t);
  const pending = ui.pluginCard("example", { title: "Preview", actions: [{ id: "approve", label: "Approve" }] });
  const request = events.at(-1);
  const replay = [];
  wrapper.onEvent((event) => replay.push(event))();
  assert.ok(replay.some((event) => event.id === request.id));
  await wrapper.send({ type: "extension_ui_response", id: "historical", action: "approve" });
  await wrapper.send({ type: "extension_ui_response", id: request.id, action: "other" });
  assert.equal(wrapper.pendingUiRequests.size, 1);
  await wrapper.send({ type: "extension_ui_response", id: request.id, action: "approve" });
  assert.equal(await pending, "approve");
  assert.equal(wrapper.pendingUiRequests.size, 0);
  const restarted = setup(t);
  await restarted.wrapper.send({ type: "extension_ui_response", id: request.id, action: "approve" });
  assert.equal(restarted.wrapper.pendingUiRequests.size, 0);
  const waiting = ui.pluginCard("example", { title: "Cancel", actions: [] });
  wrapper.destroy();
  assert.equal(await waiting, null);
});

test("Stop before custom UI initialization does not invoke the factory", async (t) => {
  const { wrapper, ui } = setup(t);
  let invoked = false;
  const pending = ui.custom(() => { invoked = true; return { render: () => [] }; });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await wrapper.send({ type: "abort" });
  await rejected;
  assert.equal(invoked, false);
});

test("approval receipts persist exact supplied patches before execution and survive SDK reload", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-receipt-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manager = SessionManager.create("/tmp", dir);
  const { wrapper, ui, events } = setup(t, undefined, manager);
  const patch = "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+reviewed\n";
  const card = { title: "Commit", fields: [{ label: "Message", value: "Exact message" }], patch,
    actions: [{ id: "approve", label: "Approve commit" }, { id: "reject", label: "Reject" }] };
  const pending = ui.pluginCard("example", card);
  const request = events.at(-1);
  card.fields[0].value = "Changed after display";
  card.patch = "Not the approved patch";
  card.actions.length = 0;
  await wrapper.send({ type: "extension_ui_response", id: request.id, action: "other" });
  assert.equal(manager.getEntries().length, 0);
  await wrapper.send({ type: "extension_ui_response", id: request.id, action: "approve" });
  assert.equal(await pending, "approve");
  const stored = SessionManager.open(manager.getSessionFile()).getEntries();
  assert.equal(stored.length, 1, "commands without assistant messages still flush their receipt");
  const receipt = stored[0];
  assert.equal(receipt.type, "custom");
  assert.equal(receipt.customType, "pi-web:interaction-receipt");
  assert.equal(receipt.data.request.patch, patch);
  assert.equal(receipt.data.request.fields[0].value, "Exact message");
  assert.deepEqual(receipt.data.response, { action: "approve" });
  assert.equal(receipt.data.outcome, "answered");
  assert.equal(receipt.data.completed, undefined, "an approval does not claim execution succeeded");
  assert.deepEqual(SessionManager.open(manager.getSessionFile()).buildSessionContext().messages, []);
  const emitted = events.findIndex((event) => event.type === "interaction_receipt");
  const closed = events.findIndex((event) => event.type === "extension_ui_closed");
  assert.ok(emitted >= 0 && emitted < closed);
  assert.deepEqual(events[emitted].entry, receipt);
  await wrapper.send({ type: "extension_ui_response", id: request.id, action: "approve" });
  assert.equal(manager.getEntries().length, 1, "duplicate approval creates no duplicate receipt");
  const replay = [];
  wrapper.onEvent((event) => replay.push(event))();
  assert.equal(replay.some((event) => event.method === "plugin_card"), false);
});

test("receipt outcomes distinguish cancellation, expiry, caller abort, teardown and declined confirmation", async (t) => {
  const { wrapper, ui, events, manager } = setup(t);
  const cancelled = ui.input("Cancel");
  await wrapper.send({ type: "extension_ui_response", id: events.at(-1).id, cancelled: true });
  await cancelled;
  await ui.select("Expire", ["A"], { timeout: 10 });
  const controller = new AbortController();
  const aborted = ui.confirm("Abort", "Details", { signal: controller.signal });
  controller.abort(); await aborted;
  const declined = ui.confirm("Decline", "Details");
  await wrapper.send({ type: "extension_ui_response", id: events.at(-1).id, confirmed: false });
  assert.equal(await declined, false);
  const teardown = ui.editor("Teardown", "Original");
  wrapper.destroy(); await teardown;
  const receipts = manager.getEntries().map((entry) => entry.data);
  assert.deepEqual(receipts.map((receipt) => receipt.outcome), ["cancelled", "timed_out", "aborted", "answered", "aborted"]);
  assert.deepEqual(receipts[3].response, { confirmed: false });
  assert.ok(receipts.every((receipt) => receipt.request.timeout === undefined && receipt.request.expiresAt === undefined));
  const count = receipts.length;
  await wrapper.send({ type: "extension_ui_response", id: receipts[1].request.id, value: "A" });
  assert.equal(manager.getEntries().length, count);
});

test("all dialog response shapes validate before settlement and store only normalized responses", async (t) => {
  const { wrapper, ui, events, manager } = setup(t);
  const selected = ui.select("Select", ["A"]);
  const id = events.at(-1).id;
  await wrapper.send({ type: "extension_ui_response", id, value: "Unknown" });
  await wrapper.send({ type: "extension_ui_response", id, confirmed: true });
  assert.equal(manager.getEntries().length, 0);
  assert.equal(wrapper.pendingUiResponses.size, 1);
  await wrapper.send({ type: "extension_ui_response", id, value: "A", extra: "not stored" });
  assert.equal(await selected, "A");
  const question = ui.askUser({ question: "Question", options: [{ title: "A" }], allowMultiple: false,
    allowFreeform: false, allowComment: true, contextExpanded: false });
  const questionId = events.at(-1).id;
  await wrapper.send({ type: "extension_ui_response", id: questionId, answer: { kind: "selection", selections: ["A"], comment: " trim ", extra: true } });
  assert.deepEqual(await question, { kind: "selection", selections: ["A"], comment: "trim" });
  assert.deepEqual(manager.getEntries().map((entry) => entry.data.response), [
    { value: "A" }, { answer: { kind: "selection", selections: ["A"], comment: "trim" } },
  ]);
});

test("failed receipt persistence closes the request without granting approval", async (t) => {
  const { wrapper, ui, events, manager } = setup(t);
  manager.appendCustomEntry = () => { throw new Error("Receipt write failed"); };
  const pending = ui.confirm("Approve", "Continue?");
  const rejected = assert.rejects(pending, /Receipt write failed/);
  await wrapper.send({ type: "extension_ui_response", id: events.at(-1).id, confirmed: true });
  await rejected;
  assert.equal(wrapper.pendingUiRequests.size, 0);
  assert.equal(wrapper.pendingUiResponses.size, 0);
  assert.equal(events.some((event) => event.type === "interaction_receipt"), false);
});

test("askUser returns the displayed-snapshot answer even if its caller mutates options", async (t) => {
  const { wrapper, ui, events, manager } = setup(t);
  const question = { question: "Which?", options: [{ title: "A" }], allowMultiple: false,
    allowFreeform: false, allowComment: true, contextExpanded: false };
  const pending = ui.askUser(question);
  const id = events.at(-1).id;
  question.options.length = 0;
  question.allowComment = false;
  await wrapper.send({ type: "extension_ui_response", id, answer: { kind: "selection", selections: ["A"], comment: "Reason" } });
  assert.deepEqual(await pending, { kind: "selection", selections: ["A"], comment: "Reason" });
  assert.deepEqual(manager.getEntries()[0].data.response.answer, await pending);
});
