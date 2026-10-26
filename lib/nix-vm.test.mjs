import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { assertEvidenceTree, assertPortClosed } from '../nix/vm-evidence.mjs';
import { availableResources } from '../nix/resources.mjs';
import { combinedBudget, coreBuildBudget, validateRegistry, workerBudget } from '../nix/vm-plan.mjs';
import { laneFromRegistry, serviceCgroup, writeServiceEnvironment } from '../e2e/service.mjs';
import { run, validateArgs } from '../nix/test.mjs';
import { registryFixture } from '../nix/vm-fixtures.mjs';
const GiB = 1024 ** 3;

function publishFakeExport(program, args) {
  if (program === 'python3' && args.includes('--manifest') && !args.includes('--verify-manifest')) {
    fs.writeFileSync(args[args.indexOf('--manifest') + 1], JSON.stringify({ status: 'complete', contentModeSha256: 'a'.repeat(64) }));
  }
}

test('registry rejects foreign/duplicate identity, controller, unit and resource bindings', () => {
  for (const change of [r => r.lanes[1].port = r.lanes[0].port, r => r.lanes[0].controller = '/tmp/controller',
    r => r.lanes[1].uid = 1000, r => r.lanes[0].unit = 'other.service', r => r.lanes[0].envFile = '/home/t1/service.env',
    r => r.resources.cpus = 100, r => r.package = '/checkout/app']) {
    const registry = registryFixture(); change(registry); assert.throws(() => validateRegistry(registry));
  }
});

test('a lane cannot select another user, port, package, controller or environment file', () => {
  const registry = registryFixture(), lane = registry.lanes[0];
  const env = { E2E_SERVICE_CONTROL: lane.controller, E2E_SERVICE_ENV: lane.envFile,
    E2E_PACKAGE_ROOT: registry.package, E2E_BASE_URL: `http://127.0.0.1:${lane.port}` };
  assert.equal(laneFromRegistry(registry, env, lane.uid).id, lane.id);
  for (const [key, value] of Object.entries({ E2E_SERVICE_CONTROL: registry.lanes[1].controller, E2E_SERVICE_ENV: registry.lanes[1].envFile,
    E2E_PACKAGE_ROOT: '/checkout/app', E2E_BASE_URL: 'http://127.0.0.1:30142' })) {
    assert.throws(() => laneFromRegistry(registry, { ...env, [key]: value }, lane.uid));
  }
  assert.throws(() => laneFromRegistry(registry, env, 0));
  assert.throws(() => serviceCgroup('/user.slice/user-1001.slice/user@1001.service/app.slice/pi-web.service', lane));
});

test('environment writer rejects symlinks, hardlinks and broad permissions before truncating', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-environment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'env'), link = path.join(root, 'link');
  fs.writeFileSync(file, 'original', { mode: 0o600 }); fs.symlinkSync(file, link);
  assert.throws(() => writeServiceEnvironment(link, 'bad')); assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  fs.unlinkSync(link); fs.linkSync(file, link);
  assert.throws(() => writeServiceEnvironment(file, 'bad')); fs.unlinkSync(link);
  fs.chmodSync(file, 0o644); assert.throws(() => writeServiceEnvironment(file, 'bad'));
  fs.chmodSync(file, 0o600); writeServiceEnvironment(file, 'new'); assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('VM admission respects effective CPU/memory and refuses explicit over-allocation', () => {
  assert.equal(workerBudget({ resources: { cpus: 32, memory: 32 * GiB } }).workers, 4);
  assert.equal(workerBudget({ resources: { cpus: 4, memory: 12 * GiB } }).workers, 2);
  assert.equal(workerBudget({ resources: { cpus: 8, memory: 7 * GiB } }).workers, 1);
  assert.throws(() => workerBudget({ requested: 4, resources: { cpus: 4, memory: 32 * GiB } }), /budget/);
  assert.throws(() => workerBudget({ resources: { cpus: 1, memory: 32 * GiB } }), /budget/);
  for (const value of ['0', '9', '02', '-1']) assert.throws(() => validateArgs(['e2e', '--workers', value]));
  assert.deepEqual(validateArgs(['all', '--workers', '2', '--jobs', '1']), { kind: 'all', options: ['--jobs', '1'], vmOptions: ['--workers', '2'], offline: false });
  assert.throws(() => validateArgs(['all', '--file', 'lib/a.test.mjs']));
});

test('explicit eight-worker admission preserves the default and refuses CPU/memory shortfalls', () => {
  const resources = { cpus: 32, memory: 64 * GiB };
  assert.equal(workerBudget({ resources }).workers, 4);
  const browser = workerBudget({ requested: 8, resources });
  assert.equal(browser.workers, 8);
  assert.equal(browser.cpus, 16);
  assert.equal(browser.memoryMiB, 32768);
  assert.equal(workerBudget({ requested: 8, resources: { cpus: 16, memory: 34 * GiB } }).workers, 8);
  for (const limited of [{ cpus: 15, memory: 64 * GiB }, { cpus: 32, memory: 34 * GiB - 1 }]) {
    assert.throws(() => workerBudget({ requested: 8, resources: limited }), /budget/);
  }
  assert.deepEqual(validateArgs(['all', '--workers', '8', '--jobs', '8']),
    { kind: 'all', options: ['--jobs', '8'], vmOptions: ['--workers', '8'], offline: false });
  for (const value of ['08', '8.0', '8x', '9']) assert.throws(() => validateArgs(['all', '--workers', value]));
  for (const value of [0, 9, 8.5, '8']) assert.throws(() => workerBudget({ requested: value, resources }));
});

test('core builder allocation and combined eight/eight admission include wider realization peaks', () => {
  assert.deepEqual(coreBuildBudget(), { maxJobs: 2, coresPerBuild: 4 });
  assert.deepEqual(coreBuildBudget(4), { maxJobs: 2, coresPerBuild: 4 });
  assert.deepEqual(coreBuildBudget(8), { maxJobs: 2, coresPerBuild: 8 });
  assert.deepEqual(coreBuildBudget(12), { maxJobs: 2, coresPerBuild: 12 });
  assert.deepEqual(coreBuildBudget(32), { maxJobs: 2, coresPerBuild: 12 });
  for (const value of [0, 33, 1.5, '8']) assert.throws(() => coreBuildBudget(value));
  const resources = { cpus: 32, memory: 51 * GiB };
  const browser = workerBudget({ requested: 8, resources });
  const admission = combinedBudget(resources, browser, 8);
  assert.equal(admission.cpuRequired, 32);
  assert.equal(admission.memoryRequired, 51 * GiB);
  assert.equal(admission.overlap, true);
  assert.deepEqual(admission.realization, { maxJobsPerClient: 2, coresPerBuild: 8 });
  assert.equal(combinedBudget({ ...resources, cpus: 31 }, browser, 8).overlap, false);
  assert.equal(combinedBudget({ ...resources, memory: 51 * GiB - 1 }, browser, 8).overlap, false);
  const normal = combinedBudget({ cpus: 32, memory: 64 * GiB }, workerBudget({ requested: 4, resources }), 4);
  assert.equal(normal.cpuRequired, 16);
  assert.equal(normal.memoryRequired, 27 * GiB);
  const twelveResources = { cpus: 32, memory: 43 * GiB };
  const fourBrowser = workerBudget({ requested: 4, resources: twelveResources });
  const twelve = combinedBudget(twelveResources, fourBrowser, 12);
  assert.equal(twelve.cpuRequired, 32);
  assert.equal(twelve.memoryRequired, 43 * GiB);
  assert.equal(twelve.overlap, true);
  assert.deepEqual(twelve.realization, { maxJobsPerClient: 2, coresPerBuild: 12 });
  assert.equal(combinedBudget({ ...twelveResources, cpus: 31 }, fourBrowser, 12).overlap, false);
  assert.equal(combinedBudget({ ...twelveResources, memory: 43 * GiB - 1 }, fourBrowser, 12).overlap, false);
});

test('admission uses reclaimable host MemAvailable but conservatively binds ancestor cgroup headroom/quota', () => {
  const files = { '/proc/meminfo': 'MemAvailable:   33554432 kB\n', '/proc/self/cgroup': '0::/user.slice/owned\n',
    '/sys/fs/cgroup/user.slice/cpu.max': '400000 100000', '/sys/fs/cgroup/user.slice/memory.max': String(12 * GiB),
    '/sys/fs/cgroup/user.slice/memory.current': String(3 * GiB) };
  const read = file => { if (!(file in files)) throw new Error('absent'); return files[file]; };
  const resources = availableResources({ cpus: 32, memory: GiB, read });
  assert.equal(resources.cpus, 4); assert.equal(resources.memory, 9 * GiB);
  delete files['/sys/fs/cgroup/user.slice/memory.max'];
  assert.equal(availableResources({ cpus: 32, memory: GiB, read }).memory, 32 * GiB);
});

test('combined acceptance exports/verifies once and launches core, browser then service from that same immutable source', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'all-entry-')), calls = [];
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const root = await run(['all', '--workers', '1', '--jobs', '1'], { cwd, ambient: { PATH: '/tools' }, readResources: () => ({ cpus: 8, memory: 24 * GiB }),
    command: async (program, args, options) => {
      publishFakeExport(program, args); calls.push({ program, args, sourceDigest: options.env.PI_WEB_SOURCE_DIGEST }); return 0;
    } });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(calls.map(call => call.program), ['python3', 'python3', 'nix', 'nix', 'nix']);
  assert.ok(calls[1].args.includes('--verify-manifest'));
  assert.equal(calls[2].args.find(arg => arg.includes('#test-')), `path:${root}/source#test-core`);
  assert.equal(calls[3].args.find(arg => arg.includes('#test-')), `path:${root}/source#test-e2e`);
  assert.equal(calls[4].args.find(arg => arg.includes('#test-')), `path:${root}/source#test-service`);
  assert.ok(calls.slice(2).every(call => call.sourceDigest === 'a'.repeat(64)));
});

test('guest evidence links and special entries are rejected without reading a host-only sentinel', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = path.join(root, 'guest'), sentinel = path.join(root, 'host-only');
  fs.mkdirSync(evidence); fs.writeFileSync(sentinel, 'synthetic host-only sentinel');
  fs.symlinkSync(sentinel, path.join(evidence, 'absolute-link'));
  let copied = false;
  const guardedCopy = () => { assertEvidenceTree(evidence); copied = true; };
  assert.throws(guardedCopy, /symbolic link/); assert.equal(copied, false);
  fs.unlinkSync(path.join(evidence, 'absolute-link'));
  execFileSync('mkfifo', [path.join(evidence, 'fifo')]);
  assert.throws(guardedCopy, /special entry/); assert.equal(copied, false);
  fs.unlinkSync(path.join(evidence, 'fifo')); fs.writeFileSync(path.join(evidence, 'trace.zip'), 'regular fixture');
  guardedCopy(); assert.equal(copied, true);
});

test('a listening HTTP 500 server is not a closed TCP port', async () => {
  const server = http.createServer((_, response) => { response.writeHead(500); response.end('synthetic error'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 500);
    await assert.rejects(assertPortClosed(port), /still listening/);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await assertPortClosed(port);
});

test('actual deployment cgroup observer rejects populated, malformed, foreign and unreadable observations', () => {
  const file = new URL('../nix/vm-test.py', import.meta.url).pathname;
  execFileSync('python3', ['-I', '-B', '-c', `
import ast
import re
source = ast.parse(open(${JSON.stringify(file)}).read())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ('service_cgroup', 'observe_cgroup')]
assert len(functions) == 2
namespace = {'re': re, 'node': 'pinned-node'}
exec(compile(ast.Module(body=functions, type_ignores=[]), '<actual-service-cgroup>', 'exec'), namespace)
group = '/user.slice/user-1000.slice/user@1000.service/app.slice/pi-web.service'
namespace['command'] = lambda *_, **__: 'populated 0\\nfrozen 0\\n'
assert namespace['observe_cgroup'](group) == 'empty'
namespace['command'] = lambda *_, **__: 'absent\\n'
assert namespace['observe_cgroup'](group) == 'absent'
for output in ('populated 1', 'frozen 0', 'populated 0\\npopulated 1'):
    namespace['command'] = lambda *_, **__: output
    try: namespace['observe_cgroup'](group)
    except AssertionError: pass
    else: raise AssertionError('populated/malformed cgroup was accepted')
namespace['command'] = lambda *_, **__: (_ for _ in ()).throw(OSError('unreadable'))
try: namespace['observe_cgroup'](group)
except OSError: pass
else: raise AssertionError('unreadable cgroup was accepted')
for foreign in (group + '/../pi-web.service', group + '-other', '/system.slice/pi-web.service'):
    try: namespace['observe_cgroup'](foreign)
    except AssertionError: pass
    else: raise AssertionError('foreign cgroup was accepted')
`]);
});

for (const [cpus, memoryGiB, overlap] of [[3, 16, false], [32, 64, true]]) test(`combined ${cpus}-CPU admission includes realization and ${overlap ? 'overlaps' : 'serializes'} the two checks`, async t => {
  const resources = { cpus, memory: memoryGiB * GiB };
  assert.equal(combinedBudget(resources, workerBudget({ requested: 1, resources }), 1).overlap, overlap);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'combined-budget-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let active = 0, peak = 0;
  const root = await run(['all', '--workers', '1', '--jobs', '1'], { cwd, ambient: {}, readResources: () => resources,
    command: async (program, args) => {
      publishFakeExport(program, args);
      if (program === 'nix') { peak = Math.max(peak, ++active); await new Promise(setImmediate); active--; }
      return 0;
    } });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(peak, overlap ? 2 : 1);
});

test('combined failure aborts and awaits its already-started peer instead of returning early', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'combined-failure-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let peerSettled = false, serviceStarted = false;
  await assert.rejects(run(['all', '--workers', '1', '--jobs', '1'], { cwd, ambient: {},
    readResources: () => ({ cpus: 32, memory: 64 * GiB }), command: async (program, args, options) => {
      t.after(() => fs.rmSync(options.cwd, { recursive: true, force: true }));
      publishFakeExport(program, args);
      if (program !== 'nix') return 0;
      if (args.some(arg => arg.endsWith('#test-service'))) serviceStarted = true;
      if (args.some(arg => arg.endsWith('#test-core'))) { await new Promise(setImmediate); return 9; }
      await new Promise(resolve => options.signal.addEventListener('abort', () => setImmediate(resolve), { once: true }));
      peerSettled = true; return 143;
    } }), /exited 9/);
  assert.equal(peerSettled, true);
  assert.equal(serviceStarted, false, 'an aborted browser peer cannot admit service acceptance');
});

for (const failing of ['e2e', 'service']) test(`${failing} failure awaits core and never starts service before a successful browser verdict`, async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'combined-service-failure-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let coreSettled = false, browserPassed = false, serviceStarted = false;
  await assert.rejects(run(['all', '--workers', '1', '--jobs', '1'], { cwd, ambient: {},
    readResources: () => ({ cpus: 32, memory: 64 * GiB }), command: async (program, args, options) => {
      t.after(() => fs.rmSync(options.cwd, { recursive: true, force: true }));
      publishFakeExport(program, args);
      if (program !== 'nix') return 0;
      if (args.some(arg => arg.endsWith('#test-core'))) {
        await new Promise(resolve => options.signal.addEventListener('abort', () => setImmediate(resolve), { once: true }));
        coreSettled = true; return 143;
      }
      await new Promise(setImmediate);
      if (args.some(arg => arg.endsWith('#test-e2e'))) {
        if (failing === 'e2e') return 7;
        browserPassed = true; return 0;
      }
      assert.ok(args.some(arg => arg.endsWith('#test-service')));
      assert.equal(browserPassed, true); serviceStarted = true; return 7;
    } }), /exited 7/);
  assert.equal(coreSettled, true);
  assert.equal(serviceStarted, failing === 'service');
});
