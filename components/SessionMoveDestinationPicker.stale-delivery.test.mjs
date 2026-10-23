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
function PickerOwner({ changes, currentProject = '/missing-source', currentCwd = '/missing-source/checkout', sourceUnavailable = true, allowCurrentDirectory = false }) {
  const [destination, setDestination] = useState('');
  const onChange = useCallback(value => { changes.push(value); setDestination(value); }, [changes]);
  return createElement(I18nProvider, null,
    createElement(SessionMoveDestinationPicker, {
      projects, currentProject, currentCwd, sourceUnavailable, allowCurrentDirectory,
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

for (const currentCwd of ['/older', '/older/checkout']) {
  test(`mounted Move preselects source project and directory without proposing a no-op: ${currentCwd}`, async t => {
    const transport = ignoredAbortFetch(t, '/api/worktrees');
    let view;
    t.after(() => transport.dispose(() => view?.unmount()));
    const changes = [];
    view = await mount(t, createElement(PickerOwner, {
      changes, currentProject: '/older', currentCwd, sourceUnavailable: false,
    }));
    const project = view.container.querySelector('#move-session-project');
    const directory = view.container.querySelector('#move-session-directory');
    assert.equal(project.dataset.value, '/older');
    assert.equal(directory.dataset.value, currentCwd, 'source remains selected during loading');
    assert.equal(view.container.querySelector('output').textContent, '');
    assert.ok(transport.requests.length > 0);
    assert.ok(transport.requests.every(request => request.url.searchParams.get('cwd') === '/older'));
    await transport.requests.at(-1).deliver(listing('/older', 'checkout'));
    assert.equal(directory.dataset.value, currentCwd, 'listing must not replace the selected worktree with main');
    assert.equal(directory.disabled, false);
    const source = (await openOptions(view, 'move-session-directory')).find(option => option.dataset.value === currentCwd);
    assert.equal(source.getAttribute('aria-selected'), 'true');
    assert.equal(source.disabled, true, 'current directory cannot be a move target');
    assert.equal(view.container.querySelector('output').textContent, '');
    await choose(view, 'move-session-directory', currentCwd === '/older' ? '/older/checkout' : '/older');
    assert.equal(view.container.querySelector('output').textContent, currentCwd === '/older' ? '/older/checkout' : '/older');
    await choose(view, 'move-session-project', '/newer');
    assert.equal(view.container.querySelector('output').textContent, '', 'project changes clear the old proposal');
    await transport.requests.at(-1).deliver(listing('/newer', 'target'));
    assert.equal(view.container.querySelector('output').textContent, '/newer');
  });
}

test('a missing source can explicitly reselect its project to reach surviving checkouts', async t => {
  const transport = ignoredAbortFetch(t, '/api/worktrees');
  let view;
  t.after(() => transport.dispose(() => view?.unmount()));
  const changes = [];
  view = await mount(t, createElement(PickerOwner, {
    changes, currentProject: '/older', currentCwd: '/older/deleted', sourceUnavailable: true,
  }));
  assert.equal(transport.requests.length, 0, 'preselection alone must not probe missing history');
  await choose(view, 'move-session-project', '/older');
  assert.equal(transport.requests.length, 1, 'explicit reselection can load the surviving project');
  await transport.requests.at(-1).deliver(listing('/older', 'survivor'));
  const options = await openOptions(view, 'move-session-directory');
  assert.equal(options.find(option => option.dataset.value === '/older/deleted').disabled, true);
  await choose(view, 'move-session-directory', '/older');
  assert.equal(view.container.querySelector('output').textContent, '/older');
});

test('bulk Move can explicitly consolidate other worktrees into the preselected current directory', async t => {
  const transport = ignoredAbortFetch(t, '/api/worktrees');
  let view;
  t.after(() => transport.dispose(() => view?.unmount()));
  const changes = [];
  view = await mount(t, createElement(PickerOwner, {
    changes, currentProject: '/older', currentCwd: '/older', sourceUnavailable: false, allowCurrentDirectory: true,
  }));
  await transport.requests.at(-1).deliver(listing('/older', 'checkout'));
  assert.equal(view.container.querySelector('#move-session-directory').dataset.value, '/older');
  assert.equal(view.container.querySelector('output').textContent, '', 'opening alone is not a proposal');
  await choose(view, 'move-session-directory', '/older');
  assert.equal(view.container.querySelector('output').textContent, '/older', 'bulk preview owns already-at-destination filtering');
});

for (const selection of [['/older', '/newer'], ['/newer', '/older', '/newer']]) {
  test(`mounted Move listing retains explicit newer directory after ignored-abort JSON: ${selection.join(' -> ')}`, async t => {
    const transport = ignoredAbortFetch(t, '/api/worktrees');
    const { requests } = transport;
    let view;
    t.after(() => transport.dispose(() => view?.unmount()));
    const changes = [];
    view = await mount(t, createElement(PickerOwner, { changes }));
    assert.equal(requests.length, 0, 'opening must not probe a historical missing source');
    assert.equal(view.container.querySelector('#move-session-project').dataset.value, '/missing-source');
    assert.equal(view.container.querySelector('#move-session-directory').dataset.value, '/missing-source/checkout');
    assert.equal(view.container.querySelector('output').textContent, '');
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
