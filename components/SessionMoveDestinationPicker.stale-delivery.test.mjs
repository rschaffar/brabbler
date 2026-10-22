import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useCallback, useState } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { ignoredAbortFetch } from '../lib/testing/ignored-abort-fetch.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const { SessionMoveDestinationPicker } = await jiti.import('./SessionMoveDestinationPicker.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
const projects = ['/older', '/newer'].map(root => ({ root, key: root }));

// Only the existing controlled-prop owner is supplied here. The mounted picker,
// its internal selects, useEffect and response parser are all production code.
function PickerOwner({ changes }) {
  const [destination, setDestination] = useState('');
  const onChange = useCallback(value => { changes.push(value); setDestination(value); }, [changes]);
  return createElement(I18nProvider, null,
    createElement(SessionMoveDestinationPicker, {
      projects, currentProject: '/missing-source', currentCwd: '/missing-source/checkout',
      destination, onChange, disabled: false,
    }),
    createElement('output', { 'aria-label': 'Controlled destination' }, destination));
}
async function openOptions(view, id) {
  const input = view.container.querySelector(`#${id}`);
  assert.ok(input);
  assert.equal(input.disabled, false);
  if (input.getAttribute('aria-expanded') !== 'true') {
    await view.dispatch(input, new view.window.MouseEvent('click', { bubbles: true }));
  }
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  return [...view.container.querySelectorAll(`#${id}-options [role="option"]`)];
}
async function choose(view, id, value) {
  const option = (await openOptions(view, id)).find(item => item.dataset.value === value);
  assert.ok(option, `missing option ${value}`);
  assert.equal(option.disabled, false);
  await view.dispatch(option, new view.window.MouseEvent('click', { bubbles: true }));
}
const listing = (project, suffix) => ({ worktrees: [
  { path: project, branch: 'main', isMain: true },
  { path: `${project}/${suffix}`, branch: suffix },
] });

for (const selection of [['/older', '/newer'], ['/newer', '/older', '/newer']]) {
  test(`mounted Move listing retains explicit newer directory after ignored-abort JSON: ${selection.join(' -> ')}`, async t => {
    const transport = ignoredAbortFetch(t, '/api/worktrees');
    const { requests } = transport;
    let view;
    t.after(() => transport.dispose(() => view?.unmount()));
    const changes = [];
    view = await mount(t, createElement(PickerOwner, { changes }));
    assert.equal(requests.length, 0, 'opening must not probe a historical missing source');
    for (const project of selection) {
      await choose(view, 'move-session-project', project);
      assert.equal(requests.length, changes.length);
      const request = requests.at(-1);
      assert.equal(request.url.searchParams.get('cwd'), project);
      assert.equal(request.jsonCalls, 1);
      assert.equal(request.jsonReturned, false);
    }
    const latest = requests.at(-1);
    const obsolete = requests.slice(0, -1);
    for (const request of obsolete) assert.equal(request.signal.aborted, true);
    assert.equal(latest.signal.aborted, false);
    await latest.deliver(listing('/newer', 'chosen'));
    await choose(view, 'move-session-directory', '/newer/chosen');
    const directory = view.container.querySelector('#move-session-directory');
    const options = await openOptions(view, 'move-session-directory');
    const acceptedChanges = [...changes];
    assert.deepEqual(acceptedChanges, [...selection.map(() => ''), '/newer', '/newer/chosen']);
    const retained = () => {
      assert.equal(view.container.querySelector('#move-session-project').dataset.value, '/newer');
      assert.equal(view.container.querySelector('#move-session-directory'), directory);
      assert.equal(directory.dataset.value, '/newer/chosen');
      assert.equal(directory.disabled, false);
      assert.equal(view.container.querySelector('output').textContent, '/newer/chosen');
      const current = [...view.container.querySelectorAll('#move-session-directory-options [role="option"]')];
      assert.deepEqual(current.map(option => option.dataset.value), ['/newer', '/newer/chosen']);
      assert.ok(current.every((option, index) => option === options[index]), 'retained production option nodes');
      assert.equal(current[1].getAttribute('aria-selected'), 'true');
      assert.equal(view.container.querySelector('[role="alert"], [role="status"]'), null);
      assert.deepEqual(changes, acceptedChanges, 'obsolete effect must not call its controlled owner');
    };
    retained();
    for (const request of obsolete.toReversed()) {
      // Includes A -> B -> A: equality of the project string is insufficient.
      await request.deliver(listing(request.url.searchParams.get('cwd'), 'obsolete'));
      retained();
    }
    await view.unmount();
    assert.equal(latest.signal.aborted, true);
  });
}

test('unmounted Move listing consumes ignored-abort JSON without calling its former controlled owner', async t => {
  const transport = ignoredAbortFetch(t, '/api/worktrees');
  const { requests } = transport;
  let view;
  t.after(() => transport.dispose(() => view?.unmount()));
  const changes = [];
  view = await mount(t, createElement(PickerOwner, { changes }));
  await choose(view, 'move-session-project', '/older');
  assert.equal(requests.length, 1);
  const [pending] = requests;
  assert.equal(pending.signal.aborted, false);
  assert.equal(pending.jsonCalls, 1);
  assert.deepEqual(changes, ['']);
  await view.unmount();
  assert.equal(pending.signal.aborted, true);
  await pending.deliver(listing('/older', 'after-unmount'));
  assert.deepEqual(changes, [''], 'a state-write-only post-unmount assertion would miss this parent callback');
  assert.equal(view.container.childNodes.length, 0);
});
