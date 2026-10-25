import './testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const { agentSessionPolicyClock: clock } = await createJiti(import.meta.url, { fsCache: false })
  .import('./agent-session-policy-clock.ts');

// Native API ports prove delegation/identity, not elapsed browser/OS timing.
test('default policy intervals preserve the supplied callback, duration and cancellation handle', t => {
  const admitted = [], cancelled = [];
  t.mock.method(globalThis, 'setInterval', (callback, milliseconds) => {
    const handle = { index: admitted.length };
    admitted.push({ callback, milliseconds, handle });
    return handle;
  });
  t.mock.method(globalThis, 'clearInterval', handle => { cancelled.push(handle); });
  let invoked = 0;
  const callback = () => { invoked++; };
  const cancels = [];
  t.after(() => { for (const cancel of cancels.splice(0)) cancel(); });
  for (const [policy, milliseconds] of [['agent-state', 15000], ['speed-recovery', 15000], ['session-lease', 30000]]) {
    cancels.push(clock.interval(policy, milliseconds, callback));
    const item = admitted.at(-1);
    assert.equal(item.callback === callback, true);
    assert.equal(item.milliseconds, milliseconds);
  }
  assert.equal(invoked, 0, 'construction forwards rather than running the callback');
  for (const cancel of cancels.splice(0)) cancel();
  assert.equal(cancelled.length, admitted.length);
  for (let index = 0; index < admitted.length; index++) assert.equal(cancelled[index] === admitted[index].handle, true);
});

test('default retry and deadline ports preserve native resolution and original AbortSignal identity', async t => {
  const timers = [], deadlines = [];
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    timers.push({ callback, milliseconds });
    return { index: timers.length };
  });
  t.after(() => { for (const item of timers) item.callback(); });
  const delays = [2000, 5000, 10000].map(milliseconds => clock.modelRetryDelay(milliseconds));
  assert.deepEqual(timers.map(item => item.milliseconds), [2000, 5000, 10000]);
  for (const item of timers) item.callback();
  await Promise.all(delays);
  const controller = new AbortController(), reason = new Error('controlled native deadline port');
  t.mock.method(AbortSignal, 'timeout', milliseconds => { deadlines.push(milliseconds); return controller.signal; });
  const signal = clock.modelSpeedDeadline(10000);
  assert.equal(signal === controller.signal, true);
  const acknowledgement = clock.questionSetAcknowledgementDeadline(15000);
  assert.equal(acknowledgement === controller.signal, true, 'original native signal identity, not a wrapped signal');
  assert.deepEqual(deadlines, [10000, 15000]);
  assert.equal(signal.aborted, false);
  controller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason === reason, true);
});
