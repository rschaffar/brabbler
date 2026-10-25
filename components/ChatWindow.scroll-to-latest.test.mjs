import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { act } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { sessionFixture } from '../hooks/agent-session-mounted.fixture.mjs';
import { composerFixture, click } from './composer.fixture.mjs';

const user = index => ({ role: 'user', content: `message ${index}` });
function geometry(c, { height = 1000, top = 120, sentinelTop = 0 } = {}) {
  const container = c.state.scrollContainerRef.current;
  assert.ok(container);
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => typeof height === 'function' ? height() : height });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
  container.scrollTop = top;
  container.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
  const sentinel = container.querySelector('[data-chat-message-column] > .py-3.text-center');
  assert.ok(sentinel, 'actual history sentinel exists');
  sentinel.getBoundingClientRect = () => ({ top: sentinelTop, bottom: sentinelTop + 1 });
  return { container, sentinel,
    setHeight(value) { height = value; }, setSentinelTop(value) { sentinelTop = value; } };
}

test('actual saved-anchor restoration owns pagination before queued observer delivery', async t => {
  const gate = deferred(), calls = [], restored = [];
  const f = composerFixture(t); f.release(() => gate.resolve({ messages: [], entryIds: ['saved'], oldestEntryId: 'oldest', hasMore: false }));
  const c = await f.chat({ loading: true, messages: [user(0)], entryIds: ['current'], hasEarlierMessages: true, historyCursor: 'older',
    loadContext: (...args) => { calls.push(args); return gate.promise; },
    scrollToMessage: (...args) => restored.push(args[1]), scrollToBottom() {},
  }, { session: { id: 'chat', cwd: '', firstMessage: '', messageCount: 1 }, initialScrollPosition: { atBottom: false, anchorEntryId: 'saved', anchorOffset: 17, oldestEntryId: 'oldest' } });
  assert.equal(calls.length, 0, 'saved-session loading prevents admission through actual Strict setup/replay');
  await c.update({ loading: false }); // Commit the real saved-hook ready output.
  const g = geometry(c);
  assert.equal(calls.length, 1, 'restoration entered its real context read');
  await f.intersect(); assert.equal(calls.length, 1, 'sentinel cannot compete with restoration');
  // The real hook publishes context before its returned load promise settles.
  await c.update({ messages: [user(-1), user(0)], entryIds: ['saved', 'current'] });
  await act(async () => { gate.resolve({ messages: [user(-1)], entryIds: ['saved'], oldestEntryId: 'oldest', hasMore: false }); await c.work.whenSettled(); });
  assert.deepEqual(restored, [17]);
  g.setSentinelTop(-100); await f.intersect(); assert.equal(calls.length, 1, 'queued intersection is revalidated against current bounds');
});

test('actual sentinel uses current identities and holds the distance until a committed prepend renders', async t => {
  const gate = deferred(), calls = [];
  const f = composerFixture(t); f.release(() => gate.resolve({ messages: [user(-1)], entryIds: ['old'] }));
  const c = await f.chat({ messages: Array.from({ length: 100 }, (_, i) => user(i)), entryIds: Array.from({ length: 100 }, (_, i) => `entry-${i}`),
    hasEarlierMessages: true, historyCursor: 'older', loadContext: (...args) => { calls.push(args); return gate.promise; } });
  const g = geometry(c);
  g.setSentinelTop(-100); await f.intersect(); assert.deepEqual(calls, []);
  g.setSentinelTop(0); await f.intersect(); assert.deepEqual(calls, [['chat', 'leaf', 'older']]);
  await f.intersect(); assert.equal(calls.length, 1, 'in-flight guard');
  await act(async () => { gate.resolve({ messages: [user(-1)], entryIds: ['old'] }); await c.work.whenSettled(); });
  await f.intersect(); assert.equal(calls.length, 1, 'body completion is not prepend anchoring');
  g.setHeight(() => g.container.querySelectorAll('[data-chat-message-column] > [data-entry-id]').length === 101 ? 2000 : 1900);
  await c.update({ messages: [user(-1), ...c.state.messages], entryIds: ['old', ...c.state.entryIds] });
  assert.equal(g.container.scrollTop, 1120, '2000 - captured distance 880');
  // Observer and draft window are established. Replace ONLY the callback first;
  // independent later leaf/cursor changes must not mask that dependency witness.
  const next = [];
  await c.update({ loadContext: async (...args) => { next.push(args); return null; } });
  await f.intersect(); await act(async () => { await c.work.whenSettled(); });
  assert.deepEqual(next, [['chat', 'leaf', 'older']], 'callback-only replacement reaches the current loader');
  assert.equal(calls.length, 1, 'obsolete loader receives no new request');
  await c.update({ activeLeafId: 'new-leaf' });
  await f.intersect(); await act(async () => { await c.work.whenSettled(); });
  assert.deepEqual(next.at(-1), ['chat', 'new-leaf', 'older'], 'leaf-only change');
  await c.update({ historyCursor: 'new-cursor' });
  await f.intersect(); await act(async () => { await c.work.whenSettled(); });
  assert.deepEqual(next.at(-1), ['chat', 'new-leaf', 'new-cursor'], 'cursor-only change');
  assert.equal(next.length, 3); assert.equal(calls.length, 1);
  await c.view.unmount(); assert.equal(f.intersections.size, 0);
});

test('real scroll control retains its node/exit class, uses current smooth callback and clears minimap space on mobile', async t => {
  const first = [], current = [];
  const f = composerFixture(t), c = await f.chat({ showScrollToBottom: false, scrollToBottom: behavior => first.push(behavior) });
  const button = c.view.container.querySelector('.chat-scroll-to-bottom'); assert.ok(button);
  assert.equal(button.classList.contains('is-visible'), false);
  await c.update({ showScrollToBottom: true });
  assert.equal(c.view.container.querySelector('.chat-scroll-to-bottom') === button, true);
  assert.equal(button.classList.contains('is-visible'), true);
  assert.equal(button.getAttribute('aria-label'), 'Scroll to latest');
  const host = button.parentElement;
  assert.equal(host.style.position, 'absolute'); assert.equal(host.style.bottom, '100%');
  assert.equal(host.style.right, '36px'); assert.equal(host.style.justifyContent, 'center'); assert.equal(host.style.pointerEvents, 'none');
  await click(c.view, button); assert.deepEqual(first, ['smooth']);
  await c.update({ scrollToBottom: behavior => current.push(behavior) }); await click(c.view, button);
  assert.deepEqual(current, ['smooth']); assert.deepEqual(first, ['smooth']);
  await f.setMobile(true); assert.equal(host.style.right, '0px');
  await c.update({ showScrollToBottom: false }); assert.equal(button.classList.contains('is-visible'), false);
});

test('a held post-loading saved restoration with a detached tail keeps the existing latest button non-visible', async t => {
  const gate = deferred(), f = composerFixture(t), calls = [], restored = [];
  f.release(() => gate.resolve({ messages: [], entryIds: [], hasMore: false }));
  // Saved hooks start loading=true and admit restoration after readiness.
  // The earlier initially-ready failures are retained as private input evidence,
  // not asserted to be reachable default saved-session behavior.
  const c = await f.chat({ loading: true, showScrollToBottom: true,
    messages: [user(0)], entryIds: ['current'], hasEarlierMessages: true, historyCursor: 'older',
    loadContext: (...args) => { calls.push(args); return gate.promise; },
    scrollToMessage: (_node, offset) => restored.push(offset), scrollToBottom() {},
  }, { session: { id: 'chat', cwd: '', firstMessage: '', messageCount: 1 }, initialScrollPosition: { atBottom: false, anchorEntryId: 'saved', anchorOffset: 17, oldestEntryId: 'oldest' } });
  await c.update({ loading: false });
  const button = c.view.container.querySelector('.chat-scroll-to-bottom'); assert.ok(button);
  assert.equal(calls.length, 1, 'actual restoration request is held');
  assert.equal(c.state.scrollContainerRef.current.style.visibility, 'hidden');
  assert.equal(button.classList.contains('is-visible'), false, 'pending restore suppresses a true detached-tail flag');
  await c.update({ messages: [user(-1), user(0)], entryIds: ['saved', 'current'] });
  await act(async () => { gate.resolve({ messages: [user(-1)], entryIds: ['saved'], oldestEntryId: 'oldest', hasMore: false }); await c.work.whenSettled(); });
  assert.deepEqual(restored, [17]);
  assert.equal(c.view.container.querySelector('.chat-scroll-to-bottom') === button, true);
  assert.equal(button.classList.contains('is-visible'), true, 'completed restore reveals the existing detached-tail button');
});

test('actual session hook publishes detached-tail state through real scroll events', async t => {
  const f = await sessionFixture(t); await f.mountReady(f.existingOptions());
  const scroller = f.view.window.document.createElement('div'); f.view.window.document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
  scroller.scrollTo = ({ top }) => { scroller.scrollTop = top; };
  f.current.scrollContainerRef.current = scroller;
  await f.run('real transcript publication installs the hook subscription', value => value.setMessages([user(0)]));
  scroller.scrollTop = 0; await f.view.dispatch(scroller, new f.view.window.Event('scroll'));
  assert.equal(f.current.showScrollToBottom, true);
  scroller.scrollTop = 1400; await f.view.dispatch(scroller, new f.view.window.Event('scroll'));
  assert.equal(f.current.showScrollToBottom, false);
  await f.unmount(); await f.settleMaintenance();
});

test('actual saved-anchor reveal retains its expanded 200-row budget for a 150-message prepend', async t => {
  const gate = deferred(), f = composerFixture(t), calls = [];
  f.release(() => gate.resolve({ messages: [], entryIds: [] }));
  const loadedMessages = Array.from({ length: 100 }, (_, i) => user(i));
  const loadedEntryIds = Array.from({ length: 100 }, (_, i) => `entry-${i}`);
  // A saved hook has not published transcript/cursor/hasMore while initially
  // loading. Publish those ready inputs together with loading=false so the
  // actual sentinel subscription sees its real dependency transition.
  const c = await f.chat({ loading: true, messages: [], entryIds: [],
    hasEarlierMessages: false, historyCursor: null, scrollToMessage() {}, scrollToBottom() {},
    loadContext: (...args) => { calls.push(args); return gate.promise; } },
  { session: { id: 'chat', cwd: '', firstMessage: '', messageCount: 100 }, initialScrollPosition: { atBottom: false, anchorEntryId: 'entry-0', anchorOffset: 17, oldestEntryId: 'older' } });
  assert.equal(calls.length, 0, 'no saved restoration/pagination admission while initially loading');
  await c.update({ loading: false, messages: loadedMessages, entryIds: loadedEntryIds,
    hasEarlierMessages: true, historyCursor: 'older' });
  const g = geometry(c);
  assert.equal([...f.intersections].some(observer => observer.targets.has(g.sentinel)), true, 'the actual history observer is attached to the ready sentinel');
  await f.intersect(); assert.deepEqual(calls, [['chat', 'leaf', 'older']]);
  await act(async () => { gate.resolve({ messages: Array.from({ length: 50 }, (_, i) => user(-i - 1)), entryIds: [] }); await c.work.whenSettled(); });
  g.setHeight(2500);
  await c.update({ messages: Array.from({ length: 50 }, (_, i) => user(-i - 1)).concat(c.state.messages),
    entryIds: Array.from({ length: 50 }, (_, i) => `old-${i}`).concat(c.state.entryIds) });
  assert.equal(g.container.querySelectorAll('[data-chat-message-column] > [data-entry-id]').length, 150);
  assert.equal(g.container.scrollTop, 1620, '2500 - captured distance 880 within the prior 200-row budget');
});

for (const [hasEarlierMessages, historyCursor, expected] of [[false, 'older', 0], [true, null, 0], [true, 'server-cursor', 1]]) {
  test(`actual view pagination trusts hasMore=${hasEarlierMessages} cursor=${historyCursor} rather than first visible row`, async t => {
    const f = composerFixture(t), calls = [];
    const c = await f.chat({ messages: [user(0)], entryIds: ['visible-row-is-not-cursor'], hasEarlierMessages, historyCursor,
      loadContext: async (...args) => { calls.push(args); return null; } });
    if (hasEarlierMessages) { geometry(c); await f.intersect(); await act(async () => { await c.work.whenSettled(); }); }
    assert.equal(calls.length, expected);
    if (expected) assert.deepEqual(calls, [['chat', 'leaf', 'server-cursor']]);
    if (!hasEarlierMessages) assert.equal(c.view.container.querySelector('[data-chat-message-column] > .py-3.text-center') === null, true);
  });
}

for (const outcome of ['null-context', 'saved-boundary', 'exhausted', 'unmount-abort']) {
  test(`actual saved viewport restoration settles ${outcome} without unbounded or competing pagination`, async t => {
    const gate = deferred(), f = composerFixture(t), calls = [], fallback = [];
    f.release(() => gate.resolve(null));
    const c = await f.chat({ loading: true, messages: [user(0)], entryIds: ['current'], hasEarlierMessages: true, historyCursor: 'cursor',
      loadContext: (...args) => { calls.push(args); return gate.promise; }, scrollToBottom: behavior => fallback.push(behavior), scrollToMessage() {} },
    { session: { id: 'chat', cwd: '', messageCount: 1, firstMessage: '' }, initialScrollPosition: { atBottom: false, anchorEntryId: 'missing', anchorOffset: 9, oldestEntryId: 'saved-oldest' } });
    assert.equal(calls.length, 0, 'actual Strict replay occurs before saved-session readiness/admission');
    await c.update({ loading: false });
    assert.equal(c.state.scrollContainerRef.current.style.visibility, 'hidden'); assert.equal(calls.length, 1);
    if (outcome === 'unmount-abort') await c.view.unmount();
    await act(async () => { gate.resolve(outcome === 'null-context' || outcome === 'unmount-abort' ? null : { messages: [], entryIds: [], oldestEntryId: outcome === 'saved-boundary' ? 'saved-oldest' : 'different', hasMore: outcome === 'saved-boundary' }); await c.work.whenSettled(); });
    assert.equal(calls.length, 1);
    assert.deepEqual(fallback, outcome === 'unmount-abort' ? [] : ['instant']);
    if (outcome !== 'unmount-abort') assert.equal(c.state.scrollContainerRef.current.style.visibility, '');
  });
}

test('actual chat viewport cleanup records the visible entry anchor rather than inventing a tail position', async t => {
  const f = composerFixture(t), positions = [];
  const c = await f.chat({ messages: [user(0)], entryIds: ['visible-anchor'], historyCursor: 'server-oldest', hasEarlierMessages: true },
    { session: { id: 'chat', cwd: '', messageCount: 1, firstMessage: '' }, onScrollPositionChange: (id, position) => positions.push([id, position]) });
  const g = geometry(c); g.container.querySelector('[data-chat-message-column] > [data-entry-id]').getBoundingClientRect = () => ({ top: 10, bottom: 80 });
  positions.length = 0; await c.view.unmount();
  assert.deepEqual(positions, [['chat', { atBottom: false, anchorEntryId: 'visible-anchor', anchorOffset: 10, oldestEntryId: 'server-oldest' }]]);
});

// Intentional presentation declarations only. Chromium remains the owner of
// native geometry, actual scrolling, hover/focus appearance and reduced motion.
const cssSource = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
test('scroll button CSS declarations preserve faint/revealed/focus and reduced-motion transitions', () => {
  assert.match(cssSource, /\.chat-scroll-to-bottom\.is-visible \{[\s\S]*?pointer-events: auto;/);
  assert.match(cssSource, /\.chat-scroll-to-bottom:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/);
  const hidden = cssSource.slice(cssSource.indexOf('.chat-scroll-to-bottom {'));
  const visible = hidden.slice(hidden.indexOf('.chat-scroll-to-bottom.is-visible {'));
  const reveal = hidden.slice(hidden.indexOf('.chat-scroll-to-bottom.is-visible:hover'));
  assert.match(visible.slice(0, visible.indexOf('}')), /opacity: 0\.28;[\s\S]*?visibility: visible;[\s\S]*?transform: none;/);
  assert.match(reveal.slice(0, reveal.indexOf('}')), /opacity: 1;/);
  assert.match(cssSource, /\.chat-scroll-to-bottom\.is-visible:hover,\s*\.chat-scroll-to-bottom\.is-visible:focus-visible \{[\s\S]*?opacity: 1;/);
  assert.match(hidden.slice(0, hidden.indexOf('}')), /opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?transform: translateY\(4px\) scale\(0\.96\);/);
  assert.match(hidden.slice(0, hidden.indexOf('}')), /transition:[\s\S]*?opacity 0\.16s ease,[\s\S]*?transform 0\.16s ease,[\s\S]*?visibility 0s linear 0\.16s;/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\) \{\s*\.chat-scroll-to-bottom,\s*\.chat-scroll-to-bottom\.is-visible \{\s*transform: none;\s*transition:\s*opacity 0\.16s ease,/);
});
