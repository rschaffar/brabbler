import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBackend, next, backendCase, deferred } from './backend-ownership.fixture.mjs';
import { observePrivateProviderLock } from './provider-lock-owner.fixture.mjs';

async function fixture(t, { loginFailure, storeFailure, removal = { status: 'removed' } } = {}) {
  const owner = backendCase(t), loginEntered = deferred(), loginGate = deferred(), storeEntered = deferred(), storeGate = deferred();
  const calls = [], credential = { type: 'api_key', key: 'SYNTHETIC-NOT-LIVE' };
  owner.release(() => loginGate.resolve()); owner.release(() => storeGate.resolve());
  const route = await loadBackend(new URL('../app/api/auth/api-key/[provider]/route.ts', import.meta.url), {
    'next/server': next,
    '@/lib/models-cache': { invalidateModelsCache: () => calls.push(['invalidate']) },
    '@/lib/provider-credential-store': {
      async storeProviderCredential(provider, value) { calls.push(['store', provider, value]); storeEntered.resolve(); await storeGate.promise; if (storeFailure) throw storeFailure; },
      async removeStoredCredentialIfType(...args) { calls.push(['remove', ...args]); return removal; },
    },
    '@/lib/model-runtime': { async createModelRuntimeWithExtensions() { calls.push(['runtime']); return {
      login: owner.unexpected('ModelRuntime.login network refresh'), refresh: owner.unexpected('catalog network refresh'),
      getProvider(provider) { assert.equal(provider, 'provider'); return { auth: { apiKey: { async login(options) {
        calls.push(['login', options]); loginEntered.resolve(options); await loginGate.promise;
        if (loginFailure) throw loginFailure;
        return credential;
      } } } }; },
    }; } },
  });
  const signal = new AbortController();
  owner.release(() => signal.abort());
  const post = (...keys) => owner.response(route.POST(new Request('http://localhost/api/auth/api-key/provider', {
    method: 'POST', body: JSON.stringify({ apiKey: keys.length ? keys[0] : '  SYNTHETIC-NOT-LIVE  ' }), signal: signal.signal,
  }), { params: Promise.resolve({ provider: 'provider' }) }));
  return { ...route, owner, calls, post, signal, credential, loginEntered, loginGate, storeEntered, storeGate };
}

test('API-key login uses the request signal and commits credential before cache/publication, without catalog refresh', async t => {
  const f = await fixture(t);
  const work = f.post();
  const options = await f.loginEntered.promise;
  assert.equal(options.signal.aborted, false); f.signal.abort(); assert.equal(options.signal.aborted, true);
  assert.equal(await options.prompt({ type: 'select', options: [{ id: 'oauth' }, { id: 'api-key' }] }), 'api-key');
  assert.equal(await options.prompt({ type: 'secret' }), 'SYNTHETIC-NOT-LIVE');
  await assert.rejects(options.prompt({ type: 'secret' }), /additional authentication settings/);
  assert.equal(f.calls.some(([name]) => name === 'store' || name === 'invalidate'), false);
  f.loginGate.resolve(); await f.storeEntered.promise;
  assert.equal(f.calls.some(([name]) => name === 'invalidate'), false);
  assert.deepEqual(f.calls.find(([name]) => name === 'store'), ['store', 'provider', f.credential]);
  f.storeGate.resolve(); const response = await work;
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true });
  assert.equal(f.calls.at(-1)[0], 'invalidate');
});

test('API-key validation rejects the entire invalid matrix before runtime or store', async t => {
  const f = await fixture(t);
  for (const key of [undefined, null, '', '   ', 1, {}]) {
    const response = await f.post(key);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'apiKey is required' });
  }
  assert.deepEqual(f.calls, []);
});
for (const stage of ['login', 'store']) test(`API-key ${stage} failure never invalidates or claims success`, async t => {
  const failure = new Error(`controlled ${stage} failure`);
  const f = await fixture(t, { [stage === 'login' ? 'loginFailure' : 'storeFailure']: failure });
  f.loginGate.resolve(); f.storeGate.resolve();
  const response = await f.post();
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: String(failure) });
  assert.equal(f.calls.some(([name]) => name === 'invalidate'), false);
  assert.equal(f.calls.some(([name]) => name === 'store'), stage === 'store');
});
test('interactive choices and bearer-token setup remain distinct', async t => {
  const f = await fixture(t); const work = f.post(); const options = await f.loginEntered.promise;
  assert.equal(await options.prompt({ type: 'select', options: [{ id: 'bearer-token' }] }), 'bearer-token');
  await assert.rejects(options.prompt({ type: 'select', options: [{ id: 'device' }] }), /interactive authentication setup/);
  await assert.rejects(options.prompt({ type: 'text' }), /additional authentication settings/);
  f.loginGate.resolve(); f.storeGate.resolve(); await (await work).json();
});
test('DELETE compares credential type in the store and never removes OAuth as an API key', async t => {
  for (const status of ['removed', 'type_mismatch']) await t.test(status, async t => {
    const f = await fixture(t, { removal: { status } });
    const response = await f.owner.response(f.DELETE(new Request('http://localhost/api/auth/api-key/provider', { method: 'DELETE' }), { params: Promise.resolve({ provider: 'provider' }) }));
    assert.equal(response.status, status === 'removed' ? 200 : 409);
    const body = await response.json(); assert.equal(status === 'removed' ? body.success : body.error.includes('OAuth'), true);
    assert.deepEqual(f.calls[0], ['remove', 'provider', 'api_key']);
    assert.equal(f.calls.some(([name]) => name === 'invalidate'), status === 'removed');
  });
});


test('real API-key handler composes the locked native credential store, with durable error distinction and no catalog', async t => {
  const owner = backendCase(t), root = await mkdtemp(join(tmpdir(), 'brabbler-api-key-native-'));
  owner.remove(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'auth.json');
  await writeFile(file, JSON.stringify({ other: { type: 'api_key', key: 'SYNTHETIC-OTHER' } }), { mode: 0o600 });
  const observer = observePrivateProviderLock(file), nativeWork = [];
  owner.join(async () => {
    await Promise.allSettled(nativeWork);
    const errors = [];
    try { observer.markReleased(); } catch (error) { errors.push(error); }
    try { await observer.joinAfterRelease(); } catch (error) { errors.push(error); }
    try { observer.restore(); } catch (error) { errors.push(error); }
    for (const record of observer.snapshot()) if (record.nativeError) errors.push(record.nativeError);
    if (errors.length) throw new AggregateError(errors, 'Private provider lock ownership failed');
  });
  // Bind the actual public package object to the whole actual store owner;
  // no alternate lock algorithm or copied store callback. This also avoids
  // assuming Jiti's CJS evaluation has the same graceful-fs cache identity.
  const store = await loadBackend(new URL('./provider-credential-store.ts', import.meta.url), {
    'proper-lockfile': observer.lockfile,
  }, { actual: true });
  const trackNative = promise => { nativeWork.push(promise); return owner.work(promise); };
  let invalidations = 0;
  const credential = { type: 'api_key', key: 'SYNTHETIC-NEW' };
  const { POST, DELETE } = await loadBackend(new URL('../app/api/auth/api-key/[provider]/route.ts', import.meta.url), {
    'next/server': next,
    '@/lib/models-cache': { invalidateModelsCache: () => { invalidations++; } },
    '@/lib/provider-credential-store': {
      storeProviderCredential: (provider, value) => store.storeProviderCredential(provider, value, file),
      removeStoredCredentialIfType: (provider, type) => store.removeStoredCredentialIfType(provider, type, file),
    },
    '@/lib/model-runtime': { createModelRuntimeWithExtensions: async () => ({ login: owner.unexpected('native composition catalog login'),
      getProvider: () => ({ auth: { apiKey: { login: async () => credential } } }),
    }) },
  });
  const params = { params: Promise.resolve({ provider: 'provider' }) };
  const post = () => trackNative((async () => {
    const response = await POST(new Request('http://localhost/api/auth/api-key/provider', { method: 'POST', body: JSON.stringify({ apiKey: 'SYNTHETIC-NEW' }) }), params);
    return { status: response.status, body: await response.json() };
  })());
  assert.deepEqual(await post(), { status: 200, body: { success: true } });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { other: { type: 'api_key', key: 'SYNTHETIC-OTHER' }, provider: credential });
  assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal(invalidations, 1);
  const removed = await owner.response(trackNative(DELETE(new Request('http://localhost/api/auth/api-key/provider', { method: 'DELETE' }), params)));
  assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), { success: true });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { other: { type: 'api_key', key: 'SYNTHETIC-OTHER' } });
  await writeFile(file, '{broken'); const before = invalidations;
  const failed = await post(); assert.equal(failed.status, 500); assert.equal(Object.hasOwn(failed.body, 'success'), false);
  assert.equal(await readFile(file, 'utf8'), '{broken'); assert.equal(invalidations, before);
});
