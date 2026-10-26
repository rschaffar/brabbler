import assert from 'node:assert/strict';
import { createElement } from 'react';
import { lowerRuntime, exact, button, click } from './browser-lower-runtime.fixture.mjs';
import { ACTIONS, ROOT, inventory, details, card } from './browser-lower-cases.fixture.mjs';
export async function manager(t, { capture = inventory(), operations = [], override = () => {}, cwd = ROOT, setup } = {}) {
  const changed = [], close = [], selected = [];
  let currentCapture = capture;
  const r = await lowerRuntime(t, req => {
    const custom = override(req); if (custom?.handled) return custom.data;
    if (req.url.pathname === '/api/worktrees/manage') {
      const query = Object.fromEntries(req.url.searchParams);
      if (query.details === '1') {
        const ids = JSON.parse(query.rows); assert.ok(ids.length > 0 && ids.length <= 50);
        assert.ok(ids.every(id => currentCapture.rows.some(row => row.id === id)));
        exact(req, req.url.pathname, { cwd, captureId: currentCapture.captureId, details: '1', rows: JSON.stringify(ids), ...(query.datesOnly ? { datesOnly: '1' } : {}) }, { signal: true, cache: 'no-store' });
        return details(currentCapture.captureId, ids, { dates: query.datesOnly === '1' });
      }
      assert.ok(query.target === undefined || ['main', 'unfinished'].includes(query.target));
      exact(req, req.url.pathname, { cwd, ...(query.target ? { target: query.target } : {}) }, { signal: true, cache: 'no-store' });
      return currentCapture;
    }
    if (req.url.pathname === ACTIONS) {
      exact(req, ACTIONS, { cwd }, { signal: true, cache: 'no-store' }); return { operations };
    }
    assert.fail(`undeclared manager capability ${req.options.method ?? 'GET'} ${req.url}`);
  }, setup);
  // WorktreeManager's existing Back/Refresh-actual callbacks admit finite RAF
  // focus/bookmark work. Join that admitted snapshot before realm disposal,
  // including mount/setup failure; no timer advance or new UI work is admitted.
  r.releaseOnClose(() => r.frame());
  const props = { cwd, onClose() { close.push(true); }, onChanged() { changed.push(true); }, onSelectCheckout(path) { selected.push(path); }, onReturnFocus() {} };
  await r.render(createElement(r.graph.WorktreeManager, props));
  return { ...r, get view() { return r.view; }, props, changed, close, selected,
    setCapture(value) { currentCapture = value; },
    async update(next, observer) { Object.assign(props, next); await r.render(createElement(r.graph.WorktreeManager, props), observer); },
    async expand(label = 'unmerged') { await click(r.view, button(r.view, label)); return button(r.view, 'Review removal…'); },
  };
}

// The existing production host, once per UI lifecycle. In-memory persistence,
// admission and generic plugin execution are declared external ports. No Git,
// real path/ref/checkpoint/evidence or actual removal is claimed by this adapter.
export function hostCapability(r) {
  const records = new Map(), known = new Set(), timers = new Set(), inputs = [], answers = [];
  let executions = 0;
  const frozen = card();
  const receipt = (id, phase) => ({ version: 1, operationId: id, card: { ...frozen, operationId: id }, phase,
    authorization: { mode: 'ask', source: 'manual confirmation', revision: 'controlled-host-port', decision: phase === 'succeeded' ? 'user-approved' : phase === 'cancelled' ? 'not-approved' : 'pending' }, checks: [], effectStarted: false });
  const adapter = { async resolveProject(cwd) { assert.equal(cwd, ROOT); return { identity: ROOT, anchor: ROOT, relatedDirectories: [] }; },
    async execute(cwd, action, payload, ui, signal) {
      assert.equal(cwd, ROOT); assert.equal(action, 'remove'); executions++;
      // Bind the operation ID to the actual required preparation body. The host
      // owns duplicate UUID decisions; this is not a second fake controller.
      const id = inputs.at(-1).requestId;
      ui.operationReceipt('git-workflow', receipt(id, 'prepared'));
      const answer = await ui.pluginCard('git-workflow', frozen, signal); answers.push(answer);
      ui.operationReceipt('git-workflow', receipt(id, answer === 'approve' ? 'succeeded' : 'cancelled'));
      return { controlledAnswer: answer, payload };
    } };
  const plugin = { manifest: { id: 'git-workflow' }, projectActions: adapter };
  const host = r.graph.createProjectOperationHost({
    store: { read: id => records.get(id) && structuredClone(records.get(id)), save: record => records.set(record.id, structuredClone(record)), ids: () => [...records.keys()] },
    capability(id) { assert.equal(id, 'git-workflow'); return { plugin, adapter }; }, enabled: () => true,
    admission: { async allowed(path) { assert.equal(path, ROOT); }, assertInvocation(path) { assert.equal(path, ROOT); }, admitRelated(paths) { assert.deepEqual(paths, []); } },
    observers: async () => () => false, reserveDirectory: () => () => {}, prepareReview: () => assert.fail('no review builder in UI host bridge'),
    scheduler: { now: () => Date.parse('2026-01-01T00:00:00.000Z'), setTimeout(callback, milliseconds) { assert.equal(milliseconds, 900000); const token = { callback, unref() {} }; timers.add(token); return token; }, clearTimeout(token) { timers.delete(token); } },
  });
  r.releaseOnClose(async () => {
    for (const id of known) host.abort(id);
    const results = await Promise.allSettled([...known].map(id => host.completion(id).fullySettled));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (timers.size) errors.push(new Error('owned host review timer survived abort/join'));
    if (errors.length) throw new AggregateError(errors, 'host bridge settlement');
  });
  return { host, inputs, answers, records, get executions() { return executions; },
    async prepare(body) {
      inputs.push(structuredClone(body)); const result = await host.prepareProjectAction('git-workflow', body); known.add(result.id);
      await host.completion(result.id).reviewReady; return host.getProjectOperation('git-workflow', result.id);
    },
  };
}
