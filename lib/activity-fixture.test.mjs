import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionSource } from '../e2e/extension-dialog.mjs';

// Execute the same extension source installed by browser acceptance. This owns
// fixture mechanics only; the packaged Activity scenarios prove real SDK ledger
// completion, Later invalidation, cross-context persistence and responsive UI.
const { default: install } = await import(`data:text/javascript,${encodeURIComponent(extensionSource)}`);
test('ledger-only completion needs neither a question nor a settling timer', async t => {
  const commands = new Map(), notices = [];
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('Ledger fixture must not schedule expiry'));
  t.mock.method(globalThis, 'setInterval', () => assert.fail('Ledger fixture must not poll'));
  install({ registerCommand(name, command) { commands.set(name, command); } });
  assert.ok(commands.has('e2e-dialog') && commands.has('e2e-ask-user'));
  await commands.get('e2e-complete').handler('', { ui: {
    notify(value) { notices.push(value); },
    askUser() { assert.fail('Activity completion must not wait for a question expiry'); },
  } });
  assert.deepEqual(notices, ['E2E completion fixture']);
});
