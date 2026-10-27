import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { navigationRuntime, exact, session, click, button } from './navigation-runtime.fixture.mjs';
import { shellHarness, sidebarRoutes } from './navigation-cases.fixture.mjs';
import { sessionFixture } from '../hooks/agent-session-mounted.fixture.mjs';

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
      assert.ok(['{"compact":"1"}', '{"force":"1","compact":"1"}', '{"summary":"1","compact":"1"}'].includes(JSON.stringify(query)));
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

// Four-way navigation policy in the existing physical graph. This case is NOT
// AppShell/backdrop or the public caller; the separate real caller case follows.
test('actual URL catalogue adoption preserves both overviews; mobile New keeps its different-cwd draft across late source bodies and obsolete creation callbacks', async t => {
  for (const isMobile of [false, true]) {
    for (const overview of ['activity', 'starred']) {
      await t.test(`${isMobile ? 'mobile' : 'desktop'} / ${overview}`, async t => {
        const saved = session('url-original', '/repo');
        const staleSource = session('url-original', '/repo/obsolete-source');
        const destination = '/other';
        const catalogueRequests = [], routerCalls = [];
        let current, chat, visible = false, holdCatalogue = true;
        let catalogueData = { sessions: [saved], sessionListVersion: 1, runningSessionIds: ['url-original'] };
        const checkout = { projectRoot: destination, projectKey: destination, isGit: false, isTopLevel: false,
          currentWorktreePath: null, worktrees: [], localBranches: [] };
        const r = await navigationRuntime(t, sidebarRoutes([saved], request => {
          if (request.url.pathname === '/api/sessions') {
            const query = JSON.stringify(Object.fromEntries(request.url.searchParams));
            assert.equal(['{"compact":"1"}', '{"force":"1","compact":"1"}', '{"summary":"1","compact":"1"}'].includes(query), true, 'declared catalogue query');
            exact(request, '/api/sessions', query === '{"compact":"1"}' ? { compact: '1' } : query === '{"force":"1","compact":"1"}' ? { force: '1', compact: '1' } : { summary: '1', compact: '1' }, { cache: 'no-store' });
            catalogueRequests.push(request);
            return { handled: true, data: holdCatalogue ? undefined : catalogueData };
          }
          if (request.url.pathname === '/api/sessions/worktrees') {
            const project = request.url.searchParams.get('project');
            assert.equal(project === '/repo' || project === '/other', true, 'only the original source or explicit destination inventory');
            exact(request, '/api/sessions/worktrees', project === '/repo' ? { project: '/repo' } : { project: '/other' }, { signal: true, cache: 'no-store' });
            return { handled: true, data: { project: project === '/repo' ? '/repo' : '/other', mainCwd: project === '/repo' ? '/repo' : '/other', worktrees: [] } };
          }
          if (request.url.pathname === '/api/worktrees' && request.url.searchParams.get('cwd') === destination) {
            exact(request, '/api/worktrees', { cwd: '/other' }, { signal: false });
            return { handled: true, data: checkout };
          }
          if (request.url.pathname === '/api/agent/running') {
            exact(request, '/api/agent/running', {}, { signal: true, cache: 'no-store' });
            return { handled: true, data: { sessionListVersion: 1, runningSessionIds: [], queuedSessionIds: [], completedRuns: [], reviewedRuns: [] } };
          }
        }, { listings: new Map([['/repo', []], ['/other', []]]) }), window => {
          window.history.replaceState(null, '', '/?session=url-original');
        });
        // The reused runtime registers cleanup/transport before graph import.
        // All accepted bodies are released before the separate NavigationWork
        // join. Even a failing peer release must not strand another request.
        const releaseCatalogues = data => {
          const failures = [];
          for (const request of catalogueRequests) {
            if (request.answered) continue;
            try { request.reply(data, 200); } catch (error) { failures.push(error); }
          }
          if (failures.length === 1) throw failures[0];
          if (failures.length) throw new AggregateError(failures, 'catalogue releases');
        };
        r.releaseOnClose(() => releaseCatalogues(catalogueData));
        const controller = r.graph.createActivityClientController({ visible: () => visible });
        r.releaseOnClose(() => controller.dispose());
        await r.render(createElement(r.graph.NavigationHarness, {
          search: 'session=url-original', isMobile,
          router: { replace: (href, options) => routerCalls.push({ href, scroll: options.scroll }) },
          sidebar: { activityController: controller, onOpenFile() {} }, chatController: controller,
          onCommit: value => { current = value; }, onChatCommit: value => { chat = value; },
        }));
        assert.equal(current.state.initialSessionId, 'url-original');
        assert.equal(current.state.selectedSession === null, true, 'initial URL has not adopted a catalogue row');
        assert.equal(catalogueRequests.length > 0, true, 'actual Sidebar catalogue was admitted before opening the overview');
        await click(r.view, button(r.view, overview === 'activity' ? 'Activity' : 'Starred'));
        assert.equal(current.activeOverview, overview);
        holdCatalogue = false;
        await act(async () => { releaseCatalogues(catalogueData); });
        await r.settled();
        const consumedCatalogues = catalogueRequests.filter(request => request.jsonCalls > 0);
        assert.equal(consumedCatalogues.length > 0, true, 'an original catalogue JSON body was consumed');
        for (const request of consumedCatalogues) assert.equal(await request.body.promise, catalogueData, 'same original consumed body, independently joined after NavigationWork');
        assert.equal(current.state.selectedSession?.id, 'url-original', 'real Sidebar URL adoption ran');
        assert.equal(current.state.selectedSession?.cwd, '/repo');
        assert.equal(current.state.selectedSession?.path, '/saved/url-original.jsonl');
        assert.equal(chat.session === current.state.selectedSession, true, 'actual default chat adapter receives the selected source');
        assert.equal(chat.sessionRunning, true, 'catalogue fallback reaches the subscribed chat adapter');
        assert.equal(current.activeOverview, overview, 'background URL adoption must preserve the already-open overview');
        await act(async () => { visible = true; controller.refresh(); await controller.whenIdle(); });
        await r.settled();
        assert.equal(chat.sessionRunning, false, 'a real foreground controller generation replaces the catalogue fallback');
        assert.equal(current.activeOverview, overview, 'foreground running publication is not explicit navigation');
        assert.equal(chat.session?.id, 'url-original');

        if (!isMobile) {
          await act(async () => { current.navigation.handleSidebarSelectSession(saved, false); });
          assert.equal(current.activeOverview, null, 'explicit selection still closes the overview');
          r.assertHealthy();
          return;
        }

        holdCatalogue = true;
        const beforeHydration = catalogueRequests.length;
        await act(async () => { current.navigation.handleSessionSettled(); });
        const oldSources = catalogueRequests.slice(beforeHydration);
        assert.equal(oldSources.some(request => request.url.search === '?compact=1'), true, 'the actual selected-source hydrator is held');
        // Admit original JSON bodies, not a fake completed hydrate result. Do
        // not join while another accepted body is intentionally held.
        for (const request of oldSources) await r.headers(request);
        assert.equal(oldSources.some(request => request.jsonCalls > 0), true, 'actual source body consumption started');
        const firstDraftId = `${overview}-new-A`;
        await act(async () => { current.navigation.handleNewSession(firstDraftId, destination); });
        const firstDraftKey = `new:${firstDraftId}:/other`, firstChat = chat;
        assert.equal(current.activeOverview, null, 'mobile New closes either actual overview');
        assert.equal(current.overviewMobileList, true);
        assert.equal(current.sidebarOpen, false);
        assert.equal(current.chatHidden, false);
        assert.equal(current.state.selectedSession === null, true);
        assert.equal(chat.session === null, true);
        assert.equal(chat.newSessionCwd, '/other', 'New never borrows the original selected-source cwd');
        assert.equal(chat.newSessionDraftKey, firstDraftKey);
        assert.equal(chat.persistNewSession, true);
        assert.equal(chat.onSessionCreated === current.navigation.handleSessionCreated, true);
        assert.equal(routerCalls.at(-1)?.href, '?cwd=%2Fother');
        assert.equal(routerCalls.at(-1)?.scroll, false);

        catalogueData = { sessions: [staleSource], sessionListVersion: 2, runningSessionIds: [] };
        holdCatalogue = false;
        const [hydration] = await Promise.allSettled([act(async () => {
          releaseCatalogues(catalogueData);
          await r.work.settle();
        })]);
        // Inspect the actual selected identity before the independent transport
        // guard can obscure it with downstream undeclared obsolete-cwd reads.
        // Retain any original join failure as well; never clear the guard.
        const hydrationFailures = [];
        try { assert.equal(current.state.selectedSession === null, true, 'late selected-source hydration cannot select over New'); }
        catch (error) { hydrationFailures.push(error); }
        if (hydration.status === 'rejected') hydrationFailures.push(hydration.reason);
        if (hydrationFailures.length === 1) throw hydrationFailures[0];
        if (hydrationFailures.length) throw new AggregateError(hydrationFailures, 'source identity and independent hydration join failed');
        assert.equal(oldSources.some(request => request.bodyReturned), true, 'the late different-cwd original body really returned');
        r.assertHealthy();
        assert.equal(chat.session === null, true);
        assert.equal(chat.newSessionDraftKey, firstDraftKey, 'late catalogue keeps the current New incarnation');
        assert.equal(chat.newSessionCwd, '/other');
        assert.equal(current.state.activeNewSessionDraftKeyRef.current, firstDraftKey);
        assert.equal(current.activeOverview, null);

        const secondDraftId = `${overview}-new-B`, secondDraftKey = `new:${secondDraftId}:/other`;
        await act(async () => { current.navigation.handleNewSession(secondDraftId, destination); });
        const obsolete = session(`${overview}-created-A`, destination, { projectRoot: '/other', projectKey: '/other', messageCount: 0 });
        await act(async () => { firstChat.onSessionCreated(obsolete, firstDraftKey); });
        await r.settled();
        assert.equal(current.state.selectedSession === null, true, 'obsolete creation callback cannot replace the newer New');
        assert.equal(chat.newSessionDraftKey, secondDraftKey);
        assert.equal(chat.newSessionCwd, '/other');
        const created = session(`${overview}-created-B`, destination, { projectRoot: '/other', projectKey: '/other', messageCount: 0 });
        catalogueData = { sessions: [saved, created], sessionListVersion: 3, runningSessionIds: [] };
        await act(async () => { chat.onSessionCreated(created, secondDraftKey); });
        await r.settled();
        assert.equal(current.state.selectedSession?.id, `${overview}-created-B`);
        assert.equal(current.state.selectedSession?.cwd, '/other');
        assert.equal(chat.session === current.state.selectedSession, true);
        assert.equal(chat.newSessionDraftKey, null);
        assert.equal(current.activeOverview, null);
        r.assertHealthy();
        // onSessionCreated is the REAL navigation callback, but these supplied
        // data rows are not a public ChatInput.ensure/native SDK completion.
        // No durable-empty-context, overlay, inert, Back or focus claim here.
      });
    }
  }
});

test('actual persistent New public ChatWindow ensure promotes through the real navigation callback without a prompt', async t => {
  const saved = session('public-source', '/repo');
  const destination = '/other';
  let current, chat, graph, renderPublic = false;
  const routerCalls = [], compositionOwners = [];
  const route = sidebarRoutes([saved], request => {
    if (request.url.pathname === '/api/worktrees') {
      const cwd = request.url.searchParams.get('cwd');
      assert.equal(['/repo', '/other'].includes(cwd), true);
      exact(request, '/api/worktrees', { cwd }, { signal: false });
      return { handled: true, data: { projectRoot: cwd, projectKey: cwd, isGit: false, isTopLevel: false,
        currentWorktreePath: null, worktrees: [], localBranches: [] } };
    }
    if (request.url.pathname === '/api/sessions/worktrees') {
      const project = request.url.searchParams.get('project');
      assert.equal(['/repo', '/other'].includes(project), true);
      exact(request, '/api/sessions/worktrees', { project }, { signal: true, cache: 'no-store' });
      return { handled: true, data: { project, mainCwd: project, worktrees: [] } };
    }
  }, { listings: new Map([['/repo', []], ['/other', []]]) });
  let controller, navigationWork, f;
  const navigationProps = {
    search: 'session=public-source', isMobile: true,
    router: { replace(href, options) {
      assert.deepEqual(options, { scroll: false }); routerCalls.push(href);
      // Initial Sidebar effects may navigate before mount returns its view.
      globalThis.window.history.replaceState(null, '', href);
    } },
    onCommit: value => { current = value; }, onChatCommit: value => { chat = value; },
  };
  f = await sessionFixture(t, { defaultChat: true, mobile: true, fixtureCwd: destination,
    navigationRoute: route, compositionOwners,
    defaultComposition(renderDefault) {
      return createElement(graph.NavigationWorkContext.Provider, { value: navigationWork },
        createElement(graph.NavigationHarness, { ...navigationProps,
          sidebar: { activityController: controller, onOpenFile() {} }, chatController: controller,
          renderChat: (binding, key) => renderPublic ? renderDefault(binding, key) : null,
        }));
    },
  });
  graph = await f.navigationGraph();
  navigationWork = new graph.NavigationWork();
  controller = graph.createActivityClientController({ visible: () => false });
  compositionOwners.push(
    { release() {}, settle: () => navigationWork.settle() },
    { release: () => controller.dispose(), settle: () => controller.whenIdle() },
  );
  const ensure = f.hold(request => request.path === '/api/agent/new', { stage: 'body', repeat: true });
  await f.mount({ soundEnabled: false });
  await f.settleDefault();
  assert.equal(current.state.selectedSession?.id, saved.id);
  assert.equal(current.state.selectedSession?.cwd, '/repo');
  assert.equal(f.defaultOwners.size, 0, 'the source navigation row is not substituted by a second chat fixture');
  await click(f.view, button(f.view, 'Activity'));
  assert.equal(current.activeOverview, 'activity');
  await f.run('real navigation New publishes directly to the public default caller', () => {
    renderPublic = true;
    current.navigation.handleNewSession('public-new', destination);
  });
  await ensure.entered.promise;
  assert.equal(current.state.selectedSession === null, true, 'original ensure body remains held before actual promotion');
  assert.equal(current.activeOverview, null);
  assert.equal(chat.newSessionDraftKey, 'new:public-new:/other');
  assert.equal(f.composedOptions.persistNewSession, true);
  assert.equal(f.composedOptions.onSessionCreated === current.navigation.handleSessionCreated, true, 'actual public prop is the real navigation receiver');
  assert.equal(f.defaultOwners.size > 0, true, 'real public default hook/view owners were admitted');
  const ensures = f.requests.filter(request => request.path === '/api/agent/new');
  assert.equal(ensures.length > 0, true, 'actual public persistent New admitted ensure');
  for (const request of ensures) {
    assert.equal(request.method, 'POST');
    assert.equal(request.body.type, 'ensure_session');
    assert.equal(request.body.cwd, destination);
  }
  await f.deliver(ensure, { sessionId: f.savedId, model: { provider: 'mounted-fixture', modelId: 'B' }, thinkingLevel: 'high', modelSpeed: 'standard' });
  // Inspect actual callback adoption before waiting on its success-dependent
  // source. Missing propagation must be a scalar failure, not an unadmitted
  // future waiter. Full owner/readiness joins remain independent below.
  assert.equal(current.state.selectedSession?.id, f.savedId, 'actual ensure callback propagated through navigation, no supplied created row');
  const stream = f.sources.findLast(source => source.url === `/api/agent/${f.savedId}/events` && source.readyState !== 2);
  assert.equal(Boolean(stream), true, 'actual created-session source was admitted');
  await f.connect(stream);
  await f.settleDefault();
  assert.equal(current.state.selectedSession?.id, f.savedId, 'same actual created selection after complete hook/view/input/navigation joins');
  assert.equal(current.state.selectedSession?.cwd, destination);
  assert.equal(current.state.selectedSession?.messageCount, 0);
  assert.equal(chat.session === current.state.selectedSession, true);
  assert.equal(f.composedOptions.session === current.state.selectedSession, true, 'created row is forwarded back into the actual public ChatWindow');
  assert.equal(chat.newSessionDraftKey, null);
  assert.equal(current.activeOverview, null);
  assert.equal(routerCalls.includes(`?session=${f.savedId}`), true);
  const input = f.view.container.querySelector('.chat-input-textarea');
  assert.equal(input !== null, true, 'actual public ChatInput mounts after empty creation');
  assert.equal(input.value, '');
  assert.equal(input.disabled, false);
  assert.equal(input.readOnly, false);
  assert.equal(f.requests.some(request => request.body?.type === 'prompt'), false, 'persistent New never fabricates a Send/turn');
  // Actual eager ensure originates in useAgentSession's persistence effect, not
  // typing/Send. Real Sidebar/overlay/touch/empty SDK authority remains installed.
  await f.run('real source selection unmounts the owned public receiver', () => {
    renderPublic = false;
    current.navigation.handleSidebarSelectSession(saved, false);
  });
  await f.settleDefault();
  assert.equal(current.state.selectedSession?.id, saved.id);
  assert.equal(current.state.selectedSession?.cwd, '/repo');
  assert.equal(f.view.container.querySelector('.chat-input-textarea') === null, true);
});
