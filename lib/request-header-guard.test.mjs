import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { requestGuardPath } = require("../bin/brabbler-node-args.js");
const { hasForbiddenHeaders, installRequestHeaderGuard } = require(requestGuardPath);

async function serverFixture(t) {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++;
    response.writeHead(request.headers.authorization === "Bearer synthetic" ? 200 : 401);
    response.end("Synthetic protected processor");
  });
  server.on("upgrade", () => { calls++; });
  server.on("connect", () => { calls++; });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { server, port: server.address().port, calls: () => calls };
}

function request(port, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/sessions", agent: false, headers }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    req.setTimeout(1000, () => req.destroy(new Error("Guard fixture timed out")));
    req.on("error", reject);
    req.end();
  });
}

test("header presence, not its secret value, controls rejection", () => {
  for (const name of ["x-prerender-revalidate", "X-Prerender-Revalidate", "x-prerender-revalidate-if-generated"]) {
    for (const value of ["", "synthetic", undefined]) assert.equal(hasForbiddenHeaders({ headers: { [name]: value } }), true);
  }
  assert.equal(hasForbiddenHeaders({ headers: {}, rawHeaders: ["X-Prerender-Revalidate", "", "x-prerender-revalidate", "synthetic"] }), true);
  assert.equal(hasForbiddenHeaders({ headers: { "x-other": "x-prerender-revalidate" } }), false);
});

test("real HTTP denies bypass headers before the protected processor, even with valid auth", async (t) => {
  const f = await serverFixture(t);
  assert.equal((await request(f.port)).status, 401);
  assert.equal((await request(f.port, { authorization: "Bearer synthetic" })).status, 200);
  assert.equal(f.calls(), 2);
  for (const headers of [
    { "x-prerender-revalidate": "synthetic" }, { "X-Prerender-Revalidate": "" },
    { "x-prerender-revalidate-if-generated": "" },
    { authorization: "Bearer synthetic", "x-prerender-revalidate": "synthetic" },
    ["Host", "localhost", "x-prerender-revalidate", "", "X-Prerender-Revalidate", "synthetic"],
    { expect: "100-continue", "x-prerender-revalidate": "synthetic" },
  ]) {
    const response = await request(f.port, headers);
    assert.equal(response.status, 400);
    assert.equal(response.headers["cache-control"], "no-store", JSON.stringify(headers));
    assert.equal(response.headers.connection, "close");
    assert.equal(f.calls(), 2, "blocked traffic must never reach any downstream handler");
  }
  // Without an expectation listener, Node rejects unsupported expectations
  // itself before dispatch (and may send 100 Continue before request dispatch).
  assert.equal((await request(f.port, { expect: "synthetic-expectation", "x-prerender-revalidate": "synthetic" })).status, 417);
  assert.equal(f.calls(), 2);
});

test("upgrades and CONNECT reject before dispatch and flush a complete denial", async (t) => {
  const f = await serverFixture(t);
  for (const opening of ["GET /api/sessions HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket", "CONNECT localhost:80 HTTP/1.1"]) {
    let socket, timer;
    const closed = new Promise((resolve) => f.server.once("connection", (connection) => connection.once("close", resolve)));
    try {
    const response = await new Promise((resolve, reject) => {
      socket = net.createConnection({ host: "127.0.0.1", port: f.port, allowHalfOpen: true });
      let text = "";
      socket.setTimeout(1000, () => socket.destroy(new Error("Upgrade fixture timed out")));
      socket.on("error", reject);
      socket.on("data", (chunk) => { text += chunk; });
      socket.once("end", () => resolve(text));
      socket.once("connect", () => socket.write(`${opening}\r\nHost: localhost\r\nx-prerender-revalidate: synthetic\r\n\r\n`));
    });
    assert.match(response, /^HTTP\/1\.1 400 Bad Request\r\n/);
    assert.match(response, /Cache-Control: no-store/);
    assert.ok(response.endsWith("\r\n\r\n"));
    assert.equal(f.calls(), 0);
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("denied upgraded server socket stayed open")), 1000); })]);
    } finally { clearTimeout(timer); socket?.destroy(); }
  }
});

test("HTTP/HTTPS installation is idempotent and unrelated event semantics are unchanged", () => {
  const before = http.Server.prototype.emit;
  installRequestHeaderGuard();
  assert.equal(http.Server.prototype.emit, before);
  for (const Server of [http.Server, https.Server]) {
    const server = new Server();
    let called = false;
    const payload = {};
    server.on("fixture", function (value) { assert.equal(this, server); assert.equal(value, payload); called = true; });
    assert.equal(server.emit("fixture", payload), true);
    assert.equal(called, true);
    assert.equal(server.emit("unhandled"), false);
    assert.throws(() => server.emit("error", new Error("normal error")), /normal error/);
    for (const event of ["request", "checkContinue", "checkExpectation"]) {
      let status;
      server.on(event, () => assert.fail("forbidden request reached handler"));
      assert.equal(server.emit(event, { headers: { "x-prerender-revalidate": "" } }, { writeHead(code) { status = code; }, end() {} }), true);
      assert.equal(status, 400);
    }
  }
});

test("supported npm commands install the guard before Next and propagate an absolute preload", () => {
  const source = readFileSync(new URL("../bin/next-cli.js", import.meta.url), "utf8");
  const order = [];
  const process = { execArgv: [], argv: ["node", "next-cli.js", "dev", "-p", "30141", "-H", "127.0.0.1"], env: {}, cwd: () => "/synthetic" };
  const mockRequire = (name) => {
    if (name === "./brabbler-node-args") return { requestGuardPath };
    if (name === requestGuardPath) { order.push("guard"); return {}; }
    assert.equal(name, "./ssh-agent-launch");
    return { launchManagedNext(options) {
      assert.deepEqual(order, ["guard"]);
      assert.deepEqual(process.execArgv, ["--require", requestGuardPath]);
      assert.equal(options.nextBin, "/synthetic/next");
      assert.equal(options.hostname, "127.0.0.1"); assert.equal(options.port, "30141");
      assert.equal(options.args[0], "dev"); order.push("next"); return Promise.resolve();
    } };
  };
  mockRequire.resolve = name => { assert.equal(name, "next/dist/bin/next"); return "/synthetic/next"; };
  new Script(source).runInNewContext({ process, require: mockRequire });
  assert.deepEqual(order, ["guard", "next"]);
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["dev", "dev:lan", "start", "start:lan"]) assert.match(scripts[name], /^node bin\/next-cli\.js (dev|start) /);
});

test("pinned Next dev option reconstruction preserves the guard across replacement workers", () => {
  const { getParsedNodeOptions, formatNodeOptions } = require("next/dist/server/lib/utils.js");
  const original = process.execArgv;
  try {
    process.execArgv = ["--require", requestGuardPath];
    const { nodeOptions } = formatNodeOptions(getParsedNodeOptions());
    assert.ok(nodeOptions.includes(requestGuardPath));
    for (let generation = 0; generation < 2; generation++) {
      const child = spawnSync(process.execPath, ["-e", `
        const http = require('node:http');
        const server = new http.Server();
        server.on('request', () => { throw new Error('guard missing'); });
        server.emit('request', {headers: {'x-prerender-revalidate': 'synthetic'}}, {writeHead(code) { process.stdout.write(String(code)); }, end() {}});
      `], { env: { ...process.env, NODE_OPTIONS: nodeOptions }, encoding: "utf8", timeout: 5000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, "400");
    }
  } finally { process.execArgv = original; }
});
