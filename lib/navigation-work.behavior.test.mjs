import './testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useLayoutEffect } from 'react';
import { createJiti } from 'jiti';
import { mount } from './testing/react.fixture.mjs';

const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });

// Original native promises, not thenables or fake hooks. The TEST caller owns
// every rejection before instrumentation; no unhandled-rejection/timing oracle.
function nativeGate(rejection) {
  const gate = Promise.withResolvers();
  let attachments = 0;
  const outcome = Promise.prototype.then.call(gate.promise,
    value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
  Object.defineProperty(gate.promise, 'then', { configurable: true, value: function (...args) {
    attachments++;
    return Reflect.apply(Promise.prototype.then, this, args);
  } });
  return { ...gate, outcome, get attachments() { return attachments; },
    release: () => rejection === undefined ? gate.resolve() : gate.reject(rejection) };
}

async function mountedObserver(t, supplied) {
  const { NavigationWork, NavigationWorkContext, useNavigationWork } = await jiti.import('./navigation-work.ts');
  const owner = supplied ? new NavigationWork() : undefined;
  const gates = [], peers = [], expected = [];
  let view, observer, settlement;
  const expectedFailure = error => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, expected.length);
    error.errors.forEach((reason, index) => assert.equal(reason === expected[index], true));
    return true;
  };
  const settleDomain = () => settlement ??= (async () => {
    // Release each admitted peer even if a different release fails. This also
    // runs on failed mount before a view has been returned.
    const errors = [];
    for (const gate of gates) { try { gate.release(); } catch (error) { errors.push(error); } }
    await Promise.all(gates.map(gate => gate.outcome));
    for (const result of await Promise.all(peers)) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    try {
      if (owner) {
        if (expected.length) await assert.rejects(owner.settle(), expectedFailure);
        else await owner.settle();
      }
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'observer witness domain cleanup');
  })();
  t.after(async () => {
    const errors = [];
    for (const step of [() => view?.unmount(), settleDomain, () => view?.dispose()]) {
      try { await step(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'observer witness cleanup');
  });
  function Probe() {
    const current = useNavigationWork();
    useLayoutEffect(() => { observer = current; });
    return null;
  }
  const probe = createElement(Probe);
  view = await mount(t, owner ? createElement(NavigationWorkContext.Provider, { value: owner }, probe) : probe,
    { beforeDispose: settleDomain });
  return { view, owner, get observer() { return observer; }, expected, expectedFailure,
    trackPeer(outcome) { peers.push(outcome); },
    gate(rejection) { const gate = nativeGate(rejection); gates.push(gate); return gate; } };
}

test('unsupplied real React navigation observer preserves original native rejection promise without attaching any handler', async t => {
  const h = await mountedObserver(t, false);
  const failure = new Error('default original rejection');
  const gate = h.gate(failure);
  const returned = h.observer.observe(gate.promise);
  gate.reject(failure);
  const outcome = await gate.outcome;
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.reason === failure, true, 'test caller retains exact original rejection');
  assert.equal(returned === gate.promise, true, 'exact original native promise');
  assert.equal(gate.attachments, 0, 'default observe adds NO then/rejection handler');
  const before = h.observer;
  await h.view.rerender(createElement(() => null));
  assert.equal(gate.attachments, 0, 'release adds no promise lifecycle');
  assert.equal(typeof before.observe, 'function');
});

test('explicit real React provider captures original error and joins full peer finalizer even after unmount', async t => {
  const h = await mountedObserver(t, true);
  assert.equal(h.observer === h.owner, true, 'actual context supplies the completion owner');
  const failure = new Error('explicit original rejection');
  const failed = h.gate(failure), peer = h.gate(), finalizer = h.gate(), finalizerStarted = h.gate();
  let peerFinished = false, joined = false;
  const completePeer = peer.promise.then(async () => {
    finalizerStarted.resolve();
    await finalizer.promise;
    peerFinished = true;
  });
  // This caller owns the entire peer promise independently as well.
  const peerOutcome = Promise.prototype.then.call(completePeer,
    () => ({ status: 'fulfilled' }), reason => ({ status: 'rejected', reason }));
  h.trackPeer(peerOutcome);
  assert.equal(h.observer.observe(failed.promise) === failed.promise, true);
  h.expected.push(failure);
  assert.equal(failed.attachments, 1, 'explicit owner DOES attach capture');
  assert.equal(h.observer.observe(completePeer) === completePeer, true);
  const settlement = h.owner.settle().then(
    () => { joined = true; return { status: 'fulfilled' }; },
    reason => { joined = true; return { status: 'rejected', reason }; });
  failed.reject(failure);
  await failed.outcome;
  assert.equal(joined, false, 'a failed workflow does not skip its held peer');
  peer.resolve();
  await finalizerStarted.outcome;
  assert.equal(peerFinished, false);
  assert.equal(joined, false, 'response delivery is not full finalizer completion');
  await h.view.unmount();
  finalizer.resolve();
  assert.equal((await peerOutcome).status, 'fulfilled');
  const result = await settlement;
  assert.equal(peerFinished, true);
  assert.equal(result.status, 'rejected');
  h.expectedFailure(result.reason);
  await assert.rejects(h.owner.settle(), h.expectedFailure, 'original failure remains retained');
});
