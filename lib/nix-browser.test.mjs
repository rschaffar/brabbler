import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserPlan, requireBrowserPass, validateBrowserMetadata, validateBrowserResult, validateNamespaces, validateSchedulingWeights } from '../nix/browser-plan.mjs';
import { browserPreparationBudget, dispatchBrowserPlan, coordinateBrowserRun, browserBuildArgs,
  validateBrowserDefinitions, readBrowserDefinitionFile, readBrowserDefinitions, requireBrowserOutput, requireBrowserClient,
  BROWSER_DEFINITION_MAX_BYTES } from '../nix/run-browser.mjs';
import { coverageIds } from '../nix/vm-plan.mjs';

const prefix = `/nix/store/${'a'.repeat(32)}-brabbler`;
const tool = name => `/nix/store/${'b'.repeat(32)}-${name}/bin/${name}`;
function metadata() {
  return { version: 1, backend: 'nix-build-sandbox', source: `/nix/store/${'c'.repeat(32)}-source`,
    flakeSource: `/nix/store/${'d'.repeat(32)}-source`, package: `${prefix}/lib/node_modules/brabbler`,
    launcher: `${prefix}/bin/brabbler`, node: tool('node'), chromium: tool('chromium'), shell: tool('bash'), tar: tool('tar'),
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

test('current browser planner requires a complete finite positive reviewed weight map', () => {
  const reviewed = validateSchedulingWeights();
  const missing = { ...reviewed }; delete missing.markdown;
  for (const value of [missing, { ...reviewed, obsolete: 1 }, { ...reviewed, markdown: 0 },
    { ...reviewed, markdown: Number.NaN }, { ...reviewed, markdown: Infinity }]) {
    assert.throws(() => validateSchedulingWeights(value));
  }
});

test('browser plan preserves all whole-group owners and exact scenario/input inventory', () => {
  const plan = browserPlan(metadata(), 'all', 4);
  assert.equal(plan.jobs.length, 26);
  assert.equal(plan.jobs.reduce((total, job) => total + job.scenarios.length, 0), 59);
  assert.equal(new Set(plan.lanes.flatMap(lane => lane.groups)).size, 26);
  assert.deepEqual(plan, browserPlan(metadata(), 'all', 4));
  const reviewed = validateSchedulingWeights();
  for (const job of plan.jobs) assert.equal(job.weightSeconds, reviewed[job.name], job.name);
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
  assert.equal(validateBrowserMetadata(metadata()).launcher, `${prefix}/bin/brabbler`);
  for (const patch of [{ backend: 'host' }, { package: '/checkout' }, { launcher: '/usr/bin/brabbler' },
    { launcher: `${tool('other')}/brabbler` }, { source: '/tmp/source' }, { chromium: '/usr/bin/chromium' },
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

function definitionsFixture(plan = browserPlan(metadata(), 'all', 4)) {
  const expected = { source: metadata().flakeSource, system: 'x86_64-linux',
    runId: capsule().expected.runId, sourceDigest: 'f'.repeat(64), hostNamespaces: capsule().expected.hostNamespaces,
    supportOutPath: `/nix/store/${'f'.repeat(32)}-browser-support`, selected: [...plan.selected] };
  const definitions = Object.fromEntries(plan.selected.map(name => [name, {
    drvPath: `/nix/store/${'0'.repeat(32)}-brabbler-browser-${name}-diagnostics.drv`,
    expectedOutputPath: `/nix/store/${'1'.repeat(32)}-brabbler-browser-${name}-diagnostics`, outputName: 'out',
  }]));
  const manifest = { version: 1, kind: 'fresh-capsule-definitions', backend: 'nix-build-sandbox',
    executionEvidence: false, ...structuredClone(expected), definitions };
  return { plan, expected, manifest };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function coordinatorFixture(workers = 4) {
  const f = definitionsFixture(browserPlan(metadata(), 'all', workers));
  f.report = {}; f.controller = new AbortController(); f.events = [];
  f.capabilities = {
    signal: f.controller.signal,
    save: () => { f.events.push('save'); },
    prepare: async () => { f.events.push('support'); return f.plan; },
    define: async () => { f.events.push('manifest'); return validateBrowserDefinitions(f.manifest, f.expected); },
    execute: async (job, entry) => {
      f.events.push(job.name); assert.deepEqual(entry, f.manifest.definitions[job.name]); return {};
    },
  };
  f.run = overrides => coordinateBrowserRun(f.report, { ...f.capabilities, ...overrides });
  return f;
}

// These cases exercise the REAL validator, command builder, reader and phase coordinator.
// They do not simulate Nix graph semantics, run a browser or replace verdict tests above.
test('definition validator accepts exactly selected immutable definitions, including direct empty digest', () => {
  for (const focus of ['all', 'timestamps']) {
    const f = definitionsFixture(browserPlan(metadata(), focus, 4));
    const result = validateBrowserDefinitions(f.manifest, f.expected);
    assert.equal(result, f.manifest);
    assert.deepEqual(Object.keys(result.definitions).sort(), [...f.plan.selected].sort());
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.definitions));
    assert.ok(Object.values(result.definitions).every(Object.isFrozen));
    assert.throws(() => { result.definitions[f.plan.selected[0]].outputName = 'other'; });
  }
  const f = definitionsFixture(); f.expected.sourceDigest = ''; f.manifest.sourceDigest = '';
  assert.equal(validateBrowserDefinitions(f.manifest, f.expected).sourceDigest, '');
});

const invalidDefinitions = [
  ['version', m => { m.version = 2; }],
  ['kind', m => { m.kind = 'cached-verdict'; }],
  ['backend', m => { m.backend = 'host'; }],
  ['evidence authority', m => { m.executionEvidence = true; }],
  ['extra top key', m => { m.extra = true; }],
  ['missing top key', m => { delete m.runId; }],
  ['source', m => { m.source = `/nix/store/${'2'.repeat(32)}-source`; }],
  ['system', m => { m.system = 'aarch64-linux'; }],
  ['stale nonce', m => { m.runId = '00000000-0000-0000-0000-000000000000'; }],
  ['empty nonce', m => { m.runId = ''; }],
  ['digest', m => { m.sourceDigest = '0'.repeat(64); }],
  ['support', m => { m.supportOutPath = `/nix/store/${'2'.repeat(32)}-support`; }],
  ['missing namespace', m => { delete m.hostNamespaces.mnt; }],
  ['swapped namespace label', m => { m.hostNamespaces.net = 'pid:[11]'; }],
  ['foreign namespace identity', m => { m.hostNamespaces.net = 'net:[999]'; }],
  ['extra namespace', m => { m.hostNamespaces.user = 'user:[1]'; }],
  ['selection order', m => { m.selected.reverse(); }],
  ['selection omission', m => { m.selected.pop(); }],
  ['selection duplicate', m => { m.selected.push(m.selected[0]); }],
  ['unknown selected group', m => { m.selected.push('unknown'); }],
  ['extra group', m => { m.definitions.unknown = { ...m.definitions.state }; }],
  ['missing group', m => { delete m.definitions.state; }],
  ['array group map', m => { m.definitions = []; }],
  ['entry string coercion', m => { m.definitions.state = m.definitions.state.expectedOutputPath; }],
  ['magic outPath key', m => { m.definitions.state.outPath = m.definitions.state.expectedOutputPath; }],
  ['missing output identity', m => { delete m.definitions.state.expectedOutputPath; }],
  ['wrong output name', m => { m.definitions.state.outputName = 'dev'; }],
  ['swapped group definitions', m => { [m.definitions.state, m.definitions.history] = [m.definitions.history, m.definitions.state]; }],
  ['wrong group drv', m => { m.definitions.state.drvPath = m.definitions.history.drvPath; }],
  ['wrong group output', m => { m.definitions.state.expectedOutputPath = m.definitions.history.expectedOutputPath; }],
  ['duplicate drv', m => { m.definitions.history.drvPath = m.definitions.state.drvPath; }],
  ['duplicate output', m => { m.definitions.history.expectedOutputPath = m.definitions.state.expectedOutputPath; }],
  ['support alias', m => { m.definitions.state.expectedOutputPath = m.supportOutPath; }],
  ['source alias', m => { m.definitions.state.expectedOutputPath = m.source; }],
  ['non-drv selector', m => { m.definitions.state.drvPath = m.definitions.state.expectedOutputPath; }],
  ['drv as output', m => { m.definitions.state.expectedOutputPath = m.definitions.state.drvPath; }],
  ['relative drv', m => { m.definitions.state.drvPath = 'capsule.drv'; }],
  ['foreign store', m => { m.definitions.state.drvPath = '/tmp/capsule.drv'; }],
  ['selector injection', m => { m.definitions.state.drvPath += '^out'; }],
  ['nested output', m => { m.definitions.state.expectedOutputPath += '/result'; }],
  ['traversal output', m => { m.definitions.state.expectedOutputPath += '/../other'; }],
  ['newline output', m => { m.definitions.state.expectedOutputPath += '\n'; }],
  ['invalid store hash', m => { m.definitions.state.drvPath = `/nix/store/${'e'.repeat(32)}-bad.drv`; }],
];
for (const [label, mutate] of invalidDefinitions) {
  test(`definition validator refuses ${label}`, () => {
    const f = definitionsFixture(); mutate(f.manifest);
    assert.throws(() => validateBrowserDefinitions(f.manifest, f.expected));
  });
}

test('definition bindings reject malformed caller expectations rather than normalizing them', () => {
  for (const patch of [{ runId: '' }, { runId: 'not-a-uuid' }, { sourceDigest: 'bad' }, { source: '/checkout' },
    { supportOutPath: '/tmp/support' }, { system: 'other' }, { selected: [] }, { selected: ['unknown'] },
    { selected: ['state', 'state'] }, { selected: [['state']] }, { hostNamespaces: {} },
    { hostNamespaces: { net: 'pid:[1]', pid: 'pid:[2]', mnt: 'mnt:[3]' } }]) {
    const f = definitionsFixture();
    assert.throws(() => validateBrowserDefinitions(f.manifest, { ...f.expected, ...patch }));
  }
});

test('real argument builder preserves support flags and builds one selected manifest then only exact drv output', () => {
  const f = definitionsFixture(browserPlan(metadata(), 'timestamps', 4));
  const build = { source: f.expected.source, system: f.expected.system, offline: true,
    preparationBudget: { maxJobs: 2, coresPerBuild: 4 } };
  const base = ['build', '--extra-experimental-features', 'nix-command flakes', '--store', 'daemon', '--no-write-lock-file',
    '--option', 'accept-flake-config', 'false', '--option', 'sandbox', 'true', '--impure', '--keep-failed', '-L', '--offline'];
  const support = browserBuildArgs(build, { mode: 'support', outLink: '/private/support' });
  assert.deepEqual(support, [...base, '--file', `${build.source}/nix/fresh-browser.nix`, '--argstr', 'system', build.system,
    '--max-jobs', '2', '--cores', '4', '--out-link', '/private/support']);
  const manifest = browserBuildArgs(build, { mode: 'definitions', outLink: '/private/definitions', bindings: f.expected });
  assert.deepEqual(manifest, [...support.slice(0, -1), '/private/definitions',
    '--argstr', 'definitionGroups', '["timestamps"]', '--argstr', 'runId', f.expected.runId,
    '--argstr', 'sourceDigest', f.expected.sourceDigest, '--argstr', 'hostNamespaces', JSON.stringify(f.expected.hostNamespaces)]);
  const entry = f.manifest.definitions.timestamps;
  const direct = browserBuildArgs(build, { mode: 'capsule', outLink: '/private/result', definition: entry });
  assert.deepEqual(direct, [...base, '--max-jobs', '1', '--cores', '2', '--out-link', '/private/result', `${entry.drvPath}^out`]);
  for (const flag of ['--file', '--argstr', '--arg', '--expr']) assert.ok(!direct.includes(flag));
  assert.ok(!direct.includes(build.source));
  assert.ok(!browserBuildArgs({ ...build, offline: false }, { mode: 'support', outLink: '/private/support' }).includes('--offline'));
});

test('real argument builder rejects unsafe paths, missing fresh bindings and unknown modes', () => {
  const f = definitionsFixture(), build = { source: f.expected.source, system: f.expected.system,
    preparationBudget: { maxJobs: 2, coresPerBuild: 4 } };
  const options = { mode: 'definitions', outLink: '/private/definitions', bindings: f.expected };
  for (const patch of [{ mode: 'batch' }, { outLink: 'relative' }, { outLink: '/tmp/a\0b' },
    { bindings: { ...f.expected, source: `/nix/store/${'2'.repeat(32)}-source` } },
    { bindings: { ...f.expected, system: 'aarch64-linux' } }, { bindings: { ...f.expected, runId: '' } },
    { bindings: { ...f.expected, selected: ['state', 'state'] } },
    { bindings: { ...f.expected, hostNamespaces: {} } }]) {
    assert.throws(() => browserBuildArgs(build, { ...options, ...patch }));
  }
  for (const definition of [{ ...f.manifest.definitions.state, outputName: 'dev' },
    { ...f.manifest.definitions.state, drvPath: '/tmp/native.drv' },
    { ...f.manifest.definitions.state, expectedOutputPath: '/tmp/native' }]) {
    assert.throws(() => browserBuildArgs(build, { mode: 'capsule', outLink: '/private/result', definition }));
  }
  for (const patch of [{ source: '/checkout' }, { system: 'darwin' }, { preparationBudget: { maxJobs: 0, coresPerBuild: 4 } }]) {
    assert.throws(() => browserBuildArgs({ ...build, ...patch }, options));
  }
});

function manifestFile(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-browser-definition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'manifest.json');
  fs.writeFileSync(file, text, { mode: 0o400 });
  return { root, file };
}
test('real bounded file reader records digest and accepts only an immutable physical regular file', t => {
  const f = definitionsFixture(), text = JSON.stringify(f.manifest), { file } = manifestFile(t, text);
  const receipt = readBrowserDefinitionFile(file, f.expected);
  assert.deepEqual(receipt.manifest, f.manifest); assert.equal(receipt.file, file);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  fs.chmodSync(file, 0o600);
  assert.throws(() => readBrowserDefinitionFile(file, f.expected), /immutable/);
});
test('real file reader refuses empty, malformed, oversize, noncanonical, duplicate-key and stale JSON', t => {
  const f = definitionsFixture(), valid = JSON.stringify(f.manifest);
  const stale = structuredClone(f.manifest); stale.runId = '00000000-0000-0000-0000-000000000000';
  for (const text of ['', '{', 'x'.repeat(BROWSER_DEFINITION_MAX_BYTES + 1), `${valid}\n`,
    valid.replace('"version":1', '"version":1,"version":1'),
    valid.replace('"definitions":{', '"definitions":{"state":{},'), JSON.stringify(stale), Buffer.from([0xff])]) {
    const { file } = manifestFile(t, text);
    assert.throws(() => readBrowserDefinitionFile(file, f.expected));
  }
});
test('real file reader refuses symlink, directory, special file, symlink parent and non-store publication', t => {
  const f = definitionsFixture(), { file, root } = manifestFile(t, JSON.stringify(f.manifest));
  const link = path.join(root, 'link'); fs.symlinkSync(file, link);
  const parent = path.join(root, 'parent'); fs.symlinkSync(root, parent);
  for (const candidate of [link, root, '/dev/null', path.join(parent, 'manifest.json')]) {
    assert.throws(() => readBrowserDefinitionFile(candidate, f.expected));
  }
  assert.throws(() => readBrowserDefinitions(root, f.expected), /out-link/);
  assert.throws(() => readBrowserDefinitions(link, f.expected), /store path/);
  assert.throws(() => readBrowserDefinitions(path.join(root, 'absent'), f.expected));
});

test('physical capsule output must equal manifest identity in addition to the ordinary strict verdict', () => {
  const f = definitionsFixture(), entry = f.manifest.definitions.state;
  assert.equal(requireBrowserOutput(entry.expectedOutputPath, entry), entry.expectedOutputPath);
  for (const output of ['/tmp/foreign', entry.drvPath, `/nix/store/${'2'.repeat(32)}-other`]) {
    assert.throws(() => requireBrowserOutput(output, entry));
  }
});

test('production coordinator gates all admission on support and complete validated manifest, retaining lane order', async () => {
  const f = coordinatorFixture(), support = deferred(), manifest = deferred(), reached = deferred();
  const started = [], activeLanes = new Set();
  const running = f.run({
    prepare: async () => { f.events.push('support'); await support.promise; return f.plan; },
    define: async () => { reached.resolve(); await manifest.promise; return validateBrowserDefinitions(f.manifest, f.expected); },
    execute: async (job, definition) => {
      assert.equal(definition, f.manifest.definitions[job.name]);
      assert.ok(!activeLanes.has(job.lane)); activeLanes.add(job.lane);
      started.push(job.name); await Promise.resolve(); activeLanes.delete(job.lane); return {};
    },
  });
  assert.deepEqual(started, []); assert.deepEqual(f.events, ['save', 'support']);
  support.resolve(); await reached.promise; assert.deepEqual(started, []);
  manifest.resolve(); await running;
  assert.equal(f.report.status, 'passed'); assert.equal(started.length, 26);
  for (const lane of f.plan.lanes) assert.deepEqual(started.filter(name => lane.groups.includes(name)), lane.groups);
  assert.deepEqual(f.report.groups.map(row => row.name), f.plan.jobs.map(job => job.name), 'report rows stay declaration-indexed');
  assert.ok(f.report.groups.every(row => row.status === 'passed'));
});

test('production coordinator refuses support/manifest failure and malformed manifest before any native admission', async () => {
  for (const phase of ['support', 'manifest', 'invalid']) {
    const f = coordinatorFixture(), error = new Error(`original ${phase} failure`);
    let started = 0, defined = 0;
    const running = f.run({
      prepare: async () => { if (phase === 'support') throw error; return f.plan; },
      define: async () => {
        defined++;
        if (phase === 'manifest') throw error;
        f.manifest.definitions.state.outputName = 'dev';
        return validateBrowserDefinitions(f.manifest, f.expected);
      },
      execute: async () => { started++; return {}; },
    });
    await assert.rejects(running, phase === 'invalid' ? undefined : cause => cause === error);
    assert.equal(started, 0); assert.equal(defined, phase === 'support' ? 0 : 1);
    assert.notEqual(f.report.status, 'passed');
  }
});

test('production client gate rejects failed, unsettled and interrupted preflight executions before admission', async () => {
  const success = { code: 0, settled: true, interrupted: false };
  assert.equal(requireBrowserClient(success, 'must pass'), success);
  for (const execution of [undefined, { ...success, code: 1 }, { ...success, code: null },
    { ...success, settled: false }, { ...success, interrupted: true }]) {
    for (const phase of ['support', 'manifest']) {
      const f = coordinatorFixture(); let started = 0;
      await assert.rejects(f.run({
        prepare: async () => { if (phase === 'support') requireBrowserClient(execution, 'preflight failed'); return f.plan; },
        define: async () => { requireBrowserClient(execution, 'preflight failed'); return validateBrowserDefinitions(f.manifest, f.expected); },
        execute: async () => { started++; return {}; },
      }), /preflight failed/);
      assert.equal(started, 0);
    }
  }
});

test('production coordinator abort before phases or after support/definition prevents all admission', async () => {
  for (const boundary of ['initial', 'support', 'manifest']) {
    const f = coordinatorFixture(); let prepared = 0, defined = 0, started = 0;
    if (boundary === 'initial') f.controller.abort('SIGTERM');
    await assert.rejects(f.run({
      prepare: async () => { prepared++; if (boundary === 'support') f.controller.abort('SIGTERM'); return f.plan; },
      define: async () => { defined++; f.controller.abort('SIGTERM'); return validateBrowserDefinitions(f.manifest, f.expected); },
      execute: async () => { started++; return {}; },
    }), /interrupted/);
    assert.equal(prepared, boundary === 'initial' ? 0 : 1);
    assert.equal(defined, boundary === 'manifest' ? 1 : 0); assert.equal(started, 0);
  }
});

test('production coordinator joins an in-flight support or manifest on abort before rejecting', async () => {
  for (const phase of ['support', 'manifest']) {
    const f = coordinatorFixture(), gate = deferred(), entered = deferred(); let ended = false, started = 0;
    const operation = async value => { entered.resolve(); await gate.promise; return value; };
    const running = f.run({
      prepare: () => phase === 'support' ? operation(f.plan) : Promise.resolve(f.plan),
      define: () => operation(validateBrowserDefinitions(f.manifest, f.expected)),
      execute: async () => { started++; return {}; },
    });
    const rejected = assert.rejects(running, /interrupted/).then(() => { ended = true; });
    await entered.promise; f.controller.abort('SIGTERM'); await Promise.resolve();
    assert.equal(ended, false); assert.equal(started, 0);
    gate.resolve(); await rejected; assert.equal(started, 0);
  }
});

test('production coordinator initial and preflight persistence failures never start native jobs', async () => {
  for (const failureWrite of [1, 2, 3, 4]) {
    const f = coordinatorFixture(), original = new Error(`original write ${failureWrite}`);
    let writes = 0, prepared = 0, defined = 0, started = 0;
    await assert.rejects(f.run({
      save: () => { if (++writes === failureWrite) throw original; },
      prepare: async () => { prepared++; return f.plan; },
      define: async () => { defined++; return validateBrowserDefinitions(f.manifest, f.expected); },
      execute: async () => { started++; return {}; },
    }), error => error === original);
    assert.equal(started, 0);
    assert.equal(prepared, failureWrite === 1 ? 0 : 1);
    assert.equal(defined, failureWrite <= 2 ? 0 : 1);
  }
});

test('production coordinator persistence failure at running/passed/failed transitions drains started peers', async () => {
  for (const transition of ['running', 'passed', 'failed']) {
    const f = coordinatorFixture(2), peer = deferred(), observed = deferred();
    const original = new Error(`original ${transition} write failure`), verdict = new Error('original native failure');
    let started = 0, ended = false;
    const running = f.run({
      execute: async () => {
        started++;
        if (transition === 'running' || started === 2) return peer.promise;
        if (transition === 'failed') throw verdict;
        return {};
      },
      save: () => {
        const rows = f.report.groups ?? [];
        if ((transition === 'running' && rows.filter(row => row.status === 'running').length === 2) ||
          (transition !== 'running' && rows.some(row => row.status === transition))) {
          observed.resolve(); throw original;
        }
      },
    });
    const rejected = assert.rejects(running, error => error === original).then(() => { ended = true; });
    await observed.promise; await Promise.resolve();
    assert.equal(ended, false, 'started peer must remain owned until it drains');
    assert.equal(started, transition === 'running' ? 1 : 2);
    peer.resolve({}); await rejected;
    assert.equal(started, transition === 'running' ? 1 : 2);
    if (transition === 'failed') assert.ok(f.report.groups.some(row => row.error === verdict.message));
    assert.ok(f.report.groups.some(row => row.status === 'not-run'));
  }
});

test('production coordinator native verdict failure closes admission without manifest fallback and drains peers', async () => {
  const f = coordinatorFixture(2), failure = deferred(), peer = deferred(), entered = deferred();
  let started = 0, definitions = 0, ended = false;
  const running = f.run({
    define: async () => { definitions++; return validateBrowserDefinitions(f.manifest, f.expected); },
    execute: () => { if (++started === 2) entered.resolve(); return started === 1 ? failure.promise : peer.promise; },
  });
  running.then(() => { ended = true; });
  await entered.promise; failure.reject(new Error('native verdict failed'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ended, false); assert.equal(started, 2);
  peer.resolve({}); await running;
  assert.equal(definitions, 1); assert.equal(started, 2); assert.equal(f.report.status, 'failed');
  assert.equal(f.report.groups.filter(row => row.status === 'not-run').length, 24);
});

test('production coordinator abort during lanes joins every started peer and admits no later group', async () => {
  const f = coordinatorFixture(2), peer = deferred(), entered = deferred(); let started = 0, ended = false;
  const running = f.run({ execute: () => { if (++started === 2) entered.resolve(); return peer.promise; } });
  running.then(() => { ended = true; });
  await entered.promise; f.controller.abort('SIGTERM'); await Promise.resolve();
  assert.equal(ended, false); assert.equal(started, 2);
  peer.resolve({}); await running;
  assert.equal(f.report.status, 'failed'); assert.equal(started, 2);
  assert.equal(f.report.groups.filter(row => row.status === 'not-run').length, 24);
});
