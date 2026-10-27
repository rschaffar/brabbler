import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { GET, POST } = await jiti.import('./route.ts');
const { NextRequest } = await jiti.import('next/server');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-route-')), folder = path.join(root, 'book'); fs.mkdirSync(folder);
  t.after(() => { delete globalThis.__piAllowedRootsCache; fs.rmSync(root, { recursive: true, force: true }); });
  const index = path.join(folder, 'index.md');
  fs.writeFileSync(index, '```pi-notebook\n{"version":1,"id":"constructor","title":"Notebook","chapters":[{"id":"one","title":"One","path":"one.md"}]}\n```');
  fs.writeFileSync(path.join(folder, 'one.md'), '```pi-step\n{"version":1,"id":"toString","title":"Step"}\n```\nProse');
  globalThis.__piAllowedRootsCache = { roots: new Set([folder]), expiresAt: Date.now() + 60_000 };
  const url = `http://localhost/api/review-data?${new URLSearchParams({ index })}`;
  const request = async (body, headers = {}) => {
    const response = await (body ? POST : GET)(new NextRequest(url, { method: body ? 'POST' : 'GET', headers: { host: 'localhost', 'content-type': 'application/json', ...headers }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
  return { root, folder, index, url, request };
}
test('actual native route GET is inert; reference-only admission cannot enable writes; schemas reject duplicate/deep/forged replies', async t => {
  const f = fixture(t); assert.equal((await f.request()).status, 200); assert.equal(fs.existsSync(path.join(f.folder, 'review-data')), false);
  globalThis.__piAllowedRootsCache.roots = new Set([f.index]);
  assert.equal((await f.request()).status, 403);
  const enable = { action: 'append', expected: { sequence: 0, digest: '' }, submissionId: 'enable', operation: { kind: 'enable' } };
  assert.equal((await f.request(enable)).status, 403); assert.equal(fs.existsSync(path.join(f.folder, 'review-data')), false);
  globalThis.__piAllowedRootsCache.roots = new Set([f.folder]);
  assert.equal((await f.request(enable, { origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await f.request('{"action":"inspect","action":"append","stepId":"toString"}')).status, 400);
  assert.equal((await f.request({ ...enable, forged: 'field' })).status, 400);
  assert.equal((await f.request(enable)).status, 200);
  assert.equal((await f.request()).body.sequence, 1, 'separate request restores native persisted history');
  assert.equal((await f.request({ ...enable, operation: { kind: 'import', batchId: 'batch', digest: 'a'.repeat(64), reply: { version: 1, batchId: 'batch', items: [] } } })).status, 400);
});
test('captured folder identity is reauthorized after async request body before any filesystem effects', async t => {
  let enter, release, pending;
  t.after(async () => { release?.(); if (pending) { const response = await pending; if (!response.bodyUsed) await response.text(); } });
  const f = fixture(t);
  const entered = new Promise(resolve => enter = resolve), gate = new Promise(resolve => release = resolve);
  const body = new ReadableStream({ async start(controller) { await gate; controller.enqueue(new TextEncoder().encode(JSON.stringify({ action: 'append', expected: { sequence: 0, digest: '' }, submissionId: 'enable', operation: { kind: 'enable' } }))); controller.close(); } });
  const request = new NextRequest(f.url, { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, body, duplex: 'half' });
  Object.defineProperty(request, 'body', { get() { enter(); return body; } });
  pending = POST(request);
  await entered;
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'sentinel'), 'untouched');
  fs.renameSync(f.folder, path.join(f.root, 'parked')); fs.symlinkSync(outside, f.folder);
  release(); const response = await pending; const result = await response.json();
  assert.notEqual(response.status, 200); assert.match(result.error, /unsafe|denied|identity/);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
});
