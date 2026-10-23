import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount, pointerCaptureDouble } from '../lib/testing/react.fixture.mjs';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { useResizablePanel } = await jiti.import('./useResizablePanel.ts');
function Panel({ options }) {
  const panel = useResizablePanel(options);
  return createElement('div', { ref: panel.panelRef, 'data-width': panel.width },
    createElement('div', panel.separatorProps));
}
async function fixture(t, overrides = {}, setup) {
  const widthRef = { current: 200 };
  const options = { ariaLabel: 'Resize fixture', cssVariable: '--fixture-width',
    defaultWidth: 200, getMaxWidth: () => 400, growthDirection: 'right',
    maxWidth: 500, minWidth: 100, storageKey: 'fixture-width', widthRef, ...overrides };
  const view = await mount(t, createElement(Panel, { options }), { setup });
  const handle = view.container.querySelector('[role=separator]');
  const capture = pointerCaptureDouble(handle);
  return { ...view, options, widthRef, handle, capture,
    pointer: (type, init = {}) => view.dispatch(handle, new view.window.PointerEvent(type, {
      bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: 100, clientY: 100, ...init,
    })),
    key: (key, shiftKey = false) => view.dispatch(handle, new view.window.KeyboardEvent('keydown', { bubbles: true, key, shiftKey })),
  };
}

for (const [axis, growthDirection, expected, growKey] of [
  ['horizontal', 'right', 230, 'ArrowRight'], ['horizontal', 'left', 170, 'ArrowLeft'],
  ['vertical', 'down', 230, 'ArrowDown'], ['vertical', 'up', 170, 'ArrowUp'],
]) test(`${axis}/${growthDirection}: actual events own pointer, live size, finish persistence and keys`, async t => {
  const f = await fixture(t, { axis, growthDirection }, window => {
    window.document.body.style.cursor = 'progress'; window.document.body.style.userSelect = 'text';
  });
  assert.equal(f.handle.getAttribute('aria-orientation'), axis === 'vertical' ? 'horizontal' : 'vertical');
  await f.pointer('pointerdown');
  assert.equal(f.capture.has(7), true);
  assert.equal(f.window.document.body.style.cursor, axis === 'vertical' ? 'row-resize' : 'col-resize');
  await f.pointer('pointermove', { pointerId: 8, clientX: 130, clientY: 130 });
  assert.equal(f.widthRef.current, 200, 'another pointer cannot move the panel');
  await f.pointer('pointermove', { clientX: 130, clientY: 130 });
  assert.equal(f.widthRef.current, expected);
  assert.equal(f.container.firstChild.style.getPropertyValue('--fixture-width'), `${expected}px`);
  assert.equal(f.handle.getAttribute('aria-valuenow'), String(expected));
  assert.equal(f.window.localStorage.getItem('fixture-width'), null, 'moves do not persist');
  await f.pointer('pointerup', { pointerId: 8 });
  assert.equal(f.capture.has(7), true);
  await f.pointer('pointerup');
  assert.equal(f.capture.size, 0);
  assert.equal(f.window.localStorage.getItem('fixture-width'), String(expected));
  assert.equal(f.container.firstChild.dataset.width, String(expected));
  assert.equal(f.window.document.body.style.cursor, 'progress');
  assert.equal(f.window.document.body.style.userSelect, 'text');
  await f.key(growKey, true);
  assert.equal(f.widthRef.current, expected + 32);
  await f.key('Home'); assert.equal(f.widthRef.current, 100);
  await f.key('End'); assert.equal(f.widthRef.current, 400);
  await f.key('Enter'); assert.equal(f.widthRef.current, 200);
});

test('stored bounds, viewport events and rerendered constraints use current callbacks', async t => {
  let maximum = 400;
  const f = await fixture(t, { getMaxWidth: () => maximum }, window => window.localStorage.setItem('fixture-width', '900'));
  assert.equal(f.widthRef.current, 400);
  assert.equal(f.window.localStorage.getItem('fixture-width'), '400');
  maximum = 250;
  await f.dispatch(f.window, new f.window.Event('resize'));
  assert.equal(f.widthRef.current, 250);
  await f.rerender(createElement(Panel, { options: { ...f.options, getMaxWidth: () => 180, getDefaultWidth: () => 160 } }));
  assert.equal(f.widthRef.current, 180, 'new constraints must re-clamp without remounting');
  await f.key('Enter'); assert.equal(f.widthRef.current, 160);
  await f.key('End'); assert.equal(f.widthRef.current, 180);
  await f.dispatch(f.handle, new f.window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(f.widthRef.current, 160);
});

test('unavailable storage does not prevent resize or reset', async t => {
  const f = await fixture(t, {}, window => Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new Error('storage denied'); },
  }));
  await f.key('ArrowRight'); assert.equal(f.widthRef.current, 212);
  await f.key('Enter'); assert.equal(f.widthRef.current, 200);
});

test('cancel, blur and unmount restore body state and remove owned listeners under Strict Effects', async t => {
  const listeners = new Map();
  const f = await fixture(t, {}, window => {
    window.document.body.style.cursor = 'wait'; window.document.body.style.userSelect = 'text';
    for (const target of [window, window.document]) {
      const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, listener, ...args) => {
        if (['resize', 'blur', 'visibilitychange'].includes(type)) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(listener);
        }
        return add(type, listener, ...args);
      };
      target.removeEventListener = (type, listener, ...args) => {
        listeners.get(type)?.delete(listener); return remove(type, listener, ...args);
      };
    }
  });
  assert.equal(listeners.get('resize').size, 1);
  await f.pointer('pointerdown'); await f.pointer('pointermove', { clientX: 120 });
  await f.pointer('pointercancel');
  assert.equal(f.window.localStorage.getItem('fixture-width'), '220');
  assert.equal(f.window.document.body.style.cursor, 'wait');
  await f.pointer('pointerdown');
  await f.dispatch(f.window, new f.window.Event('blur'));
  assert.equal(f.capture.size, 0);
  await f.pointer('pointerdown');
  const body = f.window.document.body;
  await f.unmount();
  assert.equal(body.style.cursor, 'wait'); assert.equal(body.style.userSelect, 'text');
  for (const [type, owned] of listeners) assert.equal(owned.size, 0, `${type} listener survived unmount`);
});
