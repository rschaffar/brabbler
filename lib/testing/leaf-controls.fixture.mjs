import assert from 'node:assert/strict';
import { act } from 'react';
import { createTaskOwner, deferred } from './async.fixture.mjs';

export const leafOrigin = 'https://fixture.invalid';

export function exactQuery(request, expected) {
  // Entries, not get(): duplicate and extra keys must fail too.
  assert.deepEqual([...request.url.searchParams].sort(), Object.entries(expected).sort(), 'exact synthetic query');
}

export function exactHeaders(request, expected = {}) {
  assert.deepEqual([...new Headers(request.options.headers)].sort(),
    [...new Headers(expected)].sort(), 'exact synthetic headers');
}

// Install BEFORE production imports. These are rejecting host ports, not fake
// hooks/children. They do not intercept node:http/net, captured references, media
// resource loaders, native services or arbitrary dependency module evaluation.
export function controlledLeafFetch(t, route = () => assert.fail('unexpected leaf HTTP')) {
  const owner = createTaskOwner(), failures = [], requests = [];
  const restorations = [], listeners = [];
  let view, closing = false;
  function checked(run) {
    try { return run(); }
    catch (error) { failures.push(error); throw error; }
  }
  const attempt = (errors, run) => { try { run(); } catch (error) { errors.push(error); } };
  function replace(target, key, value) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    // A failed installation is retained; never silently leave a usable host port.
    checked(() => Object.defineProperty(target, key, { configurable: true, writable: true, value }));
    restorations.push(() => {
      if (previous) Object.defineProperty(target, key, previous);
      else delete target[key];
    });
  }
  const unsupported = label => function () {
    return checked(() => { throw new Error(`Unsupported leaf host transport: ${label}`); });
  };
  function guardTransports(target, label) {
    for (const key of ['XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker']) {
      replace(target, key, unsupported(`${label}.${key}`));
    }
  }
  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }
  function runtimeFailure(label, cause) {
    // Preserve the original cause, including Errors from the jsdom realm.
    failures.push(new Error(label, { cause }));
  }
  // Observe without preventing default, suppressing console output, or replacing
  // Node's fatal exception/rejection policy (node:test retains its own reporting).
  const monitor = error => runtimeFailure('uncaught Node exception', error);
  process.on('uncaughtExceptionMonitor', monitor);
  listeners.push(() => process.off('uncaughtExceptionMonitor', monitor));

  function releaseGates(request, data, status) {
    const errors = [];
    // Always attempt both gates, even if one resolver/peer release throws.
    attempt(errors, () => request.body.resolve(data));
    attempt(errors, () => request.response.resolve({
      ok: status >= 200 && status < 300, status,
      json() {
        return checked(() => {
          request.jsonCalls++;
          // Admission errors after join must survive production's broad catch.
          return owner.track(`JSON body ${request.url.pathname}`, request.body.promise);
        });
      },
    }));
    if (errors.length) throw new AggregateError(errors, 'Leaf response/body release failed');
  }
  const fetch = (input, options = {}) => {
    try {
      return checked(() => {
        assert.equal(closing, false, 'request admitted during teardown');
        assert.equal(typeof input, 'string', 'selected leaves use string fetch URLs');
        const url = new URL(input, leafOrigin);
        assert.equal(url.origin, leafOrigin, 'exact fixture origin');
        assert.equal(url.username, '', 'no URL credentials');
        assert.equal(url.password, '', 'no URL credentials');
        assert.equal(url.hash, '', 'no synthetic URL fragment');
        const response = deferred(), body = deferred();
        const request = { url, options, response, body, jsonCalls: 0, answered: false };
        // Validate before admission. Caught route failures remain live.
        const automatic = route(request);
        request.fetchWork = owner.track(`${options.method ?? 'GET'} ${url.pathname}`, response.promise);
        requests.push(request);
        request.reply = (data, status = 200) => checked(() => {
          request.answered = true;
          request.replyData = data;
          request.replyStatus = status;
          releaseGates(request, data, status);
        });
        if (automatic !== undefined) request.reply(automatic);
        return request.fetchWork;
      });
    } catch (error) {
      // Production may catch the rejection; our collector still owns the error.
      return Promise.reject(error);
    }
  };
  t.after(async () => {
    const errors = [];
    closing = true;
    try { await view?.unmount(); } catch (error) { errors.push(error); }
    const releaseAll = () => {
      for (const request of requests) {
        // Directly release every accepted response AND body, including already
        // answered peers. Idempotent resolvers do not change earlier replies.
        attempt(errors, () => releaseGates(request,
          request.answered ? request.replyData : { error: 'fixture teardown' },
          request.answered ? request.replyStatus : 503));
      }
    };
    try {
      await act(async () => {
        releaseAll();
        await Promise.allSettled(requests.map(request => request.fetchWork));
      });
    } catch (error) { errors.push(error); }
    // Also release if act threw before invoking its callback. This exceptional
    // fallback is not a claim that React commits succeeded.
    releaseAll();
    // Independent attempt: an unmount/release/act error must never skip this join.
    try { await owner.join(); } catch (error) { errors.push(error); }
    try { await view?.dispose(); } catch (error) { errors.push(error); }
    for (const restore of restorations.toReversed()) attempt(errors, restore);
    // Keep runtime observations active through descriptor restoration.
    for (const remove of listeners.toReversed()) attempt(errors, remove);
    errors.push(...failures);
    if (errors.length) throw new AggregateError(errors, 'Leaf bounded-port/React cleanup failed');
  });
  // Hook above also owns partial setup failures. Forward diagnostics unchanged;
  // retain only scalar log text, never assert/deep-diff a React DOM object graph.
  const consoleError = console.error;
  replace(console, 'error', (...args) => {
    const text = args.filter(value => typeof value === 'string').join(' ').slice(0, 2000);
    failures.push(new Error(`Unexpected console.error in leaf lifetime: ${text}`));
    return consoleError.apply(console, args);
  });
  guardTransports(globalThis, 'globalThis');
  if (globalThis.navigator) replace(globalThis.navigator, 'sendBeacon', unsupported('globalThis.navigator.sendBeacon'));
  replace(globalThis, 'fetch', fetch);
  return {
    requests,
    // Pass as mount's setup, before createRoot/effects. A failed mount disposes
    // itself before bind can run: report that exceptional ordering explicitly.
    setup(window) {
      listen(window, 'error', event => runtimeFailure('window error', event.error));
      listen(window, 'unhandledrejection', event => runtimeFailure('window unhandled rejection', event.reason));
      guardTransports(window, 'window');
      replace(window, 'fetch', fetch);
      replace(window, 'open', unsupported('window.open'));
      replace(window.navigator, 'sendBeacon', unsupported('navigator.sendBeacon'));
    },
    bind(next) { view = next; return next; },
    check: checked,
    assertHealthy() { assert.equal(failures.length, 0, 'no retained transport/callback/runtime failures'); },
    reply(request, data = {}, status = 200) {
      return checked(() => {
        assert.equal(requests.includes(request), true, 'named accepted request exists before release');
        // Admit a start gate BEFORE scheduling fixture work, so a closed owner
        // cannot accidentally start an unowned release. This is a port operation,
        // not the unreturned production handler/effect continuation.
        const start = deferred();
        const work = start.promise.then(async () => {
          await act(async () => { request.reply(data, status); await request.fetchWork; });
          assert.equal(failures.length, 0, 'no retained transport/callback/runtime failures');
        });
        void work.catch(() => {}); // Retain original rejection for owner/caller.
        let admitted;
        try { admitted = owner.track('fixture response/body release and React act', work); }
        catch (error) { start.reject(error); throw error; }
        start.resolve();
        return admitted;
      });
    },
  };
}

export function buttonWithText(container, text) {
  const buttons = [...container.querySelectorAll('button')].filter(button => button.textContent.trim() === text);
  assert.equal(buttons.length, 1, `exactly one button: ${text}`);
  return buttons[0];
}

export async function click(view, element) {
  assert.ok(element, 'click target exists');
  await view.dispatch(element, new view.window.MouseEvent('click', { bubbles: true }));
}

export async function inputText(view, element, text) {
  assert.ok(element, 'input target exists');
  // Use the realm's native setter so React's real input/change plugin observes it.
  const prototype = element instanceof view.window.HTMLTextAreaElement
    ? view.window.HTMLTextAreaElement.prototype : view.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
  await view.dispatch(element, new view.window.Event('input', { bubbles: true }));
}
