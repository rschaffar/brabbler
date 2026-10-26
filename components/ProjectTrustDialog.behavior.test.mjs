import "../lib/testing/client-native-boundary.fixture.mjs";
// UNEXECUTED actual choice/focus/current-callback owner. No synthetic grant store.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { lowerFixture } from './lower-account-controls.fixture.mjs';

const base = { requiresTrust: true, trusted: false, scope: 'none', repositoryRoot: '/synthetic/repository', checkoutRoot: '/synthetic/worktree', repositoryTrusted: false, worktreeDecision: null };
const rows = [
  ['Trust this worktree only', base, { scope: 'worktree', action: 'trust' }],
  ['Trust this Git project (all worktrees)', base, { scope: 'repository', action: 'trust' }],
  ['Stop trusting this worktree', { ...base, trusted: true, worktreeDecision: true }, { scope: 'worktree', action: 'revoke' }],
  ["Clear this worktree's restriction", { ...base, repositoryTrusted: true, worktreeDecision: false }, { scope: 'worktree', action: 'clear' }],
  ['Stop trusting this Git project', { ...base, trusted: true, repositoryTrusted: true }, { scope: 'repository', action: 'revoke' }],
];
const radio = (x, title) => [...x.f.view.container.querySelectorAll('label')].find(n => n.querySelector('strong')?.textContent === title)?.querySelector('input');
for (const [title, status, choice] of rows) test(`trust choice: ${choice.scope}/${choice.action} starts unselected, refuses busy and dispatches exact current callback`, async t => {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const old = [], current = [];
  const props = { cwd: '/synthetic/worktree', status, busy: false, error: null, onCancel() {}, onConfirm(value) { old.push(value); } };
  await x.mount(h(c.ProjectTrustDialog, props));
  assert.equal([...f.view.container.querySelectorAll('input')].every(n => !n.checked), true);
  assert.equal(x.button('Apply trust decision').disabled, true);
  await f.click(radio(x, title));
  assert.equal(x.button('Apply trust decision').disabled, false);
  await f.rerender(h(c.ProjectTrustDialog, { ...props, busy: true, onConfirm(value) { current.push(value); } }));
  assert.equal(x.button('Trusting...').disabled, true);
  assert.equal([...f.view.container.querySelectorAll('input')].every(n => n.disabled), true);
  assert.equal(x.button('Cancel').disabled, true);
  assert.deepEqual(current, []);
  await f.rerender(h(c.ProjectTrustDialog, { ...props, onConfirm(value) { current.push(value); } }));
  await f.click(x.button('Apply trust decision'));
  assert.deepEqual(current, [choice]); assert.deepEqual(old, []);
  assert.equal(f.requests.length, 0, 'choice callback not falsely labelled a real grant/reload');
});

test('trust dialog: explicit restriction warning, no-resource choices, busy Escape/backdrop refusal and current cancel; focus restores', async t => {
  const x = await lowerFixture(t), { f, graph: c } = x;
  let old = 0, current = 0;
  const props = { cwd: '/synthetic/worktree', status: { ...base, repositoryTrusted: true, worktreeDecision: false }, busy: false, error: null,
    onCancel() { old++; }, onConfirm() { throw new Error('unexpected implicit trust'); } };
  let previous;
  await x.mount(h(c.ProjectTrustDialog, props), { setup(window) {
    previous = window.document.createElement('button'); previous.textContent = 'Outside'; window.document.body.append(previous); previous.focus();
  } });
  assert.equal(f.view.window.document.activeElement === x.button('Cancel'), true);
  await f.click(radio(x, 'Trust this Git project (all worktrees)'));
  assert.match(x.text(), /A project grant will not override it/);
  await f.rerender(h(c.ProjectTrustDialog, { ...props, busy: true, onCancel() { current++; } }));
  const escape = () => new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  await f.view.dispatch(x.node('[role="dialog"]'), escape());
  await f.click(x.node('[role="presentation"]'));
  assert.equal(current, 0);
  await f.rerender(h(c.ProjectTrustDialog, { ...props, error: 'synthetic trust refusal', onCancel() { current++; } }));
  assert.equal(x.node('[role="alert"]').textContent, 'synthetic trust refusal');
  await f.view.dispatch(x.node('[role="dialog"]'), escape());
  await f.click(x.node('[role="presentation"]'));
  await f.click(x.button('Cancel'));
  assert.equal(current, 3); assert.equal(old, 0);
  await f.rerender(h(c.ProjectTrustDialog, { ...props, cwd: '/synthetic/plain', status: { requiresTrust: false, trusted: false, checkoutRoot: null, repositoryRoot: null } }));
  assert.equal(f.view.container.querySelectorAll('input').length, 0);
  assert.equal(x.button('Apply trust decision').disabled, true, 'removed choice cannot confirm stale scope');
  assert.match(x.text(), /no project resources that require trust/);
  await f.view.unmount(); assert.equal(f.view.window.document.activeElement === previous, true);
  assert.equal(f.requests.length, 0);
});
