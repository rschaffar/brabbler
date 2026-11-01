import assert from 'node:assert/strict';
import { act } from 'react';
export const operationId = 'a046677d-8293-4445-9a2b-558317345abc';
export const review = { version: 2, id: 'review', operationId };
export const overview = (result = false, relation = 'unknown') => ({ defaultView: result ? 'result' : 'proposal', hasFiles: true, details: true, relation,
  views: (result ? ['result', 'proposal'] : ['proposal']).map(view => ({ view, label: view === 'result' ? 'Actual result' : 'Original proposal',
    available: true, before: '1'.repeat(40), after: (view === 'result' ? '2' : '3').repeat(40) })) });
export const page = (...names) => ({ files: names.map((path, id) => ({ id, path, status: 'M' })), total: names.length, next: null });
export const preview = text => ({ text, bytes: Buffer.byteLength(text), offset: 0, next: null, complete: true });
export const reads = (h, op, from = 0) => h.requests.slice(from).filter(read => read.status === undefined && read.url.searchParams.get('op') === op);
export const live = (h, op) => reads(h, op).findLast(read => !read.signal.aborted);
export async function deliver(h, op, value, options, from = 0) {
  const pending = reads(h, op, from); assert.ok(pending.length, `actual ${op} reads admitted`);
  for (const read of pending) await h.reply(read, value, options);
}
export async function body(h, read, payload, options) {
  assert.ok(read, 'named admitted read');
  await act(async () => { read.reply(payload, options); });
  assert.equal(read.bodyCalls, 1, 'actual body consumed');
}
