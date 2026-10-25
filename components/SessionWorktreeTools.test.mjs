import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { navigationRuntime, exact, session, click, button, row } from './navigation-runtime.fixture.mjs';
import { shellHarness, sidebarRoutes } from './navigation-cases.fixture.mjs';

const entries = [
  { path: '/repo', branch: 'main', isMain: true, state: 'present', sessionCount: 1, archivedCount: 0 },
  { path: '/missing', branch: null, isMain: false, state: 'missing', sessionCount: 1, archivedCount: 0 },
];

test('actual history filter scopes rows/search/bulk but never adopts a missing cwd; scope change clears opt-in selection', async t => {
  const sessions = [session('a'), session('missing', '/missing', { cwdState: 'missing' })];
  const h = await shellHarness(t, { sidebar: true, route: sidebarRoutes(sessions, undefined, { inventory: { projectRoot: '/repo', mainCwd: '/repo', worktrees: entries } }) });
  await h.settled(); const cwd = h.current.state.activeCwd;
  await click(h.view, button(h.view, 'Select'));
  await click(h.view, row(h.view, 'a'));
  assert.equal(row(h.view, 'a').querySelector('input').checked, true);
  const filter = h.view.container.querySelector('select[aria-label="Filter sessions by worktree"]');
  filter.value = '/missing'; await h.view.dispatch(filter, new h.view.window.Event('change', { bubbles: true }));
  assert.equal(h.current.state.activeCwd, cwd);
  assert.equal(h.view.container.querySelector('[data-session-id="a"]') === null, true);
  assert.equal(row(h.view, 'missing').querySelector('input') === null, true, 'selection mode does not leak into the new history scope');
  assert.equal(button(h.view, 'New').disabled, false, 'New still targets working checkout, not history filter');
  assert.ok(h.requests.filter(r => r.url.pathname === '/api/worktrees').every(r => r.url.searchParams.get('cwd') === '/repo'));
});

test('real history hook accepts only current A/B/A key, rejects ignored-abort success/error, and cleans up its pending request', async t => {
  const r = await navigationRuntime(t, request => {
    const project = request.url.searchParams.get('project'); assert.ok(['/a', '/b'].includes(project));
    exact(request, '/api/sessions/worktrees', { project }, { signal: true, cache: 'no-store' }); return undefined;
  });
  let current;
  const props = { project: '/a', refreshKey: '0', onCommit: value => { current = value; } };
  await r.render(createElement(r.graph.InventoryHarness, props));
  const oldA = r.latest('/api/sessions/worktrees'); await r.headers(oldA);
  await r.render(createElement(r.graph.InventoryHarness, { ...props, project: '/b' })); const b = r.latest('/api/sessions/worktrees'); await r.headers(b, 500);
  assert.equal(oldA.options.signal.aborted, true);
  await r.render(createElement(r.graph.InventoryHarness, { ...props, refreshKey: '1' })); const latest = r.latest('/api/sessions/worktrees'); await r.headers(latest);
  assert.equal(current.loading, true); assert.equal(current.inventory, undefined);
  await r.body(latest, { projectRoot: '/a', mainCwd: '/a', worktrees: [] });
  await r.body(oldA, { projectRoot: '/obsolete', mainCwd: '/obsolete', worktrees: [] });
  await r.body(b, { error: 'obsolete error' });
  assert.equal(current.inventory.projectRoot, '/a'); assert.equal(current.error, undefined); assert.equal(current.loading, false);
  // Release Strict replay peers through their actual body consumers too.
  for (const request of r.requests.filter(req => req !== oldA && req !== b && req !== latest)) await r.reply(request, { projectRoot: '/obsolete', mainCwd: null, worktrees: [] });
  await act(async () => { current.refresh(); }); const closing = r.latest('/api/sessions/worktrees');
  await r.view.unmount(); assert.equal(closing.options.signal.aborted, true);
  await r.reply(closing, { projectRoot: '/a', mainCwd: '/a', worktrees: [] }); await r.settled();
});

for (const uncertain of [false, true]) test(`real bulk Move owns preview → dispatch → ${uncertain ? 'reconcile' : 'acknowledgement'} → held refresh; Escape cannot close admitted work`, async t => {
  const plan = { project: '/repo', cwd: '/repo', missingOnly: true, roots: [{ id: 'a', sourceCwd: '/missing', memberIds: ['a'], bindings: [{ id: 'a', cwd: '/missing', path: '/saved/a.jsonl' }] }], sessionCount: 1, archivedCount: 1, affectedIds: ['a'] };
  const settled = [], closed = [];
  let releaseRefresh;
  const refresh = new Promise(resolve => { releaseRefresh = resolve; });
  const r = await navigationRuntime(t, request => {
    const body = JSON.parse(request.options.body);
    exact(request, '/api/sessions/move', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: body.mode === 'preview' });
    if (body.mode === 'preview') { assert.deepEqual(body, { mode: 'preview', project: '/repo', missingOnly: true }); return { plan }; }
    assert.deepEqual(body, { mode: body.mode, plan, rootIds: ['a'] });
    assert.ok(['execute', 'reconcile'].includes(body.mode)); return undefined;
  });
  r.releaseOnClose(releaseRefresh);
  await r.render(createElement(r.graph.SessionBulkMoveDialog, { request: { project: '/repo', missingOnly: true }, projects: [], currentCwd: '/missing', sourceUnavailable: true,
    onClose: () => closed.push(true), async onSettled(...args) { settled.push(args); await refresh; } }));
  await r.settled();
  assert.equal(r.requests.some(req => JSON.parse(req.options.body).mode === 'execute'), false, 'preview is not execution authority');
  await click(r.view, button(r.view, 'Move'));
  const execute = r.latest('/api/sessions/move', 'POST');
  if (uncertain) {
    await r.reply(execute, { invalid: true });
    const reconcile = r.latest('/api/sessions/move', 'POST'); assert.equal(JSON.parse(reconcile.options.body).mode, 'reconcile');
    await r.reply(reconcile, { roots: [{ id: 'a', state: 'unknown', memberIds: ['a'] }] });
  } else await r.reply(execute, { succeeded: ['a'], failed: [], skipped: [], pending: [], movedIds: ['a'] });
  assert.equal(settled.length, 1);
  assert.deepEqual(settled[0], uncertain ? [[], null, ['a'], '/repo'] : [['a'], [], [], '/repo']);
  const dialog = r.view.container.querySelector('dialog');
  await r.view.dispatch(dialog, new r.view.window.Event('cancel', { cancelable: true }));
  assert.deepEqual(closed, []);
  assert.ok([...r.view.container.querySelectorAll('button')].some(node => node.disabled));
  releaseRefresh(); await r.settled();
  assert.equal(r.requests.filter(req => JSON.parse(req.options.body).mode === 'execute').length, 1, 'unknown acknowledgement never retries mutation');
  assert.equal(r.view.window.localStorage.length, 0); assert.equal(r.view.window.sessionStorage.length, 0); assert.equal(r.intervalCount, 0);
});


test('real bulk archive retains only failed roots, invalidates old catalogue and owns awaited refresh; delete stays separately confirmed', async t => {
  let sessions = [session('a'), session('b'), session('temporary', '/repo', { transient: true })];
  const route = request => sidebarRoutes(sessions, r => {
    if (['/api/sessions/a', '/api/sessions/b'].includes(r.url.pathname)) {
      exact(r, r.url.pathname, {}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: { archived: true } });
      return { handled: true, data: undefined };
    }
  })(request);
  const h = await shellHarness(t, { sidebar: true, route }); await h.settled();
  await click(h.view, button(h.view, 'Select')); await click(h.view, button(h.view, 'Select all'));
  assert.equal(row(h.view, 'temporary').querySelector('input').disabled, true);
  assert.equal(row(h.view, 'a').querySelector('.session-row-action-controls') === null, true);
  await click(h.view, button(h.view, 'Archive'));
  const a = h.latest('/api/sessions/a', 'PATCH'); await h.reply(a, {});
  const b = h.latest('/api/sessions/b', 'PATCH');
  sessions = [session('a', '/repo', { archived: true }), session('b'), session('temporary', '/repo', { transient: true })];
  await h.reply(b, {}, 409); await h.settled();
  assert.equal(h.view.container.querySelector('[data-session-id="a"]') === null, true);
  assert.equal(row(h.view, 'b').querySelector('input').checked, true);
  assert.match(h.view.container.querySelector('[role="alert"]').textContent, /b: 409/);
  await click(h.view, button(h.view, 'Delete'));
  assert.equal(h.requests.some(r => r.options.method === 'DELETE'), false, 'bulk Delete requires its own second confirmation');
});
