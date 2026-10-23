import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, exactQuery, exactHeaders, buttonWithText, click } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
async function production() {
  const { ArchivedSessionNotice } = await jiti.import('./ArchivedSessionNotice.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  return function renderArchive(props) {
    return createElement(I18nProvider, null, createElement(ArchivedSessionNotice, props));
  };
}

function transport(t, initialRoot) {
  let root = initialRoot;
  const http = controlledLeafFetch(t, request => {
    assert.equal(request.options.method, 'PATCH');
    exactHeaders(request, { 'Content-Type': 'application/json' });
    exactQuery(request, {});
    assert.deepEqual(Object.keys(request.options).sort(), ['body', 'headers', 'method']);
    assert.deepEqual(JSON.parse(request.options.body), { archived: false });
    assert.equal(request.url.pathname, `/api/sessions/${encodeURIComponent(root)}`, 'current click root route');
    // Response deliberately held; this component does not consume a JSON body.
  });
  return Object.assign(http, { expectRoot(next) { root = next; } });
}

test('restore uses the currently rendered root/callback, disables repeated submission, then commits retry-ready UI', async t => {
  const http = transport(t, 'root/new'), restored = [];
  const render = await production();
  const obsolete = () => http.check(() => assert.fail('obsolete callback used'));
  const current = id => http.check(() => { assert.equal(id, 'root/new'); restored.push(id); });
  const view = http.bind(await mount(t, render({ rootSessionId: null, busy: false, onRestored: obsolete }), { setup: http.setup }));
  assert.equal(view.container.childNodes.length, 0);
  await view.rerender(render({ rootSessionId: 'old', busy: true, onRestored: obsolete }));
  const disabled = buttonWithText(view.container, 'Restore session');
  assert.equal(disabled.disabled, true);
  await click(view, disabled);
  assert.equal(http.requests.length, 0);

  await view.rerender(render({ rootSessionId: 'root/new', busy: false, onRestored: current }));
  await click(view, buttonWithText(view.container, 'Restore session'));
  assert.equal(http.requests.length, 1);
  assert.equal(http.requests[0].url.pathname, '/api/sessions/root%2Fnew');
  const pending = buttonWithText(view.container, 'Restoring…');
  assert.equal(pending.disabled, true);
  await click(view, pending);
  assert.equal(http.requests.length, 1, 'disabled mounted control cannot submit a second PATCH');
  assert.deepEqual(restored, []);
  await http.reply(http.requests[0]);
  assert.deepEqual(restored, ['root/new']);
  assert.equal(buttonWithText(view.container, 'Restore session').disabled, false, 'finally has committed');
  assert.equal(http.requests[0].jsonCalls, 0);
  http.assertHealthy();
});

test('failed PATCH never reports restoration, exposes retry, and retry uses current props', async t => {
  const http = transport(t, 'old'), restored = [];
  const render = await production();
  const old = id => http.check(() => { assert.equal(id, 'old'); restored.push(['old', id]); });
  const view = http.bind(await mount(t, render({ rootSessionId: 'old', busy: false, onRestored: old }), { setup: http.setup }));
  await click(view, buttonWithText(view.container, 'Restore session'));
  await http.reply(http.requests[0], {}, 503);
  assert.deepEqual(restored, []);
  assert.ok(view.container.textContent.includes('Could not restore the session. Try again.'));
  assert.equal(buttonWithText(view.container, 'Restore session').disabled, false);
  const current = id => http.check(() => { assert.equal(id, 'new'); restored.push(['new', id]); });
  await view.rerender(render({ rootSessionId: 'new', busy: false, onRestored: current }));
  http.expectRoot('new');
  await click(view, buttonWithText(view.container, 'Restore session'));
  assert.equal(http.requests[1].url.pathname, '/api/sessions/new');
  assert.ok(!view.container.textContent.includes('Could not restore the session. Try again.'));
  await http.reply(http.requests[1]);
  assert.deepEqual(restored, [['new', 'new']]);
  assert.equal(buttonWithText(view.container, 'Restore session').disabled, false);
});

test('restore callback completion is observed after unmount through an owned port release, not cancellation', async t => {
  const http = transport(t, 'owned'), restored = [];
  const render = await production();
  const view = http.bind(await mount(t, render({ rootSessionId: 'owned', busy: false,
    onRestored: id => http.check(() => { assert.equal(id, 'owned'); restored.push(id); }) }), { setup: http.setup }));
  await click(view, buttonWithText(view.container, 'Restore session'));
  await view.unmount();
  assert.deepEqual(restored, []);
  // Existing behavior: unmount is not cancellation of the admitted PATCH/callback.
  await http.reply(http.requests[0]);
  assert.deepEqual(restored, ['owned']);
  assert.equal(view.container.childNodes.length, 0);
  http.assertHealthy();
});
