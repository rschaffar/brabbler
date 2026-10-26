import assert from 'node:assert/strict';
import { createElement as h, act } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const sorted = entries => [...entries].sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d));
const scalarError = error => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Local settings capability fixture; no child, hook or decision substitution.
 * Requires SettingsWorkContext's passive full-operation observations.
 * Does not claim browser networking, layout, SDK, native auth or persistence.
 */
export async function settingsFixture(t, { beforeRestore, loadGraph, capabilities, audioContext } = {}) {
  const failures = [], descriptors = [], routes = [], requests = [], works = [], gates = [], continuations = [], timers = new Map();
  const realmDisposers = [], capabilitySettlers = [], realmDescriptors = [];
  let view, graph, admission = true, autoBodies = false, timerId = 0, disposed = false;
  const fail = error => { failures.push(error); return error; };
  const save = (object, key, value, realm = false) => {
    const previous = Object.getOwnPropertyDescriptor(object, key);
    (realm ? realmDescriptors : descriptors).push(() => {
      const errors = [];
      // Bounded fault/observation capability only. A throwing observer MUST NOT
      // skip the original descriptor restoration or any independent peer.
      try { beforeRestore?.({ target: object, key }); } catch (error) { errors.push(error); }
      try { if (previous) Object.defineProperty(object, key, previous); else delete object[key]; }
      catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Settings descriptor restoration failed');
    });
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  };
  const saveRealm = (object, key, value) => save(object, key, value, true);
  const deny = name => function () { throw fail(new Error(`Unsupported settings capability: ${name}`)); };
  const onRejection = error => fail(error);
  const onException = error => fail(error);
  const consoleError = console.error;
  // Forward diagnostics unchanged; a caught React diagnostic remains a failure.
  save(console, 'error', (...args) => {
    for (const error of args) if (error instanceof Error) fail(error);
    fail(new Error(args.map(scalarError).join(' ').slice(0, 2000)));
    consoleError(...args);
  });
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtExceptionMonitor', onException);
  const observe = (label, promise) => {
    const entry = { label, promise, settled: false };
    works.push(entry);
    promise.then(() => { entry.settled = true; }, error => { entry.settled = true; fail(error); });
  };
  // An explicit label is a full production operation, not a body-return marker.
  const join = async label => {
    let cursor = 0;
    while (cursor < works.length) {
      const batch = works.slice(cursor); cursor = works.length;
      await Promise.allSettled(batch.filter(work => !label || work.label === label).map(work => work.promise));
    }
  };
  const check = () => {
    if (!failures.length) return;
    // Failure-only bounded primitive diagnostics. Preserve every original cause;
    // never stringify React/Window objects or turn reporting into a new owner.
    const messages = failures.slice(0, 4).map(failure => {
      if (failure instanceof Error) return failure.message.slice(0, 600);
      if (failure === null || ['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof failure)) return String(failure).slice(0, 600);
      return 'non-Error object';
    });
    throw new AggregateError([...failures], `Settings fixture failures (${failures.length}); original causes: ${messages.join(' | ')}`);
  };
  const gate = label => {
    const d = deferred(); const value = { ...d, label, released: false,
      release() { value.released = true; d.resolve(); } };
    gates.push(value); return value;
  };
  const fetchDouble = async (input, init = {}) => {
    try {
      assert.equal(typeof input, 'string', 'fixture supports production string fetches only');
      const url = new URL(input, 'https://fixture.invalid');
      assert.equal(url.origin, 'https://fixture.invalid', 'exact fetch origin');
      const method = (init.method ?? 'GET').toUpperCase();
      const route = routes.find(r => r.method === method && r.path === url.pathname);
      assert.equal(Boolean(route), true, `unexpected ${method} ${url.pathname}`);
      assert.deepEqual(sorted(url.searchParams), sorted(Object.entries((typeof route.query === 'function' ? route.query() : route.query) ?? {})), 'exact query keys and values');
      assert.deepEqual(sorted(new Headers(init.headers)), sorted(Object.entries(route.headers ?? (init.body === undefined ? {} : { 'content-type': 'application/json' }))), 'exact request headers');
      if (route.body !== undefined) assert.deepEqual(JSON.parse(init.body), typeof route.body === 'function' ? route.body() : route.body, 'exact request JSON');
      else assert.equal(init.body, undefined, 'no request body');
      if (route.cache !== undefined) assert.equal(init.cache, route.cache, 'request cache policy');
      const request = { method, path: url.pathname, query: sorted(url.searchParams), body: init.body === undefined ? undefined : JSON.parse(init.body), serializedBody: init.body, signal: init.signal };
      if (!admission) {
        // Only an exact, one-shot continuation explicitly admitted BEFORE disposal
        // may drain. This never grants arbitrary late roots or retries.
        const index = continuations.findIndex(c => c.method === method && c.path === url.pathname && JSON.stringify(c.body) === JSON.stringify(request.body));
        assert.equal(index >= 0, true, `unexpected late ${method} ${url.pathname}`);
        continuations.splice(index, 1);
      }
      requests.push(request);
      const reply = typeof route.reply === 'function' ? route.reply(request) : route.reply;
      assert.equal(Boolean(reply), true, 'explicit response required');
      // Expected external fetch rejection bypasses the fixture-defect catch;
      // production still receives and handles the original rejection value.
      if (Object.hasOwn(reply, 'fetchError')) {
        request.manual = true; // No response/body gate exists for fetch rejection.
        return Promise.reject(reply.fetchError);
      }
      const bodyGate = reply.gate ?? gate(`${method} ${url.pathname} body`);
      if (!reply.gate && autoBodies) bodyGate.release();
      request.gate = bodyGate;
      request.manual = Boolean(reply.gate);
      const response = new Response(reply.jsonText === undefined ? JSON.stringify(reply.data ?? {}) : reply.jsonText, { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
      const json = response.json.bind(response);
      response.json = async () => {
        await bodyGate.promise;
        if (Object.hasOwn(reply, 'bodyError')) throw reply.bodyError; // Named expected operational failure, not a fixture exception.
        try { return await json(); } catch (error) {
          if (reply.expectedJsonError === true) throw error;
          throw fail(error);
        }
      };
      return response;
    } catch (error) { throw fail(error); }
  };
  // The parent-owned beforeDispose contract also calls this after a failed mount,
  // when no view was returned. It never calls view.dispose (no circular join).
  let domainSettlement;
  const settleDomain = () => domainSettlement ??= (async () => {
    admission = false;
    autoBodies = true; // Future exact admitted continuations must also drain on failed mount.
    const errors = [];
    const attempt = async callback => { try { await callback(); } catch (error) { errors.push(error); } };
    // Start every peer release before awaiting ANY settler or work. A settler
    // may itself await a body gate; invocation failure cannot skip peers.
    const settlements = [];
    for (const settle of capabilitySettlers) {
      try { settlements.push(Promise.resolve(settle())); } catch (error) { errors.push(error); }
    }
    for (const g of gates) {
      try { g.release(); } catch (error) { errors.push(error); }
    }
    for (const result of await Promise.allSettled(settlements)) if (result.status === 'rejected') errors.push(result.reason);
    await attempt(() => act(async () => { await join(); }));
    await attempt(() => act(async () => {
      const callbacks = [...timers.values()]; timers.clear();
      for (const timer of callbacks) { try { timer.callback(); } catch (error) { fail(error); } }
      await join();
      if (timers.size) fail(new Error('Unexpected timer admission while disposing settings'));
    }));
    if (errors.length) throw new AggregateError(errors, 'Settings domain settlement');
  })();
  // Realm overrides must unwind before the mount owner closes JSDOM, also
  // when setup fails and no view escapes. Host guards/collectors stay live.
  let realmRestoration;
  const restoreRealm = () => realmRestoration ??= (async () => {
    const errors = [];
    for (const restore of realmDescriptors.toReversed()) {
      try { restore(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Settings realm restoration');
  })();
  const beforeDispose = async () => {
    const errors = [];
    try { await settleDomain(); } catch (error) { errors.push(error); }
    try { await restoreRealm(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Settings before-disposal failures');
  };
  // Register failure cleanup before production imports or work admission.
  const cleanup = async () => {
    if (disposed) return; disposed = true;
    const cleanupErrors = [];
    const attempt = async callback => { try { await callback(); } catch (error) { cleanupErrors.push(error); } };
    admission = false;
    await attempt(async () => { await view?.unmount(); });
    await attempt(beforeDispose);
    for (const dispose of realmDisposers) await attempt(dispose);
    for (const restore of descriptors.toReversed()) await attempt(restore);
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtExceptionMonitor', onException);
    if (failures.length || cleanupErrors.length) throw new AggregateError([...failures, ...cleanupErrors], 'Settings work/cleanup failures');
  };
  t.after(cleanup);
  save(globalThis, 'fetch', fetchDouble);
  for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest', 'Worker', 'Audio', 'AudioContext']) save(globalThis, name, name === 'AudioContext' && audioContext ? audioContext : deny(`host ${name}`));
  save(globalThis, 'setTimeout', (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; });
  save(globalThis, 'clearTimeout', id => timers.delete(id));
  save(globalThis, 'setInterval', deny('host interval'));
  // These APIs are explicit unsupported geometry/scheduling capabilities, not native layout.
  save(globalThis, 'requestAnimationFrame', callback => { const id = ++timerId; timers.set(id, { callback: () => callback(0), delay: 'frame' }); return id; });
  save(globalThis, 'cancelAnimationFrame', id => timers.delete(id));
  save(globalThis, 'ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  // Family-local capability port: installed after guards, before production import.
  // Its settlers run independently before work joins, including failed setup.
  capabilities?.({ save, saveRealm, fail, observe, onSettle(callback) { capabilitySettlers.push(callback); } });
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
  const graphs = {
    all: () => jiti.import('./settings-composition.fixture.tsx'),
    ui: () => jiti.import('./settings-ui.fixture.tsx'),
    fonts: () => jiti.import('./settings-fonts.fixture.tsx'),
    agents: () => jiti.import('./settings-agents.fixture.tsx'),
    enabled: () => jiti.import('./settings-enabled.fixture.tsx'),
    models: () => jiti.import('./settings-models.fixture.tsx'),
    preferences: () => jiti.import('./settings-preferences.fixture.tsx'),
  };
  const load = async (family = 'all') => {
    if (!graph) graph = await (loadGraph ? loadGraph() : graphs[family]());
    return graph;
  };
  const wrap = element => h(graph.I18nProvider, null, h(graph.SettingsWorkContext.Provider, { value: observe }, element));
  const commit = async (callback, label) => {
    await act(async () => {
      autoBodies = true;
      for (const request of requests) if (!request.manual) request.gate.release();
      await callback?.();
      await join(label);
    });
    check();
  };
  const api = {
    requests, works, gate, check, join, cleanup, load,
    route(method, path, options) { routes.push({ method, path, ...options }); },
    admitContinuation(method, path, body) {
      assert.equal(admission, true, 'continuation admission is closed');
      continuations.push({ method, path, body: body === undefined ? undefined : structuredClone(body) });
    },
    async mount(element, { setup, settle = true } = {}) {
      await load();
      view = await mount({ after(dispose) { realmDisposers.push(dispose); } }, wrap(element), { beforeDispose, setup: async window => {
        for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest', 'Worker', 'Audio', 'AudioContext']) saveRealm(window, name, name === 'AudioContext' && audioContext ? audioContext : deny(`realm ${name}`));
        saveRealm(window, 'fetch', fetchDouble);
        for (const name of ['setTimeout', 'clearTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame']) saveRealm(window, name, globalThis[name]);
        saveRealm(globalThis, 'localStorage', window.localStorage);
        saveRealm(window.navigator, 'sendBeacon', deny('beacon'));
        saveRealm(window, 'open', deny('popup'));
        saveRealm(window, 'matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
        window.addEventListener('error', event => fail(event.error ?? new Error(event.message)));
        window.addEventListener('unhandledrejection', event => fail(event.reason));
        await setup?.(window);
      } });
      if (settle) await commit();
      return view;
    },
    get view() { return view; },
    node(selector) { const node = view.container.querySelector(selector); assert.equal(node !== null, true, `node ${selector}`); return node; },
    text() { return view.container.textContent; },
    async rerender(element) { await view.rerender(wrap(element)); check(); },
    commit,
    async deliver(g, label) { await act(async () => { g.release(); await join(label); }); check(); },
    async click(target, { settle = true } = {}) {
      const node = typeof target === 'string' ? api.node(target) : target;
      assert.equal(node.disabled === true, false, 'user action is enabled');
      await act(async () => { node.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true })); if (settle) await join(); }); check();
    },
    async input(target, value, { settle = true } = {}) {
      const node = typeof target === 'string' ? api.node(target) : target;
      assert.equal(node.disabled === true, false, 'user field is enabled');
      const prototype = node.tagName === 'SELECT' ? view.window.HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? view.window.HTMLTextAreaElement.prototype : view.window.HTMLInputElement.prototype;
      await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value); node.dispatchEvent(new view.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); if (settle) await join(); }); check();
    },
    button(text, root = view.container) { const nodes = [...root.querySelectorAll('button')].filter(n => n.textContent.trim() === text); assert.equal(nodes.length, 1, `one button ${text}`); return nodes[0]; },
    async timers(delay) { await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } await join(); }); check(); },
  };
  return api;
}
