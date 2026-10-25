import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { composerFixture, click, inputText } from './composer.fixture.mjs';

async function selectResponse(c, f) {
  const target = c.view.container.querySelector('[data-message-role="assistant"] p'); assert.ok(target);
  const range = c.view.window.document.createRange(); range.selectNodeContents(target);
  const selection = c.view.window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  await c.view.dispatch(target, new c.view.window.Event('pointerup', { bubbles: true }));
  assert.ok(c.view.window.document.querySelector('[role="toolbar"]'));
  assert.equal([...f.observers].some(observer => [...observer.targets].some(node => node.getAttribute('role') === 'toolbar')), true);
}
const response = { role: 'assistant', content: [{ type: 'text', text: 'selected response' }] };

test('actual compact quote dialog submits exact prompt/source identities using the current callback and joins completion', async t => {
  const old = [], current = [], gate = deferred();
  const f = composerFixture(t); f.release(() => gate.resolve());
  const c = await f.chat({ messages: [response], entryIds: ['source-entry'] }, { quoteSelectionEnabled: true,
    onAskInNewChat: async (...args) => { old.push(args); } });
  await selectResponse(c, f);
  const toolbar = c.view.window.document.querySelector('[role="toolbar"]');
  assert.ok(toolbar.querySelector('[aria-label="Ask here"]'));
  await c.update({}, { onAskInNewChat: (...args) => { current.push(args); return gate.promise; } });
  await click(c.view, toolbar.querySelector('[aria-label="Ask in new chat"]')); await f.frame();
  const dialog = c.view.window.document.querySelector('[role="dialog"]'); assert.ok(dialog);
  const textarea = dialog.querySelector('textarea');
  assert.equal(textarea.value.includes('> selected response'), true);
  assert.equal(dialog.querySelector('input[type="file"]') === null, true);
  await inputText(c.view, textarea, 'literal branch prompt');
  await click(c.view, [...dialog.querySelectorAll('button')].find(node => node.textContent === 'Send'));
  assert.deepEqual(current, [['literal branch prompt', 'chat', 'source-entry']]); assert.deepEqual(old, []);
  assert.equal(dialog.querySelector('fieldset').disabled, true);
  const complete = c.work.whenSettled(); await act(async () => { gate.resolve(); await complete; });
  assert.equal(c.view.window.document.querySelector('[role="dialog"]') === null, true);
});

test('actual quote failure retains the submitted text and visible error; Escape cannot close pending submission', async t => {
  const gate = deferred(), f = composerFixture(t); f.release(() => gate.resolve());
  const c = await f.chat({ messages: [response], entryIds: ['answer'] }, { quoteSelectionEnabled: true, onAskInNewChat: () => gate.promise });
  await selectResponse(c, f);
  await click(c.view, c.view.window.document.querySelector('[aria-label="Ask in new chat"]')); await f.frame();
  const dialog = c.view.window.document.querySelector('[role="dialog"]'), textarea = dialog.querySelector('textarea');
  await inputText(c.view, textarea, 'recover literal prompt');
  await click(c.view, [...dialog.querySelectorAll('button')].find(node => node.textContent === 'Send'));
  await f.key(dialog, 'Escape'); assert.equal(c.view.window.document.querySelector('[role="dialog"]') === dialog, true);
  const complete = c.work.whenSettled();
  await act(async () => { gate.reject(new Error('synthetic fork refusal')); await complete; }); await f.frame();
  assert.equal(textarea.value, 'recover literal prompt'); assert.equal(dialog.querySelector('[role="alert"]').textContent, 'synthetic fork refusal');
  assert.equal(dialog.querySelector('fieldset').disabled, false);
  await f.key(dialog, 'Escape'); assert.equal(c.view.window.document.querySelector('[role="dialog"]') === null, true);
});

for (const outcome of ['missing-id', 'HTTP 409']) test(`actual quote hook + UI owns the complete caught refusal: ${outcome}`, async t => {
  const requests = [], navigations = [];
  const f = composerFixture(t, { route(request) {
    assert.equal(request.url.pathname, '/api/agent/chat'); assert.equal(request.url.search, '');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual([...new Headers(request.options.headers)], [['content-type', 'application/json']]);
    assert.deepEqual(JSON.parse(request.options.body), { type: 'fork_branch', entryId: 'answer' });
    requests.push(request);
  } });
  const c = await f.chat({ messages: [response], entryIds: ['answer'] }, { quoteSelectionEnabled: true },
    { selectedId: 'chat', onForked: id => f.http.check(() => { navigations.push(id); assert.fail('a refused fork must not navigate'); }) });
  await selectResponse(c, f);
  await click(c.view, c.view.window.document.querySelector('[aria-label="Ask in new chat"]')); await f.frame();
  const dialog = c.view.window.document.querySelector('[role="dialog"]'); assert.ok(dialog);
  const textarea = dialog.querySelector('textarea');
  await inputText(c.view, textarea, 'recover exact wire prompt');
  await click(c.view, [...dialog.querySelectorAll('button')].find(node => node.textContent === 'Send'));
  assert.equal(requests.length, 1); assert.equal(dialog.querySelector('fieldset').disabled, true);
  await act(async () => {
    requests[0].reply(outcome === 'missing-id' ? { success: true, data: {} } : { error: 'controlled fork refusal' }, outcome === 'missing-id' ? 200 : 409);
    await c.work.whenSettled(); // Includes the real UI catch/restore/finally.
  });
  await f.frame();
  assert.equal(textarea.value, 'recover exact wire prompt');
  const alert = dialog.querySelector('[role="alert"]'); assert.ok(alert); assert.equal(alert.textContent.length > 0, true);
  if (outcome === 'HTTP 409') assert.equal(alert.textContent, 'controlled fork refusal');
  assert.equal(dialog.querySelector('fieldset').disabled, false); assert.deepEqual(navigations, []);
  await c.view.unmount(); await c.work.whenSettled();
});

test('quote actions are source-bound, covered/inert and dismissed after outside interaction or disabled selection', async t => {
  const f = composerFixture(t), c = await f.chat({ messages: [response], entryIds: [''] }, { quoteSelectionEnabled: true, onAskInNewChat: async () => {} });
  await selectResponse(c, f);
  assert.equal(c.view.window.document.querySelector('[aria-label="Ask in new chat"]') === null, true);
  await c.update({}, { covered: true });
  const toolbar = c.view.window.document.querySelector('[role="toolbar"]');
  assert.equal(toolbar.hasAttribute('inert'), true); assert.equal(toolbar.style.display, 'none');
  await c.update({}, { covered: false });
  await c.view.dispatch(c.view.window.document.body, new c.view.window.Event('pointerdown', { bubbles: true }));
  assert.equal(c.view.window.document.querySelector('[role="toolbar"]') === null, true);
  await selectResponse(c, f); await c.update({}, { quoteSelectionEnabled: false });
  assert.equal(c.view.window.document.querySelector('[role="toolbar"]') === null, true);
});

test('actual initial prompt waits for readiness, consumes before Send, and is admitted exactly once', async t => {
  const order = [], gate = deferred(), f = composerFixture(t); f.release(() => gate.resolve());
  const c = await f.chat({ loading: true, handleSend: prompt => { order.push(['send', prompt]); return gate.promise; } },
    { initialPrompt: 'literal initial quote', onInitialPromptConsumed: () => order.push(['consumed']) });
  assert.deepEqual(order, []);
  await c.update({ loading: false, error: 'temporary' }); assert.deepEqual(order, []);
  await c.update({ error: null }); assert.deepEqual(order, [['consumed'], ['send', 'literal initial quote']]);
  await c.update({}, { initialPrompt: 'different late prompt' }); assert.equal(order.length, 2);
  let joined = false; const complete = c.work.whenSettled().then(() => { joined = true; });
  assert.equal(joined, false);
  await c.view.unmount(); assert.equal(joined, false, 'React unmount is not full Send completion');
  await act(async () => { gate.resolve(); await complete; }); assert.equal(joined, true);
});

test('additive composer adapter starts immediately, preserves promise identity and retains late failures through peer/report joins', async t => {
  const f = composerFixture(t);
  const { createComposerWork } = await f.jiti.import('../lib/client-completion.ts');
  const failed = deferred(), peer = deferred(), failure = new Error('expected primitive failure'), reporterFailure = new Error('expected primitive reporter failure');
  f.release(() => failed.reject(failure)); f.release(() => peer.resolve());
  const reports = [], work = createComposerWork(error => { reports.push(error); throw reporterFailure; });
  let started = false;
  const original = failed.promise;
  const returned = work.run(() => { started = true; return original; });
  assert.equal(started, true, 'run does not defer public admission');
  assert.equal(returned === original, true, 'returned public promise identity');
  work.run(() => peer.promise);
  const publicFailure = assert.rejects(returned, error => error === failure); f.join(() => publicFailure);
  failed.reject(failure); await publicFailure;
  // The public rejection is already observed. The late join must retain both
  // failure/reporting outcome and still wait for an independently held peer.
  let joined = false;
  const verify = () => assert.rejects(work.whenSettled(), error => error instanceof AggregateError
    && error.errors.includes(failure) && error.errors.some(item => item.cause === reporterFailure));
  const settled = verify().then(() => { joined = true; }); f.join(() => settled);
  assert.equal(joined, false, 'a failing reporter does not abandon the held peer');
  peer.resolve(); await settled; assert.equal(joined, true); assert.equal(reports.length, 1); assert.equal(reports[0] === failure, true);
  await verify(); // Failure is retained even after the completed late join.
});

// Intentional z-index declaration guard, not native selection/focus/layout proof.
test('quote presentation declares a layer above the session sidebar', async () => {
  const chatSource = await readFile(new URL('./ChatWindow.tsx', import.meta.url), 'utf8');
  const shellSource = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
  const toolbar = chatSource.match(/role=\{quoteInputOpen \? "dialog" : "toolbar"\}[\s\S]*?zIndex:\s*(\d+)/);
  const sidebar = shellSource.match(/id="session-sidebar"[\s\S]*?zIndex:\s*(\d+)/);
  assert.ok(toolbar); assert.ok(sidebar);
  assert.ok(Number(toolbar[1]) > Number(sidebar[1]), 'quote layer exceeds sidebar layer');
});

for (const outcome of ['success', 'missing-id', 'HTTP failure']) test(`actual shell quote-branch hook owns exact fork body, current callback and prompt identity: ${outcome}`, async t => {
  const requests = [], first = [], current = [];
  const f = composerFixture(t, { route(request) {
    assert.equal(request.url.pathname, '/api/agent/source%20session%2F%3F');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual([...new Headers(request.options.headers)], [['content-type', 'application/json']]);
    assert.equal(request.url.search, '');
    assert.deepEqual(JSON.parse(request.options.body), { type: 'fork_branch', entryId: 'entry exact' });
    requests.push(request); // The body remains held until the operation is observed.
  } });
  const p = await f.load(), api = createRef();
  let props = { selectedId: 'source session/?', onForked: id => first.push(id), api };
  const element = () => createElement(p.I18nProvider, null, createElement(p.QuoteBranchProbe, props));
  const view = await f.mount(element());
  props = { ...props, onForked: id => current.push(id) }; await view.rerender(element());
  let operation, observed;
  // This direct consumer owns the complete public call/assert.rejects, not a
  // second inner retained-failure observer for an ordinary fork refusal.
  await act(async () => {
    operation = api.current.onAskInNewChat(' literal prompt ', 'source session/?', 'entry exact');
    observed = outcome === 'success' ? operation : assert.rejects(operation);
    f.join(() => observed);
  });
  assert.equal(requests.length, 1); assert.equal(view.container.textContent, '');
  const afterAdmission = [];
  props = { ...props, selectedId: 'navigated-during-fork', onForked: id => afterAdmission.push(id) }; await view.rerender(element());
  await act(async () => {
    requests[0].reply(outcome === 'success' ? { success: true, data: { newSessionId: 'child' } } : outcome === 'missing-id' ? { success: true, data: {} } : { error: 'controlled fork refusal' }, outcome === 'HTTP failure' ? 409 : 200);
    await observed;
  });
  assert.deepEqual(first, []);
  assert.deepEqual(current, outcome === 'success' ? ['child'] : []);
  assert.deepEqual(afterAdmission, [], 'the admitted fork retains its original captured navigation callback');
  props = { ...props, selectedId: 'unrelated' }; await view.rerender(element()); assert.equal(view.container.textContent, '');
  props = { ...props, selectedId: 'child' }; await view.rerender(element());
  assert.equal(view.container.textContent, outcome === 'success' ? ' literal prompt ' : '');
  if (outcome === 'success') {
    await act(async () => api.current.onInitialPromptConsumed()); assert.equal(view.container.textContent, '');
    props = { ...props, selectedId: 'source session/?' }; await view.rerender(element());
    props = { ...props, selectedId: 'child' }; await view.rerender(element()); assert.equal(view.container.textContent, '', 'consumed prompt cannot replay');
  }
});
