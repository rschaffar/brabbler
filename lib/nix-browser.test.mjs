import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserPlan, requireBrowserPass, validateBrowserMetadata, validateBrowserResult, validateNamespaces } from '../nix/browser-plan.mjs';
import { browserPreparationBudget, dispatchBrowserPlan } from '../nix/run-browser.mjs';
import { coverageIds } from '../nix/vm-plan.mjs';

const prefix = `/nix/store/${'a'.repeat(32)}-pi-web`;
const tool = name => `/nix/store/${'b'.repeat(32)}-${name}/bin/${name}`;
function metadata() {
  return { version: 1, backend: 'nix-build-sandbox', source: `/nix/store/${'c'.repeat(32)}-source`,
    flakeSource: `/nix/store/${'d'.repeat(32)}-source`, package: `${prefix}/lib/node_modules/@agegr/pi-web`,
    launcher: `${prefix}/bin/pi-web`, node: tool('node'), chromium: tool('chromium'), shell: tool('bash'), tar: tool('tar'),
    fontconfig: `/nix/store/${'f'.repeat(32)}-fonts.conf`, toolPath: `${prefix}/bin` };
}
function capsule(group = 'terminal') {
  const input = metadata(), output = `/nix/store/${'e'.repeat(32)}-browser-diagnostics`;
  const expected = { group, runId: '89b793ab-6348-494a-abdb-55c1007a4071', sourceDigest: 'f'.repeat(64),
    hostNamespaces: { net: 'net:[11]', pid: 'pid:[12]', mnt: 'mnt:[13]' } };
  const result = { version: 1, backend: 'nix-build-sandbox', group, ...expected,
    package: input.package, source: input.source, flakeSource: input.flakeSource, passed: true,
    artifactsCollected: true, containmentOwner: 'nix-build', execution: { code: 0, settled: true, interrupted: false }, portClosed: true,
    fixtureRoot: '/build/pwb.ABCDEF/f', environment: { uid: 1000, interfaces: ['lo'],
      namespaces: { net: 'net:[21]', pid: 'pid:[22]', mnt: 'mnt:[23]' } },
    harness: { status: 'passed', root: input.package, resourcesSettled: true, interrupted: false, errors: [],
      fixtureRoot: '/build/pwb.ABCDEF/f', artifacts: `${output}/artifacts`,
      server: { scope: 'installed-package-process', settled: true, processGroup: 'absent', containmentOwner: 'nix-build',
        descendants: 'not-certified', settlementScope: 'Owned child/pipe closure and original POSIX group absence only; escaped descendants and Windows descendants are not certified',
        generation: { packageRoot: input.package, launcher: input.launcher, pid: 42 } } },
    coverage: { version: 1, group, status: 'passed', active: null, expected: coverageIds(group), completed: coverageIds(group) } };
  return { input, output, expected, result };
}

test('browser plan preserves all whole-group owners and exact scenario/input inventory', () => {
  const plan = browserPlan(metadata(), 'all', 4);
  assert.equal(plan.jobs.length, 26);
  assert.equal(plan.jobs.reduce((total, job) => total + job.scenarios.length, 0), 59);
  assert.equal(new Set(plan.lanes.flatMap(lane => lane.groups)).size, 26);
  assert.deepEqual(plan, browserPlan(metadata(), 'all', 4));
  assert.equal(plan.jobs.find(job => job.name === 'native-tools').weightSeconds, 10);
  assert.ok(plan.lanes.every(lane => lane.groups.length));
  assert.equal(browserPlan(metadata(), 'terminal', 1).jobs[0].suite, 'terminal');
  assert.throws(() => browserPlan(metadata(), 'unknown', 1));
  for (const workers of [0, 9, 1.5, '2']) assert.throws(() => browserPlan(metadata(), 'all', workers));
});

test('eight browser sandboxes preserve exact inventory and rendezvous before draining all groups', async () => {
  const plan = browserPlan(metadata(), 'all', 8);
  assert.deepEqual(plan, browserPlan(metadata(), 'all', 8));
  assert.equal(plan.lanes.length, 8);
  assert.equal(new Set(plan.lanes.flatMap(lane => lane.groups)).size, 26);
  assert.deepEqual(plan.jobs.map(job => job.scenarios), browserPlan(metadata(), 'all', 4).jobs.map(job => job.scenarios));
  let release, active = 0, peak = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  const running = dispatchBrowserPlan(plan, async job => {
    started.push(job.name);
    peak = Math.max(peak, ++active);
    if (started.length === 8) release();
    await gate;
    active--;
    return {};
  });
  const results = await running;
  assert.equal(peak, 8);
  assert.equal(active, 0);
  assert.equal(new Set(started).size, 26);
  assert.equal(results.length, 26);
  assert.ok(results.every(row => row.status === 'passed'));
});

test('support metadata binds the installed launcher to the exact immutable package', () => {
  assert.equal(validateBrowserMetadata(metadata()).launcher, `${prefix}/bin/pi-web`);
  for (const patch of [{ backend: 'host' }, { package: '/checkout' }, { launcher: '/usr/bin/pi-web' },
    { launcher: `${tool('other')}/pi-web` }, { source: '/tmp/source' }, { chromium: '/usr/bin/chromium' },
    { fontconfig: '/etc/fonts/fonts.conf' }, { toolPath: '/usr/bin' }, { toolPath: `${prefix}/bin:/usr/bin` }]) {
    assert.throws(() => validateBrowserMetadata({ ...metadata(), ...patch }));
  }
});

test('passing capsule binds source, nonce, exact coverage and honest process-owner evidence', () => {
  const f = capsule();
  assert.equal(requireBrowserPass(f.result, f.input, f.expected, f.output), f.result);
  for (const key of ['package', 'source', 'flakeSource', 'runId', 'sourceDigest', 'group']) {
    const result = structuredClone(f.result); result[key] = 'wrong';
    assert.throws(() => requireBrowserPass(result, f.input, f.expected, f.output), key);
  }
  for (const change of [
    r => { r.coverage.completed = []; }, r => { r.coverage.completed.push(r.coverage.completed[0]); },
    r => { r.coverage.active = 'unfinished'; }, r => { r.harness.errors.push('unexpected console error'); },
    r => { r.harness.resourcesSettled = false; }, r => { r.harness.server.scope = 'systemd-user-service'; },
    r => { r.harness.server.processGroup = 'present'; }, r => { r.harness.server.logError = 'lost log'; },
    r => { r.harness.server.unexpectedExit = true; }, r => { r.harness.server.containmentOwner = 'host'; },
    r => { r.environment.uid = 0; }, r => { r.environment.interfaces.push('eth0'); },
    r => { r.environment.namespaces.net = f.expected.hostNamespaces.net; }, r => { r.portClosed = false; },
    r => { r.execution.code = 1; }, r => { r.execution.settled = false; }, r => { r.execution.interrupted = true; },
  ]) {
    const result = structuredClone(f.result); change(result);
    assert.throws(() => requireBrowserPass(result, f.input, f.expected, f.output));
  }
});

test('namespace evidence requires all observed identities and matching namespace labels', () => {
  for (const value of [undefined, null, [], {}, { net: 'net:[1]' }, { net: 'pid:[1]', pid: 'pid:[2]', mnt: 'mnt:[3]' }]) {
    assert.throws(() => validateNamespaces(value));
  }
  assert.deepEqual(validateNamespaces({}, true), {});
  const f = capsule();
  f.result.environment.namespaces = {};
  assert.throws(() => requireBrowserPass(f.result, f.input, f.expected, f.output), /namespace identities/);
  const swapped = capsule();
  swapped.expected.hostNamespaces.net = 'pid:[11]'; swapped.result.hostNamespaces.net = 'pid:[11]';
  assert.throws(() => requireBrowserPass(swapped.result, swapped.input, swapped.expected, swapped.output));
});

test('preparation concurrency is bounded separately from the concurrent sandbox selection', () => {
  const GiB = 1024 ** 3;
  const small = browserPreparationBudget({ workers: 1, resources: { cpus: 2, memory: 6 * GiB } });
  assert.equal(small.maxJobs, 1); assert.equal(small.coresPerBuild, 2);
  assert.ok(small.memoryBytes + 2 * GiB <= 6 * GiB);
  const large = browserPreparationBudget({ workers: 4, resources: { cpus: 32, memory: 50 * GiB } });
  assert.equal(large.maxJobs, 2); assert.equal(large.coresPerBuild, 4); assert.equal(large.peakCpus, 8);
  assert.equal(browserPreparationBudget({ workers: 1, resources: { cpus: 32, memory: 50 * GiB } }).maxJobs, 1);
});

test('published failure diagnostics never become acceptance, and missing collection fails closed', () => {
  const f = capsule('session-links');
  f.result.passed = false; f.result.execution.code = 1; f.result.error = 'original assertion failed';
  assert.equal(validateBrowserResult(f.result, f.input, f.expected, f.output), f.result);
  assert.throws(() => requireBrowserPass(f.result, f.input, f.expected, f.output), /original assertion/);
  for (const change of [r => { r.artifactsCollected = false; }, r => { r.execution.settled = false; },
    r => { r.execution.interrupted = true; }, r => { r.hostNamespaces = {}; }]) {
    const result = structuredClone(f.result); change(result);
    assert.throws(() => validateBrowserResult(result, f.input, f.expected, f.output));
  }
});

test('cacheable CLI rejects failed capsules and guards the finalized tree before reading result JSON', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-browser-verdict-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'output'), metadataFile = path.join(root, 'browser.json');
  fs.mkdirSync(output, { mode: 0o700 });
  const f = capsule();
  Object.assign(f.result, { runId: '', sourceDigest: '', hostNamespaces: {} });
  f.result.harness.artifacts = path.join(output, 'artifacts');
  fs.writeFileSync(metadataFile, JSON.stringify(f.input));
  const resultFile = path.join(output, 'result.json');
  const invoke = () => spawnSync(process.execPath,
    [fileURLToPath(new URL('../nix/browser-plan.mjs', import.meta.url)), 'check', metadataFile, 'terminal', output],
    { encoding: 'utf8', timeout: 5_000 });
  fs.writeFileSync(resultFile, JSON.stringify(f.result));
  const passed = invoke();
  assert.equal(passed.error, undefined); assert.equal(passed.status, 0, passed.stderr);
  f.result.passed = false; f.result.error = 'synthetic original assertion';
  fs.writeFileSync(resultFile, JSON.stringify(f.result));
  const failed = invoke();
  assert.equal(failed.error, undefined); assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /synthetic original assertion/);
  const poison = path.join(root, 'must-not-read.json');
  fs.writeFileSync(poison, 'invalid JSON that must not be opened');
  fs.unlinkSync(resultFile); fs.symlinkSync(poison, resultFile);
  const unsafe = invoke();
  assert.equal(unsafe.error, undefined); assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /symbolic link/); assert.doesNotMatch(unsafe.stderr, /SyntaxError/);
});

test('failure closes all fresh admission but drains already started whole-group sandboxes', async () => {
  const plan = browserPlan(metadata(), 'all', 2), started = [];
  let fail, finish;
  const failure = new Promise((_, reject) => { fail = reject; });
  const active = new Promise(resolve => { finish = resolve; });
  const running = dispatchBrowserPlan(plan, async job => {
    started.push(job.name);
    return started.length === 1 ? failure : active;
  });
  assert.equal(started.length, 2);
  fail(new Error('original group verdict failed'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(started.length, 2, 'no pending group starts after failure');
  let settled = false; running.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false, 'running peer must drain');
  finish({ output: '/synthetic' });
  const results = await running;
  assert.equal(results.filter(row => row.status === 'failed').length, 1);
  assert.equal(results.filter(row => row.status === 'passed').length, 1);
  assert.equal(results.filter(row => row.status === 'not-run').length, 24);
  assert.equal(started.length, 2);
});

test('report-write failure closes admission and drains a gated peer before rejecting', async () => {
  let first, peer;
  const a = new Promise(resolve => { first = resolve; });
  const b = new Promise(resolve => { peer = resolve; });
  const original = new Error('original report persistence failed');
  let started = 0, ended = false;
  const running = dispatchBrowserPlan(browserPlan(metadata(), 'all', 2), async () => ++started === 1 ? a : b, {
    changed: rows => { if (rows.some(row => row.status === 'passed')) throw original; },
  });
  const rejected = assert.rejects(running, error => error === original).then(() => { ended = true; });
  assert.equal(started, 2);
  first({}); await Promise.resolve(); await Promise.resolve();
  assert.equal(started, 2); assert.equal(ended, false, 'persistence error must not abandon the running peer');
  peer({}); await rejected;
  assert.equal(started, 2);
});

test('an interrupted dispatcher admits no groups and never converts unstarted work to success', async () => {
  const controller = new AbortController(); controller.abort('SIGTERM');
  const results = await dispatchBrowserPlan(browserPlan(metadata(), 'all', 4), async () => { throw new Error('must not start'); }, { signal: controller.signal });
  assert.ok(results.every(row => row.status === 'not-run'));
});
