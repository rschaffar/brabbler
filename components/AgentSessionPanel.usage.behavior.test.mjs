import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { agentUsagePanelOwner } from '../lib/testing/agent-usage-panel.support.fixture.mjs';
import { click, inputText } from '../lib/testing/leaf-controls.fixture.mjs';

const info = (id, extra = {}) => ({
  id, name: id, path: `/fixture/${id}.jsonl`, cwd: '/fixture',
  created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', firstMessage: id, messageCount: 0,
  relation: { kind: 'subagent', parentSessionId: 'main', profile: 'Explore', description: id, status: 'completed' }, ...extra,
});
const main = info('main', { relation: undefined });
const children = [info('child-a'), info('child-b'), info('working-child')];
// Exact original browser four-ID tuple, not a replacement stats algorithm.
const amounts = new Map([['main', 100], ['child-a', 20], ['child-b', 30], ['working-child', 40]]);
const summary = (total, ms = 30000) => ({ tokens: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
  cost: total / 10000, toolCalls: 1, totalActiveMs: ms });
const stats = Object.fromEntries([...amounts].map(([id, total]) => [id, summary(total, id === 'main' ? 60000 : 30000)]));
const exactIds = [...amounts.keys()].sort();
const rows = view => [...view.container.querySelectorAll('[role="listbox"] [role="option"]')];
const ids = view => rows(view).map(row => row.dataset.agentUsageId);
const row = (view, id) => rows(view).find(node => node.dataset.agentUsageId === id);
const family = view => view.container.querySelector('[data-testid="agent-family-usage"]');
const selected = view => view.container.querySelector('[aria-label="Selected agent usage"]');
const text = node => node.textContent;
function aggregate(view, available = '4/4 available', tokens = 190, duration = '2m 30s') {
  assert.ok(text(family(view)).includes(`Summed estimated active time: ${duration} · ${tokens} tokens · $0.02 recorded`));
  assert.ok(text(family(view)).includes(available));
}
function values(section) {
  return Object.fromEntries([...section.querySelectorAll('dl dt')].map(node => [text(node), text(node.nextElementSibling)]));
}

// One imported production graph, one live controller (plus StrictMode's disposed
// replay), one batched matrix. No SDK startup, time sleeps or timer substitution.
test('default AgentSessionPanel composes real usage IO: family/selected scope, current results, callbacks and owned teardown', async t => {
  const owner = agentUsagePanelOwner(t); // guards BEFORE production import
  const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
  const { AgentSessionPanel } = await jiti.import('./AgentSessionPanel.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const picks = [];
  let props = { rootSession: main, subagents: children, selectedSessionId: 'main', runningSessionIds: new Set(),
    onSelectSession: session => picks.push(['initial', session]), onUsageWork: owner.onWork };
  const render = () => createElement(I18nProvider, null, createElement(AgentSessionPanel, props));
  const view = await owner.mount(render());
  const update = async patch => { props = { ...props, ...patch }; await view.rerender(render()); };
  const newest = () => owner.requests.at(-1);
  const deliver = async (request, payload = { stats }, status = 200) => {
    await owner.headers(request, status); await owner.body(request, payload);
  };
  const refresh = async () => { await owner.visibility(false); await owner.visibility(true); return newest(); };

  assert.equal(owner.requests.length, 2, 'StrictMode replay starts a fresh real owner after disposing its first flight');
  assert.equal(owner.subscriptions, 1);
  assert.equal(owner.adds, 2); assert.equal(owner.removes, 1);
  for (const request of owner.requests) assert.deepEqual(request.ids, exactIds);
  const obsoleteMount = owner.requests[0], currentMount = owner.requests[1];
  assert.equal(obsoleteMount.options.signal.aborted, true);
  assert.equal(currentMount.options.signal.aborted, false);
  await owner.headers(obsoleteMount); // ignored-abort headers AND body
  await deliver(currentMount);
  aggregate(view);
  await owner.body(obsoleteMount, { stats: Object.fromEntries(exactIds.map(id => [id, summary(999)])) });
  aggregate(view); // disposed StrictMode owner cannot replace the current tuple
  assert.deepEqual(ids(view), ['main', 'child-a', 'child-b', 'working-child']);
  assert.equal(row(view, 'main').getAttribute('aria-selected'), 'true');
  assert.ok(text(row(view, 'main')).includes('Main agent'));
  assert.ok(text(row(view, 'main')).includes('Current'));
  for (const [id, total] of amounts) assert.ok(text(row(view, id)).includes(`${total} tokens`), id);
  assert.equal(view.container.querySelector('[role="listbox"]').querySelectorAll('summary, details, button button').length, 0);

  const familyDetails = family(view).querySelector('details');
  const selectedDetails = selected(view).parentElement;
  await click(view, familyDetails.querySelector('summary'));
  await click(view, selectedDetails.querySelector('summary'));
  assert.equal(familyDetails.open, true); assert.equal(selectedDetails.open, true);
  assert.ok(text(familyDetails).includes('not an invoice'));
  assert.ok(text(familyDetails).includes('regardless of search'));
  assert.equal(values(selected(view))['Recorded cost'], '$0.0100');
  assert.equal(values(selected(view))['Estimated active time'], '1m 0s');
  assert.equal(values(selected(view))['Total'], '100');
  assert.equal(values(family(view))['Total'], '190');
  assert.equal(values(family(view))['Tool Calls'], '4');

  await click(view, row(view, 'main'));
  await click(view, row(view, 'child-a'));
  assert.equal(picks[0][1] === main, true);
  assert.equal(picks[1][1] === children[0], true);
  assert.equal(values(selected(view))['Recorded cost'], '$0.0100', 'callback alone is not router adoption');
  const replacement = info('child-a', { name: 'current child-a object' });
  await update({ subagents: [replacement, ...children.slice(1)], selectedSessionId: 'child-a',
    onSelectSession: session => picks.push(['current', session]) });
  assert.equal(values(selected(view))['Recorded cost'], '$0.0020');
  assert.equal(values(selected(view))['Total'], '20');
  assert.equal(row(view, 'child-a').getAttribute('aria-selected'), 'true');
  assert.equal(row(view, 'main').getAttribute('aria-selected'), 'false');
  await click(view, row(view, 'child-a'));
  assert.equal(picks.at(-1)[0], 'current'); assert.equal(picks.at(-1)[1] === replacement, true);
  aggregate(view);
  assert.equal(owner.requests.length, 2, 'selection/callback/object-only changes do not refetch');
  assert.equal(family(view).querySelector('details'), familyDetails);
  assert.equal(selected(view).parentElement, selectedDetails);
  assert.equal(selectedDetails.open, true, 'disclosure survives actual rerenders');

  // Running->idle while a real read is outstanding queues the final-stop read.
  await update({ runningSessionIds: new Set(['working-child']) });
  const stopping = newest(), countBeforeStop = owner.requests.length;
  assert.deepEqual(ids(view), ['main', 'working-child', 'child-a', 'child-b']);
  assert.ok(text(row(view, 'working-child')).includes('Running'));
  assert.ok(text(view.container).includes('1 running'));
  await owner.headers(stopping);
  await update({ runningSessionIds: new Set() });
  assert.equal(stopping.options.signal.aborted, true);
  assert.equal(owner.requests.length, countBeforeStop, 'abort is not single-flight settlement');
  await owner.body(stopping, { stats: Object.fromEntries(exactIds.map(id => [id, summary(999)])) });
  aggregate(view);
  assert.equal(owner.requests.length, countBeforeStop + 1, 'actual finally starts queued current read');
  await deliver(newest());
  assert.ok(text(row(view, 'working-child')).includes('Completed'));
  assert.equal(text(view.container).includes('1 running'), false);
  aggregate(view);

  const hiddenBody = await refresh(); await owner.headers(hiddenBody);
  const beforeHidden = owner.requests.length;
  await owner.visibility(false); await owner.visibility(true);
  assert.equal(hiddenBody.options.signal.aborted, true);
  assert.equal(owner.requests.length, beforeHidden);
  await owner.body(hiddenBody, { stats: { main: summary(999) } });
  aggregate(view);
  const httpError = newest(); assert.notEqual(httpError, hiddenBody);
  await deliver(httpError, {}, 503); // real adapter throws; coordinator catch retains stale tuple
  aggregate(view); assert.ok(text(family(view)).includes('4 stale'));
  const jsonError = await refresh(); await owner.headers(jsonError);
  await owner.body(jsonError, new Error('controlled body failure'), { reject: true });
  aggregate(view); assert.ok(text(family(view)).includes('4 stale'));
  const invalidEnvelope = await refresh();
  await deliver(invalidEnvelope, { stats: [] });
  aggregate(view); assert.ok(text(family(view)).includes('4 stale'));
  const omission = await refresh();
  await deliver(omission, { stats: { main: stats.main, 'child-a': stats['child-a'], 'working-child': stats['working-child'] } });
  aggregate(view, 'Partial · 3/4 available', 160, '2m 0s');
  await update({ selectedSessionId: 'child-b' });
  assert.ok(text(selected(view)).includes('Recorded usage unavailable'));
  assert.equal(selected(view).querySelector('dl'), null, 'successful omission clears selected cached numbers');
  await deliver(await refresh()); aggregate(view);
  assert.equal(values(selected(view))['Recorded cost'], '$0.0030');

  // Real search threshold requires nine children. Six recorded-zero agents
  // preserve the original exact four-ID numerical tuple, not the denominator.
  const extras = Array.from({ length: 6 }, (_, i) => info(`extra-${i}`));
  await update({ subagents: [replacement, ...children.slice(1), ...extras] });
  const ten = newest(); assert.equal(ten.ids.length, 10);
  await deliver(ten, { stats: { ...stats, ...Object.fromEntries(extras.map(agent => [agent.id,
    { ...summary(0, 0), toolCalls: 0 }])) } });
  aggregate(view, '10/10 available');
  const search = view.container.querySelector('input[aria-label="Search agents"]');
  assert.ok(search);
  await inputText(view, search, '  CHILD-A  ');
  assert.deepEqual(ids(view), ['main', 'child-a']);
  aggregate(view, '10/10 available');
  assert.equal(values(selected(view))['Total'], '30', 'hidden selected row does not change selected scope');
  assert.equal(values(selected(view))['Recorded cost'], '$0.0030');
  await click(view, row(view, 'child-a'));
  assert.equal(picks.at(-1)[1] === replacement, true);
  await inputText(view, search, 'no matching agent'); assert.deepEqual(ids(view), ['main']);
  aggregate(view, '10/10 available');
  await inputText(view, search, '');

  // A different family while JSON is outstanding must not publish into A again.
  const otherMain = info('other-main', { relation: undefined });
  await update({ rootSession: otherMain, subagents: [info('other-child')], selectedSessionId: 'other-main' });
  const other = newest(); await owner.headers(other);
  assert.equal(text(family(view)).includes('190 tokens'), false);
  await update({ rootSession: main, subagents: children, selectedSessionId: 'main' });
  assert.equal(other.options.signal.aborted, true);
  const beforeOther = owner.requests.length;
  await owner.body(other, { stats: { 'other-main': summary(999), main: summary(888) } });
  assert.equal(owner.requests.length, beforeOther + 1);
  assert.equal(text(family(view)).includes('999'), false);
  assert.equal(text(selected(view)).includes('888'), false);
  assert.equal(text(family(view)).includes('190 tokens'), false, 'A waits for its own current result');
  assert.deepEqual(newest().ids, exactIds);
  await deliver(newest()); aggregate(view);
  assert.equal(values(selected(view))['Recorded cost'], '$0.0100');

  // Unmount is not a body/pump join. Prove the observer includes full finally,
  // then let the common owner restore ports only AFTER that full work settles.
  const leaving = await refresh(); await owner.headers(leaving);
  const admittedBeforeUnmount = owner.requests.length;
  await view.unmount();
  assert.equal(owner.subscriptions, 0);
  assert.equal(leaving.options.signal.aborted, true);
  assert.equal(owner.work.find(record => record.promise === leaving.work).settled, false);
  // Leave the ignored-abort JSON held: dispose must release it, not just abort.
  await owner.dispose();
  assert.equal(owner.requests.length, admittedBeforeUnmount);
  assert.equal(view.container.childNodes.length, 0);
  assert.equal(owner.work.every(record => record.settled), true);
  assert.equal(owner.adds, owner.removes);
  owner.assertHealthy();

  // Same imported graph; failed setup after port/subscription instrumentation
  // must still join and restore even though mount cannot return/bind a view.
  const failed = agentUsagePanelOwner(t), setupFailure = new Error('intentional setup failure');
  await assert.rejects(failed.mount(render(), { failSetup: setupFailure }), error => error === setupFailure);
  await failed.dispose();
  assert.equal(failed.requests.length, 0);
  assert.equal(failed.subscriptions, 0);
});
