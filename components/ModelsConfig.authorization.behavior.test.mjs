import "../lib/testing/client-native-boundary.fixture.mjs";
// UNEXECUTED actual ModelsConfig -> OAuthDetail -> DeviceAuthorization composition.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { lowerFixture } from './lower-account-controls.fixture.mjs';

async function models(t) {
  const x = await lowerFixture(t), { f, graph: c } = x;
  f.route('GET', '/api/models-config', { reply: { data: { providers: {} } } });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [{ id: 'fixture-oauth', name: 'Synthetic Subscription', loggedIn: false, usesCallbackServer: false }], apiKeyProviders: [] } } });
  f.route('GET', '/api/models/enabled', { query: { cwd: '/synthetic/project' }, reply: { data: { allEnabled: true, patterns: [], stalePatterns: [], enabledTotal: 0, availableTotal: 0, providers: [], scope: 'global', editable: true, settingsPath: 'synthetic/settings.json' } } });
  await x.mount(h(c.ModelsConfig, { cwd: '/synthetic/project', embedded: true, onClose() {} }));
  await f.click(x.button('Add provider'));
  const choice = [...f.view.container.querySelectorAll('button')].find(n => n.textContent.includes('Synthetic Subscription'));
  assert.equal(Boolean(choice), true);
  await f.click(choice);
  return x;
}
const login = '/api/auth/login/fixture-oauth';

test('Models default OAuth: required provider-wide source, shared device/progress/copy failure recovery, cancel and safe fallback', async t => {
  const x = await models(t), { f } = x;
  x.allowSource(login); await f.click(x.button('Login'));
  assert.deepEqual(x.sources.map(s => s.url), [login], 'no secondary account query on default Models path');
  await x.event(x.sources[0], { type: 'device_code', verificationUri: 'https://example.invalid/device', userCode: 'FAKE-DEFAULT-42', expiresInSeconds: 120 });
  const code = x.node('code');
  await x.event(x.sources[0], { type: 'progress', message: 'Synthetic provider wait' });
  assert.equal(x.node('code') === code, true);
  assert.equal(code.textContent, 'FAKE-DEFAULT-42');
  assert.match(x.text(), /Synthetic provider wait/);
  x.rejectCopy(new Error('synthetic clipboard refused'));
  await f.click(x.button('Copy code'));
  assert.match(x.node('[role="alert"]').textContent, /Could not copy/);
  x.rejectCopy(null); await f.click(x.button('Copy code'));
  assert.deepEqual(x.copies, ['FAKE-DEFAULT-42', 'FAKE-DEFAULT-42']);
  assert.equal(f.view.container.querySelector('[role="alert"]') === null, true);
  await f.click(x.button('Cancel'));
  assert.equal(x.sources[0].readyState, 2);
  await x.event(x.sources[0], { type: 'success' });
  assert.equal(x.button('Login').disabled, false, 'cancelled old source cannot publish success');
  x.allowSource(login); await f.click(x.button('Login'));
  await x.event(x.sources[1], { type: 'auth', url: 'https://example.invalid/authorize', token: 'FAKE-DEFAULT-TOKEN' });
  const fallback = x.node('a');
  assert.equal(fallback.getAttribute('href'), 'https://example.invalid/authorize');
  assert.equal(fallback.getAttribute('rel'), 'noopener noreferrer');
  assert.deepEqual(x.popups, ['https://example.invalid/device', 'https://example.invalid/authorize']);
  await f.click(x.button('Cancel'));
  x.allowSource(login); await f.click(x.button('Login'));
  await x.event(x.sources[2], { type: 'auth', url: 'javascript:alert(1)' });
  assert.match(x.text(), /Invalid authorization URL/);
  assert.equal(f.view.container.querySelector('a') === null, true);
  assert.equal(x.sources[2].readyState, 2);
  assert.equal(x.writes().length, 0, 'no settings save or auth mutation manufactured by metadata/device input');
  assert.equal(x.sources.length, 3);
});

test('Models default OAuth: manual prompt POST trimmed exact body, operational failure and current unmount closes stream', async t => {
  const x = await models(t), { f } = x;
  const body = { token: 'FAKE-DEFAULT-TOKEN', code: 'FAKE-DEFAULT-CODE' };
  f.route('POST', login, { body, reply: { status: 409, data: { error: 'synthetic code refused' } } });
  x.allowSource(login); await f.click(x.button('Login'));
  await x.event(x.sources[0], { type: 'prompt_request', token: body.token, message: 'Synthetic prompt', placeholder: 'Synthetic default code' });
  assert.equal(x.button('Submit').disabled, true);
  await f.input(x.node('input[placeholder="Synthetic default code"]'), ' FAKE-DEFAULT-CODE ');
  await f.click(x.button('Submit'));
  assert.equal(x.writes(login).length, 1); x.assertWrite(login, 0, body);
  assert.match(x.text(), /synthetic code refused/);
  await f.view.unmount(); assert.equal(x.sources[0].readyState, 2);
});

test('original Models OAuth literals: exact provider-wide source, DEFAULT-42/progress/cancel, javascript denial and test-token full error body', async t => {
  // Same existing guarded fixture/real ModelsConfig -> OAuthDetail ->
  // DeviceAuthorization graph. No outer Settings/AppShell or auth authority.
  const x = await lowerFixture(t), { f, graph: c } = x;
  const cwd = '/synthetic/original-account-project';
  const originalLogin = '/api/auth/login/github-copilot';
  f.route('GET', '/api/models-config', { reply: { data: { providers: {} } } });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [
    { id: 'github-copilot', name: 'GitHub Copilot', loggedIn: false, usesCallbackServer: false },
  ], apiKeyProviders: [] } } });
  f.route('GET', '/api/models/enabled', { query: { cwd }, reply: { data: {
    allEnabled: true, patterns: [], stalePatterns: [], enabledTotal: 0, availableTotal: 0,
    providers: [], scope: 'global', editable: true, settingsPath: 'synthetic/original-settings.json',
  } } });
  const manualBody = f.gate('original Models test-token non-2xx JSON body');
  f.route('POST', originalLogin, { body: { token: 'test-token', code: 'ORIGINAL-SYNTHETIC-CODE' }, reply: {
    gate: manualBody, status: 503, data: { error: 'original synthetic Models manual refusal' },
  } });
  await x.mount(h(c.ModelsConfig, { cwd, embedded: true, onClose() {} }));
  await f.click(x.button('Add provider'));
  const choice = [...f.view.container.querySelectorAll('button')].find(node => node.textContent.includes('GitHub Copilot'));
  assert.equal(Boolean(choice), true);
  await f.click(choice);
  const enabledReads = f.requests.filter(request => request.path === '/api/models/enabled');
  assert.ok(enabledReads.length > 0);
  for (const request of enabledReads) assert.deepEqual(request.query, [['cwd', cwd]]);

  x.allowSource(originalLogin); await f.click(x.button('Login'));
  const deviceSource = x.sources[0];
  assert.equal(deviceSource.url, originalLogin, 'provider-wide default path has no secondary account query');
  await x.event(deviceSource, { type: 'device_code', verificationUri: 'https://github.com/login/device', userCode: 'DEFAULT-42', expiresInSeconds: 120 });
  const code = x.node('code');
  assert.equal(code.textContent, 'DEFAULT-42');
  assert.equal(x.node('a').getAttribute('href'), 'https://github.com/login/device');
  await f.click(x.button('Copy code'));
  assert.deepEqual(x.copies, ['DEFAULT-42']);
  await x.event(deviceSource, { type: 'progress', message: 'Waiting for provider' });
  assert.equal(x.node('code') === code, true);
  assert.match(x.text(), /Waiting for provider/);
  await f.click(x.button('Cancel')); assert.equal(deviceSource.readyState, 2);
  assert.equal(f.view.window.document.querySelector('code') === null, true);

  x.allowSource(originalLogin); await f.click(x.button('Login'));
  const invalidSource = x.sources[1];
  await x.event(invalidSource, { type: 'auth', url: 'javascript:alert(1)' });
  assert.match(x.text(), /Invalid authorization URL/);
  assert.equal(invalidSource.readyState, 2);
  assert.equal(f.view.window.document.querySelector('a') === null, true);
  assert.deepEqual(x.popups, ['https://github.com/login/device'], 'unsafe URL never reaches the controlled popup');

  x.allowSource(originalLogin); await f.click(x.button('Login'));
  const safeSource = x.sources[2];
  await x.event(safeSource, { type: 'auth', url: 'https://example.com/authorize', instructions: 'Finish in the provider browser' });
  assert.equal(x.node('a').getAttribute('href'), 'https://example.com/authorize');
  assert.equal(x.node('a').getAttribute('rel'), 'noopener noreferrer');
  assert.match(x.text(), /Finish in the provider browser/);
  assert.deepEqual(x.popups, ['https://github.com/login/device', 'https://example.com/authorize']);
  await f.click(x.button('Cancel')); assert.equal(safeSource.readyState, 2);

  x.allowSource(originalLogin); await f.click(x.button('Login'));
  const manualSource = x.sources[3];
  assert.equal(manualSource === safeSource, false, 'same URL is not the same source incarnation');
  await x.event(manualSource, { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code' });
  assert.match(x.text(), /Paste the provider code/);
  const cancelledSubmit = x.button('Submit');
  assert.equal(cancelledSubmit.disabled, true);
  await f.click(x.button('Cancel')); assert.equal(manualSource.readyState, 2);
  assert.equal(cancelledSubmit.isConnected, false, 'actual manual form was removed, not a vacuous placeholder selector');
  assert.equal(x.writes(originalLogin).length, 0, 'original cancelled prompt sends no manual POST');

  x.allowSource(originalLogin); await f.click(x.button('Login'));
  const retrySource = x.sources[4];
  await x.event(retrySource, { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code', placeholder: 'Original provider code' });
  await f.input(x.node('input[placeholder="Original provider code"]'), '  ORIGINAL-SYNTHETIC-CODE  ');
  const beforeWork = f.works.length;
  await f.click(x.button('Submit'), { settle: false });
  assert.equal(x.writes(originalLogin).length, 1);
  x.assertWrite(originalLogin, 0, { token: 'test-token', code: 'ORIGINAL-SYNTHETIC-CODE' });
  assert.equal(x.writes(originalLogin)[0].gate === manualBody, true);
  assert.ok(f.works.slice(beforeWork).some(work => !work.settled), 'real complete manual handler remains pending on the admitted body');
  assert.doesNotMatch(x.text(), /original synthetic Models manual refusal/);
  await f.deliver(manualBody);
  assert.match(x.text(), /original synthetic Models manual refusal/);
  assert.ok(f.works.every(work => work.settled));
  assert.equal(x.writes(originalLogin).length, 1, 'no automatic replay');
  assert.equal(x.button('Login').disabled, false, 'the real error phase offers Login, not an invented working Cancel');
  await f.view.unmount();
  assert.equal(retrySource.readyState, 2, 'the existing unmount path closes the original source');
  await x.event(retrySource, { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code' });
  assert.equal(f.view.window.document.querySelector('input[placeholder="Enter authorization code"]') === null, true);
  assert.deepEqual(x.sources.map(source => source.url), [originalLogin, originalLogin, originalLogin, originalLogin, originalLogin]);
  assert.equal(x.writes(originalLogin).length, 1); f.check();
});
