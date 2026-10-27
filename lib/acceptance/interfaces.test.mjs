import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { fixture, profile } from './test.fixture.mjs';
const jiti = createJiti(import.meta.url, { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } });
const { createAcceptanceExtension } = await jiti.import('./extension.ts');
const { AcceptanceCoordinator } = await jiti.import('./coordinator.ts');
const { acceptanceRoot, acceptanceProject, saveProfiles, digest } = await jiti.import('./config.ts');
const { allowFileRoot } = await jiti.import('../file-access.ts');
const { GET, POST } = await jiti.import('../../app/api/acceptance/route.ts');
const { acceptanceManifest } = await jiti.import('../../plugins/acceptance/manifest.ts');
const { updatePluginSettings, onPluginSettingsChange } = await jiti.import('../plugins/settings.ts');
const setEnabled = (enabled) => updatePluginSettings(acceptanceManifest, 'global', undefined, { enabled }, []);
function setup(t, options) {
  const f = fixture(t, options); allowFileRoot(f.cwd);
  const project = acceptanceProject(f.cwd), profiles = saveProfiles(project, [{ ...profile(), permission: 'ask' }]);
  const coordinator = new AcceptanceCoordinator(acceptanceRoot(), { resources: () => ({ cpus: 0, memoryMiB: 0 }), execute: () => { throw new Error('must not launch'); } });
  const symbol = Symbol.for('brabbler:acceptance-coordinators/v1');
  globalThis[symbol] ??= new Map(); globalThis[symbol].set(acceptanceRoot(), coordinator);
  f.own(coordinator);
  t.after(() => { globalThis[symbol].delete(coordinator.root); });
  const tools = new Map(); createAcceptanceExtension(f.cwd).factory({ registerTool: (tool) => tools.set(tool.name, tool), on() {} });
  let answer = true, confirmations = [];
  const ctx = { cwd: f.cwd, hasUI: true, sessionManager: { getSessionId: () => 'browser' }, ui: { confirm: async (title, text) => { confirmations.push({ title, text }); return typeof answer === 'function' ? answer() : answer; } } };
  const call = (name, params, signal = new AbortController().signal) => tools.get(name).execute('call-1', params, signal, undefined, ctx);
  return { ...f, project, profiles, coordinator, tools, ctx, call, confirmations, answer: (value) => { answer = value; } };
}
test('session tools expose only named recipes and bind Ask, caller identity, cancellation and waits', async (t) => {
  const f = setup(t);
  assert.deepEqual([...f.tools.keys()], ['acceptance_run', 'acceptance_status', 'acceptance_cancel']);
  assert.ok([...f.tools.values()].every((tool) => tool.exposure === 'model-only'));
  assert.equal(f.tools.get('acceptance_run').parameters.properties.argv, undefined);
  f.answer(false); await assert.rejects(f.call('acceptance_run', { profile: 'full' }), /not approved/);
  assert.equal(f.coordinator.view(f.project).runs.length, 0);
  f.answer(true); const created = await f.call('acceptance_run', { profile: 'full', requestId: 'idempotent' });
  assert.match(f.confirmations.at(-1).text, /Command argv.*node/);
  assert.match(f.confirmations.at(-1).text, /test.mjs/);
  assert.equal(created.details.run.owner, 'session_browser', 'SDK IDs never collide with browser authority');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.call('acceptance_status', { runId: created.details.run.id, wait: true }, controller.signal), /abort/i);
  assert.equal(f.coordinator.view(f.project).runs[0].state, 'queued');
  await f.call('acceptance_cancel', { runId: created.details.run.id });
  assert.equal(f.coordinator.view(f.project).runs[0].state, 'cancelled');
});
test('tool approval cannot survive changed recipes and foreign project scope never borrows caller authority', async (t) => {
  const f = setup(t), foreign = join(f.root, 'foreign'); mkdirSync(foreign); allowFileRoot(foreign);
  await assert.rejects(f.call('acceptance_status', { cwd: foreign }), /own project/);
  f.answer(() => { saveProfiles(f.project, [{ ...profile(), permission: 'deny' }]); return true; });
  await assert.rejects(f.call('acceptance_run', { profile: 'full' }), /changed|unavailable/);
  assert.equal(f.coordinator.view(f.project).runs.length, 0);
});
const request = (body, headers = {}) => new Request('http://localhost/api/acceptance', {
  method: 'POST', headers: { Host: 'localhost', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
test('browser API preserves origin/type/root boundaries and exact recipe proposal identity', async (t) => {
  const f = setup(t), payload = { action: 'run', cwd: f.cwd, profile: 'full', profileDigest: digest(f.profiles[0]), requestId: 'browser-request' };
  assert.equal((await POST(request(payload, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await POST(request(payload, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await POST(request({ ...payload, cwd: '/not/an/allowed/project' }))).status, 400);
  assert.equal((await POST(request({ ...payload, profileDigest: 'wrong' }))).status, 400);
  assert.equal((await POST(request({ ...payload, argv: ['sh'] }))).status, 400);
  const first = await POST(request(payload)); assert.equal(first.status, 200); const value = await first.json();
  const retry = await (await POST(request(payload))).json(); assert.equal(retry.run.id, value.run.id);
  const status = await GET(new Request(`http://localhost/api/acceptance?cwd=${encodeURIComponent(f.cwd)}`, { headers: { Host: 'localhost' } }));
  assert.equal(status.status, 200); assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal((await status.json()).runs[0].owner, 'browser');
  assert.equal((await POST(request({ action: 'cancel', cwd: f.cwd, runId: value.run.id }))).status, 200);
});
test('disabled plugin keeps browser configuration/history readable but refuses model and browser starts', async (t) => {
  const f = setup(t, { enabled: false });
  assert.ok([...f.tools.values()].every(tool => tool.exposure === 'hidden'));
  await assert.rejects(f.call('acceptance_run', { profile: 'full' }), /plugin is disabled/);
  assert.equal(f.confirmations.length, 0);
  const payload = { action: 'run', cwd: f.cwd, profile: 'full', profileDigest: digest(f.profiles[0]), requestId: 'disabled-browser' };
  assert.equal((await POST(request(payload))).status, 400);
  const status = await GET(new Request(`http://localhost/api/acceptance?cwd=${encodeURIComponent(f.cwd)}`, { headers: { Host: 'localhost' } }));
  const view = await status.json(); assert.equal(status.status, 200); assert.equal(view.enabled, false); assert.equal(view.profiles.length, 1);
  assert.equal(f.coordinator.view(f.project).runs.length, 0);
});
test('disable aborts a pending exact-recipe approval despite an earlier throwing listener and rapid enable cannot reuse it', async (t) => {
  const diagnostics = t.mock.method(console, 'error', () => {});
  const unsubscribe = onPluginSettingsChange(() => { throw new Error('model definitions are applying'); }); t.after(unsubscribe);
  const f = setup(t);
  f.ctx.ui.confirm = async (_title, _text, options) => {
    setEnabled(false); setEnabled(true);
    assert.equal(options.signal.aborted, true); return true;
  };
  await assert.rejects(f.call('acceptance_run', { profile: 'full' }), /disabled during admission/);
  assert.equal(diagnostics.mock.callCount(), 2);
  assert.equal(f.coordinator.view(f.project).runs.length, 0);
});
