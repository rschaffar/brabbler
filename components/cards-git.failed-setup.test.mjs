import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { packet } from './cards-git.fixture.mjs';

// Separate file; no Pierre module/constructor registration across these realms.
// Both controls invoke actual Cards/central disposers, never a copied owner.
const names = ['fetch', 'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent', 'PointerEvent',
  'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  'localStorage', 'sessionStorage', 'HTMLDialogElement', 'HTMLPreElement', 'HTMLStyleElement', 'HTMLDivElement', 'HTMLButtonElement',
  'Document', 'DocumentFragment', 'SVGElement', 'SVGSVGElement', 'ShadowRoot', 'customElements', 'CSSStyleSheet',
  'WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'Audio', 'Image'];

test('Cards failed setup joins the registered HTTP owner before realm restore and unwinds host fetch LIFO last', async t => {
  const before = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const hooks = [], failures = [], phases = [];
  let realm, cleaned = false;
  const setupFailure = new Error('owned failure after actual realm override installation');
  // This collector/cleanup exists BEFORE packet dependency load or setup.
  const cleanup = async () => {
    if (cleaned) return; cleaned = true;
    for (const hook of hooks) { try { await hook(); } catch (error) { failures.push(error); } }
    if (failures.length) throw new AggregateError(failures, 'failed-setup owner cleanup failures');
  };
  t.after(cleanup);
  const domain = {
    fetch() { const error = new Error('no HTTP is admitted by failed setup'); failures.push(error); throw error; },
    release() { phases.push('release'); assert.equal(globalThis.fetch, domain.fetch, 'inner fetch remains guarded through domain release'); },
    async join() {
      phases.push('join');
      assert.equal(globalThis.document, realm.document, 'join occurs BEFORE central realm restoration');
      assert.equal(globalThis.customElements, realm.customElements);
    },
  };
  const ownedTest = { mock: t.mock, after(fn) { hooks.push(fn); } };
  try {
    await assert.rejects(packet(ownedTest, { readDomain: domain, setup(window, installRealm) {
      realm = window;
      // A key also owned by central mount exposes restoration in the WRONG
      // phase: outer restoration would reinstall this now-disposed document.
      installRealm(globalThis, 'document', window.document);
      throw setupFailure;
    } }), error => error === setupFailure);
  } finally { await cleanup(); }
  assert.deepEqual(phases, ['release', 'join'], 'failed setup joins the registered domain exactly once');
  for (const name of names) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, name), before.get(name), `no disposed-realm/global descriptor drift: ${name}`);
});

test('Cards caught independent collector error remains a rejection only after actual owner joins and full descriptor restoration', async t => {
  const before = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  // Build the collector BEFORE dependency admission, but do not register an
  // asserting hook that can run ahead of the actual owner's cleanup hook.
  const collectorFailure = new Error('owned caught HTTP collector control');
  const collected = [], hooks = [], phases = [];
  let realm, disposal;
  const domain = {
    fetch(input, init = {}) {
      const url = new URL(input, 'https://fixture.invalid');
      assert.equal(url.origin, 'https://fixture.invalid');
      assert.equal(url.pathname, '/fixture/collector-control'); assert.equal(url.search, '');
      assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined);
      collected.push(collectorFailure); // record BEFORE the caller can catch it
      return Promise.reject(collectorFailure);
    },
    release() {
      phases.push('release');
      assert.equal(globalThis.fetch, domain.fetch, 'host capability remains owned through peer release');
    },
    async join() {
      phases.push('join');
      assert.equal(globalThis.document, realm.document, 'collector join precedes realm/central restoration');
      assert.equal(globalThis.customElements, realm.customElements);
      if (collected.length) throw new AggregateError([...collected], 'independent caught collector input');
    },
  };
  // Contain ONLY this deliberately injected Error by identity. Any other leaf,
  // including native-boundary or restoration failures, rejects the control.
  const onlyInjectedCause = (error, depth = 0) => error === collectorFailure ||
    (depth < 8 && error instanceof AggregateError && error.errors.length > 0 &&
      error.errors.every(cause => onlyInjectedCause(cause, depth + 1)));
  const disposeRegisteredOwners = () => {
    if (!disposal) disposal = (async () => {
      const errors = [];
      // Call the actual registered Cards and mount handles independently, even
      // when the first rejects. This is control containment, not a new owner.
      for (const hook of hooks) { try { await hook(); } catch (error) { errors.push(error); } }
      if (errors.length) throw new AggregateError(errors, 'actual owner cleanup results retained');
    })();
    void disposal.catch(() => {});
    return disposal;
  };
  t.after(async () => { await assert.rejects(disposeRegisteredOwners(), onlyInjectedCause); });
  const ownedTest = { mock: t.mock, after(fn) { hooks.push(fn); } };
  const h = await packet(ownedTest, { readDomain: domain, setup(window, installRealm) {
    realm = window;
    installRealm(globalThis, 'document', window.document);
  } });
  assert.equal(hooks.length, 2, 'actual Cards disposer registered before central mount disposer');
  assert.equal(hooks[0], h.cleanup); assert.equal(hooks[1], h.view.dispose);
  await assert.rejects(globalThis.fetch('/fixture/collector-control'), error => error === collectorFailure);
  assert.deepEqual(collected, [collectorFailure], 'caller catch cannot erase the independent collector');
  await assert.rejects(disposeRegisteredOwners(), onlyInjectedCause);
  assert.deepEqual(phases, ['release', 'join'], 'peer release and failing collector join each complete once');
  assert.equal(collected[0], collectorFailure, 'actual failure cause retained after complete disposal');
  for (const name of names) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, name), before.get(name), `caught collector failure leaves no descriptor drift: ${name}`);
});
