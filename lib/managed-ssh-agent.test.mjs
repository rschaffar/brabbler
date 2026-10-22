import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { connect } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createSshAgentRouter } from "../bin/ssh-agent-router.js";
import { fixture as baseCredentialFixture, protocol } from "./browser-ssh.fixture.mjs";
const jiti = createJiti(import.meta.url);
const { ManagedSshAgent, SSH_UNLOCK_MS } = await jiti.import("./managed-ssh-agent.ts");
const { SshKeyRegistry } = await jiti.import("./ssh-key-registry.ts");
const { sshString, SshReader } = protocol;
function credentialFixture() {
  const f = baseCredentialFixture(); f.credential.id = randomBytes(32).toString("base64url"); f.identity.credential.id = f.credential.id; return f;
}

async function fixture(t, policy = "strict") {
  const root = mkdtempSync(join(tmpdir(), "managed-ssh-")); let tick = 0;
  const registry = new SshKeyRegistry({ root: join(root, "registry") });
  const router = await createSshAgentRouter({ instance: "test:30141", tempDir: root, environment: { PI_CODING_AGENT_DIR: join(root, "agent"), PATH: "/nonexistent" } });
  const pool = new ManagedSshAgent({ registry, rpc: body => router.rpc(body), now: () => tick, leaseMs: SSH_UNLOCK_MS * 3 });
  const sockets = new Set();
  t.after(async () => { for (const socket of sockets) socket.destroy(); await pool.dispose(); await router.close(); rmSync(root, { recursive: true, force: true }); });
  const f = credentialFixture(), origin = f.identity.origin;
  const record = registry.add({ name: "Blue key", credential: f.credential, origin, policy, protection: policy === "strict" ? 3 : 2, discoverability: "non-resident", applicationOnly: false }, registry.snapshot().revision).record;
  const call = (body, owner = "owner-A", atOrigin = origin) => pool.dispatch(body, owner, atOrigin);
  const attach = async (owner = "owner-A", unlock = false, makeActive = true, key = record, material = f) => {
    const proof = await call({ action: "connect", keyId: key.id, device: owner === "owner-A" ? "Desktop" : "Laptop", unlock, makeActive }, owner);
    await call({ action: "activate", token: proof.token, assertion: material.assertion(Buffer.from(proof.challenge, "base64url")) }, owner);
    return { ...proof, owner, material };
  };
  const client = async () => {
    const socket = connect(router.socketPath); sockets.add(socket); socket.on("error", () => {}); await once(socket, "connect");
    return { socket, send(data) { const result = new Promise((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      const closed = () => done(new Error("agent connection closed"));
      const receive = chunk => { bytes = Buffer.concat([bytes, chunk]); if (bytes.length >= 4 && bytes.length === bytes.readUInt32BE() + 4) done(null, bytes.subarray(4)); };
      const done = (error, value) => { socket.removeListener("data", receive); socket.removeListener("close", closed); if (error) reject(error); else resolve(value); };
      socket.once("close", closed); socket.on("data", receive); socket.write(sshString(data));
    }); void result.catch(() => {}); return result; } };
  };
  const pending = async connection => {
    for (let i = 0; i < 100; i++) { const result = await call({ action: "poll", token: connection.token }, connection.owner); if (result.requests.length) return result.requests[0]; await delay(2); }
    throw new Error("signing request not admitted");
  };
  const useBrowser = async () => { await call({ action: "use", revision: router.status().revision, backend: { type: "browser" } }); };
  const sign = material => Buffer.concat([Buffer.from([13]), sshString(material.identity.blob), sshString(material.payload), Buffer.alloc(4)]);
  return { root, registry, router, pool, f, record, origin, call, attach, client, pending, useBrowser, sign, advance(ms) { tick += ms; } };
}
function verifySsh(root, material, result) {
  const parsed = new SshReader(result); assert.equal(parsed.byte(), 14); const signature = parsed.string(); parsed.end();
  const envelope = Buffer.concat([Buffer.from("SSHSIG"), Buffer.from([0, 0, 0, 1]), sshString(material.identity.blob), sshString("git"), sshString(""), sshString("sha512"), sshString(signature)]);
  writeFileSync(join(root, "signature"), `-----BEGIN SSH SIGNATURE-----\n${envelope.toString("base64").match(/.{1,70}/g).join("\n")}\n-----END SSH SIGNATURE-----\n`);
  writeFileSync(join(root, "allowed"), `fixture ${material.identity.publicKey}\n`);
  return execFileSync("ssh-keygen", ["-Y", "verify", "-I", "fixture", "-f", join(root, "allowed"), "-n", "git", "-s", join(root, "signature")], { input: material.message, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

test("strict default routes the stable front and rejects caller policy tampering/UP-only responses", async t => {
  const x = await fixture(t); const c = await x.attach(); await x.useBrowser();
  const status = await x.call({ action: "status" }); assert.equal(JSON.stringify(status).includes(c.token), false); assert.equal(status.runtime.browserSocket, undefined); assert.equal(status.runtime.browserEpoch, undefined);
  const native = await x.client(); const listed = new SshReader(await native.send(Buffer.from([11]))); assert.equal(listed.byte(), 12); assert.equal(listed.uint32(), 1); assert.deepEqual(listed.string(), x.f.identity.blob);
  const bad = native.send(x.sign(x.f)); const request = await x.pending(c); assert.equal(request.userVerification, "required"); assert.equal(request.unlock, false);
  await assert.rejects(x.call({ action: "respond", token: c.token, requestId: request.id, userVerification: "discouraged", unlock: true, assertion: x.f.assertion(x.f.payload, { flags: 1 }) }), /verification/);
  assert.deepEqual(await bad, Buffer.from([5]));
  const signed = native.send(x.sign(x.f)); const next = await x.pending(c);
  await x.call({ action: "respond", token: c.token, requestId: next.id, assertion: x.f.assertion(x.f.payload) });
  assert.match(verifySsh(x.root, x.f, await signed), /Good "git" signature/);
});

test("locked inline approval uses a fresh nonce proof before the separate touch-only SSH ceremony", async t => {
  const x = await fixture(t, "session"), c = await x.attach(); await x.useBrowser(); const native = await x.client();
  let result = native.send(x.sign(x.f)); let request = await x.pending(c); assert.equal(request.unlock, true);
  const proof = await x.call({ action: "begin-request-unlock", token: c.token, requestId: request.id });
  assert.equal(proof.alreadyUnlocked, false); assert.notEqual(proof.challenge, request.challenge);
  const authorized = await x.call({ action: "finish-request-unlock", token: c.token, requestId: request.id, assertion: x.f.assertion(Buffer.from(proof.challenge, "base64url")) });
  assert.equal(authorized.newGrant, true); assert.equal(authorized.request.unlock, false); assert.equal(authorized.request.userVerification, "discouraged");
  await x.call({ action: "respond", token: c.token, requestId: request.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) }); await result;
  const before = (await x.call({ action: "status" })).connections[0]; assert.equal(before.remainingMs, SSH_UNLOCK_MS);
  x.advance(1000); result = native.send(x.sign(x.f)); request = await x.pending(c); assert.equal(request.userVerification, "discouraged"); assert.equal(request.unlock, false);
  await x.call({ action: "respond", token: c.token, requestId: request.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) });
  assert.match(verifySsh(x.root, x.f, await result), /Good "git" signature/);
  assert.equal((await x.call({ action: "status" })).connections[0].remainingMs, SSH_UNLOCK_MS - 1000);
});

test("replayed payload UV cannot reopen a grant; nonce proof is single-use and purpose-bound", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser();
  const native = await x.client(); let result = native.send(x.sign(x.f)), request = await x.pending(c);
  const captured = x.f.assertion(x.f.payload);
  await x.call({ action: "respond", token: c.token, requestId: request.id, assertion: captured }); await result;
  await x.call({ action: "lock", connectionId: c.id });
  result = native.send(x.sign(x.f)); request = await x.pending(c);
  await assert.rejects(x.call({ action: "respond", token: c.token, requestId: request.id, assertion: captured }), /fresh server challenge/);
  assert.deepEqual(await result, Buffer.from([5])); assert.equal((await x.call({ action: "status" })).connections[0].state, "locked");
  result = native.send(x.sign(x.f)); request = await x.pending(c);
  let proof = await x.call({ action: "begin-request-unlock", token: c.token, requestId: request.id });
  await assert.rejects(x.call({ action: "finish-request-unlock", token: c.token, requestId: request.id, assertion: captured }), /ceremony/);
  proof = await x.call({ action: "begin-request-unlock", token: c.token, requestId: request.id });
  const assertion = x.f.assertion(Buffer.from(proof.challenge, "base64url"));
  await x.call({ action: "finish-request-unlock", token: c.token, requestId: request.id, assertion });
  await assert.rejects(x.call({ action: "finish-request-unlock", token: c.token, requestId: request.id, assertion }), /expired|revoked/);
  await x.call({ action: "respond", token: c.token, requestId: request.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) }); await result;
});

test("concurrent locked requests share the first fresh grant without extending its deadline", async t => {
  const x = await fixture(t, "session"), c = await x.attach(); await x.useBrowser();
  const a = await x.client(), b = await x.client(); const firstResult = a.send(x.sign(x.f)), first = await x.pending(c);
  const secondResult = b.send(x.sign(x.f)); let second;
  for (let i = 0; i < 100 && !second; i++) { second = (await x.call({ action: "poll", token: c.token })).requests.find(r => r.id !== first.id); if (!second) await delay(2); }
  assert.ok(second);
  const proof = await x.call({ action: "begin-request-unlock", token: c.token, requestId: first.id });
  await x.call({ action: "finish-request-unlock", token: c.token, requestId: first.id, assertion: x.f.assertion(Buffer.from(proof.challenge, "base64url")) });
  x.advance(1000);
  const already = await x.call({ action: "begin-request-unlock", token: c.token, requestId: second.id }); assert.equal(already.alreadyUnlocked, true);
  for (const request of [first, second]) await x.call({ action: "respond", token: c.token, requestId: request.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) });
  await firstResult; await secondResult;
  assert.equal((await x.call({ action: "status" })).connections[0].remainingMs, SSH_UNLOCK_MS - 1000);
});

test("fresh recovery of an existing session record preserves only server policy and cannot revive a removed record", async t => {
  const x = await fixture(t, "session"), revision = x.registry.snapshot().revision;
  await assert.rejects(x.call({ action: "begin-import", name: "Recovery", credential: x.f.credential, applicationOnly: true, revision: "stale" }), /changed/);
  const begin = () => x.call({ action: "begin-import", name: "Recovery", credential: x.f.credential, applicationOnly: true, existingKeyId: x.record.id, revision: x.registry.snapshot().revision });
  const proof = await begin(); assert.equal(proof.policy, "session");
  const ack = await x.call({ action: "finish-enroll", token: proof.token, assertion: x.f.assertion(Buffer.from(proof.challenge, "base64url")) });
  assert.equal(ack.record.id, x.record.id); assert.equal(ack.record.policy, "session"); assert.equal(ack.snapshot.revision, revision);
  assert.deepEqual((await x.call({ action: "status" })).connections, []);
  const obsolete = await begin(); x.registry.remove(x.record.id, x.registry.snapshot().revision);
  await assert.rejects(x.call({ action: "finish-enroll", token: obsolete.token, assertion: x.f.assertion(Buffer.from(obsolete.challenge, "base64url")) }), /changed/);
  await assert.rejects(begin(), /changed|removed/); assert.deepEqual(x.registry.snapshot().keys, []);
});

test("first standby connection does not implicitly become the active signer", async t => {
  const x = await fixture(t), c = await x.attach("owner-A", false, false); await x.useBrowser();
  assert.equal((await x.call({ action: "status" })).activeId, null);
  const native = await x.client(); assert.deepEqual(await native.send(Buffer.from([11])), Buffer.from([5]), "selected Browser backend is unavailable, not implicitly routed to standby");
  await x.call({ action: "select", token: c.token }); assert.equal((await x.call({ action: "status" })).activeId, c.id);
  const connected = await x.client(), list = new SshReader(await connected.send(Buffer.from([11]))); assert.equal(list.byte(), 12); assert.equal(list.uint32(), 1);
});

test("wall-clock changes do not change connection or grant authority", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser(); const original = Date.now;
  try {
    Date.now = () => original() + 24 * 60 * 60 * 1000;
    assert.equal((await x.call({ action: "poll", token: c.token })).connection.remainingMs, SSH_UNLOCK_MS);
    Date.now = () => original() - 24 * 60 * 60 * 1000; x.advance(1000);
    assert.equal((await x.call({ action: "poll", token: c.token })).connection.remainingMs, SSH_UNLOCK_MS - 1000);
  } finally { Date.now = original; }
});

test("UP-only response is rejected at the exact grant deadline even while its request remains live", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser();
  x.advance(SSH_UNLOCK_MS - 1); const native = await x.client(); const signed = native.send(x.sign(x.f)), request = await x.pending(c);
  assert.equal(request.userVerification, "discouraged"); x.advance(1);
  await assert.rejects(x.call({ action: "respond", token: c.token, requestId: request.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) }), /expired/);
  assert.deepEqual(await signed, Buffer.from([5])); assert.equal((await x.call({ action: "status" })).connections[0].state, "locked");
});

test("takeover retains standby's original grant and drains old key requests without giving away capabilities", async t => {
  const x = await fixture(t, "session"), desktop = await x.attach("owner-A", true); await x.useBrowser();
  const native = await x.client(); const response = native.send(x.sign(x.f)); const request = await x.pending(desktop);
  const other = credentialFixture(); const key = x.registry.add({ name: "Backup", credential: other.credential, origin: x.origin, policy: "session", protection: 2, discoverability: "non-resident", applicationOnly: false }, x.registry.snapshot().revision).record;
  x.advance(1234); const laptop = await x.attach("owner-B", true, true, key, other);
  const old = await x.call({ action: "poll", token: desktop.token }); assert.equal(old.requests[0].previousSigner, true); assert.equal(old.connection.remainingMs, SSH_UNLOCK_MS - 1234);
  await assert.rejects(x.call({ action: "respond", token: desktop.token, requestId: request.id, assertion: x.f.assertion(x.f.payload) }, "owner-B"), /another browser/);
  await x.call({ action: "respond", token: desktop.token, requestId: request.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) }); assert.match(verifySsh(x.root, x.f, await response), /Good/);
  const current = await x.client(); const ids = new SshReader(await current.send(Buffer.from([11]))); ids.byte(); ids.uint32(); assert.deepEqual(ids.string(), other.identity.blob);
  await x.call({ action: "select", token: desktop.token });
  const state = await x.call({ action: "status" }); assert.equal(state.activeId, desktop.id); assert.equal(state.connections.find(c => c.id === desktop.id).remainingMs, SSH_UNLOCK_MS - 1234);
  assert.ok(laptop.token !== desktop.token);
});

test("Lock cancels affected approvals and rejects late unlock/assertion replies without disconnecting", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser(); const native = await x.client();
  const signed = native.send(x.sign(x.f)); const request = await x.pending(c);
  const proof = await x.call({ action: "begin-unlock", token: c.token });
  await x.call({ action: "lock", connectionId: c.id }, "owner-B");
  assert.deepEqual(await signed, Buffer.from([5]));
  await assert.rejects(x.call({ action: "respond", token: c.token, requestId: request.id, assertion: x.f.assertion(x.f.payload) }), /settled/);
  await assert.rejects(x.call({ action: "finish-unlock", token: c.token, assertion: x.f.assertion(Buffer.from(proof.challenge, "base64url")) }), /revoked/);
  assert.equal((await x.call({ action: "status" })).connections[0].state, "locked");
});

test("observing another device does not renew its heartbeat; reconnect does not revive a grant", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser();
  x.advance(SSH_UNLOCK_MS * 3 + 1); const state = await x.call({ action: "status" }); assert.equal(state.connections.length, 0);
  await assert.rejects(x.call({ action: "poll", token: c.token }), /unavailable/);
  const reconnected = await x.attach(); assert.notEqual(reconnected.token, c.token); assert.equal((await x.call({ action: "status" })).connections[0].state, "locked");
});

test("key removal revokes every connection and no old token can unlock after re-registration", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser();
  const proof = await x.call({ action: "begin-unlock", token: c.token });
  await x.call({ action: "remove", keyId: x.record.id, revision: x.registry.snapshot().revision });
  await assert.rejects(x.call({ action: "finish-unlock", token: c.token, assertion: x.f.assertion(Buffer.from(proof.challenge, "base64url")) }), /unavailable/);
  assert.equal((await x.call({ action: "status" })).connections.length, 0); assert.equal(x.router.status().selected.type, "browser"); assert.equal(x.router.status().browserSocket, null);
});

test("controller replacement revokes old grants and delayed disposal cannot clear the new publisher", async t => {
  const x = await fixture(t, "session"), c = await x.attach("owner-A", true); await x.useBrowser();
  const native = await x.client(), response = native.send(x.sign(x.f)), pending = await x.pending(c);
  const replacement = new ManagedSshAgent({ registry: x.registry, rpc: body => x.router.rpc(body) });
  try {
    await replacement.status();
    // No old status/poll is allowed to mask the acceptance-time epoch check.
    await assert.rejects(x.call({ action: "respond", token: c.token, requestId: pending.id, assertion: x.f.assertion(x.f.payload, { flags: 1 }) }), /replaced/);
    assert.deepEqual(await response, Buffer.from([5]));
    const old = await x.call({ action: "status" }); assert.equal(old.connections.length, 0); assert.match(old.error, /replaced/);
    await assert.rejects(x.call({ action: "poll", token: c.token }), /replaced/);
    const epoch = x.router.status().browserEpoch; await x.pool.dispose(); assert.equal(x.router.status().browserEpoch, epoch);
  } finally { await replacement.dispose(); }
});

function registration(f, challenge, protection) {
  const jwk = createPublicKey({ key: Buffer.from(f.credential.spki, "base64url"), format: "der", type: "spki" }).export({ format: "jwk" });
  const id = Buffer.from(f.credential.id, "base64url"), size = Buffer.alloc(2); size.writeUInt16BE(id.length);
  const cose = Buffer.concat([Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 32]), Buffer.from(jwk.x, "base64url"), Buffer.from([0x22, 0x58, 32]), Buffer.from(jwk.y, "base64url")]);
  const ext = protection === null ? Buffer.alloc(0) : Buffer.concat([Buffer.from([0xa1, 0x6b]), Buffer.from("credProtect"), Buffer.from([protection])]);
  const auth = Buffer.concat([createHash("sha256").update(f.identity.rpId).digest(), Buffer.from([protection === null ? 0x45 : 0xc5]), Buffer.alloc(4 + 16), size, id, cose, ext]);
  return { ...f.credential, algorithm: -7, clientDataJSON: Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: f.identity.origin, crossOrigin: false })).toString("base64url"), authenticatorData: auth.toString("base64url"), discoverable: false };
}

test("enrollment parses server-bound creation, then requires fresh UV proof before durable publication", async t => {
  const x = await fixture(t); const f = credentialFixture();
  const begin = await x.call({ action: "begin-enroll", name: "New key", policy: "session" });
  const prepared = await x.call({ action: "prepare-enroll", token: begin.token, registration: registration(f, begin.challenge, 2) });
  assert.equal(x.registry.snapshot().keys.length, 1);
  const result = await x.call({ action: "finish-enroll", token: prepared.token, assertion: f.assertion(Buffer.from(prepared.challenge, "base64url")) });
  assert.equal(result.record.policy, "session"); assert.equal(result.record.protection, 2); assert.equal(x.registry.snapshot().keys.length, 2);
  await assert.rejects(x.call({ action: "finish-enroll", token: prepared.token, assertion: f.assertion(Buffer.from(prepared.challenge, "base64url")) }), /expired/);
});

test("unknown protection and UV-required touch combinations never silently downgrade", async t => {
  const x = await fixture(t), f = credentialFixture();
  for (const [policy, protection] of [["strict", null], ["session", 3]]) {
    const begin = await x.call({ action: "begin-enroll", name: "Unsupported", policy });
    await assert.rejects(x.call({ action: "prepare-enroll", token: begin.token, registration: registration(f, begin.challenge, protection) }), /protection|verification required/);
  }
  const begin = await x.call({ action: "begin-enroll", name: "Explicit server policy", policy: "strict", applicationOnly: true });
  const proof = await x.call({ action: "prepare-enroll", token: begin.token, registration: registration(f, begin.challenge, null) });
  await assert.rejects(x.call({ action: "finish-enroll", token: proof.token, assertion: f.assertion(Buffer.from(proof.challenge, "base64url"), { flags: 1 }) }), /verification/);
  assert.equal(x.registry.snapshot().keys.length, 1);
});

test("legacy import is explicit strict, possession-proven, idempotent and isolated by exact origin/owner", async t => {
  const x = await fixture(t), f = credentialFixture();
  await assert.rejects(x.call({ action: "begin-import", name: "Legacy", credential: f.credential }), /acknowledge/);
  const first = await x.call({ action: "begin-import", name: "Legacy", credential: f.credential, applicationOnly: true });
  await assert.rejects(x.call({ action: "finish-enroll", token: first.token, assertion: f.assertion(Buffer.from(first.challenge, "base64url")) }, "owner-B"), /another browser/);
  const saved = await x.call({ action: "finish-enroll", token: first.token, assertion: f.assertion(Buffer.from(first.challenge, "base64url")) });
  const next = await x.call({ action: "begin-import", name: "Legacy", credential: f.credential, applicationOnly: true });
  const duplicate = await x.call({ action: "finish-enroll", token: next.token, assertion: f.assertion(Buffer.from(next.challenge, "base64url")) });
  assert.equal(saved.record.id, duplicate.record.id); assert.equal(saved.record.policy, "strict"); assert.equal(saved.record.protection, null);
  await assert.rejects(x.call({ action: "connect", keyId: saved.record.id, device: "Wrong origin" }, "owner-A", "https://different.example.test"), /exact origin/);
});
