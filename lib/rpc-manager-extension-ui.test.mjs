import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
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

function setup(t, handler = async () => {}) {
  let ui;
  const errors = [];
  const inner = {
    sessionId: "extension-ui-test",
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => "/tmp" },
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
  return { wrapper, ui, events, errors };
}

for (const method of ["select", "confirm", "input", "editor", "custom"]) {
  test(`Stop unwinds a command waiting on ${method} and closes its UI`, async (t) => {
    let continued = false;
    let disposed = 0;
    const { wrapper, events, errors } = setup(t, async (ui) => {
      if (method === "custom") {
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
    else await wrapper.send({ type: "extension_ui_response", id: nextRequest.id, value: "A", confirmed: true });
    await nextSending;
    assert.equal(continued, true);
  });
}

test("git_action retains its exact candidate on reconnect and rejects malformed replies", async (t) => {
  const { wrapper, ui, events } = setup(t);
  const candidate = { kind: "commit", preview: { repositoryRoot: "/repo", branch: "refs/heads/feature", head: "a".repeat(40),
    paths: ["file"], tree: "b".repeat(40), reviewToken: "c".repeat(64) }, message: "Commit", diff: { fromTreeOid: "d".repeat(40), toTreeOid: "b".repeat(40), patch: "diff", hasBinaryChanges: false } };
  const waiting = ui.gitAction(candidate);
  const request = events.find((event) => event.method === "git_action");
  assert.equal(wrapper.getPendingAttention().method, "git_action");
  const replay = [];
  wrapper.onEvent((event) => replay.push(event))();
  assert.deepEqual(replay.find((event) => event.id === request.id).candidate, candidate);
  await wrapper.send({ type: "extension_ui_response", id: request.id, value: "yes" });
  assert.equal(wrapper.pendingUiRequests.has(request.id), true);
  await wrapper.send({ type: "extension_ui_response", id: request.id, confirmed: true });
  assert.equal(await waiting, true);
  assert.equal(wrapper.getPendingAttention(), null);
  assert.ok(events.some((event) => event.type === "extension_ui_closed" && event.id === request.id));
  const cancelled = ui.gitAction(candidate);
  await wrapper.send({ type: "extension_ui_response", id: events.findLast((event) => event.method === "git_action").id, cancelled: true });
  assert.equal(await cancelled, false);
});

test("exact merge response must match the server-held plan ID and Stop cancels approval", async (t) => {
  const { wrapper, ui, events } = setup(t);
  const candidate = { kind: "integration", plan: { planId: "exact-plan", diff: { patch: "" } }, receipts: [] };
  const waiting = ui.gitAction(candidate);
  const request = events.findLast((event) => event.method === "git_action");
  await wrapper.send({ type: "extension_ui_response", id: request.id, confirmed: true });
  await wrapper.send({ type: "extension_ui_response", id: request.id, approvePlanId: "different" });
  assert.equal(wrapper.pendingUiRequests.has(request.id), true);
  await wrapper.send({ type: "extension_ui_response", id: request.id, approvePlanId: "exact-plan" });
  assert.equal(await waiting, true);
  const second = ui.gitAction(candidate);
  const secondRequest = events.findLast((event) => event.method === "git_action");
  await wrapper.send({ type: "extension_ui_response", id: secondRequest.id, cancelled: true });
  assert.equal(await second, false);
});

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

test("Stop before custom UI initialization does not invoke the factory", async (t) => {
  const { wrapper, ui } = setup(t);
  let invoked = false;
  const pending = ui.custom(() => { invoked = true; return { render: () => [] }; });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await wrapper.send({ type: "abort" });
  await rejected;
  assert.equal(invoked, false);
});
