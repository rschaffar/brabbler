import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() }, fsCache: false });
const { NextRequest } = await jiti.import('next/server');
const route = await jiti.import('./[id]/patch-context/route.ts');
const { bundledPlugin } = await jiti.import('../../../../lib/plugins/registry.ts');
const { DiffContextError } = await jiti.import('../../../../lib/diff-context.ts');
const plugin = bundledPlugin('session-launch');
const request = (query, id = 'session-launch') => route.GET(new NextRequest(`http://localhost/api/plugins/bundled/${id}/patch-context?${typeof query === 'string' ? query : new URLSearchParams(query)}`), { params: Promise.resolve({ id }) });
const handle = '12345678-1234-1234-1234-123456789abc';
const restored = new WeakSet();
function capability(t, read) {
  if (!restored.has(t)) {
    restored.add(t); const old = plugin.readPatchContext;
    t.after(() => { if (old) plugin.readPatchContext = old; else delete plugin.readPatchContext; });
  }
  plugin.readPatchContext = read;
}
test('generic supplied-patch handle/file/query validation rejects paths, revisions, duplicates and noncanonical IDs before dispatch', async t => {
  let calls = 0; capability(t, async () => { calls++; assert.fail('invalid dispatch'); });
  for (const value of ['', 'HEAD', '../repo', 'f'.repeat(40), handle.toUpperCase(), handle + '\0']) assert.equal((await request({ handle: value, file: '0' })).status, 400);
  for (const file of ['', '01', '-1', '1.0', '256', '1000', 'file.txt', '.git/config', '\0']) assert.equal((await request({ handle, file })).status, 400);
  for (const query of ['', `handle=${handle}`, `handle=${handle}&file=0&file=1`, `handle=${handle}&handle=${handle}&file=0`,
    ...['cwd', 'path', 'before', 'after', 'oid'].map(key => `handle=${handle}&file=0&${key}=arbitrary`)]) assert.equal((await request(query)).status, 400);
  assert.equal(calls, 0);
});
test('optional generic provider dispatch stays intact; retired Git-only expiring context is absent', async t => {
  const calls = [], context = { oldFile: null, newFile: { name: 'file.txt', contents: '', cacheKey: 'immutable' } };
  capability(t, async (...args) => { calls.push(args); return context; });
  for (const file of ['0', '255']) { const response = await request({ handle, file }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), context); }
  assert.deepEqual(calls, [[handle, '0'], [handle, '255']]);
  assert.equal((await request({ handle, file: '0' }, 'unknown')).status, 404);
  assert.equal((await request({ handle, file: '0' }, 'git-workflow')).status, 404);
  assert.equal(bundledPlugin('git-workflow').readPatchContext, undefined);
  assert.equal(typeof bundledPlugin('git-workflow').reviewProvider.read, 'function');
});
test('generic display errors retain their status without becoming execution', async t => {
  for (const status of [400, 404, 409, 413]) {
    capability(t, async () => { throw new DiffContextError(`display unavailable ${status}`, status); });
    const response = await request({ handle, file: '0' }); assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: `display unavailable ${status}` });
  }
  capability(t, async () => { throw new Error('provider unavailable'); });
  assert.equal((await request({ handle, file: '0' })).status, 409);
  assert.deepEqual(Object.keys(route).sort(), ['GET', 'dynamic']);
});
