import assert from 'node:assert/strict';
import { act } from 'react';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch } from '../lib/testing/leaf-controls.fixture.mjs';

/** Selected Skills catalogue/instructions/PATCH lifetime only. Actual production
 * SettingsWorkContext observations are complete original callback promises.
 * Transport/body delivery is deliberately NOT used as the handler join.
 * No native resource, arbitrary Markdown child or universal-idle claim.
 */
// External API replies, not an alternate resolver/transport implementation.
export const resourceKeys = Object.fromEntries(['group', 'package', 'skill', 'extension', 'standalone'].map(kind => [kind,
  JSON.stringify(['/fixture/agent', ['global'], kind === 'standalone' ? 'skill' : kind,
    kind === 'group' ? 'core' : `/fixture/${kind}`]) ]));
export function resourceInventory({ cwd = '/fixture', sessionId = 'session-A', state = 'applied' } = {}) {
  const scopes = { global: true, project: Boolean(cwd), session: Boolean(cwd && sessionId) };
  const desired = key => ({ key, own: { enabled: true, source: 'default' }, enabled: true, disabledReasons: [], gates: [],
    scopes: Object.fromEntries(Object.entries(scopes).map(([scope, editable]) => [scope, { editable, choice: editable ? 'inherit' : null, own: editable ? { enabled: true, source: 'default' } : null }])) });
  const row = (kind, key, parentKey, path) => ({ kind, path, scope: 'user', source: 'fixture', membership: 'confirmed',
    nativeEnabled: kind === 'skill' ? false : null, observedPaths: [], managedBy: 'nix', ownership: 'readonly', selectionKey: key, parentKey, desired: desired(key) });
  return { version: 1, state: 'desired', contextToken: 'context-token', context: { cwd, sessionId: cwd ? sessionId : null, scopes },
    scopes: Object.fromEntries(Object.entries(scopes).map(([scope, supported]) => [scope, supported ? { revision: `${scope}-revision`, ownChoices: [] } : null])),
    runtime: cwd && sessionId ? { sessionId, state, savedRevision: 'saved-revision', appliedRevision: state === 'applied' ? 'saved-revision' : 'old-revision', applyingRevision: null } : null,
    catalog: { coverage: 'fixture native coverage', diagnostics: [{ code: 'retained', severity: 'warning', path: '/fixture/missing', message: 'Repair the missing declaration; preferences retained' }],
      presentation: { groups: [{ key: 'core', purpose: 'Core guidance' }], packages: [{ source: '/fixture/package', label: 'Tooling', group: 'core', members: [] }], standalone: [] },
      rows: [row('group', resourceKeys.group, null, 'core'), row('package', resourceKeys.package, resourceKeys.group, '/fixture/package'),
        { ...row('skill', resourceKeys.skill, resourceKeys.package, '/fixture/skill'), skill: { name: 'Guide', description: 'Guidance description', disableModelInvocation: true } },
        row('extension', resourceKeys.extension, resourceKeys.package, '/fixture/extension'),
        { ...row('skill', resourceKeys.standalone, null, '/fixture/standalone'), skill: { name: 'Standalone', description: 'Standalone guidance', disableModelInvocation: false } } ] } };
}

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
    async mount(element, { setup, settle = true } = {}) {
      view = await mount({ after(callback) { realms.push(callback); } }, element, {
        beforeDispose: settleDomain,
        setup: async window => { http.setup(window); await setup?.(window); },
      });
      if (settle) await act(async () => { await joinWork(); });
      assertHealthy();
      return view;
    },
    http: {
      requests: http.requests,
      assertHealthy,
      async reply(request, data = {}, status = 200, work) {
        http.check(() => assert.equal(http.requests.includes(request), true, 'named accepted Skills request'));
        await act(async () => { request.reply(data, status); if (work) await Promise.allSettled(work); else await joinWork(); });
        assertHealthy();
      },
    },
  };
}
