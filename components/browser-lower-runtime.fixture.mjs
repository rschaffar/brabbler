import assert from 'node:assert/strict';
import { isNativeError } from 'node:util/types';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
export { click, inputText } from '../lib/testing/leaf-controls.fixture.mjs';

// Local support only. No source extraction, mocked React/children, native backend,
// sleeps, universal flush, global timer acceleration or new scheduling family.
export async function lowerRuntime(t, route, setup = () => {}) {
  const errors = [], requests = [], restores = [], listeners = [], releases = [], joins = [], routeLabels = [];
  const timers = new Map(), intervals = new Map(), frames = new Map();
  let sequence = 0, view, work, closing = false, settlement, beforeRealm = '';
  // Diagnostics inspect only native Error data descriptors and bounded scalar
  // DOM labels. Never serialize assertion actual/expected, DOM, fibers or tokens.
  const errorText = (error, depth = 0) => {
    try {
      if (!isNativeError(error)) return '[non-Error original retained]';
      const own = key => Object.getOwnPropertyDescriptor(error, key)?.value;
      const message = own('message');
      let text = typeof message === 'string' ? message.slice(0, 700) : '[native Error without scalar message]';
      if (depth < 2) {
        const cause = own('cause'); if (cause !== undefined) text += ` <- ${errorText(cause, depth + 1)}`;
        const children = own('errors');
        if (Array.isArray(children)) text += ` [${children.slice(0, 4).map(child => errorText(child, depth + 1)).join(' | ')}${children.length > 4 ? ' | more originals retained' : ''}]`;
      }
      return text.slice(0, 1700);
    } catch { return '[diagnostic inspection unavailable; original retained]'; }
  };
  const diagnostic = label => {
    let dom = 'realm/view not returned';
    try {
      if (view) {
        const sections = [...view.container.querySelectorAll('section[aria-label]')].slice(0, 6).map(node => node.getAttribute('aria-label')?.slice(0, 120));
        const statuses = [...view.container.querySelectorAll('[role="status"], [role="alert"]')].slice(0, 6).map(node => node.textContent?.slice(0, 160));
        const buttons = [...view.container.querySelectorAll('button')].slice(0, 18).map(node => `${node.textContent?.trim().slice(0, 70)}:${node.disabled ? 'disabled' : 'enabled'}`);
        dom = `sections=${JSON.stringify(sections)} statuses=${JSON.stringify(statuses)} buttons=${JSON.stringify(buttons)}`;
      }
    } catch { dom = 'scalar DOM diagnostic unavailable'; }
    return `${label}; original errors(${errors.length}): ${errors.slice(0, 4).map(error => errorText(error)).join(' | ')}; recent routes: ${routeLabels.slice(-10).join(' | ')}; ${dom}`.slice(0, 6000);
  };
  const after = { after() {} }; // This owner explicitly orders unmount/join/realm close.
  const attempt = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
  const check = fn => { try { return fn(); } catch (error) { errors.push(error); throw error; } };
  const replace = (object, key, value) => {
    const old = Object.getOwnPropertyDescriptor(object, key);
    check(() => Object.defineProperty(object, key, { configurable: true, writable: true, value }));
    restores.push(() => old ? Object.defineProperty(object, key, old) : delete object[key]);
  };
  const listen = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };
  const releaseAll = () => {
    for (const release of releases.splice(0)) { try { const result = release(); if (result?.then) { void result.catch(error => errors.push(error)); joins.push(result); } } catch (error) { errors.push(error); } }
    for (const request of requests) {
      // Independently release both gates even when a peer/release throws.
      try { request.response.resolve({ ok: false, status: 503, json: request.json }); } catch (error) { errors.push(error); }
      try { request.body.resolve({ error: 'owned teardown' }); } catch (error) { errors.push(error); }
    }
  };
  const settleDomain = () => settlement ??= (async () => {
    closing = true;
    await attempt(() => act(async () => { releaseAll(); await work?.settle(); }));
    releaseAll();
    // act/release failure cannot skip the actual independent owner joins.
    await attempt(() => work?.settle());
    for (const result of await Promise.allSettled([...joins, ...requests.map(r => r.fetchWork), ...requests.flatMap(r => r.bodyWork ? [r.bodyWork] : [])])) {
      // Deliberate HTTP/body failures are inputs; unexpected fixture/runtime errors
      // live in errors independently, including production-caught route failures.
      void result;
    }
    // Capture while the realm and guards still exist; keep the live errors
    // array intact through disposal/restoration and include any later failures.
    beforeRealm = diagnostic('After independent joins, before realm disposal');
  })();
  t.after(async () => {
    await attempt(() => view?.unmount()); // admits the UI's existing stop writes
    await attempt(settleDomain);
    await attempt(() => view?.dispose());
    for (const restore of restores.toReversed()) await attempt(restore);
    for (const remove of listeners.toReversed()) await attempt(remove);
    if (errors.length) throw new AggregateError(errors, `${diagnostic('Lower UI guarded lifetime (original causes retained)')}; joined snapshot: ${beforeRealm.slice(0, 1800)}`);
  });
  const failPort = label => function () { return check(() => { throw new Error(`Unsupported lower UI capability: ${label}`); }); };
  const guard = (target, label) => {
    for (const key of ['XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker']) replace(target, key, failPort(`${label}.${key}`));
  };
  const monitor = error => errors.push(new Error('uncaught exception', { cause: error }));
  process.on('uncaughtExceptionMonitor', monitor); listeners.push(() => process.off('uncaughtExceptionMonitor', monitor));
  const consoleError = console.error;
  replace(console, 'error', (...args) => {
    errors.push(new AggregateError(args.filter(arg => arg instanceof Error), `console.error: ${args.filter(arg => typeof arg === 'string').join(' ').slice(0, 1200)}`));
    return consoleError.apply(console, args);
  });
  guard(globalThis, 'host');
  if (globalThis.navigator) replace(globalThis.navigator, 'sendBeacon', failPort('host beacon'));
  const fetch = (input, options = {}) => {
    try { return check(() => {
      assert.equal(closing, false, 'no late HTTP admission'); assert.equal(typeof input, 'string');
      const url = new URL(input, 'https://fixture.invalid');
      assert.equal(url.origin, 'https://fixture.invalid'); assert.equal(url.hash, ''); assert.equal(url.username, ''); assert.equal(url.password, '');
      const response = deferred(), body = deferred();
      // Retain expected rejection inputs without changing production's rejection.
      void body.promise.catch(() => {});
      const request = { url, options, response, body, jsonCalls: 0, returned: false };
      request.json = () => {
        request.jsonCalls++;
        request.bodyWork = body.promise.then(value => { request.returned = true; return value; });
        void request.bodyWork.catch(() => {}); return request.bodyWork;
      };
      request.fetchWork = response.promise; requests.push(request);
      routeLabels.push(`${typeof options.method === 'string' ? options.method : 'GET'} ${url.pathname}${url.search}`.slice(0, 320));
      const data = route(request); // a caught route assertion remains in errors
      if (data !== undefined) { body.resolve(data); response.resolve({ ok: true, status: 200, json: request.json }); }
      return request.fetchWork;
    }); } catch (error) { return Promise.reject(error); }
  };
  replace(globalThis, 'fetch', fetch); // guards precede the production graph import
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true,
    alias: { [new URL('./WorktreeManager.module.css', import.meta.url).pathname]: new URL('./browser-lower-style.fixture.mjs', import.meta.url).pathname,
      './WorktreeManager.module.css': new URL('./browser-lower-style.fixture.mjs', import.meta.url).pathname } });
  const graph = await jiti.import('./browser-lower-composition.fixture.tsx');
  work = new graph.NavigationWork();
  const timer = (map, callback, delay, args = []) => check(() => {
    assert.equal(closing, false, `no late clock admission ${delay}`); const id = ++sequence; map.set(id, { callback, delay, args }); return id;
  });
  const api = {
    graph, requests, errors, work, diagnostic,
    get view() { return view; },
    releaseOnClose(fn) { releases.push(fn); },
    joinOnClose(promise) { void promise.catch(error => errors.push(new Error('owned external join failed', { cause: error }))); joins.push(promise); },
    assertHealthy() { if (errors.length) throw new AggregateError(errors, diagnostic('Live lower fixture failures')); },
    latest(path, method = 'GET') { const found = requests.filter(r => r.url.pathname === path && (r.options.method ?? 'GET') === method).at(-1); assert.ok(found, `admitted ${method} ${path}`); return found; },
    async headers(r, status = 200) { await act(async () => { r.response.resolve({ ok: status >= 200 && status < 300, status, json: r.json }); await r.fetchWork; }); api.assertHealthy(); },
    async body(r, value) { await act(async () => { r.body.resolve(value); if (r.bodyWork) await r.bodyWork; }); assert.equal(r.returned, true, 'real JSON body continuation consumed'); api.assertHealthy(); },
    async rejectBody(r, error = new SyntaxError('declared malformed JSON')) { await act(async () => { r.body.reject(error); if (r.bodyWork) await Promise.allSettled([r.bodyWork]); }); api.assertHealthy(); },
    async reply(r, value = {}, status = 200) { await api.headers(r, status); if (r.jsonCalls) await api.body(r, value); else r.body.resolve(value); },
    async idle() { await act(async () => { await work.settle(); }); api.assertHealthy(); },
    async fire(delay) {
      const admitted = [...timers].filter(([, value]) => value.delay === delay); assert.ok(admitted.length, `named ${delay}ms policy timer`);
      await act(async () => { for (const [id, value] of admitted) if (timers.delete(id)) value.callback(...value.args); }); api.assertHealthy();
    },
    async frame() { const admitted = [...frames]; frames.clear(); await act(async () => { for (const [, value] of admitted) value.callback(0); }); },
    async interval(delay) { const admitted = [...intervals.values()].filter(v => v.delay === delay); assert.ok(admitted.length); await act(async () => { for (const value of admitted) value.callback(...value.args); }); },
    timerCount(delay) { return [...timers.values()].filter(value => delay === undefined || value.delay === delay).length; },
    async render(element, observer = work) {
      const wrapped = createElement(graph.NavigationWorkContext.Provider, { value: observer }, createElement(graph.I18nProvider, null, element));
      if (view) { await view.rerender(wrapped); return; }
      view = await mount(after, wrapped, { beforeDispose: settleDomain, setup(window) {
        guard(window, 'realm'); replace(window, 'fetch', fetch); replace(window, 'open', failPort('window.open')); replace(window.navigator, 'sendBeacon', failPort('beacon'));
        listen(window, 'error', event => errors.push(new Error('window error', { cause: event.error })));
        listen(window, 'unhandledrejection', event => errors.push(new Error('window rejection', { cause: event.reason })));
        for (const target of [globalThis, window]) {
          replace(target, 'setTimeout', (fn, delay, ...args) => timer(timers, fn, delay, args)); replace(target, 'clearTimeout', id => timers.delete(id));
          replace(target, 'setInterval', (fn, delay, ...args) => timer(intervals, fn, delay, args)); replace(target, 'clearInterval', id => intervals.delete(id));
          replace(target, 'requestAnimationFrame', fn => timer(frames, fn, 0)); replace(target, 'cancelAnimationFrame', id => frames.delete(id));
        }
        replace(globalThis, 'localStorage', window.localStorage); replace(globalThis, 'sessionStorage', window.sessionStorage);
        replace(window, 'matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
        class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
        replace(globalThis, 'ResizeObserver', ResizeObserver); replace(window, 'ResizeObserver', ResizeObserver);
        replace(window.HTMLElement.prototype, 'scrollIntoView', function () {});
        replace(window.HTMLDialogElement.prototype, 'showModal', function () { this.open = true; }); replace(window.HTMLDialogElement.prototype, 'close', function () { this.open = false; });
        setup(window, replace);
      } });
    },
  };
  return api;
}

export function exact(r, path, query = {}, { method = 'GET', body, headers = {}, signal, cache } = {}) {
  assert.equal(r.url.pathname, path); assert.equal(r.options.method ?? 'GET', method);
  assert.deepEqual([...r.url.searchParams].sort(), Object.entries(query).sort());
  assert.deepEqual([...new Headers(r.options.headers)].sort(), [...new Headers(headers)].sort());
  if (body !== undefined) assert.deepEqual(JSON.parse(r.options.body), body); else assert.equal(r.options.body, undefined);
  if (signal !== undefined) assert.equal(Boolean(r.options.signal), signal);
  if (cache !== undefined) assert.equal(r.options.cache, cache);
}
export function button(view, label, root = view.container) {
  const found = [...root.querySelectorAll('button')].filter(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label || b.title === label);
  assert.equal(found.length, 1, `one button ${label}`); return found[0];
}
export async function choose(view, id, value) {
  const control = view.container.querySelector(`#${id}`); assert.ok(control); assert.equal(control.disabled, false);
  await view.dispatch(control, new view.window.MouseEvent('click', { bubbles: true }));
  const option = [...view.container.querySelectorAll(`#${id}-options [role="option"]`)].find(node => node.dataset.value === value);
  assert.ok(option, `literal option ${value}`); assert.equal(option.disabled, false);
  await view.dispatch(option, new view.window.MouseEvent('click', { bubbles: true }));
}
export async function select(view, control, value) {
  assert.ok(control); assert.equal(control.disabled, false); control.value = value;
  await view.dispatch(control, new view.window.Event('change', { bubbles: true }));
}
