import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { parseNotebookIndex, parseNotebookChapter, parseEvidence, stepProse, validateNotebook } = await jiti.import('./guided-review.ts');
const fence = (kind, value) => '```' + kind + '\n' + JSON.stringify(value) + '\n```\n';
const header = { version: 1, id: 'review', title: 'Review request handling' };
const manifest = { ...header, chapters: [{ id: 'flow', title: 'Flow', path: 'flow.md' }] };
const marker = fence('pi-step', header);
const source = { ...header, kind: 'source', cwd: '/repo', branch: 'feature', oid: 'a'.repeat(40), path: 'src/code.ts', start: 1, end: 3 };
test('actual Markdown parser recognizes only top-level structural fences and preserves authored prose', () => {
  assert.equal(parseNotebookIndex('Ordinary Markdown'), null);
  assert.equal(parseNotebookIndex('````markdown\n' + fence('pi-notebook', manifest) + '````'), null);
  assert.equal(parseNotebookIndex('> ```pi-notebook\n> {}\n> ```'), null);
  assert.deepEqual(parseNotebookIndex(fence('pi-notebook', manifest)), manifest);
  const text = marker + 'Inspect ordering.\n\n' + fence('pi-review', source) + '\n````markdown\n' + marker + '````\n';
  const [step] = parseNotebookChapter(text);
  assert.equal(step.id, 'review'); assert.deepEqual(step.targets, [source]);
  assert.match(stepProse(step.markdown), /Inspect ordering/);
  assert.doesNotMatch(stepProse(step.markdown), /pi-review/);
  assert.match(stepProse(step.markdown), /pi-step/, 'example fence remains inert prose');
});
test('strict authoring schemas reject unknown fields, duplicate IDs, versions, paths and cycles', () => {
  for (const extra of [{ version: 2 }, { commands: [] }, { id: '../bad' }, { title: '\n' }, { chapters: [] }, { chapters: Array(33).fill(manifest.chapters[0]) },
    ...['../secret.md', '/file.md', 'nested/../file.md', 'a\\b.md', 'index.md', 'INDEX.md', 'a//b.md'].map(path => ({ chapters: [{ ...manifest.chapters[0], path }] })),
    { chapters: [manifest.chapters[0], manifest.chapters[0]] }, { chapters: [manifest.chapters[0], { ...manifest.chapters[0], id: 'other', path: 'FLOW.md' }] }]) {
    assert.throws(() => parseNotebookIndex(fence('pi-notebook', { ...manifest, ...extra })), undefined, JSON.stringify(extra));
  }
  assert.throws(() => parseNotebookIndex(fence('pi-notebook', manifest).repeat(2)));
  assert.throws(() => parseNotebookChapter(marker.repeat(2)));
  assert.throws(() => parseNotebookChapter(fence('pi-review', source)));
  assert.throws(() => parseNotebookChapter(marker + fence('pi-notebook', manifest)));
  assert.throws(() => parseNotebookChapter(marker + 'x'.repeat(256 * 1024)));
  const steps = parseNotebookChapter(marker + fence('pi-review', source));
  assert.throws(() => validateNotebook({ index: manifest, chapters: [{ ...manifest.chapters[0], steps }, { id: 'two', steps }] }), /Duplicate package step/);
  assert.throws(() => validateNotebook({ index: manifest, chapters: [{ ...manifest.chapters[0], steps: [steps[0], { ...steps[0], id: 'other' }] }] }), /Duplicate package target/);
});
test('distinct bounded evidence contract cannot weaken pi-review v1 or imply network/execution', () => {
  const compare = { ...header, kind: 'compare', cwd: '/other/repo', branch: 'feature', base: 'b'.repeat(40), candidate: 'c'.repeat(40), path: 'code.ts' };
  assert.deepEqual(parseEvidence(JSON.stringify(compare)), compare);
  for (const fields of [{ base: 'HEAD~3' }, { candidate: 'main' }, { path: '../secret' }, { command: 'run' }, { cwd: 'relative' }]) assert.throws(() => parseEvidence(JSON.stringify({ ...compare, ...fields })));
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.test', '//example.test']) assert.throws(() => parseEvidence(JSON.stringify({ ...header, kind: 'web', url })));
  assert.equal(parseEvidence(JSON.stringify({ ...header, kind: 'web', url: 'https://example.test/docs' })).kind, 'web');
  for (const path of ['../secret.txt', 'page.html', 'code.mdx', 'page.svg', 'remote.png?fetch=true']) assert.throws(() => parseEvidence(JSON.stringify({ ...header, kind: 'file', path })));
  for (const path of ['assets/spec.md', 'data.csv', 'data.tsv', 'trace.json', 'diagram.mmd', 'notes.txt', 'assets/image.png', 'image.jpeg', 'image.gif', 'image.webp', 'assets/report.pdf']) assert.equal(parseEvidence(JSON.stringify({ ...header, kind: 'file', path })).path, path);
  assert.throws(() => parseNotebookChapter(marker + fence('pi-review', { ...source, base: compare.base })), /Unknown review/);
});

test('all guided metadata rejects duplicate decoded properties, including unchanged pi-review targets, with bounded nesting/bytes', async () => {
  const rawFence = (kind, json) => '```' + kind + '\n' + json + '\n```\n';
  const repeated = (value, key) => JSON.stringify(value).replace('{', '{' + JSON.stringify(key) + ':"poison",');
  assert.throws(() => parseNotebookIndex(rawFence('pi-notebook', repeated(manifest, 'id'))), /Duplicate metadata/);
  const nested = JSON.stringify(manifest).replace('"id":"flow"', '"id":"other","id":"flow"');
  assert.throws(() => parseNotebookIndex(rawFence('pi-notebook', nested)), /Duplicate metadata/);
  const comparison = { ...header, kind: 'compare', cwd: '/repo', branch: 'main', base: 'a'.repeat(40), candidate: 'b'.repeat(40), path: 'code.ts' };
  assert.throws(() => parseEvidence(repeated(comparison, 'base')), /Duplicate metadata/);
  assert.throws(() => parseNotebookChapter(marker + rawFence('pi-review', repeated(source, 'oid'))), /Duplicate metadata/);
  const escapedKey = JSON.stringify(comparison).replace('"base":', '"ba\\u0073e":"poison","base":');
  assert.throws(() => parseEvidence(escapedKey), /Duplicate metadata/);
  const depth = '{"version":1,"id":"deep","title":"Deep","extra":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}';
  assert.throws(() => parseEvidence(depth), /nesting depth/);
  assert.throws(() => parseEvidence(JSON.stringify({ ...header, title: 'é'.repeat(9000) })), /16,384 bytes/);
  // Quote/colon/bracket text in string values must not be interpreted as keys/scopes.
  const tricky = { ...header, title: 'Quoted "id":"not a key" \\ { [ still text ] }', kind: 'file', path: 'notes.txt' };
  assert.deepEqual(parseEvidence(JSON.stringify(tricky)), tricky);
  const { parseReviewBlock } = await jiti.import('./review-notebook.ts');
  assert.deepEqual(parseReviewBlock(repeated(source, 'oid')).value, source, 'standalone v1 behavior remains unchanged');
});

test('activation-local reader state retains exact per-target file models and bounds the LRU without authority', async () => {
  const { GuidedReaderState } = await jiti.import('./guided-reader-state.ts');
  const state = new GuidedReaderState(), patch = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new\n';
  const a = state.target('full-reference-a'), model = a.review('f', patch, 'repository-a');
  model.query = 'needle'; model.reading = 'before'; model.full = true;
  a.mode = 'diff'; assert.equal(state.target('full-reference-a'), a);
  assert.equal(a.review('f', patch, 'repository-a'), model);
  assert.notEqual(a.review('f', patch, 'repository-b'), model, 'incarnations never borrow cached context');
  assert.notEqual(state.target('full-reference-b').review('f', patch, 'repository-a'), model, 'target identities never borrow reading state');
  assert.notEqual(a.review('g', patch, 'repository-a'), model, 'file paths remain independent');
  const step = state.step('step', 'first'); step.primary = 'chosen'; step.secondary = 'other';
  assert.deepEqual(state.step('step', 'ignored-default'), { primary: 'chosen', secondary: 'other' });
  for (let i = 0; i < 33; i++) state.target(`other-${i}`).review('f', patch);
  assert.notEqual(a.review('f', patch, 'repository-a'), model, 'bounded eviction is explicit');
  assert.notEqual(new GuidedReaderState().target('full-reference-a'), a, 'closing/reopening cannot retain stale activation state');
});
