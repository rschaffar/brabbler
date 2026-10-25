import assert from 'node:assert/strict';
import { act } from 'react';
import { mount } from './testing/react.fixture.mjs';
import { deferred } from './testing/async.fixture.mjs';

// Local Terminal/SSH external-port lifetime. No React/hook/decision replacement.
// Install before importing the application graph. No node:http/net interception or
// native layout, WebAuthn, notification delivery or service closure claim.
export function browserClientFixture(t) {
  const failures = [], restores = [], realmRestores = [], removes = [], gates = [], ports = [], requests = [];
  let view, completion, route = () => assert.fail('HTTP before route installation'), closing = false, domainJoin;
  let realmRestoration, beforeDisposal, disposal;
  function checked(run) {
    try { return run(); } catch (error) { failures.push(error); throw error; }
  }
  function replace(target, key, value, realmOverride = false) {
    const old = Object.getOwnPropertyDescriptor(target, key);
    checked(() => Object.defineProperty(target, key, { configurable: true, writable: true, value }));
    (realmOverride ? realmRestores : restores).push(() => old ? Object.defineProperty(target, key, old) : delete target[key]);
  }
  const unsupported = label => function () { return checked(() => { throw new Error(`Unsupported client port: ${label}`); }); };
  function guards(target) {
    for (const key of ['fetch', 'XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker', 'Notification', 'PublicKeyCredential']) replace(target, key, unsupported(key));
    if (target.navigator) {
      replace(target.navigator, 'sendBeacon', unsupported('sendBeacon'));
      replace(target.navigator, 'credentials', { get: unsupported('credentials.get'), create: unsupported('credentials.create') });
    }
  }
  function listen(target, type, fn) { target.addEventListener(type, fn); removes.push(() => target.removeEventListener(type, fn)); }
  function gate(fallback) {
    const result = deferred();
    let released = false;
    const resolve = value => { released = true; result.resolve(value); };
    const item = { promise: result.promise, resolve, get released() { return released; }, release: () => resolve(fallback) };
    gates.push(item);
    return item;
  }
  const fetch = (input, options = {}) => {
    try {
      return checked(() => {
        assert.equal(typeof input, 'string', 'string client URL');
        const url = new URL(input, 'https://fixture.invalid');
        assert.equal(url.origin, 'https://fixture.invalid', 'exact client origin');
        assert.equal(url.hash, ''); assert.equal(url.username, ''); assert.equal(url.password, '');
        const request = {
          url, options, closing, method: options.method ?? 'GET',
          body: options.body === undefined ? undefined : JSON.parse(options.body),
          entered: deferred(), jsonReturned: false,
        };
        // Validate before accepting. Record failures even if production catches.
        const reply = route(request);
        const body = gate(reply?.fallback ?? {});
        request.bodyGate = body;
        requests.push(request);
        if (!reply?.hold) body.resolve(reply?.data ?? {});
        const response = {
          ok: (reply?.status ?? 200) < 400, status: reply?.status ?? 200,
          json() {
            return checked(() => {
              request.entered.resolve();
              const task = body.promise.then(value => { request.jsonReturned = true; return value; });
              ports.push(task);
              return task;
            });
          },
        };
        const task = Promise.resolve(response);
        ports.push(task);
        return task;
      });
    } catch (error) { return Promise.reject(error); }
  };
  function healthy() { assert.equal(failures.length, 0, 'no caught admission/runtime/console failures'); }
  const monitor = error => failures.push(error);
  process.on('uncaughtExceptionMonitor', monitor);
  removes.push(() => process.off('uncaughtExceptionMonitor', monitor));
  // Also supplied to the central fixture's beforeDispose boundary: even a
  // partial-mount failure must join this domain before its realm is closed.
  function joinDomain() {
    if (!domainJoin) domainJoin = (async () => {
      closing = true;
      const errors = [];
      const release = () => { for (const item of gates) { try { item.release(); } catch (error) { errors.push(error); } } };
      try { await act(async () => { release(); await completion?.settle(); }); } catch (error) { errors.push(error); }
      release();
      try { await completion?.settle(); } catch (error) { errors.push(error); }
      // Join only actual admitted port promises, including children admitted by
      // those callbacks, not an arbitrary scheduling turn or future timer idle.
      for (let offset = 0; offset < ports.length;) {
        const batch = ports.slice(offset); offset += batch.length;
        const results = await Promise.allSettled(batch);
        for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      }
      if (errors.length) throw new AggregateError(errors, 'Client domain join failed');
    })();
    return domainJoin;
  }
  function restoreRealmOverrides() {
    if (!realmRestoration) realmRestoration = (async () => {
      const errors = [];
      for (const restore of realmRestores.toReversed()) {
        try { restore(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Client realm overrides restoration failed');
    })();
    return realmRestoration;
  }
  // Never call full local dispose here: central dispose awaits this callback.
  function beforeDispose() {
    if (!beforeDisposal) beforeDisposal = (async () => {
      const errors = [];
      try { await joinDomain(); } catch (error) { errors.push(error); }
      try { await restoreRealmOverrides(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Client before-disposal failed');
    })();
    return beforeDisposal;
  }
  function dispose() {
    if (!disposal) disposal = (async () => {
    const errors = [];
    const attempt = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
    closing = true;
    await attempt(() => view?.unmount());
    await attempt(beforeDispose);
    await attempt(() => view?.dispose());
    for (const restore of restores.toReversed()) await attempt(restore);
    // Observe through realm disposal and global restoration; never suppress output.
    for (const remove of removes.toReversed()) await attempt(remove);
    errors.push(...failures);
    if (errors.length) throw new AggregateError(errors, 'Client lifetime cleanup failed');
    })();
    return disposal;
  }
  // Register before imports/admission. Normal and failed mounts share full local
  // disposal; diagnostics outlive domain joins and both restoration phases.
  t.after(dispose);
  const originalError = console.error;
  replace(console, 'error', (...args) => {
    failures.push(new Error(`Client console.error: ${args.filter(x => typeof x === 'string').join(' ').slice(0, 1500)}`));
    originalError.apply(console, args);
  });
  guards(globalThis);
  return {
    requests, gate, replace, checked, healthy, unsupported, dispose,
    observePort(label, promise) {
      // External callback completion is distinct from a releasable reply gate.
      const observed = Promise.resolve(promise).then(() => {}, cause => {
        failures.push(new Error(`External client callback failed: ${label}`, { cause }));
      });
      ports.push(observed);
      return promise;
    },
    route(fn) { route = fn; },
    bindCompletion(value) { completion = value; },
    async mount(element, setup) {
      // Requires the parent's central beforeDispose callback, including on a
      // failed mount: after unmount, before window.close/global restoration.
      view = await mount(t, element, { beforeDispose, setup(window) {
        listen(window, 'error', event => failures.push(event.error ?? new Error(event.message)));
        listen(window, 'unhandledrejection', event => failures.push(event.reason));
        guards(window);
        replace(window, 'fetch', fetch);
        replace(globalThis, 'fetch', fetch);
        replace(globalThis, 'localStorage', window.localStorage);
        replace(globalThis, 'location', window.location);
        replace(window, 'open', unsupported('window.open'));
        setup?.(window);
      } });
      healthy();
      return view;
    },
    async act(run) { await act(async () => { await run(); }); healthy(); },
    async settle(group) { await act(async () => { await completion.settle(group); }); healthy(); },
  };
}

export function exactHeaders(options, expected) {
  assert.deepEqual([...new Headers(options.headers)].sort(), [...new Headers(expected)].sort(), 'exact headers');
}
