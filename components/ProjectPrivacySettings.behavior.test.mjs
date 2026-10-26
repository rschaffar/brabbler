import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { navigationRuntime, exact, session, click, button, inputText } from './navigation-runtime.fixture.mjs';
const sessions = [session('a'), session('wt', '/repo/wt'), session('unresolved', '/provisional', { projectRoot: undefined, projectKey: undefined })];
function privacyRoute(request) {
  if ((request.options.method ?? 'GET') === 'GET') exact(request, '/api/hidden-projects', {}, { cache: 'no-store' });
  else {
    const body = JSON.parse(request.options.body); assert.equal(typeof body.hidden, 'boolean'); assert.equal(body.key, '/repo');
    exact(request, '/api/hidden-projects', {}, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  }
  return undefined;
}
async function initial(r, keys = []) {
  for (const request of [...r.requests]) await r.reply(request, { keys });
  await r.settled();
}

test('actual Settings switches conceal before write, serialize mutation/refresh, and withhold failed reveal without deleting SSR coverage', async t => {
  const r = await navigationRuntime(t, privacyRoute); let current;
  const props = { sessions, onCommit: value => { current = value; } };
  await r.render(createElement(r.graph.PrivacyHarness, props));
  assert.equal(r.view.container.querySelector('[role="switch"]') === null, true);
  await initial(r);
  const control = r.view.container.querySelector('[role="switch"]');
  assert.equal(r.view.container.querySelectorAll('[role="switch"]').length, 1, 'actual worktree deduplication');
  assert.doesNotMatch(r.view.container.textContent, /provisional/);
  await click(r.view, control);
  const hide = r.latest('/api/hidden-projects', 'POST');
  assert.deepEqual(JSON.parse(hide.options.body), { key: '/repo', hidden: true });
  assert.equal(current.keys.has('/repo'), true, 'immediate concealment precedes response');
  assert.equal(control.getAttribute('aria-checked'), 'true'); assert.equal(control.disabled, true);
  const admitted = r.requests.length;
  await act(async () => { current.refresh(); current.setHidden('/repo', false); });
  await r.view.dispatch(r.view.window, new r.view.window.Event('focus'));
  await r.poll();
  assert.equal(r.requests.length, admitted, 'busy owner refuses refresh and competing mutation');
  await r.reply(hide, { keys: ['/repo'] }); await r.settled();
  await click(r.view, r.view.container.querySelector('[role="switch"]'));
  const reveal = r.latest('/api/hidden-projects', 'POST');
  assert.deepEqual(JSON.parse(reveal.options.body), { key: '/repo', hidden: false });
  assert.equal(current.keys.has('/repo'), true, 'never optimistically reveal');
  await r.reply(reveal, {}, 500); await r.settled();
  assert.equal(current.keys, null); assert.equal(current.error, true); assert.equal(current.pendingKey, null);
  assert.equal(r.view.container.querySelector('[role="switch"]') === null, true);
  await click(r.view, button(r.view, 'Retry'));
  await r.reply(r.latest('/api/hidden-projects'), { keys: ['/repo'] }); await r.settled();
  assert.equal(current.keys.has('/repo'), true);
});

test('privacy generations reject obsolete bodies; visible-only cadence and current callback identities release on unmount', async t => {
  let visibility = 'visible', current;
  const r = await navigationRuntime(t, privacyRoute, (window) => {
    Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  const props = { sessions, onCommit: value => { current = value; } };
  await r.render(createElement(r.graph.PrivacyHarness, props));
  const strictReads = [...r.requests];
  for (const request of strictReads) await r.headers(request);
  await act(async () => { current.refresh(); }); const fresh = r.latest('/api/hidden-projects');
  await r.reply(fresh, { keys: ['/repo', '/saved-absent'] });
  for (const old of strictReads) await r.body(old, { keys: [] });
  await r.settled(); assert.equal(current.keys.has('/repo'), true);
  assert.match(r.view.container.textContent, /saved-absent/);
  const before = r.requests.length; visibility = 'hidden'; await r.poll();
  await r.view.dispatch(r.view.window, new r.view.window.Event('online'));
  assert.equal(r.requests.length, before);
  visibility = 'visible'; await r.poll(); const background = r.latest('/api/hidden-projects');
  assert.equal(current.keys.has('/repo'), true, 'background refresh does not blank accepted state');
  await r.reply(background, { keys: ['/repo'] }); await r.settled();
  await r.render(createElement(r.graph.PrivacyHarness, { ...props, sessions: [session('new')] }));
  await inputText(r.view, r.view.container.querySelector('input[type="search"]'), 'repo');
  assert.equal(r.view.container.querySelectorAll('[role="switch"]').length, 1);
  await r.view.dispatch(r.view.window, new r.view.window.Event('focus'));
  const closing = r.latest('/api/hidden-projects');
  await r.view.unmount(); assert.equal(r.intervalCount, 0);
  await r.reply(closing, { keys: [] }); await r.settled();
  const stopped = r.requests.length;
  for (const target of [r.view.window, r.view.window.document]) for (const type of ['focus', 'online', 'visibilitychange']) await act(async () => { target.dispatchEvent(new r.view.window.Event(type)); });
  assert.equal(r.requests.length, stopped, 'listeners removed, no read after release');
});

// Exact browser-retirement gaps only; same actual PrivacyHarness and lifetime.
// Controlled bodies are not native storage or whole-AppShell authority.
test('retirement privacy: old visible poll after hide and exact invalid GET/POST bodies stay fail closed until explicit Retry', async t => {
  const r = await navigationRuntime(t, privacyRoute); let current;
  await r.render(createElement(r.graph.PrivacyHarness, { sessions, onCommit: value => { current = value; } }));
  await initial(r);
  await r.poll();
  const oldVisible = r.latest('/api/hidden-projects');
  await r.headers(oldVisible);
  await click(r.view, r.view.container.querySelector('[role="switch"]'));
  const hide = r.latest('/api/hidden-projects', 'POST');
  assert.deepEqual(JSON.parse(hide.options.body), { key: '/repo', hidden: true });
  assert.equal(current.keys.has('/repo'), true, 'conceal before write acknowledgement');
  await r.reply(hide, { keys: ['/repo'] });
  assert.equal(current.pendingKey, null, 'retirement/privacy hide ACK has published before old poll delivery');
  assert.equal(current.keys.has('/repo'), true, 'retirement/privacy acknowledged hide is still concealed');
  await r.body(oldVisible, { keys: [] }); await r.settled();
  assert.equal(current.keys.has('/repo'), true, 'old visible body cannot undo newer hide');

  await r.view.dispatch(r.view.window, new r.view.window.Event('focus'));
  assert.equal(current.keys, null, 'foreground refresh withholds accepted rows');
  assert.equal(current.error, false);
  assert.equal(r.view.container.querySelector('[role="switch"]') === null, true);
  await r.reply(r.latest('/api/hidden-projects'), { keys: [17] }, 200); await r.settled();
  assert.equal(current.keys === null, true, 'retirement/privacy invalid GET [17] stays withheld');
  assert.equal(current.keys, null); assert.equal(current.error, true);
  assert.equal(r.view.container.querySelector('[role="switch"]') === null, true);
  await click(r.view, button(r.view, 'Retry'));
  await r.reply(r.latest('/api/hidden-projects'), { keys: ['/repo'] }); await r.settled();
  assert.equal(current.keys.has('/repo'), true);

  await click(r.view, r.view.container.querySelector('[role="switch"]'));
  const unhide = r.latest('/api/hidden-projects', 'POST');
  assert.deepEqual(JSON.parse(unhide.options.body), { key: '/repo', hidden: false });
  assert.equal(current.keys.has('/repo'), true, 'no optimistic reveal before malformed ACK');
  await r.reply(unhide, { keys: null }, 200); await r.settled();
  assert.equal(current.keys === null, true, 'retirement/privacy invalid unhide ACK null stays withheld');
  assert.equal(current.keys, null); assert.equal(current.error, true); assert.equal(current.pendingKey, null);
  assert.equal(r.view.container.querySelector('[role="switch"]') === null, true);
  await click(r.view, button(r.view, 'Retry'));
  await r.reply(r.latest('/api/hidden-projects'), { keys: ['/repo'] }); await r.settled();
  assert.equal(current.keys.has('/repo'), true, 'explicit read recovers still-hidden server snapshot');
});
