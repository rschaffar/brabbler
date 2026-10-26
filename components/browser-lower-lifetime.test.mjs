import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { lowerRuntime, exact } from './browser-lower-runtime.fixture.mjs';

const contains = (error, expected) => error === expected || Boolean(error?.errors?.some(cause => contains(cause, expected))) || Boolean(error?.cause && contains(error.cause, expected));

test('local lower fixture failed setup joins accepted workflow and independent releases before realm close, retaining original cleanup cause', async t => {
  const cleanup = [], originalFetch = globalThis.fetch, setupFailure = new Error('declared failed setup'), releaseFailure = new Error('declared independent release failure');
  let runtime, joined = false, peerReleased = false, realm, closed = false, finished = false;
  const finish = async () => {
    if (finished) return; finished = true;
    await assert.rejects(cleanup[0](), error => contains(error, releaseFailure));
    assert.equal(joined, true); assert.equal(peerReleased, true); assert.equal(closed, true);
    assert.equal(globalThis.fetch === originalFetch, true, 'restore only after domain and realm settlement');
  };
  t.after(finish);
  runtime = await lowerRuntime({ after(fn) { cleanup.push(fn); } }, request => {
    exact(request, '/failed-setup-held'); return undefined;
  }, (window, replace) => {
    realm = window;
    const originalClose = window.close.bind(window);
    replace(window, 'close', () => { assert.equal(joined, true, 'real workflow joined before realm close'); closed = true; originalClose(); });
    runtime.work.observe(fetch('/failed-setup-held').then(response => response.json()).finally(() => { joined = true; }));
    runtime.releaseOnClose(() => { throw releaseFailure; });
    runtime.releaseOnClose(() => { peerReleased = true; });
    throw setupFailure;
  });
  await assert.rejects(runtime.render(createElement(runtime.graph.WorktreeManager, { cwd: '/repo', onClose() {}, onChanged() {}, onSelectCheckout() {}, onReturnFocus() {} })), error => contains(error, setupFailure));
  assert.ok(realm); assert.equal(joined, true); assert.equal(closed, true);
  await finish();
});

test('local lower fixture retains a production-caught undeclared transport assertion through full cleanup', async t => {
  const cleanup = [], routeFailure = new Error('undeclared capability sentinel'); let finished = false;
  const finish = async () => { if (finished) return; finished = true; await assert.rejects(cleanup[0](), error => contains(error, routeFailure)); };
  t.after(finish);
  const r = await lowerRuntime({ after(fn) { cleanup.push(fn); } }, () => { throw routeFailure; });
  // This is specifically a support integrity control, not a product behavior row.
  // A production catch must not hide the live collector's independent failure.
  await fetch('/caught-by-caller').catch(() => {});
  assert.throws(() => r.assertHealthy(), error => contains(error, routeFailure));
  await finish();
});
