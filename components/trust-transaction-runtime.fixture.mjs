import assert from 'node:assert/strict';
import { createElement as h, act } from 'react';
import { createJiti } from 'jiti';
import { settingsFixture } from './settings.fixture.mjs';

export const ROOT = '/synthetic/registered-root/worktree';
export const SIDEBAR = '/synthetic/unrelated-sidebar';
export const restricted = { requiresTrust: true, trusted: false, scope: 'none', repositoryRoot: '/synthetic/registered-root', checkoutRoot: ROOT, repositoryTrusted: false, worktreeDecision: null };
export const granted = { ...restricted, trusted: true, scope: 'worktree', worktreeDecision: true };
export const choice = { scope: 'worktree', action: 'trust' };

export async function trustFixture(t, { capabilities, beforeRestore } = {}) {
  let observe, graph, current, props;
  // settingsFixture installs its collector/cleanup BEFORE invoking loadGraph.
  const f = await settingsFixture(t, {
    beforeRestore,
    loadGraph: () => {
      const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
      return jiti.import('./project-trust-transaction.fixture.tsx');
    },
    capabilities(port) { observe = port.observe; capabilities?.(port); },
  });
  graph = await f.load();
  const api = {
    f, graph,
    state() { return JSON.parse(f.node('[data-trust-state]').textContent); },
    async mount(extra = {}, options = {}) {
      props = { cwd: ROOT, sidebarCwd: SIDEBAR, initialStatus: restricted,
        own: observe, onCommit(value) { current = value; }, ...extra };
      return f.mount(h(graph.TrustTransactionHarness, props), options);
    },
    async cwd(cwd) { props = { ...props, cwd }; await f.rerender(h(graph.TrustTransactionHarness, props)); },
    radio(title) {
      const label = [...f.view.container.querySelectorAll('label')].find(node => node.querySelector('strong')?.textContent === title);
      assert.ok(label, title); return label.querySelector('input');
    },
    async select(title = 'Trust this worktree only') { await f.click(api.radio(title)); },
    async confirm() { await f.click(f.button('Apply trust decision'), { settle: false }); },
    async invoke(value = choice) {
      let promise;
      await act(async () => { promise = current.respond(value); });
      assert.equal(f.works.at(-1).promise, promise, 'same public production promise, not a wrapper promise');
      return { promise }; // Do not async-assimilate the held production promise.
    },
    route(reply, value = choice, cwd = ROOT) {
      f.route('POST', '/api/project-trust', { body: { cwd, ...value }, reply });
    },
    assertPost(value = choice, cwd = ROOT) {
      assert.equal(f.requests.length, 1, 'exactly one admitted request, no replay/read');
      const request = f.requests[0];
      assert.equal(request.method, 'POST'); assert.equal(request.path, '/api/project-trust');
      assert.equal(request.serializedBody, JSON.stringify({ cwd, ...value }));
      assert.deepEqual(request.body, { cwd, ...value });
      assert.equal(request.signal, undefined);
    },
  };
  return api;
}
