import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { composerFixture, click, inputText } from './composer.fixture.mjs';

for (const mobile of [true, false]) test(`real reasoning menu anchors to ${mobile ? 'left' : 'right'} without remounting the draft`, async t => {
  let events;
  const f = composerFixture(t, { mobile, setup(window) { events = f.watchEvents(window.document, ['mousedown']); } });
  const c = await f.input({ onThinkingLevelChange() {}, thinkingLevel: 'high' });
  await inputText(c.view, c.ta, 'literal draft');
  const trigger = c.view.container.querySelector('[aria-label="Change reasoning level"]');
  assert.ok(trigger); await click(c.view, trigger);
  const menu = trigger.nextElementSibling;
  assert.ok(menu); assert.equal(menu.style.bottom, 'calc(100% + 6px)');
  assert.equal(menu.style[mobile ? 'left' : 'right'], '0px');
  assert.equal(menu.style[mobile ? 'right' : 'left'], '');
  await c.view.dispatch(c.view.window.document.body, new c.view.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(trigger.nextElementSibling === null, true);
  await click(c.view, trigger); await f.setMobile(!mobile);
  assert.equal(c.view.container.querySelector('textarea') === c.ta, true);
  assert.equal(c.ta.value, 'literal draft');
  assert.equal(trigger.nextElementSibling.style[mobile ? 'right' : 'left'], '0px');
  assert.equal(events.count('mousedown'), 1);
  await c.view.unmount(); assert.equal(events.size, 0);
});
