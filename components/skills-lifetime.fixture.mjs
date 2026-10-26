import assert from 'node:assert/strict';
import { act } from 'react';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch } from '../lib/testing/leaf-controls.fixture.mjs';

/** Selected Skills catalogue/instructions/PATCH lifetime only. Actual production
 * SettingsWorkContext observations are complete original callback promises.
 * Transport/body delivery is deliberately NOT used as the handler join.
 * No native resource, arbitrary Markdown child or universal-idle claim.
 */
export function skillsLifetime(t, route) {
  const works = [], failures = [], realms = [];
  let http, leafCleanup, view, open = true, domain, disposal;
  const record = error => { failures.push(error); };
  const onUnhandled = error => record(error);
  const attempt = async (errors, callback) => { try { await callback(); } catch (error) { errors.push(error); } };
  const onWork = (label, promise) => {
    if (!open) record(new Error(`Late Skills operation: ${label}`));
    const work = { label, promise, settled: false };
    works.push(work);
    // Keep the original rejection observable and retain unexpected failures even
    // if a future caller catches them. This observer does not throw a detached rejection.
    promise.then(() => { work.settled = true; }, error => { work.settled = true; record(error); });
  };
  const joinWork = async label => {
    let cursor = 0;
    while (cursor < works.length) {
      const batch = works.slice(cursor); cursor = works.length;
      await Promise.allSettled(batch.filter(work => label === undefined || work.label === label).map(work => work.promise));
    }
  };
  const releaseAll = errors => {
    for (const request of http?.requests ?? []) {
      try {
        // Accepted writes may finish after unmount. Never certify fake success
        // for an unanswered operation; use a named controlled HTTP failure.
        request.reply(request.answered ? request.replyData : { error: 'fixture teardown' },
          request.answered ? request.replyStatus : 503);
      } catch (error) { errors.push(error); }
    }
  };
  const settleDomain = () => domain ??= (async () => {
    open = false;
    const errors = [];
    await attempt(errors, () => act(async () => { releaseAll(errors); await joinWork(); }));
    // An act/release failure must not skip independent peers or original chains.
    releaseAll(errors);
    await attempt(errors, () => joinWork());
    if (errors.length || failures.length) throw new AggregateError([...errors, ...failures], 'Skills domain release/join failed');
  })();
  const dispose = () => disposal ??= (async () => {
    open = false;
    const errors = [];
    await attempt(errors, async () => { await view?.unmount(); });
    await attempt(errors, settleDomain);
    // Each shared disposer calls the SAME settleDomain after unmount. There is
    // no call from settleDomain back to view.dispose, so no circular await.
    for (const closeRealm of realms) await attempt(errors, closeRealm);
    // controlledLeafFetch was intentionally never bound to a view. Its cleanup
    // joins its transport/JSON owner and restores guards, but cannot dispose our realm.
    await attempt(errors, async () => { await leafCleanup?.(); });
    process.off('unhandledRejection', onUnhandled);
    if (errors.length || failures.length) throw new AggregateError([...errors, ...failures], 'Skills lifetime cleanup failed');
  })();
  // Own partial constructor/import/setup/render failures before installing ports
  // or admitting production work. Do not wait for a successful mount/bind.
  t.after(dispose);
  process.on('unhandledRejection', onUnhandled);
  http = controlledLeafFetch({ after(callback) { leafCleanup = callback; } }, request => {
    assert.equal(open, true, 'no new Skills request root during disposal');
    return route(request);
  });
  const assertHealthy = () => {
    http.assertHealthy();
    if (failures.length) throw new AggregateError([...failures], 'Skills observed handler/runtime failure');
  };
  return {
    onWork, works, settleDomain, dispose,
    async join(label) { await act(async () => { await joinWork(label); }); assertHealthy(); },
    async mount(element, { setup } = {}) {
      view = await mount({ after(callback) { realms.push(callback); } }, element, {
        beforeDispose: settleDomain,
        setup: async window => { http.setup(window); await setup?.(window); },
      });
      await act(async () => { await joinWork(); });
      assertHealthy();
      return view;
    },
    http: {
      requests: http.requests,
      assertHealthy,
      async reply(request, data = {}, status = 200) {
        http.check(() => assert.equal(http.requests.includes(request), true, 'named accepted Skills request'));
        await act(async () => { request.reply(data, status); await joinWork(); });
        assertHealthy();
      },
    },
  };
}
