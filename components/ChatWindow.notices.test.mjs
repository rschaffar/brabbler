import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { sessionFixture } from '../hooks/agent-session-mounted.fixture.mjs';
import { composerFixture } from './composer.fixture.mjs';

test('actual chat composition renders one top-right notice shelf and uses current pause callbacks', async t => {
  const first = [], current = [];
  const f = composerFixture(t), c = await f.chat({ notices: [{ id: 'notice-a', type: 'info', message: 'line one\nline two' }], setNoticePaused: id => first.push(id) });
  const items = c.view.container.querySelectorAll('.notice-shelf-item');
  assert.equal(items.length, 1);
  const item = items[0], text = item.querySelector('[tabindex="0"]'), floating = item.parentElement.parentElement;
  assert.equal(floating.style.position, 'absolute'); assert.equal(floating.style.top, '12px');
  assert.equal(floating.style.right, '36px'); assert.equal(floating.style.justifyContent, 'flex-end');
  assert.equal(text.style.overflowY, 'auto'); assert.equal(text.textContent, 'line one\nline two');
  await act(async () => { text.focus(); }); assert.deepEqual(first, ['notice-a']);
  await c.view.dispatch(item, new c.view.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: c.view.window.document.body }));
  assert.deepEqual(first, ['notice-a'], 'focused notice is not unpaused on mouse leave');
  await c.update({ setNoticePaused: id => current.push(id) });
  await act(async () => { text.blur(); }); assert.deepEqual(current, [null]);
  await c.view.dispatch(item, new c.view.window.MouseEvent('mouseover', { bubbles: true, relatedTarget: c.view.window.document.body }));
  assert.deepEqual(current, [null, 'notice-a']);
  await c.view.dispatch(item, new c.view.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: c.view.window.document.body }));
  assert.deepEqual(current, [null, 'notice-a', null]);
  await f.setMobile(true); assert.equal(floating.style.right, '0px');
  await c.update({ notices: [] }); assert.equal(c.view.container.querySelectorAll('.notice-shelf-item').length, 0);
});

test('actual notice blur preserves hover ownership and mouse leave preserves keyboard focus', async t => {
  const paused = [], f = composerFixture(t), c = await f.chat({ notices: [{ id: 'ownership', type: 'info', message: 'long keyboard-readable notice' }], setNoticePaused: id => paused.push(id) });
  const item = c.view.container.querySelector('.notice-shelf-item'), text = item.querySelector('[tabindex="0"]');
  const matches = item.matches.bind(item); let hovered = true;
  f.replace(item, 'matches', selector => selector === ':hover' ? hovered : matches(selector));
  await act(async () => text.focus()); assert.deepEqual(paused, ['ownership']);
  await act(async () => text.blur()); assert.deepEqual(paused, ['ownership'], 'hover retains pause after blur');
  await act(async () => text.focus()); hovered = false;
  await c.view.dispatch(item, new c.view.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: c.view.window.document.body }));
  assert.equal(paused.includes(null), false, 'focus retains pause after pointer leaves');
  await act(async () => text.blur()); assert.equal(paused.at(-1), null);
});

test('actual session notice expiry pauses only for a visible identity and resumes its remaining budget', async t => {
  const f = await sessionFixture(t); await f.mountReady(f.existingOptions());
  const source = f.sources.findLast(item => item.readyState !== 2);
  const timers = new Map(); let sequence = 0, now = 1000;
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  const set = t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (![5000, 4000, 180].includes(delay)) return nativeSet(callback, delay, ...args);
    const id = { notice: ++sequence }; timers.set(id, { callback, delay, args }); return id;
  });
  const clear = t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id) || nativeClear(id));
  const clock = t.mock.method(Date, 'now', () => now);
  t.after(() => { clock.mock.restore(); clear.mock.restore(); set.mock.restore(); });
  await f.event(source, { type: 'extension_ui_request', method: 'notify', id: 'visible-notice', message: 'retained text', notifyType: 'info' });
  assert.equal(f.current.notices.length, 1);
  const noticeId = f.current.notices[0].id;
  assert.equal([...timers.values()].filter(timer => timer.delay === 5000).length, 1);
  now = 2000;
  await f.run('pause current notice', value => value.setNoticePaused(noticeId));
  assert.equal(timers.size, 0);
  await f.run('obsolete pause cannot freeze current notices', value => value.setNoticePaused('not-visible'));
  assert.equal(timers.size, 1, 'an obsolete pause identity must not freeze the current notice');
  const [id, timer] = [...timers][0]; assert.equal(timer.delay, 4000);
  now = 6000; timers.delete(id); await act(async () => { timer.callback(...timer.args); });
  assert.equal(f.current.notices[0].exiting, true);
  assert.equal(timers.size, 1, 'an exiting notice owns exactly one exit timer');
  const [exitId, exit] = [...timers][0]; assert.equal(exit.delay, 180); timers.delete(exitId);
  await act(async () => { exit.callback(...exit.args); });
  assert.equal(f.current.notices.length, 0);
  await f.unmount(); await f.settleMaintenance(); assert.equal(timers.size, 0);
});
