// FIRST dependency: fence imports as well as mounted work. This file is F;
// lib/terminal-manager.test.mjs owns the separate, unfenced native N case.
import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalPanelFixture } from './terminal-panel.fixture.mjs';

const sliderSelector = '#settings-chat-content-font-size';
function controls(f) {
  const slider = f.view.container.querySelector(sliderSelector);
  assert.ok(slider, 'actual GeneralSettings range');
  const reset = slider.parentElement.querySelector('button');
  assert.ok(reset, 'actual GeneralSettings reset');
  return { slider, reset };
}
async function rangeEnd(f, end) {
  const { slider } = controls(f);
  // jsdom does not implement native range keyboard default actions. Use its
  // native HTMLInputElement setter + input/change; End/Home dispatch and real
  // keyboard behavior remain the installed browser's separate authority.
  const value = end === 'End' ? slider.max : slider.min;
  assert.equal(value, end === 'End' ? '24' : '12');
  await f.view.dispatch(slider, new f.view.window.KeyboardEvent('keydown', { key: end, bubbles: true }));
  await f.act(() => {
    Object.getOwnPropertyDescriptor(f.view.window.HTMLInputElement.prototype, 'value').set.call(slider, value);
    slider.dispatchEvent(new f.view.window.Event('input', { bubbles: true }));
    slider.dispatchEvent(new f.view.window.Event('change', { bubbles: true }));
  });
}
function preference(f, chat) {
  assert.equal(controls(f).slider.value, String(chat));
  assert.equal(f.view.window.localStorage.getItem('brabbler-chat-content-font-size'), String(chat));
  assert.equal(f.view.window.document.documentElement.style.getPropertyValue('--chat-content-font-size'), `${chat}px`);
  assert.equal(f.view.container.querySelector('output[for="settings-chat-content-font-size"]').textContent, `${chat}px`);
}

test('real Settings font-size controls publish exact 23/11/13 into retained Terminal adapter', async t => {
  const f = await terminalPanelFixture(t, { generalSettings: true });
  await f.connect();
  await f.settle();
  const terminal = f.terminal, source = f.sources.at(-1);
  const terminals = f.terminals.length, sources = f.sources.length, admins = f.admin.length;
  const stable = () => {
    assert.strictEqual(f.terminal, terminal);
    assert.strictEqual(f.sources.at(-1), source);
    assert.equal(f.terminals.length, terminals);
    assert.equal(f.sources.length, sources);
    assert.equal(f.admin.length, admins, 'no PTY create/get/delete during preference changes');
    assert.equal(terminal.disposed, false);
    assert.equal(source.closed, false);
    assert.equal(terminal.options.disableStdin, false);
    f.healthy();
  };
  let fits = f.fits;
  await rangeEnd(f, 'End'); await f.settle();
  preference(f, 24); assert.equal(terminal.options.fontSize, 23);
  assert.ok(f.fits > fits, 'actual retained adapter refit'); stable();
  await rangeEnd(f, 'Home'); await f.settle();
  preference(f, 12); assert.equal(terminal.options.fontSize, 11); stable();
  await f.view.dispatch(controls(f).reset, new f.view.window.MouseEvent('click', { bubbles: true }));
  await f.settle(); preference(f, 14); assert.equal(terminal.options.fontSize, 13);
  assert.equal(controls(f).reset.disabled, true); stable();

  // The terminal stays mounted/subscribed while only its measured visibility
  // changes. Settings remain visible. Two hidden writes must reveal the latest.
  await f.hidden(true); fits = f.fits;
  await rangeEnd(f, 'End'); await rangeEnd(f, 'Home'); await f.settle();
  preference(f, 12);
  assert.equal(terminal.options.fontSize, 13, 'hidden metrics not applied');
  assert.equal(f.fits, fits, 'no hidden fit'); stable();
  await f.hidden(false); await f.settle();
  assert.equal(terminal.options.fontSize, 11, 'reveal uses current preference, not stale 23/13');
  assert.ok(f.fits > fits); stable();
  await f.view.dispatch(controls(f).reset, new f.view.window.MouseEvent('click', { bubbles: true }));
  await f.settle(); preference(f, 14); assert.equal(terminal.options.fontSize, 13); stable();
  await f.dispose();
});
