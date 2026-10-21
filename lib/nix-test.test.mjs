import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { groups, privateEnvironment, run, validateArgs } from '../nix/test.mjs';
import { environmentFile, serviceOwner, unitState } from '../e2e/service.mjs';
import { validateEvidence } from '../nix/run-vm.mjs';
import { evidenceFixture, registryFixture } from '../nix/vm-fixtures.mjs';
import { validateInventory } from '../e2e/scenarios.mjs';

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nix-test-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Nix CLI admits exact selections and no dependency-path/dev/in-place fallbacks', () => {
  assert.deepEqual(validateArgs(['core', '--file', 'plugins/session-launch/runtime.test.mjs', '--jobs', '2']),
    { kind: 'core', options: ['--file', 'plugins/session-launch/runtime.test.mjs', '--jobs', '2'], offline: false });
  assert.deepEqual(validateArgs(['e2e', '--group', 'markdown', '--offline']),
    { kind: 'e2e', options: ['--group', 'markdown'], offline: true });
  for (const args of [[], ['browser'], ['e2e', '--in-place'], ['e2e', '--group', 'unknown'],
    ['e2e', '--group', 'markdown', '--group', 'terminal'], ['core', '--jobs', '08'], ['core', '--jobs', '33'],
    ['core', '--file', 'lib/../outside.test.mjs'], ['core', '--file', '/tmp/outside.test.mjs'],
    ['core', '--file', 'lib/a.test.mjs', '--file', 'lib/a.test.mjs'], ['core', '--modules', '/tmp/modules'], ['core', '--keep-workspace']]) {
    assert.throws(() => validateArgs(args), `must refuse ${JSON.stringify(args)}`);
  }
});

test('complete VM inventory includes explicit disjoint browser owners and real terminal acceptance', () => {
  validateInventory(groups);
  assert.equal(Object.keys(groups).length, 26);
  for (const name of ['state', 'history', 'extension-dialogs', 'mobile-sidebar', 'ssh-agent']) assert.equal(groups[name].suite, 'browser');
  assert.equal(groups.general, undefined, 'no hidden aggregate repeats focused scenarios');
  assert.deepEqual(groups.terminal, { suite: 'terminal', selector: null });
});

test('fresh launcher scrubs credentials, QEMU overrides and host state; networking is a Nix realization concern', () => {
  const env = privateEnvironment('/owned', { PATH: '/tools', HOME: '/host', OPENAI_API_KEY: 'test-only',
    QEMU_OPTS: 'test-only', QEMU_NET_OPTS: 'test-only', NIX_DISK_IMAGE: '/host/disk', NODE_OPTIONS: 'test-only',
    HTTPS_PROXY: 'test-only', NIX_CONFIG: 'test-only' });
  assert.equal(env.PATH, '/tools'); assert.equal(env.HOME, '/owned/home');
  for (const name of ['OPENAI_API_KEY', 'QEMU_OPTS', 'QEMU_NET_OPTS', 'NIX_DISK_IMAGE', 'NODE_OPTIONS', 'HTTPS_PROXY', 'NIX_CONFIG']) {
    assert.equal(env[name], undefined);
  }
});

test('export and matching verification precede ordinary Nix realization, without cache inspection', async (t) => {
  const cwd = scratch(t), calls = [];
  const root = await run(['core', '--file', 'lib/example.test.mjs'], { cwd, ambient: { PATH: '/tools' },
    command: async (program, args, options) => { calls.push({ program, args, options }); return 0; } });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(calls.map(call => call.program), ['python3', 'python3', 'nix']);
  assert.ok(calls[1].args.includes('--verify-manifest'));
  assert.equal(calls[2].args[0], 'run');
  assert.ok(calls[2].args.some(arg => arg.endsWith('#test-core')));
  assert.equal(calls[2].args.includes('--offline'), false);
  assert.equal(calls[2].args.includes('derivation'), false);
  assert.equal(calls[2].options.env.HOME, path.join(root, 'home'));
});

test('failed source export stops before verification or realization, without retry', async (t) => {
  const cwd = scratch(t); let calls = 0;
  await assert.rejects(run(['e2e', '--group', 'markdown'], { cwd, ambient: {}, command: async (_, __, options) => {
    calls++;
    t.after(() => fs.rmSync(options.cwd, { recursive: true, force: true }));
    return 7;
  } }), /exited 7/);
  assert.equal(calls, 1);
});

test('VM cleanup requires complete evidence for the exact selected scope, independently of assertion success', () => {
  const { plan, receipt } = evidenceFixture('markdown');
  receipt.passed = false;
  assert.equal(validateEvidence(receipt, plan), receipt, 'failed assertions may still have complete retained evidence');
  for (const patch of [{ artifactsCollected: false }, { serviceStopped: false }, { runnersStopped: false }, { version: 1 }]) {
    assert.throws(() => validateEvidence({ ...receipt, ...patch }, plan), /evidence/);
  }
  assert.throws(() => validateEvidence(undefined, plan), /evidence/);
  const full = evidenceFixture();
  assert.equal(validateEvidence(full.receipt, full.plan).passed, true);
});

test('service environment encoding cannot inject additional assignments or shell commands', () => {
  assert.equal(environmentFile({ HOME: '/private home', VALUE: 'a"b\\c$literal' }),
    'HOME="/private home"\nVALUE="a\\"b\\\\c$literal"\n');
  for (const env of [{ 'A=B': 'bad' }, { A: 'one\nB=two' }, { A: '\0' }]) assert.throws(() => environmentFile(env));
  assert.throws(() => unitState('ActiveState=active'), /Incomplete/);
});

function fakeService(options = {}) {
  let state = { ActiveState: 'inactive', SubState: 'dead', MainPID: '0', NRestarts: '0', Result: 'success', InvocationID: '', ControlGroup: '' };
  const calls = [], writes = [];
  const lane = registryFixture().lanes[options.lane ?? 0];
  const owner = serviceOwner({ lane, command: lane.controller,
    envFile: lane.envFile, env: { HOME: `${lane.home}/f/00/home` }, logPath: '/owned/server.log',
    execute: async (_, [action]) => {
      calls.push(action);
      await options.gate?.(action, calls.length);
      if (action === 'start') state = { ...state, ActiveState: 'active', SubState: 'running', MainPID: '42',
        InvocationID: 'a'.repeat(32), ControlGroup: `/user.slice/user-${lane.uid}.slice/user@${lane.uid}.service/app.slice/pi-web.service` };
      if (action === 'stop') state = { ...state, ActiveState: 'inactive', SubState: 'dead', MainPID: '0' };
      return { stdout: action === 'logs' ? 'synthetic service log' : Object.entries(state).map(([key, value]) => `${key}=${value}`).join('\n') };
    },
    observe: () => options.cgroup ?? 'absent',
    write: (...args) => writes.push(args), writeEnv: (...args) => writes.push(args),
  });
  return { owner, calls, writes, mutate: patch => { state = { ...state, ...patch }; } };
}

test('systemd owner binds generation, awaits one stop, and certifies descendant cgroup settlement', async () => {
  const f = fakeService();
  await f.owner.start(); await f.owner.check();
  const a = f.owner.stop(), b = f.owner.stop();
  assert.equal(a, b);
  const result = await a;
  assert.equal(result.scope, 'systemd-user-service'); assert.equal(result.settled, true);
  assert.equal(result.cgroup, 'absent'); assert.equal(result.unexpectedExit, undefined);
  assert.equal(f.calls.filter(action => action === 'stop').length, 1);
  assert.ok(f.writes.some(([file]) => file === '/home/t0/service.env'));
});

for (const phase of ['status', 'start']) test(`shutdown awaits pending ${phase} acquisition and prevents late service start`, async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { entered = resolve; });
  const f = fakeService({ gate: async (action, index) => {
    if (action === phase && (phase === 'start' || index === 1)) { entered(); await gate; }
  } });
  const starting = f.owner.start();
  const rejected = assert.rejects(starting, /stopped during acquisition/);
  await pending;
  let stopped = false;
  const stopping = f.owner.stop().then(result => { stopped = true; return result; });
  await Promise.resolve();
  assert.equal(stopped, false, 'shutdown cannot certify settlement before acquisition');
  release();
  await rejected;
  const result = await stopping;
  assert.equal(f.calls.filter(action => action === 'start').length, phase === 'status' ? 0 : 1);
  assert.equal(f.calls.filter(action => action === 'stop').length, 1);
  assert.match(result.unexpectedExit, /acquisition/);
  assert.throws(() => f.owner.start(), /stopping/);
});

test('automatic service restart is a failure even when systemd currently reports active', async () => {
  const f = fakeService(); await f.owner.start();
  f.mutate({ InvocationID: 'b'.repeat(32), MainPID: '43', NRestarts: '1' });
  await assert.rejects(f.owner.check(), /generation/);
  const result = await f.owner.stop();
  assert.equal(result.settled, true, 'settlement and successful execution are distinct');
  assert.match(result.unexpectedExit, /generation/);
});

test('separate owners interleave without sharing controller, configuration or stop state', async () => {
  const a = fakeService({ lane: 0 }), b = fakeService({ lane: 1 });
  await Promise.all([a.owner.start(), b.owner.start()]);
  await a.owner.stop(); await b.owner.check();
  assert.equal(b.calls.includes('stop'), false);
  assert.ok(a.writes.some(([file]) => file === '/home/t0/service.env'));
  assert.ok(b.writes.some(([file]) => file === '/home/t1/service.env'));
  assert.equal((await b.owner.stop()).lane, 'l1');
});

test('changed cgroup fails even if PID and invocation remain unchanged', async () => {
  const f = fakeService(); await f.owner.start();
  f.mutate({ ControlGroup: '/user.slice/user-1001.slice/user@1001.service/app.slice/pi-web.service' });
  await assert.rejects(f.owner.check(), /generation/);
  assert.match((await f.owner.stop()).unexpectedExit, /generation/);
});

test('a populated or unobservable service cgroup never certifies acceptance', async () => {
  const f = fakeService({ cgroup: 'populated' }); await f.owner.start();
  const result = await f.owner.stop();
  assert.equal(result.settled, false); assert.match(result.error, /settlement/);
});
