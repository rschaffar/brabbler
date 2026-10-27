import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, symlinkSync, unlinkSync, linkSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { createJiti } from 'jiti';
import { execFileSync } from 'node:child_process';
import { setupInstalledAuth } from '../nix/auth-setup.fixture.mjs';
import { NextRequest } from 'next/server.js';
import { readCredentials, setupCredentials, verifyPassword, authDirectory } from '../bin/web-auth-store.js';
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@': process.cwd() } });
const { proxy } = await jiti.import('../proxy.ts');
const { POST, GET } = await jiti.import('../app/api/web-auth/route.ts');
const { POST: ssh } = await jiti.import('../app/api/ssh-agent/route.ts');
const { recordAuthSuccess } = await jiti.import('./auth-throttle.ts');
const { createWebSessionToken } = await jiti.import('./web-auth.ts');
const { getTitleLanguagePath, writeTitleLanguage } = await jiti.import('./title-language.ts');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'web-auth-'));
  const keys = ['PI_CODING_AGENT_DIR', 'BRABBLER_PASSWORD', 'BRABBLER_REQUIRE_AUTH'];
  const old = keys.map(k => process.env[k]);
  t.after(() => {
    keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; });
    recordAuthSuccess(); rmSync(root, { recursive: true, force: true });
  });
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  delete process.env.BRABBLER_PASSWORD; process.env.BRABBLER_REQUIRE_AUTH = '1'; recordAuthSuccess();
  return { root, file: join(authDirectory(), 'credentials.json') };
}
function request(path, { password, cookie, basic } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: password === undefined ? 'GET' : 'POST',
    headers: { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}), ...(basic ? { Authorization: `Basic ${Buffer.from(`pi:${basic}`).toString('base64')}` } : {}) },
    body: password === undefined ? undefined : JSON.stringify({ password }),
  });
}
test('legacy shared brabbler 0755 without auth preserves local and explicit environment modes', async t => {
  fixture(t);
  const shared = join(process.env.PI_CODING_AGENT_DIR, 'brabbler');
  mkdirSync(shared, { recursive: true, mode: 0o700 }); chmodSync(shared, 0o755);
  delete process.env.BRABBLER_REQUIRE_AUTH;
  assert.equal(readCredentials(), null);
  assert.equal((await proxy(request('/api/sessions'))).status, 200);
  assert.deepEqual(await (await GET(request('/api/web-auth'))).json(), { enabled: false, authenticated: true });
  process.env.BRABBLER_PASSWORD = 'synthetic environment passphrase';
  assert.equal((await proxy(request('/api/sessions'))).status, 401);
  assert.equal((await proxy(request('/api/sessions', { basic: process.env.BRABBLER_PASSWORD }))).status, 200);
  assert.equal((await POST(request('/api/web-auth', { password: process.env.BRABBLER_PASSWORD }))).status, 200);
  delete process.env.BRABBLER_PASSWORD;
  await assert.rejects(setupCredentials('synthetic local passphrase'), /0700/);
  writeTitleLanguage('en', getTitleLanguagePath(process.env.PI_CODING_AGENT_DIR));
  assert.equal(statSync(shared).mode & 0o777, 0o755, 'existing shared directories are never silently chmodded');
  assert.equal(readCredentials(), null);
  mkdirSync(authDirectory(), { mode: 0o700 });
  assert.throws(() => readCredentials(), /invalid or insecure/, 'existing auth requires the strict shared-directory contract');
  assert.equal((await proxy(request('/api/sessions'))).status, 503);
});
test('new title-settings shared directory is private even under umask 022', t => {
  fixture(t);
  const before = process.umask(0o022);
  try { writeTitleLanguage('en', getTitleLanguagePath(process.env.PI_CODING_AGENT_DIR)); }
  finally { process.umask(before); }
  assert.equal(statSync(join(process.env.PI_CODING_AGENT_DIR, 'brabbler')).mode & 0o777, 0o700);
  assert.equal(readCredentials(), null);
});
test('whole launcher warns honestly for canonical required-auth flags without starting a service', async t => {
  fixture(t);
  const cli = join(process.cwd(), 'bin/brabbler.js');
  const source = readFileSync(cli, 'utf8');
  const actualRequire = createRequire(cli);
  const options = actualRequire('./brabbler-options');
  for (const flag of [undefined, '', '0', '1', 'invalid']) {
    if (flag === undefined) delete process.env.BRABBLER_REQUIRE_AUTH;
    else process.env.BRABBLER_REQUIRE_AUTH = flag;
    const warnings = [], launches = [];
    const args = ['--hostname', '0.0.0.0', '--no-open'];
    // Execute the entire real launcher, not extracted policy. Replace only CLI
    // input/build-artifact and child-launch capabilities; use the real store.
    const require = name => {
      if (name === './brabbler-options') return { ...options, parseLaunchOptions: () => options.parseLaunchOptions(args, process.env) };
      if (name === 'fs') return { existsSync: path => { assert.equal(path, join(process.cwd(), '.next')); return true; } };
      if (name === './ssh-agent-launch') return { launchManagedNext: async spec => { launches.push(spec); return { stdout: new EventEmitter() }; } };
      if (name === 'child_process') return { spawn: () => { throw new Error('Unexpected child admission'); } };
      return actualRequire(name);
    };
    require.resolve = () => '/synthetic/next';
    await runInNewContext(source, {
      require, __dirname: join(process.cwd(), 'bin'),
      process: { versions: process.versions, env: process.env, argv: [process.execPath, cli, ...args],
        exit: () => { throw new Error('Unexpected launcher exit'); } },
      console: { warn: message => warnings.push(message), error: () => { throw new Error('Unexpected launcher error'); } },
    }, { filename: cli });
    assert.equal(launches.length, 1);
    assert.equal(warnings.length, 1);
    const locked = flag === '1' || flag === 'invalid';
    assert.match(warnings[0], locked ? /authentication required and access locked/ : /without authentication/);
    assert.equal(warnings[0].includes('with password authentication'), false);
    assert.equal((await proxy(request('/api/sessions'))).status, locked ? 503 : 200, 'warning agrees with real request admission');
  }
});
test('actual CLI uses hidden confirmed controlling TTY, refuses overwrite, and never accepts argv passwords', async t => {
  const { root } = fixture(t);
  const env = { ...process.env, HOME: root };
  const options = { command: process.execPath, prefixArgs: [join(process.cwd(), 'bin/brabbler.js')] };
  const password = 'synthetic CLI passphrase';
  await setupInstalledAuth(process.cwd(), env, password, { ...options, confirmation: 'synthetic mismatched confirmation', expectedCode: 1 });
  assert.equal(readCredentials(), null);
  await setupInstalledAuth(process.cwd(), env, password, options);
  const first = readCredentials();
  await setupInstalledAuth(process.cwd(), env, password, { ...options, expectedCode: 1 });
  assert.deepEqual(readCredentials(), first);
  await setupInstalledAuth(process.cwd(), env, password, { ...options, replace: true });
  assert.notEqual(readCredentials().key, first.key);
  assert.throws(() => execFileSync(process.execPath, [...options.prefixArgs, 'auth', 'setup', password], { env, stdio: ['ignore', 'pipe', 'pipe'] }), error => {
    assert.equal(String(error.stderr).includes(password), false); return error.status === 1;
  });
  assert.throws(() => execFileSync(process.execPath, [...options.prefixArgs, 'auth', 'setup'], { env, stdio: ['ignore', 'pipe', 'pipe'] }), error => {
    assert.match(String(error.stderr), /interactive TTY/); return error.status === 1;
  });
});
test('private salted bounded scrypt persists, refuses overwrite, rotates and caps concurrent KDFs', async t => {
  const { file } = fixture(t);
  assert.equal(readCredentials(), null);
  await setupCredentials('synthetic long passphrase');
  const first = readCredentials();
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(authDirectory()).mode & 0o777, 0o700);
  assert.equal(readFileSync(file, 'utf8').includes('synthetic long passphrase'), false);
  assert.notEqual(first.key, first.verifier);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword('synthetic long passphrase', first), true);
  const occupied = [verifyPassword('synthetic long passphrase', first), verifyPassword('synthetic long passphrase', first)];
  try {
    const cookie = `brabbler_session=${createWebSessionToken(first.key)}`;
    const response = await GET(request('/api/web-auth', { cookie }));
    assert.deepEqual(await response.json(), { enabled: true, authenticated: true }, 'cookie validation never needs a KDF slot');
  } finally { await Promise.allSettled(occupied); }
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => verifyPassword('synthetic long passphrase', first)));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled' && r.value).length, 2);
  assert.equal(outcomes.filter(r => r.status === 'rejected' && r.reason.code === 'AUTH_BUSY').length, 6);
  await assert.rejects(setupCredentials('different long passphrase'), /already configured/);
  await setupCredentials('different long passphrase', { replace: true });
  const next = readCredentials();
  assert.notEqual(next.key, first.key); assert.notEqual(next.salt, first.salt);
  assert.equal(await verifyPassword('different long passphrase', next), true);
});
test('physical owned single-link regular file and private directory validation rejects unsafe state', async t => {
  const { root, file } = fixture(t);
  await setupCredentials('synthetic long passphrase');
  const bytes = readFileSync(file);
  const invalid = ['{', JSON.stringify({ ...readCredentials(), kdf: { N: 2 ** 30, r: 8, p: 1 } }),
    JSON.stringify({ ...readCredentials(), version: 2 }), JSON.stringify({ ...readCredentials(), salt: ['a'.repeat(64)] }),
    'x'.repeat(2049)];
  for (const text of invalid) {
    writeFileSync(file, text); assert.throws(() => readCredentials(), /invalid or insecure/);
    await assert.rejects(setupCredentials('synthetic replacement', { replace: true }), /invalid or insecure/);
  }
  writeFileSync(file, bytes);
  chmodSync(file, 0o644); assert.throws(() => readCredentials()); chmodSync(file, 0o600);
  const other = join(root, 'other'); linkSync(file, other); assert.throws(() => readCredentials()); unlinkSync(other);
  unlinkSync(file); writeFileSync(other, bytes, { mode: 0o600 }); symlinkSync(other, file); assert.throws(() => readCredentials()); unlinkSync(file);
  writeFileSync(file, bytes, { mode: 0o600 }); chmodSync(authDirectory(), 0o755); assert.throws(() => readCredentials()); chmodSync(authDirectory(), 0o700);
  const alias = join(root, 'alias'); symlinkSync(process.env.PI_CODING_AGENT_DIR, alias);
  assert.throws(() => readCredentials({ PI_CODING_AGENT_DIR: alias }));
  const absent = join(root, 'absent'); mkdirSync(absent);
  await assert.rejects(setupCredentials('synthetic replacement', { replace: true, env: { PI_CODING_AGENT_DIR: absent } }), /No credentials/);
});
test('actual proxy/login/SSH fail closed missing, corrupt and conflicting; stored login and rotation revoke cookie', async t => {
  const { file } = fixture(t);
  for (const path of ['/api/sessions', '/api/web-auth', '/api/ssh-agent']) {
    const response = await proxy(request(path, { basic: 'guess' }));
    await response.text(); assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  process.env.BRABBLER_REQUIRE_AUTH = 'unexpected';
  assert.equal((await proxy(request('/api/sessions'))).status, 503, 'invalid flag cannot disable auth');
  process.env.BRABBLER_REQUIRE_AUTH = '1';
  assert.equal((await GET(request('/api/web-auth'))).status, 503);
  assert.equal((await POST(request('/api/web-auth', { password: 'guess' }))).status, 503);
  await setupCredentials('synthetic long passphrase');
  let response = await POST(request('/api/web-auth', { password: 'wrong' }));
  assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await proxy(request('/api/sessions', { basic: 'synthetic long passphrase' }))).status, 429);
  recordAuthSuccess();
  response = await POST(request('/api/web-auth', { password: 'synthetic long passphrase' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await proxy(request('/api/sessions', { cookie }))).status, 200);
  assert.equal((await proxy(request('/api/sessions', { basic: 'synthetic long passphrase' }))).status, 200);
  assert.equal((await ssh(request('/api/ssh-agent', { basic: 'synthetic long passphrase' }))).status, 403);
  await setupCredentials('synthetic replacement passphrase', { replace: true });
  assert.equal((await proxy(request('/api/sessions', { cookie }))).status, 401);
  assert.equal((await ssh(request('/api/ssh-agent', { cookie }))).status, 403);
  process.env.BRABBLER_PASSWORD = 'explicit env conflict';
  assert.equal((await proxy(request('/api/sessions', { basic: 'explicit env conflict' }))).status, 503);
  delete process.env.BRABBLER_PASSWORD;
  chmodSync(file, 0o644);
  assert.equal((await proxy(request('/api/sessions', { basic: 'synthetic replacement passphrase' }))).status, 503);
  chmodSync(file, 0o600);
  writeFileSync(file, '{'); delete process.env.BRABBLER_REQUIRE_AUTH;
  assert.equal((await proxy(request('/api/sessions'))).status, 503, 'corrupt state is never unauthenticated local mode');
  unlinkSync(file);
  assert.equal((await proxy(request('/api/sessions'))).status, 200, 'current local mode remains compatible');
});
