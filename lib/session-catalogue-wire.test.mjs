import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { encodeSessionCatalogue, decodeSessionCatalogue, readSessionCatalogueReply } = await jiti.import('./session-catalogue-wire.ts');
const json = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function row(id, extra = {}) {
  return { id, path: `/sessions/${id}.jsonl`, cwd: '/projects/shared-long-project-directory',
    created: '2026-01-01', modified: '2026-01-02', messageCount: 17,
    firstMessage: 'full prompt with a late search term '.repeat(400), ...extra };
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('lossless JSON round trip shares across fields without mutating canonical or wire rows', async () => {
  const text = ' \"\\\n\t😀漢字\u2028 '.repeat(400) + 'late-needle';
  const source = freeze([row('root', { firstMessage: text, name: '', archived: true, cwdState: 'missing', spawnedBy: 'creator', transient: false }),
    row('child', { firstMessage: text, name: undefined, detailsPending: true, parentSessionId: 'root',
      relation: { kind: 'subagent', parentSessionId: 'root', profile: 'Explore', description: text, status: 'paused' } }),
    row('fork', { firstMessage: '', relation: { kind: 'fork', originSessionId: 'root' }, branch: 'topic/branch', projectKey: 'stable-key', projectRoot: '/original/root' })]);
  const encoded = freeze(json(encodeSessionCatalogue(source)));
  assert.equal(encoded.format, 1); assert.equal(encoded.strings.filter(value => value === text).length, 1);
  assert.equal(encoded.rows[0].firstMessage, encoded.rows[1].relation.description, 'cross-slot dictionary sharing');
  const decoded = decodeSessionCatalogue(encoded);
  assert.deepEqual(decoded, json(source));
  assert.equal(decoded[1].messageCount, 17, 'ordinary numbers are not references');
  assert.equal(Object.hasOwn(decoded[1], 'name'), false, 'JSON absent name stays absent');
  assert.equal(decoded[0].name, '', 'empty name is not absence');
  decoded[1].relation.description = 'public mutation'; decoded[2].relation.originSessionId = 'changed';
  assert.deepEqual(decodeSessionCatalogue(encoded), json(source), 'row/relation copies isolate the transport');
  const reply = await readSessionCatalogueReply({ json: async () => ({ sessions: encoded, sessionListVersion: 8,
    runningSessionIds: ['child'], completionNotificationSuppressedSessionIds: ['root'] }) });
  assert.deepEqual(reply.sessions, json(source)); assert.equal(reply.sessionListVersion, 8);
  assert.deepEqual(reply.runningSessionIds, ['child']); assert.deepEqual(reply.completionNotificationSuppressedSessionIds, ['root']);
});

test('empty, unique and marginal catalogues keep the legacy array; old servers remain readable', async () => {
  for (const source of [[], [row('unique')], [row('a', { firstMessage: 'short' }), row('b', { firstMessage: 'other' })]]) {
    assert.equal(encodeSessionCatalogue(source), source, 'no envelope for unprofitable input');
    assert.deepEqual((await readSessionCatalogueReply({ json: async () => ({ sessions: source }) })).sessions, source);
  }
});

test('saving includes envelope and final index digit widths with escaped and Unicode text', () => {
  for (const count of [9, 10, 11, 99, 100, 101, 1001]) {
    const source = Array.from({ length: count }, (_, i) => row(`row-${i}`, {
      cwd: `unique-${i}`, firstMessage: `unique-${i}`, name: (`escaped-${i}-\\\"\n😀漢字`).repeat(8),
      relation: { kind: 'subagent', parentSessionId: 'root', profile: 'P', description: (`escaped-${i}-\\\"\n😀漢字`).repeat(8), status: 'completed' },
    }));
    const encoded = encodeSessionCatalogue(source);
    assert.equal(encoded.format, 1); assert.ok(bytes(encoded) < bytes(source), `net UTF-8 savings at ${count}`);
    assert.deepEqual(decodeSessionCatalogue(json(encoded)), source, `index width at ${count}`);
  }
});

test('rejects malformed version/table/rows and every invalid selected reference atomically', async () => {
  const wire = json(encodeSessionCatalogue([row('a'), row('b')])); assert.equal(wire.format, 1);
  const invalid = [null, {}, { ...wire, format: 2 }, { ...wire, strings: [1] }, { ...wire, rows: {} },
    { ...wire, rows: [null] }, { ...wire, rows: [{ ...wire.rows[0], id: 0 }] }];
  for (const value of [-1, 0.5, NaN, Infinity, wire.strings.length, null, {}, [], true]) {
    invalid.push({ ...wire, rows: [wire.rows[0], { ...wire.rows[1], firstMessage: value }] });
    invalid.push({ ...wire, rows: [{ ...wire.rows[0], relation: { kind: 'subagent', parentSessionId: 'a', profile: value, description: 0, status: 'completed' } }] });
  }
  invalid.push({ ...wire, rows: [{ ...wire.rows[0], relation: { kind: 'unknown' } }] });
  invalid.push({ ...wire, rows: [{ ...wire.rows[0], cwd: undefined }] });
  for (const value of invalid) {
    assert.throws(() => decodeSessionCatalogue(value), /Invalid compact session catalogue/);
    await assert.rejects(readSessionCatalogueReply({ json: async () => ({ sessions: value }) }), /Invalid compact session catalogue/);
  }
});

test('synthetic catalogue work removal records JSON and gzip separately, not latency', t => {
  const source = Array.from({ length: 1000 }, (_, i) => row(`fixture-${i}`, {
    firstMessage: `prompt-group-${i % 20}: ` + 'synthetic prompt with preserved full-text semantics '.repeat(150),
    projectRoot: '/projects/shared-long-project-directory', projectKey: '/projects/shared-long-project-directory',
  }));
  const encoded = encodeSessionCatalogue(source);
  const ordinary = JSON.stringify(source), compact = JSON.stringify(encoded);
  const result = { rows: source.length, ordinaryJsonBytes: Buffer.byteLength(ordinary), compactJsonBytes: Buffer.byteLength(compact),
    ordinaryGzipBytes: gzipSync(ordinary).byteLength, compactGzipBytes: gzipSync(compact).byteLength };
  t.diagnostic(JSON.stringify(result));
  assert.ok(result.compactJsonBytes < result.ordinaryJsonBytes * 0.1, 'actual synthetic JSON removes repeated prompts/project strings');
  assert.deepEqual(decodeSessionCatalogue(json(encoded)), source);
});
