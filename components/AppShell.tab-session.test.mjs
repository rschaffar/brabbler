import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exact } from './navigation-runtime.fixture.mjs';
import { shellHarness, session } from './navigation-cases.fixture.mjs';

test('URL-only SSR first paint and real mounted tab restoration use different admission phases', async t => {
  const h = await shellHarness(t, { setup(window) { window.sessionStorage.setItem('pi-web:tab-open-session', JSON.stringify({ kind: 'session', sessionId: 'tab/id' })); } });
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
    window.sessionStorage.setItem('pi-web:tab-open-session', 'other-tab');
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
    if (remembered) window.sessionStorage.setItem('pi-web:tab-open-session', JSON.stringify(remembered));
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


test('real created and forked transitions share saved-session tab/workspace persistence outside Sidebar selection', async t => {
  const h = await shellHarness(t, { route(request) {
    exact(request, '/api/sessions', {}, { cache: 'no-store' }); return { sessions: [session('saved'), session('forked')] };
  } });
  await h.command(c => c.navigation.handleNewSession('draft', '/repo'));
  await h.command(c => c.navigation.handleSessionCreated(session('saved'), 'new:draft:/repo')); await h.settled();
  assert.equal(h.graph.tabMemory.getTabOpen().sessionId, 'saved'); assert.equal(h.graph.workspaceMemory.getLastOpenSession('/repo'), 'saved');
  await h.command(c => c.navigation.handleSessionForked('forked')); await h.settled();
  assert.equal(h.graph.tabMemory.getTabOpen().sessionId, 'forked'); assert.equal(h.graph.workspaceMemory.getLastOpenSession('/repo'), 'forked');
});
