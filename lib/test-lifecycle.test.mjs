import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanupBulk, directoryIdentity, innerSettlement, runOwned, stopObservedDescendants } from '../nix/test-lifecycle.mjs';
import { createOwnedTracker, processIdentity } from '../nix/test-runner.mjs';
import { validateArgs } from '../nix/test.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-contract-'));
  fs.chmodSync(root, 0o700);
  for (const name of ['source', 'tmp', 'artifacts']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  for (const name of ['source/node_modules', 'source/.next', 'tmp/node-compile-cache', 'tmp/failed-fixture']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    fs.writeFileSync(path.join(root, name, 'sentinel'), name);
  }
  fs.writeFileSync(path.join(root, 'source-input.json'), '{}');
  fs.writeFileSync(path.join(root, 'source/example.ts'), 'export const value = 1;');
  fs.writeFileSync(path.join(root, 'artifacts/evidence.log'), 'retained');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, original: directoryIdentity(root), options: { settled: true, interrupted: false,
    keepWorkspace: false, sourceIdentity: directoryIdentity(path.join(root, 'source')) } };
}

test('cleanup removes only regenerable bulk on settled success OR failure', (t) => {
  for (const code of [0, 1]) {
    const f = fixture(t);
    const result = cleanupBulk(f.root, f.original, { ...f.options, code });
    assert.equal(result.status, 'removed');
    assert.equal(result.paths.length, 3);
    for (const p of ['source/node_modules', 'source/.next', 'tmp/node-compile-cache']) assert.ok(!fs.existsSync(path.join(f.root, p)));
    for (const p of ['source-input.json', 'source/example.ts', 'artifacts/evidence.log', 'tmp/failed-fixture/sentinel']) assert.ok(fs.existsSync(path.join(f.root, p)));
  }
});

test('keep-workspace, interruption, uncertainty and missing source identity retain bulk', (t) => {
  for (const change of [{ keepWorkspace: true }, { settled: false }, { interrupted: true }, { sourceIdentity: null }]) {
    const f = fixture(t);
    assert.equal(cleanupBulk(f.root, f.original, { ...f.options, ...change }).status, 'retained');
    assert.ok(fs.existsSync(path.join(f.root, 'source/node_modules/sentinel')));
  }
  assert.throws(() => validateArgs(['core', '--keep-workspace']), /Unknown core option/);
  // Successful workspaces belong to Nix; low-level uncertain/interrupted bulk
  // retention above remains independent of the removed host-runner CLI flag.
});

test('dependency symlinks are unlinked, never traversed; replaced source/root refuse', (t) => {
  const f = fixture(t), outside = fixture(t);
  const modules = path.join(f.root, 'source/node_modules');
  fs.rmSync(modules, { recursive: true });
  fs.symlinkSync(outside.root, modules);
  cleanupBulk(f.root, f.original, f.options);
  assert.ok(fs.existsSync(path.join(outside.root, 'source/example.ts')));
  const replaced = fixture(t);
  fs.renameSync(path.join(replaced.root, 'source'), path.join(replaced.root, 'saved-source'));
  fs.symlinkSync(outside.root, path.join(replaced.root, 'source'));
  assert.throws(() => cleanupBulk(replaced.root, replaced.original, replaced.options), /refused/);
  assert.throws(() => cleanupBulk(outside.root, f.original, outside.options), /identity changed/);
});

test('same-device nested mounts are refused before any bulk removal', (t) => {
  const f = fixture(t);
  const script = fileURLToPath(new URL('../nix/cleanup-test-workspace.py', import.meta.url));
  const code = `import importlib.util, sys\nspec=importlib.util.spec_from_file_location('cleanup',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nm.cleanup(sys.argv[2], tuple(map(int,sys.argv[3:5])), tuple(map(int,sys.argv[5:7])), mounts=[sys.argv[2]+'/source/.next/bind'])`;
  const out = spawnSync('python3', ['-I', '-B', '-c', code, script, f.root, ...f.original.map(String), ...f.options.sourceIdentity.map(String)], { encoding: 'utf8' });
  assert.equal(out.status, 1); assert.match(out.stderr, /Mounted cleanup target refused/);
  assert.ok(fs.existsSync(path.join(f.root, 'source/node_modules/sentinel')));
});

test('inner test uncertainty vetoes cleanup independently of suite exit code', (t) => {
  const f = fixture(t), run = path.join(f.root, 'artifacts/run-one');
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ success: false, results: [{ uncertain: false, survivors: [] }] }));
  assert.equal(innerSettlement(f.root), true);
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ success: true, results: [{ sessionScanLimited: true }] }));
  assert.equal(innerSettlement(f.root), false);
});

test('simultaneous supervisors distinguish settled assertion failure from interruption', async (t) => {
  const f = fixture(t);
  const command = (code) => runOwned(process.execPath, ['-e', `setTimeout(()=>process.exit(${code}),80)`],
    { cwd: f.root, env: {}, echo: false, logPath: path.join(f.root, `exit-${code}.log`) });
  const results = await Promise.all([command(0), command(1)]);
  assert.deepEqual(results.map((r) => [r.code, r.settled, r.interrupted]), [[0, true, false], [1, true, false]]);
  const controller = new AbortController();
  const running = runOwned(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    { cwd: f.root, env: {}, echo: false, signal: controller.signal, logPath: path.join(f.root, 'interrupted.log'), graceMs: 100, killMs: 100 });
  const timer = setTimeout(() => controller.abort('SIGTERM'), 100);
  const stopped = await running; clearTimeout(timer);
  assert.equal(stopped.interrupted, true); assert.equal(stopped.settled, true);
});

test('VM cleanup removes only its pinned runtime/tmp/cache and retains diagnostics', (t) => {
  const f = fixture(t);
  for (const name of ['runtime', 'cache']) fs.mkdirSync(path.join(f.root, name));
  fs.writeFileSync(path.join(f.root, 'runtime', 'disk.qcow2'), 'owned disposable VM disk');
  const runtime = directoryIdentity(path.join(f.root, 'runtime'));
  const script = fileURLToPath(new URL('../nix/cleanup-test-workspace.py', import.meta.url));
  const out = spawnSync('python3', ['-I', '-B', script, '--vm', f.root, ...f.original.map(String), ...runtime.map(String)], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  for (const name of ['runtime', 'tmp', 'cache']) assert.equal(fs.existsSync(path.join(f.root, name)), false);
  assert.ok(fs.existsSync(path.join(f.root, 'artifacts/evidence.log')));
  assert.ok(fs.existsSync(path.join(f.root, 'source/node_modules/sentinel')), 'VM mode cannot sweep checkout/source dependencies');
});

test('supervisor CLI preserves failed evidence, honors keep and records partial cleanup', (t) => {
  const cli = fileURLToPath(new URL('../nix/test-lifecycle.mjs', import.meta.url));
  for (const [code, keep, partial] of [[0, false, false], [1, false, false], [1, true, false], [0, false, true]]) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, 'source-input.json'), JSON.stringify({ roots: { export: f.options.sourceIdentity } }));
    if (partial) { fs.rmSync(path.join(f.root, 'source/.next'), { recursive: true }); fs.writeFileSync(path.join(f.root, 'source/.next'), 'not a directory'); }
    const run = spawnSync(process.execPath, [cli, f.root, keep ? '1' : '0', process.execPath, '-e', `setTimeout(()=>process.exit(${code}),50)`],
      { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(run.status, partial ? 1 : code, run.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(f.root, 'lifecycle.json'), 'utf8'));
    assert.equal(state.cleanup.status, partial ? 'refused-or-partial' : keep ? 'retained' : 'removed');
    assert.ok(fs.existsSync(path.join(f.root, 'artifacts/evidence.log')));
    assert.equal(fs.existsSync(path.join(f.root, 'source/node_modules')), keep);
  }
});

for (const responsive of [false, true]) test(`outer escalation survives owner closure (responsive=${responsive})`, async (t) => {
  const f = fixture(t), ready = path.join(f.root, 'server-ready');
  const server = path.join(f.root, 'server.mjs');
  fs.writeFileSync(server, `import fs from 'node:fs'; process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>process.exit(),3000);`);
  const owner = path.join(f.root, 'owner.mjs');
  fs.writeFileSync(owner, `import {spawn} from 'node:child_process'; ${responsive ? '' : "process.on('SIGTERM',()=>{});"} spawn(process.execPath,[${JSON.stringify(server)}],{detached:true,stdio:'ignore'}); setTimeout(()=>process.exit(),3000);`);
  const controller = new AbortController();
  const running = runOwned(process.execPath, [owner], { cwd: f.root, env: {}, echo: false,
    signal: controller.signal, logPath: path.join(f.root, 'escalation.log'), graceMs: 150, killMs: 500, pipeMs: 20 });
  const deadline = Date.now() + 2000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 100)); // Allow bounded descendant observation.
  controller.abort('SIGTERM');
  const result = await running;
  assert.ok(fs.existsSync(ready));
  const now = processIdentity(Number(fs.readFileSync(ready, 'utf8')));
  assert.ok(!now || now.state === 'Z', 'detached server did not survive outer escalation');
  assert.equal(result.interrupted, true); assert.equal(result.settled, true);
});

test('interruption arriving after owner closure extends descendant settlement through escalation', async (t) => {
  const f = fixture(t), ready = path.join(f.root, 'late-ready'), ownerPid = path.join(f.root, 'owner-pid');
  const server = path.join(f.root, 'late-server.mjs');
  fs.writeFileSync(server, `import fs from 'node:fs'; process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>process.exit(),4000);`);
  const owner = path.join(f.root, 'late-owner.mjs');
  fs.writeFileSync(owner, `import fs from 'node:fs'; import {spawn} from 'node:child_process'; fs.writeFileSync(${JSON.stringify(ownerPid)},String(process.pid)); spawn(process.execPath,[${JSON.stringify(server)}],{detached:true,stdio:'ignore'}); setTimeout(()=>process.exit(),250);`);
  const controller = new AbortController();
  const running = runOwned(process.execPath, [owner], { cwd: f.root, env: {}, echo: false,
    signal: controller.signal, logPath: path.join(f.root, 'late-escalation.log'), graceMs: 600, killMs: 500, pipeMs: 300 });
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (fs.existsSync(ownerPid) && !processIdentity(Number(fs.readFileSync(ownerPid, 'utf8')))) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort('SIGTERM');
  const result = await running;
  assert.ok(fs.existsSync(ready));
  const now = processIdentity(Number(fs.readFileSync(ready, 'utf8')));
  assert.ok(!now || now.state === 'Z');
  assert.equal(result.interrupted, true); assert.equal(result.settled, true);
});

test('a vanished descendant does not skip signaling its surviving sibling', () => {
  const identities = [{ pid: 101, start: '1', state: 'R' }, { pid: 102, start: '2', state: 'R' }];
  const attempts = [];
  const errors = stopObservedDescendants(identities, 100, { read: (pid) => identities.find((x) => x.pid === pid), kill: (pid) => {
    attempts.push(pid);
    if (pid === 101) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  } });
  assert.deepEqual(attempts, [101, 102]); assert.deepEqual(errors, []);
});

test('final session scan does not overlook a recycled observed PID in the same session', () => {
  const original = { pid: 100, start: '10', session: 100, group: 100, ppid: 1, state: 'R' };
  const old = { pid: 101, start: '11', session: 100, group: 100, ppid: 100, state: 'R' };
  let current = old, leader = original;
  const tracker = createOwnedTracker(original, { readIdentity: (pid) => pid === 100 ? leader : current,
    readChildren: (pid) => pid === 100 ? [101] : [], listPids: () => [100, 101] });
  tracker.sample(); leader = null; current = { ...old, start: '99', ppid: 1 };
  assert.deepEqual(tracker.settle().survivors, [current]);
});
