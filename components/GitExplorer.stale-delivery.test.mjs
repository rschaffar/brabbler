import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { ignoredAbortFetch } from '../lib/testing/ignored-abort-fetch.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const { GitExplorer } = await jiti.import('./GitExplorer.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
const branches = ['main', 'feature', 'topic'];
const oids = { main: 'a'.repeat(40), feature: 'b'.repeat(40), topic: 'c'.repeat(40) };
function page(branch, refs = branches) {
  const head = oids[branch];
  return {
    head, branch, refs: refs.map(name => ({ branch: name, oid: oids[name] ?? head })), nextSkip: null,
    commits: [{ oid: head, parents: [], author: 'Fixture', date: '2026-01-01', subject: `${branch} delivered commit`, tags: [] }],
  };
}

test('mounted GitExplorer retains the newer branch, refs and selected commit after obsolete JSON really returns', async t => {
  const transport = ignoredAbortFetch(t, '/api/git/explorer');
  const { requests } = transport;
  let view;
  t.after(() => transport.dispose(() => view?.unmount()));
  const opened = [];
  let branchChanges = 0;
  view = await mount(t, createElement(I18nProvider, null, createElement(GitExplorer, {
    cwd: '/checkout', onOpenCommit: (...args) => opened.push(args), onBranchChange: () => branchChanges++,
  })));
  // Strict Effects creates an obsolete initial request as well as the live one.
  assert.equal(requests.length, 2);
  const [strictReplay, initial] = requests;
  assert.equal(strictReplay.signal.aborted, true);
  assert.equal(initial.signal.aborted, false);
  await initial.deliver(page('main'));
  const select = view.container.querySelector('select[aria-label="History branch"]');
  assert.equal(select.value, 'main');
  const chooseBranch = async value => {
    select.value = value;
    await view.dispatch(select, new view.window.Event('change', { bubbles: true }));
  };
  await chooseBranch('feature');
  assert.equal(requests.length, 3);
  const old = requests[2];
  assert.equal(old.signal.aborted, false);
  assert.equal(old.jsonCalls, 1);
  assert.equal(old.jsonReturned, false);
  await chooseBranch('topic');
  assert.equal(requests.length, 4);
  const latest = requests[3];
  assert.equal(old.signal.aborted, true, 'the old transport ignores this actual production abort');
  assert.equal(latest.signal.aborted, false);
  for (const [request, branch] of [[old, 'feature'], [latest, 'topic']]) {
    assert.equal(request.url.searchParams.get('cwd'), '/checkout');
    assert.equal(request.url.searchParams.get('op'), 'log');
    assert.equal(request.url.searchParams.get('branch'), branch);
  }
  await latest.deliver(page('topic'));
  const graph = view.container.querySelector('[aria-label="Commit graph"]');
  const row = graph.querySelector('button[aria-pressed]');
  await view.dispatch(row, new view.window.MouseEvent('click', { bubbles: true }));
  const retained = () => {
    assert.equal(view.container.querySelector('select'), select);
    assert.equal(select.value, 'topic');
    assert.deepEqual([...select.options].map(option => option.value), branches);
    assert.equal(view.container.querySelector('[aria-label="Commit graph"]'), graph);
    assert.equal(graph.querySelector('button[aria-pressed]'), row);
    assert.equal(row.getAttribute('aria-pressed'), 'true');
    assert.match(row.textContent, /topic delivered commit/);
    assert.doesNotMatch(view.container.textContent, /(?:main|feature) delivered commit/);
    assert.equal(view.container.querySelector('[role="status"], [role="alert"]'), null);
    assert.deepEqual(opened, [['topic', oids.topic, oids.topic]]);
    assert.equal(branchChanges, 2);
  };
  retained();
  // Deliver only AFTER the newer result has rendered and the user selected it.
  // Poisoned refs also expose an obsolete setAvailableRefs, not only setPage.
  await old.deliver(page('feature', ['obsolete-feature-ref']));
  retained();
  await strictReplay.deliver(page('main', ['obsolete-replay-ref']));
  retained();

  // Join an outstanding body across unmount. Abort + settlement is asserted;
  // empty DOM alone is not evidence against post-unmount React state writes.
  const refresh = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Refresh');
  await view.dispatch(refresh, new view.window.MouseEvent('click', { bubbles: true }));
  assert.equal(requests.length, 5);
  const closing = requests[4];
  assert.equal(closing.jsonCalls, 1);
  assert.equal(closing.signal.aborted, false);
  await view.unmount();
  assert.equal(closing.signal.aborted, true);
  await closing.deliver(page('topic'));
  assert.equal(view.container.childNodes.length, 0);
  assert.deepEqual(opened, [['topic', oids.topic, oids.topic]]);
});
