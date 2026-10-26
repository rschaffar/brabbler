import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { button, click, exact, select, inputText } from './browser-lower-runtime.fixture.mjs';
import { manager, hostCapability } from './worktree-manager.fixture.mjs';
import { ACTIONS, ROOT, DEST, OID40, OID64, LOSS, inventory, rowData, details, operation, card } from './browser-lower-cases.fixture.mjs';

const review = h => button(h.view, 'Review removal…');
const field = (h, label) => h.view.container.querySelector(`[aria-label="${label}"]`);
const checks = h => [...h.view.container.querySelectorAll('input[type="checkbox"]')];
// Match the actual attribute string, avoiding full-value CSS selector handling
// of the ampersand. Required presence and expected absence remain independent.
const operationRegions = h => [...h.view.container.querySelectorAll('section[aria-label]')]
  .filter(node => node.getAttribute('aria-label') === 'Removal review & outcome');
const operationRegion = h => {
  const regions = operationRegions(h);
  assert.equal(regions.length, 1, h.diagnostic('exactly one Removal review & outcome section'));
  return regions[0];
};
const historyButtons = h => [...h.view.container.querySelectorAll('details button')].filter(b => /Resource removal completed|Cancelled —|Outcome unknown/.test(b.textContent));
const pendingGet = (h, path) => h.requests.filter(r => r.url.pathname === path && (r.options.method ?? 'GET') === 'GET' && !r.returned);

// Controlled HTTP and clock inputs below never authorize native deletion. Existing
// N owners keep actual refs, path registrations, mounts, checkpoints and receipts.
test('actual manager readiness requires current inventory, operation slot and checkout status; malformed refresh keeps old rows read-only', async t => {
  const row = rowData('branch:unmerged', { worktrees: [{ path: DEST, head: OID40, branch: 'unmerged', main: false, selected: false, detached: false, locked: null, prunable: null, missing: false }] });
  const capture = inventory([row]); let holdInventory = true, holdOperations = true, holdDetails = true;
  const h = await manager(t, { capture, override(req) {
    if (req.url.pathname === '/api/worktrees/manage') {
      if (!req.url.searchParams.has('details') && holdInventory) { exact(req, req.url.pathname, { cwd: ROOT }, { cache: 'no-store', signal: true }); return { handled: true, data: undefined }; }
      if (req.url.searchParams.has('details') && holdDetails) { exact(req, req.url.pathname, { cwd: ROOT, captureId: capture.captureId, details: '1', rows: JSON.stringify([row.id]) }, { cache: 'no-store', signal: true }); return { handled: true, data: undefined }; }
    }
    if (req.url.pathname === ACTIONS && holdOperations) { exact(req, ACTIONS, { cwd: ROOT }, { cache: 'no-store', signal: true }); return { handled: true, data: undefined }; }
  } });
  assert.equal(button(h.view, 'Refresh').disabled, true);
  const inventories = pendingGet(h, '/api/worktrees/manage');
  for (const req of inventories) await h.reply(req, capture);
  await h.expand(); assert.equal(review(h).disabled, true);
  for (const req of pendingGet(h, ACTIONS)) await h.reply(req, { operations: [] });
  assert.equal(review(h).disabled, true, 'status is a separate readiness gate');
  const status = h.latest('/api/worktrees/manage'); await h.reply(status, details(capture.captureId, [row.id], { ignored: ['.cache/literal-output'] }));
  holdDetails = false; holdOperations = false; await h.idle(); assert.equal(review(h).disabled, false);
  assert.match(h.view.container.textContent, /Ignored content requires exact review/);
  await click(h.view, button(h.view, 'Refresh'));
  const refresh = h.latest('/api/worktrees/manage'); await h.headers(refresh); await h.rejectBody(refresh); await h.idle();
  assert.ok(button(h.view, 'unmerged')); assert.equal(review(h).disabled, true, 'old visible rows cannot prepare after failed capture');
  assert.equal(h.requests.some(req => req.options.method === 'POST'), false);
  holdInventory = false;
  await click(h.view, button(h.view, 'Refresh', h.view.container.querySelector('[role="alert"]'))); await h.idle();
  assert.equal(review(h).disabled, false);
});

test('actual manager opens real project settings, required global enable PATCH invalidates capture, and Back restores usable removal controls', async t => {
  const disabledCapture = inventory(undefined, { cleanup: { pluginId: 'git-workflow', enabled: false, permission: 'allow', targetSelection: 'configured' } });
  const manifest = { id: 'git-workflow', name: 'Git Workflow', fields: {
    enabled: { kind: 'boolean', default: false, label: 'Enable plugin (all projects)', globalOnly: true },
    targetBranch: { kind: 'string', default: 'main', label: 'Designated target branch' },
  } };
  const settings = { project: ROOT, enabled: false, global: {}, overrides: {}, effective: { enabled: false, targetBranch: 'main' }, sources: { enabled: 'builtin', targetBranch: 'builtin' } };
  const patches = [];
  const h = await manager(t, { capture: disabledCapture, override(req) {
    if (req.url.pathname !== '/api/plugins/bundled') return;
    if ((req.options.method ?? 'GET') === 'GET') { exact(req, req.url.pathname, { cwd: ROOT }); return { handled: true, data: { plugins: [{ manifest, settings }] } }; }
    exact(req, req.url.pathname, {}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: { pluginId: 'git-workflow', cwd: ROOT, scope: 'global', set: { enabled: true }, reset: [] } });
    patches.push(req); return { handled: true, data: undefined };
  } });
  await h.idle(); await h.expand(); assert.equal(review(h).disabled, true);
  await click(h.view, button(h.view, 'Open Git Workflow settings')); await h.idle();
  const checkbox = h.view.container.querySelector('#plugin-enabled'); assert.ok(checkbox); assert.equal(checkbox.checked, false);
  await click(h.view, checkbox); assert.equal(patches.length, 1); assert.equal(checkbox.disabled, true);
  h.setCapture(inventory());
  await h.reply(patches[0], { settings: { ...settings, enabled: true, global: { enabled: true }, effective: { ...settings.effective, enabled: true }, sources: { ...settings.sources, enabled: 'global' } } }); await h.idle();
  await click(h.view, button(h.view, 'Back to overview')); await h.idle(); await h.frame();
  assert.equal(review(h).disabled, false); assert.equal(h.requests.filter(req => req.options.method === 'PATCH').length, 1);
  const before = h.requests.length;
  const observed = []; await h.update({ onChanged() { assert.fail('settings cannot claim a removal outcome'); } }, { observe(promise) { observed.push(promise); return h.work.observe(promise); } });
  assert.equal(h.requests.length, before, 'observer/callback identity alone cannot restart inventory/history'); assert.equal(observed.length, 0);
});

test('actual manager global merge-date batches 50+5 preserve complete order and Cancel consumes an ignored-abort body', async t => {
  const rows = Array.from({ length: 55 }, (_, i) => rowData(`branch:bulk-${String(i).padStart(2, '0')}`, { branch: `bulk-${String(i).padStart(2, '0')}`, mergeDate: { state: 'not-loaded' } }));
  const capture = inventory(rows); const dateReads = [], dateCache = new Map();
  const h = await manager(t, { capture, override(req) {
    if (req.url.pathname === '/api/worktrees/manage' && req.url.searchParams.has('datesOnly')) {
      const ids = JSON.parse(req.url.searchParams.get('rows')); exact(req, req.url.pathname, { cwd: ROOT, captureId: capture.captureId, details: '1', datesOnly: '1', rows: JSON.stringify(ids) }, { signal: true, cache: 'no-store' });
      dateReads.push(req); return { handled: true, data: undefined };
    }
    if (req.url.pathname === '/api/worktrees/manage' && req.url.searchParams.has('details')) {
      const ids = JSON.parse(req.url.searchParams.get('rows'));
      exact(req, req.url.pathname, { cwd: ROOT, captureId: capture.captureId, details: '1', rows: JSON.stringify(ids) }, { signal: true, cache: 'no-store' });
      return { handled: true, data: { captureId: capture.captureId, rows: ids.map(id => ({ id, statuses: [], mergeDate: dateCache.get(id) ?? { state: 'not-loaded' } })) } };
    }
  } }); await h.idle();
  const before = [...h.view.container.querySelectorAll('tr[data-branch]')].map(row => row.dataset.branch);
  await select(h.view, field(h, 'Sort'), 'merge');
  assert.equal(dateReads.length, 1); assert.equal(JSON.parse(dateReads[0].url.searchParams.get('rows')).length, 50);
  assert.equal(field(h, 'Search branches or paths').disabled, true);
  assert.deepEqual([...h.view.container.querySelectorAll('tr[data-branch]')].map(row => row.dataset.branch), before);
  const firstDates = details(capture.captureId, rows.slice(0, 50).map(row => row.id), { dates: true });
  for (const row of firstDates.rows) dateCache.set(row.id, row.mergeDate);
  await h.reply(dateReads[0], firstDates);
  assert.equal(dateReads.length, 2); assert.equal(JSON.parse(dateReads[1].url.searchParams.get('rows')).length, 5);
  await h.headers(dateReads[1]); await click(h.view, button(h.view, 'Cancel'));
  assert.equal(dateReads[1].options.signal.aborted, true);
  await h.body(dateReads[1], details(capture.captureId, rows.slice(50).map(row => row.id), { dates: true })); await h.idle();
  assert.equal(field(h, 'Search branches or paths').disabled, false); assert.notEqual(field(h, 'Sort').value, 'merge');
  await select(h.view, field(h, 'Sort'), 'merge'); const retry = dateReads.at(-1); assert.notEqual(retry === dateReads[1], true);
  const lastDates = details(capture.captureId, rows.slice(50).map(row => row.id), { dates: true });
  for (const row of lastDates.rows) dateCache.set(row.id, row.mergeDate);
  await h.reply(retry, lastDates); await h.idle();
  assert.equal(h.view.container.querySelector('th[aria-sort]').textContent, 'Merge commit date');
  await click(h.view, button(h.view, 'Next page')); await h.idle(); assert.match(h.view.container.textContent, /Showing 51–55 of 55/);
  await inputText(h.view, field(h, 'Search branches or paths'), 'bulk-54'); await h.idle(); assert.match(h.view.container.textContent, /Showing 1–1 of 1/);
});

for (const obsoleteError of [false, true]) test(`actual manager inventory A/B/A ignored-abort ${obsoleteError ? 'error' : 'success'} cannot replace newest capture/readiness`, async t => {
  const held = [];
  const h = await manager(t, { override(req) {
    if (req.url.pathname === '/api/worktrees/manage' && !req.url.searchParams.has('details')) {
      exact(req, req.url.pathname, { cwd: ROOT, ...(req.url.searchParams.get('target') ? { target: req.url.searchParams.get('target') } : {}) }, { cache: 'no-store', signal: true }); held.push(req); return { handled: true, data: undefined };
    }
  } });
  for (const req of held) await h.reply(req, inventory()); await h.idle(); await h.expand();
  const start = held.length;
  for (const target of ['unfinished', 'main', 'unfinished']) {
    await select(h.view, field(h, 'Comparison target'), target);
    const req = held.at(-1); await h.headers(req);
    // Rendered select is disabled during the pending capture. A fresh server
    // inventory is required between UI target changes; keep its body separately
    // via refresh below, not by dispatching disabled controls.
    await h.body(req, inventory(undefined, { target: { branch: target, tip: OID64, configured: 'main', source: 'project', temporary: target !== 'main', missingConfigured: false } })); await h.idle();
  }
  assert.equal(held.length, start + 3);
  await click(h.view, button(h.view, 'Refresh')); const old = held.at(-1); await h.headers(old);
  // A settings invalidation is a legitimate superseder while ordinary Refresh
  // is disabled. It exercises the actual production listener/context boundary.
  await h.view.dispatch(h.view.window, new h.view.window.Event('pi-web:bundled-plugin-settings'));
  const current = held.at(-1); assert.equal(old.options.signal.aborted, true); assert.equal(current === old, false);
  const currentCapture = inventory([rowData('branch:current', { branch: 'current' })], {
    captureId: 'opaque-current-capture', target: { branch: 'unfinished', tip: OID64, configured: 'main', source: 'project', temporary: true, missingConfigured: false },
  });
  // The server port must advance with the inventory it actually returns, so
  // progressive detail reads validate the NEW exact row/capture, not unmerged.
  h.setCapture(currentCapture);
  await h.reply(current, currentCapture);
  if (obsoleteError) await h.rejectBody(old); else await h.body(old, inventory([rowData('branch:obsolete', { branch: 'obsolete' })]));
  await h.idle(); assert.ok(button(h.view, 'current'));
  assert.equal([...h.view.container.querySelectorAll('button')].some(b => b.textContent === 'obsolete'), false);
  assert.equal(h.view.container.querySelector('[role="alert"]') === null, true);
});

test('actual manager malformed prepare recovers SAME UUID through production host, loss consent starts unchecked, Reject and fresh digest reset, approve once then historical read-only', async t => {
  let cap; const server = new Map(), prepares = [], decisions = [];
  const h = await manager(t, { override(req) {
    if (req.url.pathname === ACTIONS && req.options.method === 'POST') {
      const body = JSON.parse(req.options.body); assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      exact(req, ACTIONS, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, requestId: body.requestId, action: 'remove', payload: { subject: { kind: 'branch', branch: 'unmerged', tip: OID40 }, removeWorktree: false, deleteBranch: true, comparisonTarget: { branch: 'main', tip: OID64 } } } });
      prepares.push(req); const task = cap.prepare(body); server.set(req, task); h.joinOnClose(task); return { handled: true, data: undefined };
    }
    if (req.url.pathname.startsWith(`${ACTIONS}/`)) {
      const id = req.url.pathname.slice(ACTIONS.length + 1);
      if ((req.options.method ?? 'GET') === 'GET') { exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true }); return { handled: true, data: cap.host.getProjectOperation('git-workflow', id) }; }
      const body = JSON.parse(req.options.body); exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(body.cwd, ROOT); assert.ok(['reject', 'approve', 'stop'].includes(body.decision)); decisions.push(req);
      return { handled: true, data: cap.host.decideProjectOperation('git-workflow', id, body.cwd, body.decision, body.acknowledgment) };
    }
    if (req.url.pathname === ACTIONS && cap) { exact(req, ACTIONS, { cwd: ROOT }, { signal: true, cache: 'no-store' }); return { handled: true, data: cap.host.listProjectOperations('git-workflow', ROOT).then(operations => ({ operations })) }; }
  } });
  cap = hostCapability(h); await h.idle(); await h.expand();
  await click(h.view, review(h)); const first = prepares[0]; const frozen = await server.get(first);
  assert.equal(frozen.id, JSON.parse(first.options.body).requestId, h.diagnostic('host UUID before lost preparation ACK'));
  assert.equal(frozen.state, 'review', h.diagnostic('host state before lost preparation ACK'));
  assert.ok(frozen.card, h.diagnostic('host must expose its actual live card'));
  assert.ok(frozen.acknowledgment?.cardDigest, h.diagnostic('host must expose its actual live descriptor'));
  assert.equal(cap.executions, 1); await h.headers(first); await h.rejectBody(first); await h.idle();
  const uncertainRegion = operationRegion(h);
  assert.ok(uncertainRegion, h.diagnostic('missing exact Removal review & outcome region after malformed preparation JSON'));
  assert.match(uncertainRegion.textContent, /Preparation response unavailable/); assert.equal(review(h).disabled, true);
  await click(h.view, button(h.view, 'Recover preparation'));
  assert.equal(prepares.length, 2); assert.deepEqual(JSON.parse(prepares[1].options.body), JSON.parse(first.options.body));
  const recovered = await server.get(prepares[1]); assert.equal(recovered.acknowledgment.cardDigest, frozen.acknowledgment.cardDigest);
  await h.reply(prepares[1], recovered); await h.idle();
  assert.equal(cap.executions, 1, 'same UUID is lookup-only in actual host');
  assert.equal(checks(h)[0].checked, false); assert.equal(button(h.view, 'Remove listed resources').disabled, true);
  await click(h.view, checks(h)[0]); assert.equal(button(h.view, 'Remove listed resources').disabled, false);
  await click(h.view, button(h.view, 'Keep resources')); await h.idle();
  await cap.host.completion(frozen.id).fullySettled; await h.fire(250); await h.idle();
  assert.deepEqual(cap.answers, ['reject']); assert.equal(JSON.parse(decisions[0].options.body).acknowledgment, undefined);
  await click(h.view, button(h.view, 'Refresh actual state')); await h.idle();
  await click(h.view, review(h)); const fresh = prepares[2]; const next = await server.get(fresh);
  assert.notEqual(next.id, frozen.id); assert.notEqual(next.acknowledgment.cardDigest, frozen.acknowledgment.cardDigest);
  await h.reply(fresh, next); await h.idle(); assert.equal(checks(h)[0].checked, false);
  await click(h.view, checks(h)[0]); await click(h.view, button(h.view, 'Remove listed resources')); await h.idle();
  const approve = decisions.find(req => JSON.parse(req.options.body).decision === 'approve'); assert.ok(approve);
  assert.deepEqual(JSON.parse(approve.options.body), { cwd: ROOT, decision: 'approve', acknowledgment: { cardDigest: next.acknowledgment.cardDigest, accepted: true } });
  await cap.host.completion(next.id).fullySettled;
  await h.fire(250); await h.idle();
  assert.deepEqual(cap.answers, ['reject', 'approve']); assert.equal(cap.executions, 2);
  assert.equal(checks(h)[0].disabled, true); assert.equal(checks(h)[0].checked, true);
  await click(h.view, button(h.view, 'Refresh actual state')); await h.idle();
  const history = historyButtons(h).find(node => /Resource removal completed/.test(node.textContent)); assert.ok(history);
  const before = decisions.length; await click(h.view, history); await h.idle();
  assert.equal(checks(h)[0].checked, true); assert.equal(checks(h)[0].disabled, true);
  assert.equal([...operationRegion(h).querySelectorAll('button')].some(b => ['Keep resources', 'Remove listed resources', 'Stop remaining steps'].includes(b.textContent)), false);
  assert.equal(decisions.length, before, 'history read has no replay'); assert.equal(prepares.length, 3);
});

test('actual manager held history reserves prepare slot; current-context reset aborts it and obsolete body/finally cannot publish', async t => {
  const historical = operation(undefined, { state: 'succeeded', card: undefined, acknowledgment: { label: LOSS, cardDigest: 'a'.repeat(64), accepted: true }, receipt: { card: card(), phase: 'succeeded' } });
  const held = [];
  const h = await manager(t, { operations: [historical], override(req) {
    if (!req.url.pathname.startsWith(`${ACTIONS}/`)) return;
    exact(req, req.url.pathname, {}, { signal: true, cache: 'no-store' }); held.push(req); return { handled: true, data: undefined };
  } }); await h.idle(); await h.expand();
  await click(h.view, historyButtons(h)[0]); const old = held.at(-1); await h.headers(old);
  assert.equal(review(h).disabled, true, 'history selection reserves operation slot');
  await h.view.dispatch(h.view.window, new h.view.window.Event('pi-web:bundled-plugin-settings'));
  assert.equal(old.options.signal.aborted, true);
  await h.body(old, historical); await h.idle();
  assert.equal(operationRegions(h).length, 0, h.diagnostic('obsolete history must not publish an operation region'));
  assert.equal(review(h).disabled, false);
  await click(h.view, historyButtons(h)[0]); const current = held.at(-1); await h.reply(current, historical); await h.idle();
  assert.equal(checks(h)[0].disabled, true); assert.equal(checks(h)[0].checked, true);
  assert.equal(h.requests.some(req => req.options.method === 'POST'), false);
});

test('actual manager pending preparation delivered after context invalidation sends only stop, not an actionable review', async t => {
  const writes = []; const pending = operation();
  const h = await manager(t, { override(req) {
    if (req.options.method !== 'POST') return;
    const body = JSON.parse(req.options.body); exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body }); writes.push(req);
    if (req.url.pathname === ACTIONS) return { handled: true, data: undefined };
    assert.equal(body.decision, 'stop'); assert.equal(body.cwd, ROOT); return { handled: true, data: { ...pending, state: 'cancelled', card: undefined } };
  } }); await h.idle(); await h.expand(); await click(h.view, review(h)); const prepare = writes[0];
  await h.view.dispatch(h.view.window, new h.view.window.Event('pi-web:bundled-plugin-settings'));
  await h.reply(prepare, pending); await h.idle();
  assert.equal(writes.filter(req => req.url.pathname !== ACTIONS).length >= 1, true);
  assert.ok(writes.slice(1).every(req => JSON.parse(req.options.body).decision === 'stop'));
  assert.equal(operationRegions(h).length, 0, h.diagnostic('obsolete preparation must not publish an operation region'));
  assert.equal(review(h).disabled, false);
});

test('actual manager read polling uses exact 250/600/1500 policy; terminal receipt never causes prepare or decision replay', async t => {
  const active = operation(undefined, { state: 'dispatched', card: undefined, decision: 'approve' }); const reads = []; let fail = false;
  const h = await manager(t, { operations: [active], override(req) {
    if (!req.url.pathname.startsWith(`${ACTIONS}/`)) return;
    exact(req, req.url.pathname, {}, { signal: true, cache: 'no-store' }); reads.push(req);
    return { handled: true, data: fail ? undefined : active };
  } }); await h.idle(); assert.equal(h.timerCount(250), 1);
  await h.fire(250); await h.idle(); assert.equal(h.timerCount(600), 1);
  fail = true; await h.fire(600); const failedRead = reads.at(-1); await h.headers(failedRead); await h.rejectBody(failedRead); await h.idle();
  assert.equal(h.timerCount(1500), 1);
  await h.fire(1500); const last = reads.at(-1); await h.reply(last, { ...active, state: 'outcome-unknown', error: 'controlled native outcome is unknown' }); await h.idle();
  assert.equal(h.timerCount(250) + h.timerCount(600) + h.timerCount(1500), 0); assert.equal(h.changed.length, 1);
  assert.equal(h.requests.some(req => req.options.method === 'POST'), false);
});

// Full production resource/body/helper matrix; supplied rows are inventory input,
// never realpath/ref/mount authority. One mount per case keeps decisions independent.
for (const [name, row, resource, expected] of [
  ['branch only', rowData(), 'branch', { subject: { kind: 'branch', branch: 'unmerged', tip: OID40 }, removeWorktree: false, deleteBranch: true }],
  ['detached full SHA256', rowData('detached:opaque', { kind: 'detached', branch: null, tip: OID64, worktrees: [{ path: DEST, head: OID64, branch: null, main: false, selected: false, detached: true, locked: null, prunable: null, missing: false }] }), 'worktree', { subject: { kind: 'detached', head: OID64 }, worktreePath: DEST, removeWorktree: true, deleteBranch: false }],
]) test(`actual manager resource ${name} preserves literal identity and exact prepare payload`, async t => {
  const writes = [];
  const h = await manager(t, { capture: inventory([row]), override(req) {
    if (req.options.method !== 'POST') return;
    writes.push(req); const body = JSON.parse(req.options.body);
    if (req.url.pathname !== ACTIONS) { assert.equal(body.decision, 'stop'); return { handled: true, data: operation(body.requestId, { state: 'cancelled', card: undefined }) }; }
    exact(req, ACTIONS, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, requestId: body.requestId, action: 'remove', payload: { ...expected, comparisonTarget: { branch: 'main', tip: OID64 } } } });
    return { handled: true, data: operation(body.requestId) };
  } }); await h.idle();
  await h.expand(row.branch ?? 'Detached HEAD'); assert.equal(field(h, 'Resources').value, resource);
  assert.equal(review(h).disabled, false); await click(h.view, review(h)); await h.idle(); assert.equal(writes.length, 1);
});
