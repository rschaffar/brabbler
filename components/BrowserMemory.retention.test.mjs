import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useRef } from 'react';
import { packet, click } from './cards-git.fixture.mjs';

// Real React owners and controlled external reads/events; no GC/RSS or layout claim.
for (const oversized of [false, true]) test(`collapsed thinking releases component ownership (${oversized ? 'oversized reload' : 'bounded cache reuse'})`, async t => {
  const failures = [], reads = [];
  let closing = false, value;
  const sessionId = oversized ? 'memory-large' : 'memory-small';
  const domain = {
    release() { closing = true; },
    async join() { if (failures.length) throw new AggregateError(failures, 'thinking capability failures'); },
    async fetch(input, init = {}) {
      try {
        assert.equal(closing, false, 'no late read admission');
        const url = new URL(input, 'https://fixture.invalid');
        assert.equal(url.origin, 'https://fixture.invalid');
        assert.equal(url.pathname, `/api/sessions/${sessionId}/entries/entry/thinking`);
        assert.equal(url.search, '?blockIndex=0');
        assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined);
        reads.push(url.pathname);
        return { ok: true, async json() { return { thinking: value }; } };
      } catch (error) { failures.push(error); throw error; }
    },
  };
  const h = await packet(t, { readDomain: domain });
  const { ThinkingBlock } = await h.load('./MessageView.tsx');
  const { THINKING_CACHE_LIMITS } = await h.load('../lib/thinking-content-cache.ts');
  value = oversized ? 'x'.repeat(THINKING_CACHE_LIMITS.maxEntryBytes / 2 + 1) : 'full synthetic thinking';
  const props = { block: { type: 'thinking', thinking: 'Preview', deferred: true }, sessionId, entryId: 'entry', blockIndex: 0,
    onThinkingWork({ request, tail }) { h.onReadWork(request); h.onReadWork(tail); } };
  await h.render(createElement(ThinkingBlock, props));
  const button = () => h.view.container.querySelector('button[aria-label^="Thinking"]');
  assert.equal(reads.length, 0, 'collapsed history is deferred');
  await click(h.view, button()); await h.settle();
  assert.equal(h.view.container.textContent.includes(value), true, 'full result is displayed, never truncated');
  assert.equal(reads.length, 1);
  await click(h.view, button());
  assert.equal(button().getAttribute('aria-expanded'), 'false');
  assert.equal(h.view.container.textContent.includes(value), false, 'collapsed body unmounted');
  await click(h.view, button()); await h.settle();
  assert.equal(reads.length, oversized ? 2 : 1, 'only bounded cache, not collapsed component state, owns reuse');
  assert.equal(h.view.container.textContent.includes(value), true);
  await h.view.unmount(); await h.settle();
});

test('actual minimap releases drag listeners on replacement, mouseup, blur, hiding and unmount', async t => {
  const timers = new Map(), listeners = new Map(['mousemove', 'mouseup', 'blur'].map(type => [type, new Set()]));
  let nextTimer = 0;
  const h = await packet(t, { setup(window, replace) {
    for (const [name, value] of [['clientHeight', 300], ['clientWidth', 800], ['scrollHeight', 1000]]) {
      Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get: () => value });
    }
    const add = window.addEventListener, remove = window.removeEventListener;
    replace(window, 'addEventListener', function (type, listener, options) {
      listeners.get(type)?.add(listener); return add.call(this, type, listener, options);
    });
    replace(window, 'removeEventListener', function (type, listener, options) {
      listeners.get(type)?.delete(listener); return remove.call(this, type, listener, options);
    });
    const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
    replace(globalThis, 'setTimeout', (callback, delay, ...args) => {
      if (![50, 150, 250].includes(delay)) return timeout(callback, delay, ...args);
      const id = { id: ++nextTimer }; timers.set(id, { callback, delay }); return id;
    });
    replace(globalThis, 'clearTimeout', id => { if (!timers.delete(id)) clear(id); });
  } });
  // Emergency teardown also owns a deliberately broken-production counterexample.
  h.addDomainRelease(() => {
    for (const [type, callbacks] of listeners) for (const callback of [...callbacks]) h.view.window.removeEventListener(type, callback);
  });
  const { ChatMinimap } = await h.load('./ChatMinimap.tsx');
  const messages = [{ role: 'user', content: 'Synthetic history', timestamp: 1 }];
  const noStreaming = () => null;
  let navigations = 0;
  function Host() {
    const scroll = useRef(null), refs = useRef([]);
    return createElement('div', null,
      createElement('div', { ref: scroll, 'data-scroller': '' },
        createElement('div', { ref: element => { refs.current[0] = element; } }, 'History')),
      createElement(ChatMinimap, { messages, getStreamingMessage: noStreaming, scrollContainer: scroll, messageRefs: refs,
        onNavigate() { navigations++; }, onRevealHistory() { assert.fail('rendered history needs no reveal'); } }));
  }
  const measure = async () => act(async () => {
    const entry = [...timers].find(([, timer]) => timer.delay === 150);
    assert.equal(Boolean(entry), true, 'actual measurement scheduled');
    timers.delete(entry[0]); entry[1].callback();
  });
  const count = expected => {
    for (const [type, callbacks] of listeners) assert.equal(callbacks.size, expected, `${type} drag listener count`);
  };
  let pointerY = 0;
  const down = async () => {
    const node = h.view.container.querySelector('[data-minimap-node-index]');
    assert.equal(Boolean(node), true, 'visible measured minimap');
    // Align the supplied bounding box with clientHeight; the generic fixture's
    // 22px box would put the pointer outside this actual node's hit radius.
    node.parentElement.dataset.fixtureHeight = '300';
    pointerY = parseFloat(node.style.top) * 3;
    await h.view.dispatch(node.parentElement, new h.view.window.MouseEvent('mousedown', { bubbles: true, clientY: pointerY }));
  };
  await h.render(createElement(Host)); await measure(); count(0);
  await down(); count(1);
  const before = navigations;
  await h.view.dispatch(h.view.window, new h.view.window.MouseEvent('mousemove', { clientY: pointerY + 1 }));
  assert.equal(navigations > before, true, 'live drag still navigates');
  await down(); count(1); // A missed prior mouseup must not accumulate listeners.
  await h.view.dispatch(h.view.window, new h.view.window.MouseEvent('mouseup')); count(0);
  await down(); count(1);
  await h.view.dispatch(h.view.window, new h.view.window.Event('blur')); count(0);
  const stopped = navigations;
  await h.view.dispatch(h.view.window, new h.view.window.MouseEvent('mousemove', { clientY: 20 }));
  assert.equal(navigations, stopped, 'blur terminates navigation');
  await down(); count(1);
  const scroller = h.view.container.querySelector('[data-scroller]');
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 300 });
  await h.resize(scroller); count(0);
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
  await h.resize(scroller); await measure();
  await down(); count(1);
  await h.view.unmount(); count(0);
  assert.equal(timers.size, 0, 'measurement and preview timers cleaned up');
  assert.equal(h.observers.every(observer => observer.targets.size === 0), true);
});
