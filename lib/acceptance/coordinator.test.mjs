import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { fixture, profile, until } from './test.fixture.mjs';
const jiti = createJiti(import.meta.url);
const { AcceptanceCoordinator } = await jiti.import('./coordinator.ts');
const { acceptanceProject, acceptanceRoot, digest, saveProfiles } = await jiti.import('./config.ts');
const { acceptanceManifest } = await jiti.import('../../plugins/acceptance/manifest.ts');
const { updatePluginSettings, onPluginSettingsChange } = await jiti.import('../plugins/settings.ts');
const { captureSnapshot: actualCapture } = await jiti.import('./snapshot.ts');
const setEnabled = (enabled) => updatePluginSettings(acceptanceManifest, 'global', undefined, { enabled }, []);
function setup(t, resources = () => ({ cpus: 32, memoryMiB: 64000 }), verifySnapshot, syncDirectory, captureSnapshot) {
  const f = fixture(t), project = acceptanceProject(f.cwd);
  const profiles = saveProfiles(project, [profile(), profile('focused')]), pending = [];
  const coordinator = new AcceptanceCoordinator(acceptanceRoot(), { resources, verifySnapshot, syncDirectory, captureSnapshot, execute: async (argv, options) => new Promise((resolve) => pending.push({ argv, options, resolve })) });
  t.after(() => coordinator.disposeSettingsSubscription());
  const submit = (key = 'request', caller = 'session-a', name = 'full', target = project) => coordinator.submit(target, name, caller, key, digest(profiles.find((p) => p.name === name)));
  const view = () => coordinator.view(project);
  const finish = async (result = { code: 0, settled: true, interrupted: false, scope: 'fixture' }) => {
    await until(() => pending.length); const activeId = view().activeRunId; pending.shift().resolve(result); await until(() => view().activeRunId !== activeId);
  };
  return { ...f, project, profiles, coordinator, pending, submit, view, finish };
}
test('parallel identical requests join one eligible job; retries never recapture or relaunch', async (t) => {
  const f = setup(t);
  const [a, b] = await Promise.all([f.submit('a'), f.submit('b', 'session-b')]);
  assert.equal(a.run.id, b.run.id); assert.equal(b.joined, true);
  assert.equal(f.view().runs[0].observers.length, 2);
  await until(() => f.pending.length === 1);
  writeFileSync(join(f.cwd, 'test.mjs'), 'changed after submission');
  assert.equal((await f.submit('a')).run.id, a.run.id);
  assert.match(readFileSync(join(a.run.snapshot.directory, 'test.mjs'), 'utf8'), /fixture/);
  await f.finish();
  assert.equal(f.view().runs[0].state, 'passed');
  assert.equal((await f.submit('a')).run.id, a.run.id);
});
test('different snapshots and different projects queue behind the single shared heavy slot', async (t) => {
  const f = setup(t), a = await f.submit('a');
  await until(() => f.pending.length === 1);
  writeFileSync(join(f.cwd, 'test.mjs'), 'different source');
  const b = await f.submit('b'); assert.notEqual(a.run.id, b.run.id);
  const foreign = join(f.root, 'foreign'); mkdirSync(foreign); writeFileSync(join(foreign, 'test.mjs'), 'other');
  const project = acceptanceProject(foreign); saveProfiles(project, [profile()]);
  const c = await f.coordinator.submit(project, 'full', 'session-c', 'c', digest(f.profiles[0]));
  assert.equal(f.pending.length, 1); assert.equal(f.coordinator.view(project).runs[0].state, 'queued');
  await f.coordinator.cancel(f.project, b.run.id, 'session-a');
  await f.finish();
  await until(() => f.pending.length === 1);
  assert.equal(f.pending[0].options.cwd, c.run.snapshot.directory);
  f.pending.shift().resolve({ code: 0, settled: true });
  await until(() => !f.coordinator.view(project).activeRunId);
});
test('joiners cannot cancel; owner cancellation waits for actual supervisor settlement', async (t) => {
  const f = setup(t), a = await f.submit('a'); await f.submit('b', 'session-b');
  await until(() => f.pending.length === 1);
  await assert.rejects(f.coordinator.cancel(f.project, a.run.id, 'session-b'), /initiating/);
  await f.coordinator.cancel(f.project, a.run.id, 'session-a');
  assert.equal(f.view().runs[0].state, 'cancelling'); assert.equal(f.view().runs[0].settled, false);
  assert.equal(f.pending[0].options.signal.aborted, true);
  await f.finish({ code: null, settled: true, interrupted: true });
  assert.equal(f.view().runs[0].state, 'cancelled'); assert.equal(f.view().runs[0].settled, true);
});
test('historical success is never automatically reused for a new request', async (t) => {
  const f = setup(t), first = await f.submit('a'); await f.finish();
  const second = await f.submit('b'); assert.notEqual(first.run.id, second.run.id); assert.equal(second.joined, false);
  await f.finish();
});
test('unknown settlement closes admission and explicit reconciliation never creates a pass', async (t) => {
  const f = setup(t); await f.submit('a');
  await f.finish({ code: 0, settled: false, interrupted: false });
  assert.equal(f.view().runs[0].state, 'outcome-unknown'); assert.ok(f.view().blocked);
  await assert.rejects(f.submit('b'), /unknown settlement/);
  await assert.rejects(f.coordinator.recover(false), /Confirm/);
  await f.coordinator.recover(true);
  assert.equal(f.view().runs[0].state, 'reconciled'); assert.equal(f.view().runs[0].settled, false);
  await f.submit('c'); await f.finish();
});
test('a second coordinator never steals ownership, replays a saved queue or recovers a live owner', async (t) => {
  const f = setup(t, () => ({ cpus: 0, memoryMiB: 0 })), first = await f.submit('a');
  const other = new AcceptanceCoordinator(acceptanceRoot());
  t.after(() => other.disposeSettingsSubscription());
  assert.equal(other.view(f.project).runs[0].state, 'outcome-unknown'); assert.ok(other.view(f.project).blocked);
  await assert.rejects(other.submit(f.project, 'full', 'other', 'b', digest(f.profiles[0])), /coordinator|server/i);
  await assert.rejects(other.recover(true), /still alive/);
  await f.coordinator.cancel(f.project, first.run.id, 'session-a');
});
test('resource admission queues without spawning; browser cancellation is explicit and independent', async (t) => {
  const f = setup(t, () => ({ cpus: 1, memoryMiB: 1000 })), first = await f.submit('a');
  await new Promise((r) => setTimeout(r, 30)); assert.equal(f.pending.length, 0);
  assert.equal(f.view().runs[0].state, 'queued');
  await f.coordinator.cancel(f.project, first.run.id, 'browser', true);
  assert.equal(f.view().runs[0].state, 'cancelled');
});
test('queued recipe revocation and snapshot tampering fail before any process starts', async (t) => {
  const f = setup(t); await f.submit('a'); await until(() => f.pending.length === 1);
  const second = await f.submit('b', 'session-a', 'focused');
  chmodSync(join(second.run.snapshot.directory, 'test.mjs'), 0o600);
  writeFileSync(join(second.run.snapshot.directory, 'test.mjs'), 'tampered');
  await f.finish();
  await until(() => f.view().runs.find((r) => r.id === second.run.id).state === 'failed');
  assert.equal(f.pending.length, 0);
  const third = await f.submit('c', 'session-a', 'focused');
  saveProfiles(f.project, []);
  await until(() => f.view().runs.find((r) => r.id === third.run.id).state === 'failed');
  assert.equal(f.pending.length, 0);
});
test('retry keys bind original project/profile and pre-admission abort never dispatches', async (t) => {
  const f = setup(t), first = await f.submit('a');
  await assert.rejects(f.submit('a', 'session-a', 'focused'), /different inputs/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.coordinator.submit(f.project, 'full', 'session-a', 'cancel', digest(f.profiles[0]), controller.signal), /abort/i);
  await f.coordinator.cancel(f.project, first.run.id, 'session-a');
  if (f.pending.length) await f.finish({ code: 130, settled: true, interrupted: true });
});
test('revocation during awaited verification is rechecked before dispatch', async (t) => {
  let entered = false, release;
  const f = setup(t, undefined, async () => { entered = true; await new Promise((resolve) => { release = resolve; }); });
  const first = await f.submit('a'); await until(() => entered);
  saveProfiles(f.project, []); release();
  await until(() => f.view().runs[0].state === 'failed');
  assert.equal(f.pending.length, 0); assert.equal(f.view().runs[0].id, first.run.id);
});
test('retry key cannot substitute a newly approved recipe under the same profile name', async (t) => {
  const f = setup(t), first = await f.submit('a');
  const changed = saveProfiles(f.project, [{ ...profile(), label: 'Different exact proposal' }])[0];
  await assert.rejects(f.coordinator.submit(f.project, 'full', 'session-a', 'a', digest(changed)), /different inputs/);
  await f.coordinator.cancel(f.project, first.run.id, 'session-a');
  if (f.pending.length) await f.finish({ code: 130, settled: true, interrupted: true });
});
test('execution uses the persisted environment recipe rather than a later host PATH', async (t) => {
  const f = setup(t), previous = process.env.PATH;
  try {
    await f.submit('a'); await until(() => f.pending.length === 1);
    await f.submit('b', 'session-a', 'focused');
    process.env.PATH = previous + ':/nonexistent-later-path';
    await f.finish(); await until(() => f.pending.length === 1);
    assert.equal(f.pending[0].options.env.PATH, previous);
    assert.equal(f.pending[0].options.env.PI_WEB_PASSWORD, undefined);
    assert.equal(f.pending[0].options.env.NODE_ENV, 'test');
    await f.finish();
  } finally { process.env.PATH = previous; }
});
test('completion persistence can be retried without relaunching a settled command', async (t) => {
  const f = setup(t), first = await f.submit('a'); await until(() => f.pending.length === 1);
  const file = join(acceptanceRoot(), 'runs.json'), backup = file + '.fixture-backup';
  renameSync(file, backup); mkdirSync(file);
  f.pending.shift().resolve({ code: 0, settled: true });
  await until(() => f.coordinator.pendingCompletion && f.coordinator.persistenceError);
  rmdirSync(file); renameSync(backup, file);
  await until(() => f.view().blocked);
  assert.equal(f.view().runs[0].state, 'outcome-unknown');
  await f.coordinator.recover(true);
  assert.equal(f.view().runs[0].state, 'passed'); assert.equal(f.view().runs[0].id, first.run.id);
  assert.equal(f.pending.length, 0); assert.equal(f.view().blocked, undefined);
});
test('history admission reserves completion bytes instead of writing a ledger it cannot read', async (t) => {
  const f = setup(t), first = await f.submit('a'); await f.finish();
  const file = join(acceptanceRoot(), 'runs.json'), ledger = JSON.parse(readFileSync(file, 'utf8'));
  ledger.runs = Array.from({ length: 900 }, (_, index) => {
    const id = `retained-${index}`, directory = join(acceptanceRoot(), 'runs', id);
    return { ...first.run, id, state: 'passed', settled: true, requests: [], snapshot: { ...first.run.snapshot, directory: join(directory, 'source') },
      logPath: join(directory, 'execution.log'), runtimeDirectory: join(directory, 'runtime'), profile: { ...first.run.profile, argv: ['node', ...Array(4).fill('x'.repeat(3500))] } };
  });
  const encoded = JSON.stringify(ledger); assert.ok(Buffer.byteLength(encoded) > 12 * 1024 ** 2 && Buffer.byteLength(encoded) < 16 * 1024 ** 2);
  writeFileSync(file, encoded);
  await assert.rejects(f.submit('over-budget'), /byte budget/);
  assert.equal(f.view().runs.length, 900); assert.equal(f.view().blocked, undefined); assert.equal(f.pending.length, 0);
});
test('post-rename directory fsync failure before dispatch remains recoverable without starting a process', async (t) => {
  let syncs = 0, fail = true;
  const f = setup(t, undefined, undefined, () => { if (++syncs === 3 && fail) throw new Error('controlled post-rename fsync failure'); });
  await f.submit('a'); await until(() => f.view().blocked);
  assert.equal(f.view().runs[0].state, 'outcome-unknown'); assert.equal(f.view().activeRunId, undefined); assert.equal(f.pending.length, 0);
  fail = false; await f.coordinator.recover(true);
  assert.equal(f.view().runs[0].state, 'cancelled'); assert.equal(f.view().runs[0].settled, true);
  assert.equal(f.view().blocked, undefined); await f.submit('b'); await f.finish();
});
test('post-rename queued-cancellation fsync failure does not strand a live admission', async (t) => {
  let syncs = 0;
  const f = setup(t, () => ({ cpus: 0, memoryMiB: 0 }), undefined, () => { if (++syncs === 3) throw new Error('controlled cancellation fsync failure'); });
  const first = await f.submit('a');
  await assert.rejects(f.coordinator.cancel(f.project, first.run.id, 'session-a'), /fsync failure/);
  assert.equal(f.pending.length, 0); assert.ok(f.view().blocked);
  await f.coordinator.recover(true);
  assert.equal(f.view().runs[0].state, 'cancelled'); assert.equal(f.view().blocked, undefined);
});
test('missing or malformed global plugin state refuses new submissions before capture or ownership', async (t) => {
  const f = setup(t); unlinkSync(f.pluginSettingsPath);
  await assert.rejects(f.submit('missing'), /plugin is disabled/);
  assert.equal(existsSync(join(acceptanceRoot(), 'controller.json')), false);
  writeFileSync(f.pluginSettingsPath, 'invalid');
  await assert.rejects(f.submit('invalid'), /plugin is disabled/);
  assert.equal(f.view().runs.length, 0);
});
test('disable cancels queued jobs across projects, preserves active ownership and rapid re-enable never revives them', async (t) => {
  const f = setup(t), active = await f.submit('active'); await until(() => f.pending.length === 1);
  const queued = await f.submit('queued', 'session-a', 'focused');
  const foreign = join(f.root, 'foreign'); mkdirSync(foreign); writeFileSync(join(foreign, 'test.mjs'), 'foreign');
  const other = acceptanceProject(foreign); saveProfiles(other, [profile()]);
  const otherRun = await f.coordinator.submit(other, 'full', 'session-b', 'foreign', digest(f.profiles[0]));
  setEnabled(false); setEnabled(true);
  await until(() => f.view().runs.find(r => r.id === queued.run.id).state === 'cancelled');
  assert.equal(f.coordinator.view(other).runs[0].state, 'cancelled');
  assert.equal(f.coordinator.view(other).runs[0].id, otherRun.run.id);
  assert.equal(f.view().runs.find(r => r.id === active.run.id).state, 'running');
  assert.equal(f.pending[0].options.signal.aborted, false);
  await f.finish(); assert.equal(f.pending.length, 0);
  const fresh = await f.submit('fresh', 'session-a', 'focused'); assert.notEqual(fresh.run.id, queued.run.id); await f.finish();
});
test('a throwing earlier session refresh cannot suppress queued disable revocation', async (t) => {
  const diagnostics = t.mock.method(console, 'error', () => {});
  const unsubscribe = onPluginSettingsChange(() => { throw new Error('model definitions are applying'); }); t.after(unsubscribe);
  const f = setup(t); await f.submit('active'); await until(() => f.pending.length === 1);
  const queued = await f.submit('queued', 'session-a', 'focused');
  setEnabled(false); setEnabled(true);
  await until(() => f.view().runs.find(run => run.id === queued.run.id).state === 'cancelled');
  assert.equal(diagnostics.mock.callCount(), 2, 'exposure failures are diagnosed separately from the committed save');
  assert.equal(f.pending[0].options.signal.aborted, false);
  await f.finish(); assert.equal(f.pending.length, 0);
});
test('an already-started job settles naturally while the plugin stays disabled', async (t) => {
  const f = setup(t), active = await f.submit('active'); await until(() => f.pending.length === 1);
  setEnabled(false);
  assert.equal(f.pending[0].options.signal.aborted, false);
  await f.finish();
  const run = f.view().runs.find(run => run.id === active.run.id);
  assert.equal(run.state, 'passed'); assert.equal(run.settled, true);
  await assert.rejects(f.submit('still-disabled'), /plugin is disabled/);
});
test('a disable/enable transition during capture invalidates the old admission without queueing a job', async (t) => {
  let captured = false, release;
  const f = setup(t, undefined, undefined, undefined, async (...args) => {
    const snapshot = await actualCapture(...args); captured = true; await new Promise(resolve => { release = resolve; }); return snapshot;
  });
  const pending = f.submit('capturing'); void pending.catch(() => {});
  await until(() => captured); setEnabled(false); setEnabled(true); release();
  await assert.rejects(pending, /disabled during capture/);
  assert.equal(f.view().runs.length, 0); assert.equal(f.pending.length, 0);
});
test('disable during verification cancels before dispatch even after immediately re-enabling', async (t) => {
  let entered = false, release;
  const f = setup(t, undefined, async () => { entered = true; await new Promise(resolve => { release = resolve; }); });
  await f.submit('verifying'); await until(() => entered);
  setEnabled(false); setEnabled(true); release();
  await until(() => f.view().runs[0].state === 'cancelled'); assert.equal(f.pending.length, 0);
});
test('the final dispatch async boundary cannot start a process after disable', async (t) => {
  let trigger = true;
  const f = setup(t, () => {
    if (trigger) { trigger = false; queueMicrotask(() => { setEnabled(false); setEnabled(true); }); }
    return { cpus: 32, memoryMiB: 64000 };
  });
  await f.submit('boundary'); await until(() => f.view().runs[0].state === 'cancelled');
  assert.equal(f.pending.length, 0); assert.equal(f.view().runs[0].settled, true);
});
test('failed disable cancellation remains latched when an active completion later restores persistence', async (t) => {
  const f = setup(t); await f.submit('active'); await until(() => f.pending.length === 1);
  const queued = await f.submit('queued', 'session-a', 'focused');
  const file = join(acceptanceRoot(), 'runs.json'), backup = file + '.disable-backup';
  renameSync(file, backup); mkdirSync(file);
  setEnabled(false); setEnabled(true);
  await until(() => f.coordinator.persistenceError);
  rmdirSync(file); renameSync(backup, file);
  await f.finish();
  await until(() => f.view().runs.find(r => r.id === queued.run.id).state === 'cancelled');
  assert.equal(f.pending.length, 0);
});
