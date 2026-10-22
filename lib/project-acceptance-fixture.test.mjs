import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { openAcceptanceConfiguration } from '../e2e/project-acceptance.mjs';

function fixture(enabled = true) {
  const ready = Promise.withResolvers();
  const calls = [];
  const editor = {
    async waitFor(options) { assert.equal(options.state, 'visible'); calls.push('editor-visible'); },
    async isEnabled() { calls.push('editor-enabled'); return enabled; },
  };
  const dialog = {
    getByText(text, options) {
      assert.equal(options.exact, true);
      if (text === 'Reading acceptance status…') return { async waitFor(options) {
        assert.equal(options.state, 'hidden'); calls.push('wait-status'); await ready.promise; calls.push('status-rendered');
      } };
      assert.equal(text, 'Configure project profiles');
      return { async click() { calls.push('click-configure'); } };
    },
    getByRole(role, options) {
      assert.equal(role, 'textbox'); assert.deepEqual(options, { name: 'Profiles JSON', exact: true }); return editor;
    },
  };
  return { ready, calls, dialog, editor };
}

test('initial status must settle before the single native Configure click', async () => {
  const f = fixture();
  const opening = openAcceptanceConfiguration(f.dialog);
  await nextTurn();
  assert.deepEqual(f.calls, ['wait-status'], 'a visible summary is not safe while initial profile cards can shift it');
  f.ready.resolve();
  assert.equal(await opening, f.editor);
  assert.deepEqual(f.calls, ['wait-status', 'status-rendered', 'click-configure', 'editor-visible', 'editor-enabled']);
});

test('a disabled editor remains a failure without another click or retry', async () => {
  const f = fixture(false);
  const opening = openAcceptanceConfiguration(f.dialog);
  f.ready.resolve();
  await assert.rejects(opening, /configuration is editable after initial status/);
  assert.equal(f.calls.filter(call => call === 'click-configure').length, 1);
});
