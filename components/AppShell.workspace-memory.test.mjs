import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { click, button, exact } from './navigation-runtime.fixture.mjs';
import { shellHarness, session } from './navigation-cases.fixture.mjs';

for (const initial of ['activity', 'starred', 'git', null]) test(`background adoption preserves ${initial}; explicit selection forwards current entry and closes overview`, async t => {
  const h = await shellHarness(t);
  await h.command(c => c.setActiveOverview(initial));
  await h.select(session('url', '/repo/worktree'), true);
  assert.equal(h.current.activeOverview, initial);
  assert.equal(h.current.state.selectedSession.id, 'url');
  const key = h.current.state.sessionKey;
  await h.select(session('url', '/repo/worktree'), false, 'source-entry', 2);
  assert.equal(h.current.activeOverview, null);
  assert.equal(h.current.state.sessionKey, key, 're-click retains mounted chat identity');
  assert.deepEqual(h.current.state.searchTarget, { sessionId: 'url', entryId: 'source-entry', blockIndex: 2 });
  assert.equal(h.routerCalls.at(-1), '?session=url');
});

for (const width of [390, 820, 1440]) test(`real overview buttons preserve independent Files at ${width}px`, async t => {
  const h = await shellHarness(t, { isMobile: width <= 640, setup(window) { Object.defineProperty(window, 'innerWidth', { value: width, configurable: true }); } });
  for (const open of [false, true]) for (const panel of ['activity', 'starred']) for (const previous of [null, panel === 'activity' ? 'starred' : 'activity', panel]) {
    await h.command(c => { c.setRightPanelOpen(open); c.setActiveOverview(previous); c.setReviewNavigation({ cwd: '/repo', branch: 'main', oid: 'a', head: 'a', requestId: 1 }); });
    const revision = h.current.reviewNavigationId.current;
    await click(h.view, button(h.view, panel === 'activity' ? 'Activity' : 'Starred'));
    assert.equal(h.current.activeOverview, previous === panel ? null : panel);
    assert.equal(h.current.rightPanelOpen, width <= 640 && previous !== panel ? false : open);
    if (previous !== panel) {
      assert.equal(h.current.reviewNavigation, null);
      assert.equal(h.current.reviewNavigationId.current, revision + 1);
    }
  }
});

test('A/B/A workspace generations reject old success/error and use the current catalogue/callback', async t => {
  const h = await shellHarness(t, { route(request) { exact(request, '/api/sessions'); return undefined; } });
  const { setLastOpenSession } = h.graph.workspaceMemory;
  setLastOpenSession('/a', 'a'); setLastOpenSession('/b', 'b');
  await h.cwd('/a'); const oldA = h.latest('/api/sessions'); await h.headers(oldA);
  await h.cwd('/b'); const oldB = h.latest('/api/sessions'); await h.headers(oldB);
  await h.cwd('/a'); const newA = h.latest('/api/sessions'); await h.headers(newA);
  const a = session('a', '/a', { projectRoot: '/a', projectKey: '/a' });
  await h.body(newA, { sessions: [a] });
  assert.equal(h.current.state.selectedSession.id, 'a');
  const key = h.current.state.sessionKey;
  await h.body(oldA, { sessions: [session('a', '/old', { projectKey: '/a' })] });
  await h.body(oldB, { sessions: [session('b', '/b', { projectKey: '/b' })] });
  assert.equal(h.current.state.selectedSession.cwd, '/a');
  assert.equal(h.current.state.sessionKey, key);
  await h.settled();
  await h.command(c => c.navigation.handleSessionsChange([session('other', '/other', { projectKey: '/other' })]));
  setLastOpenSession('/other', 'other'); await h.cwd('/other');
  assert.equal(h.current.state.selectedSession.id, 'other', 'latest catalogue fast path');
});

test('all explicit transition admissions invalidate remembered restores; late creation refreshes but cannot adopt another draft', async t => {
  const h = await shellHarness(t, { route(request) { exact(request, '/api/sessions', {}, request.options.cache ? { cache: 'no-store' } : {}); return undefined; } });
  const { setLastOpenSession } = h.graph.workspaceMemory;
  for (const transition of ['cwd', 'select', 'new', 'created', 'fork', 'deleted']) {
    await h.command(c => c.navigation.handleSessionsChange([]));
    const p = `/pending-${transition}`; setLastOpenSession(p, 'remembered'); await h.cwd(p);
    const old = h.latest('/api/sessions'); await h.headers(old);
    await h.command(c => {
      if (transition === 'cwd') c.navigation.handleCwdChange('/new-project');
      if (transition === 'select') c.navigation.handleSelectSession(session('chosen'));
      if (transition === 'new') c.navigation.handleNewSession('fresh', '/repo');
      if (transition === 'created') {
        c.navigation.handleNewSession('fresh', '/repo');
        c.navigation.handleSessionCreated(session('saved'), 'new:fresh:/repo');
      }
      if (transition === 'fork') c.navigation.handleSessionForked('fork');
      if (transition === 'deleted') c.navigation.handleSessionDeleted(c.state.selectedSession?.id ?? 'other');
    });
    const selection = h.current.state.selectedSession?.id ?? null;
    await h.body(old, { sessions: [session('remembered', p, { projectKey: p })] });
    assert.equal(h.current.state.selectedSession?.id ?? null, selection, transition);
    // Release real hydration peers, including the fork/creation lookup.
    for (const request of h.requests.filter(r => r !== old && !r.answered)) await h.reply(request, { sessions: [] });
  }
  await h.command(c => c.navigation.handleNewSession('one', '/repo'));
  const outgoing = h.current.state.activeNewSessionDraftKeyRef.current;
  await h.command(c => c.navigation.handleNewSession('two', '/repo'));
  const refresh = h.current.state.refreshKey;
  await h.command(c => c.navigation.handleSessionCreated(session('late'), outgoing));
  assert.equal(h.current.state.selectedSession, null);
  assert.equal(h.current.state.newSessionDraftId, 'two');
  assert.equal(h.current.state.refreshKey, refresh + 1);
  await h.settled();
});

test('same-project checkout changes retain saved chat; fresh drafts remount, park and preserve explicit New identity', async t => {
  const h = await shellHarness(t);
  const { draftStore } = h.graph;
  await h.cwd('/repo');
  const passive = h.current.state.activeNewSessionDraftKeyRef.current;
  const draft = { value: 'unsent project draft', images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }] };
  draftStore.setDraft(passive, draft);
  await h.select(session('a'));
  assert.deepEqual(draftStore.getDraft('parked-new:/repo'), draft);
  const key = h.current.state.sessionKey;
  await h.cwd('/repo-wt', '/repo', '/repo');
  assert.equal(h.current.state.selectedSession.id, 'a');
  assert.equal(h.current.state.sessionKey, key);
  await h.command(c => c.navigation.handleNewSession('pending', '/repo'));
  const explicit = h.current.state.activeNewSessionDraftKeyRef.current;
  assert.deepEqual(draftStore.getDraft(explicit), draft);
  await h.select(session('a'));
  assert.deepEqual(draftStore.getDraft(explicit), draft, 'outgoing creation retains its literal draft key');
  await h.cwd('/different', '/different', '/different');
  assert.equal(h.current.state.selectedSession, null);
  draftStore.clearDraft(explicit); draftStore.clearDraft(passive); draftStore.clearDraft('parked-new:/repo');
});

test('fresh-focus revision and draft identity refuse superseded requests; mobile New leaves every overview', async t => {
  let focuses = 0;
  const h = await shellHarness(t, { onFocus: () => focuses++ });
  for (const panel of ['activity', 'starred', 'git']) {
    await h.command(c => c.setActiveOverview(panel));
    await h.command(c => c.navigation.handleNewSession(`desktop-${panel}`, '/repo'));
    assert.equal(h.current.activeOverview, panel);
  }
  await h.frame(); assert.equal(focuses, 1, 'only latest draft revision focuses');
  await h.command(c => c.navigation.handleNewSession('obsolete', '/repo'));
  await h.select(session('a')); await h.frame();
  assert.equal(focuses, 1);
  await h.command(c => c.navigation.handleNewSession('same-key-revision', '/repo'));
  await h.command(c => c.navigation.handleSessionDeleted('unrelated'));
  await h.frame(); assert.equal(focuses, 1, 'navigation revision refuses focus even when draft key is unchanged');
  await h.update({ isMobile: true });
  for (const panel of ['activity', 'starred', 'git']) {
    await h.command(c => c.setActiveOverview(panel));
    await h.command(c => c.navigation.handleNewSession(`mobile-${panel}`, '/empty-project'));
    assert.equal(h.current.activeOverview, null);
    assert.equal(h.current.state.activeNewSessionDraftKeyRef.current, `new:mobile-${panel}:/empty-project`);
    assert.equal(h.current.state.persistNewSession, true);
  }
});

test('page-memory scrolls are session-local and archive restoration never clears the selected conversation', async t => {
  const h = await shellHarness(t);
  await h.select(session('root', '/repo', { archived: true }));
  await h.command(c => {
    c.state.handleSessionScrollPositionChange('root', { atBottom: false, anchorEntryId: 'entry', anchorOffset: 17, oldestEntryId: null });
    c.navigation.handleSessionsChange([session('root', '/repo', { archived: true }), session('child')]);
  });
  const key = h.current.state.sessionKey, refresh = h.current.state.refreshKey;
  await h.command(c => c.navigation.handleSessionRestored('root'));
  assert.equal(h.current.state.selectedSession.id, 'root');
  assert.equal(h.current.state.selectedSession.archived, false);
  assert.equal(h.current.state.sessionCatalog.find(s => s.id === 'root').archived, false);
  assert.equal(h.current.state.sessionKey, key);
  assert.equal(h.current.state.refreshKey, refresh + 1);
  assert.equal(h.current.state.sessionScrollPositionsRef.current.get('root').anchorOffset, 17);
  assert.equal(h.current.state.sessionScrollPositionsRef.current.has('child'), false);
});


for (const rememberedCwd of ['/draft-project', '/draft-project-worktree']) test(`navigation parks passive text/images across actual remembered-session adoption: ${rememberedCwd}`, async t => {
  const cwd = '/draft-project', remembered = session('remembered', rememberedCwd, { projectRoot: cwd, projectKey: cwd });
  const h = await shellHarness(t, { route(request) { exact(request, '/api/sessions'); return undefined; } });
  const { draftStore } = h.graph;
  await h.cwd(cwd, cwd, cwd);
  const passive = h.current.state.activeNewSessionDraftKeyRef.current;
  const draft = { value: 'unsent project draft', images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }] };
  draftStore.setDraft(passive, draft);
  await h.select({ ...remembered, cwd });
  await h.command(c => c.navigation.handleNewSession('direct-return', cwd));
  const pending = h.current.state.activeNewSessionDraftKeyRef.current;
  assert.deepEqual(draftStore.getDraft(pending), draft);
  await h.select({ ...remembered, cwd });
  assert.deepEqual(draftStore.getDraft(pending), draft, 'explicit in-flight New retains its own text/image key');
  await h.cwd('/other-project', '/other-project', '/other-project');
  await h.cwd(cwd, cwd, cwd);
  const response = h.latest('/api/sessions');
  assert.equal(draftStore.getDraft(h.current.state.activeNewSessionDraftKeyRef.current), null);
  await h.reply(response, { sessions: [remembered] }); await h.settled();
  assert.equal(h.current.state.selectedSession.id, remembered.id); assert.equal(h.current.state.selectedSession.cwd, rememberedCwd);
  await h.command(c => c.navigation.handleNewSession('after-auto-restore', cwd));
  assert.equal(draftStore.getDraft(h.current.state.activeNewSessionDraftKeyRef.current), null);
  draftStore.clearDraft(pending); draftStore.clearDraft(passive); draftStore.clearDraft('parked-new:/draft-project');
});
