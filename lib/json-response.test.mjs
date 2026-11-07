import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node.js";
import { sendResponse } from "next/dist/server/send-response.js";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { jsonResponse } = await jiti.import("./json-response.ts");

test("does not gzip a large JSON response when the client disables gzip", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip;q=0, br" } }),
    { value: "large payload ".repeat(200) },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Accept-Encoding(?:\s*,|$)/i);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("does not gzip when the gzip quality value is invalid", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip;q=invalid, *;q=1" } }),
    { value: "large payload ".repeat(200) },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("leaves small JSON responses uncompressed", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }),
    { ok: true },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.deepEqual(await response.json(), { ok: true });
});

test("leaves accepted large JSON decoded for framework-owned compression", async () => {
  const data = { value: "large payload ".repeat(200) };
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }),
    data,
    { status: 202, headers },
  );
  const body = await response.text();

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Vary"), "Origin, Accept-Encoding");
  assert.equal(headers.get("Content-Type"), null, "caller-owned headers remain untouched");
  assert.deepEqual(JSON.parse(body), data);
});

test("large JSON survives the real Next HTTP response adapter", async (t) => {
  const data = { value: "large payload ".repeat(200) };
  const forwarding = [];
  const errors = [];
  const server = createServer((request, response) => {
    const result = jsonResponse(
      new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }),
      data,
      { status: 202, headers: { "Cache-Control": "no-store", Connection: "close" } },
    );
    const work = sendResponse(new NodeNextRequest(request), new NodeNextResponse(response), result);
    forwarding.push(work);
    void work.catch(error => { errors.push(error); response.destroy(error); });
  });
  server.on("error", error => errors.push(error));
  t.after(async () => {
    const closing = new Promise((resolve, reject) => server.close(error => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    }));
    server.closeAllConnections();
    const settled = await Promise.allSettled([closing, ...forwarding]);
    const failures = [...errors, ...settled.filter(result => result.status === "rejected").map(result => result.reason)];
    if (failures.length) throw new AggregateError([...new Set(failures)], "HTTP response bridge did not settle cleanly");
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
    headers: { "Accept-Encoding": "gzip", Connection: "close" },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(body, data);
});
