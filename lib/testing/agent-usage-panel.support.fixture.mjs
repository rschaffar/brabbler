import assert from 'node:assert/strict';
import { act } from 'react';
import { mount } from './react.fixture.mjs';
import { controlledLeafFetch, exactHeaders } from './leaf-controls.fixture.mjs';

// Host-port/lifetime adapter only. No copied usage algorithm, hook, child or
// clock. Reuses the common rejecting ports and real React/DOM lifetime owner.
export function agentUsagePanelOwner(t) {
  const work = [], bodies = [], failures = [], subscriptions = new Set();
  const restores = [], requests = [];
  let httpCleanup, mountCleanup, view, closing = false, disposal, drainWork;
  let visible = true, adds = 0, removes = 0;
  const baselineFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const baselineDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const attempt = async (errors, run) => { try { await run(); } catch (error) { errors.push(error); } };
  const dispose = () => {
    if (!disposal) {
      disposal = (async () => {
        const errors = [];
        // The common owner closes admission, unmounts, releases EVERY header
        // and body, joins transport, then invokes view.dispose -> drain below.
        await attempt(errors, () => httpCleanup?.());
        await attempt(errors, () => mountCleanup?.());
        // Also covers a constructor/import failure before mount registered.
        await attempt(errors, () => drain());
        await attempt(errors, () => assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'fetch'), baselineFetch));
        await attempt(errors, () => assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'document'), baselineDocument));
        errors.push(...failures);
        if (errors.length) throw new AggregateError(errors, 'Agent usage panel ownership failed');
      })();
      void disposal.catch(() => {});
    }
    return disposal;
  };
  // Register before port installation or production import. No dependence on
  // node:test after-hook ordering, even when setup/render cannot return a view.
  t.after(dispose);
  let http;
  http = controlledLeafFetch({ after: callback => { httpCleanup = callback; } }, request => {
    assert.equal(closing, false, 'no late controller/cleanup transport admission');
    assert.equal(request.url.pathname, '/api/sessions/stats', 'includes forbidden review/ack attempts');
    assert.equal(request.url.search, '');
    assert.deepEqual(Object.keys(request.options).sort(), ['body', 'cache', 'headers', 'method', 'signal']);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.cache, 'no-store');
    exactHeaders(request, { 'Content-Type': 'application/json' });
    assert.ok(request.options.signal instanceof AbortSignal);
    const body = JSON.parse(request.options.body);
    assert.deepEqual(Object.keys(body), ['ids']);
    assert.ok(body.ids.length > 0 && body.ids.length <= 200);
    assert.deepEqual(body.ids, [...new Set(body.ids)].sort());
    request.ids = body.ids;
    requests.push(request);
  });
  function replace(target, key, descriptor) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    restores.push(() => previous ? Object.defineProperty(target, key, previous) : delete target[key]);
  }
  function onWork(promise) {
    // Called only after actual pump admission. Attach immediately, keeping the
    // original promise (including catch/finally and queued restart) untouched.
    const record = { promise, settled: false };
    record.observed = promise.then(
      () => { record.settled = true; },
      error => { record.settled = true; failures.push(error); },
    );
    work.push(record);
    for (const request of requests) if (!request.work) request.work = promise;
  }
  function drain() {
    if (!drainWork) {
      closing = true;
      drainWork = (async () => {
        const errors = [];
        await attempt(errors, () => act(async () => {
          // Abort is not settlement. Release both gates independently for ALL
          // requests, including already-answered and ignored-abort peers.
          for (const request of requests) {
            await attempt(errors, () => request.body.resolve({ stats: {} }));
            await attempt(errors, () => request.reply({ stats: {} }, 503));
          }
          // Drain dynamically admitted finally work, not elapsed-time polling.
          let joined = 0;
          while (joined < work.length) {
            const batch = work.slice(joined); joined = work.length;
            await Promise.all(batch.map(record => record.observed));
          }
          await Promise.all(bodies);
        }));
        await attempt(errors, () => assert.equal(subscriptions.size, 0, 'visibility subscriptions removed by actual hook cleanup'));
        await attempt(errors, () => http?.assertHealthy());
        for (const restore of restores.toReversed()) await attempt(errors, restore);
        if (errors.length) throw new AggregateError(errors, 'Full usage lifecycle drain failed');
      })();
      void drainWork.catch(() => {});
    }
    return drainWork;
  }
  return {
    requests, work, onWork, dispose,
    get subscriptions() { return subscriptions.size; },
    get adds() { return adds; }, get removes() { return removes; },
    async mount(element, { failSetup } = {}) {
      view = await mount({ after: callback => { mountCleanup = callback; } }, element, {
        // Default StrictMode stays enabled; replay's aborted flight must drain.
        setup(window) {
          http.setup(window);
          const document = window.document;
          replace(document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
          const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
          replace(document, 'addEventListener', { writable: true, value(type, listener, options) {
            if (type === 'visibilitychange') { subscriptions.add(listener); adds++; }
            return add(type, listener, options);
          } });
          replace(document, 'removeEventListener', { writable: true, value(type, listener, options) {
            if (type === 'visibilitychange') { subscriptions.delete(listener); removes++; }
            return remove(type, listener, options);
          } });
          if (failSetup) throw failSetup;
        },
        beforeDispose: drain,
      });
      return http.bind(view);
    },
    async visibility(next) {
      visible = next;
      await view.dispatch(view.window.document, new view.window.Event('visibilitychange'));
    },
    async headers(request, status = 200) {
      assert.ok(requests.includes(request));
      assert.equal(request.headersSent, undefined, 'headers released once');
      request.headersSent = true;
      await act(async () => {
        request.response.resolve({ ok: status >= 200 && status < 300, status, json() {
          request.jsonCalls++;
          // Observe body settlement separately; return its original promise.
          bodies.push(request.body.promise.then(() => {}, () => {}));
          return request.body.promise;
        } });
      });
      assert.equal(request.jsonCalls, status >= 200 && status < 300 ? 1 : 0);
    },
    async body(request, payload, { reject = false } = {}) {
      assert.equal(request.headersSent, true);
      assert.ok(request.work, 'actual full pump promise observed');
      await act(async () => {
        if (reject) request.body.reject(payload); else request.body.resolve(payload);
        await request.work;
      });
      http.assertHealthy();
    },
    assertHealthy: () => http.assertHealthy(),
  };
}
