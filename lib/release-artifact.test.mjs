import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { verifyArchive, smokeEnvironment, ownLauncher, preserveFailure } from '../nix/portable-smoke.mjs';

const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
test('release identity and modular override stay pinned without enabling registry publication', () => {
  const pkg = json('../package.json'), lock = json('../package-lock.json');
  assert.equal(pkg.version, '0.1.0'); assert.equal(pkg.private, true);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/rschaffar/brabbler.git');
  assert.equal(pkg.overrides['@earendil-works/pi-coding-agent@1.4.0'].undici, '$undici');
  assert.equal(pkg.dependencies.undici, '8.12.2');
  for (const [name, info] of Object.entries(lock.packages)) if (name.endsWith('/undici')) assert.equal(info.version, '8.12.2');
  assert.ok(pkg.files.includes('npm-shrinkwrap.json'));
  for (const entry of ['!.next/trace', '!.next/trace-build', '!.next/diagnostics']) assert.ok(pkg.files.includes(entry));
  assert.match(pkg.scripts.postinstall, /^node bin\/sdk-runtime-policy\.js --preflight && node bin\/patch-sdk-command-env\.js --apply && node bin\/sdk-runtime-policy\.js --apply/);
});
test('portable smoke checks the exact archive before any installation', t => {
  const dir = mkdtempSync(join(tmpdir(), 'release-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'brabbler.tgz'), bytes = Buffer.from('synthetic checksum fixture');
  writeFileSync(file, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  verifyArchive(file, digest);
  assert.throws(() => verifyArchive(file, '0'.repeat(64)), /tarball identity/);
  assert.throws(() => verifyArchive(file, 'not-a-hash'), /SHA-256/);
  const source = join(dir, 'source.tar.gz'); writeFileSync(source, bytes);
  verifyArchive(source, digest, '.tar.gz');
  assert.throws(() => verifyArchive(source, '0'.repeat(64), '.tar.gz'), /tarball identity/);
});
test('portable smoke environment is explicit and cannot inherit operator credentials or Node preload', () => {
  const env = smokeEnvironment('/synthetic/smoke', '/synthetic/tools');
  assert.equal(env.HOME, '/synthetic/smoke'); assert.equal(env.PI_OFFLINE, '1');
  assert.equal(env.PATH, '/synthetic/tools'); assert.equal(env.BRABBLER_NO_AUTH, undefined);
  assert.equal(env.BRABBLER_PASSWORD, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.notEqual(env.npm_config_userconfig, env.npm_config_globalconfig);
  assert.equal(env.npm_config_registry, 'https://registry.npmjs.org');
});
function launcherFixture(log = '', options = {}) {
  const child = new EventEmitter(), signals = [];
  Object.assign(child, { pid: 4242, exitCode: null, signalCode: null,
    stdout: { destroy() { child.stdoutDestroyed = true; } }, stderr: { destroy() { child.stderrDestroyed = true; } },
    unref() { child.unreferenced = true; },
    kill(signal) {
      signals.push(signal);
      queueMicrotask(() => { child.exitCode = 143; child.emit('exit', 143, null); child.emit('close', 143, null); });
      return true;
    },
  });
  const owner = ownLauncher(child, () => log, options);
  return { child, signals, owner };
}
test('smoke joins requested shutdown once and rejects early exit or owner cleanup failures', async () => {
  const normal = launcherFixture();
  const stop = normal.owner.stop(); assert.equal(stop, normal.owner.stop()); await stop;
  assert.deepEqual(normal.signals, ['SIGTERM']); assert.equal(normal.owner.snapshot().closed, true);
  const early = launcherFixture(); early.child.exitCode = 0; early.child.emit('exit', 0, null); early.child.emit('close', 0, null);
  await assert.rejects(early.owner.stop(), /exited unexpectedly/);
  const failedCleanup = launcherFixture('[brabbler] owner cleanup failed: synthetic');
  await assert.rejects(failedCleanup.owner.stop(), /owner cleanup failed/);
});
test('dead-leader pipe uncertainty is bounded and never signals a recycled group', async () => {
  let waits = 0;
  const f = launcherFixture('', { wait: async () => { waits++; return false; }, signalGroup() { throw new Error('must not signal a dead leader group'); } });
  f.child.exitCode = 0; f.child.emit('exit', 0, null);
  await assert.rejects(f.owner.stop(), /settlement uncertain/);
  assert.equal(waits, 2); assert.deepEqual(f.signals, []);
  assert.equal(f.child.stdoutDestroyed, true); assert.equal(f.child.stderrDestroyed, true); assert.equal(f.child.unreferenced, true);
});
test('forced shutdown fails even when the final pipes close', async () => {
  let waits = 0, f; const groups = [];
  f = launcherFixture('', { wait: async () => {
    if (++waits === 1) return false;
    f.child.signalCode = 'SIGKILL'; f.child.emit('exit', null, 'SIGKILL'); f.child.emit('close', null, 'SIGKILL'); return true;
  }, signalGroup: (pid, signal) => groups.push([pid, signal]) });
  f.child.kill = signal => { f.signals.push(signal); return true; };
  await assert.rejects(f.owner.stop(), /forced shutdown/);
  assert.deepEqual(groups, [[4242, 'SIGKILL']]); assert.equal(f.owner.snapshot().closed, true);
});
test('primary and cleanup errors are both retained', async () => {
  const primary = new Error('primary proof failed'), cleanup = new Error('cleanup failed');
  await assert.rejects(preserveFailure(() => { throw primary; }, () => { throw cleanup; }), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
  });
  await assert.rejects(preserveFailure(() => { throw primary; }, () => {}), error => error === primary);
});
test('portable workflow is manual test-only and replaces automatic demo deployment', () => {
  assert.equal(existsSync(new URL('../.github/workflows/demo-pages.yml', import.meta.url)), false);
  const workflow = load(readFileSync(new URL('../.github/workflows/portable-smoke.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.smoke.needs, 'build');
  assert.ok(workflow.jobs.smoke.strategy.matrix.os.some(os => os.startsWith('macos-')));
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.environment, undefined);
    for (const step of job.steps) assert.doesNotMatch(step.uses ?? '', /deploy|publish/i);
  }
});
