import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composerFixture } from '../components/composer.fixture.mjs';

async function fixture(t, initial = {}) {
  let reads = false, writes = false, events;
  const f = composerFixture(t, { setup(window) {
    events = f.watchEvents(window, ['storage']);
    for (const [key, value] of Object.entries(initial)) window.localStorage.setItem(key, value);
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const original = window.Storage.prototype[method];
      f.replace(window.Storage.prototype, method, function(...args) {
        if (method === 'getItem' ? reads : writes) throw Error('controlled blocked storage');
        return original.apply(this, args);
      });
    }
  } });
  const production = await f.load(), a = createRef(), b = createRef();
  const store = production.createFontPreferencesStore();
  const render = (second = true) => createElement('div', null,
    createElement(production.FontProbe, { api: a, store }), second && createElement(production.FontProbe, { api: b, store }));
  const view = await f.mount(render());
  const css = key => view.window.document.documentElement.style.getPropertyValue(key);
  return { ...f, production: { ...production, ...store }, a, b, view, render, css, events,
    block(next = {}) { reads = next.reads ?? false; writes = next.writes ?? false; },
    async edit(method, ...args) { await act(async () => a.current[method](...args)); },
    async event(key, storageArea = view.window.localStorage) {
      await view.dispatch(view.window, new view.window.StorageEvent('storage', { key, storageArea }));
    },
  };
}

test('SSR returns actual stable defaults without browser storage', async t => {
  const f = composerFixture(t), { FontProbe } = await f.load();
  const html = renderToStaticMarkup(createElement(FontProbe, { api: createRef() }));
  assert.equal(html, '<output>{&quot;ui&quot;:&quot;&quot;,&quot;mono&quot;:&quot;&quot;,&quot;uiWeight&quot;:400,&quot;monoWeight&quot;:400}</output>');
});

test('actual React subscribers restore browser families and weights without Settings', async t => {
  const f = await fixture(t, { 'pi-ui-font-family': 'Georgia', 'pi-mono-font-family': 'Menlo', 'pi-mono-font-weight': '600' });
  assert.equal(f.a.current.ui, 'Georgia');
  assert.equal(f.css('--font-mono'), '"Menlo", var(--font-mono-default)');
  assert.equal(f.css('--font-mono-weight'), '600');
});

test('actual React subscribers reset families and weights independently', async t => {
  const f = await fixture(t, { 'pi-chat-content-full-width': 'false', 'pi-chat-content-width': '1200', 'pi-chat-content-font-size': '18' });
  assert.equal(f.events.count('storage'), 1, 'two actual React subscribers share one storage listener');
  let updates = 0, terminalUpdates = 0;
  const stop = f.production.subscribeFontPreferences(() => updates++);
  const stopTerminal = f.production.subscribeFontPreferences(() => terminalUpdates++);
  f.release(stop); f.release(stopTerminal);
  await f.edit('setFontPreference', 'ui', 'Times New ');
  await f.edit('setFontWeight', 'ui', 500);
  await f.edit('setFontPreference', 'mono', 'Menlo');
  await f.edit('setFontWeight', 'mono', 600);
  await f.edit('setFontWeight', 'mono', 600);
  assert.equal(updates, 4);
  assert.equal(f.a.current.ui, 'Times New ');
  assert.equal(f.b.current.ui, 'Times New ');
  await f.edit('resetFontPreference', 'ui');
  assert.equal(f.a.current.uiWeight, 500);
  assert.equal(f.css('--font-ui'), '');
  await f.edit('resetFontWeight', 'ui');
  assert.equal(f.css('--font-ui-weight'), '');
  assert.equal(f.a.current.mono, 'Menlo');
  assert.equal(f.a.current.monoWeight, 600);
  await f.edit('resetFontWeight', 'mono');
  assert.equal(f.a.current.mono, 'Menlo');
  assert.equal(f.view.window.localStorage.getItem('pi-mono-font-weight'), null);
  for (const [key, value] of [['width', '1200'], ['font-size', '18'], ['full-width', 'false']]) {
    assert.equal(f.view.window.localStorage.getItem(`pi-chat-content-${key}`), value);
  }
  assert.equal(updates, terminalUpdates);
  stop(); stopTerminal();
  await f.view.rerender(f.render(false));
  assert.equal(f.events.count('storage'), 1, 'removing a sibling leaves the shared listener installed');
  f.view.window.localStorage.setItem('pi-ui-font-family', 'surviving cross-tab value');
  await f.event('pi-ui-font-family');
  assert.equal(f.a.current.ui, 'surviving cross-tab value', 'the surviving React consumer still receives actual cross-tab events');
  await f.view.unmount(); assert.equal(f.events.size, 0);
});

test('real storage events ignore unrelated keys/session storage, clear and reconcile remount', async t => {
  const f = await fixture(t), storage = f.view.window.localStorage;
  let notifications = 0;
  const stop = f.production.subscribeFontPreferences(() => notifications++); f.release(stop);
  storage.setItem('pi-ui-font-family', 'Arial');
  await f.event('other'); await f.event('pi-ui-font-family', f.view.window.sessionStorage);
  assert.equal(f.a.current.ui, ''); assert.equal(notifications, 0, 'unrelated and session-storage events do not publish');
  await f.event('pi-ui-font-family');
  assert.equal(f.a.current.ui, 'Arial'); assert.equal(f.b.current.ui, 'Arial'); assert.equal(notifications, 1);
  await f.event('pi-ui-font-family'); assert.equal(notifications, 1, 'same family snapshot is a no-op');
  storage.setItem('pi-ui-font-weight', '300'); await f.event('pi-ui-font-weight');
  assert.equal(f.css('--font-ui-weight'), '300'); assert.equal(notifications, 2);
  await f.event('pi-ui-font-weight'); assert.equal(notifications, 2, 'same weight snapshot is a no-op');
  storage.clear(); await f.event(null);
  for (const key of ['--font-ui', '--font-mono', '--font-ui-weight', '--font-mono-weight']) assert.equal(f.css(key), '');
  assert.equal(notifications, 3, 'family, weight, clear publish exactly three times');
  await f.event(null); assert.equal(notifications, 3, 'repeated clear is a no-op');
  stop();
  await f.view.rerender(null);
  storage.setItem('pi-mono-font-weight', '500');
  await f.view.rerender(f.render());
  assert.equal(f.a.current.monoWeight, 500);
});

test('failed writes/removes retain explicit memory over stale storage through event/remount and retry', async t => {
  const f = await fixture(t, { 'pi-ui-font-family': 'Old', 'pi-ui-font-weight': '500' });
  f.block({ writes: true });
  await f.edit('setFontPreference', 'ui', 'Unsaved'); await f.edit('resetFontWeight', 'ui');
  assert.equal(f.view.window.localStorage.getItem('pi-ui-font-family'), 'Old');
  f.block(); f.view.window.localStorage.setItem('pi-mono-font-family', 'Other tab'); f.block({ writes: true });
  await f.event('pi-mono-font-family');
  assert.equal(f.a.current.ui, 'Unsaved'); assert.equal(f.a.current.uiWeight, 400); assert.equal(f.a.current.mono, 'Other tab');
  await f.view.rerender(null); await f.view.rerender(f.render());
  assert.equal(f.a.current.ui, 'Unsaved');
  f.block();
  await f.edit('setFontPreference', 'ui', 'Unsaved'); await f.edit('resetFontWeight', 'ui');
  assert.equal(f.view.window.localStorage.getItem('pi-ui-font-family'), 'Unsaved');
  assert.equal(f.view.window.localStorage.getItem('pi-ui-font-weight'), null);
  f.view.window.localStorage.setItem('pi-ui-font-family', 'Fresh external'); await f.event('pi-ui-font-family');
  assert.equal(f.a.current.ui, 'Fresh external');
  f.block({ reads: true, writes: true }); await f.edit('setFontWeight', 'mono', 200); await f.event(null);
  assert.equal(f.a.current.monoWeight, 200); assert.equal(f.a.current.mono, 'Other tab');
});

test('invalid persisted values use defaults without rewriting stored bytes', async t => {
  const f = await fixture(t, { 'pi-ui-font-family': 'x'.repeat(501), 'pi-ui-font-weight': 'bold', 'pi-mono-font-weight': '900' });
  assert.equal(f.a.current.ui, ''); assert.equal(f.a.current.uiWeight, 400); assert.equal(f.a.current.monoWeight, 400);
  for (const key of ['--font-ui', '--font-mono', '--font-ui-weight', '--font-mono-weight']) assert.equal(f.css(key), '');
  assert.equal(f.view.window.localStorage.getItem('pi-ui-font-weight'), 'bold');
});
