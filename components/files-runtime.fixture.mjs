import assert from 'node:assert/strict';
import { act } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { encodeFilePathForApi } from '../lib/file-paths.ts';

// Files requests intentionally have no AbortSignal. Do not relax the separate
// ignored-abort fixture's signal requirement for GitExplorer/Move owners.
export function filesRuntime() {
  const requests = [], sources = [], plans = [], tasks = [], failures = [];
  const previous = new Map(), mqlListeners = new Set(), observers = new Set();
  const closingError = new Error('Files fixture closed before delivery');
  let closed = false, disposal;
  const own = (key, value) => {
    if (!previous.has(key)) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
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
    if (failures.length) throw new AggregateError([...failures], 'Files runtime capability failures');
  };
  function matchRequest(url, init, match) {
    const git = match.type === 'git';
    assert.equal(url.origin, 'https://fixture.invalid', 'no external network');
    assert.equal(url.pathname, git ? '/api/git/diff' : `/api/files/${encodeFilePathForApi(match.path)}`);
    assert.equal(init.method ?? 'GET', match.method ?? (match.type === 'save' ? 'PUT' : 'GET'));
    assert.equal(init.signal, undefined, 'ordinary FileViewer fetch must not invent an abort signal');
    const query = git ? { cwd: match.cwd, path: match.path } : { type: match.type };
    for (const key of ['sessionId', 'viewerCwd', 'offset']) {
      if (match[key] !== undefined && match[key] !== null) query[key] = String(match[key]);
    }
    assert.deepEqual([...url.searchParams].sort(), Object.entries(query).sort(), 'exact request context/query');
    if (Object.hasOwn(match, 'body')) assert.deepEqual(JSON.parse(init.body), match.body);
  }
  own('fetch', (input, init = {}) => {
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
  });
  class WatchSource {
    constructor(input) {
      check(() => {
        assert.equal(closed, false, 'watch admitted after fixture closure');
        this.url = new URL(String(input), 'https://fixture.invalid/');
        assert.equal(this.url.origin, 'https://fixture.invalid');
        assert.match(this.url.pathname, /^\/api\/files\/.+/);
        assert.equal(this.url.searchParams.get('type'), 'watch');
        assert.ok([...this.url.searchParams.keys()].every(key => ['type', 'sessionId'].includes(key)));
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
  own('EventSource', WatchSource);

  return {
    requests, sources,
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
            bodyReleased = true; bodyGate.resolve(payload);
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
        releaseForCleanup() {
          if (!headersReleased) { headersReleased = true; headerGate.reject(closingError); }
          if (!bodyReleased) { bodyReleased = true; bodyGate.reject(closingError); }
        },
      };
      plans.push(ticket);
      return ticket;
    },
    setup(window) {
      const mql = {
        matches: false, media: '(prefers-color-scheme: dark)', onchange: null,
        addEventListener(_type, listener) { mqlListeners.add(listener); },
        removeEventListener(_type, listener) { mqlListeners.delete(listener); },
        addListener(listener) { mqlListeners.add(listener); },
        removeListener(listener) { mqlListeners.delete(listener); },
        dispatchEvent() { return true; },
      };
      // Deterministic unsupported capability, not a theme-store replacement.
      window.matchMedia = () => mql;
      class ResizeObserverDouble {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); observers.delete(this); }
      }
      window.ResizeObserver = ResizeObserverDouble;
      own('ResizeObserver', ResizeObserverDouble);
      own('localStorage', window.localStorage);
      own('sessionStorage', window.sessionStorage);
      own('requestAnimationFrame', window.requestAnimationFrame.bind(window));
      own('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    },
    // Full fixture-owned join only. FileViewer has no production disposal promise.
    dispose(unmount = async () => {}) {
      if (!disposal) {
        closed = true;
        disposal = (async () => {
          try { await unmount(); } catch (error) { failures.push(error); }
          try {
            await act(async () => {
              for (const ticket of requests) ticket.releaseForCleanup();
              // Include handlers/deliveries added while earlier tasks settle.
              let joined = 0;
              while (joined < tasks.length) {
                const batch = tasks.slice(joined); joined = tasks.length;
                await Promise.all(batch);
              }
            });
          } catch (error) { failures.push(error); }
          try {
            assert.equal(plans.length, 0, 'unadmitted expected request(s)');
            assert.equal(sources.filter(source => !source.closed).length, 0, 'production must close its streams');
            assert.equal(observers.size, 0, 'production must disconnect ResizeObservers');
          } catch (error) { failures.push(error); }
          mqlListeners.clear();
          for (const [key, descriptor] of [...previous].reverse()) {
            try {
              if (descriptor) Object.defineProperty(globalThis, key, descriptor);
              else delete globalThis[key];
            } catch (error) { failures.push(error); }
          }
          assertHealthy();
        })();
        void disposal.catch(() => {});
      }
      return disposal;
    },
  };
}
