import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { GET, POST } = await jiti.import('./route.ts');

test('retired GET and POST never inspect request bodies, notebook paths or saved history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const history = path.join(root, 'review-data', 'reviewer'); fs.mkdirSync(history, { recursive: true });
  const file = path.join(history, '0000000001.json'), bytes = Buffer.from('{malformed historical bytes'); fs.writeFileSync(file, bytes);
  const original = fs.readFileSync(file);
  const attempts = [];
  // Guard actual native filesystem entry points after loading the production route.
  // The retired endpoint must not even probe these invalid/sensitive-looking paths.
  const names = ['readFileSync', 'openSync', 'statSync', 'lstatSync', 'readdirSync', 'writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync'];
  const saved = new Map(names.map(name => [name, fs[name]]));
  try {
    for (const name of names) fs[name] = (...args) => { attempts.push([name, String(args[0])]); throw new Error('Retired endpoint attempted filesystem access'); };
    for (const handler of [GET, POST]) for (const index of [path.join(root, 'index.md'), '/outside/unavailable/index.md']) {
      const request = new Request(`http://localhost/api/review-data?${new URLSearchParams({ index })}`, { method: handler === POST ? 'POST' : 'GET', headers: { host: 'localhost' } });
      Object.defineProperty(request, 'body', { get() { throw new Error('Retired endpoint consumed a body'); } });
      request.json = request.text = () => { throw new Error('Retired endpoint parsed a body'); };
      const response = await handler(request), value = await response.json();
      assert.equal(response.status, 410); assert.equal(value.code, 'NOTEBOOK_RECORDING_RETIRED');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.deepEqual(attempts, []);
  } finally { for (const [name, original] of saved) fs[name] = original; }
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readdirSync(root), ['review-data']);
});

test('retirement does not weaken cross-origin request admission', async () => {
  for (const handler of [GET, POST]) {
    const response = await handler(new Request('http://localhost/api/review-data?index=/book/index.md', { method: handler === POST ? 'POST' : 'GET', headers: { host: 'localhost', origin: 'https://untrusted.invalid' } }));
    assert.equal(response.status, 403); await response.json();
  }
});
