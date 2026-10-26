import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { loadBackend, next, backendCase } from '../../../lib/backend-ownership.fixture.mjs';
const { buildSessionContext } = await createJiti(import.meta.url, { fsCache: false }).import('../../../lib/session-context.ts');
export async function contextHandler(t, { live = true, evict = false, missing = false, failure } = {}) {
  const owner = backendCase(t), calls = [];
  const entries = Array.from({ length: 1100 }, (_, i) => ({ id: `e${i}`, parentId: i ? `e${i - 1}` : null,
    type: 'message', timestamp: new Date(1000 + i * 1000).toISOString(), message: { role: 'user', content: `m${i}` } }));
  const manager = fresh => ({
    getLeafId: () => 'e1099', getEntries: () => entries,
    getEntry: id => id === 'fresh-anchor' ? fresh ? { id } : undefined : entries.find(e => e.id === id),
    getBranch(leaf) { calls.push(['branch', leaf]); return leaf === 'sibling' ? [{ id: 'sibling' }] : [...entries, ...(fresh ? [{ id: 'fresh-anchor' }] : [])]; },
  });
  const { GET } = await loadBackend(new URL('./[id]/context/route.ts', import.meta.url), {
    'next/server': next,
    '@/lib/rpc-manager': { getRpcSession(id) { assert.equal(id, 'session'); calls.push(['live']); return live ? {
      isAlive: () => true, inner: { sessionManager: manager(false) }, evictIfDiskAhead: () => { calls.push(['evict']); return evict; },
    } : undefined; } },
    '@/lib/session-reader': {
      async resolveSessionPath(id) { assert.equal(id, 'session'); calls.push(['path']); if (failure) throw failure; return missing ? null : '/fixture/session.jsonl'; },
      openSessionManager(path) { assert.equal(path, '/fixture/session.jsonl'); calls.push(['open']); return manager(true); },
      buildSessionContext(...args) { calls.push(['build', args[1], args[2]]); return buildSessionContext(...args); },
    },
  });
  const get = query => owner.work((async () => {
    const response = await GET(new Request(`http://localhost/api/sessions/session/context${query}`), { params: Promise.resolve({ id: 'session' }) });
    return { status: response.status, body: await response.json() };
  })());
  return { get, calls, entries };
}
