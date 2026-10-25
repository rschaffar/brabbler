import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';
import { filesRuntime } from './files-runtime.fixture.mjs';
import { open, read, reader, denied, editable, click, button, expectEdit } from './file-viewer-harness.fixture.mjs';

// Intentional source retain: rendered-tree reuse is an import/performance
// obligation, not inferred from identical DOM after a re-render.
test('source trees retain component-local memoization, including line-number styling', async () => {
  const source = await readFile(new URL('./FileViewer.tsx', import.meta.url), 'utf8');
  assert.match(source, /const highlightedSource = useMemo\(/);
  assert.match(source, /const lightweightSourceLines = useMemo\(/);
  assert.match(source, /\[sourceLines, useLightweightSource, wrapLines\]/);
  assert.match(source, /style=\{FILE_LINE_NUMBER_STYLE\}/);
});

async function policy(t) {
  const runtime = filesRuntime();
  t.after(() => runtime.dispose());
  return createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false }).import('./FileViewer.tsx');
}

test('actual production source policy preserves the full old cutoff/mode/fallback/draft matrix', async t => {
  const { fileSourceView, fileViewerContent, SOURCE_HIGHLIGHT_MAX_LINES } = await policy(t);
  assert.equal(SOURCE_HIGHLIGHT_MAX_LINES, 1000);
  const large = { ...read('line\n'.repeat(1000)), language: 'text' };
  const decide = (data, displayMode, extra = {}) => fileSourceView({ data, displayMode, filePath: 'file.txt',
    sourceLines: fileViewerContent(data, extra.dirty ?? false, extra.draft, extra.initialLineTarget, extra.editing ?? false).split('\n'), ...extra });
  assert.equal(decide({ ...large, content: 'line\n'.repeat(999) }, 'source').useLightweightSource, false);
  assert.equal(decide(large, 'diff', { hasGitDiff: true }).useLightweightSource, false);
  assert.equal(decide(large, 'source', { hasGitDiff: true, isDeletedDiff: true }).useLightweightSource, false);
  for (const language of ['html', 'markdown']) assert.equal(decide({ ...large, language }, 'preview').useLightweightSource, false);
  assert.equal(decide(large, 'preview', { filePath: 'fixture.csv' }).useLightweightSource, false);
  for (const mode of ['source', 'diff', 'preview']) assert.equal(decide(large, mode).useLightweightSource, true, `${mode} keeps source fallback`);
  assert.equal(decide(large, 'source', { dirty: true, draft: { content: 'draft', baseline: 'old', revision: 'r' } }).useLightweightSource, false);
  const draft = { content: 'draft', baseline: 'old', revision: 'r' };
  for (const target of [undefined, { line: 2 }]) for (const editing of [false, true]) {
    assert.equal(fileViewerContent(large, true, draft, target, editing), !target || editing ? 'draft' : large.content);
    assert.equal(fileViewerContent(large, false, draft, target, editing), large.content);
  }
  for (const language of ['html', 'markdown']) assert.equal(decide({ ...large, language, truncated: true }, 'preview').useLightweightSource, true);
});

test('actual production grammar policy preserves every original demand input', async t => {
  const { fileSourceView } = await policy(t);
  const small = { ...read('line\n'.repeat(999)), language: 'tsx' };
  const eligible = (data = small, displayMode = 'source', extra = {}) => fileSourceView({ data, displayMode,
    filePath: 'fixture.tsx', sourceLines: (data?.content ?? '').split('\n'), ...extra }).demandGrammar;
  assert.equal(eligible(), true);
  assert.equal(eligible({ ...small, content: small.content + '\n' }), false);
  assert.equal(eligible(null), false);
  assert.equal(eligible({ ...small, language: 'text' }), false);
  assert.equal(eligible(small, 'diff', { hasGitDiff: true }), false);
  assert.equal(eligible(small, 'source', { editing: true }), false);
  for (const language of ['html', 'markdown']) {
    assert.equal(eligible({ ...small, language }, 'preview'), false);
    assert.equal(eligible({ ...small, language }, 'source', { filePath: 'preview.md', autoPreview: true }), false);
  }
  for (const ext of ['csv', 'tsv']) assert.equal(eligible(small, 'preview', { filePath: `table.${ext}` }), false);
  assert.equal(eligible(small, 'diff'), true);
});

for (const [path, language, truncated] of [
  ['/root/large.md', 'markdown', false], ['/root/prefix.md', 'markdown', true], ['/root/prefix.html', 'html', true],
]) test(`${path} mounts the actual large preview/fallback, not a calculated element replica`, async t => {
  const h = await open(t, { filePath: path });
  const content = '# saved\n' + 'line\n'.repeat(1000);
  await h.initial[1].deliver({ ...read(content, denied, language), truncated, nextOffset: content.length });
  await h.initial[0].deliver(read('obsolete'));
  const root = reader(h.view);
  if (!truncated) {
    assert.equal(button(root, 'Preview').getAttribute('aria-pressed'), 'true');
    assert.equal(Boolean(root.querySelector('.markdown-file-preview')), true);
    assert.equal(root.querySelector('.is-lightweight') === null, true);
    await click(h.view, button(root, 'Source'));
  }
  assert.equal(Boolean(root.querySelector('.is-lightweight')), true);
  assert.equal(root.querySelectorAll('.file-source-line').length, 1002);
  const number = root.querySelector('[data-line-number="1"] [aria-hidden]');
  assert.equal(number.textContent, '1'); assert.equal(number.style.width, '48px');
  assert.equal(number.style.fontVariantNumeric, 'tabular-nums');
  assert.equal(root.querySelector('.file-source-line-content').style.whiteSpace, 'pre');
  await click(h.view, root.querySelector('[aria-label="Enable word wrap"]'));
  assert.equal(root.querySelector('.file-source-line-content').style.whiteSpace, 'pre-wrap');
  h.runtime.assertHealthy();
});
// LocalFileLink's fourth-argument/menu contract is now exercised through the real
// mounted FileWorkspace in AppShell.file-viewer-state.test.mjs, not source text.

for (const [mode, wrapLines, lineBreaks] of [
  ['source', false, 999], ['source', false, 1000], ['diff', false, 1000], ['preview', false, 1000], ['source', true, 1000],
]) test(`real legacy line content/mode tuple ${mode}/${wrapLines}/${lineBreaks} retains exact Source fallback rows`, async t => {
  const h = await open(t, { initialState: { displayMode: mode, wrapLines, scrollTop: 0, scrollLeft: 0 } });
  await h.initial[1].deliver(read('line\n'.repeat(lineBreaks))); await h.initial[0].deliver(read('obsolete'));
  const root = reader(h.view), rows = root.querySelectorAll('.file-source-line');
  assert.equal(rows.length, lineBreaks + 1);
  assert.equal(Boolean(root.querySelector('.is-lightweight')), lineBreaks > 999);
  assert.equal(rows[0].dataset.lineNumber, '1');
  assert.equal(rows[0].querySelector('.file-source-line-content').textContent.replace(/\n$/, ''), 'line');
  assert.equal(rows[0].querySelector('.file-source-line-content').style.whiteSpace, wrapLines ? 'pre-wrap' : 'pre');
  assert.equal(h.grammarWorks.length, 0, 'plain fallback does not import grammars');
});

for (const [filePath, language, content, initialDisplayMode] of [
  ['/root/plain.txt', 'text', 'plain', undefined],
  ['/root/large.tsx', 'tsx', 'line\n'.repeat(1000), undefined],
  ['/root/page.html', 'html', '<h1>saved</h1>', undefined],
  ['/root/guide.md', 'markdown', '# saved', undefined],
  ['/root/table.csv', 'tsx', 'name,value\nx,y', 'preview'],
  ['/root/table.tsv', 'tsx', 'name\tvalue\nx\ty', 'preview'],
]) test(`real ${filePath} mode excludes grammar demand before any manual Source command`, async t => {
  const h = await open(t, { filePath, initialDisplayMode });
  assert.equal(h.grammarWorks.length, 0, 'loading shell has no grammar effect');
  await h.initial[1].deliver(read(content, denied, language)); await h.initial[0].deliver(read('obsolete'));
  assert.equal(h.grammarWorks.length, 0, 'actual hook never admits the excluded grammar operation');
  const root = reader(h.view);
  if (language === 'html' || language === 'markdown') {
    assert.equal(button(root, 'Preview').getAttribute('aria-pressed'), 'true');
    await click(h.view, button(root, 'Source'));
    assert.equal(h.grammarWorks.length, 1, 'manual bounded typed Source owns genuine demand');
    await h.joinGrammar();
    assert.equal(Boolean(root.querySelector('.file-source-view .token')), true, 'real package registration colors Source');
  }
  h.runtime.assertHealthy();
});

test('actual active bounded TSX Source demands the package only after current data and renders genuine tokens', async t => {
  const h = await open(t, { filePath: '/root/component.tsx' });
  assert.equal(h.grammarWorks.length, 0);
  const content = 'const answer = <span>ok</span>;';
  await h.initial[1].deliver(read(content, denied, 'tsx')); await h.initial[0].deliver(read('obsolete'));
  assert.equal(h.grammarWorks.length, 1, 'actual enabled hook, not a test-triggered loader call');
  await h.joinGrammar();
  const root = reader(h.view);
  assert.equal(Boolean(root.querySelector('.file-source-view .token')), true);
  assert.equal(root.querySelector('.file-source-line-content').textContent.replace(/\n$/, ''), content);
  h.runtime.assertHealthy();
});

test('a real seeded edit owner suppresses grammar demand and saved-line navigation never substitutes its draft', async t => {
  const draft = { content: 'draft', baseline: 'saved', revision: 'r1' };
  const h = await open(t, { filePath: '/root/a.tsx', initialDraft: draft }, { seed(store) {
    assert.equal(store.bind('reader', 'server-edit-identity'), true); store.draft('reader', draft);
  } });
  const edit = expectEdit(h.runtime, h.props);
  await h.initial[1].deliver(read('saved', editable, 'tsx')); await h.initial[0].deliver(read('obsolete'));
  await edit.deliver({ content: 'saved', revision: 'r1', writable: true, editIdentity: 'server-edit-identity' });
  const root = reader(h.view);
  assert.equal(root.querySelector('textarea').value, 'draft');
  assert.equal(h.grammarWorks.length, 0, 'editor is not a Source grammar consumer');
  await click(h.view, button(root, 'Edit'));
  assert.equal(h.grammarWorks.length, 1);
  await h.joinGrammar();
  assert.equal(root.querySelector('.file-source-line-content').textContent.replace(/\n$/, ''), 'draft');
  await h.render({ ...h.props, initialLineTarget: { line: 1 }, navigationId: 1 });
  assert.equal(root.querySelector('textarea') === null, true);
  assert.equal(root.querySelector('.file-source-line-content').textContent.replace(/\n$/, ''), 'saved');
  assert.match(root.textContent, /saved file|saved content/i);
  await click(h.view, button(root, 'Edit'));
  assert.equal(root.querySelector('textarea').value, 'draft');
  assert.equal(h.store.snapshot('reader').draft.content, 'draft');
});
