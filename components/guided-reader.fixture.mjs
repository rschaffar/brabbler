import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { act } from 'react';
import { mount } from '../lib/testing/react.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';

// Controlled transport only; actual parser, reader, source and shared Markdown mount.
// No native layout, Git authorization, networking or Pierre rendering claim.
export function guidedRuntime(t, { releasePresenters, joinPresenters, setupPresenters, beforeRealmRestore } = {}) {
  const requests = [], expected = [], work = [], errors = [], restores = [], realmRestores = [], expectedErrors = new Set();
  const objectUrls = new Map(), revokedUrls = []; let nextUrl = 0;
  let closed = false, view, disposal;
  const replace = (object, key, value, lane = restores) => {
    const old = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
    lane.push(() => old ? Object.defineProperty(object, key, old) : delete object[key]);
  };
  const deny = name => (...args) => { const error = new Error(`Unexpected ${name}: ${inspect(args)}`); errors.push(error); throw error; };
  const onWork = promise => { const entry = { promise, error: null }; work.push(entry); promise.catch(error => { entry.error = error; }); };
  const fetch = async (input, init = {}) => {
    try {
      assert.equal(closed, false, 'read admission open');
      const url = new URL(String(input), 'https://fixture.invalid');
      assert.equal(url.origin, 'https://fixture.invalid'); assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal);
      const ticket = expected.shift(); assert.ok(ticket, `unexpected ${url.pathname} ${url.search}`);
      assert.equal(url.pathname, ticket.path);
      assert.deepEqual([...url.searchParams].sort(), Object.entries(ticket.query).sort());
      ticket.signal = init.signal; ticket.admitted = true; ticket.arrived.resolve(); requests.push(ticket);
      const consume = async kind => { assert.equal(kind, ticket.kind); ticket.jsonEntered = true; try { return await ticket.body.promise; } finally { ticket.jsonDone = true; } };
      return { ok: ticket.status === 200, status: ticket.status, json: () => consume('json'), blob: () => consume('blob') };
    } catch (error) { errors.push(error); throw error; }
  };
  replace(globalThis, 'fetch', fetch);
  for (const name of ['WebSocket', 'XMLHttpRequest', 'EventSource']) replace(globalThis, name, deny(name));
  const original = console.error;
  replace(console, 'error', (...args) => { errors.push(new Error(inspect(args))); original(...args); });
  const releaseAll = () => {
    try { releasePresenters?.(); } catch (error) { errors.push(error); }
    for (const ticket of requests) if (!ticket.settled) { ticket.settled = true; ticket.body.reject(new Error('controlled teardown body rejection')); }
  };
  const settle = async () => {
    releaseAll();
    let joined = 0;
    while (joined < work.length) { const peers = work.slice(joined); joined = work.length; await Promise.allSettled(peers.map(entry => entry.promise)); }
    try { await joinPresenters?.(); } catch (error) { errors.push(error); }
  };
  const beforeDispose = async () => {
    await settle();
    try { beforeRealmRestore?.(); } catch (error) { errors.push(error); }
    for (const restore of realmRestores.splice(0).toReversed()) restore();
  };
  const dispose = () => disposal ??= (async () => {
    closed = true; releaseAll();
    try { await view?.unmount(); } catch (e) { errors.push(e); }
    try { await settle(); } catch (e) { errors.push(e); }
    try { await view?.dispose(); } catch (e) { errors.push(e); }
    for (const restore of restores.toReversed()) try { restore(); } catch (e) { errors.push(e); }
    for (const entry of work) if (entry.error && !expectedErrors.has(entry.error)) errors.push(entry.error);
    if (objectUrls.size) errors.push(new Error('Object URL survived evidence unmount'));
    if (errors.length) throw new AggregateError(errors, 'Guided runtime failures');
  })();
  t.after(dispose);
  return {
    requests, onWork, dispose, objectUrls, revokedUrls,
    expectFailure: error => expectedErrors.add(error),
    async join(from = 0) { await act(async () => { await Promise.allSettled(work.slice(from).map(entry => entry.promise)); }); },
    expect(path, query, status = 200, kind = 'json') {
      const ticket = { path, query, status, kind, body: deferred(), arrived: deferred(), settled: false, admitted: false, jsonEntered: false };
      expected.push(ticket);
      ticket.deliver = async value => {
        assert.equal(ticket.admitted, true, 'read was admitted'); assert.equal(ticket.jsonEntered, true, 'actual body entered');
        await act(async () => { ticket.settled = true; ticket.body.resolve(value); });
        assert.equal(ticket.jsonDone, true, 'body really returned');
      };
      ticket.reject = async error => { assert.equal(ticket.jsonEntered, true); await act(async () => { ticket.settled = true; ticket.body.reject(error); }); };
      return ticket;
    },
    async mount(element) {
      view = await mount(t, element, { beforeDispose, setup(window) {
        replace(window, 'fetch', fetch, realmRestores);
        replace(URL, 'createObjectURL', blob => { const url = `blob:https://fixture.invalid/${++nextUrl}`; objectUrls.set(url, blob); return url; }, realmRestores);
        replace(URL, 'revokeObjectURL', url => { assert.equal(objectUrls.delete(url), true, 'revoke exactly this owned URL'); revokedUrls.push(url); }, realmRestores);
        // Unsupported media query capability only; no theme hook/store replacement.
        replace(window, 'matchMedia', query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} }), realmRestores);
        replace(globalThis, 'localStorage', window.localStorage, realmRestores);
        for (const name of ['WebSocket', 'XMLHttpRequest', 'EventSource']) replace(window, name, deny(name), realmRestores);
        const fail = event => errors.push(event.error ?? event.reason ?? new Error(event.message));
        window.addEventListener('error', fail); window.addEventListener('unhandledrejection', fail);
        realmRestores.push(() => { window.removeEventListener('error', fail); window.removeEventListener('unhandledrejection', fail); });
        const matches = window.Element.prototype.matches;
        replace(window.Element.prototype, 'matches', function (selector) { return selector === ':popover-open' ? false : matches.call(this, selector); }, realmRestores);
        setupPresenters?.(window, (object, key, value) => replace(object, key, value, realmRestores));
      } });
      return view;
    },
    healthy() { const failure = work.find(entry => entry.error && !expectedErrors.has(entry.error)); assert.equal(!!failure, false, failure?.error?.message); assert.equal(errors.length, 0, errors[0]?.message); },
  };
}
