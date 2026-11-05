import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { packet, click, input, textButton } from './cards-git.fixture.mjs';
import { review, overview, page, preview, live, deliver, body } from './operation-review.fixture.mjs';
const patch = value => `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+${value}\n`;
const context = value => ({ oldFile: { name: 'file.txt', contents: 'old\n', cacheKey: 'old' }, newFile: { name: 'file.txt', contents: `${value}\n`, cacheKey: value } });
async function card(t) {
  const h = await packet(t, { review: true, cardDescendants: true });
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const request = { type: 'extension_ui_request', id: 'pending', method: 'plugin_card', pluginId: 'git-workflow', title: 'Git commit',
    operationId: review.operationId, review, patchBefore: 'HEAD', patchAfter: 'Proposed', actions: [{ id: 'approve', label: 'Approve commit', primary: true }] };
  await h.render(createElement(BlockingRequestCard, { request, sessionId: 'current', onReadWork: h.onReadWork, onRespond: () => assert.fail('reading is not authority') }));
  return { ...h, BlockingRequestCard, request };
}
test('renamed review navigation retains the numeric selection and renders a pure rename without hunks', async t => {
  const h = await card(t), root = h.view.container;
  await deliver(h, 'overview', overview(true, 'same'));
  await deliver(h, 'page', { files: [{ id: 0, path: 'new.txt', previousPath: 'old.txt', status: 'R' }], total: 1, next: null });
  assert.match(root.textContent, /old.txt → new.txt/); assert.match(root.textContent, /Renamed/);
  const request = live(h, 'preview'); assert.equal(request.url.searchParams.get('file'), '0');
  assert.equal(request.url.searchParams.has('path'), false); assert.equal(request.url.searchParams.has('previousPath'), false);
  const rename = 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n';
  await deliver(h, 'preview', preview(rename)); await h.settle();
  assert.match(root.textContent, /No text hunks in this patch/);
  await click(h.view, textButton(root, 'Before'));
  await body(h, live(h, 'context'), { oldFile: { name: 'old.txt', contents: 'same\n', cacheKey: 'old' },
    newFile: { name: 'new.txt', contents: 'same\n', cacheKey: 'new' } });
  await h.settle(); assert.ok(root.querySelector('[aria-label="Before file"]'));
  assert.ok(textButton(root, 'Approve commit'), 'viewing a rename does not decide the approval');
});

test('binary rename review retains both names and exact raw metadata without text controls', async t => {
  const h = await card(t), root = h.view.container;
  await deliver(h, 'overview', overview(true, 'same'));
  await deliver(h, 'page', { files: [{ id: 0, path: 'new.bin', previousPath: 'old.bin', status: 'R' }], total: 1, next: null });
  const raw = 'diff --git a/old.bin b/new.bin\nsimilarity index 98%\nrename from old.bin\nrename to new.bin\nBinary files a/old.bin and b/new.bin differ\n';
  await deliver(h, 'preview', preview(raw)); await h.settle();
  assert.match(root.textContent, /old.bin → new.bin/); assert.match(root.textContent, /Renamed/);
  assert.match(root.textContent, /Binary changes are summarized/);
  assert.equal(root.querySelector('[aria-label="File version"]'), null);
  assert.equal(root.querySelector('[aria-label="Raw patch"]').textContent, raw);
  assert.equal(h.requests.some(request => request.url.searchParams.get('op') === 'context'), false);
});

test('actual result defaults in the real card; same-view proposal switch cancels ignored-abort reads and labels come from selected metadata', async t => {
  const h = await card(t), root = h.view.container;
  await deliver(h, 'overview', overview(true, 'different'));
  assert.match(root.textContent, /Actual result/); assert.doesNotMatch(root.textContent, /unauthorized|violation/);
  await deliver(h, 'page', page('file.txt'));
  const stale = live(h, 'preview'); assert.equal(stale.url.searchParams.get('view'), 'result');
  await click(h.view, textButton(root, 'View original proposal')); assert.equal(stale.signal.aborted, true);
  await deliver(h, 'page', page('file.txt'));
  for (const read of h.requests.filter(read => read.status === undefined && read.url.searchParams.get('op') === 'preview' && read.url.searchParams.get('view') === 'proposal')) await h.reply(read, preview(patch('proposal')));
  await body(h, stale, preview(patch('late actual')));
  for (const read of h.requests.filter(read => read.status === undefined && read.url.searchParams.get('op') === 'preview')) await h.reply(read, preview(patch('obsolete replay')));
  assert.equal(root.querySelector('[aria-label="Raw patch"]')?.textContent.includes('late actual') ?? false, false);
  await click(h.view, textButton(root, 'Raw patch'));
  assert.equal(root.querySelector('[aria-label="Raw patch"]').textContent, patch('proposal'));
  assert.equal(root.textContent.includes('Proposed'), false, 'old card labels never define the source');
  await click(h.view, textButton(root, 'Actual result'));
  await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('actual')));
  assert.equal(root.querySelector('[aria-label="Raw patch"]').textContent, patch('actual'));
  assert.ok(textButton(root, 'Approve commit'));
});
test('selected-file context is immutable-source scoped and its ignored-abort body joins without replacing the new view', async t => {
  const h = await card(t), root = h.view.container;
  await deliver(h, 'overview', overview(true, 'different')); await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('actual')));
  await h.settle(); const from = h.work.length;
  await click(h.view, textButton(root, 'Before'));
  const oldContext = live(h, 'context');
  assert.ok(oldContext); assert.equal(oldContext.url.searchParams.get('view'), 'result');
  await click(h.view, textButton(root, 'View original proposal')); assert.equal(oldContext.signal.aborted, true);
  await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('proposal')));
  await body(h, oldContext, context('actual'));
  await act(async () => { await h.settle(from); });
  for (const entry of h.work.slice(from)) if (entry.error?.name === 'AbortError') h.expectFailure(entry.error);
  assert.equal(root.querySelector('[aria-label="Before file"]') === null, true);
  assert.equal(textButton(root, 'Changes').getAttribute('aria-pressed'), 'true');
  await click(h.view, textButton(root, 'Before'));
  const current = live(h, 'context'); assert.equal(current.url.searchParams.get('view'), 'proposal');
  await body(h, current, context('proposal')); await h.settle();
  assert.ok(root.querySelector('[aria-label="Before file"]'));
});
test('the real viewer remembers recent lightweight queries separately for actual and proposal', async t => {
  const h = await card(t), root = h.view.container;
  await deliver(h, 'overview', overview(true, 'different')); await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('actual')));
  const query = () => root.querySelector('[aria-label="Search full file"]');
  await input(h.view, query(), 'actual-only query');
  await click(h.view, textButton(root, 'View original proposal'));
  await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('proposal')));
  assert.equal(query().value, ''); await input(h.view, query(), 'proposal-only query');
  await click(h.view, textButton(root, 'Actual result'));
  await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('actual')));
  assert.equal(query().value, 'actual-only query');
  await click(h.view, textButton(root, 'View original proposal'));
  await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('proposal')));
  assert.equal(query().value, 'proposal-only query'); assert.ok(textButton(root, 'Approve commit'));
  assert.equal(h.requests.some(read => read.url.searchParams.get('op') === 'context'), false, 'remembering queries never caches or eagerly reads context');
});
test('missing actual never falls back; partial proposal availability, empty no-op and legacy footer remain truthful', async t => {
  const h = await card(t), root = h.view.container;
  const partial = overview(true); partial.views[0].available = false; partial.views[0].reason = 'Actual result unavailable; objects missing.';
  await deliver(h, 'overview', partial);
  assert.match(root.textContent, /Actual result unavailable/); assert.equal(h.requests.some(read => read.url.searchParams.get('op') === 'page'), false);
  await click(h.view, textButton(root, 'View original proposal')); await deliver(h, 'page', page('file.txt')); await deliver(h, 'preview', preview(patch('proposal')));
  await h.render(createElement(h.BlockingRequestCard, { key: 'empty', request: h.request, sessionId: 'current', onReadWork: h.onReadWork, onRespond() {} }));
  await deliver(h, 'overview', overview(true, 'different')); await deliver(h, 'page', page());
  assert.match(root.textContent, /No file changes in this comparison/);
  const count = h.requests.length;
  await h.render(createElement(h.BlockingRequestCard, { key: 'legacy', request: { ...h.request, review: { ...review, version: 1 } }, sessionId: 'current', onReadWork: h.onReadWork, onRespond() {} }));
  assert.match(root.textContent, /Legacy review unavailable; offline migration required/); assert.equal(h.requests.length, count);
  assert.ok(textButton(root, 'Approve commit')); assert.equal(root.querySelector('a[href*="reviews/"]') === null, true);
});
