import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createAgentEventStream } = await jiti.import("./agent-event-stream.ts");
const { hasActiveSessionLivenessProvider } = await jiti.import("./session-liveness.ts");
const { streamReducer, INITIAL_STREAMING_STATE } = await jiti.import("./streaming-message.ts");
const decoder = new TextDecoder();

async function connected(t, limit = 8 * 1024 * 1024) {
  const original = process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = String(limit);
  const abort = new AbortController();
  const sessionId = t.name;
  let listener, unsubscribed = 0;
  t.after(() => {
    abort.abort();
    if (original === undefined) delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
    else process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = original;
  });
  const reader = createAgentEventStream(new Request("http://localhost/events", { signal: abort.signal }), sessionId, Promise.resolve({
    isStreaming: true, streamingMessage: undefined,
    onEvent(next) { listener = next; return () => { unsubscribed++; }; },
  })).getReader();
  await readChunk(reader);
  await readChunk(reader);
  return { reader, emit: (event) => listener(event), abort, sessionId, unsubscribed: () => unsubscribed };
}

async function readChunk(reader) {
  let timer;
  try {
    return await Promise.race([reader.read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out reading backpressure fixture")), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

async function read(reader) {
  const chunk = await readChunk(reader);
  assert.equal(chunk.done, false);
  return JSON.parse(decoder.decode(chunk.value).slice(6));
}
const partial = "x".repeat(30_000);
const toolUpdate = () => ({ type: "tool_execution_update", toolCallId: "call", toolName: "bash", partialResult: partial });

test("slow clients drop partial tool output and resume after catching up", async (t) => {
  const h = await connected(t);
  for (let i = 0; i < 60; i++) h.emit(toolUpdate());
  h.emit({ type: "agent_end" });
  let delivered = 0;
  while ((await read(h.reader)).type !== "agent_end") delivered++;
  assert.ok(delivered > 0 && delivered < 60);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: h.sessionId }), true);
  h.emit(toolUpdate());
  assert.equal((await read(h.reader)).type, "tool_execution_update");
});

for (const kind of ["text", "thinking", "toolcall"]) test(`authoritative ${kind} ends repair dropped deltas through the production reducer`, async (t) => {
  const h = await connected(t);
  const emit = (event) => h.emit({ type: "message_update", message: { role: "assistant", content: [] }, assistantMessageEvent: event });
  emit({ type: `${kind}_start`, contentIndex: 0, id: "call", toolName: "bash" });
  for (let i = 0; i < 60; i++) emit({ type: `${kind}_delta`, contentIndex: 0, delta: partial });
  emit({ type: `${kind}_end`, contentIndex: 0, content: "final", toolCall: { id: "call", name: "bash", arguments: { command: "echo final" } } });
  h.emit({ type: "extension_ui_request", id: "approval", method: "confirm", title: "Keep this control event" });
  h.emit({ type: "agent_end" });
  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "snapshot", message: { role: "assistant", content: [] } });
  let deltas = 0, controls = 0;
  for (;;) {
    const event = await read(h.reader);
    if (event.type === "agent_end") break;
    if (event.type === "extension_ui_request") { controls++; continue; }
    if (event.assistantMessageEvent.type.endsWith("_delta")) deltas++;
    state = streamReducer(state, { type: "delta", event: event.assistantMessageEvent });
  }
  assert.ok(deltas < 60);
  assert.equal(controls, 1);
  const block = state.streamingMessage.content[0];
  if (kind === "toolcall") assert.deepEqual(block.input, { command: "echo final" });
  else assert.equal(block[kind], "final");
});

test("non-repairable backlog errors, unsubscribes and releases liveness exactly once", async (t) => {
  const h = await connected(t, 64 * 1024);
  for (let i = 0; i < 8; i++) h.emit({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: partial }] } });
  await assert.rejects(readChunk(h.reader), /client backlog exceeded/);
  assert.equal(h.unsubscribed(), 1);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: h.sessionId }), false);
  h.abort.abort();
  assert.equal(h.unsubscribed(), 1);
});

test("the backlog threshold allows one frame, then closes on the next durable enqueue", async (t) => {
  const h = await connected(t, 64 * 1024);
  h.emit({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "🦊".repeat(20_000) }] } });
  // The compatibility threshold is not a maximum event/frame size. UTF-8 bytes
  // exceed 64 KiB even though this string has fewer than 64 Ki UTF-16 units.
  h.emit({ type: "agent_end" });
  await assert.rejects(readChunk(h.reader), /client backlog exceeded/);
});

test("prompt consumers retain every event", async (t) => {
  const h = await connected(t);
  for (let i = 0; i < 40; i++) {
    h.emit(toolUpdate());
    assert.equal((await read(h.reader)).type, "tool_execution_update");
  }
});
