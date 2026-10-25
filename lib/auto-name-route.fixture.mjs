// Whole actual auto-name POST. Only path/registry/startup, title-provider and
// SDK name/cache capabilities are supplied; no copied handler or SessionManager.
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { loadBackend, next, backendCase, deferred } from './backend-ownership.fixture.mjs';
const { acquireModelRuntimeUse } = await createJiti(import.meta.url, { fsCache: false }).import('./session-model-refresh.ts');

export async function autoNameRoute(t, { mode = 'warm', missing = false, titleFailure = false } = {}) {
  const owner = backendCase(t), readyEntered = deferred(), readyGate = deferred(), titleEntered = deferred(), titleGate = deferred();
  const calls = [], runtime = {}, usage = { input: 3, output: 2, totalTokens: 5 };
  let alive = true;
  owner.release(() => readyGate.resolve()); owner.release(() => titleGate.resolve());
  const selected = { isAlive: () => alive, inner: {
    modelRuntime: runtime,
    setSessionName: title => calls.push(['name', title]),
  }, ...(mode === 'legacy-warm' ? {} : { async waitUntilReady() {
    calls.push(['ready']); readyEntered.resolve(); await readyGate.promise;
  } }) };
  const dead = { isAlive: () => false, inner: {} };
  const { POST } = await loadBackend(new URL('../app/api/sessions/[id]/auto-name/route.ts', import.meta.url), {
    'next/server': next,
    '@/lib/session-reader': {
      async resolveSessionPath(id) { assert.equal(id, 'session'); calls.push(['path', id]); return missing ? null : '/fixture/saved.jsonl'; },
      invalidateSessionListCache: () => calls.push(['invalidate']),
    },
    '@/lib/rpc-manager': {
      getRpcSession(id) { assert.equal(id, 'session'); calls.push(['get', id]); return mode === 'warm' || mode === 'legacy-warm' ? selected : mode === 'dead' ? dead : undefined; },
      async startRpcSession(...args) { calls.push(['start', ...args]); return { session: selected, realSessionId: 'session' }; },
    },
    '@/lib/session-model-refresh': { acquireModelRuntimeUse(value) {
      assert.equal(value, runtime, 'lease belongs to selected session runtime'); calls.push(['lease']);
      const release = acquireModelRuntimeUse(value);
      return () => { calls.push(['release']); release(); };
    } },
    '@/lib/session-title': { async generateSessionTitle(inner) {
      assert.equal(inner, selected.inner, 'title generation receives selected live/startup inner');
      calls.push(['title']); titleEntered.resolve(); await titleGate.promise;
      if (titleFailure) throw new Error('controlled title-provider failure');
      return { title: 'Generated fixture title', usage };
    } },
  });
  const post = () => {
    owner.admit();
    return owner.work((async () => {
      const response = await POST(new Request('http://localhost/api/sessions/session/auto-name', { method: 'POST' }), { params: Promise.resolve({ id: 'session' }) });
      return { status: response.status, body: await response.json() };
    })());
  };
  const until = (gate, request, label) => Promise.race([gate.promise, request.then(result => {
    throw new Error(`${label}: handler returned before the named gate: ${JSON.stringify(result).slice(0, 1000)}`);
  })]);
  return { post, until, calls, usage, readyEntered, readyGate, titleEntered, titleGate, closeSelected: () => { alive = false; } };
}
