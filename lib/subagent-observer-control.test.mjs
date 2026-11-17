import assert from 'node:assert/strict';
import test from 'node:test';
import { observerControl } from './subagent-observer-control.fixture.mjs';

test('lazy runtime settled rejects a post-persist invalidation fault without publishing completion', async t => {
  const f = await observerControl(t);
  const execution = await f.admit();
  // The test caller owns the ORIGINAL public promise and its outcomes. This is
  // an observation, not accepted work: no cleanup/idle join awaits publication.
  const publicCompletion = execution.completion;
  let publication = { status: 'pending' };
  const publicationObserved = publicCompletion.then(
    value => { publication = { status: 'fulfilled', value }; },
    reason => { publication = { status: 'rejected', reason }; },
  );
  await f.promptEntered;
  assert.equal(publicCompletion, execution.completion);
  assert.equal(publication.status, 'pending'); assert.equal(f.state().injected, 0);
  assert.ok(f.state().invalidations >= 2, 'initial queued/running updates actually returned without fault');
  assert.deepEqual(f.peerStates, ['queued']); assert.equal(f.state().peerStarted, false);

  // Establish the native saved-result boundary before asking for lazy settled.
  // A mismatched fault stage must report itself, never hang waiting for a fault
  // while an unrelated public completion has already been published.
  const checkpoint = Promise.race([
    f.checkpoint,
    publicationObserved.then(() => { throw new Error('public completion published before the required post-persist fault checkpoint'); }),
  ]);
  f.releasePrompt();
  const committed = await checkpoint;
  assert.equal(committed.data.runId, execution.run.runId); assert.equal(committed.data.status, 'completed');
  assert.equal(f.state().injected, 1); assert.equal(publication.status, 'pending');

  const observation = f.observe(); // observe the actual runtime settlement promise
  const outcome = await observation.outcome; // full target queue/recovery/bookkeeping boundary
  // Named boundary: target-observer-joined / independent-peer-still-held.
  const native = f.readNative().at(-1);
  assert.equal(native.id, committed.id); assert.equal(native.customType, f.resultType);
  assert.equal(native.data.runId, execution.run.runId); assert.equal(native.data.status, 'completed');
  assert.equal(native.data.result, 'Controlled terminal result');
  const saved = await f.controller.get(f.childId);
  assert.equal(saved.runId, execution.run.runId); assert.equal(saved.status, 'completed');
  assert.equal(publication.status, 'pending', 'saved terminal state is not public result publication');
  assert.equal(f.admissions.size, 0); assert.equal(f.state().persistedResults, 1);
  assert.equal(f.state().settledCallbacks, 2); assert.deepEqual(f.settledHosts, ['child', 'parent']);
  assert.equal(f.diagnostics.length, 1, 'the original runtime settlement diagnostic completed before its later observer');
  assert.equal(f.diagnostics[0][0], '[brabbler] subagent settlement failed:');
  assert.equal(f.diagnostics[0][1], outcome.reason, 'diagnostic retains the same original settlement AggregateError');
  assert.deepEqual(f.peerStates, ['queued', 'running']);
  assert.equal(f.state().peerStarted, true); assert.equal(f.state().peerFinished, false);

  // Keep the exact post-persist failure, independent of public publication.
  // The held peer is released/joined by the owner even if this assertion fails.
  await assert.rejects(observation.raw,
    error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === f.marker,
    'lazy settled must reject an AggregateError containing only the original post-persist marker');

  // The failure-observation path must preserve the pending public promise and
  // drain the independently held peer; it is not a publication/liveness fix.
  f.releasePeer(); await f.join();
  assert.equal(f.state().peerFinished, true);
  assert.equal(publication.status, 'pending');
});
