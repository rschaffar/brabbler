import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import http from "node:http";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, renameSync, readdirSync, rmSync, existsSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createSshAgentRouter, frame, probe, MAX_FRAME } from "../bin/ssh-agent-router.js";
import { sshRuntimeRequest } from "../bin/ssh-agent-client.js";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "router-test-"));
  const environment = { PI_CODING_AGENT_DIR: join(root, "agent"), HOME: root, PATH: "/nonexistent" };
  const router = await createSshAgentRouter({ environment, tempDir: root, instance: "test:30141" });
  const sockets = new Set(), servers = [];
  t.after(async () => { await router.close(); for (const socket of sockets) socket.destroy(); for (const server of servers) await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const client = async (path = router.socketPath) => {
    const socket = net.connect(path); sockets.add(socket); socket.on("error", () => {}); await once(socket, "connect");
    return { socket, send(data) { return new Promise((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      const closed = () => done(new Error("closed"));
      const receive = chunk => { bytes = Buffer.concat([bytes, chunk]); if (bytes.length >= 4 && bytes.length >= bytes.readUInt32BE() + 4) done(null, bytes.subarray(4)); };
      const done = (error, result) => { socket.removeListener("close", closed); socket.removeListener("data", receive); if (error) reject(error); else resolve(result); };
      socket.once("close", closed); socket.on("data", receive); socket.write(frame(data));
    }); } };
  };
  const fake = async (name, handler) => {
    const location = join(root, name);
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on("error", () => {}); let bytes = Buffer.alloc(0);
      socket.on("data", chunk => { bytes = Buffer.concat([bytes, chunk]); while (bytes.length >= 4 && bytes.length >= bytes.readUInt32BE() + 4) {
        const size = bytes.readUInt32BE(); const request = bytes.subarray(4, size + 4); bytes = bytes.subarray(size + 4);
        Promise.resolve(handler(request, socket)).then(result => { if (result && !socket.destroyed) socket.write(frame(result)); });
      } });
    });
    servers.push(server); await new Promise(resolve => server.listen(location, resolve)); return location;
  };
  const use = selected => router.rpc({ action: "use", backend: selected, revision: router.status().revision });
  return { root, environment, router, client, fake, use };
}
const identities = key => Buffer.concat([Buffer.from([12, 0, 0, 0, 1]), frame(Buffer.from(key)), frame(Buffer.from("test"))]);

test("stable front starts with no identity and private control is not the public protocol", async t => {
  const { router, client, environment } = await fixture(t);
  assert.equal(router.status().setupNeeded, true);
  assert.equal(statSync(router.socketPath).mode & 0o777, 0o600);
  assert.equal(statSync(router.root).mode & 0o777, 0o700);
  const c = await client(); assert.deepEqual(await c.send(Buffer.from([11])), Buffer.from([12, 0, 0, 0, 0]));
  assert.deepEqual(await c.send(Buffer.from([13])), Buffer.from([5]));
  const rpc = await sshRuntimeRequest({ action: "status" }, { ...environment, PI_DESK_SSH_RUNTIME: router.root });
  assert.equal(rpc.socketPath, router.socketPath); assert.equal(rpc.token, undefined); assert.equal(environment.SSH_AUTH_SOCK, undefined);
});

test("switch retires old connections, preserves the pathname and forwards constraints unchanged", async t => {
  const { router, client, fake, use } = await fixture(t);
  const requests = [];
  const a = await fake("a", request => { requests.push(Buffer.from(request)); return request[0] === 27 ? Buffer.from([28]) : identities("A"); });
  const b = await fake("b", request => request[0] === 27 ? Buffer.from([28]) : identities("B"));
  const stable = router.socketPath;
  await use({ type: "socket", path: a, label: "A" });
  const first = await client(); assert.deepEqual(await first.send(Buffer.from([11])), identities("A"));
  const extension = Buffer.concat([Buffer.from([27]), frame(Buffer.from("session-bind@openssh.com")), Buffer.from([1, 2, 3])]);
  assert.deepEqual(await first.send(extension), Buffer.from([28])); assert.ok(requests.some(value => value.equals(extension)));
  const closed = once(first.socket, "close"); await use({ type: "socket", path: b, label: "B" }); await closed;
  const second = await client(); assert.deepEqual(await second.send(Buffer.from([11])), identities("B"));
  assert.equal(router.socketPath, stable);
  await use({ type: "none" }); const third = await client(); assert.deepEqual(await third.send(Buffer.from([11])), Buffer.from([12, 0, 0, 0, 0]));
});

test("already admitted signature drains to its original backend without replay or rerouting", async t => {
  const { router, client, fake, use } = await fixture(t);
  let release, started; const admitted = new Promise(resolve => { started = resolve; });
  const a = await fake("a", request => request[0] === 27 ? Buffer.from([28]) : request[0] === 11 ? identities("A") : new Promise(resolve => { release = resolve; started(); }));
  let bRequests = 0; const b = await fake("b", request => { if (request[0] === 13) bRequests++; return request[0] === 27 ? Buffer.from([28]) : request[0] === 11 ? identities("B") : Buffer.from([14, 9]); });
  await use({ type: "socket", path: a, label: "A" }); const c = await client();
  const response = c.send(Buffer.from([13, 1])); await admitted;
  await use({ type: "socket", path: b, label: "B" }); release(Buffer.from([14, 7]));
  assert.deepEqual(await response, Buffer.from([14, 7])); assert.equal(bRequests, 0);
  const next = await client(); assert.deepEqual(await next.send(Buffer.from([13, 2])), Buffer.from([14, 9]));
  assert.equal(router.status().selected.label, "B");
});

test("switching preserves full admitted replies while a native reader is paused", { timeout: 5000 }, async t => {
  const { client, fake, use } = await fixture(t);
  let count = 0, started; const firstRequest = new Promise(resolve => { started = resolve; });
  const large = Buffer.alloc(MAX_FRAME, 7); large[0] = 14;
  const a = await fake("a", request => {
    if (request[0] === 27) return Buffer.from([28]); if (request[0] === 11) return identities("A");
    count++; if (count === 1) started(); return large;
  });
  let bSigns = 0;
  const b = await fake("b", request => { if (request[0] === 27) return Buffer.from([28]); if (request[0] === 13) bSigns++; return identities("B"); });
  await use({ type: "socket", path: a, label: "A" }); const c = await client(); c.socket.pause();
  c.socket.write(Buffer.concat(Array.from({ length: 64 }, () => frame(Buffer.from([13, 1])))));
  await firstRequest; await use({ type: "socket", path: b, label: "B" }); const admitted = count;
  assert.ok(admitted < 64, "paused reader must backpressure admission before all queued requests dispatch");
  const chunks = []; c.socket.on("data", chunk => chunks.push(chunk)); const closed = once(c.socket, "close"); c.socket.resume(); await closed;
  const bytes = Buffer.concat(chunks); assert.equal(bytes.length, admitted * (MAX_FRAME + 4));
  for (let offset = 0; offset < bytes.length; offset += MAX_FRAME + 4) { assert.equal(bytes.readUInt32BE(offset), MAX_FRAME); assert.deepEqual(bytes.subarray(offset + 4, offset + MAX_FRAME + 4), large); }
  assert.equal(count, admitted); assert.equal(bSigns, 0);
});

test("selected unavailable backend remains selected, and remembered browser does not regain authority", async t => {
  const { root, router, client, use, environment } = await fixture(t);
  await use({ type: "browser" }); const c = await client(); assert.deepEqual(await c.send(Buffer.from([11])), Buffer.from([5]));
  assert.deepEqual(router.status().selected, { type: "browser" }); await router.close();
  const restarted = await createSshAgentRouter({ environment, tempDir: root, instance: "test:30141" });
  t.after(() => restarted.close()); assert.equal(restarted.status().setupNeeded, false); assert.equal(restarted.status().selected.type, "browser"); assert.equal(restarted.status().browserSocket, null);
  assert.notEqual(restarted.socketPath, router.socketPath); await restarted.close();
});

test("self, symlink and other managed router targets are refused without changing backend", async t => {
  const { root, router, use, environment } = await fixture(t);
  await assert.rejects(use({ type: "socket", path: router.socketPath, label: "self" }), /managed runtime/);
  const alias = join(root, "alias"); symlinkSync(router.socketPath, alias);
  await assert.rejects(use({ type: "socket", path: alias, label: "alias" }), /managed runtime/);
  const other = await createSshAgentRouter({ environment, tempDir: root, instance: "other:30142" }); t.after(() => other.close());
  assert.equal((await probe(other.socketPath, router.root)).available, false);
  assert.equal(router.status().selected.type, "none");
  unlinkSync(alias); await other.close();
});

test("discovery is explicit, probes identities only and preserves named paths", async t => {
  const { root, router, fake } = await fixture(t); const requests = [];
  const socket = await fake("custom", request => { requests.push(request[0]); return request[0] === 27 ? Buffer.from([28]) : identities("fingerprint"); });
  await router.rpc({ action: "custom", path: socket, label: "Custom", revision: router.status().revision });
  const found = await router.rpc({ action: "discover" }); assert.equal(found.length, 1); assert.equal(found[0].available, true); assert.match(found[0].fingerprints[0], /^SHA256:/);
  assert.deepEqual(requests, [27, 11]); assert.equal(router.status().setupNeeded, true);
  assert.equal(existsSync(join(root, "unrelated")), false);
  await assert.rejects(router.rpc({ action: "custom", path: socket, label: "Bad\nlabel", revision: router.status().revision }));
});

test("settings admission serializes revisions, owned cleanup removes only the runtime", async t => {
  const { root, router } = await fixture(t);
  await router.rpc({ action: "use", backend: { type: "none" }, revision: router.status().revision });
  await assert.rejects(router.rpc({ action: "use", backend: { type: "browser" }, revision: "stale" }), /changed/);
  await router.close(); await delay(10); assert.equal(existsSync(router.root), false); assert.equal(existsSync(join(root, "agent", "ssh-routing")), true);
  await assert.rejects(router.rpc({ action: "status" }), /shutting down/);
});

test("namespace has one live owner; distinct runtimes cannot overwrite each other", async t => {
  const { root, router, environment, use } = await fixture(t);
  await assert.rejects(createSshAgentRouter({ environment, tempDir: root, instance: "test:30141" }), /already being held/);
  const other = await createSshAgentRouter({ environment, tempDir: root, instance: "test:30142" });
  await use({ type: "browser" }).then(() => {
    assert.equal(other.status().selected.type, "none"); assert.notEqual(other.socketPath, router.socketPath);
  }).finally(() => other.close());
});

test("exported control boundary serializes concurrent same-revision saves", async t => {
  const { router, fake } = await fixture(t); let release, started;
  const gated = new Promise(resolve => { release = resolve; }); const admitted = new Promise(resolve => { started = resolve; });
  const location = await fake("gated", async request => { if (request[0] === 27) { started(); await gated; return Buffer.from([28]); } return identities("A"); });
  const revision = router.status().revision;
  const first = router.rpc({ action: "use", revision, backend: { type: "socket", path: location, label: "A" } });
  await admitted;
  const second = router.rpc({ action: "use", revision, backend: { type: "none" } });
  const refused = assert.rejects(second, /changed/); release(); await first; await refused;
  assert.equal(router.status().selected.label, "A");
});

test("publisher replacement cancels old browser exchanges but still drains unrelated native work", async t => {
  const { router, client, fake, use } = await fixture(t); let releaseBrowser, releaseNative, browserStarted, nativeStarted;
  const browserPending = new Promise(resolve => { browserStarted = resolve; }), nativePending = new Promise(resolve => { nativeStarted = resolve; });
  const browser = await fake("browser", request => request[0] === 27 ? Buffer.from([28]) : request[0] === 11 ? identities("browser") : new Promise(resolve => { releaseBrowser = resolve; browserStarted(); }));
  const native = await fake("native", request => request[0] === 27 ? Buffer.from([28]) : request[0] === 11 ? identities("native") : new Promise(resolve => { releaseNative = resolve; nativeStarted(); }));
  const claim = await router.rpc({ action: "claim-browser" }); await router.rpc({ action: "publish-browser", publisher: claim.publisher, path: browser });
  await use({ type: "browser" }); const old = await client(); const oldReply = old.send(Buffer.from([13, 1])); await browserPending;
  await use({ type: "socket", path: native, label: "Native" }); const current = await client(); const nativeReply = current.send(Buffer.from([13, 2])); await nativePending;
  await router.rpc({ action: "claim-browser" });
  assert.deepEqual(await oldReply, Buffer.from([5])); releaseBrowser(Buffer.from([14, 7]));
  releaseNative(Buffer.from([14, 9])); assert.deepEqual(await nativeReply, Buffer.from([14, 9]));
});

test("publisher epochs reject delayed publication and compare-and-clear from an old worker", async t => {
  const { router, fake } = await fixture(t);
  const a = await router.rpc({ action: "claim-browser" }), b = await router.rpc({ action: "claim-browser" });
  const location = await fake("browser", () => Buffer.from([5]));
  await router.rpc({ action: "publish-browser", publisher: b.publisher, path: location });
  for (const path of [null, location]) await assert.rejects(router.rpc({ action: "publish-browser", publisher: a.publisher, path }), /Stale/);
  assert.equal(router.status().browserSocket, location);
});

test("shutdown aborts outstanding discovery and does not admit more probes", async t => {
  const { router, fake } = await fixture(t); let started;
  const admitted = new Promise(resolve => { started = resolve; }); let count = 0;
  const location = await fake("hung", () => { count++; started(); return new Promise(() => {}); });
  await router.rpc({ action: "custom", path: location, label: "Hung", revision: router.status().revision });
  const finding = router.rpc({ action: "discover" }); const cancelled = assert.rejects(finding, /cancelled/);
  await admitted; await router.close(); await cancelled; await delay(0); assert.equal(count, 1);
});

test("dynamic aliases resolve on each new upstream connection and unavailable never falls back", async t => {
  const { root, router, client, fake, use } = await fixture(t);
  const a = await fake("a", request => request[0] === 27 ? Buffer.from([28]) : identities("A"));
  const b = await fake("b", request => request[0] === 27 ? Buffer.from([28]) : identities("B"));
  const alias = join(root, "selector"); symlinkSync(a, alias); await use({ type: "socket", path: alias, label: "System selector" });
  const first = await client(); assert.deepEqual(await first.send(Buffer.from([11])), identities("A")); first.socket.destroy();
  unlinkSync(alias); symlinkSync(b, alias);
  const next = await client(); assert.deepEqual(await next.send(Buffer.from([11])), identities("B")); next.socket.destroy();
  unlinkSync(alias);
  const missing = await client(); assert.deepEqual(await missing.send(Buffer.from([11])), Buffer.from([5]));
  assert.equal(router.status().selected.path, alias); assert.equal(router.status().endpointPresent, false);
});

test("probes reject surplus framing and use OpenSSH base64 fingerprints with bounded display", async t => {
  const { router, fake } = await fixture(t);
  const bad = await fake("surplus", (request, socket) => { if (request[0] === 27) return Buffer.from([28]); socket.write(Buffer.concat([frame(Buffer.from([12, 0, 0, 0, 0])), frame(Buffer.from([5]))])); return null; });
  assert.match((await probe(bad, router.root)).error, /Surplus/);
  const key = Buffer.from("fingerprint"); const count = Buffer.alloc(4); count.writeUInt32BE(64);
  const many = await fake("many", request => request[0] === 27 ? Buffer.from([28]) : Buffer.concat([Buffer.from([12]), count, ...Array.from({ length: 64 }, () => Buffer.concat([frame(key), frame(Buffer.alloc(0))]))]));
  const found = await probe(many, router.root); assert.equal(found.identityCount, 64); assert.equal(found.fingerprints.length, 16);
  assert.equal(found.fingerprints[0], "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, ""));
});

test("delayed unsolicited responses invalidate the upstream rather than being discarded", async t => {
  const { client, fake, use } = await fixture(t); let signs = 0, upstream;
  const location = await fake("unsolicited", (request, socket) => {
    if (request[0] === 27) return Buffer.from([28]);
    if (request[0] === 11) { upstream = socket; return identities("A"); }
    signs++; return Buffer.from([14, 1]);
  });
  await use({ type: "socket", path: location, label: "A" });
  const c = await client(); assert.deepEqual(await c.send(Buffer.from([11])), identities("A"));
  const closed = once(upstream, "close"); upstream.write(frame(Buffer.from([5]))); await closed;
  assert.deepEqual(await c.send(Buffer.from([13, 1])), Buffer.from([5])); assert.equal(signs, 0);
});

test("ownership loss fences close before the heartbeat and cannot remove a replacement lease", async t => {
  const { root, router } = await fixture(t);
  const settings = join(root, "agent", "ssh-routing"); const lock = join(settings, readdirSync(settings).find(name => name.endsWith(".lock")));
  renameSync(lock, lock + ".retired"); mkdirSync(lock, { mode: 0o700 });
  await router.close(); assert.equal(existsSync(lock), true); assert.equal(existsSync(lock + ".retired"), true);
});

test("lease exit cleanup cannot delete a replacement owner's lease", async t => {
  const { root, environment } = await fixture(t);
  const routerModule = new URL("../bin/ssh-agent-router.js", import.meta.url).pathname;
  const lock = join(environment.PI_CODING_AGENT_DIR, "ssh-routing", createHash("sha256").update("exit:30142").digest("hex").slice(0, 16) + ".json.lock");
  const child = spawn(process.execPath, ["-e", `
    const fs = require('node:fs');
    require(${JSON.stringify(routerModule)}).createSshAgentRouter({environment:process.env,tempDir:${JSON.stringify(root)},instance:'exit:30142'}).then(() => {
      fs.renameSync(${JSON.stringify(lock)}, ${JSON.stringify(lock + ".retired")}); fs.mkdirSync(${JSON.stringify(lock)});
      process.stdout.write('ready', () => process.exit(0));
    }).catch(error => { console.error(error); process.exit(1); });
  `], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { errors += chunk; });
  const [code] = await once(child, "close"); assert.equal(code, 0, errors); assert.equal(output, "ready"); assert.equal(existsSync(lock), true);
});

test("post-listen chmod failure rejects through owned partial-start cleanup", async t => {
  const { root, environment } = await fixture(t); const before = readdirSync(root).sort();
  const original = fs.chmodSync;
  try {
    fs.chmodSync = (file, mode) => { if (file.endsWith("/control")) throw Object.assign(new Error("synthetic chmod refused"), { code: "EPERM" }); return original(file, mode); };
    await assert.rejects(createSshAgentRouter({ environment, tempDir: root, instance: "partial:30142" }), /synthetic chmod refused/);
  } finally { fs.chmodSync = original; }
  assert.deepEqual(readdirSync(root).sort(), before);
  const retry = await createSshAgentRouter({ environment, tempDir: root, instance: "partial:30142" }); await retry.close();
});

test("post-rename durability failure reports uncertain acknowledgement and exposes the actual effective choice", async t => {
  const { router, use: applyAgent } = await fixture(t); const original = fs.fsyncSync; const revision = router.status().revision;
  try {
    fs.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error("synthetic directory fsync refused"), { code: "EIO" }); return original(fd); };
    await assert.rejects(applyAgent({ type: "browser" }), /acknowledgement uncertain/);
  } finally { fs.fsyncSync = original; }
  assert.equal(router.status().selected.type, "browser"); assert.notEqual(router.status().revision, revision); assert.match(router.status().settingsError, /uncertain/);
  await applyAgent({ type: "none" }); assert.equal(router.status().selected.type, "none"); assert.equal(router.status().settingsError, null);
});

test("unsafe persisted settings fail closed and explicit selection recovers without fallback", async t => {
  const { root, router, environment, use } = await fixture(t);
  await use({ type: "browser" }); await router.close();
  const settings = join(environment.PI_CODING_AGENT_DIR, "ssh-routing"); const file = join(settings, readdirSync(settings).find(name => name.endsWith(".json")));
  fs.chmodSync(file, 0o666);
  const restarted = await createSshAgentRouter({ environment, tempDir: root, instance: "test:30141" });
  try {
    assert.equal(restarted.status().selected.type, "none"); assert.equal(restarted.status().setupNeeded, true); assert.ok(restarted.status().settingsError);
    await restarted.rpc({ action: "use", backend: { type: "none" }, revision: restarted.status().revision });
    assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(restarted.status().settingsError, null);
  } finally { await restarted.close(); }
});

test("private control rejects malformed authentication without throwing or exposing authority", async t => {
  const { router } = await fixture(t);
  for (const authorization of ["wrong", "é".repeat(64)]) {
    const code = await new Promise((resolve, reject) => {
      const request = http.request({ socketPath: join(router.root, "control"), method: "POST", headers: { authorization } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
      request.on("error", reject); request.end('{}');
    });
    assert.equal(code, 403);
  }
  assert.equal((await router.rpc({ action: "status" })).setupNeeded, true);
});
