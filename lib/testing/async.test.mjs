import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as reportingTurn } from 'node:timers/promises';
import { createTaskOwner, deferred } from './async.fixture.mjs';

test('join closes admission and cannot finish while owned work is gated', async () => {
  const owner = createTaskOwner(), gate = deferred(), entered = deferred();
  let finished = false, joined = false;
  owner.track('held operation', (async () => { entered.resolve(); await gate.promise; finished = true; })());
  await entered.promise;
  const joining = owner.join();
  joining.then(() => { joined = true; });
  try {
    // An observation turn while the deliberately unresolved gate still owns work;
    // not an attempt to flush or infer completion of arbitrary asynchronous work.
    await Promise.resolve();
    assert.equal(joined, false);
    assert.throws(() => owner.track('late work', Promise.resolve()), /closed/);
    assert.equal(owner.join(), joining);
  } finally {
    gate.resolve();
    await joining;
  }
  assert.equal(finished, true);
  assert.equal(joined, true);
});

test('owned rejection is observed immediately and retained for joined teardown', async () => {
  const owner = createTaskOwner(), first = new Error('operation failed'), second = new Error('cleanup failed');
  owner.track('first', Promise.reject(first));
  owner.track('second', Promise.reject(second));
  await assert.rejects(owner.join(), (error) => error instanceof AggregateError
    && error.errors.length === 2 && error.errors[0] === first && error.errors[1] === second);
});

test('a failed peer does not let join abandon another started operation', async () => {
  const owner = createTaskOwner(), gate = deferred(), failure = new Error('peer failed');
  let settled = false;
  owner.track('failed peer', Promise.reject(failure));
  owner.track('pending peer', gate.promise.then(() => { settled = true; }));
  const joining = owner.join();
  const rejected = assert.rejects(joining, (error) => error.errors[0] === failure);
  gate.resolve();
  await rejected;
  assert.equal(settled, true);
});

test('a rejected gate stays observable without an unhandled rejection before its consumer arrives', async () => {
  const gate = deferred(), failure = new Error('gate failed');
  gate.reject(failure);
  // timing-proof: cross Node's unhandled-rejection reporting turn, not task settlement.
  await reportingTurn();
  await assert.rejects(gate.promise, error => error === failure);
});

test('empty owners settle without timers or cancellation side effects', async () => {
  await createTaskOwner().join();
});
