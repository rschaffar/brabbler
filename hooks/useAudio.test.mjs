import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { composerFixture, click } from '../components/composer.fixture.mjs';

for (const blocked of ['property', 'methods']) {
  test(`mounted audio toggle works with blocked storage ${blocked}`, async t => {
    const f = composerFixture(t, { setup(window) {
      if (blocked === 'property') Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('Storage blocked'); } });
      else for (const name of ['getItem', 'setItem']) f.replace(window.Storage.prototype, name, () => { throw Error(`${name} blocked`); });
    } });
    const { AudioProbe, createComposerWork } = await f.load();
    const work = createComposerWork(); f.join(() => work.whenSettled());
    const api = createRef();
    const view = await f.mount(createElement(AudioProbe, { api, work }));
    assert.equal(view.container.textContent, 'true');
    await click(view, view.container.querySelector('button'));
    assert.equal(view.container.textContent, 'false');
    assert.equal(api.current.soundEnabledRef.current, false);
    // Keep enabling independent of unsupported native audio. The real hook's
    // existing unavailable-context catch is the product policy, not a test catch.
    // No context call is admitted here: override the external constructor below.
    f.replace(globalThis, 'AudioContext', class { state = 'running'; });
    await click(view, view.container.querySelector('button'));
    assert.equal(view.container.textContent, 'true');
    assert.equal(api.current.soundEnabledRef.current, true);
    await view.unmount();
  });
}

for (const reject of [false, true]) test(`real audio resume/tone continuation is joined after unmount: rejection=${reject}`, async t => {
  const gate = deferred(), f = composerFixture(t); f.release(() => gate.resolve());
  const { AudioProbe, createComposerWork } = await f.load(), work = createComposerWork(); f.join(() => work.whenSettled());
  const api = createRef(), oscillators = [], ramps = []; let contexts = 0, resumes = 0;
  class Context {
    state = 'suspended'; currentTime = 10; destination = {};
    constructor() { contexts++; }
    resume() { resumes++; return gate.promise; }
    createOscillator() {
      const osc = { frequency: { value: 0 }, connect() {}, start(time) { osc.startAt = time; }, stop(time) { osc.stopAt = time; } };
      oscillators.push(osc); return osc;
    }
    createGain() { return { connect() {}, gain: {
      setValueAtTime: (...args) => ramps.push(['set', ...args]), linearRampToValueAtTime: (...args) => ramps.push(['linear', ...args]), exponentialRampToValueAtTime: (...args) => ramps.push(['exponential', ...args]),
    } }; }
  }
  f.replace(globalThis, 'AudioContext', Context);
  const view = await f.mount(createElement(AudioProbe, { api, work }));
  await act(async () => { api.current.unlockAudio(); api.current.playDoneSound(); });
  assert.equal(contexts, 1); assert.equal(resumes, 2); assert.equal(oscillators.length, 0);
  let settled = false; const complete = work.whenSettled().then(() => { settled = true; });
  await view.unmount(); assert.equal(settled, false);
  await act(async () => { if (reject) gate.reject(Error('controlled autoplay refusal')); else gate.resolve(); await complete; });
  assert.equal(settled, true);
  assert.deepEqual(oscillators.map(osc => [osc.type, osc.frequency.value, osc.startAt, osc.stopAt]), reject ? [] : [
    ['sine', 523.25, 10, 10 + 0.45], ['sine', 659.25, 10 + 0.18, 10 + 0.18 + 0.45],
  ]);
  assert.equal(ramps.length, reject ? 0 : 6);
});
