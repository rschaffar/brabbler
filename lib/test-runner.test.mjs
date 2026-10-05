import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { Writable } from 'node:stream';
import test from 'node:test';
import {
  ROOTS, createOwnedTracker, createWorkspace, discover, nodeArgs, parseArgs, parseTap, planFiles,
  privateEnvironment, processIdentity, removeWorkspace, resourceProfile, runSuite,
  schedule, signalOwnedGroup, reportResults, DIAGNOSTIC_LOG_BYTES,
} from '../nix/test-runner.mjs';

const runner = fileURLToPath(new URL('../nix/test-runner.mjs', import.meta.url));
const review = (name, lane = 'N') => ({ path: name, lane, reason: 'Tiny scheduler-mechanics fixture, not native proof' });
const resources = resourceProfile({ requested: 2, cpus: 2, memory: 8 * 1024 ** 3, cores: '2' });
function put(root, relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text);
  return file;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-contract-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, 'artifacts');
  const gitBin = path.join(root, 'bin');
  fs.mkdirSync(artifacts, { mode: 0o700 });
  fs.mkdirSync(gitBin, { mode: 0o700 });
  // ONLY a runner validation stand-in; no fixture ever executes Git. No native/forwarder claim.
  fs.symlinkSync(process.execPath, path.join(gitBin, 'git'));
  const options = { root, artifacts, gitBin, toolPath: [path.dirname(process.execPath)], resources };
  return { ...options, manifest: (files) => put(root, 'nix/test-lanes.json', JSON.stringify({ version: 1, files })) };
}
function cleanupRetained(summary) {
  // Tests own these tiny fixtures, and call this only after asserting no survivors/uncertainty.
  for (const result of summary.results) {
    if (result.workspace && !result.workspaceRemoved && !result.uncertain && !result.survivors?.length) {
      fs.rmSync(result.workspace, { recursive: true, force: true });
    }
  }
}
const tiny = `import test from 'node:test'; test('tiny', () => {});\n`;

// Linux/Node22 is the shared CLI contract. The original npm glob still includes this file.
test('discovery is the exact sorted five-root suffix union, not bare Node discovery', (t) => {
  const f = fixture(t);
  for (const root of ROOTS) put(f.root, `${root}/nested/z.test.mjs`, tiny);
  put(f.root, 'lib/a.test.mjs', tiny);
  put(f.root, 'lib/fixtures/included.test.mjs', tiny);
  put(f.root, 'lib/__fixtures__/included.test.mjs', tiny);
  for (const name of ['lib/helper.fixture.mjs', 'lib/node_modules/hidden.test.mjs', 'e2e/outside.test.mjs',
    'nix/outside.test.mjs', 'lib/uppercase.TEST.mjs']) put(f.root, name, tiny);
  const inventory = discover(f.root);
  assert.deepEqual(inventory.map((f) => f.path), [
    'app/nested/z.test.mjs', 'components/nested/z.test.mjs', 'hooks/nested/z.test.mjs',
    'lib/__fixtures__/included.test.mjs', 'lib/a.test.mjs', 'lib/fixtures/included.test.mjs',
    'lib/nested/z.test.mjs', 'public/nested/z.test.mjs',
  ]);
  assert.ok(inventory.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)));
  fs.symlinkSync(path.join(f.root, 'lib/a.test.mjs'), path.join(f.root, 'lib/escape.test.mjs'));
  assert.throws(() => discover(f.root), /symlink/);
});

test('manifest rejects stale/duplicate paths; new files remain exclusive and selected exactly once', () => {
  const inventory = ['lib/a.test.mjs', 'lib/new.test.mjs'].map((path) => ({ path, sha256: 'fixture' }));
  const manifest = { version: 1, files: [review(inventory[0].path)] };
  const plan = planFiles(inventory, manifest);
  assert.deepEqual(plan.map((f) => f.lane), ['N', 'E']);
  assert.match(plan[1].reason, /UNREVIEWED.*included/);
  assert.equal(plan[1].reviewed, false);
  assert.deepEqual(planFiles(inventory, manifest, [inventory[1].path]), [plan[1]]);
  assert.throws(() => planFiles(inventory, { ...manifest, files: [review('lib/stale.test.mjs')] }), /Stale/);
  assert.throws(() => planFiles(inventory, { ...manifest, files: [...manifest.files, ...manifest.files] }), /Duplicate/);
  assert.throws(() => planFiles(inventory, manifest, ['lib/a.test.mjs', 'lib/a.test.mjs']), /Duplicate/);
  assert.throws(() => planFiles(inventory, manifest, ['../outside.test.mjs']), /Unknown/);
  assert.throws(() => planFiles([...inventory, inventory[0]], manifest), /Duplicate/);
});

test('checked-in manifest covers the surviving discovered union once', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nix/test-lanes.json'), 'utf8'));
  const inventory = discover(root);
  const plan = planFiles(inventory, manifest);
  assert.deepEqual(plan.map((f) => f.path), inventory.map((f) => f.path));
  for (const name of ['terminal-manager', 'test-runner']) {
    assert.equal(plan.find((f) => f.path === `lib/${name}.test.mjs`)?.lane, 'E');
  }
});

test('all Node options precede one original absolute file; CLI admits no shell/options tail', () => {
  const args = nodeArgs('/repo/lib/original.test.mjs');
  assert.deepEqual(args, ['--experimental-strip-types', '--test', '--test-concurrency=1',
    '--test-reporter=tap', '/repo/lib/original.test.mjs']);
  assert.throws(() => nodeArgs('--test-concurrency=2'), /absolute/);
  const base = ['--root', '/repo', '--artifacts', '/tmp/artifacts', '--git-bin', '/pinned/bin', '--tool-path', '/node/bin'];
  assert.equal(parseArgs(base).jobs, 8);
  for (const jobs of [1, 2, 8, 32]) assert.equal(parseArgs([...base, '--jobs', String(jobs)]).jobs, jobs);
  for (const extra of [['--jobs', '0'], ['--jobs', '33'], ['--jobs', '1.5'], ['--jobs', '08'],
    ['--jobs', '2', '--jobs', '1'], ['--eval', 'code'],
    ['--file', '--test-concurrency=2'], ['lib/a.test.mjs'], ['--retry', '1']]) {
    assert.throws(() => parseArgs([...base, ...extra]));
  }
});

test('CPU/Nix/memory clamp without claiming machine exclusivity', () => {
  assert.equal(resources.effective, 2);
  assert.equal(resourceProfile({ requested: 2, cores: '1', cpus: 8, memory: 16 * 1024 ** 3 }).effective, 1);
  assert.equal(resourceProfile({ requested: 2, cores: '0', cpus: 1, memory: 16 * 1024 ** 3 }).effective, 1);
  assert.equal(resourceProfile({ requested: 2, cpus: 8, memory: 4 * 1024 ** 3 }).effective, 1);
  assert.equal(resourceProfile({ requested: 2, cpus: 8, memory: 2 * 1024 ** 3 }).effective, 0);
  assert.equal(resourceProfile({ cpus: 32, cores: '0', memory: 64 * 1024 ** 3 }).effective, 8);
  assert.equal(resourceProfile({ requested: 32, cpus: 32, cores: '32', memory: 80 * 1024 ** 3 }).effective, 32);
  assert.equal(resourceProfile({ requested: 8, cpus: 32, cores: '2', memory: 64 * 1024 ** 3 }).effective, 2);
  assert.equal(resourceProfile({ requested: 8, cpus: 4, cores: '32', memory: 64 * 1024 ** 3 }).effective, 4);
  assert.equal(resourceProfile({ requested: 8, cpus: 32, cores: '32', memory: 7 * 1024 ** 3 }).effective, 3);
  for (const requested of [0, 33, 1.5]) assert.throws(() => resourceProfile({ requested }), /1 to 32/);
  assert.throws(() => resourceProfile({ cores: 'invalid' }), /NIX_BUILD_CORES/);
});

test('private env is distinct and never spreads ambient sentinel secrets or live directories', (t) => {
  const a = createWorkspace(), b = createWorkspace();
  t.after(() => { for (const w of [a, b]) fs.rmSync(w.directory, { recursive: true, force: true }); });
  const keys = ['NODE_OPTIONS', 'HTTPS_PROXY', 'DBUS_SESSION_BUS_ADDRESS', 'OPENAI_API_KEY', 'PI_SENTINEL_SECRET'];
  const saved = keys.map((key) => [key, process.env[key]]);
  try {
    for (const key of keys) process.env[key] = 'runner-only-sentinel-do-not-inherit';
    const opts = { gitBin: '/pinned/forwarder/bin', toolPath: ['/pinned/node/bin'] };
    const envA = privateEnvironment(a.directory, opts), envB = privateEnvironment(b.directory, opts);
    assert.equal(JSON.stringify(envA).includes('runner-only-sentinel-do-not-inherit'), false);
    assert.equal(envA.PATH, '/pinned/forwarder/bin:/pinned/node/bin');
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
      'XDG_RUNTIME_DIR', 'PI_CODING_AGENT_DIR', 'TMPDIR']) {
      assert.notEqual(envA[key], envB[key]);
      assert.equal(fs.statSync(envA[key]).mode & 0o777, 0o700);
      assert.ok(envA[key].startsWith(a.directory + '/'));
    }
    for (const key of keys) assert.equal(Object.hasOwn(envA, key), false);
    assert.equal(envA.PI_OFFLINE, '1'); assert.equal(envA.JITI_FS_CACHE, '0'); assert.equal(envA.LC_ALL, 'C');
  } finally {
    for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('TAP counts use only the final parent footer; nested case names are qualified', () => {
  const text = 'TAP version 13\n# # tests 900\n# # pass 900\n# Subtest: parent\n    # Subtest: child\n' +
    '    ok 1 - child\nok 1 - parent\n1..1\n# tests 2\n# suites 0\n# pass 2\n# fail 0\n' +
    '# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 3.1\n';
  assert.deepEqual(parseTap(text).cases, ['parent', 'parent > child']);
  assert.equal(parseTap(text).counts.tests, 2);
  assert.equal(parseTap('load error\n# tests 0\n').counts, null);
});

test('owned observations survive unreadable final metadata; unrelated refusals and vanished/reused PIDs stay neutral', (t) => {
  const original = { pid: 123, ppid: process.pid, group: 123, session: 123, start: '10', state: 'S' };
  const descendant = { pid: 124, ppid: 123, group: 123, session: 123, start: '11', state: 'S' };
  for (const final of ['EACCES', 'ENOENT', 'reused', 'live-escaped']) {
    let active = true;
    const denied = () => { throw Object.assign(new Error('metadata refused'), { code: 'EACCES' }); };
    const tracker = createOwnedTracker(original, {
      readIdentity: (pid) => {
        if (pid === 999) return denied(); // Unknown/unrelated: always nonblocking.
        if (active) return pid === 123 ? original : pid === 124 ? descendant : null;
        if (pid === 123) return null;
        if (final === 'EACCES') return denied();
        if (final === 'ENOENT') throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        if (final === 'reused') return { ...descendant, start: '99', session: 999, group: 999, ppid: 1 };
        return { ...descendant, session: 124, group: 124, ppid: 1 }; // Observed before its escape.
      },
      readChildren: (pid) => pid === 123 ? [124] : [],
      listPids: () => [123, 124, 999],
    });
    tracker.sample(); // Capture original descendant identity while association is live.
    active = false;
    tracker.sample(); // An intermediate refusal must not discard the previously owned identity.
    const audit = tracker.settle();
    assert.equal(audit.observedIdentities, 2);
    assert.equal(audit.uncertain, final === 'EACCES');
    assert.equal(audit.survivors.length, final === 'live-escaped' ? 1 : 0);
    if (final === 'EACCES') {
      assert.deepEqual(audit.unreadableOwned, [{ pid: 124, start: '11', code: 'EACCES' }]);
      const workspace = createWorkspace();
      t.after(() => fs.rmSync(workspace.directory, { recursive: true, force: true }));
      assert.equal(removeWorkspace(workspace, { settled: true, success: true, interrupted: false,
        survivors: audit.uncertain || audit.survivors.length > 0 }), false);
      assert.ok(fs.existsSync(workspace.directory));
    }
    if (final === 'reused') {
      const signals = [];
      assert.equal(signalOwnedGroup(original, 'SIGTERM', () => ({ ...original, start: '99' }), (...args) => signals.push(args)), false);
      assert.deepEqual(signals, []);
    }
  }
});

test('final PID enumeration uses names, tolerates vanished entries, and retains directory/scan refusals', () => {
  // Runner-mechanics fixture only: these injected identities are not native evidence.
  const original = { pid: 123, ppid: process.pid, group: 123, session: 123, start: '10', state: 'R' };
  const survivor = { ...original, pid: 125, ppid: 1, start: '12' };
  const readdir = fs.readdirSync;
  const opendir = fs.opendirSync;
  try {
    fs.opendirSync = () => { throw Object.assign(new Error("vanished Dirent lstat '/proc/124'"), { code: 'ENOENT' }); };
    fs.readdirSync = (directory, options) => {
      assert.equal(directory, '/proc');
      assert.equal(options?.withFileTypes, undefined);
      return ['self', '123', '124', '125'];
    };
    const tracker = createOwnedTracker(original, {
      readIdentity: (pid) => {
        if (pid === 124) throw Object.assign(new Error('PID exited'), { code: 'ENOENT' });
        return pid === 125 ? survivor : null;
      },
      readChildren: () => [],
    });
    const audit = tracker.settle();
    assert.equal(audit.uncertain, false);
    assert.equal(audit.sessionScanError, undefined);
    assert.deepEqual(audit.survivors, [survivor]);

    fs.readdirSync = () => { throw Object.assign(new Error('proc directory denied'), { code: 'EACCES' }); };
    const denied = tracker.settle();
    assert.equal(denied.uncertain, true);
    assert.deepEqual(denied.sessionScanError, { code: 'EACCES', message: 'proc directory denied' });
    assert.deepEqual(denied.survivors, [survivor]);

    fs.readdirSync = () => Array.from({ length: 16385 }, (_, i) => String(i + 1));
    const limited = createOwnedTracker(original, { readIdentity: () => null, readChildren: () => [] }).settle();
    assert.equal(limited.uncertain, true);
    assert.equal(limited.sessionScanLimited, true);
  } finally {
    fs.readdirSync = readdir;
    fs.opendirSync = opendir;
  }
});

test('final session enumeration failure remains uncertain and exposes the original metadata error', () => {
  const original = { pid: 123, ppid: process.pid, group: 123, session: 123, start: '10', state: 'S' };
  const tracker = createOwnedTracker(original, {
    readIdentity: () => null,
    readChildren: () => [],
    listPids: function* () {
      throw Object.assign(new Error('proc enumeration failed'), { code: 'EIO' });
    },
  });
  const audit = tracker.settle();
  assert.equal(audit.uncertain, true);
  assert.deepEqual(audit.survivors, []);
  assert.equal(audit.observationLimited, false);
  assert.equal(audit.sessionScanLimited, false);
  assert.deepEqual(audit.sessionScanError, { code: 'EIO', message: 'proc enumeration failed' });
});

test('custom outer TMPDIR retains failed workspaces; successful cleanup removes only its owned child', (t) => {
  const f = fixture(t);
  const base = path.join(f.root, 't');
  fs.mkdirSync(base, { mode: 0o700 });
  const previous = process.env.TMPDIR;
  try {
    process.env.TMPDIR = base;
    const failed = createWorkspace(), passed = createWorkspace();
    for (const workspace of [failed, passed]) {
      assert.equal(path.dirname(workspace.directory), base);
      assert.match(path.basename(workspace.directory), /^pitr-/);
      assert.equal(fs.statSync(workspace.directory).mode & 0o777, 0o700);
    }
    const settled = { settled: true, success: true, interrupted: false, survivors: false };
    assert.equal(removeWorkspace(failed, { ...settled, success: false }), false);
    assert.equal(removeWorkspace({ directory: passed.directory }, settled), false);
    assert.equal(removeWorkspace(passed, settled), true);
    assert.equal(fs.existsSync(passed.directory), false);
    assert.ok(fs.existsSync(failed.directory));
    assert.ok(fs.existsSync(base), 'caller-owned temporary/build root is never removed');
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
});

test('cleanup needs the original owned directory and truthful settled/success/no-survivor state', (t) => {
  const w = createWorkspace();
  t.after(() => fs.rmSync(w.directory, { recursive: true, force: true }));
  const safe = { settled: true, success: true, interrupted: false, survivors: false };
  for (const state of [{ ...safe, settled: false }, { ...safe, success: false },
    { ...safe, interrupted: true }, { ...safe, survivors: true }, { ...safe, survivors: undefined }]) {
    assert.equal(removeWorkspace(w, state), false);
  }
  assert.equal(removeWorkspace({ directory: w.directory }, safe), false);
  const moved = `${w.directory}-original`;
  fs.renameSync(w.directory, moved);
  fs.mkdirSync(w.directory, { mode: 0o700 });
  assert.equal(removeWorkspace(w, safe), false, 'replacement inode is not ours');
  fs.rmdirSync(w.directory); fs.renameSync(moved, w.directory);
  assert.equal(removeWorkspace(w, safe), true);
  assert.equal(removeWorkspace(w, safe), false);
});

test('signal only an original live child session/group, never foreign/reused PID or a web cgroup', () => {
  const original = { pid: 123, ppid: process.pid, group: 123, session: 123, start: '456', state: 'S' };
  const signals = [];
  const kill = (...args) => signals.push(args);
  assert.equal(signalOwnedGroup(original, 'SIGTERM', () => original, kill), true);
  assert.deepEqual(signals, [[-123, 'SIGTERM']]);
  for (const now of [null, { ...original, start: '789' }, { ...original, ppid: 1 },
    { ...original, group: 9 }, { ...original, session: 9 }, { ...original, state: 'Z' }]) {
    assert.equal(signalOwnedGroup(original, 'SIGINT', () => now, kill), false);
  }
  assert.equal(signalOwnedGroup(original, 'SIGKILL', () => original, kill), false);
  assert.equal(signals.length, 1);
});

for (const jobs of [2, 8]) test(`${jobs}-worker fail-stop settles started work and accounts for every planned file`, async () => {
  const plan = [...Array.from({ length: jobs + 1 }, (_, i) => review(`n${i}`)), review('exclusive', 'E')];
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const starts = [];
  const pending = schedule(plan, { jobs, run: async (file) => {
    starts.push(file.path);
    if (file.path === 'n0') return { success: false, status: 'failed' };
    await gate; return { success: true, status: 'passed' };
  } });
  await Promise.resolve();
  finish();
  const results = await pending;
  assert.deepEqual(starts, plan.slice(0, jobs).map((f) => f.path));
  assert.deepEqual(results.map((r) => r.status), ['failed', ...Array(jobs - 1).fill('passed'), 'not_started', 'not_started']);
  assert.equal(new Set(results.map((r) => r.path)).size, plan.length);
  await assert.rejects(schedule([], { jobs: 33 }), /Invalid pool size/);
  assert.deepEqual(await schedule([], { jobs: 32 }), []);
});

for (const jobs of [2, 8]) test(`${jobs} real pooled file workers rendezvous, with an exclusive barrier and effective inner argv`, { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const pair = Array.from({ length: jobs }, (_, i) => String.fromCharCode(97 + i));
  const previousSentinel = process.env.PI_RUNNER_SECRET_SENTINEL;
  process.env.PI_RUNNER_SECRET_SENTINEL = 'runner-fixture-sentinel-value-never-log';
  t.after(() => {
    if (previousSentinel === undefined) delete process.env.PI_RUNNER_SECRET_SENTINEL;
    else process.env.PI_RUNNER_SECRET_SENTINEL = previousSentinel;
  });
  for (const name of pair) put(f.root, `lib/${name}.test.mjs`, `
    import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
    import { setTimeout as wait } from 'node:timers/promises';
    test('rendezvous ${name}', async () => {
      fs.writeFileSync(${JSON.stringify(path.join(f.root, `${name}.ready`))}, 'ready');
      const until = Date.now() + 3000;
      const peers = ${JSON.stringify(pair.map((peer) => path.join(f.root, `${peer}.ready`)))};
      while (!peers.every((file) => fs.existsSync(file))) {
        assert.ok(Date.now() < until, '${jobs} real workers must overlap'); await wait(10);
      }
      assert.ok(process.execArgv.includes('--test-concurrency=1'));
      assert.equal(process.umask(), 0o077);
      assert.equal(process.env.PI_RUNNER_SECRET_SENTINEL, undefined);
      for (const key of ['NODE_OPTIONS', 'HTTPS_PROXY', 'DBUS_SESSION_BUS_ADDRESS', 'OPENAI_API_KEY']) {
        assert.equal(process.env[key], undefined);
      }
      console.log('worker-envelope=' + JSON.stringify({ argv: process.execArgv, home: process.env.HOME }));
    });`);
  put(f.root, 'lib/exclusive.test.mjs', tiny);
  f.manifest([...pair.map((name, i) => review(`lib/${name}.test.mjs`, jobs === 8 && i % 2 ? 'F' : 'N')),
    review('lib/exclusive.test.mjs', 'E')]);
  let active = 0, peak = 0;
  // Injected admission figures isolate pool mechanics; real resource caps are tested separately above.
  const profile = resourceProfile({ requested: 32, cpus: jobs, cores: String(jobs), memory: (2 * jobs + 2) * 1024 ** 3 });
  const summary = await runSuite({ ...f, jobs: 32, resources: profile, onEvent: (event) => {
    if (event.type === 'start') {
      if (event.lane === 'E') assert.equal(active, 0);
      peak = Math.max(peak, ++active);
    } else if (event.type === 'end') active--;
  } });
  try {
    assert.equal(summary.exitCode, 0, JSON.stringify(summary.results));
    assert.equal(peak, jobs); assert.equal(active, 0);
    assert.equal(summary.counts.tests, jobs + 1);
    assert.ok(summary.results.every((r) => r.workspaceRemoved && r.exitCode === 0));
    const homes = summary.results.filter((r) => r.lane !== 'E').map((r) => {
      const log = fs.readFileSync(r.stdout, 'utf8');
      assert.match(log, /worker-envelope=.*--test-concurrency=1/);
      return JSON.parse(log.match(/worker-envelope=(.*)/)[1]).home;
    });
    assert.equal(new Set(homes).size, jobs);
    for (const entry of fs.readdirSync(summary.runDir)) {
      assert.equal(fs.readFileSync(path.join(summary.runDir, entry), 'utf8').includes('runner-fixture-sentinel-value-never-log'), false);
    }
  } finally { cleanupRetained(summary); }
});

test('real load errors fail, preserve workspace/logs, warn for unreviewed files and stop dispatch', { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  put(f.root, 'lib/a.test.mjs', `throw new Error('runner-load-error-sentinel');`);
  put(f.root, 'lib/b.test.mjs', tiny);
  f.manifest([]);
  const events = [];
  const summary = await runSuite({ ...f, onEvent: (e) => events.push(e) });
  try {
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.complete, false);
    assert.equal(summary.results[0].status, 'failed');
    assert.notEqual(summary.results[0].exitCode, 0);
    assert.equal(summary.results[0].workspaceRemoved, false);
    assert.ok(fs.existsSync(summary.results[0].workspace));
    assert.match(fs.readFileSync(summary.results[0].stdout, 'utf8'), /runner-load-error-sentinel/);
    assert.equal(summary.results[1].status, 'not_started');
    assert.equal(events.filter((e) => e.type === 'warning').length, 2);
  } finally { cleanupRetained(summary); }
});

test('a naturally exiting leader with a live owned-session descendant fails and retains resources', { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  put(f.root, 'lib/survivor.test.mjs', `
    import test from 'node:test'; import { spawn } from 'node:child_process';
    test('own short-lived descendant', () => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: 'ignore' });
      child.unref();
    });`);
  f.manifest([review('lib/survivor.test.mjs')]);
  const summary = await runSuite(f);
  const [worker] = summary.results;
  try {
    assert.equal(summary.exitCode, 1);
    assert.equal(worker.exitCode, 0, 'successful TAP cannot hide a surviving owned process');
    assert.equal(worker.workspaceRemoved, false);
    assert.ok(worker.survivors.length > 0);
    assert.ok(fs.existsSync(worker.workspace));
  } finally {
    const until = Date.now() + 3000;
    const alive = () => worker.survivors.some((p) => {
      const current = processIdentity(p.pid);
      return current?.start === p.start && current.state !== 'Z';
    });
    while (alive() && Date.now() < until) await wait(10);
    assert.equal(alive(), false, 'fixture must settle naturally before cleanup');
    if (!worker.uncertain) fs.rmSync(worker.workspace, { recursive: true, force: true });
  }
});

test('failed diagnostic publication is bounded, escaped, explicit and includes runner-only reasons', async (t) => {
  const f = fixture(t);
  const workspace = path.join(f.root, 'private-workspace');
  put(workspace, 'home/do-not-export', 'private-fixture-content-sentinel');
  const raw = `existing-TAP-head\n${workspace}/home\n\u001b[31mcontrol\u202e\n` +
    'x'.repeat(DIAGNOSTIC_LOG_BYTES) + 'omitted-middle-sentinel' + 'y'.repeat(DIAGNOSTIC_LOG_BYTES) + '\nexisting-TAP-tail\n';
  const stdoutFile = put(f.root, 'failed.tap', raw);
  const stderrFile = put(f.root, 'failed.stderr', 'existing-stderr-sentinel\n');
  function capture() {
    let text = '';
    return { stream: new Writable({ highWaterMark: 32, write(chunk, encoding, done) {
      text += chunk.toString(); setImmediate(done);
    } }), text: () => text };
  }
  const stdout = capture(), stderr = capture();
  await reportResults({ success: false, exitCode: 1, complete: false, interrupted: false,
    counts: { tests: 1, pass: 1, fail: 0 }, results: [{ path: 'lib/fixture\u001b.test.mjs',
      status: 'failed', success: false, exitCode: 0, counts: { tests: 1, pass: 1, fail: 0 },
      error: 'runner-only-error-sentinel', uncertain: true, survivors: [{ pid: 123 }],
      caseContract: { success: false, errors: ['mandatory-case-mismatch-sentinel'] },
      workspaceRemoved: false, workspace, stdout: stdoutFile, stderr: stderrFile,
      env: { NOT_FOR_EXPORT: 'whole-env-sentinel' }, session: 'session-data-sentinel',
    }, { path: 'lib/not-started.test.mjs', status: 'not_started', success: false }] },
  { stdout: stdout.stream, stderr: stderr.stream });
  const combined = stdout.text() + stderr.text();
  for (const value of ['existing-TAP-head', 'existing-TAP-tail', 'existing-stderr-sentinel',
    'runner-only-error-sentinel', 'mandatory-case-mismatch-sentinel', 'Owned-process settlement uncertain']) assert.ok(combined.includes(value), value);
  assert.match(combined, /TRUNCATED: omitted \d+ middle bytes/);
  assert.match(combined, /"notStartedFiles":1/);
  assert.match(combined, /"settlementUncertainFiles":1/);
  assert.match(combined, /\\u001b/); assert.match(combined, /\\u202e/);
  for (const value of ['\u001b', '\u202e', workspace, 'omitted-middle-sentinel', 'private-fixture-content-sentinel',
    'whole-env-sentinel', 'session-data-sentinel']) assert.equal(combined.includes(value), false, value);
  assert.ok(stdout.text().length < DIAGNOSTIC_LOG_BYTES + 4096);
  assert.equal(fs.readFileSync(stdoutFile, 'utf8'), raw, 'full original log is retained unchanged');
});

test('CLI publishes genuine failed TAP/reason and incomplete coverage, retains private workspace; success stays quiet', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  put(f.root, 'lib/a.test.mjs', `import test from 'node:test'; import assert from 'node:assert/strict';
    import fs from 'node:fs'; import path from 'node:path';
    test('deliberate readable failure', () => {
      fs.writeFileSync(path.join(process.env.HOME, 'do-not-export'), 'private-failed-fixture-sentinel');
      console.log('genuine-stdout-diagnostic-sentinel'); console.error('genuine-stderr-diagnostic-sentinel');
      assert.equal(1, 2, 'genuine-assertion-reason-sentinel');
    });`);
  put(f.root, 'lib/b.test.mjs', `import test from 'node:test';
    test('quiet success', () => { console.log('success-log-must-not-be-dumped'); });`);
  f.manifest([review('lib/a.test.mjs', 'E'), review('lib/b.test.mjs', 'E')]);
  const args = ['--root', f.root, '--artifacts', f.artifacts, '--git-bin', f.gitBin,
    '--tool-path', f.toolPath.join(':'), '--jobs', '1'];
  const readSummary = (output) => JSON.parse(fs.readFileSync(path.join(
    JSON.parse(output.stdout.match(/^Test artifacts: (.+)$/m)[1]), 'summary.json'), 'utf8'));
  const failed = await cli(t, args).closed;
  const summary = readSummary(failed);
  try {
    assert.equal(failed.code, 1); assert.equal(failed.signal, null);
    for (const text of ['genuine-stdout-diagnostic-sentinel', 'genuine-stderr-diagnostic-sentinel',
      'genuine-assertion-reason-sentinel']) assert.ok((failed.stdout + failed.stderr).includes(text), text);
    assert.match(failed.stderr, /FAILED FILE .*"status":"failed"/);
    assert.match(failed.stderr, /"fail":1/);
    assert.match(failed.stderr, /Exit code 1/);
    assert.match(failed.stderr, /"completePlannedCoverage":false/);
    assert.match(failed.stderr, /"notStartedFiles":1/);
    assert.equal((failed.stdout + failed.stderr).includes('private-failed-fixture-sentinel'), false);
    const [worker] = summary.results;
    assert.equal(worker.workspaceRemoved, false);
    assert.equal(fs.statSync(worker.workspace).mode & 0o777, 0o700);
    assert.equal(fs.readFileSync(path.join(worker.workspace, 'home/do-not-export'), 'utf8'), 'private-failed-fixture-sentinel');
    assert.match(fs.readFileSync(worker.stdout, 'utf8'), /genuine-assertion-reason-sentinel/);
  } finally { cleanupRetained(summary); }
  const passed = await cli(t, [...args, '--file', 'lib/b.test.mjs']).closed;
  const success = readSummary(passed);
  try {
    assert.equal(passed.code, 0);
    assert.match(passed.stdout, /TEST SUMMARY .*"success":true/);
    assert.equal((passed.stdout + passed.stderr).includes('success-log-must-not-be-dumped'), false);
    assert.equal((passed.stdout + passed.stderr).includes('BEGIN failed'), false);
    assert.match(fs.readFileSync(success.results[0].stdout, 'utf8'), /success-log-must-not-be-dumped/);
    assert.equal(success.results[0].workspaceRemoved, true);
  } finally { cleanupRetained(success); }
});

test('CLI preflight runner errors are readable without an inner TAP file', { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  put(f.root, 'lib/present.test.mjs', tiny);
  f.manifest([review('lib/stale.test.mjs')]);
  const result = await cli(t, ['--root', f.root, '--artifacts', f.artifacts, '--git-bin', f.gitBin,
    '--tool-path', f.toolPath.join(':'), '--jobs', '1']).closed;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /RUNNER ERROR .*Stale manifest path: lib\/stale.test.mjs/);
  assert.match(result.stderr, /TEST SUMMARY .*"completePlannedCoverage":false/);
});

// CLI subprocess tests use only tiny generated files. Bound the harness; no product timeout changes.
function cli(t, args) {
  const env = { PATH: path.dirname(process.execPath), LC_ALL: 'C', NIX_BUILD_CORES: '1' };
  const child = spawn(process.execPath, [runner, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 8000);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  t.after(() => clearTimeout(timer));
  return { child, closed, output: () => stdout };
}

test('import alone does not recurse/discover or alter umask; CLI rejects arbitrary tail options', { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  const file = put(f.root, 'import-only.mjs', `
    const before = process.umask(); await import(${JSON.stringify(new URL('../nix/test-runner.mjs', import.meta.url).href)});
    if (before !== process.umask()) throw Error('import altered umask'); console.log('import-only');`);
  const child = spawn(process.execPath, [file], { cwd: f.root, env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 4000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 0); assert.equal(output, 'import-only\n');
  const invalid = cli(t, ['--eval', 'forbidden']);
  assert.equal((await invalid.closed).code, 1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  test(`CLI ${sig} reports interruption truth and retains its workspace after owned group settlement`, { timeout: 12000 }, async (t) => {
    const f = fixture(t);
    const ready = path.join(f.root, 'worker-ready.json');
    put(f.root, 'lib/wait.test.mjs', `import test from 'node:test'; import fs from 'node:fs';
      test('bounded tiny worker', async () => {
        fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, argv: process.execArgv }));
        await new Promise(resolve => setTimeout(resolve, 2000));
      });`);
    f.manifest([review('lib/wait.test.mjs', 'E')]);
    const command = cli(t, ['--root', f.root, '--artifacts', f.artifacts, '--git-bin', f.gitBin,
      '--tool-path', f.toolPath.join(':'), '--jobs', '1']);
    const until = Date.now() + 4000;
    while (!fs.existsSync(ready) && command.child.exitCode === null && Date.now() < until) await wait(10);
    assert.ok(fs.existsSync(ready), command.output());
    const descendant = JSON.parse(fs.readFileSync(ready, 'utf8'));
    assert.ok(descendant.argv.includes('--test-concurrency=1'));
    command.child.kill(sig);
    const result = await command.closed;
    assert.equal(result.signal, null);
    assert.equal(result.code, sig === 'SIGINT' ? 130 : 143, result.stderr);
    const runDir = path.join(f.artifacts, fs.readdirSync(f.artifacts)[0]);
    const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
    try {
      assert.equal(summary.success, false); assert.equal(summary.interrupted, true);
      const [worker] = summary.results;
      assert.equal(worker.status, 'interrupted'); assert.equal(worker.workspaceRemoved, false);
      assert.ok(fs.existsSync(worker.stdout)); assert.ok(fs.existsSync(worker.workspace));
      assert.equal(worker.survivors.length, 0);
      assert.equal(processIdentity(worker.identity.pid), null);
      const descendantNow = processIdentity(descendant.pid);
      assert.ok(descendantNow === null || descendantNow.state === 'Z', 'signal reached the owned test-file descendant');
    } finally { cleanupRetained(summary); }
  });
}
