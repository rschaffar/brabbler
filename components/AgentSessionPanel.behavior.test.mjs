import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, click, inputText } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const { AgentSessionPanelContent } = await jiti.import('./AgentSessionPanel.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
function info(id, status = 'completed', extra = {}) {
  return { id, name: id, path: `/fixture/${id}.jsonl`, cwd: '/fixture',
    created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', firstMessage: id, messageCount: 0,
    relation: { kind: 'subagent', parentSessionId: 'main', profile: 'Explore', description: id, status }, ...extra };
}
const main = { ...info('main'), relation: undefined };
const render = props => createElement(I18nProvider, null, createElement(AgentSessionPanelContent, {
  rootSession: main, selectedSessionId: 'main', runningSessionIds: new Set(), usage: new Map(), ...props,
}));
const rows = view => [...view.container.querySelectorAll('[role="listbox"] [role="option"]')];
const ids = view => rows(view).map(row => row.dataset.agentUsageId);
const rowFor = (view, id) => rows(view).find(row => row.dataset.agentUsageId === id);
const status = (view, id) => rowFor(view, id).lastElementChild.textContent.trim();
async function mountContent(t, element) {
  const http = controlledLeafFetch(t, request => assert.fail(`Content view admitted unexpected HTTP: ${request.url}`));
  return http.bind(await mount(t, element));
}

test('main remains first; actual rows select exact current sessions and live running order rerenders', async t => {
  const old = info('old', 'failed'), newer = info('newer', 'completed', { modified: '2026-01-02T00:00:00Z' });
  const selected = [];
  const props = { subagents: [newer, old], runningSessionIds: new Set(['old']),
    onSelectSession: session => selected.push(['old callback', session]) };
  const view = await mountContent(t, render(props));
  assert.deepEqual(ids(view), ['main', 'old', 'newer']);
  assert.equal(view.container.querySelector('input[type="search"]'), null);
  assert.equal(status(view, 'old'), 'Running');
  await click(view, rowFor(view, 'main'));
  assert.equal(selected[0][1], main);
  await click(view, rowFor(view, 'old'));
  assert.equal(selected[1][1], old);
  await view.rerender(render({ ...props, runningSessionIds: new Set(['newer']) }));
  assert.deepEqual(ids(view), ['main', 'newer', 'old'], 'running-only rerender recomputes order for the same session array');
  assert.equal(status(view, 'old'), 'Failed');

  const replacement = { ...old, name: 'updated exact object' };
  await view.rerender(render({ subagents: [replacement, newer], selectedSessionId: 'old',
    runningSessionIds: new Set(['newer']), onSelectSession: session => selected.push(['current callback', session]) }));
  assert.deepEqual(ids(view), ['main', 'newer', 'old']);
  assert.equal(status(view, 'old'), 'Failed');
  assert.equal(status(view, 'newer'), 'Running');
  assert.equal(rowFor(view, 'old').getAttribute('aria-selected'), 'true');
  assert.equal(rowFor(view, 'main').getAttribute('aria-selected'), 'false');
  await click(view, rowFor(view, 'old'));
  assert.deepEqual(selected.at(-1), ['current callback', replacement]);
  assert.equal(selected.at(-1)[1], replacement, 'not the obsolete object with the same id');
});

test('real search control covers description/profile/name/first message, preserves main and uses current callbacks', async t => {
  const subagents = Array.from({ length: 9 }, (_, index) => info(`child-${index}`));
  subagents[0] = info('description-hit', 'completed', { relation: { ...subagents[0].relation, description: 'needle-description' } });
  subagents[1] = info('profile-hit', 'completed', { relation: { ...subagents[1].relation, description: 'unrelated', profile: 'needle-profile' } });
  subagents[2] = info('name-hit', 'completed', { name: 'needle-name', relation: { ...subagents[2].relation, description: 'unrelated' } });
  subagents[3] = info('message-hit', 'completed', { firstMessage: 'needle-first', relation: { ...subagents[3].relation, description: 'unrelated' } });
  const picks = [];
  const view = await mountContent(t, render({ subagents, onSelectSession: session => picks.push(['initial', session]) }));
  const search = view.container.querySelector('input[aria-label="Search agents"]');
  assert.ok(search, 'nine subagents enable the real search control');
  for (const [query, id] of [['needle-description', 'description-hit'], ['needle-profile', 'profile-hit'],
    ['needle-name', 'name-hit'], ['needle-first', 'message-hit']]) {
    await inputText(view, search, `  ${query.toUpperCase()}  `);
    assert.deepEqual(ids(view), ['main', id], query);
  }
  await inputText(view, search, 'no matching metadata');
  assert.deepEqual(ids(view), ['main']);
  assert.ok(view.container.textContent.includes('No matching agents'));
  await inputText(view, search, 'needle-name');
  const replacement = { ...subagents[2], name: 'needle-name current' };
  await view.rerender(render({ subagents: subagents.map(session => session.id === replacement.id ? replacement : session),
    selectedSessionId: replacement.id, onSelectSession: session => picks.push(['current', session]) }));
  assert.equal(view.container.querySelector('input[type="search"]'), search, 'rerender retains the actual input');
  assert.deepEqual(ids(view), ['main', 'name-hit']);
  await click(view, rowFor(view, 'name-hit'));
  assert.deepEqual(picks, [['current', replacement]]);
  assert.equal(picks[0][1], replacement);
  await inputText(view, search, '');
  assert.equal(rows(view).length, 10);
  await view.rerender(render({ subagents: subagents.slice(0, 8), onSelectSession: session => picks.push(['eight', session]) }));
  assert.equal(view.container.querySelector('input[type="search"]'), null, 'eight does not show search');
});

test('persisted status labels update on the same row and live running takes precedence', async t => {
  const make = state => render({ subagents: [info('child', state)], onSelectSession() {} });
  const view = await mountContent(t, make('starting'));
  const row = rowFor(view, 'child');
  for (const [state, label] of [['starting', 'Starting'], ['completed', 'Completed'], ['failed', 'Failed'],
    ['aborted', 'Aborted'], ['interrupted', 'Interrupted'], ['paused', 'Paused']]) {
    await view.rerender(make(state));
    assert.equal(rowFor(view, 'child'), row);
    assert.equal(status(view, 'child'), label);
    await view.rerender(render({ subagents: [info('child', state)], runningSessionIds: new Set(['child']), onSelectSession() {} }));
    assert.equal(status(view, 'child'), 'Running');
  }
  await view.unmount();
  assert.equal(view.container.childNodes.length, 0);
});
