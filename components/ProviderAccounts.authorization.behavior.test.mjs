import "../lib/testing/client-native-boundary.fixture.mjs";
// UNEXECUTED. Synthetic account metadata/codes only; never opens auth files.
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement as h } from 'react';
import { lowerFixture } from './lower-account-controls.fixture.mjs';

const provider = 'fixture-oauth';
const secondary = { id: 'synthetic-secondary', provider, label: 'Synthetic secondary', type: 'oauth', authorized: false };
async function accounts(t, overrides = {}) {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const data = { accounts: [secondary], project: {}, session: {} };
  const callbacks = [], refreshed = [];
  const props = { cwd: '/synthetic/project', sessionId: 'synthetic-session', provider, busy: false,
    async onSessionChange(...args) { callbacks.push(args); }, async onAccountsChanged() { refreshed.push('original'); }, ...overrides };
  f.route('GET', '/api/auth/accounts/selection', { query: () => ({ cwd: props.cwd, ...(props.sessionId ? { sessionId: props.sessionId } : {}) }), reply: () => ({ data }) });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [{ id: provider }, { id: 'other' }], apiKeyProviders: [{ id: provider }] } } });
  await x.mount(h(c.ProviderAccounts, props));
  const trigger = x.node('button[aria-controls]');
  await f.click(trigger);
  return { ...x, data, props, callbacks, refreshed, trigger };
}
const login = `/api/auth/login/${provider}`;

test('accounts: required default/secondary sources, retained device progress, safe links, cancel and ignored-close delivery', async t => {
  const x = await accounts(t), { f } = x;
  x.allowSource(login); await f.click(x.button('Change login'));
  assert.deepEqual(x.sources.map(s => s.url), [login]);
  await f.click(x.button('Cancel'));
  assert.equal(x.sources[0].readyState, 2);
  x.allowSource(`${login}?accountId=synthetic-secondary`); await f.click(x.button('Retry login'));
  const source = x.sources[1];
  await x.event(source, { type: 'device_code', verificationUri: 'https://example.invalid/device', userCode: 'FAKE-ONLY-42', expiresInSeconds: 120 });
  const code = x.node('code');
  assert.equal(code.textContent, 'FAKE-ONLY-42');
  assert.equal(x.node('a').getAttribute('href'), 'https://example.invalid/device');
  assert.equal(x.node('a').getAttribute('rel'), 'noopener noreferrer');
  await f.click(x.button('Copy code'));
  assert.deepEqual(x.copies, ['FAKE-ONLY-42']); assert.equal(x.button('Copied').textContent, 'Copied');
  await x.event(source, { type: 'progress', message: 'Synthetic waiting' });
  assert.equal(x.node('code') === code, true, 'progress retains actual device component');
  await f.view.dispatch(x.node('[role="region"]'), new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.view.window.document.querySelector('[role="region"]') === null, true);
  assert.equal(source.readyState === 2, false, 'popover closure retains pending authorization');
  await f.click(x.trigger); assert.equal(x.node('code').textContent, 'FAKE-ONLY-42');
  await f.click(x.button('Cancel'));
  await x.event(source, { type: 'device_code', verificationUri: 'https://example.invalid/old', userCode: 'OBSOLETE' });
  assert.equal(f.view.window.document.querySelector('code') === null, true);
  assert.equal(x.writes().length, 0);
  assert.deepEqual(x.popups, []);
  assert.equal(x.sources.length, 2);
});

for (const kind of ['device_code', 'auth']) test(`accounts: ${kind} rejects unsafe URL without popup, and error finally unlocks controls`, async t => {
  const x = await accounts(t), { f } = x;
  x.allowSource(`${login}?accountId=synthetic-secondary`); await f.click(x.button('Retry login'));
  await x.event(x.sources[0], { type: kind, url: 'javascript:alert(1)', verificationUri: 'javascript:alert(1)', userCode: 'FAKE' });
  assert.match(x.node('[role="alert"]').textContent, /Invalid authorization URL/);
  assert.equal(x.sources[0].readyState, 2); assert.deepEqual(x.popups, []);
  assert.equal(f.view.window.document.querySelector('a') === null, true);
  assert.equal(x.button('Retry login').disabled, false);
  assert.equal(x.node('[aria-label="Account provider"]').disabled, false);
  assert.equal(x.writes().length, 0);
});

test('accounts: blocked popup keeps safe fallback; manual POST uses captured provider/token, body catch unlocks; unmount closes source', async t => {
  const x = await accounts(t), { f } = x;
  f.route('POST', login, { body: { token: 'FAKE-TOKEN', code: 'FAKE-CODE' }, reply: { status: 503, data: { error: 'synthetic manual refusal' } } });
  x.allowSource(`${login}?accountId=synthetic-secondary`); await f.click(x.button('Retry login'));
  await x.event(x.sources[0], { type: 'auth', url: 'https://example.invalid/authorize', instructions: 'Synthetic authorize' });
  assert.deepEqual(x.popups, ['https://example.invalid/authorize']);
  assert.equal(x.node('a').getAttribute('href'), x.popups[0]);
  await x.event(x.sources[0], { type: 'prompt_request', token: 'FAKE-TOKEN', message: 'Synthetic code' });
  assert.equal(x.node('[aria-label="Account provider"]').disabled, true);
  assert.equal(x.button('Submit').disabled, true);
  await f.input(x.node('[aria-label="Authorization code"]'), '  FAKE-CODE  ');
  await f.click(x.button('Submit'));
  assert.equal(x.writes(login).length, 1); x.assertWrite(login, 0, { token: 'FAKE-TOKEN', code: 'FAKE-CODE' });
  assert.match(x.node('[role="alert"]').textContent, /synthetic manual refusal/);
  await f.click(x.button('Cancel'));
  assert.equal(x.node('[aria-label="Account provider"]').disabled, false);
  x.allowSource(login); await f.click(x.button('Change login'));
  await f.view.unmount(); assert.equal(x.sources[1].readyState, 2);
  await x.event(x.sources[1], { type: 'success' });
  assert.equal(x.refreshed.length, 0, 'outgoing source cannot refresh after unmount');
  assert.equal(x.sources.length, 2);
});

test('accounts: add form Escape/reopen/provider reset, required fake-key create/save and current callback completion', async t => {
  const x = await accounts(t), { f, graph: c } = x;
  await f.click(x.button('Add account')); await f.input(x.node('[aria-label="Account label"]'), 'discarded');
  await f.view.dispatch(x.node('[aria-label="Account label"]'), new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.click(x.trigger);
  assert.equal(f.view.window.document.querySelector('[aria-label="Account label"]') === null, true);
  await f.click(x.button('Add account'));
  await f.input(x.node('[aria-label="Account provider"]'), 'other');
  assert.equal(f.view.window.document.querySelector('[aria-label="Account label"]') === null, true);
  await f.input(x.node('[aria-label="Account provider"]'), provider);
  await f.click(x.button('Add account'));
  assert.equal(x.button('Authorize account').disabled, true);
  await f.input(x.node('[aria-label="Account label"]'), 'Synthetic key account');
  await f.input(x.node('[aria-label="Account type"]'), 'api_key');
  await f.input(x.node('[aria-label="API key for new account"]'), 'EXPLICIT-FAKE-KEY-NOT-A-CREDENTIAL');
  f.route('POST', '/api/auth/accounts', { body: { provider, label: 'Synthetic key account', type: 'api_key' }, reply: { data: { account: { ...secondary, id: 'synthetic-created', type: 'api_key' } } } });
  f.route('POST', '/api/auth/accounts/synthetic-created/api-key', { body: { apiKey: 'EXPLICIT-FAKE-KEY-NOT-A-CREDENTIAL' }, reply: { data: {} } });
  await f.rerender(h(c.ProviderAccounts, { ...x.props, async onAccountsChanged() { x.refreshed.push('current'); } }));
  await f.click(x.button('Authorize account'));
  assert.equal(x.writes().length, 2);
  x.assertWrite('/api/auth/accounts', 0, { provider, label: 'Synthetic key account', type: 'api_key' });
  x.assertWrite('/api/auth/accounts/synthetic-created/api-key', 0, { apiKey: 'EXPLICIT-FAKE-KEY-NOT-A-CREDENTIAL' });
  assert.deepEqual(x.refreshed, ['current']);
  assert.equal(f.view.window.document.querySelector('[aria-label="API key for new account"]') === null, true);
  assert.equal(x.button('Add account').disabled, false);
  assert.equal(x.sources.length, 0);
});

test('accounts: exact project PUT/null reset is separate from current session callback and pending finally', async t => {
  const x = await accounts(t), { f, graph: c } = x;
  x.data.accounts = [{ ...secondary, authorized: true }];
  // Real reload via successful authorization; no copied account-selection owner.
  x.allowSource(login); await f.click(x.button('Change login')); await x.event(x.sources[0], { type: 'success' }); await f.commit();
  const gate = f.gate('project default body'); let value = 'synthetic-secondary';
  f.route('PUT', '/api/auth/accounts/selection', { body: () => ({ scope: 'project', cwd: x.props.cwd, provider, accountId: value || null }), reply: () => ({ gate, data: { project: value ? { [provider]: value } : {} } }) });
  await f.input(x.node('[aria-label="Project account default"]'), value, { settle: false });
  assert.equal(x.node('[aria-label="Project account default"]').disabled, true);
  assert.equal(x.writes('/api/auth/accounts/selection').length, 1);
  await f.deliver(gate);
  assert.equal(x.node('[aria-label="Session account"]').value, '', 'existing session does not follow later project default');
  value = ''; await f.input(x.node('[aria-label="Project account default"]'), value);
  assert.equal(x.writes('/api/auth/accounts/selection').length, 2);
  x.assertWrite('/api/auth/accounts/selection', 0, { scope: 'project', cwd: x.props.cwd, provider, accountId: 'synthetic-secondary' }, 'PUT');
  x.assertWrite('/api/auth/accounts/selection', 1, { scope: 'project', cwd: x.props.cwd, provider, accountId: null }, 'PUT');
  const calls = [];
  await f.rerender(h(c.ProviderAccounts, { ...x.props, async onSessionChange(...args) { calls.push(args); throw new Error('synthetic switch refusal'); } }));
  await f.input(x.node('[aria-label="Session account"]'), 'synthetic-secondary');
  assert.deepEqual(calls, [[provider, 'synthetic-secondary', { [provider]: 'synthetic-secondary' }]]);
  assert.match(x.node('[role="alert"]').textContent, /synthetic switch refusal/);
  assert.equal(x.node('[aria-label="Session account"]').disabled, false);
  assert.equal(x.node('[aria-label="Session account"]').value, '');
  assert.equal(x.writes().length, 2, 'leaf session callback is NOT claimed as actual session PUT');
});

test('accounts: required usage queries distinguish null/secondary; compact chip excludes resets and banked details', async t => {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const p = 'openai-codex', id = 'synthetic-codex';
  const props = { cwd: '/synthetic/usage', sessionId: 'usage-session', provider: p, busy: false, async onSessionChange() {}, async onAccountsChanged() {} };
  f.route('GET', '/api/auth/accounts/selection', { query: { cwd: props.cwd, sessionId: props.sessionId }, reply: { data: { accounts: [{ id, provider: p, label: 'Synthetic Codex', type: 'oauth', authorized: true }], session: {}, project: {} } } });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [{ id: p }], apiKeyProviders: [] } } });
  let expectedUsageId = null;
  f.route('POST', '/api/provider-usage/query', { body: () => ({ providerId: p, accountId: expectedUsageId }), reply: request => ({ data: { providerId: p, status: 'ready', report: { providerId: p, capturedAt: 1800000000000, metrics: [], bankedResets: request.body.accountId ? 0 : 2, buckets: [
    { id: 'primary', label: '5h', windowMinutes: 300, remaining: request.body.accountId ? 50 : 90, unit: 'percent', resetsAt: 1800000000 },
    { id: 'secondary', label: 'Weekly', windowMinutes: 10080, remaining: request.body.accountId ? 25 : 70, unit: 'percent', resetsAt: 1800086400 },
  ] } } }) });
  // REQUIRED counts/serialized bodies below, not only request validators.
  await x.mount(h(c.ProviderAccounts, props)); await f.commit();
  const trigger = x.node('button[aria-controls]'); expectedUsageId = id; await f.click(trigger); await f.commit();
  const writes = x.writes('/api/provider-usage/query');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(r => r.body.accountId).sort((a, b) => String(a).localeCompare(String(b))), [null, id]);
  for (const request of writes) assert.equal(request.serializedBody, JSON.stringify({ providerId: p, accountId: request.body.accountId }));
  assert.match(x.text(), /Weekly 70% remaining/); assert.match(x.text(), /Weekly 25% remaining/);
  assert.match(x.text(), /5h 90% remaining/); assert.match(x.text(), /5h 50% remaining/);
  assert.match(trigger.textContent, /W 70%/);
  assert.doesNotMatch(trigger.getAttribute('aria-label'), /resets|banked/);
  assert.equal(x.sources.length, 0);
});

// Original browser vectors, not credentials or native authorization. The existing
// lowerFixture installs collectors/transport fences before loading production and
// registers gate release, complete-work/descendant joins and restoration first.
const originalCwd = '/synthetic/original-account-project';
const originalSession = 'e2e-rich-session';
const originalProvider = 'github-copilot';
const originalAccountId = 'e2e-original-device';
const originalLogin = '/api/auth/login/github-copilot';
const originalSecondaryLogin = '/api/auth/login/github-copilot?accountId=e2e-original-device';

function assertOriginalReads(f, cwd, sessionId) {
  const reads = f.requests.filter(r => r.path === '/api/auth/accounts/selection');
  assert.ok(reads.length > 0, 'required actual selection read, not a dormant route declaration');
  for (const read of reads) {
    assert.equal(read.method, 'GET');
    assert.deepEqual(read.query, [['cwd', cwd], ['sessionId', sessionId]]);
    assert.equal(read.body, undefined);
  }
}

async function originalAccountControl(t) {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const sessionChanges = [], refreshed = [];
  const props = { cwd: originalCwd, sessionId: originalSession, provider: 'fixture-oauth', busy: false,
    async onSessionChange(...args) { sessionChanges.push(args); },
    async onAccountsChanged() { refreshed.push('original'); } };
  f.route('GET', '/api/auth/accounts/selection', { query: { cwd: originalCwd, sessionId: originalSession }, reply: { data: {
    accounts: [{ id: originalAccountId, provider: originalProvider, label: 'E2E device 1280', type: 'oauth', authorized: false }], project: {}, session: {},
  } } });
  f.route('GET', '/api/auth/providers', { reply: { data: {
    oauthProviders: [{ id: 'fixture-oauth' }, { id: originalProvider }], apiKeyProviders: [{ id: originalProvider }],
  } } });
  await x.mount(h(c.ProviderAccounts, props));
  const trigger = x.node('button[aria-controls]');
  await f.click(trigger);
  await f.input(x.node('[aria-label="Account provider"]'), originalProvider);
  assertOriginalReads(f, originalCwd, originalSession);
  assert.match(trigger.getAttribute('aria-label'), /Pi default/);
  return { ...x, props, trigger, sessionChanges, refreshed };
}

test('original account Close-add-form click: same-incarnation label/key reset on reopen, then fresh keyed incarnation', async t => {
  const x = await originalAccountControl(t), { f, graph: c } = x;
  const panelId = x.trigger.getAttribute('aria-controls');
  assert.equal(f.view.window.document.querySelector('[aria-label="Account label"]') === null, true);
  await f.click(x.button('Add account'));
  await f.input(x.node('[aria-label="Account label"]'), 'Discarded original close-form label');
  await f.input(x.node('[aria-label="Account type"]'), 'api_key');
  await f.input(x.node('[aria-label="API key for new account"]'), 'EXPLICIT-FAKE-CLOSE-DRAFT-NOT-A-CREDENTIAL');
  await f.click(x.button('Close add form'));
  assert.equal(f.view.window.document.querySelector('[aria-label="Account label"]') === null, true);
  assert.equal(f.view.window.document.querySelector('[aria-label="API key for new account"]') === null, true);
  assert.equal(x.button('Add account').getAttribute('aria-expanded'), 'false');
  await f.click(x.button('Add account'));
  assert.equal(x.node('[aria-label="Account label"]').value, '');
  assert.equal(x.node('[aria-label="API key for new account"]').value, '');
  assert.equal(x.node('[aria-label="Account type"]').value, 'api_key', 'same-incarnation type is intentionally NOT reset by production');
  assert.equal(x.button('Authorize account').disabled, true);
  assert.equal(x.node('button[aria-controls]') === x.trigger, true);
  assert.equal(x.trigger.getAttribute('aria-controls'), panelId);
  assert.equal(x.node('[aria-label="Account provider"]').value, originalProvider);
  assert.deepEqual(x.sessionChanges, []); assert.deepEqual(x.refreshed, []);
  assert.equal(x.writes().length, 0); assert.equal(x.sources.length, 0);

  await f.rerender(h(c.ProviderAccounts, { ...x.props, key: 'fresh-original-account-incarnation' }));
  await f.commit();
  const nextTrigger = x.node('button[aria-controls]');
  assert.equal(nextTrigger === x.trigger, false, 'actual React replacement, not equal markup');
  assert.notEqual(nextTrigger.getAttribute('aria-controls'), panelId);
  await f.click(nextTrigger);
  await f.input(x.node('[aria-label="Account provider"]'), originalProvider);
  assert.equal(f.view.window.document.querySelector('[aria-label="Account label"]') === null, true);
  await f.click(x.button('Add account'));
  assert.equal(x.node('[aria-label="Account label"]').value, '');
  assert.equal(x.node('[aria-label="Account type"]').value, 'oauth', 'fresh incarnation owns initial type');
  assertOriginalReads(f, originalCwd, originalSession);
  assert.equal(x.writes().length, 0); f.check();
});

for (const currentProvider of ['fixture-oauth', 'openai-codex']) test(`original Codex quota rows and next-expiry: managed/current provider ${currentProvider}; joined authorized descendant`, async t => {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const p = 'openai-codex', id = 'e2e-codex-secondary', refreshed = [], sessionChanges = [];
  const props = { cwd: originalCwd, sessionId: originalSession, provider: currentProvider, busy: false,
    async onSessionChange(...args) { sessionChanges.push(args); }, async onAccountsChanged() { refreshed.push('original'); } };
  f.route('GET', '/api/auth/accounts/selection', { query: { cwd: originalCwd, sessionId: originalSession }, reply: { data: {
    accounts: [{ id, provider: p, label: 'Second Codex', type: 'oauth', authorized: true }], project: {}, session: {},
  } } });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [{ id: p }, { id: 'fixture-oauth' }], apiKeyProviders: [] } } });
  const expectedBodies = [{ providerId: p, accountId: null }, { providerId: p, accountId: id }];
  const descendantBody = f.gate('original quota forced descendant body after authorization');
  let holdDescendant = false;
  f.route('POST', '/api/provider-usage/query', { body: () => {
    const expected = expectedBodies.shift(); assert.ok(expected, 'no extra usage mutation/read admission'); return expected;
  }, reply: request => {
    const secondary = request.body.accountId === id;
    return { ...(holdDescendant && !secondary ? { gate: descendantBody } : {}), data: { providerId: p, status: 'ready', report: {
      providerId: p, capturedAt: Date.now(), metrics: [], bankedResets: secondary ? 0 : 2,
      bankedResetExpiresAt: secondary ? undefined : 1_800_172_800,
      buckets: [
        { id: 'primary', label: '5h', windowMinutes: 300, remaining: secondary ? 50 : 90, unit: 'percent', resetsAt: 1_800_000_000 },
        { id: 'secondary', label: 'Weekly', windowMinutes: 10080, remaining: secondary ? 25 : 70, unit: 'percent', resetsAt: 1_800_086_400 },
      ],
    } } };
  } });
  await x.mount(h(c.ProviderAccounts, props));
  const trigger = x.node('button[aria-controls]');
  await f.click(trigger);
  if (currentProvider !== p) await f.input(x.node('[aria-label="Account provider"]'), p);
  const accountRows = x.node('[aria-label="openai-codex accounts"]');
  const usageRows = [...accountRows.querySelectorAll('span.w-full.text-text-dim')].map(n => n.textContent);
  assert.equal(usageRows.length, 2);
  assert.match(usageRows[0], /^Weekly 70% remaining \(resets .+\) · 5h 90% remaining \(resets .+\) · 2 banked resets available \(next expires .+\)$/);
  assert.match(usageRows[1], /^Weekly 25% remaining \(resets .+\) · 5h 50% remaining \(resets .+\) · 0 banked resets available$/);
  assert.doesNotMatch(usageRows[1], /next expires/);
  assert.doesNotMatch(trigger.getAttribute('aria-label'), /resets|banked/i);
  if (currentProvider === p) assert.match(trigger.textContent, /W 70%/);
  else assert.match(trigger.getAttribute('aria-label'), /Pi default/);
  const initialQueries = x.writes('/api/provider-usage/query');
  assert.equal(initialQueries.length, 2);
  assert.deepEqual(initialQueries.map(r => r.body), [{ providerId: p, accountId: null }, { providerId: p, accountId: id }]);
  for (let i = 0; i < initialQueries.length; i++) x.assertWrite('/api/provider-usage/query', i, initialQueries[i].body);
  assertOriginalReads(f, originalCwd, originalSession);

  // Capture current public callback BEFORE creating this source. Do not invent
  // a policy that replaces callbacks inside an already-created OAuth closure.
  await f.rerender(h(c.ProviderAccounts, { ...props, async onAccountsChanged() { refreshed.push('current'); } }));
  assert.equal(x.node('button[aria-controls]') === trigger, true, 'same component incarnation');
  x.allowSource('/api/auth/login/openai-codex');
  await f.click(x.button('Change login', accountRows.children[0]));
  assert.deepEqual(x.sources.map(source => source.url), ['/api/auth/login/openai-codex']);
  holdDescendant = true;
  expectedBodies.push({ providerId: p, accountId: null });
  // This exact continuation is admitted before the original success callback;
  // failed assertions/unmount cannot strand its separately observed child work.
  f.admitContinuation('POST', '/api/provider-usage/query', { providerId: p, accountId: null });
  await act(async () => {
    x.sources[0].onmessage({ data: JSON.stringify({ type: 'success' }) });
    await f.join('accounts.authorized');
  });
  f.check();
  assert.deepEqual(refreshed, ['current']); assert.deepEqual(sessionChanges, []);
  assert.equal(x.sources[0].readyState, 2);
  const authorized = f.works.filter(work => work.label === 'accounts.authorized');
  assert.ok(authorized.length > 0); assert.ok(authorized.every(work => work.settled));
  const unfinishedUsage = f.works.filter(work => work.label === 'accounts.usage' && !work.settled);
  assert.equal(unfinishedUsage.length, 1, 'parent result is not descendant body/catch/finally settlement');
  assert.equal(x.writes('/api/provider-usage/query').length, 3);
  x.assertWrite('/api/provider-usage/query', 2, { providerId: p, accountId: null });
  assert.equal(x.writes('/api/provider-usage/query')[2].gate === descendantBody, true);
  await f.deliver(descendantBody);
  assert.ok(f.works.every(work => work.settled));
  assert.equal(x.writes('/api/provider-usage/query').length, 3, 'no automatic replay or cross-account query');
  assert.equal(expectedBodies.length, 0);
  assertOriginalReads(f, originalCwd, originalSession); f.check();
});

test('original usage body rejection is caught by the real consumer and full usage finally settles after its named body gate', async t => {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const p = 'openai-codex';
  const bodyFailure = new Error('original synthetic usage body failure');
  const body = f.gate('original usage rejected JSON body');
  f.route('GET', '/api/auth/accounts/selection', { query: { cwd: originalCwd, sessionId: originalSession }, reply: { data: { accounts: [], project: {}, session: {} } } });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [{ id: p }], apiKeyProviders: [] } } });
  f.route('POST', '/api/provider-usage/query', { body: { providerId: p, accountId: null }, reply: { gate: body, bodyError: bodyFailure } });
  await x.mount(h(c.ProviderAccounts, { cwd: originalCwd, sessionId: originalSession, provider: p, busy: false,
    async onSessionChange() { assert.fail('usage cannot switch a session'); }, async onAccountsChanged() { assert.fail('usage cannot mutate account selection'); },
  }), { settle: false });
  // Join the named reload, not the deliberately held usage descendant.
  await f.commit(undefined, 'accounts.reload');
  await f.click(x.node('button[aria-controls]'), { settle: false });
  assert.equal(x.writes('/api/provider-usage/query').length, 1);
  x.assertWrite('/api/provider-usage/query', 0, { providerId: p, accountId: null });
  assert.equal(x.writes('/api/provider-usage/query')[0].gate === body, true);
  assert.equal(f.works.filter(work => work.label === 'accounts.usage' && !work.settled).length, 1);
  await f.deliver(body);
  assert.match(x.text(), /Usage unavailable/);
  assert.equal(f.works.filter(work => work.label === 'accounts.usage' && !work.settled).length, 0);
  assert.equal(x.writes('/api/provider-usage/query').length, 1);
  assertOriginalReads(f, originalCwd, originalSession); f.check();
});

test('original account OAuth literals: provider-wide/exact secondary source, javascript device denial, .com fallback, test-token cancel and source-incarnation fence', async t => {
  const x = await originalAccountControl(t), { f } = x;
  x.allowSource(originalLogin); await f.click(x.button('Change login'));
  assert.equal(x.sources[0].url, originalLogin);
  await f.click(x.button('Cancel')); assert.equal(x.sources[0].readyState, 2);

  x.allowSource(originalSecondaryLogin); await f.click(x.button('Retry login'));
  await x.event(x.sources[1], { type: 'device_code', verificationUri: 'javascript:alert(1)', userCode: 'unsafe' });
  assert.equal(x.node('[role="alert"]').textContent, 'Invalid authorization URL');
  assert.equal(x.sources[1].readyState, 2);
  assert.equal(f.view.window.document.querySelector('a') === null, true);
  assert.deepEqual(x.popups, []);
  assert.equal(x.node('[aria-label="Account provider"]').disabled, false);

  x.allowSource(originalSecondaryLogin); await f.click(x.button('Retry login'));
  const safeSource = x.sources[2];
  await x.event(safeSource, { type: 'auth', url: 'https://example.com/authorize', instructions: 'Finish in the provider browser' });
  assert.equal(x.node('a').getAttribute('href'), 'https://example.com/authorize');
  assert.equal(x.node('a').getAttribute('target'), '_blank');
  assert.equal(x.node('a').getAttribute('rel'), 'noopener noreferrer');
  assert.match(x.text(), /Finish in the provider browser/);
  assert.deepEqual(x.popups, ['https://example.com/authorize']);
  await f.click(x.button('Cancel')); assert.equal(safeSource.readyState, 2);
  assert.equal(f.view.window.document.querySelector('a') === null, true);

  x.allowSource(originalSecondaryLogin); await f.click(x.button('Retry login'));
  const promptSource = x.sources[3];
  assert.equal(promptSource === safeSource, false);
  assert.equal(promptSource.url, safeSource.url, 'same URL, different source incarnation');
  await x.event(safeSource, { type: 'progress', message: 'OBSOLETE safe-auth incarnation' });
  await x.error(safeSource);
  assert.doesNotMatch(x.text(), /OBSOLETE safe-auth incarnation|Authorization connection closed/);
  await x.event(promptSource, { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code' });
  assert.match(x.text(), /Paste the provider code/);
  assert.equal(x.node('[aria-label="Account provider"]').disabled, true);
  assert.equal(x.node('[aria-label="Authorization code"]').value, '');
  assert.equal(x.button('Submit').disabled, true);
  await f.input(x.node('[aria-label="Authorization code"]'), 'discard before original Cancel');
  await f.click(x.button('Cancel')); assert.equal(promptSource.readyState, 2);
  assert.equal(f.view.window.document.querySelector('[aria-label="Authorization code"]') === null, true);
  assert.equal(x.node('[aria-label="Account provider"]').disabled, false);

  x.allowSource(originalSecondaryLogin); await f.click(x.button('Retry login'));
  const replacement = x.sources[4];
  await x.event(replacement, { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code' });
  assert.equal(x.node('[aria-label="Authorization code"]').value, '', 'new source does not borrow cancelled manual text');
  await f.view.unmount(); assert.equal(replacement.readyState, 2);
  await x.event(replacement, { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code' });
  assert.equal(f.view.window.document.querySelector('[aria-label="Authorization code"]') === null, true);
  assert.deepEqual(x.sources.map(source => source.url), [originalLogin, originalSecondaryLogin, originalSecondaryLogin, originalSecondaryLogin, originalSecondaryLogin]);
  assert.equal(x.writes().length, 0); assert.deepEqual(x.refreshed, []); assert.deepEqual(x.sessionChanges, []);
  assertOriginalReads(f, originalCwd, originalSession); f.check();
});

test('original test-token manual POST owns the full non-2xx JSON body/catch, exact trimmed bytes and explicit cancellation', async t => {
  const x = await originalAccountControl(t), { f } = x;
  const body = f.gate('original manual 503 response JSON');
  f.route('POST', originalLogin, { body: { token: 'test-token', code: 'ORIGINAL-SYNTHETIC-CODE' }, reply: {
    gate: body, status: 503, data: { error: 'original synthetic manual refusal' },
  } });
  x.allowSource(originalSecondaryLogin); await f.click(x.button('Retry login'));
  await x.event(x.sources[0], { type: 'prompt_request', token: 'test-token', message: 'Paste the provider code' });
  await f.input(x.node('[aria-label="Authorization code"]'), '  ORIGINAL-SYNTHETIC-CODE  ');
  await f.click(x.button('Submit'), { settle: false });
  assert.equal(x.writes(originalLogin).length, 1);
  x.assertWrite(originalLogin, 0, { token: 'test-token', code: 'ORIGINAL-SYNTHETIC-CODE' });
  assert.equal(x.writes(originalLogin)[0].gate === body, true);
  assert.equal(f.works.filter(work => work.label === 'accounts.manual' && !work.settled).length, 1);
  assert.equal(f.view.window.document.querySelector('[role="alert"]') === null, true, 'headers/non-2xx status alone do not bypass the original JSON join');
  await f.deliver(body);
  assert.equal(x.node('[role="alert"]').textContent, 'original synthetic manual refusal');
  assert.equal(f.works.filter(work => work.label === 'accounts.manual').length, 1);
  assert.equal(f.works.filter(work => work.label === 'accounts.manual' && !work.settled).length, 0);
  assert.equal(x.node('[aria-label="Authorization code"]').value, '  ORIGINAL-SYNTHETIC-CODE  ');
  assert.equal(x.node('[aria-label="Account provider"]').disabled, true, 'OAuth stays pending until explicit cancellation');
  await f.click(x.button('Cancel'));
  assert.equal(x.sources[0].readyState, 2);
  assert.equal(x.node('[aria-label="Account provider"]').disabled, false);
  assert.equal(f.view.window.document.querySelector('[aria-label="Authorization code"]') === null, true);
  assert.equal(x.writes(originalLogin).length, 1, 'no retry/replay on caught error');
  assert.deepEqual(x.refreshed, []); assert.deepEqual(x.sessionChanges, []);
  assertOriginalReads(f, originalCwd, originalSession); f.check();
});
