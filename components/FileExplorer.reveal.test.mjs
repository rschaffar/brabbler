import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { encodeFilePathForApi } from '../lib/file-paths.ts';
import { navigationRuntime, session, click, button } from './navigation-runtime.fixture.mjs';
import { sidebarRoutes } from './navigation-cases.fixture.mjs';
import { explorerHarness, explorerRoutes, entry } from './explorer-cases.fixture.mjs';
const listings = () => new Map([['/repo', [entry('retained', true), entry('nested', true)]], ['/repo/retained', []], ['/repo/nested', [entry('deeper', true)]], ['/repo/nested/deeper', [entry('file')]]]);

test('actual Sidebar consumes reveal IDs once, opens Explorer and leaves its file-search projection', async t => {
  const r = await navigationRuntime(t, sidebarRoutes([session('a')], request => {
    if (request.url.pathname === '/api/git/status') return { handled: true, data: { isGitRepository: true, files: [{ filePath: '/repo/changed', status: 'modified', code: 'M' }], additions: 1, deletions: 0 } };
  }, { listings: new Map([['/repo', [entry('file')]]]) }));
  const controller = r.graph.createActivityClientController({ visible: () => false }); r.releaseOnClose(() => controller.dispose());
  let props = { selectedSessionId: 'a', selectedCwd: '/repo', onSelectSession() {}, onOpenFile() {}, activityController: controller };
  await r.render(createElement(r.graph.SessionSidebar, props)); await r.settled();
  await click(r.view, button(r.view, '1 changed files'));
  assert.equal(button(r.view, '1 changed files').getAttribute('aria-pressed'), 'true');
  await click(r.view, button(r.view, 'Search files'));
  assert.equal(r.view.container.querySelector('input[aria-label="Search files"]') !== null, true);
  props = { ...props, fileRevealRequest: { id: 1, filePath: '/repo/file' } };
  await r.render(createElement(r.graph.SessionSidebar, props)); await r.settled();
  assert.equal(r.view.container.querySelector('input[aria-label="Search files"]') === null, true);
  assert.equal(button(r.view, '1 changed files').getAttribute('aria-pressed'), 'false');
  assert.equal(r.view.container.querySelector('[data-explorer-revealed="true"]').getAttribute('aria-label'), '/repo/file');
  const count = r.requests.length;
  await r.render(createElement(r.graph.SessionSidebar, { ...props, fileRevealRequest: { ...props.fileRevealRequest } })); await r.settled();
  assert.equal(r.requests.length, count, 'settled ID is not replayed');
  await r.render(createElement(r.graph.SessionSidebar, { ...props, fileRevealRequest: { id: 2, filePath: '/repo/file' } })); await r.settled();
  assert.ok(r.requests.length > count, 'same file with new command ID is fresh');
});

test('nested real reveal retains folders and Explorer-only scrolling under Strict replay; claimed remounted selection stays highlighted without refocusing', async t => {
  let focusCalls = 0;
  const initialScrollTop = 40;
  const h = await explorerHarness(t, { listings: listings(), setup(window, replace) {
    const focus = window.HTMLElement.prototype.focus;
    replace(window.HTMLElement.prototype, 'focus', function (options) { if (this.getAttribute('aria-label') === '/repo/nested/deeper/file') { assert.equal(options.preventScroll, true); focusCalls++; } return focus.call(this, options); });
    replace(window.HTMLElement.prototype, 'getBoundingClientRect', function () {
      if (this.hasAttribute('data-explorer-scroll')) return { top: 100, bottom: 200 };
      if (this.getAttribute('aria-label') === '/repo/nested/deeper/file') {
        const scroller = this.closest('[data-explorer-scroll]');
        const displacement = (scroller?.scrollTop ?? initialScrollTop) - initialScrollTop;
        return { top: 220 - displacement, bottom: 244 - displacement };
      }
      return { top: 120, bottom: 144 };
    });
  } });
  await h.settled();
  await click(h.view, button(h.view, 'Expand folder (/repo/retained)')); await h.settled();
  const scroller = h.view.container.querySelector('[data-explorer-scroll]'); scroller.scrollTop = initialScrollTop;
  await h.update({ revealRequest: { id: 1, filePath: '/repo/nested/deeper/file' } }); await h.settled();
  assert.equal(button(h.view, 'Collapse folder (/repo/retained)').getAttribute('aria-expanded'), 'true');
  assert.equal(h.element('/repo/nested/deeper/file').getAttribute('data-explorer-revealed'), 'true');
  assert.equal(scroller.scrollTop, 84, '40 + (244 - 200), with replay-consistent viewport bounds');
  assert.equal(h.view.window.document.documentElement.scrollTop, 0);
  assert.equal(h.view.window.document.body.scrollTop, 0);
  const firstCommandFocusCalls = focusCalls;
  assert.ok(firstCommandFocusCalls >= 1, 'actual target receives focus; Strict setup may replay before claim commit');
  assert.equal(h.view.window.document.activeElement === h.element('/repo/nested/deeper/file'), true);
  assert.deepEqual(h.revealSettled, [1]);
  await click(h.view, button(h.view, 'Collapse folder (/repo/nested)'));
  await click(h.view, button(h.view, 'Expand folder (/repo/nested)')); await h.settled();
  assert.equal(h.element('/repo/nested/deeper/file').getAttribute('data-explorer-revealed'), 'true'); assert.equal(focusCalls, firstCommandFocusCalls, 'claimed selection does not refocus its remounted row');
  await h.update({ revealRequest: { id: 2, filePath: '/repo/nested/deeper/file' } }); await h.settled();
  assert.deepEqual(h.revealSettled, [1, 2]);
  assert.ok(focusCalls > firstCommandFocusCalls, 'fresh same-file command requests focus again');
  assert.equal(h.view.window.document.activeElement === h.element('/repo/nested/deeper/file'), true);
  assert.equal(scroller.scrollTop, 84, 'already-visible repeat neither scrolls Explorer further nor scrolls the document');
  assert.equal(h.view.window.document.documentElement.scrollTop, 0);
  assert.equal(h.view.window.document.body.scrollTop, 0);
});

test('Windows reveal uses actual canonical listing spelling, not requested case or separators', async t => {
  const h = await explorerHarness(t, { cwd: 'C:/Repo', listings: new Map([['C:/Repo', [entry('Nested', true)]], ['C:/Repo/Nested', [entry('File')]]]) });
  await h.settled(); await h.update({ revealRequest: { id: 1, filePath: 'c:\\repo\\nested\\FILE' } }); await h.settled();
  assert.equal(h.element('C:/Repo/Nested/File').getAttribute('data-explorer-revealed'), 'true');
  assert.equal(button(h.view, 'Collapse folder (C:/Repo/Nested)').getAttribute('aria-expanded'), 'true');
});

for (const command of ['supersede', 'return', 'context', 'unmount']) test(`real reveal ${command} invalidates delivered old body and old error`, async t => {
  const data = new Map([['/repo', [entry('file')]], ['/outside', [entry('old')]], ['/other', [entry('new')]]]);
  const held = [];
  const route = explorerRoutes(data, request => {
    if (request.url.pathname === `/api/files/${encodeFilePathForApi('/outside')}`) { held.push(request); return { handled: true, data: undefined }; }
  });
  const h = await explorerHarness(t, { route, listings: data }); await h.settled();
  await h.update({ revealRequest: { id: 1, filePath: '/outside/old' } });
  for (const request of held) await h.headers(request);
  assert.ok(held.length > 0); assert.ok(held.every(request => request.jsonCalls === 1));
  if (command === 'supersede') await h.update({ revealRequest: { id: 2, filePath: '/other/new' } });
  if (command === 'return') await click(h.view, button(h.view, 'Return to workspace folder'));
  if (command === 'context') await h.update({ cwd: '/other', contextSessionId: 'b', revealRequest: undefined });
  if (command === 'unmount') await h.view.unmount();
  for (const request of held) {
    if (command === 'context') await h.rejectBody(request);
    else await h.body(request, { entries: [entry('old')] });
  }
  await h.settled();
  assert.equal(h.view.container.querySelector('[aria-label="/outside/old"][data-explorer-revealed="true"]') === null, true);
  assert.equal(h.revealSettled.includes(1), command === 'return', 'Return consumes its own command, obsolete continuations do not');
  if (command === 'supersede') assert.equal(h.element('/other/new').getAttribute('data-explorer-revealed'), 'true');
  if (command === 'unmount') assert.equal(h.view.container.childNodes.length, 0);
});

for (const denied of [true, false]) test(`actual denied/missing reveal feedback has no cwd validation or root-grant fallback: ${denied}`, async t => {
  const h = await explorerHarness(t, { listings: new Map([['/repo', []], ['/outside', []]]), route: explorerRoutes(new Map([['/repo', []], ['/outside', []]]), request => {
    if (denied && request.url.pathname === '/api/files/outside') return { handled: true, data: undefined };
  }) });
  await h.settled(); await h.update({ revealRequest: { id: 1, filePath: '/outside/file' } });
  if (denied) for (const request of h.requests.filter(r => r.url.pathname === '/api/files/outside')) await h.reply(request, { error: 'Forbidden' }, 403);
  await h.settled();
  assert.equal(h.view.container.querySelector('[data-explorer-revealed="true"]') === null, true);
  assert.match(h.view.container.textContent, /Cannot reveal this file/);
  assert.deepEqual(h.revealSettled, [1]);
});


test('file-search projection does not admit a reveal walk before Sidebar closes search', async t => {
  const h = await explorerHarness(t, { props: { fileSearchOpen: true }, listings: new Map([['/repo', []]]) }); await h.settled();
  const before = h.requests.length;
  await h.update({ revealRequest: { filePath: '/outside/file', id: 7 } }); await h.settled();
  assert.equal(h.requests.length, before);
  assert.equal(h.view.container.querySelector('[data-explorer-revealed="true"]') === null, true);
});
