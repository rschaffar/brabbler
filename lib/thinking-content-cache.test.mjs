import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { deferred } from './testing/async.fixture.mjs';
const { createThinkingContentCache } = await createJiti(import.meta.url, { fsCache: false }).import('./thinking-content-cache.ts');
const limits = { maxEntries: 2, maxBytes: 24, maxEntryBytes: 24 };

test('thinking reads share the original pending and successful promise, with LRU recency', async t => {
  const cache = createThinkingContentCache(limits), gate = deferred(), work = [];
  t.after(async () => { gate.resolve('1234'); await Promise.allSettled(work); });
  const first = cache('a', () => gate.promise); work.push(first);
  assert.equal(cache('a', () => assert.fail('shared pending read')) === first, true);
  gate.resolve('1234'); assert.equal(await first, '1234');
  const second = cache('b', async () => '1234'); await second;
  assert.equal(cache('a', () => assert.fail('shared completed read')) === first, true);
  await cache('c', async () => '1234');
  assert.equal(cache('a', () => assert.fail('recent entry survives')) === first, true);
  const reloaded = cache('b', async () => 'new');
  assert.equal(reloaded === second, false, 'oldest entry evicted'); await reloaded;
});

test('estimated UTF-16 payload budget evicts below the entry-count cap, including surrogate pairs', async () => {
  const cache = createThinkingContentCache({ ...limits, maxEntries: 100, maxBytes: 12 });
  const first = cache('a', async () => '😀'); await first; // 2 key bytes + 4 value bytes
  const second = cache('b', async () => '😀'); await second;
  assert.equal(cache('a', () => assert.fail('exact byte boundary retains both')) === first, true);
  await cache('c', async () => '😀');
  assert.equal(cache('a', () => assert.fail('touched entry survives')) === first, true);
  const reloaded = cache('b', async () => 'x');
  assert.equal(reloaded === second, false, 'byte budget must evict even with only three entries'); await reloaded;
});

test('oversized thinking remains readable but is not cached or allowed to evict useful entries', async () => {
  const cache = createThinkingContentCache({ ...limits, maxEntries: 100, maxEntryBytes: 10 });
  const small = cache('a', async () => '1234'); await small;
  const large = 'long thinking that must remain available to its reader';
  const first = cache('b', async () => large);
  assert.equal(await first, large);
  assert.equal(cache('a', () => assert.fail('oversize read displaced small entry')) === small, true);
  const second = cache('b', async () => large);
  assert.equal(second === first, false, 'oversized result is never reused from cache'); assert.equal(await second, large);
});

for (const fail of [false, true]) test(`late evicted ${fail ? 'failure' : 'success'} cannot remove or replace a newer same-key read`, async t => {
  const cache = createThinkingContentCache({ ...limits, maxEntries: 1 }), old = deferred(), current = deferred(), work = [];
  t.after(async () => { old.resolve('old'); current.resolve('new'); await Promise.allSettled(work); });
  const first = cache('a', () => old.promise); work.push(first);
  const failure = new Error('controlled old read failure');
  const observed = first.then(value => ({ value }), error => ({ error })); work.push(observed);
  await cache('b', async () => 'other');
  const replacement = cache('a', () => current.promise); work.push(replacement);
  if (fail) old.reject(failure); else old.resolve('old');
  assert.equal(fail ? (await observed).error === failure : (await observed).value === 'old', true);
  assert.equal(cache('a', () => assert.fail('old work invalidated newer pending entry')) === replacement, true);
  current.resolve('new'); assert.equal(await replacement, 'new');
  assert.equal(cache('a', () => assert.fail('old work invalidated newer settled entry')) === replacement, true);
});

test('failed and synchronously throwing reads can be retried', async () => {
  const cache = createThinkingContentCache(limits), failure = new Error('controlled failure');
  for (const read of [() => Promise.reject(failure), () => { throw failure; }]) {
    await assert.rejects(cache('a', read), error => error === failure);
    assert.equal(await cache('a', async () => 'ok'), 'ok');
    await cache('b', async () => '1234'); await cache('c', async () => '1234');
  }
});
