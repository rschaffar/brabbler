import '../lib/testing/client-native-boundary.fixture.mjs';
// UNEXECUTED. Real AppShell-called policy + real browser-notifications wrapper.
// Notification is a declared external port, not a replacement delivery helper.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { composerFixture, click, buttonWithText } from './composer.fixture.mjs';

const session = (id, parent) => ({ id, cwd: '/synthetic', firstMessage: '', messageCount: 0,
  ...(parent ? { relation: { kind: 'subagent', parentSessionId: parent } } : {}) });
const confirm = (id = 'blocking-one') => ({ type: 'extension_ui_request', method: 'confirm', id, title: 'Exact title', message: 'body' });
async function fixture(t, { visibility = 'visible', focused = false, permission = 'granted' } = {}) {
  const notifications = [], selected = [], settled = [], permissionGate = deferred();
  let permissionCalls = 0, focusCalls = 0;
  class SyntheticNotification {
    static permission = permission;
    static requestPermission() { permissionCalls++; return permissionGate.promise; }
    constructor(title, options) { this.title = title; this.options = options; this.closed = 0; notifications.push(this); }
    close() { this.closed++; }
  }
  const f = composerFixture(t, { setup(window, ports) {
    // No ServiceWorker port in this finite window-fallback case. Installed push
    // and service-worker delivery stay separately owned by existing native tests.
    assert.equal('serviceWorker' in window.navigator, false);
    assert.equal('PushManager' in window, false);
    ports.replace(window, 'Notification', SyntheticNotification);
    ports.replace(globalThis, 'Notification', SyntheticNotification);
    ports.replace(window.document, 'visibilityState', visibility);
    ports.replace(window.document, 'hasFocus', () => focused);
    ports.replace(window, 'focus', () => { focusCalls++; });
  } });
  f.release(() => permissionGate.resolve('denied'));
  const p = await f.load();
  let props = { selectedSession: session('root / one'), request: confirm(),
    onSelected: value => selected.push(value.id), onSettled: () => settled.push('old') };
  const element = () => createElement(p.ShellNotificationProbe, props);
  const view = await f.mount(element());
  return { f, view, notifications, selected, settled, SyntheticNotification,
    get permissionCalls() { return permissionCalls; }, get focusCalls() { return focusCalls; },
    attention: () => click(view, buttonWithText(view.container, 'Attention')),
    complete: () => click(view, buttonWithText(view.container, 'Complete')),
    async update(next) { props = { ...props, ...next }; await view.rerender(element()); },
    async grant(value) { await act(async () => { permissionGate.resolve(value); await permissionGate.promise; }); },
  };
}

for (const [visibility, focused] of [['visible', true], ['visible', false], ['hidden', true]]) {
  for (const family of ['main', 'child', 'nested']) {
    test(`actual shell policy: ${visibility}/focused=${focused} × ${family}; duplicate ID and current completion`, async t => {
      const c = await fixture(t, { visibility, focused });
      const target = family === 'main' ? session('root / one') : session(family, family === 'child' ? 'root / one' : 'child');
      await c.update({ selectedSession: target });
      await c.attention(); await c.attention();
      await c.update({ request: confirm('blocking-two') }); await c.attention();
      await c.complete();
      const admitted = family === 'main' && (visibility !== 'visible' || !focused);
      assert.equal(c.notifications.length, admitted ? 3 : 0);
      assert.deepEqual(c.settled, ['old'], 'completion always settles navigation, even suppressed notifications');
      assert.equal(c.view.container.querySelector('output').textContent, '1');
      if (admitted) {
        assert.deepEqual(c.notifications.map(n => [n.title, n.options]), [
          ['i18n.attentionNeeded', { body: 'Exact title', tag: 'pi-extension-ui:blocking-one', renotify: true }],
          ['i18n.attentionNeeded', { body: 'Exact title', tag: 'pi-extension-ui:blocking-two', renotify: true }],
          ['i18n.sessionComplete', { body: 'i18n.taskFinished', tag: 'pi-session-complete:root / one', renotify: true }],
        ]);
      }
      await c.update({ selectedSession: session('current', undefined), onSettled: () => c.settled.push('current') });
      await c.complete();
      assert.deepEqual(c.settled, ['old', 'current']);
      if (visibility !== 'visible' || !focused) {
        const notification = c.notifications.at(-1);
        assert.equal(notification.options.tag, 'pi-session-complete:current');
        await act(async () => notification.onclick());
        assert.equal(notification.closed, 1); assert.equal(c.focusCalls, 1);
        assert.deepEqual(c.selected, ['current'], 'real wrapper onclick reaches current shell selection callback');
        // Suppressed child/focus events must not consume a root blocking ID.
        await c.update({ request: confirm() }); await c.attention();
        assert.equal(c.notifications.filter(n => n.options.tag === 'pi-extension-ui:blocking-one').length, 1);
      }
    });
  }
}

test('actual shell method/title/dedup rules and current target with retained global ID set', async t => {
  const c = await fixture(t);
  for (const [method, body] of [
    ['select', 'Exact title'], ['confirm', 'Exact title'], ['input', 'Exact title'], ['editor', 'Exact title'],
    ['ask_user', 'Exact question'], ['ask_user_batch', 'Exact title'], ['plugin_card', 'Exact title'], ['custom', 'i18n.extensionInputNeeded'],
  ]) {
    await c.update({ request: { ...confirm(method), method, question: 'Exact question' } });
    await c.attention(); await c.attention();
    assert.deepEqual(c.notifications.at(-1).options, { body, tag: `pi-extension-ui:${method}`, renotify: true });
  }
  assert.equal(c.notifications.length, 8);
  for (const request of [{ ...confirm('closed'), method: 'custom', closed: true }, { ...confirm('toast'), method: 'notify' }]) {
    await c.update({ request }); await c.attention();
  }
  assert.equal(c.notifications.length, 8, 'nonblocking and closed custom do not notify');
  await c.update({ selectedSession: { ...session('next'), name: 'Current named session' }, request: confirm('confirm') });
  await c.attention(); assert.equal(c.notifications.length, 8, 'existing page-lived request ID remains claimed across selection');
  await c.complete();
  assert.equal(c.notifications.at(-1).title, 'Current named session');
  assert.equal(c.notifications.at(-1).options.tag, 'pi-session-complete:next');
  await c.update({ selectedSession: null }); await c.complete();
  assert.equal(c.notifications.at(-1).options.tag, 'pi-session-complete');
});

for (const permission of ['default', 'denied']) test(`actual shell permission=${permission} retains existing no-retry dedup policy`, async t => {
  const c = await fixture(t, { permission });
  await c.attention(); await c.attention();
  assert.equal(c.permissionCalls, permission === 'default' ? 1 : 0);
  assert.equal(c.notifications.length, 0);
  if (permission === 'default') {
    await c.grant('granted');
    assert.equal(c.notifications.length, 1);
    assert.equal(c.notifications[0].options.tag, 'pi-extension-ui:blocking-one');
  } else {
    c.SyntheticNotification.permission = 'granted';
    await c.attention(); assert.equal(c.notifications.length, 0, 'claimed before denied delivery: inherited, not repaired');
    await c.update({ request: confirm('fresh') }); await c.attention(); assert.equal(c.notifications.length, 1);
  }
});
