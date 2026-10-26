import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { button, click, exact } from './browser-lower-runtime.fixture.mjs';
import { ROOT, SOURCE, ACTIONS, LOSS, inventory, operation, card } from './browser-lower-cases.fixture.mjs';
import { parityManager, region, regions, history, settingsChanged, expand, writes } from './worktree-parity.fixture.mjs';
import { manager } from './worktree-manager.fixture.mjs';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const liveA = operation(ID_A, { card: card({ title: 'CURRENT REVIEW A' }) });
const liveB = operation(ID_B, { card: card({ title: 'CURRENT REVIEW B' }), acknowledgment: { cardDigest: 'e'.repeat(64), label: LOSS } });
const past = operation(ID_A, { state: 'succeeded', card: undefined, acknowledgment: { cardDigest: 'd'.repeat(64), label: LOSS, accepted: true },
  receipt: { version: 1, operationId: ID_A, card: card({ title: 'RECORDED EXACT A', actions: [] }), phase: 'succeeded',
    authorization: { mode: 'ask', source: 'manual confirmation', revision: 'controlled-history-input', decision: 'user-approved' }, checks: [], effectStarted: false } });
const capturesForContexts = () => new Map([[ROOT, inventory()], [SOURCE, inventory(undefined, { captureId: 'opaque-other-checkout', checkout: SOURCE })]]);
// Exact observed render stages: new cwd with retained old capture, then the
// new inventory's capture after its real JSON delivery. No all-capture allowlist.
const detailStagesForContexts = includeReturn => [
  { cwd: SOURCE, captureId: 'opaque-capture', rows: ['branch:unmerged'], kind: 'stale', inventoryCaptureId: 'opaque-other-checkout' },
  { cwd: SOURCE, captureId: 'opaque-other-checkout', rows: ['branch:unmerged'], kind: 'current', inventoryCaptureId: 'opaque-other-checkout' },
  ...(includeReturn ? [
    { cwd: ROOT, captureId: 'opaque-other-checkout', rows: ['branch:unmerged'], kind: 'stale', inventoryCaptureId: 'opaque-capture' },
    { cwd: ROOT, captureId: 'opaque-capture', rows: ['branch:unmerged'], kind: 'current', inventoryCaptureId: 'opaque-capture' },
  ] : []),
];
const acknowledge = async h => {
  const found = [...region(h).querySelectorAll('input[type="checkbox"]')]; assert.equal(found.length, 1);
  assert.equal(found[0].disabled, false); await click(h.view, found[0]);
};
const noLiveDecision = h => {
  const labels = [...region(h).querySelectorAll('button')].map(node => node.textContent);
  assert.equal(labels.some(label => ['Keep resources', 'Remove listed resources', 'Stop remaining steps'].includes(label)), false);
};

for (const failure of ['HTTP409', 'malformed JSON']) test(`W21 actual manager current history ${failure} releases its slot only after catch/finally and explicit read recovery never replays`, async t => {
  const held = [];
  const h = await parityManager(t, { indexes: new Map([[ROOT, [past]]]), route(req) {
    if (req.url.pathname !== `${ACTIONS}/${ID_A}`) return;
    exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true }); held.push(req); return { handled: true, data: undefined };
  } }); await h.idle(); await expand(h);
  await click(h.view, history(h, 'Resource removal completed')); assert.equal(button(h.view, 'Review removal…').disabled, true);
  if (failure === 'HTTP409') await h.reply(held[0], { error: 'declared history read refusal' }, 409);
  else { await h.headers(held[0]); await h.rejectBody(held[0]); }
  await h.idle(); assert.equal(button(h.view, 'Review removal…').disabled, false);
  assert.equal(h.view.container.querySelectorAll('[role="alert"]').length, 1); assert.equal(held.length, 1);
  await click(h.view, history(h, 'Resource removal completed')); assert.equal(held.length, 2);
  await h.reply(held[1], past); await h.idle();
  assert.equal(region(h).textContent.includes('RECORDED EXACT A'), true); noLiveDecision(h);
  const recorded = region(h).querySelector('input[type="checkbox"]'); assert.equal(recorded.checked, true); assert.equal(recorded.disabled, true);
  assert.equal(writes(h).length, 0); assert.equal(h.changed.length, 0, 'historical reads cannot report new effects');
});

for (const obsoleteError of [false, true]) test(`W21 actual manager history cwd A/B/A consumes obsolete ${obsoleteError ? 'catch' : 'success'} without releasing a newer read slot`, async t => {
  const held = [];
  const h = await parityManager(t, { captures: capturesForContexts(), indexes: new Map([[ROOT, [past]], [SOURCE, []]]), route(req) {
    if (req.url.pathname !== `${ACTIONS}/${ID_A}`) return;
    exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true }); held.push(req); return { handled: true, data: undefined };
  } }); await h.idle(); await expand(h);
  await click(h.view, history(h, 'Resource removal completed')); const old = held[0]; await h.headers(old);
  h.expectDetailStages(detailStagesForContexts(true));
  await h.update({ cwd: SOURCE }); assert.equal(old.options.signal.aborted, true);
  await h.update({ cwd: ROOT }); h.assertDetailStagesConsumed();
  await click(h.view, history(h, 'Resource removal completed')); const current = held[1]; await h.headers(current);
  if (obsoleteError) await h.rejectBody(old); else await h.body(old, { ...past, receipt: { ...past.receipt, card: card({ title: 'OBSOLETE HISTORY', actions: [] }) } });
  assert.equal(button(h.view, 'Review removal…').disabled, true, 'obsolete finally cannot release current history reservation');
  assert.equal(current.options.signal.aborted, false); assert.equal(regions(h).length, 0);
  await h.body(current, past); await h.idle();
  assert.equal(button(h.view, 'Review removal…').disabled, false); assert.equal(region(h).textContent.includes('RECORDED EXACT A'), true);
  assert.equal(region(h).textContent.includes('OBSOLETE HISTORY'), false); assert.equal(h.view.container.querySelector('[role="alert"]') === null, true);
  noLiveDecision(h); assert.equal(writes(h).length, 0); assert.equal(h.changed.length, 0);
});

for (const lateError of [false, true]) test(`W21 actual manager unmount joins ignored-abort history ${lateError ? 'body error' : 'body'} without new callbacks or writes`, async t => {
  const held = [];
  const h = await parityManager(t, { indexes: new Map([[ROOT, [past]]]), route(req) {
    if (req.url.pathname !== `${ACTIONS}/${ID_A}`) return;
    exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true }); held.push(req); return { handled: true, data: undefined };
  } }); await h.idle();
  await click(h.view, history(h, 'Resource removal completed')); await h.headers(held[0]);
  await h.view.unmount(); assert.equal(held[0].options.signal.aborted, true);
  if (lateError) await h.rejectBody(held[0]); else await h.body(held[0], past);
  await h.idle(); assert.equal(h.view.container.childNodes.length, 0); assert.equal(h.changed.length, 0); assert.equal(writes(h).length, 0);
  assert.equal(h.timerCount(250) + h.timerCount(600) + h.timerCount(1500), 0);
});

for (const obsoleteError of [false, true]) test(`W22 actual manager pending decision ${obsoleteError ? 'error' : 'success'} after settings cannot publish or release newer consent decision`, async t => {
  const held = [], stops = [], indexes = new Map([[ROOT, [liveA]]]), records = new Map([[ID_A, liveA], [ID_B, liveB]]);
  const h = await parityManager(t, { indexes, records, route(req) {
    if (req.options.method !== 'POST') return;
    const id = req.url.pathname.slice(ACTIONS.length + 1); assert.equal([ID_A, ID_B].includes(id), true);
    const body = JSON.parse(req.options.body);
    if (body.decision === 'stop') {
      exact(req, `${ACTIONS}/${ID_A}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'stop' } });
      stops.push(req); return { handled: true, data: { ...liveA, state: 'cancelled', card: undefined } };
    }
    exact(req, `${ACTIONS}/${id}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'approve', acknowledgment: { cardDigest: id === ID_A ? 'd'.repeat(64) : 'e'.repeat(64), accepted: true } } });
    held.push(req); return { handled: true, data: undefined };
  } }); await h.idle();
  await acknowledge(h); await click(h.view, button(h.view, 'Remove listed resources')); const old = held[0]; await h.headers(old);
  indexes.set(ROOT, [liveB]); await settingsChanged(h);
  assert.equal(stops.length, 1); assert.equal(region(h).textContent.includes('CURRENT REVIEW B'), true);
  assert.equal(region(h).querySelector('input[type="checkbox"]').checked, false, 'new operation must not inherit old consent');
  await acknowledge(h); await click(h.view, button(h.view, 'Remove listed resources')); const current = held[1]; await h.headers(current);
  if (obsoleteError) await h.rejectBody(old); else await h.body(old, { ...liveA, state: 'succeeded', card: undefined });
  assert.equal(button(h.view, 'Remove listed resources').disabled, true, 'old decision finally cannot release new sending lock');
  assert.equal(region(h).querySelector('input[type="checkbox"]').disabled, true);
  assert.equal(region(h).textContent.includes('CURRENT REVIEW B'), true); assert.equal(h.changed.length, 0);
  assert.equal(h.view.container.querySelector('[role="alert"]') === null, true, 'obsolete decision catch cannot attach error to current review');
  const terminal = { ...liveB, state: 'succeeded', card: undefined, acknowledgment: { ...liveB.acknowledgment, accepted: true } };
  indexes.set(ROOT, [terminal]); records.set(ID_B, terminal);
  await h.body(current, terminal); await h.idle();
  assert.equal(h.changed.length, 1); assert.equal(region(h).querySelector('input[type="checkbox"]').checked, true);
  assert.equal(region(h).querySelector('input[type="checkbox"]').disabled, true); noLiveDecision(h);
  assert.equal(held.length, 2); assert.equal(writes(h).length, 3);
});

test('W22 actual manager late pending decision after cwd switch cannot attach old outcome to current checkout', async t => {
  const held = [], stops = [];
  const h = await parityManager(t, { captures: capturesForContexts(), indexes: new Map([[ROOT, [liveA]], [SOURCE, []]]), records: new Map([[ID_A, liveA]]), route(req) {
    if (req.options.method !== 'POST') return;
    const body = JSON.parse(req.options.body);
    if (body.decision === 'stop') {
      exact(req, `${ACTIONS}/${ID_A}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'stop' } });
      stops.push(req); return { handled: true, data: { ...liveA, state: 'cancelled', card: undefined } };
    }
    exact(req, `${ACTIONS}/${ID_A}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'approve', acknowledgment: { cardDigest: 'd'.repeat(64), accepted: true } } });
    held.push(req); return { handled: true, data: undefined };
  } }); await h.idle(); await expand(h);
  await acknowledge(h); await click(h.view, button(h.view, 'Remove listed resources')); await h.headers(held[0]);
  h.expectDetailStages(detailStagesForContexts(false));
  await h.update({ cwd: SOURCE }); h.assertDetailStagesConsumed(); assert.equal(stops.length, 1);
  await h.body(held[0], { ...liveA, state: 'succeeded', card: undefined }); await h.idle();
  assert.equal(h.props.cwd, SOURCE); assert.equal(regions(h).length, 0); assert.equal(h.changed.length, 0);
  assert.equal(button(h.view, 'Review removal…').disabled, false); assert.equal(writes(h).length, 2);
});

test('W22 actual manager dispatched poll cwd A/B/A consumes old incarnation before accepting current read without replay', async t => {
  const active = { ...liveA, state: 'dispatched', card: undefined, decision: 'approve' };
  const indexes = new Map([[ROOT, [active]], [SOURCE, []]]), records = new Map([[ID_A, active]]), held = [], stops = [];
  let holdPoll = false;
  const h = await parityManager(t, { captures: capturesForContexts(), indexes, records, route(req) {
    if (req.url.pathname !== `${ACTIONS}/${ID_A}`) return;
    if (req.options.method === 'POST') {
      exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'stop' } });
      stops.push(req); return { handled: true, data: active };
    }
    if (holdPoll) { exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true }); held.push(req); return { handled: true, data: undefined }; }
  } }); await h.idle();
  holdPoll = true; await h.fire(250); await h.headers(held[0]); holdPoll = false;
  h.expectDetailStages(detailStagesForContexts(true));
  await h.update({ cwd: SOURCE }); assert.equal(held[0].options.signal.aborted, true);
  await h.update({ cwd: ROOT }); h.assertDetailStagesConsumed(); holdPoll = true; await h.fire(250); await h.headers(held[1]); holdPoll = false;
  await h.body(held[0], { ...active, state: 'outcome-unknown', error: 'OBSOLETE INCARNATION' });
  assert.equal(h.changed.length, 0); assert.equal(held[1].options.signal.aborted, false);
  assert.equal(region(h).textContent.includes('OBSOLETE INCARNATION'), false);
  const terminal = { ...active, state: 'outcome-unknown', error: 'CURRENT INCARNATION' }; indexes.set(ROOT, [terminal]); records.set(ID_A, terminal);
  await h.body(held[1], terminal); await h.idle();
  assert.equal(region(h).textContent.includes('CURRENT INCARNATION'), true); assert.equal(h.changed.length, 1);
  assert.equal(stops.length, 1); assert.equal(writes(h).length, 1); noLiveDecision(h);
});

test('W22 characterization: settings retains dispatched UUID observation, permits only Stop, and never turns an old read into execution authority', async t => {
  const active = { ...liveA, state: 'dispatched', card: undefined, decision: 'approve' };
  const indexes = new Map([[ROOT, [active]]]), records = new Map([[ID_A, active]]), held = [], stops = [];
  let holdPoll = false;
  const h = await parityManager(t, { indexes, records, route(req) {
    if (req.url.pathname !== `${ACTIONS}/${ID_A}`) return;
    if (req.options.method === 'POST') {
      exact(req, req.url.pathname, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: ROOT, decision: 'stop' } });
      stops.push(req); return { handled: true, data: active };
    }
    if (holdPoll) { exact(req, req.url.pathname, {}, { cache: 'no-store', signal: true }); held.push(req); return { handled: true, data: undefined }; }
  } }); await h.idle();
  holdPoll = true; await h.fire(250); await h.headers(held[0]); holdPoll = false;
  await settingsChanged(h);
  assert.equal(stops.length, 1); assert.equal(held[0].options.signal.aborted, false, 'baseline retains this dispatched observation across settings');
  assert.equal(h.changed.length, 0); assert.equal(region(h).querySelectorAll('input[type="checkbox"]').length, 0);
  assert.equal(button(h.view, 'Stop remaining steps').disabled, false);
  const terminal = { ...active, state: 'outcome-unknown', error: 'same dispatched UUID observed after Stop' }; indexes.set(ROOT, [terminal]); records.set(ID_A, terminal);
  await h.body(held[0], terminal); await h.idle(); assert.equal(h.changed.length, 1); noLiveDecision(h);
  assert.equal(writes(h).length, 1); assert.equal(writes(h).every(req => JSON.parse(req.options.body).decision === 'stop'), true);
  // Whether a different settings/incarnation contract should revoke this read
  // is LEAD ONLY. This case characterizes the existing read-only policy.
});

test('W22 actual manager approval binds literal invocation checkout rather than project or main-checkout identity', async t => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const live = operation(id, { cwd: SOURCE, project: ROOT, anchor: ROOT });
  const capture = inventory(undefined, { captureId: 'opaque-literal-invocation', checkout: SOURCE, mainCheckout: ROOT });
  const indexes = new Map([[SOURCE, [live]]]), records = new Map([[id, live]]), approvals = [];
  const h = await parityManager(t, { cwd: SOURCE, captures: new Map([[SOURCE, capture]]), indexes, records, route(req) {
    if (req.options.method !== 'POST') return;
    const body = JSON.parse(req.options.body);
    if (body.decision === 'stop') {
      exact(req, `${ACTIONS}/${id}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: SOURCE, decision: 'stop' } });
      return { handled: true, data: { ...live, state: 'cancelled', card: undefined } };
    }
    exact(req, `${ACTIONS}/${id}`, {}, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: { cwd: SOURCE, decision: 'approve', acknowledgment: { cardDigest: 'd'.repeat(64), accepted: true } } });
    approvals.push(req);
    const terminal = { ...live, state: 'succeeded', card: undefined, acknowledgment: { ...live.acknowledgment, accepted: true } };
    indexes.set(SOURCE, [terminal]); records.set(id, terminal); return { handled: true, data: terminal };
  } }); await h.idle(); await acknowledge(h); await click(h.view, button(h.view, 'Remove listed resources')); await h.idle();
  assert.equal(approvals.length, 1); assert.equal(JSON.parse(approvals[0].options.body).cwd, SOURCE);
  assert.equal(h.changed.length, 1); noLiveDecision(h);
});

test('local actual Manager fixture failed setup joins admitted RAF before realm close with original setup error intact', async t => {
  const cleanup = [], setupFailure = new Error('declared Manager setup failure');
  let joined = false, closed = false, disposed = false;
  const dispose = async () => { if (disposed) return; disposed = true; await cleanup[0](); };
  t.after(dispose);
  await assert.rejects(manager({ after(fn) { cleanup.push(fn); } }, { setup(window, replace) {
    window.requestAnimationFrame(() => { joined = true; });
    const close = window.close.bind(window);
    replace(window, 'close', () => { assert.equal(joined, true, 'finite RAF callback joined before closing its realm'); closed = true; close(); });
    throw setupFailure;
  } }), error => error === setupFailure);
  assert.equal(joined, true); assert.equal(closed, true); await dispose();
});
