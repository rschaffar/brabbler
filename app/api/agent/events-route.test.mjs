import '../../../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';
import { loadBackend, next, backendCase, deferred } from '../../../lib/backend-ownership.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { createAgentEventStreamConnection } = await jiti.import('../../../lib/agent-event-stream.ts');
const { SSE_HEADERS } = await jiti.import('../../../lib/sse-stream.ts');

async function fixture(t, { alive = false, missing = false, holdPath = false } = {}) {
  const owner = backendCase(t), startup = deferred(), path = deferred(), pathEntered = deferred();
  const calls = [], connections = [];
  let subscribed = 0, unsubscribed = 0, listener;
  const session = { isAlive: () => true, isStreaming: false, streamingMessage: undefined,
    onEvent(fn) { subscribed++; listener = fn; return () => { unsubscribed++; }; } };
  owner.release(() => { path.resolve(missing ? null : '/fixture/session.jsonl'); startup.resolve({ session }); });
  owner.join(() => Promise.all(connections.map(c => c.startupSettled)));
  const { GET } = await loadBackend(new URL('./[id]/events/route.ts', import.meta.url), {
    'next/server': next,
    '@/lib/sse-stream': { SSE_HEADERS },
    '@/lib/agent-event-stream': { createAgentEventStream(req, id, promise) {
      calls.push(['stream', id]);
      const connection = createAgentEventStreamConnection(req, id, promise); connections.push(connection); return connection.stream;
    } },
    '@/lib/session-reader': { resolveSessionPath: async id => { calls.push(['path', id]); pathEntered.resolve(); return holdPath ? path.promise : missing ? null : '/fixture/session.jsonl'; } },
    '@/lib/rpc-manager': { getRpcSession: id => { calls.push(['get', id]); return alive ? session : undefined; },
      startRpcSession: (...args) => { calls.push(['start', ...args]); return startup.promise; } },
  });
  const abort = new AbortController();
  owner.release(() => abort.abort());
  const get = () => owner.work(GET(new Request('http://localhost/api/agent/id/events', { signal: abort.signal }), { params: Promise.resolve({ id: 'id' }) }));
  return { get, calls, abort, startup, path, pathEntered, session, connections, counts: () => [subscribed, unsubscribed], event: e => listener(e), owner };
}

test('agent SSE returns headers and transport before held SDK startup, then subscribes', async t => {
  const f = await fixture(t);
  const response = await f.get();
  assert.equal(response.status, 200);
  for (const [key, value] of Object.entries(SSE_HEADERS)) assert.equal(response.headers.get(key), value);
  assert.deepEqual(f.calls, [['get', 'id'], ['path', 'id'], ['start', 'id', '/fixture/session.jsonl', undefined], ['stream', 'id']]);
  assert.deepEqual(f.counts(), [0, 0]);
  const reader = response.body.getReader();
  let released = false;
  f.owner.release(async () => { if (!released) { await reader.cancel(); reader.releaseLock(); released = true; } });
  assert.equal(new TextDecoder().decode((await reader.read()).value), ':\n\n');
  f.startup.resolve({ session: f.session });
  await f.connections[0].startupSettled;
  assert.deepEqual(f.counts(), [1, 0]);
  const connected = new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse(connected.slice(6)), { type: 'connected', sessionId: 'id', isStreaming: false });
  f.event({ type: 'session_shutdown' });
  assert.equal((await reader.read()).done, true);
  assert.deepEqual(f.counts(), [1, 1]);
  reader.releaseLock(); released = true;
});

test('warm SSE bypasses path and startup; cancellation joins listener cleanup', async t => {
  const f = await fixture(t, { alive: true });
  const response = await f.get(); await f.connections[0].startupSettled;
  assert.deepEqual(f.calls, [['get', 'id'], ['stream', 'id']]);
  await response.body.cancel(); assert.deepEqual(f.counts(), [1, 1]);
});

test('pre-abort and abort during path resolution return 204 without startup', async t => {
  for (const holdPath of [false, true]) await t.test(String(holdPath), async t => {
    const f = await fixture(t, { holdPath });
    if (!holdPath) f.abort.abort();
    const responseWork = f.get();
    if (holdPath) { await f.pathEntered.promise; f.abort.abort(); f.path.resolve('/fixture/session.jsonl'); }
    const response = await responseWork;
    assert.equal(response.status, 204); assert.equal(response.body, null);
    assert.equal(f.calls.some(([name]) => name === 'start' || name === 'stream'), false);
  });
});
test('missing session returns a full 404 body', async t => {
  const f = await fixture(t, { missing: true }); const response = await f.get();
  assert.equal(response.status, 404); assert.equal(await response.text(), 'Session not found');
});
test('startup rejection is consumed as startup_error and closes the body', async t => {
  const f = await fixture(t); const response = await f.get();
  const consumed = f.owner.work(response.text());
  f.startup.reject(new Error('controlled SDK startup failure'));
  assert.match(await consumed, /"type":"startup_error".*controlled SDK startup failure/);
  await f.connections[0].startupSettled;
  assert.deepEqual(f.counts(), [0, 0]);
});
test('cancelled cold response never subscribes after ignored startup cancellation', async t => {
  const f = await fixture(t); const response = await f.get();
  await response.body.cancel(); f.startup.resolve({ session: f.session });
  await f.connections[0].startupSettled; assert.deepEqual(f.counts(), [0, 0]);
});

// Deliberate allocation/performance guard, not startup/wiring behavior proof.
test('agent SSE allocates one TextEncoder in the connection implementation', async () => {
  const source = await readFile(new URL('../../../lib/agent-event-stream.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 1);
});
