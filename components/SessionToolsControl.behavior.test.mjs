import "../lib/testing/client-native-boundary.fixture.mjs";
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
  ] }, defaultSelection: native, live: { nativeResources: off, effectiveNativeResources: off, mcpServers: [] } };
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

test('native control: inert compact metadata, unsupported row, exact Apply/current callback and stable draft node', async t => {
  let managed = 0;
  const x = await control(t, { onManageDefaults() { managed++; } }), { f, graph: c } = x;
  assert.equal(f.requests.length, 0);
  await f.click(x.button('Session tools'));
  assert.equal(f.requests.filter(r => r.path === '/api/native-tools').length, 1);
  assert.equal(checkbox(x, 'synthetic-oauth').disabled, true);
  assert.equal(x.applied.length, 0); assert.equal(x.writes().length, 0);
  assert.equal(x.text().includes('Save selection'), false, 'default editing is absent from current-chat picker');
  assert.match(x.text(), /This chat only/);
  const codeMode = checkbox(x, 'Code-mode');
  await selectNative(x);
  assert.equal(checkbox(x, 'Code-mode') === codeMode, true);
  const current = [];
  await f.rerender(h(c.SessionToolsControl, { ...x.props, async onApply(value) { current.push(value); return value; } }));
  await f.click(x.button('Apply'));
  assert.deepEqual(current, [native]); assert.deepEqual(x.applied, []);
  assert.equal(x.node('dialog').open, false); assert.equal(x.writes().length, 0);
  await f.click(x.button('Session tools'));
  await f.click(x.button('Manage defaults ↗'));
  assert.equal(managed, 1); assert.equal(x.node('dialog').open, false);
  assert.equal(x.writes().length, 0, 'navigation does not Apply or save defaults');
});

test('native control: busy and pending refuse repeat; rejected Apply requires read-only Refresh before next explicit Apply', async t => {
  let release;
  const acknowledgementFailure = new Error('synthetic lost Apply acknowledgement');
  const completion = new Promise((_, reject) => { release = () => reject(acknowledgementFailure); });
  const observedCompletion = completion.then(() => undefined, error => error);
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
  assert.equal(x.button('Apply').disabled, true); assert.equal(x.button('Cancel').disabled, false);
  const before = f.requests.length;
  x.metadata.live.nativeResources = native;
  await f.click(x.button('Refresh status'));
  assert.equal(f.requests.length, before + 1); assert.equal(x.writes().length, 0);
  assert.deepEqual(called, [native]);
  assert.equal(checkbox(x, 'Code-mode').checked, true); assert.equal(checkbox(x, 'synthetic-server').checked, true);
  assert.equal(x.button('Apply').disabled, false);
});

test('new composer uses resolved defaults but explicit off wins before startup', async t => {
  const x = await control(t, { sessionId: null, selection: undefined }), { f } = x;
  delete x.metadata.live;
  await f.click(x.button('Session tools'));
  assert.equal(checkbox(x, 'synthetic-server').checked, true);
  await f.click(x.button('Cancel'));
  x.props.selection = off;
  await f.rerender(h(x.graph.SessionToolsControl, x.props));
  await f.click(x.button('Session tools'));
  assert.equal(checkbox(x, 'synthetic-server').checked, false);
  assert.equal(x.writes().length, 0);
});

async function settings(t, { cwd = '/synthetic/project', codeModeOnly = false } = {}) {
  const x = await lowerFixture(t), { f, graph: c } = x;
  const globalDefault = { revision, selection: null, preferences: { servers: [] } };
  const projectDefault = { supported: true, projectRoot: cwd, revision, selection: null, preferences: { servers: [] } };
  const metadata = { globalDefault, projectDefault, configuration: { ok: true, servers: ['docs', 'issues'].map(name => ({ scope: 'global', name, transport: 'stdio', eligible: true, enabled: true, projectOverride: false })) } };
  let scope = 'global';
  f.route('GET', '/api/native-tools', { query: () => scope === 'global' ? { scope } : { cwd }, cache: 'no-store', reply: () => ({ data: metadata }) });
  await x.mount(h(c.McpSettings, { cwd, codeModeOnly }));
  return { ...x, metadata, globalDefault, projectDefault, async project() { scope = 'project'; await f.click(x.button('Project: project')); },
    render: props => f.rerender(h(c.McpSettings, { cwd, codeModeOnly, ...props })) };
}
const switchFor = (x, name) => x.node(`[role="switch"][aria-label="${name}"]`);

test('Settings: per-server autosave retains unrelated choices, details collapsed, no session mutation and no project required globally', async t => {
  const x = await settings(t, { cwd: null }), { f } = x;
  f.route('POST', '/api/native-tools', { body: { scope: 'global', revision, change: { server: { scope: 'global', name: 'docs' }, value: true } },
    reply: { data: { globalDefault: { ...x.globalDefault, revision: nextRevision, preferences: { servers: [{ scope: 'global', name: 'docs', value: true }] } } } } });
  assert.equal(x.node('details').open, false);
  assert.equal(x.text().includes('Code-mode'), false, 'Code-mode is separate from server defaults');
  await f.click(switchFor(x, 'docs'));
  assert.equal(switchFor(x, 'docs').getAttribute('aria-checked'), 'true');
  assert.equal(switchFor(x, 'issues').getAttribute('aria-checked'), 'false');
  assert.equal(x.writes().length, 1);
  assert.match(x.text(), /Applies to new chats/); assert.match(x.text(), /Saved/);
});

test('Settings: project inheritance and independent Code-mode choice use single-field autosaves', async t => {
  const x = await settings(t), { f } = x;
  x.globalDefault.selection = { ...off, mcpServers: [{ scope: 'global', name: 'docs' }] };
  await x.project();
  const docs = x.node('select[aria-label="docs"]');
  assert.equal(docs.value, 'inherit'); assert.match(docs.options[0].textContent, /Use global · On/);
  const change = { server: { scope: 'global', name: 'issues' }, value: true };
  f.route('POST', '/api/native-tools', { body: { scope: 'project', cwd: '/synthetic/project', revision, change },
    reply: { data: { projectDefault: { ...x.projectDefault, revision: nextRevision, preferences: { servers: [{ ...change.server, value: true }] } } } } });
  await f.input('select[aria-label="issues"]', 'on');
  assert.equal(x.node('select[aria-label="docs"]').value, 'inherit');
  assert.equal(x.node('select[aria-label="issues"]').value, 'on');
});

for (const failure of ['lost-body', 'contradictory', 'stale']) test(`Settings: ${failure} locks writes until explicit read-only refresh without replay`, async t => {
  const x = await settings(t), { f } = x;
  const change = { server: { scope: 'global', name: 'docs' }, value: true };
  f.route('POST', '/api/native-tools', { body: { scope: 'global', revision, change }, reply: failure === 'lost-body' ? { bodyError: new Error('lost ACK') }
    : failure === 'stale' ? { status: 409, data: { error: 'refresh before saving' } }
    : { data: { globalDefault: { ...x.globalDefault, revision: nextRevision, preferences: { servers: [] } } } } });
  await f.click(switchFor(x, 'docs'));
  assert.equal(switchFor(x, 'docs').disabled, true); assert.equal(switchFor(x, 'issues').disabled, true);
  x.metadata.globalDefault = { ...x.globalDefault, revision: nextRevision, preferences: { servers: [{ ...change.server, value: true }] } };
  await f.click(x.button('Refresh status'));
  assert.equal(x.writes().length, 1); assert.equal(switchFor(x, 'docs').disabled, false);
  assert.equal(switchFor(x, 'docs').getAttribute('aria-checked'), 'true');
});

test('Settings: outgoing body cannot publish in a changed project; unmount joins full observed work', async t => {
  const x = await settings(t), { f } = x, gate = f.gate('outgoing default ACK');
  const change = { server: { scope: 'global', name: 'docs' }, value: true };
  f.route('POST', '/api/native-tools', { body: { scope: 'global', revision, change }, reply: { gate, data: {
    globalDefault: { ...x.globalDefault, revision: nextRevision, preferences: { servers: [{ ...change.server, value: true }] } } } } });
  await f.click(switchFor(x, 'docs'), { settle: false });
  await x.render({ cwd: '/synthetic/project-B' });
  await f.deliver(gate);
  assert.equal(x.text().includes('Saved'), false);
  assert.equal(switchFor(x, 'docs').getAttribute('aria-checked'), 'false');
  await f.view.unmount(); await f.join();
  assert.equal(f.works.every(work => work.settled), true);
});

test('Settings: stale exact grant and available replacement remain separate and require an explicit replacement grant', async t => {
  const x = await settings(t), { f } = x;
  x.metadata.configuration.servers[0].scope = 'project';
  x.projectDefault.selection = { ...off, mcpServers: [{ scope: 'global', name: 'docs' }] };
  await x.project();
  assert.equal(x.node('select[aria-label="docs (Global)"]').value, 'on');
  assert.equal(x.node('select[aria-label="docs (Project)"]').value, 'off');
  assert.match(x.text(), /Global · Unavailable/);
  const change = { server: { scope: 'project', name: 'docs' }, value: true };
  f.route('POST', '/api/native-tools', { body: { scope: 'project', cwd: '/synthetic/project', revision, change }, reply: { data: {
    projectDefault: { ...x.projectDefault, revision: nextRevision, preferences: { servers: [{ ...change.server, value: true }] } } } } });
  await f.input('select[aria-label="docs (Project)"]', 'on');
  assert.equal(x.node('select[aria-label="docs (Global)"]').value, 'off');
  assert.equal(x.node('select[aria-label="docs (Project)"]').value, 'on');
});

test('current picker: identically named replacement and missing grant disclose scope before Apply', async t => {
  const x = await control(t), { f } = x;
  x.metadata.live.nativeResources = { ...off, mcpServers: [{ scope: 'global', name: 'synthetic-server' }] };
  await f.click(x.button('Session tools'));
  const labels = [...f.view.container.querySelectorAll('label')].filter(node => node.textContent.includes('synthetic-server'));
  const global = labels.find(node => node.textContent.includes('Global')).querySelector('input');
  const project = labels.find(node => node.textContent.includes('Project')).querySelector('input');
  assert.equal(global.checked, true); assert.equal(project.checked, false);
  await f.click(project);
  assert.equal(global.isConnected, false, 'unavailable old grant disappears from the draft'); assert.equal(project.checked, true);
  await f.click(x.button('Apply'));
  assert.deepEqual(x.applied, [{ ...off, mcpServers: [{ scope: 'project', name: 'synthetic-server' }] }]);
});

test('current picker: its own first-session ID adoption during Apply acknowledges and closes the draft', async t => {
  let release;
  const completion = new Promise(resolve => { release = () => resolve(native); });
  t.after(() => { release(); return completion; });
  const x = await control(t, { sessionId: null, onApply: () => completion }), { f } = x;
  x.onSettle(release);
  await f.click(x.button('Session tools')); await selectNative(x);
  await f.click(x.button('Apply'), { settle: false });
  x.props.sessionId = 'newly-created-session';
  await f.rerender(h(x.graph.SessionToolsControl, x.props));
  release(); await f.commit();
  assert.equal(x.node('dialog').open, false, 'the current Apply may adopt its own created identity');
  assert.equal(x.button('Apply').disabled, false);
});

test('current picker: A/B/A directory reuse fences a late Apply and resets to the current saved intent', async t => {
  let release;
  const completion = new Promise(resolve => { release = () => resolve(native); });
  t.after(() => { release(); return completion; });
  const x = await control(t, { onApply: () => completion }), { f } = x;
  x.onSettle(release);
  await f.click(x.button('Session tools')); await selectNative(x);
  await f.click(x.button('Apply'), { settle: false });
  x.props.cwd = '/synthetic/B';
  await f.rerender(h(x.graph.SessionToolsControl, x.props));
  x.props.cwd = '/synthetic/project';
  await f.rerender(h(x.graph.SessionToolsControl, x.props));
  release(); await f.commit();
  assert.equal(x.node('dialog').open, true, 'late A completion cannot close the new A incarnation');
  assert.equal(checkbox(x, 'Code-mode').checked, false);
  assert.equal(checkbox(x, 'synthetic-server').checked, false);
});

test('Settings: partial overflow repairs remain editable and the final repair clears the warning', async t => {
  const x = await settings(t), { f } = x;
  const extras = [{ scope: 'project', name: 'extra-one' }, { scope: 'project', name: 'extra-two' }];
  const full = { ...off, mcpServers: Array.from({ length: 128 }, (_, i) => ({ scope: 'global', name: `server-${i}` })) };
  x.globalDefault.selection = full;
  x.projectDefault.preferences = { servers: extras.map(server => ({ ...server, value: true })) };
  x.metadata.defaultError = 'Too many selected MCP servers (maximum 128)';
  await x.project();
  let index = 0;
  f.route('POST', '/api/native-tools', { body: () => ({ scope: 'project', cwd: '/synthetic/project', revision: index ? nextRevision : revision,
    change: { server: extras[index], value: false } }), reply: () => ({ data: {
      projectDefault: { ...x.projectDefault, revision: index ? 'c'.repeat(64) : nextRevision,
        preferences: { servers: extras.map((server, i) => ({ ...server, value: i > index })) } },
      ...(index ? { defaultSelection: full } : { defaultError: x.metadata.defaultError }),
    } }) });
  await f.input('select[aria-label="extra-one"]', 'off');
  assert.match(x.text(), /maximum 128/);
  assert.equal(x.node('select[aria-label="extra-two"]').disabled, false);
  index = 1;
  await f.input('select[aria-label="extra-two"]', 'off');
  assert.equal(x.text().includes('maximum 128'), false);
  assert.equal(x.writes().length, 2);
  assert.match(x.text(), /Saved/);
});

test('Settings: Code-mode defaults are independent of MCP servers', async t => {
  const x = await settings(t, { codeModeOnly: true }), { f } = x;
  const change = { codeMode: true };
  f.route('POST', '/api/native-tools', { body: { scope: 'global', revision, change }, reply: { data: {
    globalDefault: { ...x.globalDefault, revision: nextRevision, preferences: { servers: [], codeMode: true } } } } });
  assert.equal(x.f.view.container.querySelector('details') === null, true);
  await f.click(switchFor(x, 'Enable for new chats'));
  assert.equal(switchFor(x, 'Enable for new chats').getAttribute('aria-checked'), 'true');
  assert.equal(x.writes().length, 1);
});
