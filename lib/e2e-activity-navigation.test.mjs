import assert from 'node:assert/strict';
import test from 'node:test';
import { activityProjection } from '../e2e/activity.mjs';

// Real projection/route ownership, supplied browser transport only. A page body
// becomes unavailable across document navigation, as in the retained CDP trace.
function projectionCase(t, { hold, pageFailure, navigationFailure, installFailure } = {}) {
  const nativeGate = Promise.withResolvers(), pageGate = Promise.withResolvers();
  const nativeEntered = Promise.withResolvers(), pageEntered = Promise.withResolvers();
  if (hold !== 'native') nativeGate.resolve();
  if (hold !== 'page') pageGate.resolve();
  const events = [], owners = [], outcomes = [], reads = [], navigations = [];
  const expected = new Set([pageFailure, navigationFailure, installFailure].filter(Boolean));
  let document = 0, registered, installs = 0;
  const observe = work => {
    const outcome = work.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    outcomes.push(outcome); return outcome;
  };
  const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
  t.after(async () => {
    nativeGate.resolve(); pageGate.resolve();
    // Already-admitted navigation can retain a replacement during failure cleanup.
    // Join it and independently finish every captured owner before classifying errors.
    const finished = new Set();
    let count;
    do {
      for (const owner of owners) if (!finished.has(owner)) { finished.add(owner); observe(owner.finish()); }
      count = outcomes.length;
      await Promise.all(outcomes);
    } while (finished.size !== owners.length || count !== outcomes.length);
    const failures = (await Promise.all(outcomes)).filter(result => !result.ok)
      .flatMap(result => leaves(result.error)).filter(error => !expected.has(error));
    if (failures.length) throw new AggregateError([...new Set(failures)], 'Projection fixture cleanup failed');
    assert.equal(registered, undefined, 'all attempted routes are unregistered');
  });
  const page = {
    async route(pattern, handler) {
      assert.equal(pattern, '**/api/agent/running');
      events.push('route'); registered = handler;
      if (++installs === 2 && installFailure) throw installFailure;
    },
    async unroute(pattern, handler) {
      assert.equal(pattern, '**/api/agent/running');
      assert.equal(registered, handler); events.push('unroute'); registered = undefined;
    },
    async goto(url, options) {
      events.push('goto'); navigations.push({ url, options });
      if (navigationFailure) throw navigationFailure;
      document++;
    },
  };
  const project = snapshot => ({ ...snapshot, runningSessionIds: ['working-child'] });
  const owner = activityProjection(page, project); owners.push(owner);
  const read = () => {
    const admittedDocument = document, delivered = Promise.withResolvers();
    let payload;
    const record = { disposed: false };
    reads.push(record);
    const original = {
      status: () => 200,
      async json() {
        pageEntered.resolve(); await pageGate.promise;
        if (admittedDocument !== document) throw new Error('Original page body was navigated away from');
        if (pageFailure) throw pageFailure;
        events.push('page-body'); return payload;
      },
    };
    const response = {
      status: () => 200,
      async json() { nativeEntered.resolve(); await nativeGate.promise; events.push('native-body'); return { runningSessionIds: [] }; },
      async dispose() { events.push('dispose'); record.disposed = true; },
    };
    const route = {
      request: () => ({ response: () => delivered.promise }),
      fetch: async () => response,
      async fulfill(input) {
        assert.equal(input.response, response); payload = input.json;
        record.payload = payload; delivered.resolve(original);
      },
      async continue() { payload = { runningSessionIds: [] }; delivered.resolve(original); },
      async abort() { delivered.resolve(null); },
    };
    assert.equal(typeof registered, 'function');
    record.outcome = observe(registered(route));
    return record;
  };
  const retain = next => { events.push('retain'); owners.push(next); };
  return { owner, page, read, retain, observe, events, owners, navigations,
    nativeEntered, pageEntered, release() { nativeGate.resolve(); pageGate.resolve(); }, leaves };
}

for (const hold of ['native', 'page']) test(`projection joins the original ${hold} body before document navigation and rebinds the same projection`, async t => {
  const h = projectionCase(t, { hold });
  await h.owner.install();
  const first = h.read();
  await (hold === 'native' ? h.nativeEntered : h.pageEntered).promise;
  const url = 'http://fixture.invalid/?session=other', options = { waitUntil: 'domcontentloaded' };
  const navigation = h.observe(h.owner.navigate(url, options, h.retain));
  assert.equal(h.navigations.length, 0, 'navigation cannot invalidate an admitted original body');
  h.release();
  const result = await navigation;
  assert.equal(result.ok, true);
  assert.equal((await first.outcome).ok, true);
  assert.equal(first.disposed, true);
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0].url, url); assert.equal(h.navigations[0].options, options);
  assert.equal(h.owners[1], result.value);
  assert.ok(h.events.indexOf('page-body') < h.events.indexOf('goto'));
  assert.ok(h.events.indexOf('dispose') < h.events.indexOf('goto'));
  assert.ok(h.events.indexOf('unroute') < h.events.indexOf('goto'));
  assert.deepEqual(h.events.slice(-3), ['goto', 'retain', 'route']);
  const second = h.read();
  assert.equal((await second.outcome).ok, true);
  assert.deepEqual(first.payload, { runningSessionIds: ['working-child'] });
  assert.deepEqual(second.payload, first.payload, 'replacement retains the original projection function');
  await result.value.finish();
  assert.equal(second.disposed, true);
});

test('an original page-body failure vetoes navigation and remains observable', async t => {
  const failure = new Error('Original body failure');
  const h = projectionCase(t, { hold: 'page', pageFailure: failure });
  await h.owner.install(); h.read(); await h.pageEntered.promise;
  const navigation = h.observe(h.owner.navigate('http://fixture.invalid/other', {}, h.retain));
  h.release();
  const result = await navigation;
  assert.equal(result.ok, false);
  assert.ok(h.leaves(result.error).includes(failure));
  assert.equal(h.navigations.length, 0);
  assert.equal(h.owners.length, 1);
});

test('failed document navigation propagates unchanged and does not rebind', async t => {
  const failure = new Error('Navigation failure');
  const h = projectionCase(t, { navigationFailure: failure });
  await h.owner.install(); const first = h.read(); await first.outcome;
  const result = await h.observe(h.owner.navigate('http://fixture.invalid/other', {}, h.retain));
  assert.equal(result.ok, false); assert.equal(result.error, failure);
  assert.equal(first.disposed, true);
  assert.equal(h.owners.length, 1);
  assert.equal(h.events.at(-1), 'goto');
});

test('replacement is captured before fallible installation so independent cleanup can unregister it', async t => {
  const failure = new Error('Replacement install failure');
  const h = projectionCase(t, { installFailure: failure });
  await h.owner.install(); const first = h.read(); await first.outcome;
  const result = await h.observe(h.owner.navigate('http://fixture.invalid/other', {}, h.retain));
  assert.equal(result.ok, false); assert.equal(result.error, failure);
  assert.equal(h.owners.length, 2);
  assert.deepEqual(h.events.slice(-3), ['goto', 'retain', 'route']);
  await h.owners[1].finish();
  assert.equal(h.events.at(-1), 'unroute');
});
