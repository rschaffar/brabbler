import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { ignoredAbortFetch } from '../lib/testing/ignored-abort-fetch.fixture.mjs';

// Local capability fixture, not a React implementation or a feature state machine.
// Guards precede every production import. No server, filesystem, SDK or Git effects.
export async function packet(t, { git = false, review = false, readDomain, setup: setupCapability, beforeUnmount: beforeUnmountCapability, traceFrames = false, cardDescendants = false, reviewStarts = [0], reviewEntryIds = [0, 1] } = {}) {
  const failures = [], work = [], expected = new Set();
  let closed = false, view, disposal, domainDisposal;
  // Register the optional HTTP domain before dependency loading or realm setup.
  // Its route failures survive even when a production loader catches them.
  const releases = readDomain ? [() => readDomain.release()] : [];
  const joins = readDomain ? [() => readDomain.join()] : [];
  const properties = [], realmProperties = [];
  const replace = (stack, object, name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, { configurable: true, writable: true, value });
    stack.push(() => { if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name]; });
  };
  const install = (object, name, value) => replace(properties, object, name, value);
  const installRealm = (object, name, value) => replace(realmProperties, object, name, value);
  const fail = message => { const error = new Error(message); failures.push(error); throw error; };
  const deny = name => function () { return fail(`Unsupported transport: ${name}`); };
  const onReadWork = promise => {
    if (closed) failures.push(new Error('Read work admitted after close'));
    const entry = { promise: Promise.resolve(promise), error: null };
    // Observe rejection immediately but keep the actual production promise as the join.
    entry.promise.catch(error => { entry.error = error; });
    work.push(entry);
    const request = (gitTransport?.requests ?? requests).findLast(item => !item.readWork);
    if (request) request.readWork = entry.promise;
  };
  const settle = async (from = 0) => {
    let end = from;
    while (end < work.length) {
      const batch = work.slice(end); end = work.length;
      await Promise.allSettled(batch.map(entry => entry.promise));
    }
  };
  const requests = [], reviewBodies = [];
  let gitTransport;
  const fetchReview = async (input, init = {}) => {
    try {
      assert.equal(closed, false, 'closed review admission');
      const url = new URL(String(input), 'https://fixture.invalid');
      assert.equal(url.origin, 'https://fixture.invalid');
      const context = cardDescendants && url.pathname === '/api/plugins/bundled/git-workflow/patch-context';
      if (!context) assert.equal(url.pathname, '/api/sessions/current/reviews/review');
      assert.equal(init.method ?? 'GET', 'GET');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.signal instanceof AbortSignal, true);
      const keys = [...url.searchParams.keys()].sort();
      assert.equal(new Set(keys).size, keys.length, 'no duplicate query keys');
      if (context) {
        assert.equal(keys.join(','), 'file,handle');
        assert.equal(url.searchParams.get('handle'), 'captured-context');
        assert.equal(url.searchParams.get('file'), '0');
      } else assert.equal(['start', 'patch', 'entry,offset'].includes(keys.join(',')), true);
      if (url.searchParams.has('patch')) assert.equal(url.searchParams.get('patch'), '1');
      if (url.searchParams.has('start')) assert.equal(reviewStarts.map(String).includes(url.searchParams.get('start')), true, 'declared review page only');
      if (url.searchParams.has('entry')) {
        assert.equal(reviewEntryIds.map(String).includes(url.searchParams.get('entry')), true, 'declared review entry only');
        assert.equal(url.searchParams.get('offset'), '0');
      }
      assert.equal(init.body, undefined);
      const gate = deferred(); let delivered = false;
      const record = { url, signal: init.signal, bodyCalls: 0,
        reply(payload, { status = 200, error } = {}) {
          assert.equal(delivered, false); delivered = true;
          record.status = status; // headers are read only after this named response gate
          gate.resolve({ payload, status, error });
        },
      };
      requests.push(record); reviewBodies.push({ gate, undelivered: () => !delivered });
      // Named response gate; actual json()/text() consumption is still part of
      // the complete observed production continuation, including after abort.
      const response = await gate.promise;
      const consume = () => {
        record.bodyCalls++;
        if (response.error) {
          if (!expected.has(response.error)) failures.push(response.error);
          throw response.error;
        }
        return response.payload;
      };
      return { ok: response.status < 400, status: response.status,
        json: async () => consume(), text: async () => consume() };
    } catch (error) { failures.push(error); throw error; }
  };
  const frameQueue = new Map(); let nextFrame = 0;
  // Opt-in test diagnostics only: bounded primitive labels/IDs, never callback
  // source, stacks, DOM or React object serialization. Original callbacks run.
  const frameTrace = traceFrames ? { records: new Map(), callbacks: new WeakMap(), nextCallback: 0,
    scope: null, delivering: null } : null;
  const deliverFrames = ids => {
    for (const id of ids) {
      const callback = frameQueue.get(id); if (!callback) continue;
      frameQueue.delete(id);
      if (frameTrace) {
        const previous = frameTrace.delivering;
        frameTrace.delivering = id; frameTrace.records.get(id).status = 'delivered';
        try { callback(0); } catch (error) { failures.push(error); throw error; }
        finally { frameTrace.delivering = previous; }
      } else {
        try { callback(0); } catch (error) { failures.push(error); throw error; }
      }
    }
  };
  const frames = {
    take: () => [...frameQueue.keys()],
    mark: () => nextFrame,
    admissionsSince(mark) {
      if (!frameTrace) return fail('Frame tracing was not explicitly enabled');
      return [...frameTrace.records.values()].filter(record => record.id > mark).map(record => ({ ...record }));
    },
    during(label, owner, callback) {
      if (!frameTrace) return fail('Frame tracing was not explicitly enabled');
      const previous = frameTrace.scope;
      frameTrace.scope = { label, owner };
      try { return callback(); } finally { frameTrace.scope = previous; }
    },
    // A named browser delivery, not a drain-until-idle helper. Descendants remain
    // queued for a separate explicitly requested frame in the test.
    async fire(ids) { await act(async () => { deliverFrames(ids); }); },
    // The sole synchronous delivery is inside a real ancestor layout effect,
    // to exercise a live CodeView ref BEFORE CommittedPatchDiff's passive effect.
    fireDuringLayout: deliverFrames,
  };
  const observers = [];
  class ResizeObserverDouble {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  const resize = async target => act(async () => {
    for (const observer of observers) if (observer.targets.has(target)) {
      try {
        const contentRect = target.getBoundingClientRect();
        observer.callback([{ target, contentRect, borderBoxSize: [{ blockSize: contentRect.height, inlineSize: contentRect.width }] }]);
      } catch (error) { failures.push(error); throw error; }
    }
  });
  // Separately idempotent domain join. The shared mount calls this after unmount
  // on success AND failed setup/render, before closing/restoring its realm. Never
  // call view.dispose() (or cleanup()) from here: that would be circular disposal.
  const settleDomain = () => {
    if (!domainDisposal) domainDisposal = (async () => {
      closed = true;
      // Release every accepted peer before waiting for any peer. Cleanup-owned
      // controlled 503s below are not fixture defects and do not imply success.
      for (const release of releases) {
        try { release(); } catch (error) { failures.push(error); }
      }
      for (const body of reviewBodies) if (body.undelivered()) {
        try { body.gate.resolve({ payload: {}, status: 503 }); } catch (error) { failures.push(error); }
      }
      const pendingJoins = [];
      try { pendingJoins.push(gitTransport?.dispose(() => Promise.resolve())); } catch (error) { failures.push(error); }
      for (const join of joins) {
        try { pendingJoins.push(Promise.resolve(join())); } catch (error) { failures.push(error); }
      }
      await act(async () => {
        const results = await Promise.allSettled(pendingJoins);
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
        await settle(); // actual complete production read/body/catch/finally/action promises
      });
      // Realm disposal cancels only its queued browser frames. Late-callback
      // safety is tested by explicit delivery before this close, not inferred here.
      frameQueue.clear();
      if (observers.some(observer => observer.targets.size !== 0)) failures.push(new Error('Owned resize observation survived React unmount'));
      for (const entry of work) if (entry.error && !expected.has(entry.error)) failures.push(entry.error);
      if (failures.length) throw new AggregateError(failures, 'cards/Git domain settlement failure');
    })();
    void domainDisposal.catch(() => {});
    return domainDisposal;
  };
  // Nav's phased contract: independently join and unwind realm overrides BEFORE
  // mount restores its globals. Host fetch overrides unwind only AFTER mount.
  let realmDisposal;
  const beforeDispose = () => {
    if (!realmDisposal) realmDisposal = (async () => {
      const errors = [];
      try { await settleDomain(); } catch (error) { errors.push(error); }
      for (const restore of realmProperties.splice(0).reverse()) {
        try { restore(); } catch (error) { failures.push(error); errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'cards/Git before realm disposal');
    })();
    void realmDisposal.catch(() => {});
    return realmDisposal;
  };
  const cleanup = async () => {
    if (!disposal) disposal = (async () => {
      closed = true;
      // Independently attempt every boundary; collectors stay live through realm close.
      try { await view?.unmount(); } catch (error) { failures.push(error); }
      try { await beforeDispose(); } catch (error) { failures.push(error); }
      try { await view?.dispose(); } catch (error) { failures.push(error); }
      for (const restore of properties.toReversed()) {
        try { restore(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'cards/Git capability or cleanup failure');
    })();
    void disposal.catch(() => {});
    return disposal;
  };
  t.after(cleanup);
  const originalConsoleError = console.error;
  // Sequential reload realms can share one test context. Own every override in
  // this domain's LIFO stack, not the context's automatic mock-restoration order.
  // Otherwise the final context restore can resurrect an earlier realm's guard.
  install(console, 'error', (...args) => {
    failures.push(new Error(`console.error: ${args.map(value => typeof value === 'string' ? value.slice(0, 500) : typeof value).join(' ')}`));
    // Do not suppress the original diagnostic.
    originalConsoleError(...args);
  });
  for (const [object, name] of [[http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'],
    [net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) install(object, name, deny(name));
  install(globalThis, 'fetch', deny('fetch'));
  for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'Audio', 'Image']) {
    install(globalThis, name, deny(name));
  }
  if (git) {
    // Reuse the established ignored-abort body fixture; add exact scope checks and
    // join the complete production read continuations via onReadWork, not just json().
    // Every nested fetch override belongs to the same exact LIFO descriptor
    // stack; context-wide automatic mocks must not restore an inner saved mock
    // after this domain has restored the original early native fence.
    gitTransport = ignoredAbortFetch({ mock: { method: install } }, '/api/git/explorer');
    const admittedFetch = globalThis.fetch;
    install(globalThis, 'fetch', (input, init = {}) => {
      try {
        assert.equal(closed, false);
        const url = new URL(String(input), 'https://fixture.invalid');
        assert.equal(url.origin, 'https://fixture.invalid');
        assert.equal(url.pathname, '/api/git/explorer');
        const keys = [...url.searchParams.keys()].sort();
        assert.equal(new Set(keys).size, keys.length);
        const op = url.searchParams.get('op');
        assert.equal(['log', 'commit'].includes(op), true, 'only scoped history/detail reads in this fixture');
        assert.equal(keys.join(','), op === 'commit' ? 'branch,cwd,head,oid,op'
          : ['cwd,op', 'branch,cwd,op', 'branch,cwd,head,op', 'branch,cwd,head,op,skip'].find(value => value === keys.join(',')));
        assert.equal(['/repo', '/checkout', '/other'].includes(url.searchParams.get('cwd')), true);
        for (const key of ['head', 'oid']) if (url.searchParams.has(key)) assert.match(url.searchParams.get(key), /^[a-f0-9]{40}$/);
        if (url.searchParams.has('skip')) assert.match(url.searchParams.get('skip'), /^[0-9]+$/);
        assert.equal(init.cache, 'no-store'); assert.equal(init.body, undefined);
        return admittedFetch(input, init);
      } catch (error) { failures.push(error); throw error; }
    });
  } else if (review) install(globalThis, 'fetch', fetchReview);
  else if (readDomain) install(globalThis, 'fetch', readDomain.fetch);
  view = await mount(t, null, { beforeDispose, beforeUnmount: beforeUnmountCapability, setup(window) {
    for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'Audio', 'Image']) {
      Object.defineProperty(window, name, { configurable: true, value: deny(`realm ${name}`) });
    }
    window.fetch = (...args) => globalThis.fetch(...args);
    for (const name of ['error', 'unhandledrejection']) window.addEventListener(name, event => {
      failures.push(event.error ?? event.reason ?? new Error(`realm ${name}`));
    });
    window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} });
    installRealm(globalThis, 'ResizeObserver', ResizeObserverDouble);
    window.ResizeObserver = ResizeObserverDouble;
    const requestFrame = callback => {
      if (closed) fail('frame admitted after domain close');
      const id = ++nextFrame; frameQueue.set(id, callback);
      if (frameTrace) {
        let callbackId = frameTrace.callbacks.get(callback);
        if (callbackId === undefined) { callbackId = ++frameTrace.nextCallback; frameTrace.callbacks.set(callback, callbackId); }
        frameTrace.records.set(id, { id, callback: callbackId, label: frameTrace.scope?.label ?? 'unscoped',
          owner: frameTrace.scope?.owner ?? 0, parent: frameTrace.delivering, status: 'queued' });
      }
      return id;
    };
    const cancelFrame = id => {
      const removed = frameQueue.delete(id);
      if (removed && frameTrace) frameTrace.records.get(id).status = 'cancelled';
    };
    installRealm(globalThis, 'requestAnimationFrame', requestFrame);
    installRealm(globalThis, 'cancelAnimationFrame', cancelFrame);
    window.requestAnimationFrame = requestFrame; window.cancelAnimationFrame = cancelFrame;
    installRealm(globalThis, 'localStorage', window.localStorage);
    installRealm(globalThis, 'sessionStorage', window.sessionStorage);
    for (const name of ['HTMLDialogElement', 'HTMLPreElement', 'HTMLStyleElement', 'HTMLDivElement', 'HTMLButtonElement',
      'Document', 'DocumentFragment', 'SVGElement', 'SVGSVGElement', 'ShadowRoot', 'customElements', 'CSSStyleSheet'])
      installRealm(globalThis, name, window[name]);
    // Constructable-sheet adoption is not implemented by jsdom. Actual Pierre
    // creates its real open shadow root; this only accepts its static CSS string.
    if (!window.CSSStyleSheet.prototype.replaceSync) window.CSSStyleSheet.prototype.replaceSync = function () {};
    window.navigator.sendBeacon = deny('sendBeacon');
    window.open = deny('window.open');
    window.HTMLMediaElement.prototype.load = deny('native media load');
    window.HTMLMediaElement.prototype.play = deny('native media play');
    // jsdom has no top layer, scrolling or layout. These provide API semantics,
    // not physical focus containment/geometry. Native/browser chains stay intact.
    window.HTMLDialogElement.prototype.show = function () { this.open = true; };
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.HTMLElement.prototype.scrollTo = function ({ top, left } = {}) {
      if (top !== undefined) this.scrollTop = top;
      if (left !== undefined) this.scrollLeft = left;
    };
    window.HTMLElement.prototype.getClientRects = function () {
      return this.closest('[hidden], dialog:not([open]), [data-fixture-hidden]') ? [] : [this.getBoundingClientRect()];
    };
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      const height = this.classList.contains('git-diff-code-view') ? 420 : Number(this.dataset.fixtureHeight ?? 22);
      const top = Number(this.dataset.fixtureTop ?? 0), width = 800;
      return { top, bottom: top + height, left: 0, right: width, height, width, x: 0, y: top, toJSON() {} };
    };
    setupCapability?.(window, installRealm);
  } });
  const style = new URL('./cards-git-style.fixture.mjs', import.meta.url).pathname;
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true,
    alias: { './ChatMinimap.module.css': style, [new URL('./ChatMinimap.module.css', import.meta.url).pathname]: style,
      './ScratchpadPanel.css': style, [new URL('./ScratchpadPanel.css', import.meta.url).pathname]: style,
      // Resolve both public import-only exports through native ESM. The explicit
      // /react alias must not become a child of the optional root adapter file.
      '@pierre/diffs/react': fileURLToPath(import.meta.resolve('@pierre/diffs/react')),
      '@pierre/diffs': cardDescendants
        ? fileURLToPath(new URL('./git-card-highlighter.fixture.mjs', import.meta.url))
        : fileURLToPath(import.meta.resolve('@pierre/diffs')) } });
  const load = path => {
    const work = jiti.import(path);
    // Only the explicitly owned read-domain suite extends module observation.
    // Existing Cards callers keep their original ledger/admission behavior.
    if (readDomain) onReadWork(work); // exact import promise, not flush/idle
    return work;
  };
  const { I18nProvider } = await load('../hooks/useI18n.tsx');
  const render = node => view.rerender(createElement(I18nProvider, null, node));
  return { view, load, render, frames, resize, observers, work, onReadWork, settle, cleanup, settleDomain,
    addDomainRelease: release => releases.push(release), addDomainJoin: join => joins.push(join),
    requests: gitTransport?.requests ?? requests,
    expectFailure: error => expected.add(error),
    async reply(request, payload, options) {
      if (git) await request.deliver(payload);
      await act(async () => {
        if (!git) request.reply(payload, options);
        assert.equal(Boolean(request.readWork), true, 'production read work is observed');
        await request.readWork;
      });
    },
  };
}

export const textButton = (root, text) => {
  const button = [...root.querySelectorAll('button')].find(node => node.textContent === text);
  assert.equal(Boolean(button), true, `missing button: ${text}`); return button;
};
export async function click(view, target) {
  assert.equal(Boolean(target), true, 'click target exists');
  assert.equal(Boolean(target.disabled), false, 'click target enabled');
  await view.dispatch(target, new view.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
export async function input(view, target, value) {
  assert.equal(Boolean(target), true, 'input target exists');
  const prototype = target.tagName === 'TEXTAREA' ? view.window.HTMLTextAreaElement.prototype : view.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, value);
  await view.dispatch(target, new view.window.Event('input', { bubbles: true }));
}
export async function key(view, target, value, options = {}) {
  const event = new view.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  await view.dispatch(target, event); return event.defaultPrevented;
}
export async function choose(view, select, value) {
  select.value = value;
  await view.dispatch(select, new view.window.Event('change', { bubbles: true }));
}
