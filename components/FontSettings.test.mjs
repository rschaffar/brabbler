import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { settingsFixture } from './settings.fixture.mjs';

test('real font fields: labels, six weights, independent reset, shared live snapshot and cleanup', async t => {
  const f = await settingsFixture(t);
  const { FontSettings, useFontPreferences, FONT_STORAGE_KEYS } = await f.load('fonts');
  function Peer() { const fonts = useFontPreferences(); return h('output', { id: 'font-peer' }, JSON.stringify(fonts)); }
  const storageListeners = new Set(), writes = [];
  await f.mount(h('div', null, h(FontSettings), h(Peer)), { setup(window) {
    const storage = window.Storage.prototype;
    for (const method of ['setItem', 'removeItem']) {
      const original = storage[method];
      storage[method] = function (key, ...args) { writes.push([method, key, ...args]); return original.call(this, key, ...args); };
    }
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, fn, ...args) => { if (type === 'storage') storageListeners.add(fn); add(type, fn, ...args); };
    window.removeEventListener = (type, fn, ...args) => { if (type === 'storage') storageListeners.delete(fn); remove(type, fn, ...args); };
  } });
  for (const kind of ['ui', 'mono']) {
    const row = f.node(`#settings-font-${kind}`).closest('.settings-font-row');
    const [familyReset, weightReset] = row.querySelectorAll('button');
    const field = f.node(`#settings-font-${kind}`), slider = f.node(`#settings-font-${kind}-weight`);
    assert.equal(field.maxLength, 500);
    assert.equal(field.getAttribute('aria-describedby'), 'settings-typography-description');
    for (const node of [field, slider]) assert.equal(row.querySelector(`label[for="${node.id}"]`) !== null, true);
    assert.deepEqual([slider.min, slider.max, slider.step], ['100', '600', '100']);
    assert.deepEqual([familyReset.disabled, weightReset.disabled], [true, true]);
    await f.input(field, '"Local, Font", monospace');
    await f.input(slider, '600');
    assert.match(slider.getAttribute('aria-valuetext'), /^600 /);
    assert.equal(JSON.parse(f.node('#font-peer').textContent)[kind], '"Local, Font", monospace');
    assert.equal(f.view.window.localStorage.getItem(FONT_STORAGE_KEYS[kind]), '"Local, Font", monospace');
    assert.equal(f.view.window.localStorage.getItem(FONT_STORAGE_KEYS[`${kind}Weight`]), '600');
    await f.click(familyReset);
    assert.equal(field.value, ''); assert.equal(slider.value, '600');
    assert.deepEqual([familyReset.disabled, weightReset.disabled], [true, false]);
    await f.click(weightReset);
    assert.equal(slider.value, '400');
  }
  assert.equal(writes.length, 8, 'eight independent actual family/weight writes or removals');
  assert.equal(storageListeners.size, 1, 'one shared storage subscription after Strict replay');
  await f.view.unmount();
  assert.equal(storageListeners.size, 0, 'last actual subscriber releases storage listener');
  assert.equal(f.requests.length, 0, 'font preferences are browser-local');
});
