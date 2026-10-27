import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { navigationRuntime, exact, session, button, row, click, inputText } from './navigation-runtime.fixture.mjs';
import { shellHarness, sidebarRoutes } from './navigation-cases.fixture.mjs';

const deny = () => assert.fail('unexpected row transport');
const baseRow = id => ({ session: session(id), isSelected: false, onClick() {} });

test('real row delete is confirmation-first and only Shift bypasses it; ordinary Delete key has no action', async t => {
  const events = [];
  const r = await navigationRuntime(t, request => { exact(request, '/api/sessions/a', {}, { method: 'DELETE' }); return {}; });
  await r.render(createElement(r.graph.SessionItem, { ...baseRow('a'), onClick: () => events.push('selected'), onDeleted: id => events.push(id) }));
  await r.view.dispatch(row(r.view, 'a'), new r.view.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.equal(r.requests.length, 0);
  await click(r.view, button(r.view, 'Delete (Shift+click to delete without confirmation)'));
  assert.equal(r.requests.length, 0);
  await click(r.view, button(r.view, 'Cancel'));
  await r.view.dispatch(button(r.view, 'Delete (Shift+click to delete without confirmation)'), new r.view.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await r.settled(); assert.deepEqual(events, ['a']);
});

test('real row link, star, move and touch toggle do not select; rerender uses current callbacks', async t => {
  const events = [], copied = [];
  const r = await navigationRuntime(t, deny, (window, replace) => { replace(window.navigator, 'clipboard', { writeText: async text => copied.push(text) }); });
  let props = { ...baseRow('a'), onClick: () => events.push('selected'), onMove: () => events.push('old move'), onToggleStar: () => events.push('star') };
  await r.render(createElement(r.graph.SessionItem, props));
  const toggle = button(r.view, 'Session actions');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await click(r.view, toggle); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(r.view.container.querySelector('.session-row-actions').getAttribute('data-open'), 'true');
  await click(r.view, button(r.view, 'Copy session link')); await r.settled();
  assert.deepEqual(copied, ['https://fixture.invalid/?session=a']);
  assert.deepEqual(events, []);
  props = { ...props, onMove: () => events.push('current move') };
  await r.render(createElement(r.graph.SessionItem, props));
  await click(r.view, button(r.view, 'Move to project…'));
  await click(r.view, button(r.view, 'Star session'));
  assert.deepEqual(events, ['current move', 'star']);
  await r.render(createElement(r.graph.SessionItem, { ...props, isRunning: true }));
  assert.equal(button(r.view, 'Move to project…').disabled, true);
  assert.equal(button(r.view, 'Archive').disabled, true);
});

test('real rename preserves untouched fallback whitespace, trims edits and reports failure without success callback', async t => {
  const renamed = [];
  const r = await navigationRuntime(t, request => { exact(request, '/api/sessions/a', {}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: { name: 'new name' } }); return undefined; });
  await r.render(createElement(r.graph.SessionItem, { ...baseRow('a'), session: session('a', '/repo', { firstMessage: 'fallback ' }), onRenamed: () => renamed.push('saved') }));
  await click(r.view, button(r.view, 'Rename'));
  let input = r.view.container.querySelector('input');
  await r.view.dispatch(input, new r.view.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  assert.equal(r.requests.length, 0);
  await click(r.view, button(r.view, 'Rename')); input = r.view.container.querySelector('input');
  await inputText(r.view, input, '  new name  ');
  await r.view.dispatch(input, new r.view.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  await r.reply(r.latest('/api/sessions/a', 'PATCH'), {}, 409); await r.settled();
  assert.deepEqual(renamed, []); assert.match(row(r.view, 'a').title, /409/);
});

test('context-menu hook is normal-row-only, transient/bulk rows omit disk controls, and locale timestamp is actual output', async t => {
  const claims = [];
  const r = await navigationRuntime(t, deny, (window, replace) => {
    replace(globalThis, 'CustomEvent', window.CustomEvent);
    window.addEventListener('pi-web:session-row-contextmenu', event => { claims.push(event.detail.id); event.preventDefault(); });
  });
  const props = { ...baseRow('a'), session: session('a', '/repo', { modified: new Date().toISOString() }) };
  await r.render(createElement(r.graph.SessionItem, props));
  const menu = () => r.view.dispatch(row(r.view, 'a'), new r.view.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await menu(); assert.deepEqual(claims, ['a']);
  assert.equal(row(r.view, 'a').getAttribute('tabindex'), null, 'no deletion shortcut tab stop');
  assert.equal(row(r.view, 'a').querySelector(`span[title="${props.session.modified}"]`).textContent, r.graph.formatRelativeTime(props.session.modified, 'en'));
  await r.render(createElement(r.graph.SessionItem, { ...props, bulkSelecting: true })); await menu();
  assert.deepEqual(claims, ['a']);
  assert.equal(r.view.container.querySelector('.session-row-action-controls') === null, true);
  assert.equal(r.view.container.querySelector('input[type="checkbox"]') !== null, true);
  await r.render(createElement(r.graph.SessionItem, { ...props, session: { ...props.session, transient: true } }));
  assert.equal(r.view.container.querySelector('.session-row-action-controls') === null, true);
});

test('actual archive/restore row requests acknowledge only success and retain current action closures', async t => {
  const events = [];
  const r = await navigationRuntime(t, request => { exact(request, '/api/sessions/a', {}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: { archived: events.length === 0 } }); return {}; });
  const props = { ...baseRow('a'), onArchived: (...args) => events.push(args) };
  await r.render(createElement(r.graph.SessionItem, props)); await click(r.view, button(r.view, 'Archive')); await r.settled();
  await r.render(createElement(r.graph.SessionItem, { ...props, archivedView: true })); await click(r.view, button(r.view, 'Restore')); await r.settled();
  assert.deepEqual(events, [['a', true], ['a', false]]);
});

test('default Sidebar bridge publishes catalogue, selects actual rows, and archive invalidates older catalogue JSON', async t => {
  const sessions = [session('a'), session('b')];
  let hold = false;
  const h = await shellHarness(t, { sidebar: true, route: sidebarRoutes(sessions, request => {
    if (request.url.pathname === '/api/sessions/a' && request.options.method === 'PATCH') {
      exact(request, '/api/sessions/a', {}, { method: 'PATCH', body: { archived: true }, headers: { 'Content-Type': 'application/json' } }); return { handled: true, data: {} };
    }
    if (hold && request.url.pathname === '/api/sessions') return { handled: true, data: undefined };
  }) });
  await h.settled(); assert.deepEqual(h.current.state.sessionCatalog.map(s => s.id), ['a', 'b']);
  await click(h.view, row(h.view, 'a'));
  assert.equal(h.current.state.selectedSession.id, 'a');
  hold = true;
  const beforeRefresh = new Set(h.requests);
  await h.command(c => c.navigation.handleSessionSettled());
  const peers = h.requests.filter(request => request.url.pathname === '/api/sessions' && !beforeRefresh.has(request));
  const old = peers.find(request => request.url.searchParams.get('force') === '1'); assert.ok(old, 'actual Sidebar refresh admitted');
  for (const peer of peers.filter(request => request !== old)) await h.reply(peer, { sessions, sessionListVersion: 1 });
  await h.headers(old);
  await click(h.view, button(h.view, 'Archive', row(h.view, 'a')));
  assert.equal(h.latest('/api/sessions') === old, true, 'replacement waits for the old body, not a second concurrent decode');
  assert.equal(h.view.container.querySelector('[data-session-id="a"]') === null, true, 'acknowledged family leaves immediately');
  await h.body(old, { sessions, sessionListVersion: 1 });
  assert.equal(h.view.container.querySelector('[data-session-id="a"]') === null, true, 'stale body cannot undo optimistic archive');
  const refresh = h.latest('/api/sessions');
  assert.notEqual(refresh === old, true);
  await h.headers(refresh); await h.body(refresh, { sessions: [session('a', '/repo', { archived: true }), session('b')], sessionListVersion: 2 });
  for (const peer of h.requests.filter(request => request.url.pathname === '/api/sessions' && request !== old && request !== refresh && !request.answered)) await h.reply(peer, { sessions: [session('a', '/repo', { archived: true }), session('b')], sessionListVersion: 2 });
  assert.equal(h.view.container.querySelector('[data-session-id="a"]') === null, true);
  await h.settled();
});

test('pure session-window, archive structural-sharing and catalogue URL matrices retain every original input', async t => {
  const r = await navigationRuntime(t, deny);
  const { getSessionListIndices, sessionListUrl, updateSessionArchiveState } = r.graph;
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    for (let index = Math.floor(scrollTop / 54); index <= Math.ceil((scrollTop + 335) / 54) - 1; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex)); assert.equal(indices.length, 24);
    assert.equal(new Set(indices).size, indices.length); assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, 23);
  assert.equal(getSessionListIndices(2000, 10000, 335).includes(0), false);
  assert.equal(getSessionListIndices(2000, 10000, 335).length, 23);
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, 28);
  assert.deepEqual([[true, false], [true, true], [false, true], [false, false]].map(args => sessionListUrl(...args)), ['/api/sessions?summary=1&compact=1', '/api/sessions?summary=1&compact=1', '/api/sessions?force=1&compact=1', '/api/sessions?compact=1']);
  const sessions = [{ id: 'root', archived: false }, { id: 'child' }];
  const archived = updateSessionArchiveState(sessions, 'root', true);
  assert.equal(archived[0].archived, true); assert.equal(archived[1] === sessions[1], true);
  assert.equal(sessions[0].archived, false); assert.equal(updateSessionArchiveState(archived, 'root', false)[0].archived, false);
});


test('real Sidebar search inherits project/archive scope, widens explicitly, forwards result targets and resets toggles on reopening', async t => {
  const sessions = [session('a')]; let expected = { q: 'needle', status: 'active', field: 'all', projectKey: '/repo' };
  const h = await shellHarness(t, { sidebar: true, route: sidebarRoutes(sessions, request => {
    if (request.url.pathname === '/api/sessions/search') {
      exact(request, '/api/sessions/search', expected, { signal: true });
      return { handled: true, data: { results: [{ session: session('result'), kind: 'message', entryId: 'hit-entry', blockIndex: 2, before: '', match: 'needle', after: '', familyArchived: false }], truncated: false } };
    }
  }) }); await h.settled();
  await click(h.view, button(h.view, 'Search conversations'));
  const input = h.view.container.querySelector('#session-search-input'); await inputText(h.view, input, 'needle'); await h.fire(300); await h.settled();
  const checkbox = label => [...h.view.container.querySelectorAll('label')].find(node => node.textContent.trim() === label).querySelector('input');
  expected = { q: 'needle', status: 'both', field: 'title', scope: 'all' };
  for (const label of ['Titles only', 'All projects', 'Active and archived']) await click(h.view, checkbox(label));
  await h.fire(300); await h.settled();
  const result = [...h.view.container.querySelectorAll('button')].find(node => node.querySelector('mark'));
  await click(h.view, result);
  assert.equal(h.current.state.selectedSession.id, 'result');
  assert.deepEqual(h.current.state.searchTarget, { sessionId: 'result', entryId: 'hit-entry', blockIndex: 2 });
  await click(h.view, button(h.view, 'Search conversations')); await click(h.view, button(h.view, 'Search conversations'));
  assert.ok([...h.view.container.querySelectorAll('label input[type="checkbox"]')].every(node => !node.checked));
});

test('actual vertical Sidebar separator preserves startup fallback, resets to averaged live geometry and persists keyboard resize', async t => {
  const measuredHeights = [];
  const h = await shellHarness(t, { sidebar: true, route: sidebarRoutes([session('a')]), setup(window, replace) {
    replace(window.HTMLElement.prototype, 'getBoundingClientRect', function () {
      const height = this.querySelector('[data-testid="file-explorer"]') ? 500 : 300;
      measuredHeights.push(height);
      return { top: 0, left: 0, right: 500, bottom: height, width: 500, height };
    });
  } }); await h.settled();
  const separator = h.view.container.querySelector('[data-resize-handle="sidebar-sections"]'); assert.ok(separator);
  assert.equal(separator.getAttribute('aria-orientation'), 'horizontal');
  const initial = Number(separator.getAttribute('aria-valuenow'));
  // The passive shell mounts before its project/Explorer section exists.
  // The resizer restores once using Sidebar's honest 320 fallback. Later
  // measurement/reclamping does not silently reset that user's current size.
  assert.equal(initial, 320, 'one-shot restore precedes the Explorer ref');
  const beforeResetMeasurements = measuredHeights.length;
  await h.view.dispatch(separator, new h.view.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  const resetMeasurements = measuredHeights.slice(beforeResetMeasurements);
  assert.ok(resetMeasurements.includes(300) && resetMeasurements.includes(500), 'reset uses both actual live pane refs');
  assert.equal(Number(separator.getAttribute('aria-valuenow')), 400, 'Math.round((300 + 500) / 2), not a relaxed initial-size oracle');
  assert.equal(h.view.window.localStorage.getItem('pi-web:sidebar-session-pane-height'), '400');
  await h.view.dispatch(separator, new h.view.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
  assert.equal(Number(separator.getAttribute('aria-valuenow')), 412);
  assert.equal(h.view.window.localStorage.getItem('pi-web:sidebar-session-pane-height'), '412');
});


test('real controller/catalogue project activity projection renders exact accessible running/unread counts', async t => {
  let visible = false;
  const sessions = [session('a'), session('b')];
  const r = await navigationRuntime(t, sidebarRoutes(sessions, request => {
    if (request.url.pathname === '/api/agent/running') {
      exact(request, '/api/agent/running', {}, { cache: 'no-store', signal: true });
      return { handled: true, data: { sessionListVersion: 1, runningSessionIds: ['a'], completedRuns: [{ sessionId: 'b', at: 17 }], reviewedRuns: [], queuedSessionIds: [] } };
    }
  }));
  const controller = r.graph.createActivityClientController({ visible: () => visible }); r.releaseOnClose(() => controller.dispose());
  await r.render(createElement(r.graph.SessionSidebar, { selectedCwd: '/repo', selectedSessionId: null, onSelectSession() {}, activityController: controller }));
  await r.settled();
  await act(async () => { visible = true; controller.refresh(); await controller.whenIdle(); });
  await click(r.view, r.view.container.querySelector('button[title="/repo"]'));
  assert.ok(r.view.container.querySelector('[aria-label="Agent running… (1)"]'));
  assert.ok(r.view.container.querySelector('[aria-label="New session activity (1)"]'));
});


test('actual row Move is proposal-only until confirmation and retargets a selected moved session to the acknowledged destination', async t => {
  let sessions = [session('a'), session('other', '/dest', { projectRoot: '/dest', projectKey: '/dest' })];
  const h = await shellHarness(t, { sidebar: true, route: request => sidebarRoutes(sessions, r => {
    if (r.url.pathname === '/api/worktrees' && r.url.searchParams.get('cwd') === '/dest') return { handled: true, data: { projectRoot: '/dest', projectKey: '/dest', worktrees: [] } };
    if (r.url.pathname === '/api/sessions/worktrees' && r.url.searchParams.get('project') === '/dest') return { handled: true, data: { projectRoot: '/dest', mainCwd: '/dest', worktrees: [] } };
    if (r.url.pathname === '/api/sessions/a/move') {
      exact(r, '/api/sessions/a/move', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { cwd: '/dest' } }); return { handled: true, data: undefined };
    }
  }, { listings: new Map([['/repo', []], ['/dest', []]]) })(request) });
  await h.settled(); await click(h.view, row(h.view, 'a'));
  await click(h.view, button(h.view, 'Move to project…', row(h.view, 'a'))); await h.settled();
  const dialog = h.view.container.querySelector('[role="dialog"]');
  assert.equal(button(h.view, 'Move', dialog).disabled, true);
  await click(h.view, dialog.querySelector('#move-session-project'));
  await click(h.view, dialog.querySelector('[role="option"][data-value="/dest"]')); await h.settled();
  assert.equal(h.requests.some(r => r.url.pathname.endsWith('/move')), false, 'selection only proposes destination');
  await click(h.view, button(h.view, 'Move', dialog));
  sessions = [session('a', '/dest', { projectRoot: '/dest', projectKey: '/dest' }), sessions[1]];
  await h.reply(h.latest('/api/sessions/a/move', 'POST'), { movedIds: ['a'] }); await h.settled();
  assert.equal(h.current.state.selectedSession, null); assert.equal(h.current.state.activeCwd, '/dest');
  assert.equal(h.current.state.newSessionCwd, '/dest');
});

// G-search retirement allocation: real Sidebar/SessionSearch/navigation only.
// Literal query/session/title inputs are retained. /repo and /other-project are
// the existing fixture's disjoint capability identities, NOT native path proof.
test('G-search exact legacy single-toggle archive/title/project requests consume separate bodies and render each empty or matching result', async t => {
  const archived = session('e2e-archive-session', '/repo', { firstMessage: 'E2E archive fixture', archived: true });
  const renamed = { ...archived, name: 'E2E archive fixture' };
  const other = session('e2e-other-project', '/other-project', { firstMessage: 'Other workspace task', projectRoot: '/other-project', projectKey: '/other-project' });
  const empty = { results: [], truncated: false };
  const preview = { results: [{ session: archived, kind: 'preview', entryId: 'root', blockIndex: 0, before: '', match: 'E2E archive fixture', after: '', familyArchived: true }], truncated: false };
  const title = { results: [{ session: renamed, kind: 'title', blockIndex: 0, before: '', match: 'E2E archive fixture', after: '', familyArchived: true }], truncated: false };
  const otherPreview = { results: [{ session: other, kind: 'preview', entryId: 'root', blockIndex: 0, before: '', match: 'Other workspace task', after: '', familyArchived: false }], truncated: false };
  const admissions = []; let expected = null;
  const h = await shellHarness(t, { sidebar: true, isMobile: true, route: sidebarRoutes([archived, other], request => {
    if (request.url.pathname !== '/api/sessions/search') return;
    assert.ok(expected, 'search has a named current external capability stage');
    admissions.push(request);
    return { handled: true, data: undefined };
  }) });
  await h.settled(); await h.cwd('/repo'); await h.settled();
  await click(h.view, button(h.view, 'Search conversations'));
  const searchInput = () => { const node = h.view.container.querySelector('#session-search-input'); assert.ok(node); return node; };
  const checkbox = label => {
    const labels = [...h.view.container.querySelectorAll('label')].filter(node => node.textContent.trim() === label);
    assert.equal(labels.length, 1, `one actual ${label} control`);
    const node = labels[0].querySelector('input[type="checkbox"]'); assert.ok(node); return node;
  };
  const toggle = async (label, checked) => {
    assert.equal(checkbox(label).checked, !checked, `${label} changes individually`);
    await click(h.view, checkbox(label)); assert.equal(checkbox(label).checked, checked);
  };
  const stage = async (name, query, action, data, matches) => {
    expected = query;
    const before = admissions.length;
    let phase = 'action';
    try {
      await action(); phase = 'debounce'; await h.fire(300); phase = 'admission';
      const accepted = admissions.slice(before);
      assert.equal(accepted.length, 1, `${name}: one separately fired debounce admission`);
      phase = 'wire'; exact(accepted[0], '/api/sessions/search', query, { signal: true });
      phase = 'body'; await h.reply(accepted[0], data); await h.settled();
      assert.equal(accepted[0].jsonCalls, 1, `${name}: actual body consumed`);
      phase = 'render';
      assert.deepEqual([...h.view.container.querySelectorAll('button mark')].map(node => node.textContent), matches, `${name}: actual rendered matches`);
      assert.equal(h.view.container.textContent.includes('No matching conversations in this scope'), matches.length === 0, `${name}: actual empty state`);
      expected = null;
    } catch (error) {
      t.diagnostic(JSON.stringify({ searchStage: name, phase, expectedQuery: query, admissionsBefore: before, admissionsAfter: admissions.length, admissionDelta: admissions.length - before }));
      throw error; // preserve the original admission/wire/body/render failure
    }
  };
  await stage('S01 active unnamed archive excluded',
    { q: 'E2E archive fixture', status: 'active', field: 'all', projectKey: '/repo' },
    () => inputText(h.view, searchInput(), 'E2E archive fixture'), empty, []);
  await stage('S02 active+archived includes preview',
    { q: 'E2E archive fixture', status: 'both', field: 'all', projectKey: '/repo' },
    () => toggle('Active and archived', true), preview, ['E2E archive fixture']);
  await stage('S03 title-only excludes unnamed preview',
    { q: 'E2E archive fixture', status: 'both', field: 'title', projectKey: '/repo' },
    () => toggle('Titles only', true), empty, []);
  await stage('S04 title-only off returns preview',
    { q: 'E2E archive fixture', status: 'both', field: 'all', projectKey: '/repo' },
    () => toggle('Titles only', false), preview, ['E2E archive fixture']);
  // The native rename PATCH and durable query readback STAY in Chromium.
  // This fixed external record is its response input, not a fake rename writer.
  await stage('S05 title-only on sees canonical renamed record',
    { q: 'E2E archive fixture', status: 'both', field: 'title', projectKey: '/repo' },
    () => toggle('Titles only', true), title, ['E2E archive fixture']);
  await stage('S06 title-only off still uses all fields',
    { q: 'E2E archive fixture', status: 'both', field: 'all', projectKey: '/repo' },
    () => toggle('Titles only', false), title, ['E2E archive fixture']);
  await stage('S07 both-status off excludes archived renamed record',
    { q: 'E2E archive fixture', status: 'active', field: 'all', projectKey: '/repo' },
    () => toggle('Active and archived', false), empty, []);
  await stage('S08 archived view inherits archived status',
    { q: 'E2E archive fixture', status: 'archived', field: 'all', projectKey: '/repo' },
    () => click(h.view, button(h.view, 'Archived sessions')), title, ['E2E archive fixture']);
  await stage('S09 active view returns to active status',
    { q: 'E2E archive fixture', status: 'active', field: 'all', projectKey: '/repo' },
    () => click(h.view, button(h.view, 'Active sessions')), empty, []);
  await stage('S10 other workspace is absent in current project',
    { q: 'Other workspace task', status: 'active', field: 'all', projectKey: '/repo' },
    () => inputText(h.view, searchInput(), 'Other workspace task'), empty, []);
  await stage('S11 all-projects on replaces projectKey by scope=all',
    { q: 'Other workspace task', status: 'active', field: 'all', scope: 'all' },
    () => toggle('All projects', true), otherPreview, ['Other workspace task']);
  await stage('S12 all-projects off restores exact current project',
    { q: 'Other workspace task', status: 'active', field: 'all', projectKey: '/repo' },
    () => toggle('All projects', false), empty, []);
  await stage('S13 title-only changes alone before reset',
    { q: 'Other workspace task', status: 'active', field: 'title', projectKey: '/repo' },
    () => toggle('Titles only', true), empty, []);
  await stage('S14 close/reopen resets flags, not the literal query',
    { q: 'Other workspace task', status: 'active', field: 'all', projectKey: '/repo' },
    async () => { await click(h.view, button(h.view, 'Search conversations')); await click(h.view, button(h.view, 'Search conversations')); }, empty, []);
  for (const label of ['Titles only', 'Active and archived', 'All projects']) assert.equal(checkbox(label).checked, false);
  assert.equal(searchInput().value, 'Other workspace task');
  assert.equal(h.requests.some(request => ['PATCH', 'DELETE'].includes(request.options.method)), false, 'emulated search records are not native rename/archive authority');
});

test('G-search actual Sidebar joins ignored-abort bodies, repeated scope keys, current body/HTTP errors, retry and unmount without stale publication', async t => {
  const archived = session('e2e-archive-session', '/repo', { firstMessage: 'E2E archive fixture', archived: true });
  const empty = { results: [], truncated: false };
  const preview = { results: [{ session: archived, kind: 'preview', entryId: 'root', blockIndex: 0, before: '', match: 'E2E archive fixture', after: '', familyArchived: true }], truncated: false };
  const admissions = []; let expected = null;
  const h = await shellHarness(t, { sidebar: true, isMobile: true, route: sidebarRoutes([archived], request => {
    if (request.url.pathname !== '/api/sessions/search') return;
    assert.ok(expected, 'held search has a named capability stage');
    admissions.push(request); return { handled: true, data: undefined };
  }) });
  await h.settled(); await h.cwd('/repo'); await h.settled();
  await click(h.view, button(h.view, 'Search conversations'));
  const checkbox = label => {
    const node = [...h.view.container.querySelectorAll('label')].find(node => node.textContent.trim() === label)?.querySelector('input[type="checkbox"]');
    assert.ok(node, `actual ${label} control`); return node;
  };
  const all = { q: 'E2E archive fixture', status: 'active', field: 'all', projectKey: '/repo' };
  const both = { q: 'E2E archive fixture', status: 'both', field: 'all', projectKey: '/repo' };
  const titles = { q: 'E2E archive fixture', status: 'active', field: 'title', projectKey: '/repo' };
  let admissionStage = 0;
  const admit = async (query, action, enterBody = true) => {
    const name = `H${++admissionStage}`;
    expected = query; const before = admissions.length;
    let phase = 'action';
    try {
      await action(); phase = 'debounce'; await h.fire(300); phase = 'admission';
      assert.equal(admissions.length, before + 1, `${name}: one explicit held debounce admission`);
      const request = admissions.at(-1);
      phase = 'wire'; exact(request, '/api/sessions/search', query, { signal: true });
      if (enterBody) { phase = 'body'; await h.headers(request); assert.equal(request.jsonCalls, 1, 'entered actual production JSON continuation'); }
      expected = null; return request;
    } catch (error) {
      t.diagnostic(JSON.stringify({ searchStage: name, phase, expectedQuery: query, admissionsBefore: before, admissionsAfter: admissions.length, admissionDelta: admissions.length - before }));
      throw error; // do not reconstruct or swallow the original failure
    }
  };
  const matches = () => [...h.view.container.querySelectorAll('button mark')].map(node => node.textContent);
  const oldSuccess = await admit(all, () => inputText(h.view, h.view.container.querySelector('#session-search-input'), 'E2E archive fixture'));
  const currentBoth = await admit(both, () => click(h.view, checkbox('Active and archived')));
  assert.equal(oldSuccess.options.signal.aborted, true);
  await h.body(currentBoth, preview);
  assert.deepEqual(matches(), ['E2E archive fixture']);
  await h.body(oldSuccess, empty); await h.settled();
  assert.deepEqual(matches(), ['E2E archive fixture'], 'obsolete successful body cannot replace current scope');

  // A(active)/B(both)/A(active) reuses the exact request key. Deliver both an
  // obsolete body rejection and a stale successful body after current A settles.
  const oldError = await admit(all, () => click(h.view, checkbox('Active and archived')));
  const middle = await admit(both, () => click(h.view, checkbox('Active and archived')));
  const latestA = await admit(all, () => click(h.view, checkbox('Active and archived')));
  assert.equal(oldError.options.signal.aborted, true); assert.equal(middle.options.signal.aborted, true);
  await h.body(latestA, empty);
  const obsoleteBodyError = new Error('controlled obsolete E2E archive search body');
  await h.rejectBody(oldError, obsoleteBodyError);
  await h.body(middle, preview); await h.settled();
  assert.deepEqual(matches(), []);
  assert.equal(h.view.container.textContent.includes('No matching conversations in this scope'), true);
  assert.ok(button(h.view, 'Refresh'), 'obsolete catch must not replace current A by Retry');

  const currentFailure = await admit(titles, () => click(h.view, checkbox('Titles only')));
  const currentBodyError = new Error('controlled current E2E archive search body');
  await h.rejectBody(currentFailure, currentBodyError); await h.settled();
  assert.deepEqual(matches(), []); assert.ok(button(h.view, 'Retry'), 'current body error reaches actual retry UI');
  const httpFailure = await admit(titles, () => click(h.view, button(h.view, 'Retry')), false);
  await h.reply(httpFailure, { error: 'controlled current search refusal' }, 503); await h.settled();
  assert.equal(httpFailure.jsonCalls, 0, 'non-OK HTTP does not masquerade as a consumed body');
  assert.ok(button(h.view, 'Retry'));
  const recovered = await admit(titles, () => click(h.view, button(h.view, 'Retry')));
  await h.body(recovered, empty); await h.settled();
  assert.ok(button(h.view, 'Refresh')); assert.deepEqual(matches(), []);

  const closing = await admit({ q: 'E2E archive fixture', status: 'active', field: 'title', scope: 'all' }, () => click(h.view, checkbox('All projects')));
  await h.view.unmount(); assert.equal(closing.options.signal.aborted, true);
  const afterUnmountError = new Error('controlled closing E2E archive search body');
  await h.rejectBody(closing, afterUnmountError); await h.settled();
  assert.equal(h.view.container.childNodes.length, 0);
  h.assertHealthy();
  // No new fixture/collector/cancellation policy: the existing runtime releases
  // every peer on assertion failure, joins NavigationWork and independent owners,
  // restores realm descriptors before disposal and host descriptors afterwards.
});
