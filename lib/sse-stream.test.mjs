import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sseFixture, readText } from "./sse-stream.fixture.mjs";

for (const mode of ["abort", "cancel", "complete"]) {
  test(`SSE stays alive during slow startup and cleans up on ${mode}`, async (t) => {
    const { createSseStream, intervals, tick } = sseFixture(t);
    const abort = new AbortController();
    let writer;
    let finishStartup;
    let closes = 0;
    const stream = createSseStream({ signal: abort.signal }, async (value) => {
      writer = value;
      await new Promise((resolve) => { finishStartup = resolve; });
      writer.send({ type: "late" });
    }, () => { closes++; });
    const reader = stream.getReader();
    t.after(() => reader.cancel());
    assert.equal(await readText(reader), ":\n\n");
    for (let i = 0; i < 5; i++) {
      tick();
      assert.equal(await readText(reader), ":\n\n");
    }
    writer.send({ value: "payload" }, "change");
    assert.equal(await readText(reader), 'event: change\ndata: {"value":"payload"}\n\n');
    if (mode === "abort") abort.abort();
    else if (mode === "cancel") await reader.cancel();
    else writer.close();
    finishStartup();
    await Promise.resolve();
    assert.equal(writer.closed, true);
    assert.equal(closes, 1);
    assert.equal(intervals.size, 0);
    assert.equal((await reader.read()).done, true);
    writer.send({ type: "ignored" });
    writer.close();
    abort.abort();
    assert.equal(closes, 1);
  });
}

test("already-aborted SSE does not start work or a timer", async (t) => {
  const { createSseStream, intervals } = sseFixture(t);
  const abort = new AbortController();
  abort.abort();
  let starts = 0;
  let closes = 0;
  const reader = createSseStream({ signal: abort.signal }, () => { starts++; }, () => { closes++; }).getReader();
  assert.equal((await reader.read()).done, true);
  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(intervals.size, 0);
});

test("SSE propagates startup errors and clears its timer", async (t) => {
  const { createSseStream, intervals } = sseFixture(t);
  const error = new Error("fixture startup failed");
  const reader = createSseStream({ signal: new AbortController().signal }, async () => {
    throw error;
  }, () => {}).getReader();
  assert.equal(await readText(reader), ":\n\n");
  await assert.rejects(reader.read(), /fixture startup failed/);
  assert.equal(intervals.size, 0);
});

test("all SSE routes share HTTP/2-compatible anti-buffering headers", async (t) => {
  const { SSE_HEADERS } = sseFixture(t);
  const response = new Response(null, { headers: SSE_HEADERS });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.has("connection"), false);
  for (const file of [
    "../app/api/agent/[id]/events/route.ts",
    "../app/api/terminal/[id]/events/route.ts",
    "../app/api/files/[...path]/route.ts",
    "../app/api/auth/login/[provider]/route.ts",
  ]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /headers: SSE_HEADERS/);
  }
});
