import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exact } from './navigation-runtime.fixture.mjs';
import { shellHarness, session, sidebarRoutes } from './navigation-cases.fixture.mjs';

test('URL-only SSR first paint and real mounted tab restoration use different admission phases', async t => {
  const h = await shellHarness(t, { setup(window) { window.sessionStorage.setItem('brabbler:tab-open-session', JSON.stringify({ kind: 'session', sessionId: 'tab/id' })); } });
  const html = renderToStaticMarkup(createElement(h.graph.NavigationFirstPaint, { search: '' }));
  assert.match(html, /data-session=""/);
  assert.equal(h.current.state.initialSessionId, 'tab/id', 'layout adoption uses real tab storage after first render');
  assert.equal(h.current.navigation.initialSessionRestored, false);
  await h.select(session('tab/id'), true);
  assert.equal(h.routerCalls.at(-1), '?session=tab%2Fid');
  assert.equal(h.graph.tabMemory.getTabOpen().sessionId, 'tab/id');
});

test('explicit URL wins tab memory; background restore avoids redundant router replacement', async t => {
  const h = await shellHarness(t, { search: 'session=url', setup(window) {
    window.history.replaceState(null, '', '?session=url');
    window.sessionStorage.setItem('brabbler:tab-open-session', 'other-tab');
  } });
  assert.equal(h.current.state.initialSessionId, 'url');
  await h.select(session('url'), true);
  assert.deepEqual(h.routerCalls, []);
  await h.select(session('explicit'), false);
  assert.deepEqual(h.routerCalls, ['?session=explicit']);
  assert.equal(h.graph.tabMemory.getTabOpen().sessionId, 'explicit');
  assert.equal(h.graph.workspaceMemory.getLastOpenSession('/repo'), 'explicit');
});

test('New records provisional selection synchronously; delete forgets saved tab selection and confirmed/uncertain moves remain distinct', async t => {
  const h = await shellHarness(t);
  await h.select(session('a'));
  await h.command(c => c.navigation.handleNewSession('new-id', '/repo worktree'));
  assert.deepEqual(h.graph.tabMemory.getTabOpen(), { kind: 'new', cwd: '/repo worktree', draftId: 'new-id' });
  assert.equal(h.routerCalls.at(-1), '?cwd=%2Frepo%20worktree');
  await h.select(session('a'));
  await h.command(c => c.navigation.handleSessionDeleted('a', null, false));
  assert.equal(h.current.state.selectedSession.cwdState, 'unavailable');
  assert.equal(h.current.state.selectedSession.id, 'a');
  const refresh = h.current.state.refreshKey;
  await h.command(c => c.navigation.handleSessionDeleted('a', '/destination', false));
  assert.equal(h.current.state.selectedSession, null);
  assert.equal(h.current.state.activeCwd, '/destination');
  assert.equal(h.current.state.newSessionCwd, '/destination');
  assert.equal(h.current.state.refreshKey, refresh);
  assert.equal(h.graph.tabMemory.getTabOpen().kind, 'new');
  assert.equal(h.graph.tabMemory.getTabOpen().cwd, '/destination');
});

for (const remembered of [null, { kind: 'new', cwd: '/other', draftId: 'foreign' }, { kind: 'new', cwd: '/pending', draftId: 'pending-id' }]) test(`reload recovers matching provisional text identity without startup replay: ${remembered?.draftId ?? 'none'}`, async t => {
  const h = await shellHarness(t, { search: 'cwd=%2Fpending', setup(window) {
    if (remembered) window.sessionStorage.setItem('brabbler:tab-open-session', JSON.stringify(remembered));
  }, route(request) {
    exact(request, '/api/cwd/validate', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { cwd: '/pending' }, signal: true });
    return { cwd: '/pending' };
  } });
  await h.settled();
  assert.equal(h.current.state.newSessionDraftId, remembered?.cwd === '/pending' ? 'pending-id' : 'initial:/pending');
  assert.equal(h.current.state.persistNewSession, false);
  assert.equal(h.current.state.newSessionCwd, '/pending');
  assert.ok(h.requests.every(request => request.url.pathname === '/api/cwd/validate'), 'no /api/agent/new replay');
  // Explicitly awaited actual callback boundary, not a timing flush.
  await act(async () => { h.current.navigation.handleInitialRestoreDone(); });
  assert.equal(h.current.navigation.initialSessionRestored, true);
});


test('late uncertain-Move settlement never restores its captured source after canonical destination metadata', async t => {
  const source = '/source', destination = '/destination';
  const original = session('moved', source, { projectRoot: source, projectKey: source, cwdState: 'missing' });
  const peer = session('peer', destination, { projectRoot: destination, projectKey: destination, cwdState: 'present' });
  const moved = { ...original, cwd: destination, projectRoot: destination, projectKey: destination, cwdState: 'present' };
  let catalogue = [original, peer];
  const h = await shellHarness(t, { sidebar: true, search: 'session=moved', route: sidebarRoutes(catalogue, request => {
    if (request.url.pathname === '/api/sessions') {
      const query = Object.fromEntries(request.url.searchParams);
      exact(request, '/api/sessions', query, { cache: 'no-store' });
      return { handled: true, data: { sessions: catalogue, sessionListVersion: 1, runningSessionIds: [] } };
    }
    if (request.url.pathname === '/api/sessions/worktrees') {
      const project = request.url.searchParams.get('project');
      assert.ok([source, destination].includes(project));
      exact(request, '/api/sessions/worktrees', { project }, { signal: true, cache: 'no-store' });
      return { handled: true, data: { project, mainCwd: project, worktrees: [] } };
    }
    if (request.url.pathname === '/api/worktrees') {
      const cwd = request.url.searchParams.get('cwd');
      assert.ok([source, destination].includes(cwd));
      exact(request, '/api/worktrees', { cwd });
      return { handled: true, data: { projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [], localBranches: [] } };
    }
  }, { listings: new Map([[source, []], [destination, []]]) }) });
  await h.settled();
  assert.equal(h.current.state.selectedSession?.id, original.id);
  assert.equal(h.current.state.selectedSession?.cwdState, 'missing');
  const commits = [], onCommit = h.props.onCommit;
  await h.update({ onCommit(value) {
    onCommit(value);
    commits.push({ id: value.state.selectedSession?.id ?? null, cwd: value.state.selectedSession?.cwd,
      composer: value.navigation.effectiveNewSessionCwd, active: value.state.activeCwd });
  } });
  // The operation captured this real callback before dispatch. Canonical
  // metadata can arrive while its lost execute/reconcile replies are pending;
  // their eventual settlement must invalidate the current selected incarnation,
  // not put the captured source row back on screen.
  const settleDispatchedMove = h.current.navigation.handleSessionDeleted;
  catalogue = [moved, peer];
  await h.command(value => value.state.setRefreshKey(key => key + 1));
  await h.settled();
  assert.equal(h.current.state.selectedSession?.id, original.id, 'canonical metadata retains the moved session');
  assert.equal(h.current.state.selectedSession?.cwd, destination);
  const boundary = commits.length, routerBoundary = h.routerCalls.length, requestBoundary = h.requests.length;
  const selectedKey = h.current.state.sessionKey;
  await h.command(() => settleDispatchedMove(original.id, null, false));
  await h.settled();
  assert.deepEqual(commits.slice(boundary).filter(value => value.cwd === source || value.id === null && value.composer === source), [],
    'late settlement must not restore the captured source or expose an unbound source composer');
  assert.equal(h.current.state.selectedSession?.id, original.id);
  assert.equal(h.current.state.selectedSession?.cwd, destination);
  assert.equal(h.current.state.selectedSession?.cwdState, 'unavailable', 'uncertain outcome still invalidates working authority');
  assert.equal(h.current.state.sessionKey, selectedKey + 1, 'the intentional history-only remount remains');
  assert.equal(h.routerCalls.length, routerBoundary, 'settlement never clears the selected-session URL');
  assert.equal(h.requests.slice(requestBoundary).some(request => request.url.searchParams.get('cwd') === source || request.url.pathname === '/api/files/source'), false);
  assert.notEqual(h.current.navigation.effectiveNewSessionCwd, source);

  await h.select(peer);
  const peerKey = h.current.state.sessionKey, peerRoutes = h.routerCalls.length;
  for (const replacement of [undefined, null, '/confirmed-destination']) {
    await h.command(() => settleDispatchedMove(original.id, replacement, false));
    assert.equal(h.current.state.selectedSession?.id, peer.id, 'old settlement cannot clear or resurrect over a newer selection');
    assert.equal(h.current.state.sessionKey, peerKey);
    assert.equal(h.routerCalls.length, peerRoutes);
  }
});

test('real created and forked transitions share saved-session tab/workspace persistence outside Sidebar selection', async t => {
  const { encodeSessionCatalogue } = await import('../lib/session-catalogue-wire.ts');
  const text = 'full hydration prompt '.repeat(100) + 'tail sentinel';
  const saved = session('saved', '/repo', { name: 'Saved title', firstMessage: text });
  const forked = session('forked', '/repo', { name: 'Fork title', firstMessage: text });
  const encoded = JSON.parse(JSON.stringify(encodeSessionCatalogue([saved, forked]))); assert.equal(encoded.format, 1);
  const h = await shellHarness(t, { route(request) {
    exact(request, '/api/sessions', { compact: '1' }, { cache: 'no-store' }); return { sessions: encoded };
  } });
  await h.command(c => c.navigation.handleNewSession('draft', '/repo'));
  await h.command(c => c.navigation.handleSessionCreated(session('saved'), 'new:draft:/repo')); await h.settled();
  assert.equal(h.current.state.selectedSession.firstMessage, text, 'created-session hydration decodes the HTTP body');
  assert.equal(h.current.state.selectedSession.name, saved.name);
  assert.equal(h.graph.tabMemory.getTabOpen().sessionId, 'saved'); assert.equal(h.graph.workspaceMemory.getLastOpenSession('/repo'), 'saved');
  await h.command(c => c.navigation.handleSessionForked('forked')); await h.settled();
  assert.equal(h.current.state.selectedSession.firstMessage, text, 'fork hydration preserves complete metadata');
  assert.equal(h.current.state.selectedSession.name, forked.name);
  assert.equal(h.graph.tabMemory.getTabOpen().sessionId, 'forked'); assert.equal(h.graph.workspaceMemory.getLastOpenSession('/repo'), 'forked');
});
