import assert from 'node:assert/strict';
import { act, createElement, createRef } from 'react';
import { createJiti } from 'jiti';
import httpNative from 'node:http';
import httpsNative from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, inputText, click, buttonWithText, exactQuery, exactHeaders } from '../lib/testing/leaf-controls.fixture.mjs';
export { inputText, click, buttonWithText, exactQuery, exactHeaders };

// Local external ports, not another React runtime or a copy of component logic.
export function composerFixture(t, { mobile = false, route, setup, timers = false } = {}) {
  const hooks = [], restores = [], realmRestores = new Set(), joins = [], releases = [], runtimeFailures = [], watches = [];
  const frames = new Map(), timeouts = new Map(), observers = new Set(), intersections = new Set();
  const media = new Map(), scrolls = [];
  let view, realm, closing = false, nextId = 0, disposed, settlement;
  const attempt = async (errors, run) => { try { await run(); } catch (error) { errors.push(error); } };
  t.after(() => dispose()); // Before import, admission, or realm allocation.
  const http = controlledLeafFetch({ after: hook => hooks.push(hook) }, request => {
    assert.equal(closing, false, 'no admission after composer teardown');
    const method = request.options.method ?? 'GET';
    assert.equal(method === 'GET' || method === 'POST', true, 'only explicitly owned client read/fork ports');
    if (method === 'GET') {
      assert.deepEqual([...new Headers(request.options.headers)], [], 'read request has no synthetic headers');
      assert.equal(request.options.body, undefined, 'read request has no body');
      const thinkingRead = /^\/api\/sessions\/[^/]+\/entries\/[^/]+\/thinking$/.test(request.url.pathname);
      assert.equal(['/api/file-index', '/api/skills'].includes(request.url.pathname) || thinkingRead, true,
        'only owned composer catalogue or deferred-thinking reads');
    }
    return route ? route(request) : assert.fail(`unexpected composer HTTP ${request.url.pathname}`);
  });
  function replace(object, key, value) {
    const previous = Object.getOwnPropertyDescriptor(object, key);
    const restore = () => previous ? Object.defineProperty(object, key, previous) : delete object[key];
    restores.push(restore);
    if (realm && [realm, realm.document, realm.navigator, realm.HTMLMediaElement.prototype,
      realm.HTMLElement.prototype, realm.Element.prototype, realm.Range.prototype].includes(object)) realmRestores.add(restore);
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  }
  function restoreRealm() {
    const errors = [];
    for (const restore of [...realmRestores].reverse()) {
      realmRestores.delete(restore);
      restores.splice(restores.indexOf(restore), 1);
      try { restore(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Composer realm restoration failed');
  }
  const unhandled = reason => runtimeFailures.push(new Error('Unhandled composer rejection', { cause: reason }));
  process.on('unhandledRejection', unhandled); // Observe; node:test keeps its own failure policy.
  const deny = name => function() { return http.check(() => { throw Error(`Unsupported composer capability: ${name}`); }); };
  // Guard host constructors BEFORE Jiti imports. No native/browser escape paths.
  for (const key of ['Audio', 'AudioContext', 'Worker', 'SharedWorker']) replace(globalThis, key, deny(key));
  // Client-only ownership: deny native transport/process/mutation ports before
  // loading the application graph, not merely after React effects begin.
  for (const [module, names] of [
    [httpNative, ['request', 'get', 'createServer']], [httpsNative, ['request', 'get', 'createServer']],
    [net, ['connect', 'createConnection', 'createServer']], [tls, ['connect', 'createServer']],
    [dgram, ['createSocket']], [childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
  ]) for (const name of names) replace(module, name, deny(`native.${name}`));
  const mutations = ['writeFile', 'appendFile', 'truncate', 'unlink', 'rename', 'rm', 'mkdir', 'rmdir', 'copyFile', 'cp', 'chmod', 'chown', 'link', 'symlink', 'utimes'];
  for (const name of mutations) {
    for (const [module, key] of [[fs, name], [fs, `${name}Sync`], [fsPromises, name]]) {
      if (typeof module[key] === 'function') replace(module, key, deny(`filesystem.${key}`));
    }
  }
  replace(fs, 'createWriteStream', deny('filesystem.createWriteStream'));
  // Read-only opens remain available to Jiti/module loading; write-capable opens
  // are refused. No loader cache or source-relative output is admitted.
  for (const [module, name] of [[fs, 'open'], [fs, 'openSync'], [fsPromises, 'open']]) {
    const original = module[name];
    replace(module, name, function(path, flags, ...args) {
      http.check(() => assert.equal(typeof flags === 'number'
        ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0
        : typeof flags !== 'function' && /[wa+]/.test(flags ?? 'r'), false, 'no write-capable filesystem open in client fixture'));
      return original.call(this, path, flags, ...args);
    });
  }
  syncBuiltinESMExports();
  // Exact style-only aliases are registered before the production graph loads.
  // Unknown CSS imports still fail; no component/hook or lifecycle is aliased.
  const minimapStyle = fileURLToPath(new URL('./chat-minimap-style.fixture.mjs', import.meta.url));
  const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false,
    alias: { './ChatMinimap.module.css': minimapStyle,
      [fileURLToPath(new URL('./ChatMinimap.module.css', import.meta.url))]: minimapStyle } });
  function settleDomain() {
    if (!settlement) settlement = (async () => {
      closing = true;
      const errors = [];
      const releaseAll = async () => {
        for (const release of releases) await attempt(errors, release);
        for (const request of http.requests) await attempt(errors, () => request.reply(
          request.answered ? request.replyData : {}, request.answered ? request.replyStatus : 503));
      };
      await attempt(errors, () => act(async () => { await releaseAll(); }));
      await releaseAll(); // Independent fallback if act failed before its body.
      // Frames are independently admitted peers too: release the finite known
      // callbacks BEFORE joining work which may depend on their completion.
      const releaseFrames = async () => {
        const admitted = [...frames]; frames.clear();
        for (const [, callback] of admitted) await attempt(errors, () => http.check(() => callback(0)));
      };
      await attempt(errors, () => act(releaseFrames));
      await releaseFrames(); // Independent fallback if act never invoked its body.
      for (const join of joins) await attempt(errors, () => act(async () => { await join(); }));
      for (const watch of watches) await attempt(errors, () => assert.equal(watch.size, 0, 'owned listeners released after real unmount/domain joins'));
      await attempt(errors, () => assert.equal(observers.size, 0, 'owned resize observers released'));
      await attempt(errors, () => assert.equal(intersections.size, 0, 'owned intersection observers released'));
      await attempt(errors, () => assert.equal(timeouts.size, 0, 'controlled policy timers cancelled by their production owner'));
      // Retain each leak as failure, then dispose only these fixture-owned API
      // doubles/gates even when a production cleanup or peer assertion failed.
      for (const observer of [...observers, ...intersections]) await attempt(errors, () => observer.disconnect());
      timeouts.clear();
      if (errors.length) throw new AggregateError(errors, 'Composer domain settlement failed');
    })();
    return settlement;
  }
  async function dispose() {
    if (disposed) return disposed;
    disposed = (async () => {
      closing = true;
      const errors = [];
      await attempt(errors, () => view?.unmount());
      await attempt(errors, settleDomain);
      await attempt(errors, () => view?.dispose());
      for (const restore of restores.toReversed()) await attempt(errors, restore);
      await attempt(errors, syncBuiltinESMExports);
      // Leaf collector remains LIVE through all production joins and global restoration.
      for (const hook of hooks) await attempt(errors, hook);
      process.off('unhandledRejection', unhandled);
      errors.push(...runtimeFailures);
      if (errors.length) throw new AggregateError(errors, 'Composer teardown failed');
    })();
    return disposed;
  }
  const f = {
    jiti, http, frames, timeouts, observers, intersections, scrolls, media, replace, dispose,
    join: callback => joins.push(callback), release: callback => releases.push(callback),
    get view() { assert.ok(view); return view; },
    watchEvents(target, names) {
      const live = new Map(names.map(name => [name, new Set()]));
      const add = target.addEventListener, remove = target.removeEventListener;
      replace(target, 'addEventListener', function(type, callback, options) {
        live.get(type)?.add(callback); return add.call(this, type, callback, options);
      });
      replace(target, 'removeEventListener', function(type, callback, options) {
        live.get(type)?.delete(callback); return remove.call(this, type, callback, options);
      });
      const watch = { count: type => live.get(type)?.size ?? 0,
        get size() { return [...live.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); } };
      watches.push(watch); return watch;
    },
    async load() { return jiti.import('./composer.fixture.tsx'); },
    async chat(initialState = {}, initialProps = {}, branch) {
      const p = await f.load(), api = createRef(), work = p.createComposerWork();
      // Controlled inputs to the actual production view. No replacement hook,
      // transport reducer, fabricated React state or copied handler is installed.
      let state = { data: null, loading: false, error: null, messages: [], entryIds: [], activeToolResults: new Map(),
        streamingStore: p.createStreamingStore(), agentRunning: false, bashRunning: false, isNew: false,
        modelNames: {}, modelList: [], modelThinkingLevels: {}, modelThinkingLevelMaps: {},
        notices: [], extensionStatuses: [], extensionWidgets: [], sessionIdRef: { current: 'chat' }, scrollContainerRef: { current: null },
        historyCursor: null, hasEarlierMessages: false, activeLeafId: 'leaf',
        ...initialState };
      let props = { session: null, archivedRootSessionId: null, archiveActionBusy: false, onSessionRestored() {},
        newSessionCwd: null, newSessionDraftKey: null, chatInputRef: api, ...initialProps };
      const element = () => createElement(p.I18nProvider, null, createElement(branch ? p.QuoteBranchChatView : p.ChatView, { ...props, state, work, ...(branch ? { branch } : {}) }));
      f.join(() => work.whenSettled());
      const view = await f.mount(element());
      const inputHandle = api.current;
      if (inputHandle) f.join(() => inputHandle.whenSettled());
      return { p, view, api, work, get state() { return state; },
        async update(nextState = {}, nextProps = {}) { state = { ...state, ...nextState }; props = { ...props, ...nextProps }; await view.rerender(element()); } };
    },
    async input(initial = {}) {
      const p = await f.load(), api = createRef(), work = p.createComposerWork();
      f.join(() => work.whenSettled());
      let props = { onSend() {}, onAbort() {}, isStreaming: false, ...initial, ref: api, work };
      const element = () => createElement(p.I18nProvider, null, createElement(p.ChatInput, props));
      const view = await f.mount(element());
      const handle = api.current; f.join(() => handle.whenSettled());
      return { p, view, api, ta: view.container.querySelector('textarea'),
        async update(next) { props = { ...props, ...next }; await view.rerender(element()); } };
    },
    async mount(element) {
      view = await mount({ after() {} }, element, { beforeDispose: async () => {
        const errors = [];
        // The shared mount also calls this on partial setup/render failure.
        await attempt(errors, settleDomain);
        await attempt(errors, () => http.whenSettled());
        await attempt(errors, restoreRealm);
        // Descriptor phase only. Realm error/rejection collectors stay live
        // through shared close/host restoration and the original final leaf join.
        await attempt(errors, () => http.restoreRealm());
        if (errors.length) throw new AggregateError(errors, 'Composer before-realm-close failed');
      }, setup(window) {
        realm = window;
        http.setup(window);
        for (const key of ['Audio', 'AudioContext', 'Worker', 'SharedWorker']) replace(window, key, deny(`window.${key}`));
        replace(window.HTMLMediaElement.prototype, 'load', deny('media.load'));
        replace(window.HTMLMediaElement.prototype, 'play', deny('media.play'));
        replace(window.HTMLMediaElement.prototype, 'pause', deny('media.pause'));
        const raf = fn => http.check(() => {
          assert.equal(closing, false, 'no new animation work after domain admission closes');
          const id = ++nextId; frames.set(id, fn); return id;
        });
        const caf = id => frames.delete(id);
        for (const target of [window, globalThis]) {
          replace(target, 'requestAnimationFrame', raf); replace(target, 'cancelAnimationFrame', caf);
        }
        if (timers) {
          // useViewportHeight owns window timer APIs, not unrelated React/JSDOM
          // global timers. Keep the existing broad mode for other callers.
          const port = timers === 'window' ? 'window.setTimeout' : 'shared window/global setTimeout';
          const schedule = (fn, delay) => { const id = ++nextId; timeouts.set(id, { fn, delay, port }); return id; };
          for (const target of timers === 'window' ? [window] : [window, globalThis]) {
            replace(target, 'setTimeout', schedule); replace(target, 'clearTimeout', id => timeouts.delete(id));
          }
        }
        class ResizeObserverDouble {
          targets = new Set();
          constructor(callback) { this.callback = callback; observers.add(this); }
          observe(target) { this.targets.add(target); }
          unobserve(target) { this.targets.delete(target); }
          disconnect() { this.targets.clear(); observers.delete(this); }
        }
        class IntersectionObserverDouble extends ResizeObserverDouble {
          constructor(callback, options) { super(callback); observers.delete(this); intersections.add(this); this.options = options; }
          disconnect() { super.disconnect(); intersections.delete(this); }
        }
        for (const target of [window, globalThis]) {
          replace(target, 'ResizeObserver', ResizeObserverDouble);
          replace(target, 'IntersectionObserver', IntersectionObserverDouble);
        }
        replace(window, 'matchMedia', query => {
          if (!media.has(query)) {
            const mql = new window.EventTarget();
            mql.matches = query === '(max-width: 640px)' ? mobile : false;
            mql.media = query; media.set(query, mql);
          }
          return media.get(query);
        });
        replace(window.HTMLElement.prototype, 'scrollIntoView', function(options) { scrolls.push({ node: this, options }); });
        replace(window.HTMLElement.prototype, 'scrollTo', function(options) {
          scrolls.push({ node: this, options }); if (typeof options === 'object' && typeof options.top === 'number') this.scrollTop = options.top;
        });
        replace(window.Element.prototype, 'animate', function(keyframes, options) {
          scrolls.push({ animation: true, node: this, keyframes, options }); return { cancel() {} };
        });
        replace(window, 'scrollTo', (...args) => scrolls.push({ page: true, args }));
        replace(window.Range.prototype, 'getBoundingClientRect', () => ({ top: 40, bottom: 60, left: 80, width: 100, height: 20, right: 180 }));
        const matches = window.Element.prototype.matches;
        replace(window.Element.prototype, 'matches', function(selector) {
          return selector === ':popover-open' ? false : matches.call(this, selector);
        });
        replace(globalThis, 'DOMParser', window.DOMParser);
        replace(globalThis, 'CSS', window.CSS?.escape ? window.CSS : { escape: value => value });
        setup?.(window, f);
      } });
      return view;
    },
    async frame() {
      // One explicitly requested animation-frame delivery, not a universal flush.
      const admitted = [...frames]; frames.clear();
      await act(async () => { for (const [, callback] of admitted) http.check(() => callback(0)); });
    },
    async timer(id) {
      const timer = timeouts.get(id); assert.ok(timer, 'named production timer exists');
      timeouts.delete(id); await act(async () => timer.fn());
    },
    async key(target, key, options = {}) {
      const event = new view.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
      await view.dispatch(target, event); return event.defaultPrevented;
    },
    async resize(target) {
      await act(async () => { for (const observer of [...observers]) if (observer.targets.has(target)) http.check(() => observer.callback([{ target, contentRect: target.getBoundingClientRect() }])); });
    },
    async intersect() {
      await act(async () => { for (const observer of [...intersections]) http.check(() => observer.callback([{ isIntersecting: true }])); });
    },
    async setMobile(next) {
      const mql = media.get('(max-width: 640px)'); assert.ok(mql);
      await act(async () => { mql.matches = next; mql.dispatchEvent(new view.window.Event('change')); });
    },
  };
  return f;
}
