import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { lowerRuntime, exact, button, click, choose, inputText } from './browser-lower-runtime.fixture.mjs';
import { movePlan, executed, sidebar, session, ROOT, SOURCE, DEST } from './browser-lower-cases.fixture.mjs';

async function dialog(t, { plan = movePlan(), onSettled = async () => {}, route = () => {} } = {}) {
  const modes = [], settlements = [];
  const request = { project: ROOT, ids: plan.roots.map(root => root.id), missingOnly: false };
  const r = await lowerRuntime(t, req => {
    const custom = route(req); if (custom?.handled) return custom.data;
    if (req.url.pathname === '/api/worktrees') {
      const cwd = req.url.searchParams.get('cwd'); assert.ok([ROOT, DEST].includes(cwd));
      exact(req, req.url.pathname, { cwd }, { signal: true }); return { worktrees: [] };
    }
    exact(req, '/api/sessions/move', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.parse(req.options.body), signal: JSON.parse(req.options.body).mode === 'preview' });
    const body = JSON.parse(req.options.body); modes.push(body.mode);
    if (body.mode === 'preview') { assert.deepEqual(body, { mode: 'preview', ...request, cwd: DEST }); return { plan, skippedAlreadyThere: ['already-at-destination'] }; }
    assert.deepEqual(body.plan, plan); assert.equal(['execute', 'reconcile'].includes(body.mode), true);
    return undefined;
  });
  const props = { request, projects: [ROOT, DEST].map(root => ({ root, key: root })), currentCwd: SOURCE, sourceUnavailable: true,
    onClose() {}, async onSettled(...args) { settlements.push(args); await onSettled(...args); } };
  await r.render(createElement(r.graph.SessionBulkMoveDialog, props));
  assert.equal(r.requests.length, 0, 'missing-source preselection does not read working checkout');
  assert.equal(button(r.view, 'Move').disabled, true);
  await choose(r.view, 'move-session-project', DEST); await r.idle();
  assert.deepEqual(modes, ['preview'], 'destination selection only proposes');
  assert.equal(button(r.view, 'Move').disabled, false);
  return { ...r, get view() { return r.view; }, modes, settlements, props, plan };
}

test('actual BulkMove confirmation dispatches exactly 5+2 sequential roots and awaits onSettled before releasing busy', async t => {
  let finish; const callback = new Promise(resolve => { finish = resolve; });
  const d = await dialog(t, { onSettled: () => callback }); d.releaseOnClose(finish);
  const ids = d.plan.roots.map(root => root.id);
  await click(d.view, button(d.view, 'Move'));
  const first = d.latest('/api/sessions/move', 'POST');
  assert.deepEqual(JSON.parse(first.options.body).rootIds, ids.slice(0, 5));
  assert.equal(button(d.view, 'Cancel').disabled, true); assert.equal(d.modes.filter(mode => mode === 'execute').length, 1);
  await d.reply(first, executed(d.plan, ids.slice(0, 5)));
  const second = d.latest('/api/sessions/move', 'POST'); assert.equal(first === second, false);
  assert.deepEqual(JSON.parse(second.options.body).rootIds, ids.slice(5));
  await d.reply(second, executed(d.plan, ids.slice(5)));
  assert.equal(button(d.view, 'Close').disabled, true, 'refresh callback is part of mutation ownership');
  assert.deepEqual(d.settlements, [[d.plan.roots.flatMap(root => root.memberIds), [], [], DEST]]);
  finish(); await d.idle(); assert.equal(button(d.view, 'Close').disabled, false);
  assert.deepEqual(d.modes, ['preview', 'execute', 'execute']);
  assert.match(d.view.container.textContent, /14 sessions moved; 1 roots already at destination; 0 roots failed/);
});

for (const observed of [true, false]) test(`actual BulkMove lost ACK confirms by read only, no replay or remainder; observation=${observed}`, async t => {
  const d = await dialog(t); const ids = d.plan.roots.map(root => root.id), attempted = ids.slice(0, 5);
  await click(d.view, button(d.view, 'Move')); const dispatched = d.latest('/api/sessions/move', 'POST');
  await d.headers(dispatched); await d.rejectBody(dispatched);
  const read = d.latest('/api/sessions/move', 'POST');
  assert.deepEqual(JSON.parse(read.options.body), { mode: 'reconcile', plan: d.plan, rootIds: attempted });
  if (observed) await d.reply(read, { roots: d.plan.roots.slice(0, 5).map((root, index) => ({ id: root.id, memberIds: root.memberIds,
    state: ['destination', 'source', 'changed', 'unknown', 'destination'][index] })) });
  else { await d.headers(read); await d.rejectBody(read); }
  await d.idle();
  assert.deepEqual(d.modes, ['preview', 'execute', 'reconcile']);
  const destinationIds = observed ? [d.plan.roots[0], d.plan.roots[4]].flatMap(root => root.memberIds) : [];
  assert.deepEqual(d.settlements, [[destinationIds, null, d.plan.roots.slice(0, 5).flatMap(root => root.memberIds), DEST]]);
  assert.match(d.view.container.querySelector('[role="alert"]').textContent, /No moves will be retried automatically/);
  assert.equal([...d.view.container.querySelectorAll('button')].some(b => b.textContent === 'Move'), false);
  assert.equal(button(d.view, 'Close').disabled, false);
  assert.match(d.view.container.textContent, /7 families have no acknowledged result/);
});

test('actual BulkMove failed/skipped execution counts and refresh failure are distinct from unknown mutation', async t => {
  const plan = movePlan(3);
  const d = await dialog(t, { plan, onSettled: async () => { throw new Error('declared refresh failure'); } });
  await click(d.view, button(d.view, 'Move'));
  const ids = plan.roots.map(root => root.id);
  await d.reply(d.latest('/api/sessions/move', 'POST'), executed(plan, [ids[0]], { skipped: [ids[1]], failed: [{ id: ids[2], error: 'running child' }] }));
  await d.idle();
  assert.deepEqual(d.settlements, [[plan.roots[0].memberIds, [ids[2]], [], DEST]]);
  assert.deepEqual(d.modes, ['preview', 'execute']); assert.match(d.view.container.textContent, /Could not refresh the session list/);
});

test('actual BulkMove preview A/B/A ignored-abort bodies cannot replace current plan or enable obsolete confirmation', async t => {
  const previews = [], plans = [movePlan(1, { cwd: '/B' }), movePlan(2), movePlan(3, { cwd: '/B' })];
  const r = await lowerRuntime(t, req => {
    if (req.url.pathname === '/api/worktrees') { const cwd = req.url.searchParams.get('cwd'); assert.ok([ROOT, '/B', DEST].includes(cwd)); exact(req, req.url.pathname, { cwd }, { signal: true }); return { worktrees: [] }; }
    const body = JSON.parse(req.options.body);
    exact(req, '/api/sessions/move', {}, { method: 'POST', signal: true, headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(body.mode, 'preview'); assert.equal(body.project, ROOT); assert.equal(body.missingOnly, false); previews.push(req); return undefined;
  });
  const props = { request: { project: ROOT, missingOnly: false }, projects: [ROOT, '/B', DEST].map(root => ({ root, key: root })), currentCwd: SOURCE, sourceUnavailable: true, onClose() {}, async onSettled() { assert.fail('preview cannot settle moves'); } };
  await r.render(createElement(r.graph.SessionBulkMoveDialog, props));
  for (const cwd of ['/B', DEST, '/B']) { await choose(r.view, 'move-session-project', cwd); await r.headers(previews.at(-1)); assert.equal(button(r.view, 'Move').disabled, true); }
  assert.equal(previews.length, 3); assert.ok(previews.slice(0, 2).every(req => req.options.signal.aborted));
  await r.body(previews[2], { plan: plans[2] });
  assert.match(r.view.container.textContent, /6 sessions in 3 selected/);
  await r.body(previews[0], { plan: plans[0] }); await r.rejectBody(previews[1]); await r.idle();
  assert.match(r.view.container.textContent, /6 sessions in 3 selected/); assert.equal(r.view.container.querySelector('[role="alert"]') === null, true);
  await r.view.unmount(); assert.equal(previews[2].options.signal.aborted, true);
});

test('actual BulkMove picker Retry, pending listing during nested Browse, and literal UNC proposal survive without implicit source reads', async t => {
  let listAttempt = 0; const held = [];
  const plan = movePlan(1);
  const r = await lowerRuntime(t, req => {
    if (req.url.pathname === '/api/worktrees') { exact(req, req.url.pathname, { cwd: DEST }, { signal: true }); held.push(req); listAttempt++; return undefined; }
    if (req.url.pathname === '/api/cwd/browse') { exact(req, req.url.pathname, { path: SOURCE }); return { path: SOURCE, parentPath: null, directories: [] }; }
    const body = JSON.parse(req.options.body); exact(req, '/api/sessions/move', {}, { method: 'POST', signal: true, headers: { 'Content-Type': 'application/json' }, body: { mode: 'preview', project: ROOT, missingOnly: false, cwd: DEST } });
    assert.equal(body.mode, 'preview'); return { plan };
  });
  const props = { request: { project: ROOT, missingOnly: false }, projects: [{ root: DEST, key: DEST }], currentCwd: SOURCE, sourceUnavailable: true, onClose() {}, async onSettled() { assert.fail('no mutation'); } };
  await r.render(createElement(r.graph.SessionBulkMoveDialog, props)); assert.equal(r.requests.length, 0);
  await choose(r.view, 'move-session-project', DEST); await r.headers(held[0], 502); await r.body(held[0], { error: 'declared listing refusal' }); await r.idle();
  assert.match(r.view.container.querySelector('[role="alert"]').textContent, /listing refusal/);
  await click(r.view, button(r.view, 'Retry')); assert.equal(listAttempt, 2);
  await click(r.view, button(r.view, 'Browse another folder…'));
  const picker = r.view.container.querySelector('[aria-label="Select directory"]'); assert.ok(picker);
  const input = picker.querySelector('#directory-path'); await inputText(r.view, input, 'literal typed but not submitted');
  await r.headers(held[1]); await r.body(held[1], { worktrees: [{ path: DEST, branch: 'literal branch' }] }); await r.idle();
  assert.equal(r.view.container.querySelector('[aria-label="Select directory"]') === picker, true);
  assert.equal(picker.querySelector('#directory-path') === input, true); assert.equal(input.value, 'literal typed but not submitted');
  await click(r.view, button(r.view, 'Cancel', picker));
  assert.equal(r.view.container.querySelector('#move-session-directory').dataset.value, DEST);
  assert.equal(r.requests.filter(req => req.url.pathname === '/api/sessions/move').every(req => JSON.parse(req.options.body).mode === 'preview'), true);
});

test('default Sidebar uncertain move retains selected unavailable history until canonical catalogue rebinds the same opaque ID, without replay', async t => {
  const plan = movePlan(1); const selected = plan.roots[0].id, modes = [], canonicalReads = [];
  const movedRows = [session(selected, DEST, { projectRoot: DEST, projectKey: DEST, cwdState: 'present' }), session('other-destination', DEST, { projectRoot: DEST, projectKey: DEST })];
  let committed = false;
  const h = await sidebar(t, { initial: [session(selected, SOURCE, { cwdState: 'missing' }), session('other-destination', DEST, { projectRoot: DEST, projectKey: DEST })],
    selected: true, cwd: SOURCE, override(req) {
      if (committed && canonicalReads.length === 1 && req.url.pathname === '/api/sessions/worktrees' && req.url.searchParams.get('project') === SOURCE) {
        exact(req, req.url.pathname, { project: SOURCE }, { cache: 'no-store', signal: true });
        return { handled: true, data: { projectRoot: ROOT, mainCwd: ROOT, worktrees: [] } };
      }
      if (committed && req.url.pathname === '/api/sessions' && req.url.searchParams.get('force') === '1') {
        exact(req, '/api/sessions', { force: '1', compact: '1' }, { cache: 'no-store' });
        canonicalReads.push(req); return { handled: true, data: undefined };
      }
      if (committed && req.url.pathname === '/api/sessions/worktrees' && req.url.searchParams.get('project') === DEST) {
        exact(req, req.url.pathname, { project: DEST }, { cache: 'no-store', signal: true });
        return { handled: true, data: { projectRoot: DEST, mainCwd: DEST, worktrees: [] } };
      }
      if (committed && req.url.pathname === '/api/worktrees' && req.url.searchParams.get('cwd') === DEST) {
        exact(req, req.url.pathname, { cwd: DEST }, { signal: false });
        return { handled: true, data: { projectRoot: DEST, projectKey: DEST, isGit: false, isTopLevel: false, currentWorktreePath: null, worktrees: [], localBranches: [] } };
      }
      if (req.url.pathname !== '/api/sessions/move') return;
      const body = JSON.parse(req.options.body); modes.push(body.mode);
      exact(req, req.url.pathname, {}, { method: 'POST', signal: body.mode === 'preview', headers: { 'Content-Type': 'application/json' }, body });
      if (body.mode === 'preview') { assert.deepEqual(body, { mode: 'preview', project: ROOT, ids: [selected], missingOnly: false, cwd: DEST }); return { handled: true, data: { plan } }; }
      assert.deepEqual(body.plan, plan); assert.deepEqual(body.rootIds, [selected]); return { handled: true, data: undefined };
    } });
  const before = new Set(h.requests);
  await click(h.view, button(h.view, 'Select'));
  const selectedRow = [...h.view.container.querySelectorAll('[data-session-id]')].find(node => node.dataset.sessionId === selected);
  await click(h.view, selectedRow.querySelector('input[type="checkbox"]'));
  await click(h.view, button(h.view, 'Move…')); await choose(h.view, 'move-session-project', DEST); await h.idle();
  const modal = h.view.container.querySelector('dialog[aria-labelledby="bulk-move-title"]');
  await click(h.view, button(h.view, 'Move', modal));
  const write = h.latest('/api/sessions/move', 'POST'); await h.headers(write);
  // Controlled committed server snapshot, staged BEFORE the successful execute
  // response loses its JSON ACK. This is not native execution evidence.
  h.setCatalogue(movedRows); committed = true;
  await h.rejectBody(write);
  const read = h.latest('/api/sessions/move', 'POST'); await h.headers(read); await h.rejectBody(read);
  assert.deepEqual(modes, ['preview', 'execute', 'reconcile']);
  assert.equal(h.current.state.selectedSession?.id, selected);
  assert.equal(h.current.state.selectedSession?.cwd, SOURCE, 'unknown proposal must not retarget history');
  assert.equal(h.current.state.selectedSession?.cwdState, 'unavailable');
  assert.equal(h.current.state.newSessionCwd, null);
  assert.equal(h.current.navigation.effectiveNewSessionCwd, null, 'no replacement working composer');
  assert.equal(h.current.navigation.newSessionDraftKey, null);
  assert.equal(canonicalReads.length, 1, 'settlement owns the required forced readback');
  assert.equal(button(h.view, 'Close', modal).disabled, true, 'canonical read is still part of full settlement');
  await h.reply(canonicalReads[0], { sessions: movedRows, sessionListVersion: 2, runningSessionIds: [] });
  await h.idle();
  assert.equal(h.current.state.sessionCatalog.find(item => item.id === selected)?.cwd, DEST);
  assert.equal(h.current.state.selectedSession?.id, selected, 'canonical metadata rebinds the same history, not a deletion');
  assert.equal(h.current.state.selectedSession?.cwd, DEST);
  assert.equal(h.current.state.selectedSession?.cwdState, 'present');
  assert.equal(h.current.navigation.effectiveNewSessionCwd, null);
  assert.deepEqual(modes, ['preview', 'execute', 'reconcile'], 'canonical observation does not replay mutation');
  const working = h.requests.filter(req => {
    if (before.has(req)) return false;
    const path = req.url.pathname;
    const isWorking = ['/api/worktrees', '/api/models', '/api/project-trust'].includes(path) || path.startsWith('/api/files/') || path.startsWith('/api/git/');
    return isWorking && (req.url.searchParams.get('cwd') === SOURCE || decodeURIComponent(path).includes(SOURCE));
  });
  assert.equal(working.length, 0, 'no implicit vanished-source working probes in this actual Sidebar graph');
  assert.equal(button(h.view, 'Close', modal).disabled, false);
  assert.equal(modal.textContent.includes('Could not refresh the session list'), false);
  // NavigationHarness does not mount AppShell/ChatWindow/FileWorkspace. The
  // native commit/readback, full working-probe and URL browser bridge stays.
});
