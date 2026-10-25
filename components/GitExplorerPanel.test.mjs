import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { packet, click, choose, key } from './cards-git.fixture.mjs';

const head = 'a'.repeat(40), oid = 'b'.repeat(40);
const page = { branch: 'main', head, refs: [{ branch: 'main', oid: head }, { branch: 'topic', oid }], nextSkip: null,
  commits: [{ oid, parents: [], author: 'Test', date: '2026-01-01', subject: 'Selected object', tags: [] }] };
async function panel(t, overrides = {}) {
  const h = await packet(t, { git: true });
  const { GitExplorerPanel } = await h.load('./GitExplorerPanel.tsx');
  const calls = [];
  let props = { cwd: null, expanded: false, canExpand: true, onReadWork: h.onReadWork,
    onClose: () => calls.push('close'), onToggleExpanded: () => calls.push('toggle'), ...overrides };
  const render = async changes => { props = { ...props, ...changes }; await h.render(createElement(GitExplorerPanel, props)); };
  await render({});
  return { ...h, renderPanel: render, calls };
}

test('observer-only detail rerenders retain held and loaded immutable detail; changed selection uses the current observer', async t => {
  const h = await packet(t, { git: true }), { GitCommitViewer } = await h.load('./GitCommitViewer.tsx');
  const old = [], first = [], current = [];
  const observe = list => work => { list.push(work); h.onReadWork(work); };
  const oldObserver = observe(old), firstObserver = observe(first), currentObserver = observe(current);
  const props = { cwd: '/repo', branch: 'main', head, oid };
  const render = (observer, selected = oid) => h.render(createElement(GitCommitViewer, { ...props, oid: selected, onReadWork: observer }));
  await render(oldObserver);
  const held = h.requests.findLast(request => !request.signal.aborted), count = h.requests.length, oldCount = old.length;
  const region = h.view.container.querySelector('[aria-label="Git commit details"]');
  assert.equal(old.includes(held.readWork), true);
  await render(firstObserver);
  assert.equal(h.requests.length, count, 'observer replacement cannot admit another detail read');
  assert.equal(held.signal.aborted, false, 'the already-admitted immutable read stays alive');
  assert.equal(first.length, 0); assert.equal(h.view.container.querySelector('[aria-label="Git commit details"]') === region, true);
  assert.equal(region.textContent.includes(oid), true);
  const detail = { oid, parents: [], author: 'Test', date: '2026-01-01', message: 'Retained exact detail', files: [] };
  await h.reply(held, detail);
  const message = [...region.querySelectorAll('p')].find(node => node.textContent === detail.message);
  assert.equal(Boolean(message), true);
  await render(currentObserver);
  assert.equal(h.requests.length, count, 'loaded detail must not clear/refetch when only its observer changes');
  assert.equal(held.signal.aborted, false);
  assert.equal(h.view.container.querySelector('[aria-label="Git commit details"]') === region, true);
  assert.equal([...region.querySelectorAll('p')].some(node => node === message), true);
  assert.equal(region.textContent.includes(detail.message), true); assert.equal(current.length, 0);
  const nextOid = 'c'.repeat(40), before = h.requests.length;
  await render(currentObserver, nextOid);
  const admitted = h.requests.slice(before);
  assert.equal(admitted.length > 0, true);
  assert.equal(current.length, admitted.length, 'one observation for each actual new operation, without pinning Strict replay width');
  for (const request of admitted) {
    assert.equal(current.includes(request.readWork), true, 'observe the already-created terminal promise, not another fetch or wrapper');
    assert.equal(request.url.searchParams.get('oid'), nextOid); assert.equal(request.url.searchParams.get('head'), head);
  }
  assert.equal(old.length, oldCount); assert.equal(first.length, 0);
  await h.reply(admitted.findLast(request => !request.signal.aborted), { ...detail, oid: nextOid, message: 'Current selected detail' });
  assert.match(region.textContent, /Current selected detail/);
});

test('whole-Explorer expand/restore/close controls use the real catalogue and current callbacks', async t => {
  const h = await panel(t), region = h.view.container.querySelector('section');
  const expand = h.view.container.querySelector('[aria-label="Expand Git Explorer"]');
  assert.equal(expand.getAttribute('aria-controls'), 'git-explorer-panel');
  assert.equal(expand.getAttribute('aria-pressed'), 'false');
  await click(h.view, expand); assert.deepEqual(h.calls, ['toggle']);
  await h.renderPanel({ expanded: true });
  const restore = h.view.container.querySelector('[aria-label="Restore Git Explorer"]');
  assert.equal(restore === expand, true, 'expansion does not remount the control');
  assert.equal(restore.getAttribute('aria-pressed'), 'true');
  assert.equal(h.view.window.document.activeElement === restore, true, 'expansion effect focuses restore');
  const current = [];
  await h.renderPanel({ onToggleExpanded: () => current.push('toggle'), onClose: () => current.push('close') });
  await click(h.view, restore);
  await h.renderPanel({ expanded: false });
  assert.equal(h.view.window.document.activeElement === expand, true, 'restore effect focuses expand');
  await click(h.view, h.view.container.querySelector('[aria-label="Close Git Explorer"]'));
  assert.deepEqual(current, ['toggle', 'close']); assert.deepEqual(h.calls, ['toggle']);
  assert.equal(h.view.container.querySelector('section') === region, true);
});

test('mobile omits expand; no-checkout Explorer remains readable, expandable and closable', async t => {
  const h = await panel(t, { canExpand: false });
  assert.equal(h.view.container.querySelector('[aria-controls="git-explorer-panel"]') === null, true);
  await h.renderPanel({ canExpand: true, expanded: true });
  assert.match(h.view.container.textContent, /Select a worktree to browse its local branches/);
  await click(h.view, h.view.container.querySelector('[aria-label="Restore Git Explorer"]'));
  await click(h.view, h.view.container.querySelector('[aria-label="Close Git Explorer"]'));
  assert.deepEqual(h.calls, ['toggle', 'close']); assert.equal(h.requests.length, 0);
});

test('fullscreen Escape restores once, while normal Escape still bubbles to the outer owner', async t => {
  const h = await panel(t, { expanded: true });
  let outer = 0;
  h.view.window.document.addEventListener('keydown', () => outer++);
  const target = h.view.container.querySelector('[aria-label="Close Git Explorer"]');
  assert.equal(await key(h.view, target, 'Escape'), true);
  assert.deepEqual(h.calls, ['toggle']); assert.equal(outer, 0);
  await h.renderPanel({ expanded: false });
  assert.equal(await key(h.view, target, 'Escape'), false);
  assert.deepEqual(h.calls, ['toggle']); assert.equal(outer, 1);
});

test('nested native dialog and consumed Escape retain first refusal through real event propagation', async t => {
  const h = await panel(t, { expanded: true }), region = h.view.container.querySelector('section');
  const dialog = h.view.window.document.createElement('dialog'); dialog.open = true;
  const nested = h.view.window.document.createElement('button'); dialog.append(nested); region.append(dialog);
  assert.equal(await key(h.view, nested, 'Escape'), false);
  const consumed = new h.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  consumed.preventDefault(); await h.view.dispatch(region, consumed);
  assert.deepEqual(h.calls, []);
});

test('real Tab boundaries wrap focus and exclude hidden, inert and disabled controls', async t => {
  const h = await panel(t, { expanded: true }), region = h.view.container.querySelector('section');
  const first = h.view.container.querySelector('[aria-label="Restore Git Explorer"]');
  const last = h.view.container.querySelector('[aria-label="Close Git Explorer"]');
  for (const kind of ['hidden', 'inert', 'disabled']) {
    const element = h.view.window.document.createElement('button'); element.textContent = kind;
    if (kind === 'disabled') element.disabled = true; else element.setAttribute(kind, '');
    region.append(element);
  }
  last.focus(); assert.equal(await key(h.view, last, 'Tab'), true);
  assert.equal(h.view.window.document.activeElement === first, true);
  first.focus(); assert.equal(await key(h.view, first, 'Tab', { shiftKey: true }), true);
  assert.equal(h.view.window.document.activeElement === last, true);
  region.focus(); assert.equal(await key(h.view, region, 'Tab'), true);
  assert.equal(h.view.window.document.activeElement === first, true);
  region.focus(); assert.equal(await key(h.view, region, 'Tab', { shiftKey: true }), true);
  assert.equal(h.view.window.document.activeElement === last, true);
});

test('the actual graph selects immutable detail; expansion/back preserve it and branch changes clear it', async t => {
  const h = await panel(t, { cwd: '/repo' });
  await h.reply(h.requests.filter(request => !request.signal.aborted).at(-1), page);
  const graph = h.view.container.querySelector('[aria-label="Commit graph"]');
  await click(h.view, graph.querySelector('button[aria-pressed]'));
  const commitReads = h.requests.filter(request => request.url.searchParams.get('op') === 'commit');
  assert.equal(commitReads.length > 0, true);
  for (const request of commitReads) assert.deepEqual([...request.url.searchParams].sort(),
    [['branch', 'main'], ['cwd', '/repo'], ['head', head], ['oid', oid], ['op', 'commit']]);
  await h.reply(commitReads.findLast(request => !request.signal.aborted),
    { oid, parents: [], author: 'Test', date: '2026-01-01', message: 'Exact selected commit', files: [] });
  const detail = h.view.container.querySelector('[aria-label="Git commit details"]');
  assert.match(detail.textContent, /Exact selected commit/);
  assert.equal(Boolean(h.view.container.querySelector('.git-explorer-mobile-detail')), true);
  const requestCount = h.requests.length;
  await h.renderPanel({ expanded: true });
  await h.renderPanel({ expanded: false });
  assert.equal(h.view.container.querySelector('[aria-label="Commit graph"]') === graph, true);
  assert.equal(h.view.container.querySelector('[aria-label="Git commit details"]') === detail, true);
  assert.equal(h.requests.length, requestCount, 'CSS expansion must not reload immutable detail');
  await click(h.view, h.view.container.querySelector('.git-explorer-back'));
  assert.equal(h.view.container.querySelector('.git-explorer-mobile-detail') === null, true);
  assert.equal(h.view.container.querySelector('[aria-label="Git commit details"]') === detail, true);
  await choose(h.view, h.view.container.querySelector('select'), 'topic');
  assert.equal(h.view.container.querySelector('[aria-label="Git commit details"]') === null, true);
  assert.equal(commitReads.every(request => request.signal.aborted), true);
  await h.reply(h.requests.at(-1), { ...page, branch: 'topic', head: oid });
  // The already-aborted Strict replay body really returns after selection cleared.
  for (const request of commitReads.filter(request => !request.jsonReturned)) await h.reply(request,
    { oid, parents: [], author: 'Old', date: '2026-01-01', message: 'obsolete selected commit', files: [] });
  assert.doesNotMatch(h.view.container.textContent, /obsolete selected commit/);
});

test('an exact reference focuses the actual panel and Return uses its current owner', async t => {
  const reference = { cwd: '/repo', branch: 'main', head, oid, requestId: 1 }, returned = [];
  const h = await panel(t, { cwd: '/repo', initialSelection: reference, onReturnToWorkspace: () => returned.push('old') });
  assert.equal(h.view.window.document.activeElement === h.view.container.querySelector('section'), true);
  await h.renderPanel({ onReturnToWorkspace: () => returned.push('current') });
  const button = [...h.view.container.querySelectorAll('button')].find(node => /Return to workspace history/.test(node.textContent));
  await click(h.view, button); assert.deepEqual(returned, ['current']);
});
