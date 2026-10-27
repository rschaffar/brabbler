import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { GET } = await jiti.import('./route.ts');
const { NextRequest } = await jiti.import('next/server');
const { readNotebook } = await jiti.import('../../../lib/guided-review-server.ts');
const fence = (kind, value) => '```' + kind + '\n' + JSON.stringify(value) + '\n```\n';
const header = { version: 1, id: 'review', title: 'Review' };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'guided-folder-'));
  t.after(() => { delete globalThis.__piAllowedRootsCache; rmSync(root, { recursive: true, force: true }); });
  const folder = join(root, 'review'); mkdirSync(folder);
  const index = join(folder, 'index.md');
  const manifest = { ...header, chapters: [{ id: 'first', title: 'First', path: 'first.md' }, { id: 'last', title: 'Last', path: 'last.md' }] };
  writeFileSync(index, fence('pi-notebook', manifest));
  writeFileSync(join(folder, 'first.md'), fence('pi-step', { ...header, id: 'one' }) + 'First prose');
  writeFileSync(join(folder, 'last.md'), fence('pi-step', { ...header, id: 'two' }) + 'Last prose');
  globalThis.__piAllowedRootsCache = { roots: new Set([folder]), expiresAt: Date.now() + 60_000 };
  const request = async (values, headers) => {
    const response = await GET(new NextRequest(`http://localhost/api/review-notebook?${new URLSearchParams(values)}`, { headers: { host: 'localhost', ...headers } }));
    const binary = response.headers.get('content-type') !== 'application/json';
    return { status: response.status, headers: response.headers, body: binary ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  };
  return { root, folder, index, manifest, request };
}
test('GET reads only bounded declared regular UTF8 chapters with independent root authority', async t => {
  const f = fixture(t);
  const result = await f.request({ index: f.index }); assert.equal(result.status, 200);
  assert.deepEqual(result.body.chapters.flatMap(c => c.steps.map(s => s.id)), ['one', 'two']);
  // An exact externally referenced index, even admitted as its own root, cannot grant siblings.
  globalThis.__piAllowedRootsCache.roots = new Set([f.index]);
  assert.equal((await f.request({ index: f.index })).status, 403);
  assert.throws(() => readNotebook(f.index, new Set([f.index])), /Access denied/);
  globalThis.__piAllowedRootsCache.roots = new Set([f.folder]);
  assert.equal((await f.request({ index: f.index, extra: 'unknown' })).status, 400);
  assert.equal((await f.request({ index: 'relative/index.md' })).status, 400);
  assert.equal((await f.request({ index: f.index }, { origin: 'https://untrusted.invalid' })).status, 403);
  const duplicate = await GET(new NextRequest(`http://localhost/api/review-notebook?${new URLSearchParams({ index: f.index })}&index=${encodeURIComponent(f.index)}`, { headers: { host: 'localhost' } }));
  await duplicate.json(); assert.equal(duplicate.status, 400);
  rmSync(join(f.folder, 'last.md'));
  assert.equal((await f.request({ index: f.index })).status, 400, 'missing declared chapter fails visibly, no discovery fallback');
});
test('symlink chapters/assets, binary/invalid UTF8, traversal, cycles and over-limit data refuse', async t => {
  const f = fixture(t), chapter = join(f.folder, 'last.md');
  writeFileSync(join(f.root, 'outside.md'), 'private'); rmSync(chapter); symlinkSync(join(f.root, 'outside.md'), chapter);
  assert.equal((await f.request({ index: f.index })).status, 403);
  assert.equal((await f.request({ index: f.index, asset: 'last.md' })).status, 403);
  rmSync(chapter);
  for (const bytes of [Buffer.from([0xff, 0xfe]), Buffer.from('binary\0text'), Buffer.alloc(256 * 1024 + 1, 65)]) {
    writeFileSync(chapter, bytes); assert.notEqual((await f.request({ index: f.index })).status, 200);
  }
  writeFileSync(chapter, fence('pi-step', { ...header, id: 'last' }));
  for (const path of ['../outside.md', '/outside.md', 'a/../../outside.md', 'index.md']) {
    writeFileSync(f.index, fence('pi-notebook', { ...f.manifest, chapters: [{ id: 'escape', title: 'Escape', path }] }));
    assert.equal((await f.request({ index: f.index })).status, 400);
  }
  assert.equal((await f.request({ index: f.index, asset: '../outside.md' })).status, 400);
  assert.equal((await f.request({ index: f.index, asset: 'page.html' })).status, 400);
  writeFileSync(join(f.folder, 'data.json'), '{"mutable":true}');
  assert.deepEqual((await f.request({ index: f.index, asset: 'data.json' })).body, { content: '{"mutable":true}', mutable: true });
});

test('selected raster/PDF responses independently authorize bounded regular bytes, signature/MIME and non-executable response headers', async t => {
  const f = fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64');
  const samples = [['pixel.png', png, 'image/png'], ['report.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'), 'application/pdf'],
    ['pixel.jpg', Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]), 'image/jpeg'], ['pixel.gif', Buffer.from('GIF89a12345678'), 'image/gif'], ['pixel.webp', Buffer.from('RIFF0000WEBPVP8 '), 'image/webp']];
  for (const [asset, bytes, mime] of samples) {
    writeFileSync(join(f.folder, asset), bytes);
    const result = await f.request({ index: f.index, asset });
    assert.equal(result.status, 200); assert.deepEqual(result.body, bytes);
    assert.equal(result.headers.get('content-type'), mime); assert.equal(result.headers.get('content-length'), String(bytes.length));
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff'); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.match(result.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
    assert.equal(result.headers.get('cross-origin-resource-policy'), 'same-origin');
    globalThis.__piAllowedRootsCache.roots = new Set([f.index]);
    assert.equal((await f.request({ index: f.index, asset })).status, 403);
    globalThis.__piAllowedRootsCache.roots = new Set([f.folder]);
    writeFileSync(join(f.folder, asset), '<html><script>unsafe()</script></html>');
    assert.equal((await f.request({ index: f.index, asset })).status, 415, 'filename does not grant MIME authority');
    writeFileSync(join(f.folder, asset), bytes);
    truncateSync(join(f.folder, asset), (mime === 'application/pdf' ? 16 : 8) * 1024 * 1024 + 1);
    assert.equal((await f.request({ index: f.index, asset })).status, 413);
  }
  for (const asset of ['script.svg', 'active.html', 'active.mdx', 'https://example.test/image.png', '../outside.pdf']) assert.equal((await f.request({ index: f.index, asset })).status, 400);
  writeFileSync(join(f.root, 'outside.pdf'), '%PDF-1.4'); symlinkSync(join(f.root, 'outside.pdf'), join(f.folder, 'alias.pdf'));
  assert.equal((await f.request({ index: f.index, asset: 'alias.pdf' })).status, 403);
});
