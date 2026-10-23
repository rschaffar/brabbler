import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompactChatRestored } from '../e2e/file-panel-layout.mjs';

function pageFor(locator) {
  return { getByRole(role, options) {
    assert.equal(role, 'button');
    assert.deepEqual(options, { name: 'Show chat panel', exact: true });
    return locator;
  } };
}

test('compact layout awaits responsive removal before its original one-shot count assertion', async () => {
  let release, count = 1, finished = false, failure;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const pending = assertCompactChatRestored(pageFor({
    async waitFor(options) { calls.push(['waitFor', options]); await gate; },
    async count() { calls.push(['count']); return count; },
  })).then(() => { finished = true; }, error => { finished = true; failure = error; });
  try {
    await Promise.resolve();
    assert.deepEqual(calls, [['waitFor', { state: 'detached' }]]);
    assert.equal(finished, false, 'the browser resize acknowledgment is not responsive React settlement');
  } finally {
    count = 0;
    release();
    await pending;
  }
  if (failure) throw failure;
  assert.deepEqual(calls, [['waitFor', { state: 'detached' }], ['count']]);
});

test('compact layout propagates the existing locator deadline/error without counting or retrying', async () => {
  const expected = new Error('synthetic existing locator deadline');
  let counted = false;
  await assert.rejects(assertCompactChatRestored(pageFor({
    async waitFor(options) { assert.deepEqual(options, { state: 'detached' }); throw expected; },
    async count() { counted = true; return 0; },
  })), error => error === expected);
  assert.equal(counted, false);
});

test('compact layout retains the strict original assertion after an acknowledged wait', async () => {
  let waited = false;
  await assert.rejects(assertCompactChatRestored(pageFor({
    async waitFor(options) { assert.deepEqual(options, { state: 'detached' }); waited = true; },
    async count() { return 1; },
  })), /compact layout restores chat and retains its existing Files overlay/);
  assert.equal(waited, true);
});
