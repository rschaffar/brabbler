import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { browserClientFixture, exactHeaders } from './browser-client.fixture.mjs';
import { deferred } from './testing/async.fixture.mjs';

export const notifyKey = 'brabbler:ssh-local-notifications:v1';
export const connectionView = { id: 'owned-connection', keyId: 'key', device: 'Fixture', origin: 'https://fixture.invalid', role: 'active', state: 'strict', remainingMs: 0, pendingCount: 1 };
export const signingRequest = { id: 'request', challenge: 'BA', fingerprint: 'untrusted fingerprint', description: 'untrusted description', expiresAt: 0, remainingMs: 60000, userVerification: 'required', unlock: false, previousSigner: false };
export function sshStatus(connected = false) {
  return {
    supported: true,
    runtime: { runtimeId: 'runtime', socketPath: '/private/synthetic.sock', inheritedSocket: null, revision: 'revision', setupNeeded: true, selected: { type: 'none' }, custom: [], settingsError: null, endpointPresent: true },
    registry: { revision: 'registry', keys: [] }, connections: connected ? [{ ...connectionView }] : [], activeId: connected ? connectionView.id : null, pendingCount: connected ? 1 : 0,
  };
}

export async function sshNotificationFixture(t, { stored = null, permission = 'granted', permissionHeld = false, publicMetadata = false, notificationFailure = false } = {}) {
  const lifetime = browserClientFixture(t);
  let now = 100, timerId = 0, current, view, focus = 0, prompts = 0, assertions = 0, deliveries = 0;
  let nextPollHeld = false, nextRequests = [], snapshotStatus = sshStatus(true), connectionAdmission = false;
  const timers = new Map(), notices = [], polls = [];
  const permissionGate = lifetime.gate('denied');
  if (!permissionHeld) permissionGate.resolve('denied');
  function timer(callback, delay, interval) {
    const id = ++timerId; timers.set(id, { callback, at: now + delay, delay, interval }); return id;
  }
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  const domCallbacks = new Map();
  lifetime.replace(globalThis, 'setTimeout', (fn, delay = 0, ...args) => {
    // All client policy delays are positive. jsdom schedules Storage events at
    // zero: preserve and own those actual callbacks, never drive them as policy.
    if (delay !== 0) return timer(fn, delay, false);
    const done = deferred();
    const handle = realSetTimeout(function (...values) {
      domCallbacks.delete(handle);
      try { Reflect.apply(fn, this, values); done.resolve(); }
      catch (error) { done.reject(error); throw error; }
    }, 0, ...args);
    domCallbacks.set(handle, done);
    lifetime.observePort('DOM zero-delay callback', done.promise);
    return handle;
  });
  lifetime.replace(globalThis, 'clearTimeout', id => {
    if (typeof id === 'number') { timers.delete(id); return; }
    const done = domCallbacks.get(id);
    domCallbacks.delete(id);
    realClearTimeout(id);
    done?.resolve();
  });
  lifetime.replace(globalThis, 'setInterval', (fn, delay) => timer(fn, delay, true));
  lifetime.replace(globalThis, 'clearInterval', id => timers.delete(id));
  lifetime.replace(globalThis.performance, 'now', () => now);
  class Notice {
    static permission = permission;
    static requestPermission() { prompts++; return permissionGate.promise; }
    constructor(title, options) {
      deliveries++;
      // Named external-API failure, not an unexpected fixture defect. The real
      // notification adapter owns its unavailable result; no console exemption.
      if (notificationFailure) throw new Error('controlled Notification constructor unavailable');
      lifetime.checked(() => {
        assert.equal(Notice.permission, 'granted');
        assert.equal(typeof title, 'string'); assert.equal(typeof options.body, 'string');
        assert.equal(title.includes(signingRequest.fingerprint) || options.body.includes(signingRequest.description), false, 'generic local alert only');
        assert.deepEqual(Object.keys(options), ['body'], 'no persistent URL or grant payload');
      });
      this.title = title; this.options = options; this.closes = 0; notices.push(this);
    }
    close() { this.closes++; }
  }
  lifetime.route(request => {
    const { url, method, options, body } = request;
    assert.deepEqual([...url.searchParams], []);
    if (url.pathname === '/api/web-auth') {
      assert.equal(request.closing, false); assert.equal(method, 'GET'); assert.equal(body, undefined); exactHeaders(options, {});
      assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin');
      return { data: { enabled: true, authenticated: true } };
    }
    assert.equal(url.pathname, '/api/ssh-agent'); assert.equal(method, 'POST');
    exactHeaders(options, { 'Content-Type': 'application/json' });
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin');
    assert.equal(request.closing && body.action !== 'disconnect', false, 'only exact revocation may be admitted during unmount');
    switch (body.action) {
      case 'status': assert.deepEqual(body, { action: 'status' }); return { data: sshStatus() };
      case 'connect':
        assert.equal(connectionAdmission, true, 'fixture explicitly admitted the clicked connection');
        assert.deepEqual(body, { action: 'connect', keyId: 'key', device: 'Fixture', makeActive: true, unlock: false });
        return { data: { id: connectionView.id, token: 'owned-token', challenge: 'Aw', rpId: 'fixture.invalid', credential: { id: 'AQ', spki: 'Ag' } } };
      case 'activate':
        assert.equal(connectionAdmission, true, 'activation belongs to the explicitly clicked connection');
        assert.deepEqual(body, { action: 'activate', token: 'owned-token', assertion: { id: 'AQ', clientData: 'BQ', authenticatorData: 'Bg', signature: 'Bw' } });
        return { data: { status: sshStatus(true), connection: { ...connectionView } } };
      case 'poll': {
        assert.deepEqual(body, { action: 'poll', token: 'owned-token' });
        polls.push(request);
        const hold = nextPollHeld; nextPollHeld = false;
        return { hold, data: { status: snapshotStatus, connection: { ...connectionView }, requests: nextRequests.map(item => ({ ...item })) }, fallback: { status: sshStatus(), connection: null, requests: [] } };
      }
      case 'disconnect': assert.deepEqual(body, { action: 'disconnect', token: 'owned-token' }); return { data: sshStatus() };
      default: assert.fail(`No discovery, signing, unlock, selection or authority restoration allowed: ${body.action}`);
    }
  });
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
  const graph = await jiti.import('./ssh-notifications.fixture.tsx');
  const completion = graph.createClientCompletion(); lifetime.bindCompletion(completion);
  view = await lifetime.mount(createElement(graph.I18nProvider, null, createElement(graph.SshNotificationProbe, { completion, observe: agent => { current = agent; } })), window => {
    lifetime.replace(window, 'isSecureContext', true);
    lifetime.replace(window.document, 'hasFocus', () => false);
    lifetime.replace(window.document, 'visibilityState', 'visible');
    lifetime.replace(window, 'focus', () => { focus++; });
    lifetime.replace(globalThis, 'PublicKeyCredential', class {}); lifetime.replace(window, 'PublicKeyCredential', class {});
    if (permission === 'unsupported') {
      lifetime.replace(window, 'Notification', undefined); delete window.Notification;
      lifetime.replace(globalThis, 'Notification', undefined); delete globalThis.Notification;
    } else { lifetime.replace(window, 'Notification', Notice); lifetime.replace(globalThis, 'Notification', Notice); }
    if (stored !== null) window.localStorage.setItem(notifyKey, stored);
    if (publicMetadata) window.localStorage.setItem('brabbler:browser-ssh-credential:v1', JSON.stringify({ id: 'AQ', spki: 'Ag', origin: window.location.origin }));
    // Only the explicitly clicked connection's fresh UV proof is supplied. Any
    // signing/enrollment/payload ceremony is an unexpected port admission.
    lifetime.replace(window.navigator, 'credentials', {
      create: lifetime.unsupported('enrollment'),
      get: async options => lifetime.checked(() => {
        assertions++;
        assert.equal(connectionAdmission, true, 'no automatic credential ceremony');
        assert.equal(options.publicKey.rpId, 'fixture.invalid'); assert.equal(options.publicKey.userVerification, 'required');
        assert.deepEqual([...options.publicKey.challenge], [3]);
        assert.deepEqual(options.publicKey.allowCredentials.map(item => [...item.id]), [[1]]);
        assert.equal(options.signal.aborted, false);
        return { rawId: Uint8Array.of(1).buffer, response: { clientDataJSON: Uint8Array.of(5).buffer, authenticatorData: Uint8Array.of(6).buffer, signature: Uint8Array.of(7).buffer } };
      }),
    });
  });
  await lifetime.settle();
  const click = async text => {
    const button = [...view.container.querySelectorAll('button')].find(item => item.textContent === text);
    assert.equal(Boolean(button), true, text);
    await view.dispatch(button, new view.window.MouseEvent('click', { bubbles: true }));
  };
  return {
    ...lifetime, view, notices, polls, timers, permissionGate,
    get current() { return current; }, get focus() { return focus; }, get prompts() { return prompts; }, get assertions() { return assertions; }, get deliveries() { return deliveries; },
    field(name) { return view.container.querySelector(`[data-field="${name}"]`)?.textContent; },
    actions() { return lifetime.requests.filter(item => item.url.pathname === '/api/ssh-agent').map(item => item.body.action); },
    permission(value) {
      if (value === 'unsupported') { delete view.window.Notification; delete globalThis.Notification; }
      else Notice.permission = value;
    },
    async connect(requests = [signingRequest]) {
      nextRequests = requests; connectionAdmission = true;
      try { await click('Connect'); await lifetime.settle(); }
      finally { connectionAdmission = false; }
    },
    async disconnect() { await click('Disconnect'); await lifetime.settle(); },
    async toggle(enabled) { await lifetime.act(async () => { await current.toggleNotifications(enabled); }); await lifetime.settle(); },
    async clickNotice(notice) { await lifetime.act(() => notice.onclick()); await lifetime.settle(); },
    setNow(value) { assert.equal(value >= now, true); now = value; },
    async poll(requests, { hold = false, status = sshStatus(true) } = {}) {
      nextRequests = requests; snapshotStatus = status; nextPollHeld = hold;
      const before = polls.length;
      await lifetime.act(() => {
        now += 2000;
        // Run only due controlled policy callbacks. They own complete work via
        // the real client's completion owner; a timer callback is not its join.
        for (const [id, item] of [...timers]) if (item.at <= now) {
          if (item.interval) item.at = now + item.delay; else timers.delete(id);
          lifetime.checked(() => item.callback());
        }
      });
      assert.equal(polls.length, before + 1, 'one due owned heartbeat');
      const request = polls.at(-1); await request.entered.promise;
      if (!hold) await lifetime.settle();
      return request;
    },
    async deliverPoll(request, requests, status = sshStatus(true)) {
      await lifetime.act(() => request.bodyGate.resolve({ status, connection: { ...connectionView }, requests }));
      await lifetime.settle();
    },
    async pagehide() { await lifetime.act(() => view.window.dispatchEvent(new view.window.Event('pagehide'))); await lifetime.settle(); },
  };
}
