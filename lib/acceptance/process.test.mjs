import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { fixture, profile, until } from './test.fixture.mjs';
const jiti = createJiti(import.meta.url);
const { executeAcceptance, processIdentity } = await jiti.import('./process.ts');
const { AcceptanceCoordinator } = await jiti.import('./coordinator.ts');
const { acceptanceProject, acceptanceRoot, digest, saveProfiles } = await jiti.import('./config.ts');
const { createActivityClientController } = await jiti.import('../activity-client-controller.ts');
test('real owned execution records exit status/logs and observes normal settlement', async (t) => {
  const f = fixture(t), logPath = join(f.root, 'output.log');
  const result = await executeAcceptance([process.execPath, '-e', 'console.log("real fixture output"); process.exitCode=7'], {
    cwd: f.cwd, env: { PATH: process.env.PATH }, logPath, signal: new AbortController().signal,
  });
  assert.equal(result.code, 7); assert.equal(result.settled, true);
  assert.match(readFileSync(logPath, 'utf8'), /real fixture output/);
});
test('disposing the actual Activity observer leaves an independently admitted native Acceptance job running until its own gate settles', async t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'test.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    const root = process.env.PI_WEB_ACCEPTANCE_RUNTIME;
    const watcher = fs.watch(root, () => {
      if (fs.existsSync(path.join(root, 'release'))) { watcher.close(); console.log('independent acceptance passed'); }
    });
    fs.writeFileSync(path.join(root, 'ready'), 'ready');
  `);
  const project = acceptanceProject(f.cwd), recipe = saveProfiles(project, [profile()])[0];
  let identity, nativeSignal, run;
  const coordinator = f.own(new AcceptanceCoordinator(acceptanceRoot(), {
    resources: () => ({ cpus: 1, memoryMiB: 2048 }),
    execute(argv, options) {
      nativeSignal = options.signal;
      return f.track(executeAcceptance(argv, { ...options, onSpawn(value) { identity = value; options.onSpawn?.(value); } }));
    },
  }));
  f.release(() => { if (run && existsSync(run.runtimeDirectory)) writeFileSync(join(run.runtimeDirectory, 'release'), 'release'); });
  ({ run } = await f.track(coordinator.submit(project, recipe.name, 'session-a', 'independent-observer', digest(recipe))));
  await until(() => {
    const state = coordinator.view(project).runs.find(item => item.id === run.id);
    assert.ok(!['failed', 'outcome-unknown', 'cancelled'].includes(state.state), `native readiness failed: ${state.error ?? state.state}`);
    return existsSync(join(run.runtimeDirectory, 'ready'));
  });
  assert.ok(identity); assert.equal(nativeSignal.aborted, false);
  const calls = [], timers = new Set();
  const observer = f.own(createActivityClientController({
    async request(path) { calls.push(path); return Response.json({ sessionListVersion: 1, completedRuns: [], reviewedRuns: [] }); },
    schedule(callback) { timers.add(callback); return callback; }, cancel(callback) { timers.delete(callback); },
    visible: () => true, listen: () => () => {}, legacy: { read: () => [], clear() {} },
  }));
  const release = observer.retain(); f.release(release);
  await observer.whenIdle(); release(); await observer.disposeWhenUnobserved();
  assert.equal(timers.size, 0);
  assert.deepEqual(calls, ['/api/activity/review', '/api/agent/running']);
  assert.equal(nativeSignal.aborted, false, 'observer disposal has no native cancellation authority');
  const current = processIdentity(identity.pid);
  assert.ok(current, 'the real owned child still exists');
  for (const key of ['pid', 'ppid', 'group', 'session', 'start']) assert.equal(current[key], identity[key], `native ${key} identity is unchanged`);
  assert.ok(['R', 'S', 'D'].includes(current.state), 'the held child is live, not exited or stopped');
  const pending = coordinator.view(project).runs.find(item => item.id === run.id);
  assert.equal(pending.state, 'running'); assert.equal(pending.settled, false);
  writeFileSync(join(run.runtimeDirectory, 'release'), 'release');
  await until(() => coordinator.view(project).runs.find(item => item.id === run.id)?.settled);
  const completed = coordinator.view(project).runs.find(item => item.id === run.id);
  assert.equal(completed.state, 'passed'); assert.equal(completed.settled, true);
  assert.equal(processIdentity(identity.pid), undefined);
  assert.match(readFileSync(completed.logPath, 'utf8'), /independent acceptance passed/);
});

test('missing executable fails honestly without an unsettled child', async (t) => {
  const f = fixture(t);
  const result = await executeAcceptance(['/no/such/acceptance-program'], { cwd: f.cwd, env: {}, logPath: join(f.root, 'missing.log'), signal: new AbortController().signal });
  assert.notEqual(result.code, 0); assert.equal(result.settled, true); assert.match(result.error, /ENOENT/);
});
test('explicit cancellation authenticates the owned process and waits for its closure', async (t) => {
  const f = fixture(t), controller = new AbortController(); let identity;
  const result = await executeAcceptance([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
    cwd: f.cwd, env: {}, logPath: join(f.root, 'cancel.log'), signal: controller.signal, graceMs: 100,
    onSpawn(value) { identity = value; setTimeout(() => controller.abort(), 25); },
  });
  assert.ok(identity); assert.equal(result.interrupted, true); assert.equal(result.settled, true);
  assert.equal(processIdentity(identity.pid), undefined);
});
test('a detached descendant keeping a pipe open cannot manufacture successful settlement', async (t) => {
  const f = fixture(t);
  const source = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},1800)'],{detached:true,stdio:['ignore',process.stdout,process.stderr]});child.unref();`;
  const result = await executeAcceptance([process.execPath, '-e', source], { cwd: f.cwd, env: {}, logPath: join(f.root, 'pipe.log'), signal: new AbortController().signal });
  assert.equal(result.settled, false);
  // The fixture descendant is deliberately finite; wait for it, never broaden ownership by PID search.
  await new Promise((resolve) => setTimeout(resolve, 1900));
});
