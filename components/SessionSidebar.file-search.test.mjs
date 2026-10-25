import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { exact, click, inputText } from './navigation-runtime.fixture.mjs';
import { explorerHarness, explorerRoutes, entry } from './explorer-cases.fixture.mjs';

test('real bounded debounced file search renders expandable filtered tree, opens current results and offers mention/download', async t => {
  const data = new Map([['/repo', [entry('ordinary')]]]);
  const h = await explorerHarness(t, { listings: data, props: { fileSearchOpen: true }, route: explorerRoutes(data, request => {
    if (request.url.pathname === '/api/file-index') {
      exact(request, '/api/file-index', { cwd: '/repo', q: 'a', refresh: '1' }, { signal: true });
      return { handled: true, data: { matches: [{ path: 'docs/a.txt', isDir: false }, { path: 'docs/ignored', isDir: true }] } };
    }
  }) });
  await h.settled(); const input = h.view.container.querySelector('input[aria-label="Search files"]');
  await inputText(h.view, input, ' a ');
  assert.equal(h.requests.some(request => request.url.pathname === '/api/file-index'), false, 'not before debounce admission');
  await h.fire(150); await h.settled();
  const row = h.element('/repo/docs/a.txt'); assert.ok(row);
  assert.equal(h.element('/repo/docs/ignored') === null, true, 'directory entries do not escape the projection');
  const lists = h.requests.filter(request => request.url.pathname.startsWith('/api/files/'));
  assert.ok(lists.every(request => request.url.pathname === '/api/files/repo'), 'search never lists arbitrary result folders');
  await click(h.view, row); assert.deepEqual(h.opened, [['/repo/docs/a.txt', 'a.txt']]);
  await h.view.dispatch(row, new h.view.window.MouseEvent('mouseover', { bubbles: true }));
  const mention = row.querySelector('button[title="Insert path into chat"]'); assert.ok(mention); await click(h.view, mention);
  assert.deepEqual(h.mentioned, [['docs/a.txt', false]]);
  assert.equal(row.querySelector('a[download]').getAttribute('href'), '/api/files/repo/docs/a.txt?type=download');
});

test('search A/B/A body delivery preserves current result/loading/error, and foreground HTTP failure is visible', async t => {
  const data = new Map([['/repo', []]]);
  const h = await explorerHarness(t, { listings: data, props: { fileSearchOpen: true }, route: explorerRoutes(data, request => {
    if (request.url.pathname === '/api/file-index') {
      const q = request.url.searchParams.get('q'); assert.ok(['a', 'b', 'failure'].includes(q));
      exact(request, '/api/file-index', { cwd: '/repo', q, ...(q === 'failure' ? {} : { refresh: '1' }) }, { signal: true });
      return { handled: true, data: undefined };
    }
  }) });
  await h.settled(); const input = h.view.container.querySelector('input[aria-label="Search files"]');
  const requests = [];
  for (const q of ['a', 'b', 'a']) {
    await inputText(h.view, input, q); await h.fire(150); const request = h.latest('/api/file-index'); requests.push(request); await h.headers(request);
  }
  assert.equal(requests[0].options.signal.aborted, true); assert.equal(requests[1].options.signal.aborted, true);
  await h.body(requests[2], { matches: [{ path: 'current.txt', isDir: false }] });
  await h.body(requests[0], { matches: [{ path: 'obsolete.txt', isDir: false }] });
  await h.body(requests[1], { matches: [{ path: 'obsolete-b.txt', isDir: false }] }); await h.settled();
  assert.ok(h.element('/repo/current.txt')); assert.equal(h.element('/repo/obsolete.txt') === null, true);
  await inputText(h.view, input, 'failure'); await h.fire(150);
  await h.reply(h.latest('/api/file-index'), {}, 500); await h.settled();
  assert.ok(h.view.container.querySelector('[role="alert"]'));
});
