import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from './react.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: true });
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
  assert.equal(view.container.querySelector('button'), button);
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
  assert.equal(globalThis.window, view.window, 'rejected overlap cannot replace the active realm');
  const disposal = view.dispose();
  assert.equal(view.dispose(), disposal, 'concurrent disposal joins the same complete work');
  await disposal;
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), previous);
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
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), previous);
  const next = await mount(t, createElement('div'));
  await next.dispose();
});

test('setup failure preserves its cause and restores globals', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const failure = new Error('setup failed');
  await assert.rejects(mount(t, createElement('div'), { setup() { throw failure; } }), error => error === failure);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), previous);
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
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), previous);
  const next = await mount(t, createElement('div'));
  await next.dispose();
});
