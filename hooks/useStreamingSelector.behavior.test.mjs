import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, Fragment, useLayoutEffect } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';

const jiti = createJiti(import.meta.url, { fsCache: false, tsconfigPaths: true });
const { useStreamingSelector, selectIsStreaming, selectHasStreamingContent, selectStreamingMessage } = await jiti.import('./useStreamingSelector.ts');
const { createStreamingStore } = await jiti.import('../lib/streaming-message.ts');

// Real hook and real store. Only observe subscription identities/disposal; no
// selector/state/effect algorithm is reimplemented by this transparent adapter.
function observedStore() {
  const real = createStreamingStore(), active = new Set();
  const store = { ...real, subscribe(listener) {
    active.add(listener);
    const stop = real.subscribe(listener);
    return () => { active.delete(listener); stop(); };
  } };
  return { store, active };
}
function Probe({ store, select, name = 'value', onCommit }) {
  const value = useStreamingSelector(store, select);
  useLayoutEffect(() => { onCommit(value); }, [value, onCommit]);
  return createElement('output', { 'data-probe': name }, value === null ? 'none' : typeof value === 'object' ? JSON.stringify(value) : String(value));
}
function GapWriter({ write }) {
  // A preceding sibling layout effect runs after render but before the probe's
  // layout-effect subscription. This uses React's actual commit ordering.
  useLayoutEffect(write, [write]);
  return null;
}
const output = (view, name = 'value') => view.container.querySelector(`[data-probe="${name}"]`).textContent;
const delta = (store, type, extra = {}) => store.dispatch({ type: 'delta', event: { type, contentIndex: 0, ...extra } });

test('real layout subscription repairs a render/commit gap and is released on unmount', async t => {
  const { store, active } = observedStore(), commits = [];
  const write = () => { store.dispatch({ type: 'start' }); };
  const onCommit = value => commits.push(value);
  const view = await mount(t, createElement(Fragment, null,
    createElement(GapWriter, { write }), createElement(Probe, { store, select: selectIsStreaming, onCommit })));
  assert.equal(output(view), 'true', 'start happened before subscription; mount must repair the gap');
  assert.equal(commits.at(-1), true);
  assert.equal(active.size, 1, 'Strict Effects retain exactly one live subscription');
  await view.unmount();
  assert.equal(active.size, 0);
  const count = commits.length;
  await act(() => { store.dispatch({ type: 'end' }); });
  assert.equal(commits.length, count);
  assert.equal(view.container.childNodes.length, 0);
});

test('rerender adopts the current stable selector/store and unsubscribes the obsolete store', async t => {
  const a = observedStore(), b = observedStore(), commits = [];
  a.store.dispatch({ type: 'start' });
  const onCommit = value => commits.push(value);
  const render = (store, select) => createElement(Probe, { store, select, onCommit });
  const view = await mount(t, render(a.store, selectIsStreaming));
  assert.equal(output(view), 'true');
  await view.rerender(render(a.store, selectHasStreamingContent));
  assert.equal(output(view), 'false', 'selector changed without a new store publication');
  await act(() => { a.store.dispatch({ type: 'snapshot', message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] } }); });
  assert.equal(output(view), 'true');
  await view.rerender(render(b.store, selectHasStreamingContent));
  assert.equal(output(view), 'false', 'store changed without a new publication');
  assert.equal(a.active.size, 0);
  assert.equal(b.active.size, 1);
  const count = commits.length;
  await act(() => { a.store.dispatch({ type: 'end' }); });
  assert.equal(commits.length, count, 'obsolete store cannot publish into current consumer');
  await act(() => { b.store.dispatch({ type: 'start' }); });
  assert.equal(output(view), 'false', 'current content selector ignores streaming-only change');
  await view.rerender(render(b.store, selectIsStreaming));
  assert.equal(output(view), 'true', 'new selector is sampled immediately');
  await act(() => { b.store.dispatch({ type: 'end' }); });
  assert.equal(output(view), 'false');
  await view.unmount();
  assert.equal(a.active.size + b.active.size, 0);
});

test('1000 actual store chunks preserve every reply publication while mounted boolean consumers stay stable', async t => {
  const { store, active } = observedStore();
  store.dispatch({ type: 'start' });
  store.dispatch({ type: 'snapshot', message: { role: 'assistant', content: [] } });
  delta(store, 'text_start');
  const commits = { streaming: [], content: [], reply: [] }, publications = [];
  const stop = store.subscribe(() => publications.push(store.getState()));
  t.after(stop);
  const streaming = value => commits.streaming.push(value);
  const content = value => commits.content.push(value);
  const reply = value => commits.reply.push(value);
  const view = await mount(t, createElement(Fragment, null,
    createElement(Probe, { store, select: selectIsStreaming, name: 'streaming', onCommit: streaming }),
    createElement(Probe, { store, select: selectHasStreamingContent, name: 'content', onCommit: content }),
    createElement(Probe, { store, select: selectStreamingMessage, name: 'reply', onCommit: reply })));
  const before = [commits.streaming.length, commits.content.length];
  await act(() => {
    for (let index = 0; index < 1000; index++) delta(store, 'text_delta', { delta: '界' });
  });
  assert.equal(publications.length, 1000);
  assert.equal(new Set(publications.map(state => selectStreamingMessage(state))).size, 1000, 'every actual reply publication has a fresh snapshot');
  assert.ok(publications.every(state => selectIsStreaming(state) && selectHasStreamingContent(state)));
  assert.deepEqual([commits.streaming.length, commits.content.length], before);
  assert.equal(commits.reply.at(-1).content[0].text, '界'.repeat(1000));
  assert.equal(output(view, 'streaming'), 'true');
  assert.equal(output(view, 'content'), 'true');
  await act(() => { store.dispatch({ type: 'end' }); });
  assert.equal(output(view, 'streaming'), 'false');
  assert.equal(output(view, 'content'), 'false');
  assert.equal(output(view, 'reply'), 'none');
  const settled = publications.length;
  await act(() => { store.dispatch({ type: 'end' }); });
  assert.equal(publications.length, settled, 'no-op end does not publish');
  await view.unmount();
  assert.equal(active.size, 1, 'only the explicitly owned observation remains');
  stop();
  assert.equal(active.size, 0);
});
