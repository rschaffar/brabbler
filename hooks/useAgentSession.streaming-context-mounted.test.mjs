import '../lib/testing/client-native-boundary.fixture.mjs';
// UNEXECUTED. Real event delivery, production store/reducer and admitted context callbacks.
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./agent-session-mounted.fixture.mjs";
const options = { timeout: 10000 };
const source = f => f.sources.findLast(item => item.readyState !== 2);
const assistant = content => ({ role: "assistant", content, timestamp: 2 });
const user = (content, timestamp = 1) => ({ role: "user", content, timestamp });
const page = (messages, entryIds, oldestEntryId, hasMore) => ({ messages, entryIds, oldestEntryId, hasMore, thinkingLevel: "off", model: null });
const delta = (f, event) => f.event(source(f), { type: "message_update", assistantMessageEvent: event });

// The old spelling assertions supplied no concrete SDK payloads. These explicit
// wire inputs retain all their branches; reducer algorithms are not copied here.
test("stream: connected state, authoritative snapshot and Pi JSON deltas reach one stable production store", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const store = f.current.streamingStore;
  await f.event(source(f), { type: "connected", isStreaming: true });
  await f.settleMaintenance();
  assert.equal(f.current.agentRunning, true);
  assert.equal(store.getState().streamingMessage, null);
  await f.event(source(f), { type: "message_start", message: assistant([
    { type: "text", text: "snapshot leak" }, { type: "thinking", thinking: "snapshot leak" },
    { type: "toolCall", id: "call/1", name: "bash", arguments: {}, partialJson: "snapshot leak" },
  ]) });
  await delta(f, { type: "text_start", contentIndex: 0 });
  await delta(f, { type: "text_delta", contentIndex: 0, delta: "hello \ud83c\udf0d" });
  await delta(f, { type: "thinking_start", contentIndex: 1 });
  await delta(f, { type: "thinking_delta", contentIndex: 1, delta: "reason\n" });
  await delta(f, { type: "toolcall_start", contentIndex: 2, id: "call/1", toolName: "bash" });
  await delta(f, { type: "toolcall_delta", contentIndex: 2, delta: '{"command":"echo' });
  assert.equal(store.getState().streamingMessage.content[2].rawInput, '{"command":"echo');
  await delta(f, { type: "toolcall_end", contentIndex: 2, toolCall: { id: "call/1", name: "bash", arguments: { command: "echo hello" } } });
  await delta(f, { type: "text_end", contentIndex: 0, content: "authoritative \ud83c\udf0d" });
  await delta(f, { type: "thinking_end", contentIndex: 1, content: "authoritative reasoning" });
  assert.deepEqual(store.getState().streamingMessage.content, [
    { type: "text", text: "authoritative \ud83c\udf0d" }, { type: "thinking", thinking: "authoritative reasoning" },
    { type: "toolCall", toolCallId: "call/1", toolName: "bash", input: { command: "echo hello" } },
  ]);
  assert.equal(f.current.streamingStore === store, true);
  const completed = assistant([{ type: "toolCall", id: "call/1", name: "bash", arguments: { command: "echo final" } }]);
  await f.event(source(f), { type: "message_end", entryId: "saved-assistant", message: completed });
  assert.deepEqual(f.current.messages.at(-1).content, [{ type: "toolCall", toolCallId: "call/1", toolName: "bash", input: { command: "echo final" } }]);
  assert.deepEqual(f.current.entryIds, ["saved-assistant"]);
  assert.equal(store.getState().streamingMessage, null);
});

test("stream: toolcall-only deltas keep the empty waiting phase until actual content arrives", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  await f.event(source(f), { type: "agent_start" });
  await f.event(source(f), { type: "message_start", message: assistant([]) });
  await delta(f, { type: "toolcall_start", contentIndex: 0, id: "pending-call", toolName: "bash" });
  assert.equal(f.current.agentPhase.kind, "waiting_model");
  await delta(f, { type: "toolcall_delta", contentIndex: 0, delta: '{"command":' });
  assert.equal(f.current.agentPhase.kind, "waiting_model");
  await delta(f, { type: "text_start", contentIndex: 1 });
  assert.equal(f.current.agentPhase, null);
});

test("stream: system start/end and user start stay out of chat; message_update uses its assistant payload, not extraneous outer metadata; legacy/late events stay ignored", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  await f.event(source(f), { type: "agent_start" });
  await f.event(source(f), { type: "message_start", message: assistant([{ type: "text", text: "keep" }]) });
  const store = f.current.streamingStore;
  // Preserve every original event and input value. The production wire contract
  // identifies transcript system messages only at message_start/message_end.
  // message_update consumes assistantMessageEvent; its extraneous outer message
  // is not a system-message veto (the normal wire projection omits that field).
  // Thus the literal delta named "forbidden" is valid assistant content here.
  for (const [type, expectedText] of [
    ["message_start", "keep"],
    ["message_update", "keepforbidden"],
    ["message_end", "keepforbidden"],
  ]) {
    await f.event(source(f), { type, message: { role: "system", content: "private schemas" }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "forbidden" } });
    assert.equal(f.current.streamingStore === store, true, "one hook-owned store instance");
    assert.deepEqual(store.getState().streamingMessage, assistant([{ type: "text", text: expectedText }]), `exact assistant payload after ${type}`);
    assert.equal(store.getState().isStreaming, true);
    assert.deepEqual(f.current.messages, [], "system start/end never enter transcript");
    assert.deepEqual(f.current.entryIds, []);
  }
  await f.event(source(f), { type: "message_start", message: user("user start") });
  assert.deepEqual(store.getState().streamingMessage, assistant([{ type: "text", text: "keepforbidden" }]), "user start does not replace assistant");
  await f.event(source(f), { type: "message_delta", delta: "unsupported old protocol" });
  assert.equal(f.current.streamingStore === store, true);
  assert.deepEqual(store.getState().streamingMessage, assistant([{ type: "text", text: "keepforbidden" }]), "legacy message_delta is not the Pi JSON update protocol");
  assert.deepEqual(f.current.messages, []);
  await f.event(source(f), { type: "agent_settled" }); await f.settleMaintenance();
  await f.event(source(f), { type: "message_start", message: assistant([{ type: "text", text: "ghost" }]) });
  await f.event(source(f), { type: "message_end", entryId: "ghost", message: assistant([{ type: "text", text: "ghost" }]) });
  assert.equal(f.current.streamingStore.getState().streamingMessage, null);
  assert.deepEqual(f.current.entryIds, []);
});

test("stream: late initial running-state restore uses resume rather than clearing the already delivered SSE snapshot", options, async t => {
  const f = await sessionFixture(t);
  const state = f.hold(request => request.path === `/api/sessions/${f.savedId}/state`, { stage: "headers", repeat: true });
  await f.mount(f.existingOptions());
  await f.connect(source(f));
  await state.entered.promise;
  await f.event(source(f), { type: "connected", isStreaming: true });
  await f.event(source(f), { type: "message_start", message: assistant([{ type: "text", text: "SSE before disk-state" }]) });
  const snapshot = f.current.streamingStore.getState().streamingMessage;
  await f.deliver(state, { running: true, state: { ...f.live(f.savedId), isStreaming: true } });
  await f.settleMaintenance();
  assert.equal(f.current.streamingStore.getState().streamingMessage === snapshot, true);
  assert.equal(f.current.streamingStore.getState().isStreaming, true);
});

for (const name of ["bash", "powershell", "codemode"]) test(`tools: ${name} partial output and most recent progress join the exact call then disappear on end`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  await f.event(source(f), { type: "agent_start" });
  await f.event(source(f), { type: "tool_execution_start", toolCallId: "other", toolName: "read" });
  await f.event(source(f), { type: "tool_execution_start", toolCallId: "call/1", toolName: name });
  const content = [{ type: "text", text: "earlier\nlatest   progress\n" }];
  await f.event(source(f), { type: "tool_execution_update", toolCallId: "call/1", toolName: name, partialResult: { content, isError: false, details: { owner: "call/1" } } });
  assert.deepEqual(f.current.activeToolResults.get("call/1"), { role: "toolResult", toolCallId: "call/1", toolName: name, content, isError: false, details: { owner: "call/1" } });
  assert.deepEqual(f.current.agentPhase.tools, [{ id: "other", name: "read" }, { id: "call/1", name, progress: "latest progress" }]);
  await f.event(source(f), { type: "tool_execution_update", toolCallId: "other", toolName: "read", partialResult: { content: [{ type: "text", text: "newest read" }] } });
  assert.equal(f.current.agentPhase.tools.at(-1).id, "other");
  assert.equal(f.current.activeToolResults.has("other"), false);
  await f.event(source(f), { type: "tool_execution_update", parentToolCallId: "parent", toolCallId: "nested", toolName: name, partialResult: { content } });
  assert.equal(f.current.activeToolResults.has("nested"), false);
  await f.event(source(f), { type: "tool_execution_end", toolCallId: "call/1" });
  assert.equal(f.current.activeToolResults.has("call/1"), false);
  assert.equal(f.current.agentPhase.tools.some(tool => tool.id === "call/1"), false);
});

test("context: server cursor/hasMore beat rendered entry IDs; admitted older page prepends both data and transcript", options, async t => {
  const f = await sessionFixture(t), sid = `${f.savedId} /?#%`;
  const row = f.declareSession(sid); row.leaf = "leaf /?#%";
  await f.mountReady(f.existingOptions(sid));
  assert.equal(f.current.hasEarlierMessages, false);
  const first = f.hold(request => request.path === `/api/sessions/${encodeURIComponent(sid)}/context`);
  const replace = await f.start("canonical context", value => value.loadContext(sid, row.leaf));
  await first.entered.promise;
  await f.finish(replace, () => first.resolve({ context: page([user("visible newest")], ["visible-newest"], "raw-hidden-cursor", true) }));
  assert.equal(f.current.historyCursor, "raw-hidden-cursor");
  assert.equal(f.current.hasEarlierMessages, true);
  const gate = f.hold(request => request.query.get("before") === "raw-hidden-cursor");
  const operation = await f.start("admitted older page", value => value.loadContext(sid, row.leaf, f.current.historyCursor, { tail: 7 }));
  await gate.entered.promise;
  assert.equal(gate.request.path, `/api/sessions/${encodeURIComponent(sid)}/context`);
  assert.equal(gate.request.query.get("leafId"), row.leaf);
  assert.equal(gate.request.query.get("tail"), "7");
  await f.finish(operation, () => gate.resolve({ context: page([user("older")], ["older-id"], "raw-oldest", false) }));
  assert.deepEqual(f.current.messages.map(message => message.content), ["older", "visible newest"]);
  assert.deepEqual(f.current.entryIds, ["older-id", "visible-newest"]);
  assert.deepEqual(f.current.data.context.messages.map(message => message.content), ["older", "visible newest"]);
  assert.deepEqual(f.current.data.context.entryIds, ["older-id", "visible-newest"]);
  assert.equal(f.current.historyCursor, "raw-oldest");
  assert.equal(f.current.hasEarlierMessages, false, "row count does not invent another page");
});

test("context: older page merges with a concurrently completed live message rather than its captured transcript", options, async t => {
  const f = await sessionFixture(t), row = f.record(f.savedId);
  row.messages = [user("current")]; row.entryIds = ["current-id"];
  await f.mountReady(f.existingOptions());
  await f.event(source(f), { type: "agent_start" });
  const gate = f.hold(request => request.query.get("before") === "current-id");
  const operation = await f.start("older page while live", value => value.loadContext(f.savedId, null, "current-id"));
  await gate.entered.promise;
  await f.event(source(f), { type: "message_end", entryId: "live-id", message: assistant([{ type: "text", text: "live" }]) });
  await f.finish(operation, () => gate.resolve({ context: page([user("old")], ["old-id"], "old-id", false) }));
  assert.deepEqual(f.current.entryIds, ["old-id", "current-id", "live-id"]);
  assert.equal(f.current.messages.at(-1).content[0].text, "live");
});

for (const invalidation of ["aborted", "leaf", "keyed A/B/A", "unmount"]) test(`context: ignored-abort body after ${invalidation} cannot publish its cursor or rows`, options, async t => {
  const f = await sessionFixture(t), row = f.record(f.savedId);
  row.leaf = "canonical"; row.messages = [user("keep")]; row.entryIds = ["keep-id"];
  await f.mountReady(f.existingOptions());
  const controller = new AbortController(), gate = f.hold(request => request.query.get("before") === "keep-id");
  const operation = await f.start("old admitted page including catch/finally", value => value.loadContext(f.savedId, "canonical", "keep-id", { signal: controller.signal }));
  await gate.entered.promise;
  if (invalidation === "aborted") controller.abort();
  if (invalidation === "leaf") await f.run("browse another branch using actual callback", () => f.leafChange("independent-leaf"));
  if (invalidation === "keyed A/B/A") { await f.mountReady(f.existingOptions(`${f.savedId}-B`)); await f.mountReady(f.existingOptions()); }
  if (invalidation === "unmount") await f.unmount();
  const before = f.current.entryIds.slice(), cursor = f.current.historyCursor;
  await f.finish(operation, () => gate.resolve({ context: page([user("must not publish")], ["stale-id"], "stale-cursor", true) }));
  assert.deepEqual(f.current.entryIds, before);
  assert.equal(f.current.historyCursor, cursor);
});
