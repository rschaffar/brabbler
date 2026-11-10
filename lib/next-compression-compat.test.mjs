import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { createJiti } from "jiti";
import { NodeNextResponse } from "next/dist/server/base-http/node.js";
import { createNextHTTPBridge } from "./next-compression.fixture.mjs";

const jiti = createJiti(import.meta.url, { fsCache: false });
const { jsonResponse } = await jiti.import("./json-response.ts");
const { SSE_HEADERS } = await jiti.import("./sse-stream.ts");
const large = { value: "JSON transport fixture ".repeat(200) };

// Next 16.4.6 fixes the singleton array bug; no application compressor patch.
test("Next preserves scalar headers for its native compressor and real multiple values", () => {
  const response = new ServerResponse({ method: "GET" });
  const next = new NodeNextResponse(response);
  next.appendHeader("Content-Type", "application/json; charset=utf-8");
  assert.equal(response.getHeader("Content-Type"), "application/json; charset=utf-8");
  next.appendHeader("Content-Type", "application/json; charset=utf-8");
  assert.equal(response.getHeader("Content-Type"), "application/json; charset=utf-8");
  next.appendHeader("Vary", "Origin");
  next.appendHeader("Vary", "Accept-Encoding");
  assert.deepEqual(response.getHeader("Vary"), ["Origin", "Accept-Encoding"]);
});

test("real unmodified Next HTTP transport retains gzip, decoded bytes, variants and refusal for catalogue and detail", async t => {
  const bridge = await createNextHTTPBridge(t, request => jsonResponse(request, large, {
    status: 202, headers: { "Cache-Control": "no-store", Vary: "Origin" },
  }));
  for (const path of ["/api/sessions", "/api/sessions?summary=1&compact=1", "/api/sessions/test-id"]) {
    const gzip = await bridge.request(path, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(gzip.status, 202);
    assert.equal(gzip.headers["content-encoding"], "gzip");
    assert.deepEqual([...gzip.body.subarray(0, 2)], [0x1f, 0x8b]);
    assert.deepEqual(JSON.parse(gunzipSync(gzip.body).toString("utf8")), large);
    assert.ok(gzip.body.length < Buffer.byteLength(JSON.stringify(large)));
    assert.equal(gzip.headers["content-length"], undefined);
    assert.equal(gzip.headers["cache-control"], "no-store");
    assert.match(gzip.headers.vary, /Origin/);
    assert.match(gzip.headers.vary, /Accept-Encoding/i);
    for (const encoding of ["identity", "gzip;q=0, identity"]) {
      const plain = await bridge.request(path, { headers: { "Accept-Encoding": encoding } });
      assert.equal(plain.headers["content-encoding"], undefined);
      assert.deepEqual(JSON.parse(plain.body.toString("utf8")), large);
    }
  }
});

test("native compression preserves small/error bytes and honors no-transform, production SSE and media",  async t => {
  const events = "data: event\n\n".repeat(200);
  const media = Buffer.alloc(2048, 42);
  const bridge = await createNextHTTPBridge(t, request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/sessions/small") return jsonResponse(request, { ok: true });
    if (path === "/api/sessions/no-transform") return jsonResponse(request, large, { headers: { "Cache-Control": "no-store, no-transform" } });
    if (path === "/api/sessions/locked") return new Response("Authentication required", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (path === "/api/sessions/events") return new Response(events, { headers: SSE_HEADERS });
    return new Response(media, { headers: { "Content-Type": "image/png", Vary: "Accept-Encoding" } });
  });
  for (const [path, status, type, expected, compressed] of [
    // Unknown-length streamed bodies use Next's native policy, even below 1 KiB.
    ["/api/sessions/small", 200, "application/json; charset=utf-8", Buffer.from('{"ok":true}'), true],
    ["/api/sessions/no-transform", 200, "application/json; charset=utf-8", Buffer.from(JSON.stringify(large)), false],
    ["/api/sessions/locked", 401, "text/plain; charset=utf-8", Buffer.from("Authentication required"), true],
    ["/api/sessions/events", 200, "text/event-stream", Buffer.from(events), false],
    ["/api/sessions/media", 200, "image/png", media, false],
  ]) {
    const wire = await bridge.request(path, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(wire.status, status, path);
    assert.equal(wire.headers["content-type"], type, path);
    assert.equal(wire.headers["content-encoding"], compressed ? "gzip" : undefined, path);
    assert.deepEqual(compressed ? gunzipSync(wire.body) : wire.body, expected, path);
  }
});

test("upstream compression also handles HTML errors and unrelated JSON without a route-specific patch", async t => {
  const html = "<p>error page</p>".repeat(200);
  const bridge = await createNextHTTPBridge(t, request => new URL(request.url).pathname.endsWith("/html")
    ? new Response(html, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
    : jsonResponse(request, large));
  for (const [path, status, type, body] of [
    ["/api/sessions/html", 500, "text/html; charset=utf-8", html],
    ["/api/other", 200, "application/json; charset=utf-8", JSON.stringify(large)],
  ]) {
    const wire = await bridge.request(path, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(wire.status, status);
    assert.equal(wire.headers["content-type"], type);
    assert.equal(wire.headers["content-encoding"], "gzip");
    assert.equal(gunzipSync(wire.body).toString("utf8"), body);
  }
});

test("retains HEAD and bodyless response framing", async t => {
  const bridge = await createNextHTTPBridge(t, request => new URL(request.url).pathname.endsWith("/empty")
    ? new Response(null, { status: 204 }) : jsonResponse(request, large));
  const head = await bridge.request("/api/sessions", { method: "HEAD", headers: { "Accept-Encoding": "gzip" } });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const empty = await bridge.request("/api/sessions/empty", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(empty.status, 204);
  assert.equal(empty.body.length, 0);
  assert.equal(empty.headers["content-encoding"], undefined);
});
