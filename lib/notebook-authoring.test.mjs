import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const api = await createJiti(import.meta.url, { fsCache: false }).import('./notebook-authoring.ts');
const fence = (lang, value, nl = '\n') => '```' + lang + nl + JSON.stringify(value) + nl + '```' + nl;
const step = (id, prose, nl = '\n') => fence('brabbler-step', { version: 1, id, title: `Step ${id}` }, nl) + prose + nl + nl;
function fixture(t, nl = '\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-author-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const indexPath = path.join(root, 'index.md'), chapter = path.join(root, 'one.md'), second = path.join(root, 'two.md');
  const manifest = { version: 1, id: 'guide', title: 'Guide', chapters: [{ id: 'one', title: 'One', path: 'one.md' }, { id: 'two', title: 'Two', path: 'two.md' }] };
  const source = '\ufeffPreface é🦋' + nl + nl + step('first', 'First untouched', nl) + step('middle', 'Middle original', nl) + step('last', 'Last untouched', nl);
  fs.writeFileSync(indexPath, fence('brabbler-notebook', manifest, nl)); fs.writeFileSync(chapter, source); fs.writeFileSync(second, step('other', 'Other chapter', nl));
  const roots = new Set([root]), access = { roots, assertWrite() {} };
  const inspect = (id = 'middle') => api.inspectNotebook(indexPath, roots, id);
  const update = (selected, source, overrides = {}) => api.updateNotebookStep(indexPath, 'middle', selected.binding, source, { ...access, ...overrides });
  return { root, indexPath, chapter, second, manifest, roots, access, inspect, update, source };
}
for (const nl of ['\n', '\r\n']) test(`selected-step edit preserves BOM/Unicode and every outside byte (${JSON.stringify(nl)})`, t => {
  const f = fixture(t, nl), beforeOther = fs.readFileSync(f.second), beforeIndex = fs.readFileSync(f.indexPath);
  const outline = api.inspectNotebook(f.indexPath, f.roots);
  assert.equal(outline.selected, undefined); assert.equal(outline.chapters.length, 2);
  assert.deepEqual(outline.chapters[0].steps.map(s => s.id), ['first', 'middle', 'last']);
  const { selected } = f.inspect(); assert.match(selected.binding.chapterRevision, /^[a-f0-9]{64}$/);
  assert.equal(selected.source, step('middle', 'Middle original', nl));
  const replacement = selected.source.replace('Middle original', 'Updated λ🦋');
  const result = f.update(selected, replacement);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source.replace(selected.source, replacement));
  assert.deepEqual(fs.readFileSync(f.second), beforeOther); assert.deepEqual(fs.readFileSync(f.indexPath), beforeIndex);
  assert.equal(f.inspect().selected.binding.chapterRevision, result.revision);
  assert.equal(result.previousRevision, selected.binding.chapterRevision);
  assert.throws(() => f.update(selected, replacement), /inspect again/);
});
test('membership/manifest/step/chapter bindings are revalidated, not model authority', t => {
  const f = fixture(t), { selected } = f.inspect(), before = fs.readFileSync(f.chapter);
  for (const key of Object.keys(selected.binding)) {
    const forged = { ...selected, binding: { ...selected.binding, [key]: 'wrong' } };
    assert.throws(() => f.update(forged, selected.source), /inspect again/);
  }
  fs.writeFileSync(f.indexPath, fence('brabbler-notebook', { ...f.manifest, title: 'Changed manifest' }));
  assert.throws(() => f.update(selected, selected.source), /inspect again/);
  assert.deepEqual(fs.readFileSync(f.chapter), before);
});
test('manifest retargeting, renamed step and selected-chapter edit cannot redirect a stale operation', t => {
  const f = fixture(t), { selected } = f.inspect();
  fs.writeFileSync(path.join(f.root, 'copy.md'), f.source);
  fs.writeFileSync(f.indexPath, fence('brabbler-notebook', { ...f.manifest, chapters: [{ ...f.manifest.chapters[0], path: 'copy.md' }] }));
  assert.throws(() => f.update(selected, selected.source), /inspect again/);
  fs.writeFileSync(f.indexPath, fence('brabbler-notebook', f.manifest));
  fs.writeFileSync(f.chapter, f.source.replace('"id":"middle"', '"id":"moved"'));
  assert.throws(() => f.update(selected, selected.source), /Step not found/);
  fs.writeFileSync(f.chapter, f.source + '\nPeer text');
  assert.throws(() => f.update(selected, selected.source), /inspect again/);
});
test('same-ID move between chapters and invalidating peer edits refuse stale operations', t => {
  const f = fixture(t), { selected } = f.inspect();
  fs.writeFileSync(f.chapter, f.source.replace(selected.source, '')); fs.appendFileSync(f.second, selected.source);
  const moved = [fs.readFileSync(f.chapter), fs.readFileSync(f.second)];
  assert.throws(() => f.update(selected, selected.source), /inspect again/);
  assert.deepEqual([fs.readFileSync(f.chapter), fs.readFileSync(f.second)], moved);
  fs.writeFileSync(f.chapter, f.source);
  assert.throws(() => f.update(selected, selected.source), /Duplicate package step id/);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
for (const selectedId of ['first', 'last', 'sole']) for (const boms of [0, 1, 2, 3]) test(`exact ${selectedId} boundary preserves ${boms} leading BOMs and EOF`, t => {
  const f = fixture(t), preface = '\ufeff'.repeat(boms) + 'Preface é🦋\n\n';
  const neighboring = step('neighbor', 'Keep body') + fence('brabbler-evidence', { version: 1, kind: 'web', id: 'link', title: 'Link', url: 'https://example.test/' })
    + fence('brabbler-question', { version: 1, id: 'guidance', shortLabel: 'Guidance', question: 'Explain this', type: 'text' });
  const chosen = step(selectedId, 'Original body');
  const original = preface + (selectedId === 'last' ? neighboring : '') + chosen + (selectedId === 'first' ? neighboring : '');
  fs.writeFileSync(f.chapter, original.trimEnd());
  const before = fs.readFileSync(f.chapter, 'utf8'), selected = f.inspect(selectedId).selected;
  assert.equal(selected.source, selectedId === 'first' ? chosen : chosen.trimEnd());
  api.updateNotebookStep(f.indexPath, selectedId, selected.binding, selected.source.replace('Original body', 'Edited body'), f.access);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), before.replace('Original body', 'Edited body'));
});
test('a controlled native rename failure propagates, leaves original bytes and removes its temporary save', t => {
  const f = fixture(t), { selected } = f.inspect(), before = fs.readFileSync(f.chapter), names = fs.readdirSync(f.root);
  const fault = Object.assign(new Error('Controlled rename I/O failure'), { code: 'EIO' });
  const rename = t.mock.method(fs, 'renameSync', () => { throw fault; });
  try { assert.throws(() => f.update(selected, selected.source.replace('original', 'edited')), error => error === fault); }
  finally { rename.mock.restore(); }
  assert.deepEqual(fs.readFileSync(f.chapter), before); assert.deepEqual(fs.readdirSync(f.root), names);
});
test('fence escapes, new IDs, duplicate target IDs and malformed replacements preserve original files', t => {
  const f = fixture(t), { selected } = f.inspect(), before = fs.readFileSync(f.chapter);
  const target = { version: 1, kind: 'web', id: 'link', title: 'Link', url: 'https://example.test/' };
  for (const replacement of [selected.source + '~~~\n', selected.source.replace('"middle"', '"other"'), selected.source + step('extra', 'Unrequested'), selected.source + fence('brabbler-evidence', target) + fence('brabbler-evidence', target), 'Prose outside boundary\n' + selected.source, selected.source + '\0', selected.source + '\ud800']) {
    assert.throws(() => f.update(selected, replacement));
    assert.deepEqual(fs.readFileSync(f.chapter), before);
  }
});
test('quoted/longer-fenced step examples never become editable boundaries', t => {
  const f = fixture(t);
  fs.appendFileSync(f.second, '\n````markdown\n' + step('example', 'Not a real step') + '````\n');
  assert.equal(api.inspectNotebook(f.indexPath, f.roots).chapters[1].steps.length, 1);
  assert.throws(() => f.inspect('example'), /Step not found/);
});
test('denied roots, symlinks, read-only chapters and invalid packages fail closed', t => {
  const f = fixture(t), { selected } = f.inspect();
  assert.throws(() => api.inspectNotebook(f.indexPath, new Set()), /Access denied/);
  fs.symlinkSync(f.root, path.join(f.root, 'alias'), 'dir');
  assert.throws(() => api.inspectNotebook(path.join(f.root, 'alias', 'index.md'), f.roots), /symlinks|escapes/);
  fs.chmodSync(f.chapter, 0o444);
  assert.equal(f.inspect().selected.writable, false);
  assert.throws(() => f.update(selected, selected.source), /not writable/);
  fs.chmodSync(f.chapter, 0o644);
  fs.unlinkSync(f.second); fs.symlinkSync(f.chapter, f.second);
  assert.throws(() => f.inspect(), /symlinks|escapes/);
  fs.unlinkSync(f.second); fs.writeFileSync(f.second, Buffer.from([0xff]));
  assert.throws(() => f.inspect());
});
test('package inspection never needs assets or reads sidecars', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'review-data')); fs.writeFileSync(path.join(f.root, 'review-data', 'sentinel'), '{malformed');
  fs.appendFileSync(f.second, fence('brabbler-evidence', { version: 1, kind: 'file', id: 'missing', title: 'Unavailable asset', path: 'missing.txt' }));
  assert.equal(f.inspect('other').selected.references[0].path, 'missing.txt');
  const { selected } = f.inspect(); f.update(selected, selected.source.replace('original', 'edited'));
  assert.equal(fs.readFileSync(path.join(f.root, 'review-data', 'sentinel'), 'utf8'), '{malformed');
});
test('write capability is rechecked after package validation and saves never replay', t => {
  const f = fixture(t), { selected } = f.inspect(), before = fs.readFileSync(f.chapter); let checks = 0;
  assert.throws(() => f.update(selected, selected.source.replace('original', 'edited'), { assertWrite() { if (++checks === 2) throw new Error('Edit revoked'); } }), /Edit revoked/);
  assert.equal(checks, 2); assert.deepEqual(fs.readFileSync(f.chapter), before);
});
test('two cooperating same-revision saves have one winner, and report its actual revision', async t => {
  const f = fixture(t), { selected } = f.inspect();
  const results = await Promise.allSettled(['winner one', 'winner two'].map(text => Promise.resolve().then(() => f.update(selected, selected.source.replace('Middle original', text)))));
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(f.inspect().selected.binding.chapterRevision, results[0].value.revision);
  assert.match(fs.readFileSync(f.chapter, 'utf8'), /winner one/); assert.doesNotMatch(fs.readFileSync(f.chapter, 'utf8'), /winner two/);
});
