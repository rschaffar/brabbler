import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { createJiti } from 'jiti';
const root = mkdtempSync(join(tmpdir(), 'legacy-operation-review-'));
after(() => rmSync(root, { recursive: true, force: true }));
const jiti = createJiti(import.meta.url, { fsCache: false });
const { legacyReviewStore } = await jiti.import('./legacy-store.ts');
const { preparePluginReview, reviewManifest, reviewPage, reviewEntry, reviewPreview, reviewStream } = legacyReviewStore(root);
async function bundle(size = 100) {
  return preparePluginReview('example', randomUUID(), async writer => {
    for (let i = 0; i < 45; i++) {
      await writer.begin(`Entry ${i}`, i === 0 ? 'text' : 'patch'); await writer.write(Buffer.from('x'.repeat(size) + '\n')); await writer.end();
    }
  });
}
async function consume(ref, entry) {
  const source = await reviewStream(ref, entry), closed = once(source, 'close');
  const chunks = [];
  try { for await (const chunk of source) chunks.push(chunk); }
  finally { source.destroy(); await closed; }
  assert.equal(source.closed, true); assert.equal(source.fd, null);
  return Buffer.concat(chunks);
}
test('offline legacy codec preserves 40-entry pages, all original patch bytes, owner/hash binding and private modes', async () => {
  const ref = await bundle();
  assert.equal((await reviewManifest(ref, 'example')).entries, 45);
  assert.equal((await reviewPage(ref, 0)).entries.length, 40); assert.equal((await reviewPage(ref, 40)).entries.length, 5);
  let patch = '';
  for (let index = 1; index < ref.entries; index++) patch += (await consume(ref, await reviewEntry(ref, index))).toString();
  assert.equal(patch, ('x'.repeat(100) + '\n').repeat(44));
  assert.equal((await consume(ref)).length, ref.bytes);
  await assert.rejects(reviewManifest(ref, 'wrong-plugin'), /mismatch/);
  assert.equal(statSync(join(root, ref.id, 'data')).mode & 0o777, 0o600);
});
test('large legacy previews stay bounded, streams close at EOF and cancellation, and corrupted bytes refuse', async () => {
  const ref = await preparePluginReview('example', randomUUID(), async writer => {
    await writer.begin('Large', 'patch'); for (let i = 0; i < 48; i++) await writer.write(Buffer.alloc(65536, 120)); await writer.end();
  });
  const entry = await reviewEntry(ref, 0), preview = await reviewPreview(ref, entry);
  assert.equal(preview.complete, false); assert.equal(preview.text.length, 256 * 1024);
  assert.equal((await consume(ref, entry)).length, ref.bytes);
  const cancelled = await reviewStream(ref, entry), closed = once(cancelled, 'close');
  cancelled.destroy(); await closed; assert.equal(cancelled.closed, true); assert.equal(cancelled.fd, null);
  await reviewManifest(ref, 'example');
  const path = join(root, ref.id, 'data'), changed = readFileSync(path); changed[0] = 121; writeFileSync(path, changed);
  await assert.rejects(reviewManifest(ref, 'example'), /integrity/);
});
test('legacy index integrity and no-follow files refuse without accepting an outside descriptor', async () => {
  const ref = await bundle(), path = join(root, ref.id, 'offsets');
  const changed = readFileSync(path); changed[0] ^= 1; writeFileSync(path, changed);
  await assert.rejects(reviewManifest(ref, 'example'), /integrity/);
  const other = await bundle(), data = join(root, other.id, 'data');
  renameSync(data, `${data}-original`); symlinkSync(`${data}-original`, data);
  await assert.rejects(reviewManifest(other, 'example'));
});
test('unpublished synthetic failures are removed; published codec inputs have no TTL eviction', async () => {
  const ref = await bundle(), before = readdirSync(root);
  await assert.rejects(preparePluginReview('example', randomUUID(), async writer => {
    await writer.begin('Incomplete', 'text'); throw new Error('failed build');
  }), /failed build/);
  assert.deepEqual(readdirSync(root), before); await reviewManifest(ref, 'example');
  await assert.rejects(reviewPage({ id: '../secret', entries: 1 }, 0));
});
