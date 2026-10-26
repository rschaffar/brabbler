import assert from 'node:assert/strict';
import { manager } from './worktree-manager.fixture.mjs';
import { exact, button, click } from './browser-lower-runtime.fixture.mjs';
import { ACTIONS, ROOT, inventory } from './browser-lower-cases.fixture.mjs';

// Exact HTTP inventory/status/index/record inputs for the EXISTING actual Manager
// mount. Not another UI/controller, native service, row/ack algorithm or executor.
export async function parityManager(t, { cwd = ROOT, captures = new Map([[ROOT, inventory()]]),
  indexes = new Map([[ROOT, []]]), records = new Map(), targetQueries = new Map(), route = () => {}, detailReply } = {}) {
  let detailStages = [], detailStageIndex = 0;
  const inventoryReads = new Map();
  const h = await manager(t, { cwd, capture: captures.get(cwd), override(req) {
    const custom = route(req); if (custom?.handled) return custom;
    if (req.url.pathname === '/api/worktrees/manage') {
      const selected = req.url.searchParams.get('cwd'); assert.equal(captures.has(selected), true, 'declared literal manager cwd');
      const capture = captures.get(selected);
      if (!req.url.searchParams.has('details')) {
        const target = targetQueries.get(selected);
        exact(req, req.url.pathname, { cwd: selected, ...(target === undefined ? {} : { target }) }, { cache: 'no-store', signal: true });
        inventoryReads.set(selected, { request: req, captureId: capture.captureId });
        return { handled: true, data: capture };
      }
      const stage = detailStages[detailStageIndex];
      if (stage) {
        // A finite next-arrival script, not a search for any matching capture.
        // Every detail request during the transition must equal the next tuple.
        exact(req, req.url.pathname, { cwd: stage.cwd, captureId: stage.captureId, details: '1', rows: JSON.stringify(stage.rows) }, { cache: 'no-store', signal: true });
        assert.equal(capture.captureId, stage.inventoryCaptureId);
        const delivery = inventoryReads.get(selected); assert.ok(delivery, 'named inventory admitted before transition detail');
        assert.equal(delivery.captureId, stage.inventoryCaptureId);
        if (stage.kind === 'stale') {
          assert.notEqual(stage.captureId, capture.captureId, 'only the explicitly scripted old capture is stale');
          assert.equal(delivery.request.returned, false, 'new inventory JSON has not returned at the old-capture detail admission');
          detailStageIndex++;
          // Actual backend contract: a capture bound to another checkout is
          // STALE/409, never a successful row response for the new checkout.
          req.body.resolve({ error: 'Capture expired; refresh inventory', code: 'STALE' });
          req.response.resolve({ ok: false, status: 409, json: req.json });
          return { handled: true, data: undefined };
        }
        assert.equal(stage.kind, 'current');
        assert.equal(stage.captureId, capture.captureId);
        assert.equal(delivery.request.returned, true, 'current detail follows actual new inventory JSON return');
        detailStageIndex++;
      }
      const ids = JSON.parse(req.url.searchParams.get('rows'));
      assert.equal(Array.isArray(ids), true); assert.equal(ids.length > 0 && ids.length <= 50, true);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(ids.every(id => capture.rows.some(row => row.id === id)), true, 'exact current capture membership');
      const datesOnly = req.url.searchParams.has('datesOnly');
      exact(req, req.url.pathname, { cwd: selected, captureId: capture.captureId, details: '1', rows: JSON.stringify(ids), ...(datesOnly ? { datesOnly: '1' } : {}) }, { cache: 'no-store', signal: true });
      if (detailReply) return { handled: true, data: detailReply(req, capture, ids, datesOnly) };
      assert.equal(datesOnly, false, 'date response must be declared by its case');
      return { handled: true, data: { captureId: capture.captureId, rows: ids.map(id => {
        const row = capture.rows.find(value => value.id === id);
        return { id, mergeDate: row.mergeDate, statuses: row.worktrees.map(w => ({ path: w.path, state: 'clean', trackedDirty: false, untracked: [], ignored: [], submodules: 'ignored' })) };
      }) } };
    }
    if (req.url.pathname === ACTIONS) {
      const selected = req.url.searchParams.get('cwd'); assert.equal(indexes.has(selected), true, 'declared operation-index cwd');
      exact(req, ACTIONS, { cwd: selected }, { cache: 'no-store', signal: true });
      return { handled: true, data: { operations: indexes.get(selected) } };
    }
    if (req.url.pathname.startsWith(`${ACTIONS}/`)) {
      const id = req.url.pathname.slice(ACTIONS.length + 1); assert.equal(records.has(id), true, 'declared opaque operation UUID');
      exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true });
      return { handled: true, data: records.get(id) };
    }
    assert.fail(`undeclared Worktree parity request ${req.options.method ?? 'GET'} ${req.url.pathname}`);
  } });
  return { ...h, get view() { return h.view; }, captures, indexes, records, targetQueries,
    expectDetailStages(stages) {
      assert.equal(detailStageIndex, detailStages.length, 'previous exact transition script fully consumed');
      assert.equal(Array.isArray(stages) && stages.length > 0, true);
      detailStages = stages; detailStageIndex = 0;
    },
    assertDetailStagesConsumed() { assert.equal(detailStageIndex, detailStages.length, h.diagnostic('all exact cwd/capture detail stages observed')); },
  };
}
export function control(h, tag, label) {
  const found = [...h.view.container.querySelectorAll(`${tag}[aria-label]`)].filter(node => node.getAttribute('aria-label') === label);
  assert.equal(found.length, 1, h.diagnostic(`one exact ${tag} ${label}`)); return found[0];
}
export const regions = h => [...h.view.container.querySelectorAll('section[aria-label]')].filter(node => node.getAttribute('aria-label') === 'Removal review & outcome');
export function region(h) { const found = regions(h); assert.equal(found.length, 1, h.diagnostic('one exact operation section')); return found[0]; }
export function history(h, stateText) {
  const groups = [...h.view.container.querySelectorAll('details')].filter(node => [...node.children].some(child => child.tagName === 'SUMMARY' && child.textContent === 'Recorded project operations'));
  assert.equal(groups.length, 1); const found = [...groups[0].querySelectorAll('button')].filter(node => node.textContent.endsWith(` · ${stateText}`));
  assert.equal(found.length, 1, h.diagnostic(`one exact historical state ${stateText}`)); return found[0];
}
export async function settingsChanged(h) { await h.view.dispatch(h.view.window, new h.view.window.Event('pi-web:bundled-plugin-settings')); }
export async function expand(h, branch = 'unmerged') { await click(h.view, button(h.view, branch)); }
export const visibleBranches = h => [...h.view.container.querySelectorAll('tr[data-branch]')].map(node => node.getAttribute('data-branch'));
export const writes = h => h.requests.filter(req => req.options.method === 'POST');
