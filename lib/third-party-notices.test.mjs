import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { collectNotices, verifySourceVersion } from '../nix/collect-notices.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'third-party-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modules = join(root, 'node_modules'), output = join(root, 'notices');
  mkdirSync(modules);
  function file(path, bytes) {
    const target = join(modules, path), parent = dirname(target);
    mkdirSync(parent, { recursive: true }); writeFileSync(target, bytes);
  }
  return { root, modules, output, file };
}

test('notice collection preserves bytes, nested ownership, deduplication and root-independent identities', t => {
  const a = fixture(t), b = fixture(t);
  const body = Buffer.from('Synthetic contributor\r\nPermission is granted. \r\n');
  const digest = createHash('sha256').update(body).digest('hex');
  for (const f of [a, b]) {
    f.file('outer/package.json', JSON.stringify({ name: 'next', version: '1.0.0', license: 'MIT' }));
    f.file('outer/LICENSE', body);
    f.file('outer/lib/COPYRIGHT.txt', body);
    f.file('outer/licenses/additional.txt', 'Synthetic additional terms');
    f.file('outer/node_modules/inner/package.json', JSON.stringify({ name: 'inner', version: '2.0.0', license: 'BSD-3-Clause' }));
    f.file('outer/node_modules/inner/NOTICE', 'Synthetic inner attribution');
    f.file('outer/dist/compiled/vendor/package.json', JSON.stringify({ name: 'vendor' }));
    f.file('outer/dist/compiled/vendor/LICENSE', body);
    f.file('outer/test/fixtures/package.json', '{ intentionally invalid fixture metadata');
    f.file('outer/test/fixtures/node_modules/ignored/package.json', 'invalid');
    f.file('outer/not-a-notice.txt', 'must not copy this');
    f.file('outer/ignored.js', 'throw new Error("must not execute dependency code")');
    symlinkSync(f.root, join(f.modules, 'directory-cycle'), 'dir');
  }
  const result = collectNotices(a.modules, a.output);
  assert.deepEqual(result, collectNotices(b.modules, b.output));
  assert.equal(result.components.length, 3);
  assert.deepEqual(result.components[0].notices.map(row => row.path), ['LICENSE', 'lib/COPYRIGHT.txt', 'licenses/additional.txt']);
  assert.equal(result.components[1].version, null);
  assert.equal(result.components[2].name, 'inner');
  assert.deepEqual(readFileSync(join(a.output, 'dependency-licenses', `${digest}.txt`)), body);
  const serialized = readFileSync(join(a.output, 'DEPENDENCIES.json'), 'utf8');
  assert.equal(serialized.includes(a.root), false);
  assert.equal(serialized.includes('not-a-notice'), false);
});

test('notice links can stay inside dependencies but never copy external files', t => {
  const f = fixture(t);
  f.file('package/package.json', JSON.stringify({ name: 'synthetic', version: '1.0.0' }));
  f.file('package/legal-body.txt', 'Synthetic legal text');
  symlinkSync('legal-body.txt', join(f.modules, 'package/LICENSE'));
  assert.equal(collectNotices(f.modules, f.output).components[0].notices.length, 1);
  writeFileSync(join(f.root, 'external.txt'), 'must not copy external bytes');
  symlinkSync(join(f.root, 'external.txt'), join(f.modules, 'package/NOTICE'));
  assert.throws(() => collectNotices(f.modules, join(f.root, 'refused')), /escapes/);
});

test('source-material version must match elkjs resolved from Mermaid', t => {
  const f = fixture(t);
  f.file('mermaid/package.json', JSON.stringify({ name: 'mermaid', version: '12.2.0' }));
  f.file('elkjs/package.json', JSON.stringify({ name: 'elkjs', version: '0.9.3' }));
  verifySourceVersion(f.modules, { components: { elkjs: '0.9.3' } });
  assert.throws(() => verifySourceVersion(f.modules, { components: { elkjs: '0.10.0' } }), /must match installed elkjs/);
});

test('notice writer refuses aliased module roots and output inside dependencies', t => {
  const f = fixture(t), alias = join(f.root, 'alias');
  symlinkSync(f.modules, alias, 'dir');
  assert.throws(() => collectNotices(alias, f.output), /physical dependency tree/);
  assert.throws(() => collectNotices(f.modules, join(f.modules, 'generated')), /outside dependencies/);
});
