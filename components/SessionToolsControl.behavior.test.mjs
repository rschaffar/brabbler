import "../lib/testing/client-native-boundary.fixture.mjs";
// UNEXECUTED. Actual controls + full operation owner; native startup remains real below.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { lowerFixture } from './lower-account-controls.fixture.mjs';

export const off = { version: 1, codeMode: false, mcpServers: [] };
const native = { version: 1, codeMode: true, mcpServers: [{ scope: 'project', name: 'synthetic-server' }] };
const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
async function control(t, overrides = {}) {
  const x = await lowerFixture(t), { f, graph: c } = x, applied = [];
  const metadata = { configuration: { ok: true, servers: [
    { scope: 'project', name: 'synthetic-server', enabled: true, eligible: true, transport: 'stdio', projectOverride: false },
    { scope: 'global', name: 'synthetic-oauth', enabled: true, eligible: false, transport: 'http', projectOverride: false, limitation: 'oauth' },
  ] }, live: { nativeResources: off, effectiveNativeResources: off, mcpServers: [] },
  projectDefault: { supported: true, projectRoot: '/synthetic/project', revision, selection: null } };
  const props = { cwd: '/synthetic/project', sessionId: 'synthetic-session', selection: off, busy: false, chatOnly: false,
    async onApply(value) { applied.push(value); return value; }, ...overrides };
  f.route('GET', '/api/native-tools', { query: () => ({ cwd: props.cwd, ...(props.sessionId ? { sessionId: props.sessionId } : {}) }), cache: 'no-store', reply: () => ({ data: metadata }) });
  await x.mount(h(c.SessionToolsControl, props));
  return { ...x, metadata, props, applied };
}
const checkbox = (x, name) => [...x.f.view.container.querySelectorAll('label')].find(n => n.textContent.includes(name)).querySelector('input');
async function selectNative(x) {
  await x.f.click(checkbox(x, 'Code-mode')); await x.f.click(checkbox(x, 'synthetic-server'));
}

test('native control: metadata reads are inert, OAuth row disabled; Apply uses exact selection/current callback and stable draft node', async t => {
  const x = await control(t), { f, graph: c } = x;
  assert.equal(f.requests.length, 0, 'closed dialog has no metadata/native side effects');
  await f.click(x.button('Session tools'));
  assert.equal(f.requests.filter(r => r.path === '/api/native-tools').length, 1);
  assert.equal(checkbox(x, 'synthetic-oauth').disabled, true);
  assert.equal(x.applied.length, 0); assert.equal(x.writes().length, 0);
  const codeMode = checkbox(x, 'Code-mode');
  await selectNative(x);
  assert.equal(checkbox(x, 'Code-mode') === codeMode, true);
  assert.equal(x.applied.length, 0, 'draft selection does not initialize resources');
  const current = [];
  await f.rerender(h(c.SessionToolsControl, { ...x.props, async onApply(value) { current.push(value); return value; } }));
  await f.click(x.button('Apply'));
  assert.deepEqual(current, [native]); assert.deepEqual(x.applied, []);
  assert.equal(x.node('dialog').open, false);
  assert.equal(x.writes().length, 0, 'external callback not misrepresented as installed RPC');
});

test('native control: busy and pending refuse repeat; rejected Apply requires read-only Refresh before next explicit Apply', async t => {
  let release;
  const acknowledgementFailure = new Error('synthetic lost Apply acknowledgement');
  const completion = new Promise((_, reject) => { release = () => reject(acknowledgementFailure); });
  const observedCompletion = completion.then(() => undefined, error => error);
  // Register before setup, and with the actual capability-release phase before
  // Apply admission: failed assertions/setup cannot strand the full operation.
  t.after(async () => { release(); assert.equal(await observedCompletion === acknowledgementFailure, true); });
  const called = [];
  const x = await control(t, { busy: true, onApply(value) { called.push(value); return completion; } }), { f, graph: c } = x;
  x.onSettle(release);
  await f.click(x.button('Session tools'));
  assert.equal(x.button('Apply').disabled, true);
  assert.equal(checkbox(x, 'Code-mode').closest('fieldset').disabled, true);
  await f.rerender(h(c.SessionToolsControl, { ...x.props, busy: false }));
  await selectNative(x);
  await f.click(x.button('Apply'), { settle: false });
  assert.equal(x.button('Applying…').disabled, true); assert.equal(x.button('Cancel').disabled, true);
  assert.deepEqual(called, [native]);
  release(); await f.commit();
  assert.match(x.node('[role="alert"]').textContent, /synthetic lost Apply/);
  assert.equal(x.button('Apply').disabled, true);
  assert.equal(x.button('Cancel').disabled, false, 'full Apply finally released pending');
  const before = f.requests.length;
  x.metadata.live.nativeResources = native;
  await f.click(x.button('Refresh status'));
  assert.equal(f.requests.length, before + 1); assert.equal(x.writes().length, 0);
  assert.deepEqual(called, [native], 'reconciliation never retries mutation');
  assert.equal(checkbox(x, 'Code-mode').checked, true);
  assert.equal(checkbox(x, 'synthetic-server').checked, true);
  assert.equal(x.button('Apply').disabled, false);
});

test('native project default: required POST selection then null reset; existing session selection is unchanged', async t => {
  const x = await control(t), { f } = x;
  let selection = native, rev = revision;
  const gate = f.gate('default save body');
  f.route('POST', '/api/native-tools', { body: () => ({ cwd: x.props.cwd, revision: rev, nativeResources: selection }), reply: () => ({ gate, data: { projectDefault: { ...x.metadata.projectDefault, revision: nextRevision, selection } } }) });
  await f.click(x.button('Session tools')); await selectNative(x);
  await f.click(x.button('Save selection as project default'), { settle: false });
  assert.equal(x.writes('/api/native-tools').length, 1);
  assert.equal(x.button('Saving default…').disabled, true); assert.equal(x.button('Apply').disabled, true);
  await f.deliver(gate);
  assert.match(x.text(), /Project default saved. Existing sessions are unchanged/);
  assert.deepEqual(x.applied, []);
  selection = null; rev = nextRevision;
  await f.click(x.button('Clear project default'));
  assert.equal(x.writes('/api/native-tools').length, 2);
  x.assertWrite('/api/native-tools', 0, { cwd: x.props.cwd, revision, nativeResources: native });
  x.assertWrite('/api/native-tools', 1, { cwd: x.props.cwd, revision: nextRevision, nativeResources: null });
  assert.match(x.text(), /Project default cleared/);
  assert.equal(x.button('Clear project default').disabled, true);
  assert.deepEqual(x.applied, []);
});

for (const failure of ['lost-body', 'contradictory-selection']) test(`native project default: ${failure} retains uncertainty until read-only confirmation with no mutation replay`, async t => {
  const x = await control(t), { f } = x;
  f.route('POST', '/api/native-tools', { body: { cwd: x.props.cwd, revision, nativeResources: native }, reply: failure === 'lost-body'
    ? { bodyError: new Error('synthetic lost default ACK') }
    : { data: { projectDefault: { ...x.metadata.projectDefault, revision: nextRevision, selection: off } } } });
  await f.click(x.button('Session tools')); await selectNative(x);
  await f.click(x.button('Save selection as project default'));
  assert.equal(x.writes('/api/native-tools').length, 1);
  x.assertWrite('/api/native-tools', 0, { cwd: x.props.cwd, revision, nativeResources: native });
  assert.equal(x.button('Save selection as project default').disabled, true);
  assert.match(x.text(), /Refresh status before saving again/);
  assert.equal(x.button('Cancel').disabled, false);
  x.metadata.projectDefault = { ...x.metadata.projectDefault, revision: nextRevision, selection: native };
  const before = f.requests.length;
  await f.click(x.button('Refresh status'));
  assert.equal(f.requests.length, before + 1);
  assert.equal(x.writes('/api/native-tools').length, 1);
  assert.equal(x.button('Save selection as project default').disabled, false);
  assert.deepEqual(x.applied, []);
});

test('native project default: late A body is consumed but cannot publish into B; unmount joins complete observed work', async t => {
  const x = await control(t), { f, graph: c } = x;
  const gate = f.gate('outgoing default body');
  f.route('POST', '/api/native-tools', { body: { cwd: x.props.cwd, revision, nativeResources: off }, reply: { gate, data: { projectDefault: { ...x.metadata.projectDefault, revision: nextRevision, selection: off } } } });
  await f.click(x.button('Session tools'));
  await f.click(x.button('Save selection as project default'), { settle: false });
  x.props.cwd = '/synthetic/project-B'; x.props.sessionId = 'synthetic-session-B';
  await f.rerender(h(c.SessionToolsControl, x.props));
  await f.deliver(gate);
  assert.equal(x.text().includes('Project default saved.'), false);
  assert.equal(x.button('Save selection as project default').disabled, false);
  assert.equal(x.writes('/api/native-tools').length, 1);
  assert.equal(x.node('dialog').open, true);
  await f.view.unmount(); await f.join();
  assert.equal(f.works.every(work => work.settled), true);
});
