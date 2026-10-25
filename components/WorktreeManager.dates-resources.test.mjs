import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { button, click, inputText, select, exact } from './browser-lower-runtime.fixture.mjs';
import { ROOT, DEST, SOURCE, OID40, OID64, ACTIONS, rowData, inventory, operation, card } from './browser-lower-cases.fixture.mjs';
import { parityManager, control, expand, visibleBranches, writes } from './worktree-parity.fixture.mjs';

const date = { state: 'available', date: '2026-01-02T00:00:00.000Z', commit: OID64, source: 'first-parent-graph' };
const clean = path => ({ path, state: 'clean', trackedDirty: false, untracked: [], ignored: [], submodules: 'ignored' });
const checkout = (path, extra = {}) => ({ path, head: OID40, branch: 'unmerged', main: false, selected: false, detached: false, locked: null, prunable: null, missing: false, ...extra });

// Date/status data below is an explicit external inventory input. Actual Manager
// effects, selection rules, currentness and controls remain production code.
test('W19 actual manager filter widening loads invisible matching dates in exact 50+4 batches before completing global sort', async t => {
  const rows = Array.from({ length: 55 }, (_, i) => rowData(`branch:wide-${String(i).padStart(2, '0')}`, { branch: `wide-${String(i).padStart(2, '0')}`, mergeDate: { state: 'not-loaded' } }));
  const capture = inventory(rows, { captureId: 'opaque-wide-capture' }), cache = new Map(), reads = [];
  const h = await parityManager(t, { captures: new Map([[ROOT, capture]]), detailReply(req, value, ids, datesOnly) {
    if (datesOnly) { reads.push(req); return undefined; }
    return { captureId: value.captureId, rows: ids.map(id => ({ id, mergeDate: cache.get(id) ?? { state: 'not-loaded' }, statuses: [] })) };
  } }); await h.idle();
  await inputText(h.view, control(h, 'input', 'Search branches or paths'), 'wide-00'); await h.idle();
  await select(h.view, control(h, 'select', 'Sort'), 'merge');
  assert.equal(reads.length, 1); assert.deepEqual(JSON.parse(reads[0].url.searchParams.get('rows')), [rows[0].id]);
  cache.set(rows[0].id, date);
  await h.reply(reads[0], { captureId: capture.captureId, rows: [{ id: rows[0].id, mergeDate: date, statuses: [] }] }); await h.idle();
  assert.deepEqual(visibleBranches(h), ['wide-00']);
  await click(h.view, button(h.view, 'Clear filters'));
  assert.equal(reads.length, 2); assert.deepEqual(JSON.parse(reads[1].url.searchParams.get('rows')), rows.slice(1, 51).map(row => row.id));
  assert.equal(control(h, 'input', 'Search branches or paths').disabled, true);
  const pendingOrder = visibleBranches(h);
  for (const row of rows.slice(1, 51)) cache.set(row.id, date);
  await h.reply(reads[1], { captureId: capture.captureId, rows: rows.slice(1, 51).map(row => ({ id: row.id, mergeDate: date, statuses: [] })) });
  assert.equal(reads.length, 3); assert.deepEqual(JSON.parse(reads[2].url.searchParams.get('rows')), rows.slice(51).map(row => row.id));
  assert.equal(JSON.parse(reads[2].url.searchParams.get('rows')).includes('branch:wide-54'), true, 'invisible final row participates in global date preparation');
  assert.deepEqual(visibleBranches(h), pendingOrder, 'incomplete dates retain the complete-order bookmark');
  for (const row of rows.slice(51)) cache.set(row.id, date);
  await h.reply(reads[2], { captureId: capture.captureId, rows: rows.slice(51).map(row => ({ id: row.id, mergeDate: date, statuses: [] })) }); await h.idle();
  assert.equal(control(h, 'input', 'Search branches or paths').disabled, false);
  assert.equal(h.view.container.querySelector('th[aria-sort]').textContent, 'Merge commit date');
  await click(h.view, button(h.view, 'Next page')); await h.idle();
  assert.deepEqual(visibleBranches(h), ['wide-50', 'wide-51', 'wide-52', 'wide-53', 'wide-54']);
  assert.equal(writes(h).length, 0);
});

for (const failure of ['HTTP503', 'malformed JSON']) test(`W19 actual manager date ${failure} resets sort readiness and requires explicit new sort`, async t => {
  const row = rowData(undefined, { mergeDate: { state: 'not-loaded' } }), capture = inventory([row], { captureId: 'opaque-date-failure' });
  const reads = []; let loaded = false;
  const h = await parityManager(t, { captures: new Map([[ROOT, capture]]), detailReply(req, value, ids, datesOnly) {
    assert.deepEqual(ids, [row.id]);
    if (datesOnly) { reads.push(req); return undefined; }
    return { captureId: value.captureId, rows: [{ id: row.id, mergeDate: loaded ? date : row.mergeDate, statuses: [] }] };
  } }); await h.idle();
  await select(h.view, control(h, 'select', 'Sort'), 'merge'); assert.equal(reads.length, 1);
  if (failure === 'HTTP503') await h.reply(reads[0], { error: 'declared matching date refusal' }, 503);
  else { await h.headers(reads[0]); await h.rejectBody(reads[0]); }
  await h.idle(); assert.equal(control(h, 'select', 'Sort').value, 'integrated-first');
  assert.equal(control(h, 'input', 'Search branches or paths').disabled, false);
  assert.equal(reads.length, 1, 'caught date failure cannot automatically retry');
  assert.equal(h.view.container.querySelectorAll('[role="alert"]').length, 1);
  await select(h.view, control(h, 'select', 'Sort'), 'merge'); assert.equal(reads.length, 2);
  loaded = true; await h.reply(reads[1], { captureId: capture.captureId, rows: [{ id: row.id, mergeDate: date, statuses: [] }] }); await h.idle();
  assert.equal(h.view.container.querySelector('[role="alert"]') === null, true);
  assert.equal(control(h, 'select', 'Sort').value, 'merge'); assert.equal(writes(h).length, 0);
});

for (const obsoleteError of [false, true]) test(`W19 actual manager old status and date ${obsoleteError ? 'errors' : 'bodies'} cannot contaminate replacement capture`, async t => {
  const row = rowData(undefined, { worktrees: [checkout(DEST)], mergeDate: { state: 'not-loaded' } });
  const oldCapture = inventory([row], { captureId: 'opaque-old-detail-capture' });
  const currentRow = { ...row, subject: 'current captured subject', mergeDate: date };
  const currentCapture = inventory([currentRow], { captureId: 'opaque-new-detail-capture' });
  const captures = new Map([[ROOT, oldCapture]]), oldStatus = [], oldDates = [];
  const h = await parityManager(t, { captures, detailReply(req, value, ids, datesOnly) {
    assert.deepEqual(ids, [row.id]);
    if (value.captureId === oldCapture.captureId) { (datesOnly ? oldDates : oldStatus).push(req); return undefined; }
    assert.equal(value.captureId, currentCapture.captureId); assert.equal(datesOnly, false);
    return { captureId: currentCapture.captureId, rows: [{ id: row.id, mergeDate: date, statuses: [clean(DEST)] }] };
  } });
  await expand(h); assert.equal(button(h.view, 'Review removal…').disabled, true);
  for (const req of oldStatus) await h.headers(req);
  await select(h.view, control(h, 'select', 'Sort'), 'merge'); assert.equal(oldDates.length, 1); await h.headers(oldDates[0]);
  captures.set(ROOT, currentCapture); await click(h.view, button(h.view, 'Refresh'));
  assert.equal(oldStatus.length > 0, true); assert.equal(oldStatus.every(req => req.options.signal.aborted), true); assert.equal(oldDates[0].options.signal.aborted, true);
  const currentDetails = h.latest('/api/worktrees/manage');
  assert.equal(currentDetails.url.searchParams.get('captureId'), currentCapture.captureId);
  await h.body(currentDetails, { captureId: currentCapture.captureId, rows: [{ id: row.id, mergeDate: date, statuses: [clean(DEST)] }] });
  for (const req of [...oldStatus, ...oldDates]) {
    if (obsoleteError) await h.rejectBody(req);
    else await h.body(req, { captureId: oldCapture.captureId, rows: [{ id: row.id,
      mergeDate: { ...date, commit: 'f'.repeat(40) }, statuses: [{ ...clean(DEST), state: 'dirty', trackedDirty: true, untracked: ['MANUAL-OLD-STATUS'] }] }] });
  }
  await h.idle();
  assert.equal(button(h.view, 'Review removal…').disabled, false);
  assert.equal(h.view.container.textContent.includes('MANUAL-OLD-STATUS'), false);
  assert.equal(h.view.container.textContent.includes('f'.repeat(40)), false);
  assert.equal(h.view.container.textContent.includes('current captured subject'), true);
  assert.equal(h.view.container.querySelector('[role="alert"]') === null, true); assert.equal(writes(h).length, 0);
});

test('W20 actual manager multi-checkout path and resource controls serialize only selected literal checkout; select-main is selection-only', async t => {
  const row = rowData(undefined, { worktrees: [checkout(DEST), checkout(SOURCE, { selected: true })] });
  const posted = [];
  const h = await parityManager(t, { captures: new Map([[ROOT, inventory([row])]]), route(req) {
    if (req.options.method !== 'POST') return;
    const body = JSON.parse(req.options.body); posted.push(req);
    if (req.url.pathname === ACTIONS) {
      exact(req, ACTIONS, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, requestId: body.requestId, action: 'remove', payload: {
        subject: { kind: 'branch', branch: 'unmerged', tip: OID40 }, worktreePath: DEST, removeWorktree: true, deleteBranch: false, comparisonTarget: { branch: 'main', tip: OID64 },
      } } });
      return { handled: true, data: operation(body.requestId, { card: card({ requiredAcknowledgment: undefined }), acknowledgment: undefined }) };
    }
    const prepareBody = JSON.parse(posted[0].options.body);
    exact(req, `${ACTIONS}/${prepareBody.requestId}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'reject' } });
    return { handled: true, data: operation(prepareBody.requestId, { state: 'cancelled', card: undefined, acknowledgment: undefined }) };
  } }); await h.idle(); await expand(h);
  const resources = control(h, 'select', 'Resources'), path = control(h, 'select', 'Worktree to remove');
  assert.equal(resources.value, 'worktree');
  assert.equal([...resources.options].find(option => option.value === 'both').disabled, true);
  assert.equal([...resources.options].find(option => option.value === 'branch').disabled, true);
  assert.deepEqual([...path.options].map(option => option.value), [DEST, SOURCE]);
  await select(h.view, path, SOURCE); assert.equal(button(h.view, 'Review removal…').disabled, true);
  await click(h.view, button(h.view, 'Select main checkout (no files or chats moved)'));
  assert.deepEqual(h.selected, [ROOT]); assert.equal(posted.length, 0, 'checkout selection does not prepare or remove');
  await select(h.view, path, DEST); assert.equal(button(h.view, 'Review removal…').disabled, false);
  await click(h.view, button(h.view, 'Review removal…')); await h.idle(); assert.equal(posted.length, 1);
  assert.equal(h.view.container.querySelectorAll('input[type="checkbox"]').length, 0, 'branch retained: no invented branch-loss control');
  await click(h.view, button(h.view, 'Keep resources')); await h.idle(); assert.equal(posted.length, 2);
});

test('W20 actual manager temporary comparison mismatch returns to designated target by exact omitted-target GET without a write', async t => {
  const captures = new Map([[ROOT, inventory()]]), targetQueries = new Map();
  const h = await parityManager(t, { captures, targetQueries }); await h.idle();
  captures.set(ROOT, inventory(undefined, { captureId: 'opaque-temporary', target: { branch: 'unfinished', tip: OID40, configured: 'main', source: 'project', temporary: true, missingConfigured: false } }));
  targetQueries.set(ROOT, 'unfinished'); await select(h.view, control(h, 'select', 'Comparison target'), 'unfinished'); await h.idle();
  assert.equal(control(h, 'select', 'Comparison target').value, 'unfinished');
  assert.equal(h.view.container.textContent.includes('This temporary comparison differs from the configured target.'), true);
  captures.set(ROOT, inventory(undefined, { captureId: 'opaque-designated-return' })); targetQueries.delete(ROOT);
  await click(h.view, button(h.view, 'Compare with configured target')); await h.idle();
  assert.equal(control(h, 'select', 'Comparison target').value, 'main');
  const lastInventory = h.requests.filter(req => req.url.pathname === '/api/worktrees/manage' && !req.url.searchParams.has('details')).at(-1);
  exact(lastInventory, '/api/worktrees/manage', { cwd: ROOT }, { cache: 'no-store', signal: true });
  assert.equal(h.view.container.textContent.includes('This temporary comparison differs from the configured target.'), false);
  assert.equal(writes(h).length, 0);
});

test('W19 actual manager integration checkout filters and name tip direction controls project the entire declared capture', async t => {
  const rows = [
    rowData('branch:alpha', { branch: 'alpha', integration: 'integrated', tipDate: '2026-01-01T00:00:00.000Z', worktrees: [checkout(ROOT, { branch: 'alpha', main: true })] }),
    rowData('branch:bravo', { branch: 'bravo', integration: 'unknown', tipDate: '2026-01-03T00:00:00.000Z' }),
    rowData('branch:charlie', { branch: 'charlie', integration: 'not-integrated', tipDate: '2026-01-02T00:00:00.000Z', worktrees: [checkout(DEST, { branch: 'charlie' })] }),
    rowData('registration:delta', { kind: 'diagnostic', branch: 'delta', integration: 'unknown', tipDate: null, worktrees: [checkout(SOURCE, { branch: 'delta', missing: true })] }),
  ];
  const h = await parityManager(t, { captures: new Map([[ROOT, inventory(rows)]]) }); await h.idle();
  for (const [value, expected] of [['integrated', ['alpha']], ['not-integrated', ['charlie']], ['unknown', ['bravo', 'delta']]]) {
    await select(h.view, control(h, 'select', 'Integration'), value); await h.idle(); assert.deepEqual(visibleBranches(h), expected);
  }
  await select(h.view, control(h, 'select', 'Integration'), 'all');
  for (const [value, expected] of [['has', ['alpha', 'charlie', 'delta']], ['none', ['bravo']], ['diagnostic', ['delta']]]) {
    await select(h.view, control(h, 'select', 'Worktrees'), value); await h.idle(); assert.deepEqual(visibleBranches(h), expected);
  }
  await select(h.view, control(h, 'select', 'Worktrees'), 'all');
  await select(h.view, control(h, 'select', 'Sort'), 'name'); await h.idle(); assert.deepEqual(visibleBranches(h), ['alpha', 'bravo', 'charlie', 'delta']);
  await click(h.view, button(h.view, 'Ascending')); assert.deepEqual(visibleBranches(h), ['delta', 'charlie', 'bravo', 'alpha']);
  await click(h.view, button(h.view, 'Descending')); await select(h.view, control(h, 'select', 'Sort'), 'tip'); await h.idle();
  assert.deepEqual(visibleBranches(h), ['alpha', 'charlie', 'bravo', 'delta']);
  await click(h.view, button(h.view, 'Ascending')); assert.deepEqual(visibleBranches(h), ['bravo', 'charlie', 'alpha', 'delta'], 'unknown tip date remains last in both directions');
  await click(h.view, button(h.view, 'Clear filters')); await h.idle();
  assert.equal(control(h, 'select', 'Integration').value, 'all'); assert.equal(control(h, 'select', 'Worktrees').value, 'all');
  assert.equal(writes(h).length, 0);
});
