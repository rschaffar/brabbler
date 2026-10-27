import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { loadBackend, backendCase } from '../../../lib/backend-ownership.fixture.mjs';

async function fixture(t, produce) {
  const owner = backendCase(t), streams = [];
  const loadedFileBody = await loadBackend(new URL('../../../lib/file-body-stream.ts', import.meta.url), {
    fs: { createReadStream(file, range) {
      owner.admit();
      const stream = new EventEmitter();
      stream.destroyed = false;
      stream.destroy = () => { stream.destroyed = true; };
      streams.push(stream);
      if (produce) queueMicrotask(() => { if (!stream.destroyed) produce(stream, range); });
      return stream;
    } }, path,
  });
  owner.release(() => { for (const stream of streams) stream.destroy(); });
  return { ...loadedFileBody, streams, owner };
}
test('file body streams preserve binary chunks and encode string chunks as UTF-8', async t => {
  const f = await fixture(t);
  const body = f.createFileBodyStream('fixture.bin');
  const response = new Response(body);
  f.owner.release(() => !response.bodyUsed ? response.body.cancel() : undefined);
  const stream = f.streams[0];
  stream.emit('data', Buffer.from([0, 255, 128])); stream.emit('data', 'Grüße'); stream.emit('end');
  const bytes = Buffer.from(await f.owner.work(response.arrayBuffer()));
  assert.deepEqual(bytes, Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from('Grüße')]));
  assert.equal(stream.destroyed, false);
});

test('single-range responses preserve exact bytes, headers and cancellation ownership', async t => {
  const f = await fixture(t, (stream, range) => {
    stream.emit('data', Buffer.from([0, 1, 2, 255, 4, 5]).subarray(range?.start ?? 0, (range?.end ?? 5) + 1));
    stream.emit('end');
  });
  for (const [range, status, expected, contentRange] of [
    [null, 200, [0, 1, 2, 255, 4, 5], null],
    ['bytes=1-3', 206, [1, 2, 255], 'bytes 1-3/6'],
    ['bytes=3-', 206, [255, 4, 5], 'bytes 3-5/6'],
    ['bytes=-2', 206, [4, 5], 'bytes 4-5/6'],
    ['bytes=4-999', 206, [4, 5], 'bytes 4-5/6'],
  ]) {
    const response = f.streamFile('take.wav', { size: 6 }, 'audio/wav', range);
    f.owner.release(() => !response.bodyUsed ? response.body.cancel() : undefined);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-range'), contentRange);
    assert.equal(response.headers.get('content-length'), String(expected.length));
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual([...new Uint8Array(await f.owner.work(response.arrayBuffer()))], expected);
  }
  for (const range of ['bytes=9-', 'bytes=4-2', 'bytes=0-1,3-4', 'items=0-1', 'bytes=-0']) {
    const before = f.streams.length;
    const response = f.streamFile('take.wav', { size: 6 }, 'audio/wav', range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */6');
    assert.equal(f.streams.length, before, 'invalid ranges never acquire a file stream');
    await f.owner.work(response.arrayBuffer());
  }
  const response = f.streamFile('take.wav', { size: 6 }, 'audio/wav', 'bytes=0-');
  const stream = f.streams.at(-1);
  await response.body.cancel();
  assert.equal(stream.destroyed, true);
  stream.emit('data', Buffer.from([1])); stream.emit('error', new Error('late cancelled stream'));
});

test('SVG restrictive headers survive full, partial and both 416 response shapes', async t => {
  const f = await fixture(t, stream => stream.emit('end'));
  for (const type of ['image/svg+xml', 'audio/wav']) for (const range of [null, 'bytes=1-3', 'items=0-1', 'bytes=9-']) {
    const response = f.streamFile('name.svg', { size: 6 }, type, range);
    f.owner.release(() => !response.bodyUsed ? response.body?.cancel() : undefined);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), type);
    assert.equal(response.headers.get('content-security-policy'), type === 'image/svg+xml'
      ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" : null);
    assert.equal(response.headers.get('referrer-policy'), type === 'image/svg+xml' ? 'no-referrer' : null);
    await f.owner.work(response.arrayBuffer());
  }
});
test('stream errors reject the full body and late events cannot revive it', async t => {
  const f = await fixture(t);
  const response = f.streamFile('fixture.bin', { size: 6 }, 'application/octet-stream', null);
  const failure = new Error('fixture read failure');
  const consumed = f.owner.work(assert.rejects(response.arrayBuffer(), error => error === failure));
  f.streams[0].emit('error', failure);
  await consumed;
  f.streams[0].emit('data', Buffer.from('late')); f.streams[0].emit('end');
});


test('default file-body composition joins actual descriptor closure on EOF, cancellation and read error', async t => {
  const owner = backendCase(t), root = await mkdtemp(path.join(tmpdir(), 'brabbler-file-body-'));
  owner.remove(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'native.bin'); await writeFile(file, Buffer.from([0, 255, 128, 3, 4, 5]));
  const streams = [], closed = [];
  const nativeFileBody = await loadBackend(new URL('../../../lib/file-body-stream.ts', import.meta.url), {
    fs: { ...fs, createReadStream(...args) {
      const stream = fs.createReadStream(...args); streams.push(stream);
      closed.push(new Promise(resolve => stream.once('close', resolve)));
      return stream;
    } }, path,
  });
  owner.release(() => { for (const stream of streams) stream.destroy(); });
  owner.join(() => Promise.all(closed));
  const complete = nativeFileBody.streamFile(file, { size: 6 }, 'application/octet-stream', 'bytes=1-3');
  assert.deepEqual([...new Uint8Array(await owner.work(complete.arrayBuffer()))], [255, 128, 3]);
  await closed[0]; assert.equal(streams[0].closed, true); assert.equal(streams[0].fd, null);
  const cancelled = nativeFileBody.streamFile(file, { size: 6 }, 'application/octet-stream', null);
  await cancelled.body.cancel(); await closed[1]; assert.equal(streams[1].closed, true); assert.equal(streams[1].fd, null);
  const missing = nativeFileBody.streamFile(path.join(root, 'missing'), { size: 6 }, 'application/octet-stream', null);
  await owner.work(assert.rejects(missing.arrayBuffer(), { code: 'ENOENT' }));
  await closed[2]; assert.equal(streams[2].closed, true); assert.equal(streams[2].fd, null);
});
