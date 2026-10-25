import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { navigationRuntime, exact, session, click, button } from './navigation-runtime.fixture.mjs';
import { shellHarness, sidebarRoutes } from './navigation-cases.fixture.mjs';

function gate(h) {
  const result = deferred(); h.releaseOnClose(() => result.resolve()); return result;
}

test('real System/Tools controls load only on opening, not cached data or closing; current loader replaces prior publication', async t => {
  const h = await shellHarness(t);
  await h.cwd('/repo');
  let loads = 0;
  const first = gate(h);
  await h.command(c => c.systemInfo.handleSystemInfoLoaderChange(() => { loads++; return first.promise; }));
  assert.equal(loads, 0, 'registering loader is inert');
  await click(h.view, button(h.view, 'System prompt'));
  assert.equal(loads, 1); assert.equal(h.current.activeTopPanel, 'system');
  assert.equal(h.current.systemInfo.systemInfoLoading, true);
  await click(h.view, button(h.view, 'Tool definitions'));
  assert.equal(h.current.activeTopPanel, 'tools'); assert.equal(loads, 1, 'opening peer while busy shares current admission');
  first.resolve(); await h.settled();
  assert.equal(h.current.systemInfo.systemInfoLoading, false);
  await h.command(c => {
    c.systemInfo.handleSystemPromptChange('cached real publication');
    c.systemInfo.handleSystemToolsChange([]);
  });
  await click(h.view, button(h.view, 'Tool definitions'));
  assert.equal(h.current.activeTopPanel, null); assert.equal(loads, 1, 'closing never loads');
  await h.command(c => c.systemInfo.handleSystemInfoLoaderChange(async () => { loads++; }));
  await click(h.view, button(h.view, 'System prompt')); await h.settled();
  assert.equal(loads, 2, 'cached prompt does not replace the current loader');
  assert.equal(h.current.systemInfo.systemPrompt, 'cached real publication');
});

test('real toolbar loader IDs fence held old finally after replacement/null invalidation and a newer load', async t => {
  const h = await shellHarness(t), old = gate(h), replacement = gate(h), latest = gate(h);
  await h.cwd('/repo');
  let calls = '';
  await h.command(c => c.systemInfo.handleSystemInfoLoaderChange(() => { calls += 'A'; return old.promise; }));
  await click(h.view, button(h.view, 'System prompt'));
  await h.command(c => c.systemInfo.handleSystemInfoLoaderChange(() => { calls += 'B'; return replacement.promise; }));
  assert.equal(h.current.systemInfo.systemInfoLoading, false);
  await click(h.view, button(h.view, 'Tool definitions'));
  assert.equal(calls, 'AB'); assert.equal(h.current.systemInfo.systemInfoLoading, true);
  await act(async () => { old.resolve(); await old.promise; });
  assert.equal(h.current.systemInfo.systemInfoLoading, true, 'old finally cannot clear replacement loading');
  await h.command(c => c.systemInfo.handleSystemInfoLoaderChange(null));
  assert.equal(h.current.systemInfo.systemInfoLoading, false);
  await click(h.view, button(h.view, 'System prompt'));
  assert.equal(calls, 'AB', 'null loader is not a dormant-session startup command');
  await h.command(c => c.systemInfo.handleSystemInfoLoaderChange(() => { calls += 'C'; return latest.promise; }));
  await click(h.view, button(h.view, 'Tool definitions'));
  assert.equal(calls, 'ABC');
  await act(async () => { replacement.resolve(); await replacement.promise; });
  assert.equal(h.current.systemInfo.systemInfoLoading, true, 'null invalidation plus newer load rejects obsolete finalizer');
  latest.resolve(); await h.settled(); assert.equal(h.current.systemInfo.systemInfoLoading, false);
});

test('real Sidebar URL restoration and real Activity publication reach the default React chat-input adapter', async t => {
  const saved = session('running'); let visible = false, current, chat;
  let projectStage = 'restored', pendingCheckout;
  const historyAdmissions = [], expectedTransitionHistory = [];
  const canonicalCheckout = { projectRoot: '/repo', projectKey: '/repo', isGit: false, isTopLevel: false,
    currentWorktreePath: null, worktrees: [], localBranches: [] };
  const r = await navigationRuntime(t, sidebarRoutes([saved], request => {
    if (request.url.pathname === '/api/sessions') {
      const query = Object.fromEntries(request.url.searchParams);
      assert.ok(JSON.stringify(query) === '{}' || JSON.stringify(query) === '{"force":"1"}' || JSON.stringify(query) === '{"summary":"1"}');
      exact(request, '/api/sessions', query, { cache: 'no-store' });
      return { handled: true, data: { sessions: [saved], sessionListVersion: 1, runningSessionIds: ['running'] } };
    }
    if (request.url.pathname === '/api/sessions/worktrees') {
      // Fixed identity tuples, not an echo/allowlist of whatever query arrived.
      // Strict replay may repeat the restored stage; transition admission is
      // explicitly ordered and canonical reads cannot bypass its provisional one.
      const expected = projectStage === 'restored'
        ? { stage: 'restored', project: '/repo' }
        : projectStage === 'canonical'
          ? { stage: 'canonical', project: '/repo' }
          : expectedTransitionHistory.shift();
      assert.ok(expected, 'declared history-inventory stage remains');
      exact(request, '/api/sessions/worktrees', { project: expected.project }, { signal: true, cache: 'no-store' });
      historyAdmissions.push(expected);
      if (expected.stage === 'canonical') projectStage = 'canonical';
      // Same response payload as the existing scoped fixture. This history
      // inventory does not supply working cwd/project authority to Sidebar.
      return { handled: true, data: { project: '/repo', mainCwd: '/repo', worktrees: [] } };
    }
    if (request.url.pathname === '/api/worktrees' && request.url.searchParams.get('cwd') === '/repo/worktree') {
      exact(request, '/api/worktrees', { cwd: '/repo/worktree' }, { signal: false });
      if (!pendingCheckout) {
        pendingCheckout = request;
        return { handled: true, data: undefined }; // hold the actual canonical-identity response
      }
      return { handled: true, data: canonicalCheckout };
    }
    if (request.url.pathname === '/api/agent/running') {
      exact(request, '/api/agent/running', {}, { signal: true, cache: 'no-store' });
      return { handled: true, data: { sessionListVersion: 1, runningSessionIds: [], queuedSessionIds: [], completedRuns: [], reviewedRuns: [] } };
    }
  }, { listings: new Map([['/repo', []], ['/repo/worktree', []]]) }));
  const controller = r.graph.createActivityClientController({ visible: () => visible });
  r.releaseOnClose(() => controller.dispose());
  const props = { search: 'session=running', router: { replace() {} },
    sidebar: { activityController: controller, onOpenFile() {} }, chatController: controller,
    onCommit: value => { current = value; }, onChatCommit: value => { chat = value; } };
  await r.render(createElement(r.graph.NavigationHarness, props)); await r.settled();
  assert.equal(current.state.selectedSession.id, 'running', 'actual Sidebar adopted URL session');
  assert.equal(chat.session === current.state.selectedSession, true);
  assert.equal(chat.sessionRunning, true, 'accepted catalogue running fallback publishes through actual subscribed adapter');
  assert.equal(chat.onSessionCreated === current.navigation.handleSessionCreated, true);
  await act(async () => { visible = true; controller.refresh(); await controller.whenIdle(); });
  assert.equal(chat.sessionRunning, false, 'authoritative real controller publication repairs restored running');
  assert.equal(chat.session.id, 'running');
  projectStage = 'awaiting-canonical';
  expectedTransitionHistory.push(
    { stage: 'provisional', project: '/repo/worktree' },
    { stage: 'canonical', project: '/repo' },
  );
  const historyBeforeNew = historyAdmissions.length;
  await act(async () => { current.navigation.handleNewSession('new-key', '/repo/worktree'); });
  assert.ok(pendingCheckout, 'actual working-checkout identity request is admitted and held');
  assert.deepEqual(historyAdmissions.slice(historyBeforeNew), [{ stage: 'provisional', project: '/repo/worktree' }],
    'pre-canonical history request uses the exact newly selected cwd');
  await r.reply(pendingCheckout, canonicalCheckout);
  await r.settled();
  assert.equal(expectedTransitionHistory.length, 0, 'both named transition requests were admitted');
  assert.deepEqual(historyAdmissions.slice(historyBeforeNew, historyBeforeNew + 2), [
    { stage: 'provisional', project: '/repo/worktree' },
    { stage: 'canonical', project: '/repo' },
  ], 'server canonical identity changes history scope only after its real response');
  assert.equal(chat.session, null); assert.equal(chat.sessionRunning, false);
  assert.equal(chat.newSessionCwd, '/repo/worktree');
  assert.equal(chat.newSessionDraftKey, 'new:new-key:/repo/worktree'); assert.equal(chat.persistNewSession, true);
  const refresh = current.state.refreshKey;
  await act(async () => { chat.onSessionCreated(session('obsolete'), 'new:other:/repo'); });
  assert.equal(chat.session, null); assert.equal(current.state.newSessionDraftId, 'new-key');
  assert.equal(current.state.refreshKey, refresh + 1, 'obsolete creation refreshes but cannot replace current composer');
  // This is the production default React adapter, not full ChatWindow/SSE.
  // Existing installed Activity/history/native new-session chains stay intact.
});
