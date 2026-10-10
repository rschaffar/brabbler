import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { closeTerminalDisconnect, terminalDisconnectFixture } from "../e2e/terminal-disconnect-fixture.mjs";

test("terminal-only EOF forwards actual SSE/query/cursor, gates retry and settles owned listener", async (t) => {
  let observed;
  const upstream = createServer((req, res) => {
    observed = { url: req.url, cursor: req.headers["last-event-id"] };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("id: 8\ndata: actual-shell-output\n\n");
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const fixture = await terminalDisconnectFixture(base, "owned");
  t.after(async () => { try { await fixture.close(); } finally { upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve)); } });
  assert.equal(fixture.matches(new URL(`${base}/api/agent/running`)), false);
  assert.equal(fixture.matches(new URL("http://127.0.0.1:1/api/terminal/owned/events")), false);
  assert.equal(fixture.matches(new URL(`${base}/api/terminal/owned/events?after=7`)), true);
  let redirected;
  await fixture.route({ request: () => ({ method: () => "GET", url: () => `${base}/api/terminal/owned/events?after=7` }), continue: (options) => { redirected = options.url; } });
  const response = await fetch(redirected, { headers: { "last-event-id": "7" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("access-control-allow-origin"), base);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "id: 8\ndata: actual-shell-output\n\n");
  assert.deepEqual(observed, { url: "/api/terminal/owned/events?after=7", cursor: "7" });
  fixture.endStream(); assert.equal((await reader.read()).done, true);
  let continued = false;
  const retry = fixture.route({ request: () => ({ method: () => "GET" }), continue: (options) => { assert.equal(options, undefined); continued = true; } });
  await Promise.resolve(); assert.equal(continued, false);
  fixture.releaseReconnect(); await retry; assert.equal(continued, true);
});

test("failed browser unroute still settles the owned listener and retains failure", async () => {
  const fixture = await terminalDisconnectFixture("http://127.0.0.1:1", "owned");
  const close = fixture.close;
  let settled = false;
  fixture.close = async () => { await close(); settled = true; };
  try {
    await assert.rejects(closeTerminalDisconnect({ unroute: async () => { throw new Error("browser disconnected"); } }, fixture), /browser disconnected/);
    assert.equal(settled, true);
  } finally { await fixture.close(); }
});

test("unexpected upstream failures remain failures, not expected disconnects", async () => {
  const upstream = createServer((_req, res) => res.writeHead(503).end("fixture refusal"));
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const base = `http://127.0.0.1:${upstream.address().port}`, fixture = await terminalDisconnectFixture(base, "owned");
  let redirected;
  await fixture.route({ request: () => ({ method: () => "GET", url: () => `${base}/api/terminal/owned/events` }), continue: (options) => { redirected = options.url; } });
  try {
    const response = await fetch(redirected); await response.text(); assert.equal(response.status, 503);
    assert.throws(() => fixture.endStream(), /503/);
    await assert.rejects(fixture.close(), /503/);
  } finally {
    try { await fixture.close(); } catch (error) { assert.match(error.message, /503/); }
    upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve));
  }
});
