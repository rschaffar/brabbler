import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { encodeFilePathForApi } from '../lib/file-paths.ts';
import { navigationRuntime, exact, session } from './navigation-runtime.fixture.mjs';
export { session };

export async function shellHarness(t, { route = () => assert.fail('no HTTP in lower navigation case'), search = '', setup, sidebar = false, sessions = [session('a')], isMobile = false, onFocus } = {}) {
  const runtime = await navigationRuntime(t, route, setup);
  let committed;
  const routerCalls = [];
  const router = { replace(href, options) {
    assert.deepEqual(options, { scroll: false }); routerCalls.push(href);
    runtime.view?.window.history.replaceState(null, '', href);
  } };
  let activity;
  const sidebarPorts = sidebar ? {
    activityController: activity = runtime.graph.createActivityClientController({ visible: () => false }),
    onOpenFile() {},
  } : undefined;
  // Controller remains separate; no navigation task can cancel its native work.
  runtime.releaseOnClose(() => activity?.dispose());
  const props = { router, search, sidebar: sidebarPorts, isMobile, onFocus, onCommit(value) { committed = value; } };
  await runtime.render(createElement(runtime.graph.NavigationHarness, props));
  return { ...runtime, get view() { return runtime.view; }, get current() { return committed; }, routerCalls, props,
    async update(next) { Object.assign(props, next); await runtime.render(createElement(runtime.graph.NavigationHarness, props)); },
    async command(run) { await act(async () => { await run(committed); }); },
    async select(value, restore = false, entry, block) { await act(async () => { committed.navigation.handleSidebarSelectSession(value, restore, entry, block); }); },
    async cwd(value, root = value, key = root) { await act(async () => { committed.navigation.handleCwdChange(value, root, key); }); },
    async seed() { await act(async () => { committed.navigation.handleSessionsChange(sessions); }); },
  };
}

/** Exact external catalogue/listing capability for real Sidebar composition.
 * Custom writes/searches must be declared by each case, never default-success. */
export function sidebarRoutes(sessions, override, { listings = new Map([['/repo', []]]), worktrees, inventory } = {}) {
  return request => {
    const special = override?.(request);
    if (special?.handled) return special.data;
    const { url, options } = request;
    // retain() activates the controller's legacy import even when visible()
    // is false. An empty import is still a real, consumed POST, not a poll or
    // Read/Later mutation. Every other Activity write remains undeclared.
    if (url.pathname === '/api/activity/review') {
      exact(request, '/api/activity/review', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { op: 'import', entries: [] }, signal: false });
      return { reviewedRuns: [], laterRuns: [], laterRequests: [] };
    }
    assert.equal(options.method ?? 'GET', 'GET', `undeclared write: ${url.pathname}`);
    if (url.pathname === '/api/sessions') {
      const query = Object.fromEntries(url.searchParams);
      assert.ok(['{"compact":"1"}', '{"force":"1","compact":"1"}', '{"summary":"1","compact":"1"}'].includes(JSON.stringify(query)));
      exact(request, '/api/sessions', query, { cache: 'no-store' });
      return { sessions, sessionListVersion: 1, runningSessionIds: [] };
    }
    if (url.pathname === '/api/home') { exact(request, '/api/home'); return { home: '/home/fixture' }; }
    if (url.pathname === '/api/starred-sessions') { exact(request, '/api/starred-sessions', {}, { cache: 'no-store' }); return { ids: [], projectKeys: [] }; }
    if (url.pathname === '/api/worktrees') {
      const cwd = url.searchParams.get('cwd'); assert.ok(listings.has(cwd), `declared working cwd: ${cwd}`);
      exact(request, '/api/worktrees', { cwd });
      return worktrees ?? { projectRoot: '/repo', projectKey: '/repo', isGit: false, isTopLevel: false, currentWorktreePath: null, worktrees: [], localBranches: [] };
    }
    if (url.pathname === '/api/sessions/worktrees') {
      exact(request, '/api/sessions/worktrees', { project: '/repo' }, { signal: true, cache: 'no-store' });
      return inventory ?? { project: '/repo', mainCwd: '/repo', worktrees: [] };
    }
    if (url.pathname === '/api/git/status') {
      const cwd = url.searchParams.get('cwd'); assert.ok(listings.has(cwd)); exact(request, '/api/git/status', { cwd }); return { isGitRepository: false, files: [] };
    }
    for (const [cwd, entries] of listings) {
      // Share the actual path encoder for transport wiring only. Independent
      // UNC/path-security production matrices retain their existing owners.
      const encoded = encodeFilePathForApi(cwd);
      if (url.pathname === `/api/files/${encoded}`) {
        exact(request, url.pathname, { type: 'list' }); return { entries };
      }
    }
    assert.fail(`undeclared catalogue/navigation request: ${url}`);
  };
}
