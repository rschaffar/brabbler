import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { guidedRuntime } from './guided-reader.fixture.mjs';
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const fence = (language, value) => '```' + language + '\n' + JSON.stringify(value) + '\n```\n';
const index = { version: 1, id: 'guide', title: 'Guided request review', chapters: [{ id: 'one', title: 'First chapter', path: 'first.md' }, { id: 'two', title: 'Second chapter', path: 'last.md' }] };
const header = { version: 1, id: 'source', title: 'Pinned source' };
const source = { ...header, kind: 'source', cwd: '/repo', branch: 'feature', oid: 'a'.repeat(40), path: 'code.txt', start: 1, end: 2 };
const file = { ...header, id: 'file', title: 'Working notes', kind: 'file', path: 'notes.txt' };
const web = { ...header, id: 'web', title: 'External reference', kind: 'web', url: 'https://example.test/reference' };
const compare = { ...header, id: 'range', title: 'Feature range', kind: 'compare', cwd: '/other', branch: 'feature', base: 'b'.repeat(40), candidate: 'c'.repeat(40), path: 'changed.txt' };
const notebook = { index, chapters: [
  { ...index.chapters[0], steps: [{ id: 'first', title: 'Inspect ordering', markdown: 'Read the [notes](notes.txt).', targets: [source, file, web, compare] }] },
  { ...index.chapters[1], steps: [{ id: 'last', title: 'Check failures', markdown: 'Last chapter prose.', targets: [{ ...web, id: 'last-web' }] }] },
] };
const folder = { index: '/guide/index.md' };
const log = target => ({ cwd: target.cwd, branch: target.branch, op: 'log' });
async function production() { return { ...await jiti.import('./GuidedReviewReader.tsx'), ...await jiti.import('../hooks/useI18n.tsx') }; }
function button(view, label) { const node = [...view.container.querySelectorAll('button')].find(n => n.textContent === label); assert.equal(!!node, true, label); return node; }
async function click(view, label) { await view.dispatch(button(view, label), new view.window.MouseEvent('click', { bubbles: true, cancelable: true })); }
async function choose(view, label, value) { const field = view.container.querySelector(`select[aria-label="${label}"]`); assert.equal(!!field, true); field.value = value; await view.dispatch(field, new view.window.Event('change', { bubbles: true })); }

test('ordinary large Markdown is not diagnosed or activated as an oversized notebook', async t => {
  const runtime = guidedRuntime(t);
  const { GuidedReviewEntry, I18nProvider } = await production();
  const view = await runtime.mount(createElement(I18nProvider, null, createElement(GuidedReviewEntry, {
    filePath: '/guide/ordinary.md', markdown: 'Ordinary content.\n'.repeat(20_000), onWork: runtime.onWork,
  }, createElement('p', null, 'Ordinary document'))));
  assert.equal(view.container.textContent, 'Ordinary document');
  assert.equal(runtime.requests.length, 0);
  runtime.healthy();
});

test('production file entry is inert; selected evidence, two panes, exploration and free cross-file steps retain current focus/identity', async t => {
  const runtime = guidedRuntime(t);
  const { GuidedReviewEntry, I18nProvider } = await production();
  let props = { filePath: folder.index, cwd: '/guide', markdown: fence('brabbler-notebook', index), onWork: runtime.onWork };
  const element = () => createElement(I18nProvider, null, createElement(GuidedReviewEntry, props, createElement('p', null, 'Ordinary document')));
  const view = await runtime.mount(element());
  assert.equal(runtime.requests.length, 0, 'ordinary mount has no folder/Git reads');
  assert.match(view.container.textContent, /Ordinary document/);
  const replay = runtime.expect('/api/review-notebook', folder), current = runtime.expect('/api/review-notebook', folder);
  await click(view, 'Start guided reading');
  assert.equal(replay.signal.aborted, true);
  const oldLog = runtime.expect('/api/git/explorer', log(source)), liveLog = runtime.expect('/api/git/explorer', log(source));
  await current.deliver(notebook);
  assert.equal(view.window.document.activeElement.textContent, 'Inspect ordering');
  assert.equal(runtime.requests.length, 4, 'only first selected target reads');
  const oldAsset = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  const asset = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  await choose(view, 'Evidence target', 'file');
  assert.equal(liveLog.signal.aborted, true);
  await asset.deliver({ content: 'Current working notes', mutable: true });
  await liveLog.deliver({ head: source.oid }); await oldLog.reject(new Error('obsolete log error after ignored abort'));
  await replay.deliver({ ...notebook, index: { ...index, title: 'OBSOLETE FOLDER' } });
  assert.match(view.container.textContent, /Current working notes/); assert.doesNotMatch(view.container.textContent, /OBSOLETE/);
  await choose(view, 'Second evidence target', 'web');
  assert.equal(view.container.querySelectorAll('.guided-evidence').length, 2);
  assert.equal(view.container.querySelector('.guided-evidence a').getAttribute('href'), web.url);
  assert.equal(runtime.requests.length, 6, 'second web target never fetches or embeds');
  await oldAsset.reject(new Error('obsolete asset body error'));
  const exploreReplay = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  const explore = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  await view.dispatch([...view.container.querySelectorAll('a')].find(a => a.textContent === 'notes'), new view.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await explore.deliver({ content: 'Exploration snapshot' });
  assert.match(view.container.textContent, /Exploration snapshot/);
  const returnReplay = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  const returned = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  await click(view, 'Return to current step'); await returned.deliver({ content: 'Returned notes' });
  assert.equal(view.window.document.activeElement.textContent, 'Inspect ordering');
  assert.equal(view.container.querySelector('select[aria-label="Evidence target"]').value, 'file');
  assert.equal(view.container.querySelector('select[aria-label="Second evidence target"]').value, 'web');
  await exploreReplay.deliver({ content: 'obsolete exploration' }); await returnReplay.deliver({ content: 'obsolete replay' });
  await click(view, 'Next');
  assert.equal(view.window.document.activeElement.textContent, 'Check failures');
  assert.equal(view.container.querySelector('[aria-current="step"]').textContent, 'Check failures');
  assert.equal(view.container.querySelectorAll('.guided-evidence').length, 1);
  const backNotesReplay = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' }), backNotes = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  await click(view, 'Back');
  assert.equal(view.container.querySelector('select[aria-label="Evidence target"]').value, 'file');
  assert.equal(view.container.querySelector('select[aria-label="Second evidence target"]').value, 'web');
  await backNotes.deliver({ content: 'Retained notes selection' }); await backNotesReplay.deliver({ content: 'obsolete replay' });
  const backReplay = runtime.expect('/api/git/explorer', log(source)), backLog = runtime.expect('/api/git/explorer', log(source));
  await choose(view, 'Evidence target', 'source');
  const excerpt = runtime.expect('/api/git/explorer', { ...log(source), op: 'source', oid: source.oid, head: source.oid, path: source.path, start: '1', end: '2' });
  await backLog.deliver({ head: source.oid });
  await excerpt.deliver({ oid: source.oid, path: source.path, start: 1, end: 2, totalLines: 2, contents: 'Immutable first\nImmutable second' });
  assert.match(view.container.textContent, /Immutable first/);
  assert.equal(view.container.querySelector('.review-notebook-source-line > span').textContent, '1');
  await click(view, 'Return to document');
  assert.equal(backReplay.signal.aborted, true); await backReplay.deliver({ head: source.oid });
  assert.equal(view.window.document.activeElement.textContent, 'Start guided reading');
  assert.match(view.container.textContent, /Ordinary document/);
  assert.equal(view.container.querySelector('.guided-reader') === null, true);
  // A new originating context also unmounts, never rebinding the old step to another cwd.
  props = { ...props, cwd: '/other-context' }; await view.rerender(element());
  runtime.healthy();
});

test('ACTIVE cwd/index changes fence pending folder/evidence bodies, including success and error after ignored abort', async t => {
  const runtime = guidedRuntime(t), { GuidedReviewReader, I18nProvider } = await production();
  let props = { indexPath: folder.index, cwd: '/one', onClose() {}, onWork: runtime.onWork };
  const element = () => createElement(I18nProvider, null, createElement(GuidedReviewReader, props));
  const oldReplay = runtime.expect('/api/review-notebook', folder), old = runtime.expect('/api/review-notebook', folder);
  const view = await runtime.mount(element());
  const currentReplay = runtime.expect('/api/review-notebook', folder), current = runtime.expect('/api/review-notebook', folder);
  props = { ...props, cwd: '/two' }; await view.rerender(element());
  assert.equal(old.signal.aborted, true); await old.deliver(notebook); await oldReplay.reject(new Error('obsolete cwd folder body'));
  assert.equal(runtime.requests.length, 4, 'no Git follow-on from old folder success');
  const assetReplay = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' }), asset = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.txt' });
  await current.deliver({ ...notebook, chapters: [{ ...notebook.chapters[0], steps: [{ ...notebook.chapters[0].steps[0], targets: [file] }] }] });
  const nextFolder = { index: '/other/index.md' }, nextReplay = runtime.expect('/api/review-notebook', nextFolder), next = runtime.expect('/api/review-notebook', nextFolder);
  props = { ...props, indexPath: nextFolder.index }; await view.rerender(element());
  assert.equal(asset.signal.aborted, true); await asset.deliver({ content: 'OBSOLETE EVIDENCE' }); await assetReplay.reject(new Error('obsolete asset error'));
  await currentReplay.deliver(notebook);
  await next.deliver({ ...notebook, chapters: [notebook.chapters[1]] });
  await nextReplay.reject(new Error('obsolete latest replay'));
  assert.equal(view.window.document.activeElement.textContent, 'Check failures');
  assert.doesNotMatch(view.container.textContent, /OBSOLETE|obsolete/);
  assert.equal(runtime.requests.length, 8, 'only current selected web evidence, no reads');
  runtime.healthy();
});

test('quoted brabbler-review examples in guided prose and local Markdown assets remain literal, never undeclared expandable cards', async t => {
  const runtime = guidedRuntime(t), { GuidedReviewReader, I18nProvider } = await production();
  const quoted = fence('brabbler-review', source).trimEnd().split('\n').map(line => '> ' + line).join('\n');
  const replay = runtime.expect('/api/review-notebook', folder), current = runtime.expect('/api/review-notebook', folder);
  const view = await runtime.mount(createElement(I18nProvider, null, createElement(GuidedReviewReader, { indexPath: folder.index, onClose() {}, onWork: runtime.onWork })));
  const assetReplay = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.md' }), asset = runtime.expect('/api/review-notebook', { ...folder, asset: 'notes.md' });
  await current.deliver({ ...notebook, chapters: [{ ...notebook.chapters[0], steps: [{ id: 'example', title: 'Literal examples', markdown: quoted, targets: [{ ...file, path: 'notes.md' }] }] }] });
  await asset.deliver({ content: fence('brabbler-review', source) }); await assetReplay.deliver({ content: 'obsolete' }); await replay.deliver(notebook);
  assert.equal(view.container.querySelectorAll('[data-review-stop]').length, 0);
  assert.equal(view.container.querySelectorAll('.guided-prose blockquote code').length, 1);
  assert.match(view.container.querySelector('.guided-file-evidence').textContent, /Pinned source/);
  assert.equal([...view.container.querySelectorAll('button')].some(n => /Expand source/.test(n.textContent)), false);
  assert.equal(runtime.requests.every(request => request.path === '/api/review-notebook'), true);
  runtime.healthy();
});

test('selected image/PDF owns typed blob URLs only; stale bodies cannot load media or overwrite current MIME errors', async t => {
  const runtime = guidedRuntime(t), { GuidedReviewReader, I18nProvider } = await production();
  const image = { ...file, id: 'image', title: 'Diagram image', path: 'assets/image.png' }, pdf = { ...file, id: 'pdf', title: 'Reference PDF', path: 'assets/report.pdf' };
  const replay = runtime.expect('/api/review-notebook', folder), current = runtime.expect('/api/review-notebook', folder);
  const view = await runtime.mount(createElement(I18nProvider, null, createElement(GuidedReviewReader, { indexPath: folder.index, onClose() {}, onWork: runtime.onWork })));
  await current.deliver({ ...notebook, chapters: [{ ...notebook.chapters[0], steps: [{ ...notebook.chapters[0].steps[0], targets: [web, image, pdf] }] }] }); await replay.deliver(notebook);
  assert.equal(runtime.requests.length, 2); assert.equal(view.container.querySelector('img, iframe') === null, true);
  const imageReplay = runtime.expect('/api/review-notebook', { ...folder, asset: image.path }, 200, 'blob'), imageRead = runtime.expect('/api/review-notebook', { ...folder, asset: image.path }, 200, 'blob');
  await choose(view, 'Evidence target', 'image');
  const pdfReplay = runtime.expect('/api/review-notebook', { ...folder, asset: pdf.path }, 200, 'blob'), pdfRead = runtime.expect('/api/review-notebook', { ...folder, asset: pdf.path }, 200, 'blob');
  await choose(view, 'Evidence target', 'pdf');
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  await imageRead.deliver(png); await imageReplay.reject(new Error('obsolete image body'));
  const pdfBlob = new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
  await pdfReplay.deliver(pdfBlob); await pdfRead.deliver(pdfBlob); await runtime.join();
  const src = view.container.querySelector('iframe').getAttribute('src');
  assert.equal(runtime.objectUrls.get(src).type, 'application/pdf'); assert.match(src, /^blob:https:\/\/fixture.invalid\//);
  assert.equal(view.container.querySelector('a[download]').getAttribute('href'), src); assert.match(view.container.textContent, /Mutable working asset/);
  await choose(view, 'Evidence target', 'web'); assert.deepEqual(runtime.revokedUrls, [src]); assert.equal(runtime.objectUrls.size, 0);
  const mismatchReplay = runtime.expect('/api/review-notebook', { ...folder, asset: image.path }, 200, 'blob'), mismatch = runtime.expect('/api/review-notebook', { ...folder, asset: image.path }, 200, 'blob');
  await choose(view, 'Evidence target', 'image');
  await mismatch.deliver(new Blob(['<svg onload="unsafe()"/>'], { type: 'image/svg+xml' }));
  await mismatchReplay.deliver(png); await runtime.join();
  assert.match(view.container.querySelector('[role="alert"]').textContent, /MIME or byte limit mismatch/);
  assert.equal(runtime.objectUrls.size, 0); assert.equal(view.container.querySelector('img, iframe') === null, true);
  await choose(view, 'Evidence target', 'web');
  const finalReplay = runtime.expect('/api/review-notebook', { ...folder, asset: image.path }, 200, 'blob'), finalRead = runtime.expect('/api/review-notebook', { ...folder, asset: image.path }, 200, 'blob');
  await choose(view, 'Evidence target', 'image'); await finalReplay.deliver(png); await finalRead.deliver(png); await runtime.join();
  const rendered = view.container.querySelector('img');
  assert.equal(runtime.objectUrls.get(rendered.getAttribute('src')).type, 'image/png');
  assert.equal(rendered.style.maxWidth, '100%'); assert.equal(rendered.closest('button').getAttribute('aria-haspopup'), 'dialog', 'actual shared ImagePreview trigger');
  await view.unmount(); assert.equal(runtime.objectUrls.size, 0, 'unmount releases the selected native-resource URL');
  runtime.healthy();
});

test('comparison capture/patch identities and obsolete success/error cannot replace current target or current failure', async t => {
  const runtime = guidedRuntime(t);
  const { GuidedReviewReader, I18nProvider } = await production();
  const small = { ...notebook, chapters: [{ ...notebook.chapters[0], steps: [{ ...notebook.chapters[0].steps[0], targets: [compare, web] }] }] };
  const folderReplay = runtime.expect('/api/review-notebook', folder), folderRead = runtime.expect('/api/review-notebook', folder);
  const view = await runtime.mount(createElement(I18nProvider, null, createElement(GuidedReviewReader, { indexPath: folder.index, onClose() {}, onWork: runtime.onWork })));
  const logReplay = runtime.expect('/api/git/explorer', log(compare)), oldLog = runtime.expect('/api/git/explorer', log(compare));
  await folderRead.deliver(small);
  const pairQuery = { cwd: compare.cwd, branch: compare.branch, op: 'compare', head: compare.candidate, base: compare.base, candidate: compare.candidate };
  const oldPair = runtime.expect('/api/git/explorer', pairQuery);
  await oldLog.deliver({ head: compare.candidate });
  await choose(view, 'Evidence target', 'web');
  await oldPair.deliver({ identity: '1'.repeat(64) });
  assert.equal(runtime.requests.length, 5, 'obsolete comparison success cannot start a patch read');
  const newReplay = runtime.expect('/api/git/explorer', log(compare)), newLog = runtime.expect('/api/git/explorer', log(compare));
  await choose(view, 'Evidence target', 'range');
  const pair = runtime.expect('/api/git/explorer', pairQuery);
  await newLog.deliver({ head: compare.candidate });
  const patch = runtime.expect('/api/git/explorer', { ...pairQuery, op: 'compare-patch', identity: '2'.repeat(64), path: compare.path }, 409);
  await pair.deliver({ identity: '2'.repeat(64) });
  await patch.deliver({ error: 'Current repository identity changed' });
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Current repository identity changed/);
  await oldLog.arrived.promise;
  await logReplay.reject(new Error('obsolete comparison log error'));
  await newReplay.deliver({ head: 'd'.repeat(40) });
  await folderReplay.deliver({ ...small, index: { ...index, title: 'OBSOLETE' } });
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Current repository identity changed/);
  assert.equal(view.container.querySelector('select[aria-label="Evidence target"]').value, 'range');
  runtime.healthy();
});
