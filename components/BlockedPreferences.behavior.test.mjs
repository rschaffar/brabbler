import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { generalFixture } from './general-settings.fixture.mjs';

test('Markdown blocked preferences: actual audio hook and General update mounted ThinkingBlock across a warm remount', async t => {
  let audioAttempts = 0;
  // Explicit unavailable WebAudio boundary, never a fake successful context.
  // Actual useAudio must keep its toggle usable even when construction throws.
  class UnavailableAudioContext { constructor() { audioAttempts++; throw new Error('Controlled unavailable WebAudio'); } }
  const { f, graph: c, props } = await generalFixture(t, {}, { family: 'preferences', audioContext: UnavailableAudioContext });
  const storageAttempts = [];
  function AudioControls() {
    const audio = c.useAudio();
    return h('button', { type: 'button', 'aria-label': audio.soundEnabled ? 'Disable completion sound' : 'Enable completion sound',
      'data-enabled': String(audio.soundEnabled), 'data-ref-enabled': String(audio.soundEnabledRef.current), onClick: audio.onSoundToggle }, 'Sound');
  }
  const tree = key => h('div', { key }, h(c.GeneralSettings, props), h(AudioControls),
    h(c.ThinkingBlock, { block: { type: 'thinking', thinking: 'Final thinking details.' }, blockIndex: 0 }));
  await f.mount(tree('cold'), { setup(window) {
    const prototype = window.Storage.prototype, get = prototype.getItem, set = prototype.setItem;
    const blocked = new Set(['brabbler-sound-enabled', 'brabbler-thinking-expanded']);
    prototype.getItem = function (key) {
      if (!blocked.has(key)) return get.call(this, key);
      storageAttempts.push(['get', key]); throw new window.DOMException('Storage blocked', 'SecurityError');
    };
    prototype.setItem = function (key, value) {
      if (!blocked.has(key)) return set.call(this, key, value);
      storageAttempts.push(['set', key, value]); throw new window.DOMException('Storage blocked', 'SecurityError');
    };
  } });
  const thinkingSwitch = () => f.node('button[aria-label="Expand thinking blocks by default"]');
  const thinkingBlock = () => f.node('button[aria-label^="Thinking"]');
  assert.equal(thinkingSwitch().getAttribute('aria-checked'), 'false');
  assert.equal(thinkingBlock().getAttribute('aria-expanded'), 'false');
  assert.equal(c.isThinkingExpandedByDefault(), false);
  await f.click('button[aria-label="Disable completion sound"]');
  assert.equal(f.node('button[aria-label="Enable completion sound"]').dataset.enabled, 'false');
  await f.click('button[aria-label="Enable completion sound"]');
  assert.equal(f.node('button[aria-label="Disable completion sound"]').dataset.enabled, 'true');
  assert.equal(audioAttempts, 1, 'toggle really reached and caught the unavailable WebAudio constructor once');
  await f.click(thinkingSwitch());
  assert.equal(thinkingSwitch().getAttribute('aria-checked'), 'true');
  assert.equal(thinkingBlock().getAttribute('aria-expanded'), 'true', 'actual existing ThinkingBlock subscription consumed the store event');
  assert.equal(c.isThinkingExpandedByDefault(), true);
  // A real component remount in the SAME module/page store. Never clear the
  // unsaved fallback or reload the preference module to manufacture a cold pass.
  await f.rerender(tree('warm')); await f.commit();
  assert.equal(thinkingSwitch().getAttribute('aria-checked'), 'true');
  assert.equal(thinkingBlock().getAttribute('aria-expanded'), 'true');
  assert.equal(c.isThinkingExpandedByDefault(), true, 'failed persistence retains the warm page preference');
  await f.click(thinkingSwitch());
  assert.equal(thinkingBlock().getAttribute('aria-expanded'), 'false');
  assert.equal(c.isThinkingExpandedByDefault(), false, 'ordinary user control restores false, not a test reset API');
  assert.deepEqual(storageAttempts.filter(a => a[0] === 'set'), [
    ['set', 'brabbler-sound-enabled', 'false'], ['set', 'brabbler-sound-enabled', 'true'],
    ['set', 'brabbler-thinking-expanded', 'true'], ['set', 'brabbler-thinking-expanded', 'false'],
  ]);
  for (const key of ['brabbler-sound-enabled', 'brabbler-thinking-expanded']) assert.equal(storageAttempts.some(a => a[0] === 'get' && a[1] === key), true, `${key} really threw on read`);
  assert.equal(f.requests.some(r => r.path.startsWith('/api/agent/') || r.path.includes('thinking')), false, 'inline thinking needs no fabricated content read');
  await f.rerender(null); await f.commit();
  f.check();
});
