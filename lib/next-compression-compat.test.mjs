import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { createJiti } from "jiti";
import { createNextHTTPBridge } from "./next-compression.fixture.mjs";

const require = createRequire(import.meta.url);
const { verifyNextCompressionProfile, createCompatibleCompression, installNextCompressionCompat } = require("../bin/next-compression-compat.js");
const { jsonResponse } = await createJiti(import.meta.url, { fsCache: false }).import("./json-response.ts");
const large = { value: "JSON transport fixture ".repeat(200) };

function fakeResponse(type = ["application/json; charset=utf-8"], vary = ["Origin", "Accept-Encoding"]) {
  const headers = { "content-type": type, vary };
  return { getHeader: name => headers[name.toLowerCase()] };
}

test("adapts only the original predicate's singleton JSON view without changing headers", () => {
  const request = { method: "GET", url: "/api/sessions?compact=1" };
  const response = fakeResponse();
  const type = response.getHeader("Content-Type");
  const factory = options => options;
  factory.filter = (actual, view) => {
    assert.equal(actual, request);
    assert.equal(view.getHeader("Content-Type"), type[0]);
    assert.equal(view.getHeader("Vary"), response.getHeader("Vary"));
    return "original-result";
  };
  const inherited = { threshold: 2048 };
  const options = Object.create(inherited);
  const adapted = createCompatibleCompression(factory)(options);
  assert.equal(adapted.threshold, 2048);
  assert.equal(adapted.filter(request, response), "original-result");
  assert.equal(response.getHeader("Content-Type"), type);
  assert.equal(Object.hasOwn(options, "filter"), false);
});

test("leaves unrelated routes, methods, MIME types, multiple values and missing variants untouched", () => {
  const factory = options => options;
  let expected;
  factory.filter = (_request, response) => { assert.equal(response, expected); return false; };
  const filter = createCompatibleCompression(factory)().filter;
  for (const [request, response] of [
    [{ method: "GET", url: "/api/other" }, fakeResponse()],
    [{ method: "POST", url: "/api/sessions" }, fakeResponse()],
    [{ method: "GET", url: "/api/sessions/id/context" }, fakeResponse()],
    [{ method: "GET", url: "/api/sessions" }, fakeResponse(["text/event-stream"])],
    [{ method: "GET", url: "/api/sessions" }, fakeResponse(["text/html"])],
    [{ method: "GET", url: "/api/sessions" }, fakeResponse(["application/json", "text/plain"])],
    [{ method: "GET", url: "/api/sessions" }, fakeResponse("application/json")],
    [{ method: "GET", url: "/api/sessions" }, fakeResponse(undefined, "Origin")],
  ]) {
    expected = response;
    assert.equal(filter(request, response), false);
  }
});

test("preserves an explicitly supplied compressor filter and options", () => {
  const factory = options => options;
  factory.filter = () => { throw new Error("default filter must not run"); };
  const options = { filter: () => false, threshold: 4096 };
  assert.equal(createCompatibleCompression(factory)(options), options);
});

test("guards the exact installed source and installs idempotently", () => {
  const profile = verifyNextCompressionProfile();
  assert.equal(profile.version, "16.4.5");
  assert.equal(profile.sha256, "8e7c2ec6982978c754c00388e0d1d3ff46d7aae99945d060f6f1052954c24e29");
  assert.equal(installNextCompressionCompat(), installNextCompressionCompat());
});

test("refuses another Next version and changed bytes before evaluating the compressor", async t => {
  const root = await mkdtemp(join(tmpdir(), "next-compression-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = join(root, "package.json");
  await writeFile(manifest, JSON.stringify({ name: "next", version: "16.4.6" }));
  assert.throws(() => verifyNextCompressionProfile(root), /expected next@16\.4\.5.*Reassess\/remove/);
  await writeFile(manifest, JSON.stringify({ name: "next", version: "16.4.5" }));
  const directory = join(root, "dist", "compiled", "compression");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.js"), "throw new Error('must not execute changed source');\n");
  assert.throws(() => installNextCompressionCompat(root), /compressor source changed.*Reassess\/remove/);
});

test("refuses installation after a consumer could have captured the original factory", () => {
  const profile = verifyNextCompressionProfile();
  const helper = require.resolve("../bin/next-compression-compat.js");
  const result = spawnSync(process.execPath, ["-e", `
    require(${JSON.stringify(profile.entry)});
    try { require(${JSON.stringify(helper)}).installNextCompressionCompat(); process.exitCode = 1; }
    catch (error) { if (error.code !== 'ERR_BRABBLER_NEXT_COMPRESSION_COMPAT') throw error; process.stdout.write(error.message); }
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded before the managed preload/);
});

test("real Next HTTP transport retains gzip, decoded bytes, variants and refusal for catalogue and detail", async t => {
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

test("retains small, no-transform, auth/error, HTML, SSE, media and unrelated response behavior", async t => {
  const html = "<p>error page</p>".repeat(200);
  const events = "data: event\n\n".repeat(200);
  const media = Buffer.alloc(2048, 42);
  const bridge = await createNextHTTPBridge(t, request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/sessions/small") return jsonResponse(request, { ok: true });
    if (path === "/api/sessions/no-transform") return jsonResponse(request, large, { headers: { "Cache-Control": "no-store, no-transform" } });
    if (path === "/api/sessions/locked") return new Response("Authentication required", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (path === "/api/sessions/html") return new Response(html, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (path === "/api/sessions/events") return new Response(events, { headers: { "Content-Type": "text/event-stream", Vary: "Accept-Encoding" } });
    if (path === "/api/sessions/media") return new Response(media, { headers: { "Content-Type": "image/png", Vary: "Accept-Encoding" } });
    return jsonResponse(request, large);
  });
  for (const [path, status, type, expected] of [
    ["/api/sessions/small", 200, "application/json; charset=utf-8", Buffer.from('{"ok":true}')],
    ["/api/sessions/no-transform", 200, "application/json; charset=utf-8", Buffer.from(JSON.stringify(large))],
    ["/api/sessions/locked", 401, "text/plain; charset=utf-8", Buffer.from("Authentication required")],
    ["/api/sessions/html", 500, "text/html; charset=utf-8", Buffer.from(html)],
    ["/api/sessions/events", 200, "text/event-stream", Buffer.from(events)],
    ["/api/sessions/media", 200, "image/png", media],
    ["/api/other", 200, "application/json; charset=utf-8", Buffer.from(JSON.stringify(large))],
  ]) {
    const wire = await bridge.request(path, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(wire.status, status, path);
    assert.equal(wire.headers["content-type"], type, path);
    assert.equal(wire.headers["content-encoding"], undefined, path);
    assert.deepEqual(wire.body, expected, path);
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
