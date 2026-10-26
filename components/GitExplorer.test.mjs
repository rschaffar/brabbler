import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { packet, click, choose, textButton } from './cards-git.fixture.mjs';

const head = 'a'.repeat(40), root = 'b'.repeat(40), older = 'c'.repeat(40);
function page(tags = [], branch = 'main', captured = head) {
  return { head: captured, branch, refs: [{ branch: 'main', oid: captured }, { branch: 'same-name', oid: root }], nextSkip: null,
    commits: [
      { oid: captured, parents: captured === root ? [] : [root], author: 'Test', date: '2026-01-01', subject: 'latest commit', tags },
      ...(captured === root ? [] : [{ oid: root, parents: [], author: 'Test', date: '2026-01-01', subject: 'root commit', tags: [] }]),
    ] };
}
const rows = view => [...view.container.querySelectorAll('[aria-label="Commit graph"] button[aria-pressed]')];
async function explorer(t, extra = {}) {
  const h = await packet(t, { git: true });
  const { GitExplorer, GitExplorerGraph } = await h.load('./GitExplorer.tsx');
  const opened = [], changes = [];
  const props = { cwd: '/repo', onReadWork: h.onReadWork, onOpenCommit: (...args) => opened.push(args), onBranchChange: () => changes.push('changed'), ...extra };
  await h.render(createElement(GitExplorer, props));
  const initial = h.requests.filter(request => !request.signal.aborted).at(-1);
  const renderGraph = (page, selectedOid = null) => renderToStaticMarkup(createElement(GitExplorerGraph, {
    page, selectedOid, onSelect() {}, onLoadMore() {},
  }));
  return { ...h, GitExplorer, props, initial, opened, changes, renderGraph };
}

test('observer-only graph rerenders retain held reads and selection; new work uses the current observer and exact promise', async t => {
  const h = await packet(t, { git: true }), { GitExplorer } = await h.load('./GitExplorer.tsx');
  const old = [], first = [], current = [], opened = [];
  const observe = list => work => { list.push(work); h.onReadWork(work); };
  const oldObserver = observe(old), firstObserver = observe(first), currentObserver = observe(current);
  const props = { cwd: '/repo', onOpenCommit: (...args) => opened.push(args), onBranchChange() {} };
  const render = observer => h.render(createElement(GitExplorer, { ...props, onReadWork: observer }));
  await render(oldObserver);
  const initial = h.requests.findLast(request => !request.signal.aborted);
  assert.equal(old.includes(initial.readWork), true, 'the original observer receives the complete production promise itself');
  const initialCount = h.requests.length, oldCount = old.length;
  await render(firstObserver);
  assert.equal(h.requests.length, initialCount, 'observer replacement must not admit another history request');
  assert.equal(initial.signal.aborted, false, 'observer replacement must not abort the held initial read');
  assert.equal(first.length, 0, 'already-admitted work is not reissued to a replacement observer');
  const initialPage = page(); initialPage.nextSkip = 2;
  await h.reply(initial, initialPage);
  const graph = h.view.container.querySelector('[aria-label="Commit graph"]'), selected = rows(h.view)[0];
  await click(h.view, selected);
  await click(h.view, textButton(h.view.container, 'Load older commits'));
  const held = h.requests.at(-1), count = h.requests.length, firstCount = first.length;
  assert.equal(first.at(-1) === held.readWork, true, 'the next admitted operation uses the replacement observer with exact promise identity');
  await render(currentObserver);
  assert.equal(h.requests.length, count, 'observer swap must not refetch or clear loaded history');
  assert.equal(held.signal.aborted, false);
  assert.equal(h.view.container.querySelector('[aria-label="Commit graph"]') === graph, true);
  assert.equal(rows(h.view)[0] === selected, true); assert.equal(selected.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(opened, [['main', head, head]]); assert.equal(current.length, 0);
  const more = page(); more.nextSkip = 3;
  more.commits = [{ oid: older, parents: [], author: 'Test', date: '2026-01-01', subject: 'older held body', tags: [] }];
  await h.reply(held, more);
  assert.equal(first.length, firstCount); assert.equal(current.length, 0, 'completion does not replay the old operation to the new observer');
  await click(h.view, textButton(h.view.container, 'Load older commits'));
  const next = h.requests.at(-1);
  assert.equal(current.length, 1); assert.equal(current[0] === next.readWork, true);
  assert.equal(first.length, firstCount); assert.equal(old.length, oldCount);
  assert.equal(next.url.searchParams.get('head'), head); assert.equal(next.url.searchParams.get('skip'), '3');
  await h.reply(next, { ...page(), commits: [{ ...more.commits[0], oid: 'd'.repeat(40), subject: 'next admitted body' }] });
  assert.equal(h.view.container.querySelector('[aria-label="Commit graph"]') === graph, true);
  assert.equal(rows(h.view)[0] === selected, true); assert.equal(selected.getAttribute('aria-pressed'), 'true');
});

test('local tags are fully named display badges, never branch roots or callback authority', async t => {
  const h = await explorer(t);
  const value = page(['same-name', 'release/v1,rc']);
  const html = h.renderGraph(value);
  assert.match(html, /aria-label="Local branch: same-name"/);
  for (const tag of ['same-name', 'release/v1,rc']) assert.equal(html.includes(`title="Local tag: ${tag}" aria-label="Local tag: ${tag}">tag: ${tag}`), true);
  const ssrRows = [...html.matchAll(/<button[^>]*aria-pressed="[^"]*"[\s\S]*?<\/button>/g)].map(([row]) => row);
  assert.match(ssrRows[0], /Local branch: main/); assert.match(ssrRows[0], /Local tag: same-name/);
  assert.doesNotMatch(ssrRows[1], /Local tag:/);
  await h.reply(h.initial, value);
  const select = h.view.container.querySelector('select');
  assert.deepEqual([...select.options].map(option => option.value), ['main', 'same-name']);
  const [latest, oldest] = rows(h.view);
  assert.equal(Boolean(oldest.querySelector('[aria-label="Local branch: same-name"]')), true);
  for (const tag of ['same-name', 'release/v1,rc']) {
    const badge = [...latest.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === `Local tag: ${tag}`);
    assert.equal(Boolean(badge), true); assert.equal(badge.title, `Local tag: ${tag}`);
    assert.equal(badge.textContent, `tag: ${tag}`);
  }
  assert.equal(Boolean(latest.querySelector('[aria-label="Local branch: main"]')), true);
  assert.equal(oldest.querySelector('[aria-label^="Local tag:"]') === null, true);
  assert.equal(h.view.container.querySelectorAll('svg circle').length, 2, 'actual graph rows');
  assert.equal(h.view.container.querySelectorAll('svg path').length, 1, 'actual parent edge');
  await click(h.view, latest);
  assert.deepEqual(h.opened, [['main', head, head]]);
  assert.equal(latest.getAttribute('aria-pressed'), 'true');
});

test('referenced rows and off-page notices bind the exact captured branch/head/oid', async t => {
  const reference = { cwd: '/repo', branch: 'main', head, oid: root, requestId: 1 };
  const h = await explorer(t, { initialSelection: reference });
  assert.deepEqual([...h.initial.url.searchParams].sort(), [['branch', 'main'], ['cwd', '/repo'], ['head', head], ['op', 'log']]);
  const html = h.renderGraph(page(), root);
  assert.match([...html.matchAll(/<button[^>]*aria-pressed="[^"]*"[\s\S]*?<\/button>/g)][1][0], /aria-pressed="true"/);
  const offPageGraph = h.renderGraph(page(), older);
  assert.equal((offPageGraph.match(/aria-pressed="true"/g) ?? []).length, 0);
  await h.reply(h.initial, page());
  assert.equal(rows(h.view)[1].getAttribute('aria-pressed'), 'true');
  assert.equal(h.view.container.querySelector('[role="status"]') === null, true);
  await h.render(createElement(h.GitExplorer, { ...h.props, key: 'new-reveal', initialSelection: { ...reference, oid: older, requestId: 2 } }));
  await h.reply(h.requests.at(-1), page());
  assert.match(h.view.container.textContent, /outside.*(?:page|loaded)|older commits/i);
  assert.equal(rows(h.view).every(row => row.getAttribute('aria-pressed') === 'false'), true);
  await click(h.view, rows(h.view)[0]);
  assert.deepEqual(h.opened, [['main', head, head]]);
});

test('long tag labels are escaped and visually bounded without truncating accessible identity', async t => {
  const long = `release/${'very-long-'.repeat(50)}v1,rc`, hostile = 'release/<rc>&v1';
  const h = await explorer(t);
  const html = h.renderGraph(page([long, hostile]));
  assert.equal(html.includes(`title="Local tag: ${long}" aria-label="Local tag: ${long}">tag: ${long}`), true);
  assert.match(html, /class="min-w-0 max-w-40 truncate rounded [^"]+" title="Local tag:/);
  assert.match(html, /class="flex w-full min-w-0 items-center gap-1 overflow-hidden text-\[10px\]"/);
  assert.match(html, /aria-label="Local tag: release\/&lt;rc&gt;&amp;v1"/); assert.doesNotMatch(html, /<rc>/);
  await h.reply(h.initial, page([long, hostile]));
  for (const tag of [long, hostile]) {
    const badge = [...rows(h.view)[0].querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === `Local tag: ${tag}`);
    assert.equal(Boolean(badge), true); assert.equal(badge.title, `Local tag: ${tag}`);
    assert.equal(badge.textContent, `tag: ${tag}`);
    for (const token of ['min-w-0', 'max-w-40', 'truncate', 'rounded']) assert.equal(badge.classList.contains(token), true, token);
    for (const token of ['flex', 'w-full', 'min-w-0', 'items-center', 'gap-1', 'overflow-hidden', 'text-[10px]'])
      assert.equal(badge.parentElement.classList.contains(token), true, token);
  }
  assert.equal(h.view.container.querySelector('rc, script') === null, true);
});

test('empty, moved and deleted tag snapshots replace decorations on actual refresh', async t => {
  const h = await explorer(t);
  assert.doesNotMatch(h.renderGraph(page()), /Local tag:/);
  const ssr = page(['moving']); assert.match(h.renderGraph(ssr), /Local tag: moving/);
  ssr.commits[0].tags = []; ssr.commits[1].tags = ['moving'];
  const movedRows = [...h.renderGraph(ssr).matchAll(/<button[^>]*aria-pressed="[^"]*"[\s\S]*?<\/button>/g)].map(([row]) => row);
  assert.doesNotMatch(movedRows[0], /Local tag:/); assert.match(movedRows[1], /Local tag: moving/);
  ssr.commits[1].tags = []; assert.doesNotMatch(h.renderGraph(ssr), /Local tag:/);
  const load = async value => {
    if (h.initial.jsonReturned) await click(h.view, textButton(h.view.container, 'Refresh'));
    await h.reply(h.requests.filter(request => !request.signal.aborted && !request.jsonReturned).at(-1), value);
  };
  await load(page()); assert.equal(h.view.container.querySelector('[aria-label^="Local tag:"]') === null, true);
  await load(page(['moving'])); assert.equal(Boolean(rows(h.view)[0].querySelector('[aria-label="Local tag: moving"]')), true);
  const moved = page(); moved.commits[1].tags = ['moving']; await load(moved);
  assert.equal(rows(h.view)[0].querySelector('[aria-label^="Local tag:"]') === null, true);
  assert.equal(Boolean(rows(h.view)[1].querySelector('[aria-label="Local tag: moving"]')), true);
  await load(page()); assert.equal(h.view.container.querySelector('[aria-label^="Local tag:"]') === null, true);
});

test('older pages use the current immutable view; rerendered controls invoke only current callbacks', async t => {
  const h = await explorer(t), first = page(); first.nextSkip = 2;
  await h.reply(h.initial, first);
  const current = [];
  await h.render(createElement(h.GitExplorer, { ...h.props, onOpenCommit: (...args) => current.push(args) }));
  await click(h.view, textButton(h.view.container, 'Load older commits'));
  const more = h.requests.at(-1);
  assert.deepEqual([...more.url.searchParams].sort(), [['branch', 'main'], ['cwd', '/repo'], ['head', head], ['op', 'log'], ['skip', '2']]);
  const next = page(); next.commits = [{ oid: older, parents: [], subject: 'older', author: 'Test', date: '2026-01-01', tags: [] }];
  await h.reply(more, next);
  await click(h.view, rows(h.view)[2]);
  assert.deepEqual(h.opened, []); assert.deepEqual(current, [['main', head, older]]);
  assert.equal(rows(h.view)[2].getAttribute('aria-pressed'), 'true');
  await choose(h.view, h.view.container.querySelector('select'), 'same-name');
  assert.equal(h.changes.length, 1);
  const branch = page([], 'same-name', root); branch.commits = [branch.commits[0]];
  await h.reply(h.requests.at(-1), branch);
  await click(h.view, rows(h.view)[0]);
  assert.deepEqual(current.at(-1), ['same-name', root, root]);
  await click(h.view, textButton(h.view.container, 'Refresh'));
  assert.equal(h.changes.length, 2);
  assert.equal(h.requests.at(-1).url.searchParams.has('head'), false, 'refresh recaptures, never reuses a referenced tip');
  await h.view.unmount();
  assert.equal(h.requests.at(-1).signal.aborted, true);
  await h.reply(h.requests.at(-1), branch);
  assert.equal(h.view.container.childNodes.length, 0);
});

test('an obsolete older-page body cannot append or clear loading for a newer branch', async t => {
  const h = await explorer(t), first = page(); first.nextSkip = 2;
  await h.reply(h.initial, first);
  await click(h.view, textButton(h.view.container, 'Load older commits'));
  const old = h.requests.at(-1);
  await choose(h.view, h.view.container.querySelector('select'), 'same-name');
  const latest = h.requests.at(-1);
  assert.equal(old.signal.aborted, true);
  await h.reply(old, { ...page(), commits: [{ ...first.commits[0], oid: older, subject: 'obsolete' }] });
  assert.match(h.view.container.querySelector('[role="status"]').textContent, /Loading Git history/);
  await h.reply(latest, page([], 'same-name', root));
  assert.doesNotMatch(h.view.container.textContent, /obsolete/);
  assert.equal(rows(h.view).every(row => row.getAttribute('aria-pressed') === 'false'), true);
});

test('A/B/A history keeps the new captured tip and selected graph after every ignored-abort body and finally', async t => {
  const h = await explorer(t);
  await h.reply(h.initial, page());
  await click(h.view, textButton(h.view.container, 'Refresh'));
  const oldA = h.requests.at(-1);
  await choose(h.view, h.view.container.querySelector('select'), 'same-name'); const oldB = h.requests.at(-1);
  await choose(h.view, h.view.container.querySelector('select'), 'main'); const latest = h.requests.at(-1);
  const freshHead = 'd'.repeat(40);
  await h.reply(latest, page(['fresh'], 'main', freshHead));
  const graph = h.view.container.querySelector('[aria-label="Commit graph"]'), selected = rows(h.view)[0];
  await click(h.view, selected);
  const retained = () => {
    assert.equal(h.view.container.querySelector('[aria-label="Commit graph"]') === graph, true);
    assert.equal(rows(h.view)[0] === selected, true); assert.equal(selected.getAttribute('aria-pressed'), 'true');
    assert.equal(h.view.container.querySelector('select').value, 'main');
    assert.deepEqual([...h.view.container.querySelector('select').options].map(option => option.value), ['main', 'same-name']);
    assert.equal(Boolean(selected.querySelector('[aria-label="Local tag: fresh"]')), true);
    assert.equal(h.view.container.querySelector('[role=status], [role=alert]') === null, true);
    assert.deepEqual(h.opened, [['main', freshHead, freshHead]]);
  };
  retained();
  const obsolete = [oldB, oldA, ...h.requests.filter(request => request !== latest && request !== oldA && request !== oldB && !request.jsonReturned)];
  for (const request of obsolete) {
    assert.equal(request.signal.aborted, true);
    const value = page(['obsolete'], request === oldB ? 'same-name' : 'main', request === oldB ? root : head);
    value.refs = [{ branch: 'obsolete-only', oid: head }];
    await h.reply(request, value); retained();
  }
});
