import { sshNativeCase } from './ssh-bridge-native.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server.js';
import { createJiti } from 'jiti';
import { createSshAgentRouter } from '../bin/ssh-agent-router.js';
import { fixture as generatedCredential } from './browser-ssh.fixture.mjs';

// One real private native composition for all cheap request-decision rows. No
// browser/server/SDK process or port; generated EC assertions are SYNTHETIC
// cryptographic fixtures, NOT native Chromium possession or physical WebAuthn.
test('real SSH POST rejects exact IP connect and malformed/foreign token select-disconnect without changing native owner or stable socket', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ssh-route-actions-'));
  const symbol = Symbol.for('brabbler:managed-ssh-agent');
  const previous = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const priorPassword = process.env.BRABBLER_PASSWORD;
  const priorHosts = process.env.BRABBLER_ALLOWED_HOSTS;
  let router, pool, routerAttempted = false;
  // Before application import/bridge admission. Product dispose timing is unchanged;
  // this fixture separately joins both retired native bridge callbacks/removals.
  const native = sshNativeCase(t, {
    root, pool: () => pool, router: () => router, routerAttempted: () => routerAttempted,
    restore: [
      () => { if (previous) Object.defineProperty(globalThis, symbol, previous); else delete globalThis[symbol]; },
      () => { if (priorPassword === undefined) delete process.env.BRABBLER_PASSWORD; else process.env.BRABBLER_PASSWORD = priorPassword; },
      () => { if (priorHosts === undefined) delete process.env.BRABBLER_ALLOWED_HOSTS; else process.env.BRABBLER_ALLOWED_HOSTS = priorHosts; },
    ],
  });
  const jiti = createJiti(import.meta.url, { fsCache: false, tsconfigPaths: true, alias: { '@': process.cwd() } });
  const { POST } = await jiti.import('../app/api/ssh-agent/route.ts');
  const { ManagedSshAgent } = await jiti.import('./managed-ssh-agent.ts');
  const { SshKeyRegistry } = await jiti.import('./ssh-key-registry.ts');
  const { signingKey } = await jiti.import("./web-auth-state.ts");
const { createWebSessionToken } = await jiti.import('./web-auth.ts');
  const password = 'SYNTHETIC-private-route-password';
  process.env.BRABBLER_PASSWORD = password; delete process.env.BRABBLER_ALLOWED_HOSTS;
  routerAttempted = true;
  router = await createSshAgentRouter({ instance: 'route-actions:30141', tempDir: root,
    environment: { PI_CODING_AGENT_DIR: join(root, 'agent'), PATH: '/nonexistent' } });
  const registry = new SshKeyRegistry({ root: join(root, 'keys') });
  pool = new ManagedSshAgent({ registry, rpc: body => router.rpc(body) });
  const dispatch = pool.dispatch.bind(pool), admissions = [];
  pool.dispatch = (...args) => { admissions.push(args); return dispatch(...args); }; // passive exact real-boundary admission observer
  Object.defineProperty(globalThis, symbol, { configurable: true, writable: true, value: pool });
  const cookieA = `brabbler_session=${createWebSessionToken(signingKey())}`;
  const cookieB = `brabbler_session=${createWebSessionToken(signingKey())}`;
  assert.notEqual(cookieA, cookieB, 'distinct actual signed synthetic cookie identities');
  const request = (body, { headers = {}, url = 'http://localhost/api/ssh-agent' } = {}) => new NextRequest(url, {
    method: 'POST', headers: { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'application/json', Cookie: cookieA, ...headers },
    body: JSON.stringify(body),
  });
  const call = async (body, options, status = 200) => {
    const result = await POST(request(body, options));
    const text = await result.text();
    assert.equal(result.status, status, text);
    if (status !== 403) assert.equal(result.headers.get('cache-control'), 'no-store');
    return JSON.parse(text);
  };
  const material = generatedCredential('http://localhost');
  const record = registry.add({ name: 'Synthetic route key', credential: material.credential, origin: 'http://localhost',
    policy: 'strict', protection: null, discoverability: 'unknown', applicationOnly: true }, registry.snapshot().revision).record;
  const front = router.socketPath;
  assert.equal(statSync(front).isSocket(), true);
  const attach = async (cookie, device) => {
    const options = { headers: { Cookie: cookie } };
    const proof = await call({ action: 'connect', keyId: record.id, device, makeActive: true, unlock: false }, options);
    await call({ action: 'activate', token: proof.token, assertion: material.assertion(Buffer.from(proof.challenge, 'base64url')) }, options);
    return proof;
  };
  const a = await attach(cookieA, 'Synthetic A'), b = await attach(cookieB, 'Synthetic B');
  assert.notEqual(a.token, b.token);
  const snapshot = () => call({ action: 'status' });
  const initial = await snapshot(); assert.equal(initial.activeId, b.id); assert.equal(initial.connections.length, 2);

  // This must be exact CONNECT with a real registered key, not begin-import.
  // Status can be200 at the IP; FIDO connect must fail BEFORE managed dispatch.
  const ip = { url: 'http://127.0.0.1/api/ssh-agent', headers: { Host: '127.0.0.1', Origin: 'http://127.0.0.1' } };
  assert.equal((await call({ action: 'status' }, ip)).runtime.socketPath, front);
  const beforeIp = admissions.length;
  await call({ action: 'connect', keyId: record.id, device: 'IP must not start FIDO' }, ip, 400);
  assert.equal(admissions.length, beforeIp, 'IP RP rejection precedes actual pool dispatch; later origin mismatch alone is not a sufficient oracle');

  const beforeAuth = admissions.length;
  await call({ action: 'poll', token: a.token }, { headers: { Origin: 'https://untrusted.example.test' } }, 403);
  await call({ action: 'status' }, { headers: { Cookie: '', Authorization: `Basic ${Buffer.from(`pi:${password}`).toString('base64')}` } }, 403);
  assert.equal(admissions.length, beforeAuth, 'untrusted Origin and no signed cookie never reach real authority');

  // Unknown well-formed64zeros preserves the exact browser tuple; malformed
  // lengths/characters/types additionally exercise capability parsing, not mocks.
  for (const action of ['poll', 'select', 'disconnect']) for (const token of ['', 'x', '0'.repeat(63), 'g'.repeat(64), '0'.repeat(64), null, {}, undefined]) {
    await call({ action, token }, undefined, 400);
  }
  for (const action of ['poll', 'select', 'disconnect']) {
    const before = admissions.length;
    await call({ action, token: a.token }, { headers: { Cookie: cookieB } }, 400);
    assert.equal(admissions.length, before + 1, `${action}: real managed owner check, not fake whole route`);
    const actual = await snapshot();
    assert.equal(actual.activeId, b.id, `${action}: foreign cookie cannot switch active ownership`);
    assert.equal(actual.connections.some(item => item.id === a.id), true, `${action}: foreign cookie cannot revoke A`);
    assert.equal(actual.runtime.socketPath, front);
  }
  // Positive owning controls prove rejection is not blanket denial of endpoints.
  await call({ action: 'poll', token: a.token });
  const selected = await call({ action: 'select', token: a.token });
  assert.equal(selected.activeId, a.id);
  const disconnected = await call({ action: 'disconnect', token: a.token });
  assert.equal(disconnected.connections.some(item => item.id === a.id), false);
  assert.equal(disconnected.connections.some(item => item.id === b.id), true);
  assert.equal(disconnected.runtime.socketPath, front); assert.equal(statSync(front).isSocket(), true);
  for (const action of ['poll', 'select', 'disconnect']) await call({ action, token: a.token }, undefined, 400);
  await call({ action: 'disconnect', token: b.token }, { headers: { Cookie: cookieB } });
  assert.equal((await snapshot()).connections.length, 0);
  assert.equal(native.bridges.snapshot().length, 2, 'both actual generated native bridges remain owned after engine retirement');
});
