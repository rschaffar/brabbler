import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, buttonWithText, click } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const { ArchivedSessionNotice } = await jiti.import('./ArchivedSessionNotice.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
const render = props => createElement(I18nProvider, null, createElement(ArchivedSessionNotice, props));

function transport(t) {
  return controlledLeafFetch(t, request => {
    assert.equal(request.options.method, 'PATCH');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(request.options.body), { archived: false });
    assert.match(request.url.pathname, /^\/api\/sessions\//);
    // Response deliberately held; this component does not consume a JSON body.
  });
}

test('restore uses the currently rendered root/callback, disables repeated submission, then settles', async t => {
  const http = transport(t), restored = [];
  const obsolete = () => http.check(() => assert.fail('obsolete callback used'));
  const current = id => http.check(() => { assert.equal(id, 'root/new'); restored.push(id); });
  const view = http.bind(await mount(t, render({ rootSessionId: null, busy: false, onRestored: obsolete })));
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
  const http = transport(t), restored = [];
  const old = id => http.check(() => { assert.equal(id, 'old'); restored.push(['old', id]); });
  const view = http.bind(await mount(t, render({ rootSessionId: 'old', busy: false, onRestored: old })));
  await click(view, buttonWithText(view.container, 'Restore session'));
  await http.reply(http.requests[0], {}, 503);
  assert.deepEqual(restored, []);
  assert.ok(view.container.textContent.includes('Could not restore the session. Try again.'));
  assert.equal(buttonWithText(view.container, 'Restore session').disabled, false);
  const current = id => http.check(() => { assert.equal(id, 'new'); restored.push(['new', id]); });
  await view.rerender(render({ rootSessionId: 'new', busy: false, onRestored: current }));
  await click(view, buttonWithText(view.container, 'Restore session'));
  assert.equal(http.requests[1].url.pathname, '/api/sessions/new');
  assert.ok(!view.container.textContent.includes('Could not restore the session. Try again.'));
  await http.reply(http.requests[1]);
  assert.deepEqual(restored, [['new', 'new']]);
  assert.equal(buttonWithText(view.container, 'Restore session').disabled, false);
});

test('an admitted restore is joined after unmount, without using DOM disposal as cancellation', async t => {
  const http = transport(t), restored = [];
  const view = http.bind(await mount(t, render({ rootSessionId: 'owned', busy: false,
    onRestored: id => http.check(() => { assert.equal(id, 'owned'); restored.push(id); }) })));
  await click(view, buttonWithText(view.container, 'Restore session'));
  await view.unmount();
  assert.deepEqual(restored, []);
  // Existing behavior: unmount is not cancellation of the admitted PATCH/callback.
  await http.reply(http.requests[0]);
  assert.deepEqual(restored, ['owned']);
  assert.equal(view.container.childNodes.length, 0);
  http.assertHealthy();
});
