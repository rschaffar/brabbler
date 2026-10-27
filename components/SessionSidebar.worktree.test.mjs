import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { navigationRuntime, exact, session, click, button, inputText } from './navigation-runtime.fixture.mjs';
import { sidebarRoutes } from './navigation-cases.fixture.mjs';
const oid = 'a'.repeat(40), tip = 'b'.repeat(40);
const wt = { projectRoot: '/repo', projectKey: '/repo', isGit: true, isTopLevel: true, currentWorktreePath: '/repo/wt',
  worktrees: [{ path: '/repo', branch: 'main', isMain: true }, { path: '/repo/wt', branch: 'feature', isMain: false }],
  localBranches: [{ branch: 'main', oid }, { branch: 'unattached', oid: tip }] };
async function mountSidebar(t, route, cwd = '/repo', data = wt, projectStages) {
  const changes = [], historyAdmissions = [], pendingCheckoutReads = [];
  let canonicalReleased = false;
  // Literal ordered tuples belong to the Windows case. Do not derive an
  // expected identity from the actual incoming query or normalize its spelling.
  const historyPlan = projectStages ? [...projectStages] : [];
  const r = await navigationRuntime(t, sidebarRoutes([session('a')], request => {
    if (projectStages && request.url.pathname === '/api/worktrees' && (request.options.method ?? 'GET') === 'GET'
      && request.url.searchParams.get('cwd') === cwd && !canonicalReleased) {
      exact(request, '/api/worktrees', { cwd }, { signal: false });
      pendingCheckoutReads.push(request);
      return { handled: true, data: undefined }; // named real canonical-identity body gate
    }
    if (projectStages && request.url.pathname === '/api/sessions/worktrees') {
      const expected = historyPlan.length ? historyPlan.shift() : { stage: 'canonical-refresh', project: '/repo' };
      assert.equal(canonicalReleased, expected.stage !== 'provisional', 'history identity follows the named canonical response boundary');
      exact(request, '/api/sessions/worktrees', { project: expected.project }, { signal: true, cache: 'no-store' });
      historyAdmissions.push(expected);
      return { handled: true, data: { project: '/repo', mainCwd: '/repo', worktrees: [] } };
    }
    return route?.(request);
  }, { worktrees: data, listings: new Map([['/repo', []], ['/repo/wt', []], [cwd, []]]) }));
  const activity = r.graph.createActivityClientController({ visible: () => false }); r.releaseOnClose(() => activity.dispose());
  await r.render(createElement(r.graph.SessionSidebar, { selectedCwd: cwd, selectedSessionId: null, onSelectSession() {}, activityController: activity, onCwdChange: (...args) => changes.push(args) }));
  if (projectStages) {
    assert.deepEqual(historyAdmissions, projectStages.filter(stage => stage.stage === 'provisional'), 'both declared initial raw-spelling admissions occur before server identity');
    assert.ok(pendingCheckoutReads.length > 0, 'canonical checkout request really entered production transport');
    canonicalReleased = true;
    for (const request of pendingCheckoutReads) await r.reply(request, data);
  }
  await r.settled();
  if (projectStages) {
    assert.equal(historyPlan.length, 0, 'all exact stage tuples were admitted');
    assert.deepEqual(historyAdmissions.slice(0, projectStages.length), projectStages);
  }
  return { ...r, get view() { return r.view; }, changes };
}

test('server current-worktree spelling controls highlight and successful removal fallback; clean and dirty confirmations are separate', async t => {
  const raw = 'c:\\REPO\\wt', canonical = 'C:/Repo/wt';
  const data = { ...wt, currentWorktreePath: canonical, worktrees: [wt.worktrees[0], { path: canonical, branch: 'feature', isMain: false }] };
  let deletes = 0;
  const r = await mountSidebar(t, request => {
    if (request.options.method === 'DELETE') {
      exact(request, '/api/worktrees', {}, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: { cwd: '/repo', path: canonical, force: deletes > 0 } });
      deletes++; return { handled: true, data: undefined };
    }
  }, raw, data, [
    { stage: 'provisional', project: raw },
    { stage: 'provisional', project: raw },
    { stage: 'canonical', project: '/repo' },
  ]);
  const switcher = [...r.view.container.querySelectorAll('button')].find(node => node.title.includes(canonical) && !node.closest('.wt-row'));
  assert.ok(switcher); await click(r.view, switcher);
  const remove = r.view.container.querySelector('.wt-row button[title^="Remove"]');
  await click(r.view, remove); assert.equal(deletes, 0, 'even clean removal waits for confirmation');
  await click(r.view, button(r.view, 'Remove'));
  await r.reply(r.latest('/api/worktrees', 'DELETE'), { dirty: true }, 409);
  assert.equal(deletes, 1); await click(r.view, button(r.view, 'Force'));
  await r.reply(r.latest('/api/worktrees', 'DELETE'), {}); await r.settled();
  assert.equal(deletes, 2);
  assert.ok(r.changes.some(args => args[0] === '/repo'), 'active canonical identity falls back to primary checkout');
});

for (const mode of ['create', 'attach']) test(`actual worktree ${mode} requires explicit base and sends captured full OIDs`, async t => {
  const r = await mountSidebar(t, request => {
    // Delegate ONLY the exact real empty Activity startup import to the
    // existing shared fixture declaration before validating worktree POSTs.
    if (request.url.pathname === '/api/activity/review' && request.options.method === 'POST') {
      exact(request, '/api/activity/review', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { op: 'import', entries: [] }, signal: false });
      return undefined;
    }
    if (request.options.method === 'POST') {
      exact(request, '/api/worktrees', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { cwd: '/repo', branch: mode === 'create' ? 'new-branch' : 'unattached', mode, baseBranch: 'main', expectedBaseOid: oid, ...(mode === 'attach' ? { expectedTipOid: tip } : {}) } });
      return { handled: true, data: undefined };
    }
  });
  const switcher = [...r.view.container.querySelectorAll('button')].find(node => node.title.startsWith('Switch worktree'));
  await click(r.view, switcher); await click(r.view, button(r.view, 'New worktree…'));
  const select = async (label, value) => {
    const element = r.view.container.querySelector(`select[aria-label="${label}"]`); element.value = value;
    await r.view.dispatch(element, new r.view.window.Event('change', { bubbles: true }));
  };
  assert.equal(r.view.container.querySelector('select[aria-label="Local base branch"]').value, '');
  assert.equal(button(r.view, 'Create').disabled, true);
  await select('Local base branch', 'main');
  if (mode === 'create') await inputText(r.view, r.view.container.querySelector('input[placeholder="branch name"]'), ' new-branch ');
  else { await select('Worktree action', 'attach'); await select('Branch to attach', 'unattached'); }
  assert.match(r.view.container.textContent, new RegExp(`Expected base HEAD: ${oid}`));
  if (mode === 'attach') assert.match(r.view.container.textContent, new RegExp(`Expected branch tip: ${tip}`));
  await click(r.view, button(r.view, 'Create'));
  // This is proposal/wiring proof, not native Git permission or cleanup authority.
  await r.reply(r.latest('/api/worktrees', 'POST'), { error: 'controlled conflict' }, 409); await r.settled();
  assert.match(r.view.container.textContent, /controlled conflict/);
});

test('Strict Sidebar warm bootstrap publishes once and skips unnecessary detail hydration', async t => {
  const catalogues = [], publications = [];
  const r = await navigationRuntime(t, sidebarRoutes([session('a')], request => {
    if (request.url.pathname === '/api/sessions') catalogues.push(request);
  }));
  const activity = r.graph.createActivityClientController({ visible: () => false });
  r.releaseOnClose(() => activity.dispose());
  const props = { selectedCwd: '/repo', selectedSessionId: null, activityController: activity,
    onSelectSession() {}, onSessionsChange: rows => { if (rows.length) publications.push(rows); } };
  await r.render(createElement(r.graph.SessionSidebar, props)); await r.settled();
  assert.equal(catalogues.length, 1, 'Strict replay must not create a second forced bootstrap');
  exact(catalogues[0], '/api/sessions', { summary: '1' }, { cache: 'no-store' });
  assert.ok(r.view.container.querySelector('[data-session-id="a"]'));
  assert.equal(r.pendingTimerCount(750), 0, 'complete warm summary needs no forced hydration');
  assert.ok(publications.length > 0);
  await r.render(createElement(r.graph.SessionSidebar, { ...props, refreshKey: 1 })); await r.settled();
  assert.equal(catalogues.length, 2); exact(catalogues[1], '/api/sessions', { force: '1' }, { cache: 'no-store' });
});

test('held startup summary coalesces real version and unlisted-running notification refreshes', async t => {
  const catalogues = [];
  const r = await navigationRuntime(t, sidebarRoutes([session('a')], request => {
    if (request.url.pathname === '/api/sessions') {
      catalogues.push(request); return { handled: true, data: undefined };
    }
    if (request.url.pathname === '/api/agent/running') {
      exact(request, '/api/agent/running', {}, { cache: 'no-store', signal: true });
      return { handled: true, data: { sessionListVersion: 1, runningSessionIds: ['a'] } };
    }
  }));
  const activity = r.graph.createActivityClientController({ visible: () => true });
  r.releaseOnClose(() => activity.dispose());
  await r.render(createElement(r.graph.SessionSidebar, { selectedCwd: '/repo', selectedSessionId: null,
    activityController: activity, onSelectSession() {} }));
  assert.equal(catalogues.length, 1, 'real passive demands wait for the held summary');
  await r.reply(catalogues[0], { sessions: [session('a')], sessionListVersion: 1, runningSessionIds: ['a'] });
  assert.ok(r.view.container.querySelector('[data-session-id="a"]'), 'summary paints before the forced body settles');
  assert.equal(catalogues.length, 2); exact(catalogues[1], '/api/sessions', { force: '1' }, { cache: 'no-store' });
  await r.reply(catalogues[1], { sessions: [session('a')], sessionListVersion: 2, runningSessionIds: ['a'] });
  await activity.whenIdle(); await r.settled();
  assert.equal(catalogues.length, 2); assert.equal(r.pendingTimerCount(750), 0);
});

test('actual Sidebar unmount drains admitted catalogue JSON without late publication or replacement', async t => {
  const catalogues = [], published = [];
  const r = await navigationRuntime(t, sidebarRoutes([session('a')], request => {
    if (request.url.pathname === '/api/sessions') { catalogues.push(request); return { handled: true, data: undefined }; }
  }));
  const activity = r.graph.createActivityClientController({ visible: () => false });
  r.releaseOnClose(() => activity.dispose());
  await r.render(createElement(r.graph.SessionSidebar, { selectedCwd: '/repo', selectedSessionId: null,
    activityController: activity, onSelectSession() {}, onSessionsChange: rows => { if (rows.length) published.push(rows); } }));
  assert.equal(catalogues.length, 1);
  await r.headers(catalogues[0]); assert.equal(catalogues[0].jsonCalls, 1);
  await r.view.unmount();
  await r.body(catalogues[0], { sessions: [session('late')], sessionListVersion: 9 });
  await r.settled();
  assert.equal(catalogues[0].bodyReturned, true);
  assert.equal(published.length, 0); assert.equal(catalogues.length, 1);
  assert.equal(r.pendingTimerCount(750), 0);
});

test('a real detail refresh retires pending summary hydration without hiding HTTP refresh failures', async t => {
  let visible = false, version = 1;
  const held = [];
  const r = await navigationRuntime(t, sidebarRoutes([session('a', '/repo', { detailsPending: true, firstMessage: '' })], request => {
    if (request.url.pathname === '/api/agent/running') {
      exact(request, '/api/agent/running', {}, { signal: true, cache: 'no-store' });
      return { handled: true, data: { sessionListVersion: version, runningSessionIds: [] } };
    }
    if (request.url.pathname === '/api/sessions' && !request.url.searchParams.has('summary')) {
      held.push(request);
      return { handled: true, data: undefined };
    }
  }), undefined, { strict: false }); // Production incarnation: no dev-only effect replay consumes the timer first.
  const activity = r.graph.createActivityClientController({ visible: () => visible });
  r.releaseOnClose(() => activity.dispose());
  await r.render(createElement(r.graph.SessionSidebar, { selectedCwd: '/repo', selectedSessionId: null,
    onSelectSession() {}, activityController: activity }));
  await r.settled(); await activity.whenIdle();
  const initialTimers = r.pendingTimerCount();
  assert.ok(initialTimers > 0, 'initial summary admitted its deferred detail-hydration timer');
  visible = true; version = 2;
  await act(async () => activity.refresh()); // Actual catalogue subscriber starts the detail read.
  assert.equal(held.length, 1, 'real Sidebar detail refresh entered transport');
  assert.equal(r.pendingTimerCount(), initialTimers - 1,
    'full detail refresh cancels redundant pending initial hydration before it can supersede the refresh');
  await r.reply(held[0], { sessions: [session('refreshed')], sessionListVersion: version, runningSessionIds: [] });
  await activity.whenIdle(); await r.settled();
  assert.ok(r.view.container.querySelector('[data-session-id="refreshed"]'));
  assert.equal(r.view.container.querySelector('[data-session-id="a"]'), null);
  version = 3;
  await act(async () => activity.refresh());
  assert.equal(held.length, 2);
  await r.reply(held[1], { error: 'actual controlled refresh failure' }, 503);
  await activity.whenIdle(); await r.settled();
  assert.match(r.view.container.textContent, /HTTP 503/, 'real refresh errors remain visible');
});
