import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, statSync, existsSync, rmSync, chmodSync, symlinkSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once, EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { fixture, protocol } from "./browser-ssh.fixture.mjs";
const { BrowserSshAgent, waitForAgentDrain } = await createJiti(import.meta.url).import("./browser-ssh-agent.ts");
const { sshString, SshReader, verifyBrowserAssertion, describeSshPayload, MAX_SSH_FRAME } = protocol;
const { createProjectCommandBashOperations, createProjectCommandBashExtension } = await createJiti(import.meta.url).import("./project-command-env.ts");

function realVerify(f, signature) {
  const root = mkdtempSync(join(tmpdir(), "ssh-verify-"));
  try {
    const version = Buffer.from([0, 0, 0, 1]);
    const envelope = Buffer.concat([Buffer.from("SSHSIG"), version, sshString(f.identity.blob), sshString("git"), sshString(""), sshString("sha512"), sshString(signature)]);
    writeFileSync(join(root, "signature"), `-----BEGIN SSH SIGNATURE-----\n${envelope.toString("base64").match(/.{1,70}/g).join("\n")}\n-----END SSH SIGNATURE-----\n`);
    writeFileSync(join(root, "allowed"), `fixture ${f.identity.publicKey}\n`);
    return execFileSync("ssh-keygen", ["-Y", "verify", "-I", "fixture", "-f", join(root, "allowed"), "-n", "git", "-s", join(root, "signature")], { input: f.message, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("raw SSH payload produces a WebAuthn SSHSIG accepted by real OpenSSH", () => {
  const f = fixture();
  const assertion = f.assertion(f.payload, { client: { other_keys_can_be_added_here: "modern Chromium" } });
  const signature = verifyBrowserAssertion(f.identity, f.payload, assertion);
  assert.match(realVerify(f, signature), /Good "git" signature/);
  assert.equal(describeSshPayload(f.payload, f.identity), "SSHSIG namespace: git");
});

test("rejects ceremony confusion, missing verification, extensions and signature tampering", () => {
  const f = fixture();
  const invalid = [
    { client: { origin: "https://other.example.test" } }, { client: { challenge: "wrong" } },
    { client: { type: "webauthn.create" } }, { client: { crossOrigin: true } }, { client: { topOrigin: f.identity.origin } },
    { rpId: "other.example.test" }, { flags: 1 }, { flags: 4 }, { flags: 0x45 }, { flags: 0x85 },
    { flags: 0x25 }, { flags: 0x15 }, { flags: 5, extensions: Buffer.from([0xa0]) },
    { clientData: JSON.stringify({ origin: f.identity.origin, type: "webauthn.get", challenge: f.payload.toString("base64url") }) },
  ];
  for (const options of invalid) assert.throws(() => verifyBrowserAssertion(f.identity, f.payload, f.assertion(f.payload, options)), undefined, JSON.stringify(options));
  const assertion = f.assertion(f.payload);
  assert.throws(() => verifyBrowserAssertion(f.identity, f.payload, { ...assertion, id: "other" }));
  assert.throws(() => verifyBrowserAssertion(f.identity, f.payload, { ...assertion, signature: Buffer.alloc(64).toString("base64url") }));
  assert.throws(() => verifyBrowserAssertion(f.identity, f.payload, { ...assertion, clientData: assertion.clientData + "=" }));
  assert.throws(() => verifyBrowserAssertion(f.identity, Buffer.from("different"), assertion));
  for (const origin of ["http://remote.example", "https://127.0.0.1", "https://example.test/", "https://user@example.test", "https://example.test."]) assert.throws(() => protocol.sshIdentity(f.credential, origin));
  assert.equal(protocol.sshIdentity(f.credential, "http://localhost:30141").rpId, "localhost");
});

test("web-safe filter accepts matched SSH userauth but refuses opaque or malformed challenges", () => {
  const f = fixture();
  const auth = Buffer.concat([sshString(Buffer.alloc(32, 1)), Buffer.from([50]), sshString("fixture"), sshString("ssh-connection"), sshString("publickey"), Buffer.from([1]), sshString(protocol.SSH_SK_TYPE), sshString(f.identity.blob)]);
  assert.match(describeSshPayload(auth, f.identity), /SSH authentication user: fixture/);
  for (const data of [Buffer.alloc(0), Buffer.from("arbitrary web challenge"), Buffer.concat([auth, Buffer.from([0])]), auth.subarray(0, -1), Buffer.concat([f.payload, Buffer.from([0])])]) assert.throws(() => describeSshPayload(data, f.identity));
  const other = fixture(); assert.throws(() => describeSshPayload(auth, other.identity));
  for (const [payload, token] of [[auth, "ssh-connection"], [auth, "publickey"], [auth, protocol.SSH_SK_TYPE], [f.payload, "sha512"]]) {
    const changed = Buffer.from(payload); changed[changed.indexOf(token)] |= 0x80;
    assert.throws(() => describeSshPayload(changed, f.identity), undefined, `High-bit ${token}`);
  }
  assert.throws(() => describeSshPayload(Buffer.alloc(2049), f.identity), /too large/);
});

function client(path) {
  const socket = connect(path);
  let buffer = Buffer.alloc(0);
  const waiting = [];
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE() + 4) {
      const size = buffer.readUInt32BE(); const value = buffer.subarray(4, size + 4); buffer = buffer.subarray(size + 4);
      waiting.shift()?.(value);
    }
  });
  socket.on("error", () => {});
  return { socket, send(frame, split = false) {
    const result = new Promise(resolve => waiting.push(resolve));
    const bytes = sshString(frame);
    if (split) { socket.write(bytes.subarray(0, 2)); socket.write(bytes.subarray(2)); } else socket.write(bytes);
    return result;
  } };
}
const signFrame = (f, flags = 0) => { const flag = Buffer.alloc(4); flag.writeUInt32BE(flags); return Buffer.concat([Buffer.from([13]), sshString(f.identity.blob), sshString(f.payload), flag]); };
async function pending(agent, created, owner, origin) {
  for (let i = 0; i < 100; i++) {
    const request = agent.poll(created.token, owner, origin).requests[0];
    if (request) return request;
    await delay(5);
  }
  throw new Error("No signing request");
}

async function agentFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "ssh-agent-test-"));
  const agent = new BrowserSshAgent({ markerRoot: join(root, "markers"), ...options });
  t.after(() => { agent.dispose(); rmSync(root, { recursive: true, force: true }); });
  const f = fixture(); const owner = "browser-one", origin = f.identity.origin;
  const created = agent.create(owner, f.credential, origin);
  const active = await agent.activate(created.token, owner, origin, f.assertion(Buffer.from(created.challenge, "base64url")));
  return { f, agent, owner, origin, created, active, root };
}

test("native agent lists, signs, denies, isolates owners and refuses unsupported operations", async t => {
  const { f, agent, owner, origin, created, active } = await agentFixture(t);
  const c = client(active.socketPath); t.after(() => c.socket.destroy()); await once(c.socket, "connect");
  assert.equal(statSync(active.socketPath).mode & 0o777, 0o600);
  assert.equal(statSync(join(active.socketPath, "..")).mode & 0o777, 0o700);
  const listed = new SshReader(await c.send(Buffer.from([11]), true));
  assert.equal(listed.byte(), 12); assert.equal(listed.uint32(), 1); assert.deepEqual(listed.string(), f.identity.blob); listed.string(); listed.end();
  for (const frame of [Buffer.from([17]), Buffer.from([27]), Buffer.from([11, 0]), signFrame(f, 1)]) assert.deepEqual(await c.send(frame), Buffer.from([5]));
  const response = c.send(signFrame(f)); const request = await pending(agent, created, owner, origin);
  assert.throws(() => agent.poll(created.token, "other-owner", origin));
  assert.throws(() => agent.poll(created.token, owner, "https://other.example.test"));
  assert.throws(() => agent.respond("other-token", owner, origin, request.id));
  agent.respond(created.token, owner, origin, request.id, f.assertion(Buffer.from(request.challenge, "base64url")));
  const signed = new SshReader(await response); assert.equal(signed.byte(), 14); assert.match(realVerify(f, signed.string()), /Good "git" signature/); signed.end();
  assert.throws(() => agent.respond(created.token, owner, origin, request.id));
  const denied = c.send(signFrame(f)); const next = await pending(agent, created, owner, origin);
  agent.respond(created.token, owner, origin, next.id); assert.deepEqual(await denied, Buffer.from([5]));
  const invalid = c.send(signFrame(f)); const bad = await pending(agent, created, owner, origin);
  assert.throws(() => agent.respond(created.token, owner, origin, bad.id, f.assertion(Buffer.from("wrong"))));
  assert.deepEqual(await invalid, Buffer.from([5]));
});

test("durable session bindings fail closed after disconnect and restart without changing the global environment", async t => {
  const { f, agent, owner, origin, created, active, root } = await agentFixture(t);
  const before = process.env.SSH_AUTH_SOCK;
  agent.bind(created.token, owner, origin, "session-one");
  assert.deepEqual(agent.environment("session-one"), { SSH_AUTH_SOCK: active.socketPath });
  assert.deepEqual(agent.environment("session-two"), {}); assert.equal(process.env.SSH_AUTH_SOCK, before);
  const second = agent.create(owner, f.credential, origin);
  await agent.activate(second.token, owner, origin, f.assertion(Buffer.from(second.challenge, "base64url")));
  assert.throws(() => agent.bind(second.token, owner, origin, "session-one"), /another browser/);
  agent.disconnect(created.token, owner, origin);
  assert.throws(() => agent.environment("session-one"), /disconnected/);
  const restarted = new BrowserSshAgent({ markerRoot: join(root, "markers") }); t.after(() => restarted.dispose());
  assert.throws(() => restarted.environment("session-one"), /disconnected/);
  agent.bind(second.token, owner, origin, "session-one");
  assert.ok(agent.environment("session-one").SSH_AUTH_SOCK);
  assert.throws(() => agent.unbind("session-one", "different-owner", second.token), /another browser/);
  assert.throws(() => agent.unbind("session-one", owner, "wrong-token"), /another browser/);
  agent.unbind("session-one", owner, second.token); assert.deepEqual(agent.environment("session-one"), {});
  assert.throws(() => agent.bind(second.token, owner, origin, "../escape"));
});

test("bounded frames, pending queues, client-close cancellation and timeout settle without retry", async t => {
  const { f, agent, owner, origin, created, active } = await agentFixture(t, { signMs: 150 });
  const clients = Array.from({ length: 5 }, () => client(active.socketPath));
  t.after(() => clients.forEach(c => c.socket.destroy()));
  await Promise.all(clients.map(c => once(c.socket, "connect")));
  const replies = clients.map(c => c.send(signFrame(f)));
  await pending(agent, created, owner, origin);
  await delay(20);
  assert.ok(agent.poll(created.token, owner, origin).requests.length <= 4);
  assert.deepEqual(await Promise.all(replies), Array.from({ length: 5 }, () => Buffer.from([5])));
  assert.equal(agent.poll(created.token, owner, origin).requests.length, 0);
  void clients[0].send(signFrame(f)); await pending(agent, created, owner, origin);
  clients[0].socket.destroy(); await delay(20); assert.equal(agent.poll(created.token, owner, origin).requests.length, 0);
  const oversized = client(active.socketPath); await once(oversized.socket, "connect");
  const closed = once(oversized.socket, "close"); const header = Buffer.alloc(4); header.writeUInt32BE(MAX_SSH_FRAME + 1); oversized.socket.write(header); await closed;
});

test("both built-in and explicit session Bash apply only their own browser socket", async t => {
  const { agent, owner, origin, created, active } = await agentFixture(t);
  const key = Symbol.for("brabbler:browser-ssh-agent"); const previous = globalThis[key]; globalThis[key] = agent;
  t.after(() => { if (previous) globalThis[key] = previous; else delete globalThis[key]; });
  agent.bind(created.token, owner, origin, "session-one");
  let captured;
  const operations = sessionId => createProjectCommandBashOperations({ sessionId, baseEnvironment: { SSH_AUTH_SOCK: "host-agent" }, localOperations: { async exec(_command, _cwd, options) { captured = options.env; return { exitCode: 0 }; } } });
  await operations("session-one").exec("echo", process.cwd(), { onData() {} }); assert.equal(captured.SSH_AUTH_SOCK, active.socketPath);
  await operations("session-two").exec("echo", process.cwd(), { onData() {} }); assert.equal(captured.SSH_AUTH_SOCK, "host-agent");
  const extension = createProjectCommandBashExtension({ cwd: process.cwd(), settings: { getShellCommandPrefix: () => undefined, getShellPath: () => undefined } });
  let tool; await extension.factory({ registerTool(value) { tool = value; } });
  const context = { sessionManager: { getSessionId: () => "session-one", getSessionFile: () => undefined } };
  const result = await tool.execute("browser-ssh", { command: "printf '%s' \"$SSH_AUTH_SOCK\"" }, undefined, undefined, context);
  assert.equal(result.content[0].text, active.socketPath);
  agent.disconnect(created.token, owner, origin);
  await assert.rejects(async () => operations("session-one").exec("echo", process.cwd(), { onData() {} }), /disconnected/);
});

test("marker lookup errors and unsafe paths never become inherited-agent fallback", async t => {
  const { agent, owner, origin, created, root } = await agentFixture(t);
  agent.bind(created.token, owner, origin, "session-one");
  const restarted = new BrowserSshAgent({ markerRoot: join(root, "markers") }); t.after(() => restarted.dispose());
  const markers = join(root, "markers"); chmodSync(markers, 0);
  try { assert.throws(() => restarted.environment("session-one"), /EACCES/); }
  finally { chmodSync(markers, 0o700); }
  unlinkSync(join(markers, "session-one"));
  symlinkSync(join(root, "missing"), join(markers, "session-one"));
  assert.throws(() => restarted.environment("session-one"), /Unsafe/);
  assert.throws(() => restarted.environment("../invalid"), /Invalid session/);
  unlinkSync(join(markers, "session-one"));
  // A removed marker does not drop this process's known live ownership.
  assert.ok(agent.environment("session-one").SSH_AUTH_SOCK);
});

test("backpressure races remove both listeners rather than retaining close callbacks", async () => {
  const socket = new EventEmitter(); socket.destroyed = false;
  for (let i = 0; i < 100; i++) {
    const waiting = waitForAgentDrain(socket); socket.emit(i % 2 ? "drain" : "close"); await waiting;
    assert.equal(socket.listenerCount("close"), 0); assert.equal(socket.listenerCount("drain"), 0);
  }
  socket.destroyed = true; await waitForAgentDrain(socket);
  assert.equal(socket.listenerCount("close"), 0);
});

test("disposal cancels pending signatures, removes sockets and leaves fail-closed session markers", async t => {
  const { f, agent, owner, origin, created, active } = await agentFixture(t);
  agent.bind(created.token, owner, origin, "session-one");
  const c = client(active.socketPath); await once(c.socket, "connect");
  void c.send(signFrame(f)); await pending(agent, created, owner, origin);
  const closed = once(c.socket, "close"); agent.dispose(); await closed;
  assert.equal(existsSync(active.socketPath), false);
  assert.throws(() => agent.environment("session-one"), /disconnected/);
  assert.throws(() => agent.respond(created.token, owner, origin, "stale"), /unavailable/);
  assert.throws(() => agent.create(owner, f.credential, origin), /shutting down/);
});

test("singleton signal cleanup closes an active socket in a real owned child", async t => {
  const root = mkdtempSync(join(tmpdir(), "ssh-shutdown-test-"));
  const child = spawn(process.execPath, [new URL("./browser-ssh-process.fixture.mjs", import.meta.url).pathname], { env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent") }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = once(child, "close");
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; rmSync(root, { recursive: true, force: true }); });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [data] = await Promise.race([once(child.stdout, "data"), closed.then(() => { throw new Error(`SSH fixture exited before readiness: ${stderr}`); })]); const { socketPath } = JSON.parse(data.toString());
    assert.ok(existsSync(socketPath)); child.kill("SIGTERM");
    const [code, signal] = await closed; assert.equal(code, 0, stderr); assert.equal(signal, null);
    assert.equal(existsSync(socketPath), false); assert.equal(existsSync(join(socketPath, "..")), false);
    assert.ok(existsSync(join(root, "agent", "browser-ssh-sessions", "signal-session")));
  } finally { clearTimeout(timer); }
});

test("activation proof is single-use and bootstrap agent count is bounded", async t => {
  const root = mkdtempSync(join(tmpdir(), "ssh-bootstrap-test-"));
  const agent = new BrowserSshAgent({ markerRoot: join(root, "markers") }); t.after(() => { agent.dispose(); rmSync(root, { recursive: true, force: true }); });
  const f = fixture();
  const created = agent.create("owner", f.credential, f.identity.origin);
  const wrong = f.assertion(Buffer.from("wrong"));
  await assert.rejects(agent.activate(created.token, "owner", f.identity.origin, wrong));
  await assert.rejects(agent.activate(created.token, "owner", f.identity.origin, f.assertion(Buffer.from(created.challenge, "base64url"))), /unavailable/);
  for (let i = 0; i < 8; i++) agent.create("owner", f.credential, f.identity.origin);
  assert.throws(() => agent.create("owner", f.credential, f.identity.origin), /Too many/);
});

test("lost browser lease closes its native socket and invalidates its capability", async t => {
  const { agent, owner, origin, created, active } = await agentFixture(t, { leaseMs: 40 });
  await delay(120);
  assert.throws(() => agent.poll(created.token, owner, origin), /unavailable/);
  assert.equal(existsSync(active.socketPath), false);
  assert.equal(existsSync(join(active.socketPath, "..")), false);
});
