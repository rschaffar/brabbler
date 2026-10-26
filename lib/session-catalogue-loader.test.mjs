import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { SessionCatalogueLoader } = await jiti.import('./session-catalogue-loader.ts');
const reply = (version = 1, sessions = [{ id: 'a' }]) => ({ sessionListVersion: version, sessions });

function fixture(t) {
  const calls = [], arrivals = [], waiting = [], work = [], published = [], errors = [], loading = [], timers = new Map();
  let timerId = 0, automatic = false;
  const loader = new SessionCatalogueLoader({
    read(mode) {
      let resolve, reject;
      const body = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      const owner = work.find(row => !row.assigned && !row.done);
      assert.ok(owner, 'transport workflow observed before admission'); owner.assigned = true;
      const request = { mode, resolve, reject, workflow: owner.promise, answered: false };
      calls.push(request);
      if (automatic) { request.answered = true; resolve(reply()); }
      if (waiting.length) waiting.shift()(request); else arrivals.push(request);
      return body;
    },
    publish: data => published.push(data), error: value => errors.push(value), loading: value => loading.push(value),
    schedule(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    cancel: id => timers.delete(id), observe(promise) {
      const row = { promise, assigned: false, done: false }; work.push(row);
      void promise.then(() => { row.done = true; }, () => { row.done = true; });
    },
  });
  t.after(async () => {
    // Close admission synchronously before releasing every admitted body.
    const disposal = loader.dispose();
    for (const request of calls) if (!request.answered) request.resolve(reply());
    await disposal;
    for (const row of work) await row.promise;
  });
  return {
    loader, calls, published, errors, loading, timers,
    async join() { for (const row of work) await row.promise; },
    automaticReplies() { automatic = true; },
    async advanceHydration() {
      for (const [id, timer] of [...timers]) if (timer.ms === 750) { timers.delete(id); timer.callback(); }
      for (const row of work) await row.promise;
    },
    next: () => arrivals.length ? Promise.resolve(arrivals.shift()) : new Promise(resolve => waiting.push(resolve)),
    async answer(request, data = reply(), error) {
      request.answered = true;
      if (error) request.reject(error); else request.resolve(data);
      await request.workflow;
    },
    fire() { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; assert.equal(timer.ms, 750); timers.delete(id); timer.callback(); },
  };
}

test('warm complete summary absorbs version observations and has no deferred detail request', async t => {
  const h = fixture(t); h.loader.retain();
  const initial = await h.next(); assert.equal(initial.mode, 'summary');
  const observed = h.loader.observeVersion(1);
  await h.answer(initial);
  assert.equal(await observed, true);
  assert.equal(await h.loader.observeVersion(1), true);
  h.automaticReplies(); await h.advanceHydration();
  assert.equal(h.calls.length, 1, 'no extra forced response after the deferred opportunity'); assert.equal(h.timers.size, 0);
});

test('pending, empty and failed summaries retain one deferred forced fallback', async t => {
  for (const [name, data, error] of [
    ['pending', reply(1, [{ id: 'a', detailsPending: true }])], ['empty', reply(1, [])],
    ['failed', undefined, new Error('initial failure')],
  ]) {
    await t.test(name, async sub => {
      const h = fixture(sub); h.loader.retain();
      await h.answer(await h.next(), data, error);
      h.fire(); const detail = await h.next(); assert.equal(detail.mode, 'force');
      await h.answer(detail, reply()); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 2);
      if (error) assert.ok(h.errors.some(value => value?.includes('initial failure')));
    });
  }
});

test('startup observations and forced notifications merge without superseding summary paint', async t => {
  const h = fixture(t); h.loader.retain(); const summary = await h.next();
  const a = h.loader.observeVersion(2), b = h.loader.notify(), c = h.loader.notify();
  assert.equal(h.calls.length, 1);
  await h.answer(summary, reply(1, [{ id: 'a', detailsPending: true }]));
  assert.equal(h.published.length, 1, 'summary still publishes before detail');
  const force = await h.next(); assert.equal(force.mode, 'force'); assert.equal(h.timers.size, 0);
  await h.answer(force, reply(2));
  assert.deepEqual(await Promise.all([a, b, c]), [true, true, true]);
  assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 0);
});

test('mutations invalidate stale bodies and transfer waiters to a qualifying forced follow-up', async t => {
  const h = fixture(t); h.loader.retain(); const summary = await h.next();
  const ordinary = h.loader.refresh(false), forced = h.loader.refresh(true);
  await h.answer(summary);
  assert.equal(h.published.length, 0);
  const first = await h.next(); assert.equal(first.mode, 'force');
  const later = h.loader.refresh(true);
  await h.answer(first, reply(2)); assert.equal(h.published.length, 0);
  const second = await h.next(); assert.equal(second.mode, 'force');
  await h.answer(second, reply(3));
  assert.deepEqual(await Promise.all([ordinary, forced, later]), [true, true, true]);
  assert.equal(h.published.length, 1); assert.equal(h.published[0].sessionListVersion, 3);
});

test('opaque decreasing and A/B/A versions reconcile with bounded attempts, not numeric ordering', async t => {
  const h = fixture(t); h.loader.retain(); await h.answer(await h.next(), reply(10));
  const decreasing = h.loader.observeVersion(0); const request = await h.next();
  await h.answer(request, reply(1)); assert.equal(await decreasing, true);
  assert.equal(h.calls.length, 2, 'mismatch after a post-observation read never loops');
  const a = h.loader.observeVersion(2); const active = await h.next();
  const b = h.loader.observeVersion(3), again = h.loader.observeVersion(2);
  await h.answer(active, reply(2));
  assert.deepEqual(await Promise.all([a, b, again]), [true, true, true]);
  assert.equal(h.calls.length, 3);
});

test('eligible failures fail waiters; obsolete errors/finally cannot publish state', async t => {
  const h = fixture(t); h.loader.retain(); await h.answer(await h.next());
  const older = h.loader.refresh(false, true); const first = await h.next();
  const newer = h.loader.refresh(true, true); const errorCount = h.errors.length, loadingCount = h.loading.length;
  await h.answer(first, undefined, new Error('obsolete'));
  assert.equal(h.errors.length, errorCount); assert.equal(h.loading.length, loadingCount);
  const current = await h.next(); assert.equal(current.mode, 'force');
  await h.answer(current, undefined, new Error('current'));
  assert.deepEqual(await Promise.all([older, newer]), [false, false]);
  assert.equal(h.errors.at(-1), 'Error: current'); assert.equal(h.timers.size, 0);
});

test('Strict replay retains one bootstrap; terminal release joins held bodies without publication', async t => {
  const h = fixture(t); const release = h.loader.retain(); release(); const releaseAgain = h.loader.retain();
  const initial = await h.next(); await h.answer(initial); assert.equal(h.calls.length, 1);
  const refresh = h.loader.refresh(true); const held = await h.next();
  let settled = false; const completion = refresh.then(value => { settled = true; return value; });
  releaseAgain();
  assert.equal(await h.loader.notify(), false, 'release immediately closes admission');
  assert.equal(settled, false, 'release cannot settle a waiter before its admitted body');
  const count = h.published.length;
  await h.answer(held); await h.join();
  assert.equal(await completion, false); assert.equal(h.published.length, count);
  assert.equal(h.calls.length, 2);
});

test('late notifications cannot be satisfied by already-started ordinary or forced work', async t => {
  for (const force of [false, true]) for (const fail of [false, true]) {
    await t.test(`${force ? 'forced' : 'ordinary'} / ${fail ? 'failure' : 'success'}`, async sub => {
      const h = fixture(sub); h.loader.retain(); await h.answer(await h.next());
      const prior = h.loader.refresh(force); const older = await h.next();
      let notificationSettled = false;
      const notification = h.loader.notify().then(value => { notificationSettled = true; return value; });
      const version = h.loader.observeVersion(3);
      await h.answer(older, reply(2)); assert.equal(await prior, true);
      assert.equal(notificationSettled, false);
      const followup = await h.next(); assert.equal(followup.mode, 'force');
      await h.answer(followup, reply(3), fail ? new Error('followup failure') : undefined);
      assert.deepEqual(await Promise.all([notification, version]), [!fail, !fail]);
      assert.equal(h.calls.length, 3, 'one forced follow-up, never a mismatch retry loop');
    });
  }
});
