import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { button, click, exact, select } from './browser-lower-runtime.fixture.mjs';
import { manager } from './worktree-manager.fixture.mjs';
import { ACTIONS, ROOT, DEST, OID40, OID64, LOSS, inventory, rowData, operation, card } from './browser-lower-cases.fixture.mjs';
const checkout = { path: DEST, head: OID40, branch: 'unmerged', main: false, selected: false, detached: false, locked: null, prunable: null, missing: false };
const field = (h, name) => h.view.container.querySelector(`[aria-label="${name}"]`);

for (const [name, changes, status, disabled] of [
  ['clean with ignored content', {}, { state: 'clean', trackedDirty: false, untracked: [], ignored: ['.cache/literal'] }, false],
  ['dirty source', {}, { state: 'dirty', trackedDirty: true, untracked: ['manual.txt'], ignored: [] }, true],
  ['unavailable source', {}, { state: 'unavailable', trackedDirty: false, untracked: [], ignored: [], reason: 'controlled lstat refusal' }, true],
  ['missing registration', { missing: true }, { state: 'clean', trackedDirty: false, untracked: [], ignored: [] }, true],
  ['locked registration', { locked: 'literal owner' }, { state: 'clean', trackedDirty: false, untracked: [], ignored: [] }, true],
  ['prunable registration', { prunable: 'literal reason' }, { state: 'clean', trackedDirty: false, untracked: [], ignored: [] }, true],
  ['selected checkout', { selected: true }, { state: 'clean', trackedDirty: false, untracked: [], ignored: [] }, true],
  ['main checkout', { main: true }, { state: 'clean', trackedDirty: false, untracked: [], ignored: [] }, true],
  ['captured head mismatch', { head: OID64 }, { state: 'clean', trackedDirty: false, untracked: [], ignored: [] }, true],
]) test(`actual manager removal readiness: ${name}`, async t => {
  const row = rowData(undefined, { worktrees: [{ ...checkout, ...changes }] });
  const h = await manager(t, { capture: inventory([row]), override(req) {
    if (req.url.pathname !== '/api/worktrees/manage' || !req.url.searchParams.has('details')) return;
    exact(req, req.url.pathname, { cwd: ROOT, captureId: 'opaque-capture', details: '1', rows: JSON.stringify([row.id]) }, { signal: true, cache: 'no-store' });
    return { handled: true, data: { captureId: 'opaque-capture', rows: [{ id: row.id, mergeDate: row.mergeDate, statuses: [{ path: DEST, submodules: 'ignored', ...status }] }] } };
  } }); await h.idle(); await h.expand(); assert.equal(button(h.view, 'Review removal…').disabled, disabled);
  assert.equal(h.requests.some(req => req.options.method === 'POST'), false);
});

for (const [resource, expected] of [
  ['both', { removeWorktree: true, deleteBranch: true }],
  ['worktree', { removeWorktree: true, deleteBranch: false }],
]) test(`actual manager Resources ${resource} sends captured branch/path unchanged; preparation is not execution`, async t => {
  const writes = [], row = rowData(undefined, { worktrees: [checkout] });
  const h = await manager(t, { capture: inventory([row]), override(req) {
    if (req.options.method !== 'POST') return;
    const body = JSON.parse(req.options.body); writes.push(req);
    if (req.url.pathname !== ACTIONS) { exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'stop' } }); return { handled: true, data: operation(undefined, { state: 'cancelled', card: undefined }) }; }
    exact(req, ACTIONS, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, requestId: body.requestId, action: 'remove', payload: {
      subject: { kind: 'branch', branch: 'unmerged', tip: OID40 }, worktreePath: DEST, ...expected, comparisonTarget: { branch: 'main', tip: OID64 },
    } } }); return { handled: true, data: operation(body.requestId) };
  } }); await h.idle(); await h.expand(); await select(h.view, field(h, 'Resources'), resource);
  await click(h.view, button(h.view, 'Review removal…')); await h.idle(); assert.equal(writes.length, 1);
  assert.equal(button(h.view, 'Remove listed resources').disabled, true);
});

for (const [name, row, captureChanges, blocked] of [
  ['unknown no comparison permits explicit loss review', rowData(undefined, { integration: 'unknown' }), { target: { branch: null, tip: null, configured: 'missing-local-target', missingConfigured: true, source: 'project', temporary: false } }, false],
  ['diagnostic is read only', rowData('registration:opaque', { kind: 'diagnostic', branch: null, tip: null }), {}, true],
  ['symbolic ref is read only', rowData(undefined, { symbolic: true }), {}, true],
  ['configured target is protected', rowData(undefined, { blockers: ['configured-target'] }), {}, true],
  ['comparison target is protected', rowData(undefined, { blockers: ['comparison-target'] }), {}, true],
  ['unknown server blocker is preserved', rowData(undefined, { blockers: ['opaque-server-blocker'] }), {}, true],
]) test(`actual manager inventory decision: ${name}`, async t => {
  const h = await manager(t, { capture: inventory([row], captureChanges) }); await h.idle(); await h.expand(row.branch ?? 'Detached HEAD');
  assert.equal(button(h.view, 'Review removal…').disabled, blocked);
  assert.equal(h.requests.some(req => req.options.method === 'POST'), false);
});

for (const [name, descriptor] of [
  ['missing descriptor', undefined],
  ['wrong label', { cardDigest: 'b'.repeat(64), label: 'not the server card label' }],
  ['empty digest', { cardDigest: '', label: LOSS }],
]) test(`actual manager consent refuses ${name} and cannot approve`, async t => {
  const op = operation(undefined, { acknowledgment: descriptor });
  const h = await manager(t, { operations: [op], override(req) {
    if (!req.url.pathname.startsWith(`${ACTIONS}/`)) return;
    if (req.options.method === 'POST') { exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'stop' } }); return { handled: true, data: { ...op, state: 'cancelled', card: undefined } }; }
    exact(req, req.url.pathname, {}, { signal: true, cache: 'no-store' }); return { handled: true, data: op };
  } }); await h.idle();
  const checkbox = h.view.container.querySelector('input[type="checkbox"]'); assert.ok(checkbox); assert.equal(checkbox.disabled, true);
  assert.equal(button(h.view, 'Remove listed resources').disabled, true);
  assert.equal(h.requests.some(req => req.options.method === 'POST'), false);
});

test('actual manager same operation new server card digest clears consent; old approved-wait has Stop, never a second approve', async t => {
  let current = operation(); const writes = [];
  const h = await manager(t, { operations: [current], override(req) {
    if (!req.url.pathname.startsWith(`${ACTIONS}/`)) return;
    if (req.options.method === 'POST') {
      const body = JSON.parse(req.options.body); writes.push(body);
      exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body });
      current = { ...current, card: undefined, decision: body.decision }; return { handled: true, data: current };
    }
    exact(req, req.url.pathname, {}, { signal: true, cache: 'no-store' }); return { handled: true, data: current };
  } }); await h.idle();
  await click(h.view, h.view.container.querySelector('input[type="checkbox"]')); assert.equal(button(h.view, 'Remove listed resources').disabled, false);
  current = { ...current, card: card({ title: 'replacement exact card' }), acknowledgment: { cardDigest: 'e'.repeat(64), label: LOSS } };
  await h.fire(250); await h.idle();
  assert.equal(h.view.container.querySelector('input[type="checkbox"]').checked, false); assert.equal(button(h.view, 'Remove listed resources').disabled, true);
  await click(h.view, h.view.container.querySelector('input[type="checkbox"]')); await click(h.view, button(h.view, 'Remove listed resources')); await h.idle();
  assert.deepEqual(writes, [{ cwd: ROOT, decision: 'approve', acknowledgment: { cardDigest: 'e'.repeat(64), accepted: true } }]);
  assert.ok(button(h.view, 'Stop remaining steps'));
  assert.equal([...h.view.container.querySelectorAll('button')].some(b => b.textContent === 'Remove listed resources'), false);
  assert.match(h.view.container.textContent, /Operation dispatched — awaiting observed outcome/);
});
