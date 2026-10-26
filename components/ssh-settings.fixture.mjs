import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { browserClientFixture, exactHeaders } from '../lib/browser-client.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { sshStatus } from '../lib/ssh-notifications.fixture.mjs';

export const publicCredential = { id: 'AQ', spki: 'Ag', origin: 'https://fixture.invalid' };
export const genericKey = 'pi-web:browser-ssh-credential:v1';
export function keyView(extra = {}) {
  return { id: 'existing-session-key', name: 'Existing session key', origin: publicCredential.origin,
    credential: { id: publicCredential.id, spki: publicCredential.spki }, policy: 'session',
    publicKey: 'SYNTHETIC public presentation, not an OpenSSH proof', fingerprint: 'SYNTHETIC fingerprint',
    protection: null, discoverability: 'unknown', applicationOnly: true, ...extra };
}
export function statusView({ revision = 'runtime-1', registryRevision = 'registry-1', selected = { type: 'none' }, keys = [] } = {}) {
  const result = sshStatus();
  result.runtime = { ...result.runtime, revision, selected, socketPath: '/private/synthetic.sock', setupNeeded: false };
  result.registry = { revision: registryRevision, keys };
  return result;
}
export function acknowledgement(record, snapshot) { return { record, snapshot: snapshot.registry }; }
export const syntheticAssertion = id => ({ id, clientData: 'BQ', authenticatorData: 'Bg', signature: 'Bw' });

export async function sshSettingsFixture(t, { snapshot = statusView(), recovery, candidates = [], failSetup } = {}) {
  // Hardened shared lifetime is reused, never overwritten. It registers cleanup
  // and live error/host-port guards before the selected production graph import.
  const life = browserClientFixture(t);
  let current, view, active = false, observer, graph, snapshotValue = snapshot, observerGeneration = 1;
  let proofAdmission = null, timerId = 0, now = 100;
  const plans = [], timers = new Map(), invocations = [], ceremonies = [], observations = [];
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  const domCallbacks = new Map();
  const timer = (callback, delay, interval) => {
    const id = ++timerId; timers.set(id, { callback, delay, interval }); return id;
  };
  life.replace(globalThis, 'setTimeout', (fn, delay = 0, ...args) => {
    if (delay !== 0) return timer(fn, delay, false);
    // Preserve jsdom's real zero-delay Storage callback; do not drive it as policy
    // or resolve it as a reply gate. This is the existing hardened SSH convention.
    const done = deferred();
    const handle = realSetTimeout(function (...values) {
      domCallbacks.delete(handle);
      try { Reflect.apply(fn, this, values); done.resolve(); }
      catch (error) { done.reject(error); throw error; }
    }, 0, ...args);
    domCallbacks.set(handle, done); life.observePort('SSH Settings DOM zero callback', done.promise);
    return handle;
  });
  life.replace(globalThis, 'clearTimeout', id => {
    if (typeof id === 'number') { timers.delete(id); return; }
    const done = domCallbacks.get(id); domCallbacks.delete(id); realClearTimeout(id); done?.resolve();
  });
  life.replace(globalThis, 'setInterval', (fn, delay) => timer(fn, delay, true));
  life.replace(globalThis, 'clearInterval', id => timers.delete(id));
  life.replace(globalThis.performance, 'now', () => now);
  life.route(request => {
    assert.equal(request.closing, false, 'no Settings transport admitted during joined teardown');
    assert.deepEqual([...request.url.searchParams], []);
    assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.credentials, 'same-origin');
    if (request.url.pathname === '/api/web-auth') {
      assert.equal(request.method, 'GET'); assert.equal(request.body, undefined); exactHeaders(request.options, {});
      return { data: { enabled: true, authenticated: true } }; // SYNTHETIC auth port, no login credentials/files.
    }
    assert.equal(request.url.pathname, '/api/ssh-agent'); assert.equal(request.method, 'POST');
    exactHeaders(request.options, { 'Content-Type': 'application/json' });
    const index = plans.findIndex(plan => plan.action === request.body.action);
    if (index !== -1) {
      assert.equal(index, 0, 'declared complete operation order');
      const [plan] = plans.splice(index, 1);
      assert.deepEqual(request.body, plan.expected, 'exact current Settings payload before acceptance');
      plan.request = request; request.settingsPlan = plan;
      return { data: plan.data, status: plan.status };
    }
    if (request.body.action === 'status') { assert.deepEqual(request.body, { action: 'status' }); return { data: snapshotValue }; }
    if (request.body.action === 'discover') { assert.deepEqual(request.body, { action: 'discover' }); return { data: candidates }; }
    // No credential/signing/grant/connect endpoint is permitted just because
    // there is a key, preference, ack, saved public metadata or enabled button.
    assert.fail(`Unexpected unplanned SSH Settings action: ${request.body.action}`);
  });
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
  graph = await jiti.import('./ssh-settings.fixture.tsx');
  const hookWork = graph.createClientCompletion(), componentWork = graph.createClientCompletion();
  const completion = { async settle(group) { await hookWork.settle(group); await componentWork.settle(group); await hookWork.settle(group); } };
  life.bindCompletion(completion);
  observer = work => { observations.push({ generation: 1, work }); componentWork.track(work); };
  const observe = agent => { current = agent; };
  const render = () => createElement(graph.I18nProvider, null, createElement(graph.SshSettingsProbe,
    { completion: hookWork, active, observe, onWork: observer }));
  view = await life.mount(render(), window => {
    life.replace(window, 'isSecureContext', true);
    life.replace(window.navigator, 'clipboard', { writeText: life.unsupported('clipboard outside selected Settings cases') });
    life.replace(window.document, 'execCommand', life.unsupported('legacy clipboard outside selected Settings cases'));
    life.replace(window.document, 'visibilityState', 'visible');
    life.replace(globalThis, 'PublicKeyCredential', class {}); life.replace(window, 'PublicKeyCredential', class {});
    if (recovery) window.localStorage.setItem(genericKey, JSON.stringify(recovery));
    // Wrap only the controlled external body. Real Response JSON parsing is
    // completed before the named hold. Ignore its AbortSignal deliberately so a
    // late parsed success actually reaches production after Settings closes.
    const baseFetch = window.fetch;
    const fetch = async (input, options) => {
      const invocation = life.checked(() => ({ input, body: options?.body ? JSON.parse(options.body) : undefined, signal: options?.signal }));
      invocations.push(invocation);
      const responseWork = baseFetch(input, options);
      // The base admission is synchronous; bind this request BEFORE awaiting
      // headers, not the last request after a competing StrictMode read.
      const request = life.requests.at(-1);
      const response = await responseWork;
      const plan = request?.settingsPlan;
      return { ok: response.ok, status: response.status, json() {
        const task = (async () => {
          const supplied = await response.json();
          const value = await life.checked(() => Response.json(supplied)).json();
          if (plan) { plan.parsed.resolve(); await plan.release.promise; }
          return value;
        })();
        // Retain independently, including when browserSshApi/run catch a body error.
        life.observePort('SSH Settings parsed body including release', task);
        return task;
      } };
    };
    life.replace(window, 'fetch', fetch); life.replace(globalThis, 'fetch', fetch);
    life.replace(window.navigator, 'credentials', {
      create: life.unsupported('native enrollment: not part of this synthetic Settings owner'),
      get: async options => life.checked(() => {
        assert.ok(proofAdmission, 'only the explicitly clicked recovery proof is synthetically admitted');
        assert.equal(options.signal.aborted, false);
        assert.equal(options.publicKey.rpId, 'fixture.invalid'); assert.equal(options.publicKey.userVerification, 'required');
        assert.deepEqual([...options.publicKey.challenge], [3]);
        assert.deepEqual(options.publicKey.allowCredentials.map(item => [...item.id]), [[...Buffer.from(proofAdmission.id, 'base64url')]]);
        ceremonies.push({ synthetic: true, id: proofAdmission.id, uv: 'required' });
        return { rawId: Uint8Array.from(Buffer.from(proofAdmission.id, 'base64url')).buffer,
          response: { clientDataJSON: Uint8Array.of(5).buffer, authenticatorData: Uint8Array.of(6).buffer, signature: Uint8Array.of(7).buffer } };
      }),
    });
    if (failSetup) {
      // Already admitted callback must finish while its realm is still alive,
      // even when central mount has no view to return to this local fixture.
      const release = life.gate();
      life.observePort('failed setup held peer', release.promise.then(() => failSetup(window)));
      throw new Error('deliberate SSH Settings setup failure');
    }
  });
  await life.settle();
  const button = (text, root = view.container) => {
    const matches = [...root.querySelectorAll('button')].filter(item => item.textContent.trim() === text);
    assert.equal(matches.length, 1, `one actual button: ${text}`); return matches[0];
  };
  return {
    ...life, view, invocations, ceremonies, timers, observations,
    get current() { return current; },
    setSnapshot(value) { snapshotValue = value; },
    actions() { return invocations.filter(item => item.input === '/api/ssh-agent').map(item => item.body.action); },
    expect(action, expected, data, { status = 200, hold = false } = {}) {
      const release = life.gate(), parsed = deferred();
      if (!hold) release.resolve();
      const plan = { action, expected, data, status, release, parsed }; plans.push(plan); return plan;
    },
    button,
    region(label) { const result = [...view.container.querySelectorAll('section')].find(item => item.getAttribute('aria-label') === label); assert.ok(result, label); return result; },
    async click(text, root) { const target = typeof text === 'string' ? button(text, root) : text; await view.dispatch(target, new view.window.MouseEvent('click', { bubbles: true })); },
    async select(element, value) { await life.act(() => { element.value = value; element.dispatchEvent(new view.window.Event('change', { bubbles: true })); }); },
    async input(element, value) { await life.act(() => {
      const prototype = element.tagName === 'TEXTAREA' ? view.window.HTMLTextAreaElement.prototype : view.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new view.window.Event('input', { bubbles: true }));
    }); },
    async setActive(value) { active = value; await view.rerender(render()); },
    async swapObserver() {
      const generation = ++observerGeneration;
      observer = work => { observations.push({ generation, work }); componentWork.track(work); };
      await view.rerender(render()); return generation;
    },
    async removeObserver() { observer = undefined; await view.rerender(render()); },
    async release(plan) { await life.act(() => plan.release.resolve()); await life.settle(); },
    async proof(credential, run) { assert.equal(proofAdmission, null); proofAdmission = credential; try { await run(); await life.settle(); } finally { proofAdmission = null; } },
    async replaceRecovery(value) { await life.act(() => {
      windowStorage(view).setItem(genericKey, JSON.stringify(value));
      view.window.dispatchEvent(new view.window.StorageEvent('storage', { key: genericKey }));
    }); },
    assertComplete() { assert.equal(plans.length, 0, 'all declared external operations were admitted'); life.healthy(); },
  };
}
function windowStorage(view) { return view.window.localStorage; }
