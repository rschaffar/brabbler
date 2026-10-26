import assert from 'node:assert/strict';
import { act } from 'react';
import { mount } from '../lib/testing/react.fixture.mjs';
import { boundedErrors, withFilesDiagnostics } from './files-diagnostics.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { encodeFilePathForApi } from '../lib/file-paths.ts';

// Files requests intentionally have no AbortSignal. Do not relax the separate
// ignored-abort fixture's signal requirement for GitExplorer/Move owners.
export function filesRuntime({ menu = false, dialog = false, idle = false } = {}) {
  const requests = [], sources = [], plans = [], tickets = [], tasks = [], failures = [];
  const restores = [], realmRestores = [], monitorRestores = [], listenerRemovals = [], mqlListeners = new Set(), observers = new Set();
  const idleCallbacks = new Map(), frames = new Map(), releases = [], intersections = new Set(), invariants = [];
  let nextCallback = 0;
  const closingError = new Error('Files fixture closed before delivery');
  let closed = false, disposal, settlement, installingRealm = false;
  let joined = 0;
  const releaseAll = () => {
    for (const release of releases) {
      try { const work = release(); if (work?.then) observe(work); }
      catch (error) { failures.push(error); }
    }
    for (const ticket of tickets) {
      try { ticket.releaseForCleanup(); } catch (error) { failures.push(error); }
    }
  };
  const join = async () => {
    while (joined < tasks.length) {
      const batch = tasks.slice(joined); joined = tasks.length;
      await Promise.allSettled(batch);
    }
  };
  const replace = (object, key, value, monitor = false) => {
    const previous = Object.getOwnPropertyDescriptor(object, key);
    (monitor ? monitorRestores : installingRealm ? realmRestores : restores).push(() => {
      if (previous) Object.defineProperty(object, key, previous);
      else delete object[key];
    });
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  };
  const own = (key, value) => replace(globalThis, key, value);
  const attemptAll = callbacks => {
    for (const restore of callbacks.splice(0).reverse()) {
      try { restore(); } catch (error) { failures.push(error); }
    }
  };
  const restoreAll = () => {
    // Keep console/event monitors through ALL capability descriptor attempts.
    // Final monitor teardown is independent too; no promise of observation after
    // the last monitor itself has been removed is made.
    attemptAll(realmRestores); // Partial-install fallback; normally restored by settle before realm close.
    attemptAll(restores);
    attemptAll(monitorRestores);
    attemptAll(listenerRemovals);
  };
  // Never inspect arbitrary runtime arguments: they may carry DOM/React fibers.
  const isError = value => {
    try { return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]'; }
    catch { return false; }
  };
  const hint = value => {
    try {
      if (typeof value === 'string') return value.slice(0, 240);
      if (value === null || ['undefined', 'boolean', 'number', 'bigint'].includes(typeof value)) return String(value);
      if (isError(value)) return boundedErrors(value).slice(0, 240);
      return `[${typeof value}]`;
    } catch { return '[unreadable runtime argument]'; }
  };
  const runtimeError = (label, values) => {
    const errors = values.filter(isError);
    failures.push(new AggregateError(errors, `${label}: ${values.slice(0, 5).map(hint).join(' | ')}`, { cause: errors[0] }));
  };
  const deny = name => function () {
    const error = new Error(`Unexpected ${name}${closed ? ' after admission closed' : ''}`);
    failures.push(error); throw error;
  };
  const check = fn => {
    try { return fn(); } catch (error) { failures.push(error); throw error; }
  };
  const observe = (work, operational = false) => {
    const promise = Promise.resolve(work);
    tasks.push(promise.then(() => {}, error => {
      if (!operational && error !== closingError) failures.push(error);
    }));
    return promise;
  };
  const boundary = work => observe(act(work));
  const delivery = work => observe((async () => work())());
  const assertHealthy = () => {
    if (failures.length) {
      const error = new AggregateError([...failures], 'Files runtime capability failures', { cause: failures[0] });
      error.message += `\n${boundedErrors(error)}`;
      throw error;
    }
  };
  function matchRequest(url, init, match) {
    const git = match.type === 'git';
    assert.equal(url.origin, 'https://fixture.invalid', 'no external network');
    assert.equal(url.pathname, git ? '/api/git/diff' : `/api/files/${encodeFilePathForApi(match.path)}`);
    assert.equal(init.method ?? 'GET', match.method ?? (match.type === 'save' ? 'PUT' : 'GET'));
    assert.equal(init.signal === undefined, true, 'ordinary FileViewer fetch must not invent an abort signal');
    if (match.type === 'save') {
      // Headers accepts record, tuple-list and Headers inputs; names are
      // case-insensitive. Check the ACTUAL outgoing PUT, not the planned body.
      assert.equal(new Headers(init.headers).get('content-type')?.trim().toLowerCase(), 'application/json', 'save JSON Content-Type');
    }
    const query = git ? { cwd: match.cwd, path: match.path } : { type: match.type };
    for (const key of ['sessionId', 'viewerCwd', 'offset']) {
      if (match[key] !== undefined && match[key] !== null) query[key] = String(match[key]);
    }
    assert.deepEqual([...url.searchParams].sort(), Object.entries(query).sort(), 'exact request context/query');
    if (Object.hasOwn(match, 'body')) assert.deepEqual(JSON.parse(init.body), match.body);
  }
  const fetchCapability = (input, init = {}) => {
    try {
      return check(() => {
        assert.equal(closed, false, 'fetch admitted after fixture closure');
        const url = new URL(String(input), 'https://fixture.invalid/');
        const ticket = plans.shift();
        assert.ok(ticket, `unplanned request: ${init.method ?? 'GET'} ${url}`);
        matchRequest(url, init, ticket.match);
        ticket.admitted = true; ticket.url = url; ticket.init = init;
        requests.push(ticket);
        return observe(ticket.headerGate.promise, true);
      });
    } catch (error) { return observe(Promise.reject(error), true); }
  };
  class WatchSource {
    constructor(input) {
      check(() => {
        assert.equal(closed, false, 'watch admitted after fixture closure');
        this.url = new URL(String(input), 'https://fixture.invalid/');
        assert.equal(this.url.origin, 'https://fixture.invalid');
        assert.match(this.url.pathname, /^\/api\/files\/.+/);
        assert.equal(this.url.searchParams.get('type'), 'watch');
        assert.deepEqual([...this.url.searchParams.keys()].sort(),
          this.url.searchParams.has('sessionId') ? ['sessionId', 'type'] : ['type'], 'exact watch query-key multiset');
      });
      this.closed = false; this.closeCalls = 0; this.listeners = new Map();
      sources.push(this);
    }
    addEventListener(type, listener) {
      const entries = this.listeners.get(type) ?? [];
      entries.push(listener); this.listeners.set(type, entries);
    }
    close() { this.closed = true; this.closeCalls++; }
    emit(type, data, retained = false) {
      return boundary(async () => {
        check(() => {
          assert.equal(closed, false, 'event after fixture closure');
          if (!retained) assert.equal(this.closed, false, 'use invokeRetained for a deliberately obsolete listener');
        });
        const event = { type, data: JSON.stringify(data ?? {}) };
        const callbacks = [...(this.listeners.get(type) ?? [])];
        if (typeof this[`on${type}`] === 'function') callbacks.push(this[`on${type}`]);
        for (const listener of callbacks) {
          // change's synchronize returns a promise; connected deliberately voids
          // it in production. Do not turn dispatch into a held-body deadlock.
          const result = check(() => listener(event));
          if (result?.then) observe(result);
        }
      });
    }
    connected() { return this.emit('connected'); }
    change(data = {}) { return this.emit('change', data); }
    error() { return this.emit('error'); }
    invokeRetained(type, data = {}) { return this.emit(type, data, true); }
  }
  // Install before any production graph import, including unsupported HOST
  // constructors. Roll back partial installation if the runtime cannot own one.
  try {
    replace(console, 'error', (...args) => runtimeError('Unexpected console.error', args), true);
    own('fetch', fetchCapability);
    own('EventSource', WatchSource);
    for (const name of ['WebSocket', 'XMLHttpRequest', 'Worker', 'SharedWorker']) own(name, deny(name));
  } catch (error) {
    restoreAll();
    const failure = new AggregateError([error, ...failures], 'Files runtime installation failed', { cause: error });
    failure.message += `\n${boundedErrors(failure)}`;
    throw failure;
  }

  return {
    requests, sources,
    releaseKnown: releaseAll,
    mount(t, element, options = {}) {
      let returned = false, terminal = false;
      const terminalDispose = dispose => {
        terminal = true;
        releaseAll(); // Registered/explicit disposal releases before its first wait.
        return dispose();
      };
      const owner = { after(dispose) { t.after(() => terminalDispose(dispose)); } };
      const beforeUnmount = () => {
        // Public observer removal is a test input, not terminal cancellation.
        // Failed setup/render has no returned observer and must release early.
        if (!returned || terminal) releaseAll();
        try { const work = options.beforeUnmount?.(releaseAll); if (work?.then) observe(work); }
        catch (error) { failures.push(error); }
      };
      return withFilesDiagnostics('Files mounted boundary failed', async () => {
        const view = await mount(owner, element, { ...options, beforeUnmount });
        returned = true;
        return { ...view, dispose: () => terminalDispose(view.dispose) };
      });
    },
    replaceCapability(object, key, value) { check(() => assert.equal(closed, false)); replace(object, key, value); },
    assertOnSettle(assertion) { check(() => assert.equal(closed, false)); invariants.push(assertion); },
    // External named import gates share failure-safe domain/realm ownership.
    installGlobal(key, value) { check(() => assert.equal(closed, false)); own(key, value); },
    releaseOnSettle(release) { check(() => assert.equal(closed, false)); releases.push(release); },
    // Supplied only to the real production lifecycle observer. These promises
    // include production handlers/finalizers, not just transport/body return.
    onWork: work => { observe(work); },
    get idleCount() { return idleCallbacks.size; },
    get retainedIdle() { return [...idleCallbacks.values()]; },
    async grantIdle() {
      const entry = idleCallbacks.entries().next().value;
      check(() => assert.equal(Boolean(entry), true, 'named idle grant must be queued'));
      idleCallbacks.delete(entry[0]);
      await boundary(async () => { entry[1]({ didTimeout: false, timeRemaining: () => 10 }); });
      assertHealthy();
    },
    get liveSources() { return sources.filter(source => !source.closed); },
    assertHealthy,
    // Caller owns any numeric geometry double; this only delivers the missing
    // browser observer notification to the real component callback.
    notifyResize(target) {
      return boundary(async () => {
        for (const observer of observers) {
          if (observer.targets.has(target)) observer.callback([{ target, contentRect: target.getBoundingClientRect() }], observer);
        }
      });
    },
    // Plans are FIFO and must precede admission, including synchronous effects.
    expect(match) {
      check(() => assert.equal(closed, false));
      const headerGate = deferred(), bodyGate = deferred();
      let headersReleased = false, bodyReleased = false;
      const jsonTasks = [];
      const ticket = {
        match, headerGate, admitted: false, url: undefined, init: undefined,
        jsonCalls: 0, jsonReturned: false, jsonCompletions: 0,
        headers({ status = 200 } = {}) { return delivery(async () => {
          check(() => { assert.equal(ticket.admitted, true, 'expected request was not admitted'); assert.equal(closed, false); });
          if (headersReleased) return;
          await boundary(async () => {
            headersReleased = true;
            headerGate.resolve({ ok: status >= 200 && status < 300, status, json() {
              check(() => assert.equal(++ticket.jsonCalls, 1, 'one body consumer'));
              const work = observe((async () => {
                try {
                  const payload = await bodyGate.promise;
                  ticket.jsonReturned = true;
                  return payload;
                } finally { ticket.jsonCompletions++; }
              })(), true);
              jsonTasks.push(work);
              return work;
            } });
            await headerGate.promise;
          });
          check(() => assert.equal(ticket.jsonCalls, 1, 'production must enter response.json'));
        }); },
        deliver(payload, options) { return delivery(async () => {
          await ticket.headers(options);
          await boundary(async () => {
            check(() => { assert.equal(closed, false); assert.equal(bodyReleased, false); });
            // A successful Response.json returns generated JSON, never a live
            // object whose defective getter can be skipped by a stale handler.
            // Do not mark/release the body until generation succeeds: failed
            // serialization leaves this and every peer gate cleanup-releasable.
            const generated = check(() => JSON.parse(JSON.stringify(payload)));
            bodyReleased = true; bodyGate.resolve(generated);
            await Promise.all(jsonTasks);
          });
          check(() => assert.equal(ticket.jsonReturned, true, 'obsolete JSON must really return'));
          assertHealthy();
        }); },
        rejectBody(error = new Error('controlled body failure')) { return delivery(async () => {
          await ticket.headers();
          await boundary(async () => {
            check(() => { assert.equal(closed, false); assert.equal(bodyReleased, false); });
            bodyReleased = true; bodyGate.reject(error);
            await Promise.allSettled(jsonTasks);
          });
          check(() => assert.equal(ticket.jsonCompletions, 1));
          assertHealthy();
        }); },
        rejectHeaders(error = new Error('controlled headers failure')) { return delivery(async () => {
          check(() => { assert.equal(ticket.admitted, true); assert.equal(headersReleased, false); assert.equal(closed, false); });
          await boundary(async () => { headersReleased = true; headerGate.reject(error); await Promise.allSettled([headerGate.promise]); });
          assertHealthy();
        }); },
        releaseForCleanup(...reasons) {
          // Explicit undefined is an original rejection value, not absence.
          const reason = reasons.length ? reasons[0] : closingError;
          if (!headersReleased) { headersReleased = true; headerGate.reject(reason); }
          if (!bodyReleased) { bodyReleased = true; bodyGate.reject(reason); }
        },
      };
      tickets.push(ticket); plans.push(ticket);
      return ticket;
    },
    setup(window) {
      installingRealm = true;
      try {
      replace(window.console, 'error', (...args) => runtimeError('Unexpected window.console.error', args), true);
      const reportError = event => runtimeError(`Unexpected window ${event.type}`, [event.error ?? event.reason ?? event.message]);
      window.addEventListener('error', reportError);
      window.addEventListener('unhandledrejection', reportError);
      listenerRemovals.push(() => window.removeEventListener('error', reportError));
      listenerRemovals.push(() => window.removeEventListener('unhandledrejection', reportError));
      replace(window, 'fetch', fetchCapability);
      replace(window, 'EventSource', WatchSource);
      for (const name of ['WebSocket', 'XMLHttpRequest', 'Worker', 'SharedWorker']) replace(window, name, deny(`window.${name}`));
      replace(window.navigator, 'sendBeacon', deny('navigator.sendBeacon'));
      // LocalFileLink always checks this selector even for an ordinary click.
      // Accommodate ONLY its unsupported selector; no popover/menu/layout fake.
      const matches = window.Element.prototype.matches;
      const querySelector = window.Document.prototype.querySelector;
      const popovers = new WeakSet();
      if (menu || dialog) {
        // Unsupported platform APIs only. Not top-layer/geometry/focus proof.
        replace(window.Element.prototype, 'matches', function (selector) {
          return selector === ':popover-open' ? popovers.has(this) : matches.call(this, selector);
        });
        replace(window.Document.prototype, 'querySelector', function (selector) {
          return querySelector.call(this, selector === 'dialog:modal' ? 'dialog[open]' : selector);
        });
        const queryAll = window.Document.prototype.querySelectorAll;
        replace(window.Document.prototype, 'querySelectorAll', function (selector) {
          if (selector === '.file-link-hover:popover-open') return [...queryAll.call(this, '.file-link-hover')].filter(node => popovers.has(node));
          return queryAll.call(this, selector);
        });
      } else {
        try { window.document.createElement('span').matches(':popover-open'); }
        catch {
          replace(window.Element.prototype, 'matches', function (selector) {
            return selector === ':popover-open' ? false : matches.call(this, selector);
          });
        }
      }
      if (dialog) {
        replace(window.HTMLDialogElement.prototype, 'showModal', function () { this.open = true; });
        replace(window.HTMLDialogElement.prototype, 'close', function () { this.open = false; this.dispatchEvent(new window.Event('close')); });
      }
      if (menu) {
        replace(window.HTMLElement.prototype, 'showPopover', function () { popovers.add(this); });
        replace(window.HTMLElement.prototype, 'hidePopover', function () { popovers.delete(this); });
        const rect = { x: 30, y: 30, left: 30, top: 30, right: 230, bottom: 54, width: 200, height: 24 };
        replace(window.HTMLElement.prototype, 'getClientRects', function () { return this.closest('[hidden], [inert]') ? [] : [rect]; });
        replace(window.HTMLElement.prototype, 'getBoundingClientRect', () => rect);
        class IntersectionCapability {
          constructor() { intersections.add(this); }
          observe() {}
          disconnect() { intersections.delete(this); }
        }
        own('IntersectionObserver', IntersectionCapability);
        replace(window, 'IntersectionObserver', IntersectionCapability);
        own('innerWidth', 1200); own('innerHeight', 800);
        // Measurement callbacks are explicitly cancelled by LocalFileLink cleanup;
        // no browser frame is run as a background flush or policy clock.
        replace(window, 'requestAnimationFrame', callback => { const id = ++nextCallback; frames.set(id, callback); return id; });
        replace(window, 'cancelAnimationFrame', id => { frames.delete(id); });
      }
      if (idle) {
        replace(window, 'requestIdleCallback', callback => { const id = ++nextCallback; idleCallbacks.set(id, callback); return id; });
        replace(window, 'cancelIdleCallback', id => { idleCallbacks.delete(id); });
      }
      const mql = {
        matches: false, media: '(prefers-color-scheme: dark)', onchange: null,
        addEventListener(_type, listener) { mqlListeners.add(listener); },
        removeEventListener(_type, listener) { mqlListeners.delete(listener); },
        addListener(listener) { mqlListeners.add(listener); },
        removeListener(listener) { mqlListeners.delete(listener); },
        dispatchEvent() { return true; },
      };
      // Deterministic unsupported capability, not a theme-store replacement.
      replace(window, 'matchMedia', () => mql);
      class ResizeObserverDouble {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); observers.delete(this); }
      }
      replace(window, 'ResizeObserver', ResizeObserverDouble);
      own('ResizeObserver', ResizeObserverDouble);
      own('localStorage', window.localStorage);
      own('sessionStorage', window.sessionStorage);
      own('requestAnimationFrame', window.requestAnimationFrame.bind(window));
      own('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
      } finally { installingRealm = false; }
    },
    // Passed directly to mount.beforeDispose. Separately idempotent: NEVER calls
    // view.dispose, closes the realm, restores guards or assumes a returned view.
    settle() {
      if (!settlement) {
        closed = true;
        settlement = (async () => {
          releaseAll(); // Also precedes act itself if it rejects before its callback.
          try { await act(async () => { releaseAll(); await join(); }); }
          catch (error) { failures.push(error); }
          finally {
            releaseAll();
            try { await join(); } catch (error) { failures.push(error); }
          }
          for (const assertion of [
            () => assert.equal(plans.length, 0, 'unadmitted expected request(s)'),
            () => assert.equal(sources.filter(source => !source.closed).length, 0, 'production must close its streams'),
            () => assert.equal(observers.size, 0, 'production must disconnect ResizeObservers'),
            () => assert.equal(frames.size, 0, 'production cancels menu measurement frames'),
            () => assert.equal(intersections.size, 0, 'production disconnects menu intersection observers'),
            () => assert.equal(idleCallbacks.size, 0, 'production cancels queued idle grants'),
            ...invariants,
          ]) {
            try { assertion(); } catch (error) { failures.push(error); }
          }
          // Full admitted work is joined above. Restore REALM descriptors before
          // mount.beforeDispose returns; HOST guards/collectors remain until dispose.
          attemptAll(realmRestores);
          assertHealthy();
        })();
        void settlement.catch(() => {});
      }
      return settlement;
    },
    dispose(unmount = async () => {}, disposeRealm = async () => {}) {
      if (!disposal) {
        disposal = (async () => {
          try {
            releaseAll(); // Before the FIRST owned wait, even if unmount/act never enters.
            try { await unmount(); } catch (error) { failures.push(error); }
            try { await this.settle(); } catch { /* live failures retained */ }
          } finally {
            try { await disposeRealm(); } catch (error) { failures.push(error); }
            releaseAll();
            try { await join(); } catch (error) { failures.push(error); }
            mqlListeners.clear(); restoreAll();
          }
          assertHealthy();
        })();
        void disposal.catch(() => {});
      }
      return disposal;
    },
  };
}
