import './client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from './react.fixture.mjs';
import { deferred } from './async.fixture.mjs';

function assertDescriptor(name, expected) {
  const actual = Object.getOwnPropertyDescriptor(globalThis, name);
  assert.equal(Boolean(actual), Boolean(expected), `${name}: descriptor presence`);
  assert.deepEqual(Object.keys(actual ?? {}).sort(), Object.keys(expected ?? {}).sort());
  for (const key of Object.keys(expected ?? {})) {
    // A wrong restored value may be a complete Window/React-owned DOM graph.
    assert.equal(Object.is(actual[key], expected[key]), true, `${name}: descriptor ${key}`);
  }
}

const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { MountProbe } = await jiti.import('./mount-probe.fixture.tsx');

test('actual TSX shares React identity, dispatches events, rerenders and joins Strict Effects cleanup', async t => {
  let mounts = 0, cleanups = 0;
  const props = { onMount: () => mounts++, onCleanup: () => cleanups++ };
  const view = await mount(t, createElement(MountProbe, { ...props, label: 'first' }));
  const button = view.container.querySelector('button');
  assert.equal(button.textContent, 'first: 0');
  assert.equal(mounts, 2); assert.equal(cleanups, 1);
  await view.dispatch(button, new view.window.MouseEvent('click', { bubbles: true }));
  assert.equal(button.textContent, 'first: 1');
  await view.rerender(createElement(MountProbe, { ...props, label: 'next' }));
  assert.equal(view.container.querySelector('button') === button, true, 'same mounted button');
  assert.equal(button.textContent, 'next: 1');
  await view.unmount();
  assert.equal(cleanups, 2);
  assert.equal(view.container.childNodes.length, 0);
  await assert.rejects(view.rerender(createElement(MountProbe, props)), /closed/);
});

test('the emulated document owns storage and fixture disposal restores global descriptors', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const view = await mount(t, createElement('div'), { setup(window) { window.localStorage.setItem('fixture', 'value'); } });
  assert.equal(view.window.localStorage.getItem('fixture'), 'value');
  await assert.rejects(mount(t, createElement('div')), /already owned/);
  assert.equal(globalThis.window === view.window, true, 'rejected overlap cannot replace the active realm');
  const disposal = view.dispose();
  assert.equal(view.dispose(), disposal, 'concurrent disposal joins the same complete work');
  await disposal;
  assertDescriptor('window', previous);
});

test('partial global installation restores descriptors and releases ownership', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const failure = new Error('global installation failed');
  const define = Object.defineProperty;
  let injected = false;
  t.mock.method(Object, 'defineProperty', (target, key, descriptor) => {
    if (!injected && target === globalThis && key === 'document') {
      injected = true;
      throw failure;
    }
    return define(target, key, descriptor);
  });
  await assert.rejects(mount(t, createElement('div')), error => error === failure);
  assert.equal(injected, true);
  assertDescriptor('window', previous);
  const next = await mount(t, createElement('div'));
  await next.dispose();
});

test('setup failure preserves its cause and restores globals', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const failure = new Error('setup failed');
  await assert.rejects(mount(t, createElement('div'), { setup() { throw failure; } }), error => error === failure);
  assertDescriptor('window', previous);
});

test('cleanup failures do not skip restoration or erase the primary failure', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const primary = new Error('setup failed');
  const cleanup = new Error('close failed');
  const afters = [];
  const owner = { after(callback) { afters.push(callback); } };
  await assert.rejects(mount(owner, createElement('div'), {
    setup(window) {
      const close = window.close.bind(window);
      window.close = () => { close(); throw cleanup; };
      throw primary;
    },
  }), error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
  await assert.rejects(afters[0], error => error === cleanup);
  assertDescriptor('window', previous);
  const next = await mount(t, createElement('div'));
  await next.dispose();
});

test('normal disposal joins admitted caller work before closing its realm or restoring globals', async t => {
  const release = deferred(), entered = deferred(), order = [];
  t.after(() => release.resolve());
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const view = await mount(t, createElement('div'), {
    setup(window) {
      const close = window.close.bind(window);
      window.close = () => { order.push('close'); close(); };
    },
    async beforeDispose({ window, container }) {
      assert.equal(globalThis.window === window, true, 'realm remains installed through caller join');
      assert.equal(container.childNodes.length, 0, 'React observer already unmounted');
      order.push('joining'); entered.resolve();
      await release.promise;
      order.push('settled');
    },
  });
  const disposal = view.dispose();
  await entered.promise;
  assert.deepEqual(order, ['joining']);
  assert.equal(globalThis.window === view.window, true);
  release.resolve(); await disposal;
  assert.deepEqual(order, ['joining', 'settled', 'close']);
  assertDescriptor('window', previous);
});

test('failed setup hands admitted work to caller join before exceptional realm disposal', async t => {
  const release = deferred(), entered = deferred(), order = [];
  t.after(() => release.resolve());
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const failure = new Error('setup after caller admission failed');
  let realm;
  const mounting = mount(t, createElement('div'), {
    setup(window) {
      realm = window;
      const close = window.close.bind(window);
      window.close = () => { order.push('close'); close(); };
      throw failure;
    },
    async beforeDispose({ window }) {
      assert.equal(window === realm && globalThis.window === realm, true);
      order.push('joining'); entered.resolve();
      await release.promise;
      order.push('settled');
    },
  });
  void mounting.catch(() => {});
  await entered.promise;
  assert.deepEqual(order, ['joining']);
  assert.equal(globalThis.window === realm, true);
  release.resolve();
  await assert.rejects(mounting, error => error === failure);
  assert.deepEqual(order, ['joining', 'settled', 'close']);
  assertDescriptor('window', previous);
});

test('caller join failure preserves setup and close errors without skipping restoration', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const primary = new Error('setup failed after admission');
  const joinFailure = new Error('caller join failed');
  const closeFailure = new Error('realm close failed');
  const afters = [], order = [];
  const owner = { after(callback) { afters.push(callback); } };
  await assert.rejects(mount(owner, createElement('div'), {
    setup(window) {
      const close = window.close.bind(window);
      window.close = () => { order.push('close'); close(); throw closeFailure; };
      throw primary;
    },
    beforeDispose() { order.push('join'); throw joinFailure; },
  }), error => error instanceof AggregateError && error.errors[0] === primary
    && error.errors[1] instanceof AggregateError
    && error.errors[1].errors[0] === joinFailure && error.errors[1].errors[1] === closeFailure);
  assert.deepEqual(order, ['join', 'close']);
  await assert.rejects(afters[0], error => error instanceof AggregateError
    && error.errors[0] === joinFailure && error.errors[1] === closeFailure);
  assertDescriptor('window', previous);
  const next = await mount(t, createElement('div'));
  await next.dispose();
});
