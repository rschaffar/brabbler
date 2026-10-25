import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { packet, key } from './cards-git.fixture.mjs';

test('original 30 options and exact seven native-key destinations use the extracted production ExtensionDialog', async t => {
  const h = await packet(t), { ExtensionDialog } = await h.load('./ExtensionDialog.tsx');
  const request = { type: 'extension_ui_request', id: 'select-original-30', method: 'select', title: 'E2E select',
    options: Array.from({ length: 30 }, (_, index) => `Option ${index + 1}`) };
  const calls = [];
  await h.render(createElement(ExtensionDialog, { request, onRespond: (...args) => { calls.push(args); } }));
  const options = [...h.view.container.querySelectorAll('[data-extension-option]')];
  assert.equal(options.length, 30); assert.equal(h.view.window.document.activeElement === options[0], true);
  for (const [pressed, expected] of [['ArrowUp', 'Option 30'], ['ArrowDown', 'Option 1'], ['ArrowRight', 'Option 2'], ['ArrowLeft', 'Option 1'], ['End', 'Option 30'], ['Home', 'Option 1'], ['End', 'Option 30']]) {
    assert.equal(await key(h.view, h.view.window.document.activeElement, pressed), true);
    assert.equal(h.view.window.document.activeElement.textContent, expected);
    assert.equal(calls.length, 0);
  }
  const current = { ...request, title: 'Current E2E select' }, updatedCalls = [];
  await h.render(createElement(ExtensionDialog, { request: current, onRespond: (...args) => { updatedCalls.push(args); } }));
  await key(h.view, options[29], 'Enter');
  assert.equal(calls.length, 0); assert.equal(updatedCalls.length, 1);
  assert.equal(updatedCalls[0][0] === current, true); assert.deepEqual(updatedCalls[0][1], { value: 'Option 30' });
  // scrollIntoView here is an explicitly unsupported capability, not native
  // scroll containment, 65%-viewport geometry, installed response or history.
});
