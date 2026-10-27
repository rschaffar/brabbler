import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { lowerRuntime, exact } from './browser-lower-runtime.fixture.mjs';
export const ROOT = '/repo', DEST = String.raw`\\server\Share\Literal Project`, SOURCE = String.raw`C:\Projects\Missing Checkout`;
export const OID40 = '0123456789abcdef0123456789abcdef01234567';
export const OID64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const IDS = ['opaque-family-A', 'opaque-family-B'];
export const session = (id, cwd = ROOT, extra = {}) => ({ id, path: `/saved/${id}.jsonl`, cwd, projectRoot: ROOT, projectKey: ROOT,
  created: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z', messageCount: 1, firstMessage: id, ...extra });

// Transport inputs, not a fake catalogue reducer. Cases explicitly advance the
// server reply fixture only after asserted required writes; all UI decisions live
// in Sidebar + useSessionNavigation + existing catalogue/controller production.
export async function sidebar(t, { initial = IDS.map(id => session(id)), override = () => {}, cwd = ROOT, selected = false, inventory, listings, extraCwds = [] } = {}) {
  let sessions = initial, committed;
  const runtime = await lowerRuntime(t, r => {
    const special = override(r); if (special?.handled) return special.data;
    const { url } = r;
    if (url.pathname === '/api/activity/review') {
      exact(r, url.pathname, {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { op: 'import', entries: [] } });
      return { reviewedRuns: [], laterRuns: [], laterRequests: [] };
    }
    assert.equal(r.options.method ?? 'GET', 'GET', `undeclared write ${url}`);
    if (url.pathname === '/api/sessions') {
      const query = Object.fromEntries(url.searchParams); assert.ok(['{"compact":"1"}', '{"force":"1","compact":"1"}', '{"summary":"1","compact":"1"}'].includes(JSON.stringify(query)));
      exact(r, url.pathname, query, { cache: 'no-store' }); return { sessions, sessionListVersion: 1, runningSessionIds: [] };
    }
    if (url.pathname === '/api/home') { exact(r, url.pathname); return { home: '/home/fixture' }; }
    if (url.pathname === '/api/starred-sessions') { exact(r, url.pathname, {}, { cache: 'no-store' }); return { ids: [], projectKeys: [] }; }
    if (url.pathname === '/api/worktrees') {
      const path = url.searchParams.get('cwd'); assert.ok([cwd, ROOT, DEST, ...extraCwds].includes(path)); exact(r, url.pathname, { cwd: path });
      return listings?.(path) ?? { projectRoot: ROOT, projectKey: ROOT, isGit: false, isTopLevel: false, currentWorktreePath: null, worktrees: [], localBranches: [] };
    }
    if (url.pathname === '/api/sessions/worktrees') {
      const project = url.searchParams.get('project'); assert.ok([ROOT, ...extraCwds].includes(project));
      exact(r, url.pathname, { project }, { signal: true, cache: 'no-store' });
      return inventory ?? { projectRoot: ROOT, mainCwd: ROOT, worktrees: [] };
    }
    if (url.pathname === '/api/git/status') { exact(r, url.pathname, { cwd: url.searchParams.get('cwd') }); return { isGitRepository: false, files: [] }; }
    for (const path of [cwd, ROOT, DEST, ...extraCwds]) if (url.pathname === `/api/files/${runtime.graph.encodeFilePathForApi(path)}`) { exact(r, url.pathname, { type: 'list' }); return { entries: [] }; }
    assert.fail(`undeclared read ${url}`);
  });
  const activityController = runtime.graph.createActivityClientController({ visible: () => false });
  runtime.releaseOnClose(() => activityController.dispose());
  const props = { router: { replace(href, options) { assert.deepEqual(options, { scroll: false }); runtime.view?.window.history.replaceState(null, '', href); } },
    search: '', sidebar: { activityController, onOpenFile() {} }, onCommit(value) { committed = value; } };
  await runtime.render(createElement(runtime.graph.NavigationHarness, props)); await runtime.idle();
  await act(async () => { committed.navigation.handleCwdChange(cwd, ROOT, ROOT); }); await runtime.idle();
  if (selected) { await act(async () => { committed.navigation.handleSidebarSelectSession(initial[0]); }); await runtime.idle(); }
  return { ...runtime, get view() { return runtime.view; }, get current() { return committed; },
    setCatalogue(value) { sessions = value; },
    async command(fn) { await act(async () => { await fn(committed); }); },
    async update(next) { Object.assign(props, next); await runtime.render(createElement(runtime.graph.NavigationHarness, props)); },
  };
}

export function movePlan(count = 7, { cwd = DEST, project = ROOT, missingOnly = false } = {}) {
  const roots = Array.from({ length: count }, (_, i) => ({ id: `opaque-move-root-${i}`, sourceCwd: SOURCE,
    memberIds: [`opaque-move-root-${i}`, `opaque-child-${i}`], bindings: [
      { id: `opaque-move-root-${i}`, cwd: SOURCE, path: `literal-saved-${i}.jsonl` },
      { id: `opaque-child-${i}`, cwd: SOURCE, path: `literal-child-${i}.jsonl` },
    ] }));
  return { project, cwd, missingOnly, roots, sessionCount: count * 2, archivedCount: count,
    affectedIds: roots.flatMap(root => root.memberIds) };
}
export function executed(plan, ids, overrides = {}) {
  return { succeeded: ids, failed: [], skipped: [], movedIds: plan.roots.filter(root => ids.includes(root.id)).flatMap(root => root.memberIds), pending: [], ...overrides };
}
export const ACTIONS = '/api/plugins/bundled/git-workflow/project-actions';
export const LOSS = 'I understand that deleting this local branch can discard work not proven integrated, and I accept this loss.';
export const rowData = (id = 'branch:unmerged', extra = {}) => ({ kind: 'branch', id, branch: 'unmerged', tip: OID40, symbolic: false,
  tipDate: '2026-01-01T00:00:00.000Z', authorDate: '2025-12-31T00:00:00.000Z', subject: 'literal captured subject', worktrees: [],
  integration: 'not-integrated', mergeDate: { state: 'not-applicable' }, blockers: [], ...extra });
export function inventory(rows = [rowData()], extra = {}) {
  return { captureId: 'opaque-capture', capturedAt: '2026-01-02T00:00:00.000Z', project: ROOT, mainCheckout: ROOT, checkout: ROOT,
    target: { branch: 'main', tip: OID64, configured: 'main', source: 'project', temporary: false, missingConfigured: false },
    targets: [{ branch: 'main', tip: OID64 }, { branch: 'unfinished', tip: OID40 }], rows,
    counts: { branches: rows.length, worktrees: 0, diagnostics: 0, integrated: 0, notIntegrated: rows.length, unknown: 0, target: 0 },
    complete: true, cleanup: { pluginId: 'git-workflow', enabled: true, permission: 'allow', targetSelection: 'configured' }, ...extra };
}
export const card = (extra = {}) => ({ title: 'Frozen exact removal', requiredAcknowledgment: LOSS,
  fields: [{ label: 'Branch', value: 'unmerged' }, { label: 'HEAD', value: OID40 }],
  actions: [{ id: 'approve', label: 'Remove listed resources', primary: true }, { id: 'reject', label: 'Keep resources' }], ...extra });
export function operation(id = '11111111-1111-4111-8111-111111111111', extra = {}) {
  return { version: 1, id, requestId: id, pluginId: 'git-workflow', action: 'remove', project: ROOT, anchor: ROOT, cwd: ROOT,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', state: 'review',
    card: card(), acknowledgment: { cardDigest: 'd'.repeat(64), label: LOSS }, ...extra };
}
export const details = (capture, ids, { dates = false, dirty = false, ignored = [] } = {}) => ({ captureId: capture,
  rows: ids.map(id => ({ id, mergeDate: dates ? { state: 'available', date: '2026-01-02T00:00:00.000Z', commit: OID64, source: 'first-parent-graph' } : { state: 'not-applicable' },
    statuses: [{ path: DEST, state: dirty ? 'dirty' : 'clean', trackedDirty: dirty, untracked: dirty ? ['manual.txt'] : [], ignored, submodules: 'ignored' }] })) });
