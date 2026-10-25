import assert from 'node:assert/strict';
import { isNativeError } from 'node:util/types';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, exactQuery, exactHeaders, click, inputText } from '../lib/testing/leaf-controls.fixture.mjs';
export { click, inputText };

// Reuses the live leaf transport guard and real DOM/application-React fixture.
// Different API shape from Files' viewer-only filesRuntime: no weakening of its
// exact path/session/PUT matcher and no changes to central support.
export async function navigationRuntime(t, route, setup = () => {}, lifecycle = {}) {
  const cleanup = [], releases = [], externalWork = [], externalAcks = [], restores = [], realmRestores = [], removes = [], timers = new Map(), frames = new Map(), intervals = new Map();
  let view, work, transport, sequence = 0, closing = false;
  let realmRestoration, beforeDisposal, mountReturned = false, terminal = false;
  let restoreConsoleObserver = () => {};
  const after = { after(fn) { cleanup.push(fn); } };
  const errors = [], observedFailures = [], routeAttempts = [];
  const observeFailure = (label, error) => { observedFailures.push(new Error(label, { cause: error })); };
  const describe = (error, depth = 0) => {
    if (!isNativeError(error)) return '[non-Error cause retained without inspection]';
    const name = typeof error.name === 'string' ? error.name : 'Error';
    const message = typeof error.message === 'string' ? error.message.slice(0, 360) : '';
    let text = `${name}: ${message}`;
    if (depth < 2 && error.cause !== undefined) text += ` <- ${describe(error.cause, depth + 1)}`;
    if (depth < 2 && error instanceof AggregateError) text += ` [${error.errors.slice(0, 3).map(cause => describe(cause, depth + 1)).join('; ')}]`;
    return text.slice(0, 1100);
  };
  const diagnosticFailure = (label, original) => {
    const causes = [original, ...observedFailures];
    const details = observedFailures.slice(-5).map(error => describe(error)).join(' | ');
    const routes = routeAttempts.slice(-8).join(' | ');
    return new AggregateError(causes, `${label}: ${describe(original)}${details ? `; original local causes: ${details}` : '; shared helper does not expose its private cause list'}; recent routes: ${routes}`.slice(0, 3600));
  };
  const assertHealthy = () => {
    try { transport.assertHealthy(); }
    catch (error) { throw diagnosticFailure('Navigation guarded lifetime failed', error); }
  };
  const attempt = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
  const replace = (object, key, value, realmOverride = false) => {
    const old = Object.getOwnPropertyDescriptor(object, key);
    (realmOverride ? realmRestores : restores).push(() => old ? Object.defineProperty(object, key, old) : delete object[key]);
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  };
  // Terminal's explicit realm-override contract: setup replacements unwind before
  // central realm/global cleanup; upfront host replacements unwind afterwards.
  const replaceRealm = (object, key, value) => replace(object, key, value, true);
  // Separate idempotent domain join: safe for the parent-owned beforeDispose
  // contract even if setup/render fails before mount returns a view. No circular
  // view.dispose call, no universal idle, and guards stay live through realm close.
  const observeExternal = work => {
    const original = Promise.resolve(work); externalWork.push(original);
    const ack = original.then(undefined, error => { errors.push(error); });
    externalAcks.push(ack); return original;
  };
  const releaseKnown = () => {
    closing = true;
    // SYNCHRONOUS and independently attempted. Never await one release before
    // readers/XHR/HTTP peers; returned original work is owned for later joins.
    for (const fn of releases.splice(0)) { try { const result = fn(); if (result?.then) observeExternal(result); } catch (error) { errors.push(error); } }
    for (const request of transport?.requests ?? []) {
      try { request.reply(request.answered ? request.replyData : { error: 'owned teardown' }, request.answered ? request.replyStatus : 503); }
      catch (error) { errors.push(error); }
    }
  };
  const beforeUnmount = () => {
    releaseKnown();
    // Optional fixture-only observation; the central API/React remain unchanged.
    try { const result = lifecycle.beforeUnmount?.(releaseKnown); if (result?.then) observeExternal(result); }
    catch (error) { errors.push(error); }
  };
  const terminalDispose = dispose => {
    terminal = true;
    releaseKnown();
    return dispose();
  };
  const releaseFrames = () => {
    // Keep the existing finite frame delivery at its later domain-drain phase;
    // early peer release does not advance a clock or manufacture UI work.
    const admittedFrames = [...frames.values()]; frames.clear();
    for (const callback of admittedFrames) { try { callback(0); } catch (error) { errors.push(error); } }
  };
  let settlement;
  const settleDomain = () => settlement ??= (async () => {
    releaseKnown(); // Before act invocation, not only inside its callback.
    await attempt(() => act(async () => { releaseKnown(); releaseFrames(); await work?.settle(); }));
    releaseKnown(); releaseFrames(); await attempt(() => work?.settle());
    for (const result of await Promise.allSettled([...externalWork, ...externalAcks])) if (result.status === 'rejected') errors.push(result.reason);
  })();
  const restoreRealmOverrides = () => realmRestoration ??= (async () => {
    const failures = [];
    for (const restore of realmRestores.toReversed()) {
      try { restore(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Navigation realm overrides restoration failed');
  })();
  // Like Terminal, join and restore independently, retaining every original
  // failure. Never call view.dispose from the callback that it awaits.
  const beforeDispose = () => beforeDisposal ??= (async () => {
    const failures = [];
    try { await settleDomain(); } catch (error) { failures.push(error); }
    try { await restoreRealmOverrides(); } catch (error) { failures.push(error); }
    // Leaf setup owns the eight transport descriptors. Transfer their rollback
    // into this pre-close phase; leaf cleanup must not reinstall them afterward.
    try { transport?.restoreRealm(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Navigation before-disposal failed');
  })();
  // Register before import or partial setup. Do not rely on t.after ordering
  // between independently owned transport and DOM fixtures.
  let disposal;
  const dispose = () => disposal ??= (async () => {
    terminal = true;
    beforeUnmount(); // ALL known peers before the FIRST outer owned wait.
    await attempt(() => view?.unmount());
    await attempt(beforeDispose);
    await attempt(() => view?.dispose());
    // Restore HOST capabilities while both live collectors still observe them.
    // Only then remove our console observer and let the leaf retire its wrapper;
    // never reinstall a stale common wrapper after that lifetime.
    for (const fn of restores.toReversed()) await attempt(fn);
    await attempt(() => lifecycle.afterHostRestore?.());
    await attempt(restoreConsoleObserver);
    for (const fn of cleanup) await attempt(fn);
    // Diagnostic listeners are not realm overrides: keep them through central,
    // transport and host restoration, including failed setup with no view.
    for (const fn of removes.toReversed()) await attempt(fn);
    if (errors.length || observedFailures.length) throw diagnosticFailure('Navigation lifetime cleanup failed', new AggregateError(errors, 'all original cleanup failures'));
  })();
  t.after(dispose);
  transport = controlledLeafFetch(after, request => {
    const label = `${request.options.method ?? 'GET'} ${request.url.pathname}${request.url.search}`.slice(0, 240);
    routeAttempts.push(label);
    try {
      assert.equal(closing, false, 'no new transport after navigation admission closes');
      return route(request);
    } catch (error) { observeFailure(`route ${label}`, error); throw error; }
  });
  // Forward to the common collector AND original console; never suppress a
  // diagnostic or clear either collector. Scalar/native-Error arguments only.
  const commonConsoleDescriptor = Object.getOwnPropertyDescriptor(console, 'error');
  const commonConsoleError = console.error;
  restoreConsoleObserver = () => {
    if (commonConsoleDescriptor) Object.defineProperty(console, 'error', commonConsoleDescriptor);
    else delete console.error;
  };
  Object.defineProperty(console, 'error', { configurable: true, writable: true, value: (...args) => {
    for (const error of args.filter(isNativeError)) observeFailure('console.error original Error', error);
    const text = args.filter(value => typeof value === 'string').join(' ').slice(0, 1000);
    if (text) observeFailure('console.error text', new Error(text));
    return commonConsoleError.apply(console, args);
  } });
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
  const { NavigationWork, NavigationWorkContext } = await jiti.import('../lib/navigation-work.ts');
  work = new NavigationWork();
  // One physical production graph: stores, controls and adapters share identity.
  const graph = await jiti.import('./navigation-composition.fixture.tsx');
  const setTimeout = (callback, delay, ...args) => {
    transport.check(() => assert.equal(closing, false, `late timer admission (${delay}ms)`));
    const id = ++sequence; timers.set(id, { callback, delay, args }); return id;
  };
  const clearTimeout = id => timers.delete(id);
  replace(globalThis, 'setTimeout', setTimeout); replace(globalThis, 'clearTimeout', clearTimeout);
  const api = {
    ...transport, graph, work,
    assertHealthy, dispose, releaseKnown, beforeUnmount,
    check(fn) {
      // The shared guard retains a private cause list. Keep the SAME actual
      // domain callback error observable here before delegating its collection.
      return transport.check(() => {
        try { return fn(); }
        catch (error) { observeFailure('guarded domain callback', error); throw error; }
      });
    },
    async reply(...args) {
      try { return await transport.reply(...args); }
      catch (error) { throw diagnosticFailure('Navigation response release failed', error); }
    },
    releaseOnClose(fn) { releases.push(fn); },
    get view() { return view; },
    async render(element) {
      const wrapped = createElement(NavigationWorkContext.Provider, { value: work }, createElement(graph.I18nProvider, null, element));
      if (view) { await view.rerender(wrapped); return view; }
      const owner = { after(dispose) { after.after(() => terminalDispose(dispose)); } };
      view = await mount(owner, wrapped, { beforeUnmount() {
        if (!mountReturned || terminal) beforeUnmount();
      }, beforeDispose, setup(window) {
        lifecycle.beforeSetup?.(window);
        transport.setup(window);
        const reportOriginal = event => observeFailure(`window ${event.type}`, event.error ?? event.reason ?? new Error(String(event.message ?? event.type)));
        window.addEventListener('error', reportOriginal);
        window.addEventListener('unhandledrejection', reportOriginal);
        removes.push(() => {
          window.removeEventListener('error', reportOriginal);
          window.removeEventListener('unhandledrejection', reportOriginal);
        });
        for (const [key, value] of Object.entries({ localStorage: window.localStorage, sessionStorage: window.sessionStorage })) replaceRealm(globalThis, key, value);
        const frame = callback => { transport.check(() => assert.equal(closing, false, 'late animation admission')); const id = ++sequence; frames.set(id, callback); return id; };
        const cancelFrame = id => frames.delete(id);
        for (const target of [globalThis, window]) {
          replaceRealm(target, 'requestAnimationFrame', frame); replaceRealm(target, 'cancelAnimationFrame', cancelFrame);
          replaceRealm(target, 'setTimeout', setTimeout); replaceRealm(target, 'clearTimeout', clearTimeout);
        }
        replaceRealm(window, 'setInterval', (callback, delay) => { transport.check(() => assert.equal(closing, false, 'late interval admission')); const id = ++sequence; intervals.set(id, { callback, delay }); return id; });
        replaceRealm(window, 'clearInterval', id => intervals.delete(id));
        replaceRealm(window, 'matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
        class ResizeObserver {
          observe() {} unobserve() {} disconnect() {}
        }
        replaceRealm(globalThis, 'ResizeObserver', ResizeObserver); replaceRealm(window, 'ResizeObserver', ResizeObserver);
        replaceRealm(window.HTMLElement.prototype, 'scrollIntoView', function () {});
        replaceRealm(window.HTMLDialogElement.prototype, 'showModal', function () { this.open = true; });
        replaceRealm(window.HTMLDialogElement.prototype, 'close', function () { this.open = false; });
        setup(window, replaceRealm);
      } });
      // Observer unmount remains distinct from explicit/registered teardown.
      const mounted = view;
      mountReturned = true;
      view = { ...mounted, dispose: () => terminalDispose(mounted.dispose) };
      return view;
    },
    async fire(delay) {
      const entries = [...timers].filter(([, timer]) => timer.delay === delay);
      assert.ok(entries.length, `named ${delay}ms policy/debounce timer exists`);
      await act(async () => {
        for (const [id, timer] of entries) { if (!timers.delete(id)) continue; timer.callback(...timer.args); }
      });
    },
    async frame() {
      const current = [...frames]; frames.clear();
      await act(async () => { for (const [, callback] of current) callback(0); });
    },
    async poll() {
      assert.ok([...intervals.values()].some(timer => timer.delay === 15000));
      await act(async () => { for (const timer of intervals.values()) if (timer.delay === 15000) timer.callback(); });
    },
    get intervalCount() { return intervals.size; },
    pendingTimerCount() { return timers.size; },
    headers(request, status = 200) {
      return act(async () => {
        assert.ok(transport.requests.includes(request));
        request.response.resolve({ ok: status >= 200 && status < 300, status, json() {
          request.jsonCalls++;
          return request.body.promise.then(value => { request.bodyReturned = true; return value; });
        } });
        await request.fetchWork;
      });
    },
    async body(request, data) {
      await act(async () => { request.body.resolve(data); await request.body.promise; });
      assert.equal(request.bodyReturned, true, 'obsolete body actually returned through production json()');
      assertHealthy();
    },
    async rejectBody(request, error = new Error('controlled body failure')) {
      await act(async () => { request.body.reject(error); await Promise.allSettled([request.body.promise]); });
      assertHealthy();
    },
    async settled() { await act(async () => { await work.settle(); }); assertHealthy(); },
    latest(path, method = 'GET') {
      const found = transport.requests.filter(request => request.url.pathname === path && (request.options.method ?? 'GET') === method).at(-1);
      assert.ok(found, `accepted ${method} ${path}`); return found;
    },
  };
  return api;
}

export function exact(request, path, query = {}, { method = 'GET', body, headers = {}, signal, cache } = {}) {
  assert.equal(request.url.pathname, path);
  assert.equal(request.options.method ?? 'GET', method);
  exactQuery(request, query); exactHeaders(request, headers);
  if (body !== undefined) assert.deepEqual(JSON.parse(request.options.body), body);
  else assert.equal(request.options.body, undefined);
  if (signal !== undefined) assert.equal(Boolean(request.options.signal), signal);
  if (cache !== undefined) assert.equal(request.options.cache, cache);
}
export function button(view, label, root = view.container) {
  const found = [...root.querySelectorAll('button')].filter(node => node.getAttribute('aria-label') === label || node.getAttribute('title') === label || node.textContent.trim() === label);
  assert.equal(found.length, 1, `one control: ${label}`); return found[0];
}
export function row(view, id) { const node = view.container.querySelector(`[data-session-id="${id}"]`); assert.ok(node, `row ${id}`); return node; }
export const session = (id, cwd = '/repo', extra = {}) => ({ id, path: `/saved/${id}.jsonl`, cwd, projectRoot: '/repo', projectKey: '/repo', created: '2026-01-01T00:00:00Z', modified: '2026-01-02T00:00:00Z', messageCount: 1, firstMessage: id, ...extra });
