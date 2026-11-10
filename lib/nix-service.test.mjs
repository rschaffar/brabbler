import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServicePlan, migrationCaseInventory, migrationExpectedCases, serviceArtifacts, serviceCgroup, serviceResources, validateServiceArtifacts, validateServiceEvidence, validateServiceRegistry } from '../nix/service-plan.mjs';
import { inspectMigrationArtifacts, validateMigrationArtifacts } from '../nix/vm-evidence.mjs';
import { createSmokeDiagnostics, diagnosticLimits, parsePtyProof, recordSmokeMode, requestJSON, terminalOutput, writePrivateEnvironment } from '../nix/service-smoke.mjs';
import { validateArgs } from '../nix/test.mjs';

// Independent synthetic deployment bindings; never executable service authority.
const store = `/nix/store/${'a'.repeat(32)}-brabbler`;
const group = '/user.slice/user-1000.slice/user@1000.service/app.slice/brabbler.service';
function registryFixture() {
  return { version: 1, kind: 'brabbler-service-registry', package: `${store}/lib/node_modules/brabbler`,
    launcher: `${store}/bin/brabbler`, shell: `/nix/store/${'b'.repeat(32)}-bash/bin/bash`,
    resources: { workers: 1, cpus: 1, memoryMiB: 1536, diskMiB: 2048 },
    migration: { source: `/nix/store/${'d'.repeat(32)}-migration-source`, modules: `/nix/store/${'e'.repeat(32)}-modules/node_modules`,
      node: `/nix/store/${'f'.repeat(32)}-node/bin/node`, python: `/nix/store/${'g'.repeat(32)}-python/bin/python3`,
      git: `/nix/store/${'h'.repeat(32)}-git/bin/git`, acl: `/nix/store/${'i'.repeat(32)}-acl/bin/setfacl`,
      unit: 'brabbler-migration-acceptance.service', root: '/home/t0/migration',
      fixture: 'tools/migrations/git-operation-reviews/vm-acceptance.fixture.mjs', timeoutSeconds: 240 },
    service: { user: 't0', uid: 1000, home: '/home/t0', port: 30141, unit: 'brabbler.service',
      envFile: '/home/t0/service.env', fixture: '/home/t0/fixtures', agentDir: '/home/t0/fixtures/agent',
      evidence: '/home/t0/evidence', controller: `/nix/store/${'c'.repeat(32)}-control/bin/brabbler-deployment-control` } };
}
function fixture() {
  const registry = registryFixture(), plan = createServicePlan(registry);
  const before = { ActiveState: 'active', SubState: 'running', InvocationID: 'a'.repeat(32), MainPID: '42',
    NRestarts: '0', ControlGroup: group, Result: 'success' };
  const after = { ...before, InvocationID: 'b'.repeat(32), MainPID: '43' };
  const session = { ids: ['vm-service-smoke'], id: 'vm-service-smoke', name: 'VM durable service session',
    file: '/home/t0/fixtures/agent/sessions/smoke/2026-10-15T00-00-00-000Z_vm-service-smoke.jsonl' };
  const environment = { HOME: '/home/t0', PI_CODING_AGENT_DIR: '/home/t0/fixtures/agent', BRABBLER_SKIP_VERSION_CHECK: '1',
    PI_OFFLINE: '1', NODE_ENV: 'production', SHELL: registry.shell, BRABBLER_REQUIRE_AUTH: '1', BRABBLER_SERVICE_UNIT: 'unit-value',
    BRABBLER_SERVICE_FILE: 'runtime file $literal', BRABBLER_SERVICE_OVERRIDE: 'runtime-file-wins', BRABBLER_SERVICE_RUNTIME: '/run/user/1000' };
  const paths = Object.fromEntries([
    ['home', '/home/t0', '0700'], ['fixture', '/home/t0/fixtures', '0700'], ['agent', '/home/t0/fixtures/agent', '0700'],
    ['evidence', '/home/t0/evidence', '0700'], ['environment', '/home/t0/service.env', '0600'], ['session', session.file, '0600'],
  ].map(([name, file, mode]) => [name, { path: file, uid: 1000, mode, physical: true, ...(mode === '0600' ? { links: 1 } : {}) }]));
  const migrationSettlement = { attempted: true, path: '/system.slice/brabbler-migration-acceptance.service', state: 'absent' };
  const migration = { identity: { inputs: structuredClone(registry.migration), uid: 1000, probe: 'available',
    tmp: { path: '/home/t0/migration/tmp', uid: 1000, mode: '0700', physical: true }, node: '24.22.2', sdk: '1.4.0', tool: 'f'.repeat(64) },
    execution: { Result: 'success', ExecMainCode: '1', ExecMainStatus: '0' }, settlement: migrationSettlement,
    counts: { tests: 32, suites: 0, pass: 32, fail: 0, cancelled: 0, skipped: 0, todo: 0 } };
  const receipt = { version: 1, kind: 'brabbler-service-evidence', plan: structuredClone(plan), passed: true,
    checks: ['activation', 'environment-permissions', 'http-write', 'restart-persistence', 'production-pty', 'migration-converter']
      .map(name => ({ name, status: 'passed' })),
    proof: {
      activation: { link: '/home/t0/.config/systemd/user/default.target.wants/brabbler.service',
        target: `/nix/store/${'d'.repeat(32)}-brabbler.service`, fragment: `/nix/store/${'d'.repeat(32)}-brabbler.service`,
        launcher: registry.launcher, managerWasInactive: true, generation: before },
      permissions: { uid: 1000, umask: '0077', cwd: '/home/t0', launcherScript: `${registry.package}/bin/brabbler.js`,
        environment, paths, deniedReads: { environment: true, session: true } },
      write: { session: structuredClone(session), workspace: { path: '/home/t0/brabbler-cwd-20261015', uid: 1000, mode: '0700', physical: true } },
      restart: { before: structuredClone(before), after, session: structuredClone(session) },
      pty: { id: '0123456789abcdef0123456789abcdef', tty: '/dev/pts/0', uid: 1000, pid: '44', cwd: '/home/t0/brabbler-cwd-20261015',
        environment: { BRABBLER_SERVICE_UNIT: 'unit-value', BRABBLER_SERVICE_FILE: 'runtime file $literal', BRABBLER_SERVICE_OVERRIDE: 'runtime-file-wins' },
        cols: 91, rows: 27, controlGroup: group, alive: true, leftRunning: true },
      migration,
    },
    clientsSettled: true, settlement: { status: { ActiveState: 'inactive', MainPID: '0', ControlGroup: '' },
      groups: [{ path: group, state: 'absent' }], port: 'refused', migration: migrationSettlement },
    collectionProbe: true, artifactsCollected: true,
    artifacts: Object.fromEntries(serviceArtifacts.map(name => [name, 'e'.repeat(64)])),
    errors: [], elapsedSeconds: 1,
  };
  return { registry, plan, receipt };
}

test('fixed deployment plan is independent of browser selection and has explicit mandatory proofs', () => {
  const { registry, plan } = fixture();
  assert.deepEqual(plan, createServicePlan(registry));
  assert.deepEqual(plan.checks, ['activation', 'environment-permissions', 'http-write', 'restart-persistence', 'production-pty', 'migration-converter']);
  assert.deepEqual(plan.migration.expectedCases, migrationExpectedCases);
  assert.deepEqual(plan.registry.resources, { workers: 1, cpus: 1, memoryMiB: 1536, diskMiB: 2048 });
  assert.deepEqual(serviceResources, plan.registry.resources);
  assert.deepEqual(plan.artifacts, ['journal.log', 'service.log', 'observations.json', 'fixtures.tar.gz', 'migration.tap', 'migration.stderr.log', 'migration.json']);
  assert.equal(plan.jobs, undefined); assert.equal(plan.focus, undefined);
  for (const change of [r => r.service.uid = 0, r => r.service.user = 'other', r => r.service.port = 30142,
    r => r.service.home = '/root', r => r.service.envFile = '/tmp/env', r => r.service.unit = 'other.service',
    r => r.service.controller = '/tmp/control', r => r.resources.workers = 2, r => r.resources.memoryMiB = 4096,
    r => r.launcher = '/usr/bin/brabbler', r => r.package = '/checkout', r => r.shell = '/bin/bash',
    r => r.kind = 'browser', r => r.extra = true, r => delete r.migration,
    r => r.migration.source = '/checkout', r => r.migration.modules = '/tmp/modules',
    r => r.migration.python = '/usr/bin/python3', r => r.migration.unit = 'brabbler.service',
    r => r.migration.fixture = 'tools/other.mjs', r => r.migration.root = '/home/t0/fixtures',
    r => r.migration.timeoutSeconds = 0, r => r.migration.extra = true]) {
    const broken = structuredClone(registry); change(broken); assert.throws(() => validateServiceRegistry(broken));
  }
});

test('passed service evidence cannot omit activation, permissions, durable restart, native PTY or exact bindings', () => {
  const good = fixture(); assert.equal(validateServiceEvidence(good.receipt, good.plan), good.receipt);
  for (const change of [
    r => r.checks.pop(), r => r.checks[0].status = 'not-run', r => r.checks.reverse(),
    r => r.proof.activation.managerWasInactive = false, r => r.proof.activation.fragment = '/wrong/unit',
    r => r.proof.activation.generation.NRestarts = '1', r => r.proof.activation.generation.Result = 'signal',
    r => r.proof.permissions.environment.BRABBLER_SERVICE_OVERRIDE = 'unit-value-must-be-overridden',
    r => r.proof.permissions.environment.BRABBLER_REQUIRE_AUTH = '0',
    r => r.proof.permissions.umask = '0022', r => r.proof.permissions.paths.environment.links = 2,
    r => r.proof.permissions.paths.home.mode = '0755', r => r.proof.permissions.paths.session.uid = 0,
    r => r.proof.permissions.deniedReads.environment = false, r => r.proof.permissions.launcherScript = '/checkout/bin/brabbler.js',
    r => r.proof.write.session.name = 'not written', r => r.proof.write.workspace.path = '/tmp/workspace',
    r => r.proof.restart.after.InvocationID = r.proof.restart.before.InvocationID,
    r => r.proof.restart.before.MainPID = '999', r => r.proof.restart.session.ids = [],
    r => r.proof.pty.tty = 'pipe', r => r.proof.pty.uid = 0, r => r.proof.pty.cwd = '/tmp',
    r => r.proof.pty.environment.BRABBLER_SERVICE_FILE = 'missing', r => r.proof.pty.rows = 24,
    r => r.proof.pty.leftRunning = false, r => r.proof.pty.alive = false,
    r => r.proof.pty.controlGroup = '/user.slice/user-1001.slice/user@1001.service/app.slice/brabbler.service',
    r => r.plan.registry.package = '/wrong/package', r => r.errors.push('unexpected failure'),
  ]) {
    const { receipt, plan } = fixture(); change(receipt);
    assert.throws(() => validateServiceEvidence(receipt, plan), /service evidence/);
  }
});

test('failure diagnostics can permit cleanup, but never substitute for collection and independently observed settlement', () => {
  const { receipt, plan } = fixture();
  receipt.passed = false; receipt.errors = ['original assertion'];
  receipt.checks = receipt.checks.map((row, i) => ({ ...row, status: i === 0 ? 'failed' : 'not-run' }));
  receipt.proof = { activation: null, permissions: null, write: null, restart: null, pty: null, migration: null };
  receipt.settlement.migration = { attempted: false, path: null, state: 'not-started' };
  assert.equal(validateServiceEvidence(receipt, plan), receipt);
  for (const change of [r => r.clientsSettled = false, r => r.collectionProbe = false, r => r.artifactsCollected = false,
    r => delete r.artifacts['fixtures.tar.gz'], r => r.artifacts['journal.log'] = 'not a digest',
    r => r.settlement.status.MainPID = '42', r => r.settlement.status.ActiveState = 'active',
    r => r.settlement.port = 'HTTP 500', r => r.settlement.groups = [],
    r => r.settlement.groups[0].state = 'populated', r => r.settlement.groups[0].state = 'unreadable',
    r => r.settlement.groups[0].path += '/../../foreign', r => r.kind = 'brabbler-browser-evidence', r => r.version = 2,
    r => r.groups = []]) {
    const broken = structuredClone(receipt); change(broken);
    assert.throws(() => validateServiceEvidence(broken, plan), /service evidence/);
  }
  for (const value of [group + '-other', group + '\n', '/system.slice/brabbler.service', group.replace('1000', '1001'), group + '/../brabbler.service']) {
    assert.throws(() => serviceCgroup(value));
  }
});

test('host artifact verification refuses missing, changed, linked or aliased collection independently of receipt booleans', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-artifacts-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'evidence'); fs.mkdirSync(directory, { mode: 0o700 });
  const artifacts = {};
  for (const name of serviceArtifacts) {
    const content = `synthetic ${name}\n`;
    fs.writeFileSync(path.join(directory, name), content, { mode: 0o600 });
    artifacts[name] = createHash('sha256').update(content).digest('hex');
  }
  assert.equal(validateServiceArtifacts(directory, artifacts), artifacts);
  const journal = path.join(directory, 'journal.log'); fs.unlinkSync(journal);
  assert.throws(() => validateServiceArtifacts(directory, artifacts));
  fs.writeFileSync(journal, 'changed', { mode: 0o600 });
  assert.throws(() => validateServiceArtifacts(directory, artifacts), /changed/);
  fs.unlinkSync(journal);
  const sentinel = path.join(root, 'synthetic-host-only'); fs.writeFileSync(sentinel, 'not exportable', { mode: 0o600 });
  fs.symlinkSync(sentinel, journal); assert.throws(() => validateServiceArtifacts(directory, artifacts));
  fs.unlinkSync(journal); fs.linkSync(sentinel, journal);
  assert.throws(() => validateServiceArtifacts(directory, artifacts), /Unsafe/);
  const alias = path.join(root, 'alias'); fs.symlinkSync(directory, alias);
  assert.throws(() => validateServiceArtifacts(alias, artifacts));
});

test('migration guest retains all 29 original registrations and three real metadata cases without conditional admission', () => {
  const base = new URL('../tools/migrations/git-operation-reviews/', import.meta.url);
  const original = fs.readFileSync(new URL('converter.fixture.mjs', base), 'utf8');
  const guest = fs.readFileSync(new URL('vm-acceptance.fixture.mjs', base), 'utf8');
  const titles = source => [...source.matchAll(/^test\('([^']+)',/gm)].map(match => match[1]);
  assert.equal(migrationCaseInventory.converter.length, 29);
  assert.equal(migrationCaseInventory.native.length, 3);
  assert.equal(new Set(migrationExpectedCases).size, 32);
  assert.deepEqual(titles(original), migrationCaseInventory.converter);
  assert.deepEqual(titles(guest), migrationCaseInventory.native);
  assert.match(guest, /^import '\.\/converter\.fixture\.mjs';/m);
  assert.doesNotMatch(guest, /test\.(?:skip|todo)|skip:|todo:|brabbler-test-deny-xattrs|(?:getxattr|getfacl)\s*\(/);
  assert.ok(guest.includes('tool: toolIdentity()'));
  assert.ok(guest.includes("os.listxattr(3)"));
  assert.ok(guest.includes("os.setxattr(3,'user.brabbler-test',b'synthetic')"));
  assert.ok(guest.includes("execFileSync('setfacl'"));
  const flake = fs.readFileSync(new URL('../flake.nix', import.meta.url), 'utf8');
  const service = flake.slice(flake.indexOf('mkE2E ='), flake.indexOf('browser ='));
  assert.ok(service.includes('src = (sources pkgs).tests;'));
  assert.ok(service.includes('modules = modules pkgs;'));
});

test('migration receipt refuses absent positives, foreign inputs, unsupported probes and uncertain descendants', () => {
  for (const change of [
    r => r.proof.migration = null, r => delete r.artifacts['migration.tap'],
    r => r.proof.migration.identity.inputs.source = '/checkout',
    r => r.proof.migration.identity.inputs.modules = '/tmp/node_modules',
    r => r.proof.migration.identity.uid = 0, r => r.proof.migration.identity.probe = 'unavailable',
    r => r.proof.migration.identity.tmp.path = '/tmp', r => r.proof.migration.identity.tmp.physical = false,
    r => r.proof.migration.identity.node = '25.0.0', r => r.proof.migration.identity.sdk = '',
    r => r.proof.migration.identity.tool = 'not-a-fingerprint',
    r => r.proof.migration.execution.ExecMainStatus = '1', r => r.proof.migration.execution.ExecMainCode = '2',
    r => r.proof.migration.execution.Result = 'timeout', r => r.proof.migration.counts.tests = 29,
    r => r.proof.migration.counts.skipped = 1, r => r.proof.migration.counts.todo = 1,
    r => r.proof.migration.counts.cancelled = 1, r => r.proof.migration.counts.fail = 1,
    r => r.settlement.migration.path = '/system.slice/brabbler.service',
    r => r.settlement.migration.state = 'populated', r => r.settlement.migration.state = 'unreadable',
    r => r.settlement.migration = { attempted: false, path: null, state: 'not-started' },
  ]) {
    const { receipt, plan } = fixture(); change(receipt);
    assert.throws(() => validateServiceEvidence(receipt, plan), /service evidence/);
  }
});

function migrationTap(identity, cases = migrationExpectedCases) {
  return 'TAP version 13\n' + cases.map((name, i) => `# Subtest: ${name}\nok ${i + 1} - ${name}\n`).join('') +
    '# BRABBLER_MIGRATION_IDENTITY ' + JSON.stringify(identity) + '\n' +
    `1..${cases.length}\n# tests ${cases.length}\n# suites 0\n# pass ${cases.length}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n`;
}

test('transferred migration artifacts require exact completed original cases and independently bound executed identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-evidence-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { plan, receipt } = fixture(), proof = receipt.proof.migration;
  const good = migrationTap(proof.identity);
  const put = text => fs.writeFileSync(path.join(root, 'migration.tap'), text, { mode: 0o600 });
  const report = { execution: proof.execution, proof, settlement: receipt.settlement.migration };
  fs.writeFileSync(path.join(root, 'migration.json'), JSON.stringify(report), { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'migration.stderr.log'), '', { mode: 0o600 });
  put(good);
  assert.deepEqual(await inspectMigrationArtifacts(root, plan), { identity: proof.identity, counts: proof.counts });
  await validateMigrationArtifacts(root, plan, proof, receipt.settlement.migration);
  for (const text of ['', good.slice(0, -30), good.replace('ok 1 -', 'not ok 1 -'),
    good.replace('ok 1 - ' + migrationExpectedCases[0], 'ok 1 - ' + migrationExpectedCases[0] + ' # SKIP'),
    good.replace('ok 1 - ' + migrationExpectedCases[0], 'ok 1 - ' + migrationExpectedCases[0] + ' # TODO'),
    migrationTap(proof.identity, migrationExpectedCases.slice(1)),
    migrationTap(proof.identity, [...migrationExpectedCases.slice(1), migrationExpectedCases[1]]),
    migrationTap(proof.identity, [...migrationExpectedCases, 'unexpected case']),
    good.replace('# cancelled 0', '# cancelled 1'), good.replace('# fail 0', '# fail 1'),
    good.replace('# BRABBLER_MIGRATION_IDENTITY ', '# not-an-identity '),
    good.replace('1..32', '# BRABBLER_MIGRATION_IDENTITY {}\n1..32')]) {
    put(text); await assert.rejects(inspectMigrationArtifacts(root, plan));
  }
  put(good);
  for (const change of [p => p.identity.tool = '0'.repeat(64), p => p.identity.inputs.source = '/tmp/foreign',
    p => p.identity.node = '24.0.0', p => p.identity.sdk = '0.0.0']) {
    const bad = structuredClone(proof); change(bad);
    fs.writeFileSync(path.join(root, 'migration.json'), JSON.stringify({ ...report, proof: bad }));
    await assert.rejects(validateMigrationArtifacts(root, plan, bad, receipt.settlement.migration));
  }
  fs.writeFileSync(path.join(root, 'migration.json'), JSON.stringify(report));
  const tap = path.join(root, 'migration.tap'), saved = path.join(root, 'saved.tap');
  fs.renameSync(tap, saved); fs.symlinkSync(saved, tap);
  await assert.rejects(inspectMigrationArtifacts(root, plan));
  fs.unlinkSync(tap); fs.linkSync(saved, tap);
  await assert.rejects(inspectMigrationArtifacts(root, plan));
  fs.unlinkSync(saved);
  put('x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(inspectMigrationArtifacts(root, plan), /oversized/);
});

test('service environment writer refuses unsafe aliases and modes before truncating', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-env-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'env'), alias = path.join(root, 'alias');
  fs.writeFileSync(file, 'original', { mode: 0o600 }); fs.symlinkSync(file, alias);
  assert.throws(() => writePrivateEnvironment(alias, 'bad')); assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  fs.unlinkSync(alias); fs.linkSync(file, alias);
  assert.throws(() => writePrivateEnvironment(file, 'bad')); assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  fs.unlinkSync(alias); fs.chmodSync(file, 0o644); assert.throws(() => writePrivateEnvironment(file, 'bad'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  fs.chmodSync(file, 0o600); writePrivateEnvironment(file, 'new'); assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('PTY proof requires executed tty/UID/cwd/environment/size output, not echoed input or mere HTTP creation', () => {
  const { registry, plan } = fixture(), workspace = '/home/t0/brabbler-cwd-20261015';
  const output = '\r\nBRABBLER_BEGIN\r\nBRABBLER_TTY:/dev/pts/0\r\nBRABBLER_UID:1000\r\nBRABBLER_PID:44\r\n' +
    'BRABBLER_CWD:/home/t0/brabbler-cwd-20261015\r\nBRABBLER_UNIT:unit-value\r\nBRABBLER_FILE:runtime file $literal\r\n' +
    'BRABBLER_OVERRIDE:runtime-file-wins\r\nBRABBLER_SIZE:27 91\r\nBRABBLER_END\r\n';
  assert.equal(parsePtyProof(output, workspace, registry, plan.terminal).pid, '44');
  for (const bad of ["printf '%s%s\\n' BRABBLER_ BEGIN", JSON.stringify({ id: plan.terminal.id }),
    output.replace('BRABBLER_TTY:/dev/pts/0\r\n', ''), output.replace('/dev/pts/0', 'pipe'),
    output.replace('BRABBLER_UID:1000', 'BRABBLER_UID:0'), output.replace('27 91', '24 80'),
    output.replace('runtime file $literal', 'missing'), output.replace('BRABBLER_END', 'not done')]) {
    assert.throws(() => parsePtyProof(bad, workspace, registry, plan.terminal));
  }
});

test('bounded HTTP probes reject 5xx, invalid/oversized JSON and stalled bodies, and close their requests', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/failure') { response.writeHead(500); response.end('synthetic failure'); }
    else if (request.url === '/invalid') response.end('not JSON');
    else if (request.url === '/large') response.end(JSON.stringify('x'.repeat(1000)));
    else if (request.url === '/stall') { response.writeHead(200); response.flushHeaders(); }
    else response.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await requestJSON(base, '/ok'), { ok: true });
    await assert.rejects(requestJSON(base, '/failure'), /HTTP 500/);
    await assert.rejects(requestJSON(base, '/invalid'));
    await assert.rejects(requestJSON(base, '/large', { limitBytes: 10 }), /bound/);
    await assert.rejects(requestJSON(base, '/stall', { timeoutMs: 30 }), /deadline/);
    assert.throws(() => requestJSON(base, '//other.test/escape'));
    assert.throws(() => requestJSON('http://example.test', '/api'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('deployment entry and support cannot select browser groups, copy browser support or replace the production service', () => {
  assert.deepEqual(validateArgs(['service', '--offline']), { kind: 'service', options: [], offline: true });
  for (const args of [['--group', 'terminal'], ['--workers', '1'], ['--file', 'lib/nix-service.test.mjs']]) {
    assert.throws(() => validateArgs(['service', ...args]));
  }
  const nix = fs.readFileSync(new URL('../nix/vm-test.nix', import.meta.url), 'utf8');
  assert.match(nix, /assert workers == 1/); assert.match(nix, /memoryMiB = 1536/); assert.match(nix, /diskMiB = 2048/);
  for (const setting of ['mountHostNixStore = false', 'restrictNetwork = true', 'vlans = [ ]', 'forwardPorts = [ ]']) assert.ok(nix.includes(setting));
  assert.doesNotMatch(nix, /pkgs\.chromium|cp -R|cp -r.*modules|@chromium@|Service\.ExecStart|TimeoutStopSec|pkgs\.playwright|jsdom|mountHostNixStore = true/);
  assert.equal(nix.match(/ln -s.*node_modules/g)?.length, 1);
  assert.ok(nix.includes('ln -s ${modules}/node_modules "$out/node_modules"'));
  assert.ok(nix.includes('cp -r ${src}/. "$out/"'));
  assert.ok(nix.includes('storeRoots = [ config.system.build.toplevel support migrationSource ]'));
  assert.ok(nix.includes('pkgs.python3 pkgs.git pkgs.acl'));
  assert.ok(nix.includes('KillMode = "control-group"'));
  assert.ok(nix.includes('TimeoutStartSec = 240'));
  assert.doesNotMatch(nix, /brabbler-test-deny-xattrs/);
  for (const file of ['service-plan.mjs', 'service-smoke.mjs']) {
    const source = fs.readFileSync(new URL(`../nix/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(?:e2e|vm-plan|playwright)|node:child_process/);
  }
  const runner = fs.readFileSync(new URL('../nix/run-vm.mjs', import.meta.url), 'utf8');
  assert.ok(runner.includes("validateArgs(['service', ...args])"));
  assert.ok(runner.includes("'--argstr', 'workers', '1'"));
  assert.ok(runner.includes('const evidence = validateServiceEvidence('));
  const collection = runner.indexOf('validateServiceArtifacts(path.join('), acceptance = runner.indexOf('report.evidence = evidence;');
  assert.ok(collection >= 0 && acceptance > collection);
  assert.ok(runner.indexOf('await validateMigrationArtifacts(') > collection);
  assert.ok(runner.indexOf('await validateMigrationArtifacts(') < acceptance);
  assert.ok(runner.includes('report.execution.settled && !report.execution.interrupted && report.evidence'));
});

test('failed HTTP status/body evidence is bounded, private, closed and never changes the original verdict', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-failed-http-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = http.createServer((request, response) => {
    response.writeHead(500);
    response.end(request.url === '/large' ? 'x'.repeat(diagnosticLimits.bodyBytes * 2) : 'synthetic failed body');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let original;
    await assert.rejects(recordSmokeMode(root, 'http-write', async diagnostics => {
      try { return await requestJSON(base, '/failure', { diagnostics }); }
      catch (error) { original = error; throw error; }
    }), error => error === original && /HTTP 500/.test(error.message));
    const file = path.join(root, 'http-write-failure.json');
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(report.status, 'failed'); assert.equal(report.mode, 'http-write');
    assert.equal(report.error.message, original.message); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(root, 'http-write.json')), false);
    const request = report.diagnostics.requests[0];
    assert.equal(request.status, 500); assert.equal(request.body, 'synthetic failed body');
    assert.equal(request.bodyComplete, true); assert.equal(request.closed, true);
    const diagnostics = createSmokeDiagnostics();
    await assert.rejects(requestJSON(base, '/large', { diagnostics }), /HTTP 500/);
    assert.ok(Buffer.byteLength(diagnostics.requests[0].body) <= diagnosticLimits.bodyBytes);
    assert.equal(diagnostics.requests[0].bodyTruncated, true); assert.equal(diagnostics.requests[0].closed, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('partial PTY/SSE and original error survive failure in a separate private mode diagnostic', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-failed-pty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = http.createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ type: 'output', data: 'partial native shell output\r\n', offset: 29 }) + '\n\n' +
      'data: ' + JSON.stringify({ type: 'exit', exitCode: 7 }) + '\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, { plan } = fixture();
  try {
    let original;
    await assert.rejects(recordSmokeMode(root, 'pty', async diagnostics => {
      try { return await terminalOutput(base, plan, '/home/t0/brabbler-cwd-20261015', undefined, diagnostics); }
      catch (error) { original = error; throw error; }
    }), error => error === original && /PTY exited\/closed/.test(error.message));
    const report = JSON.parse(fs.readFileSync(path.join(root, 'pty-failure.json'), 'utf8'));
    assert.equal(report.error.message, original.message);
    assert.match(report.diagnostics.pty.output, /partial native shell output/);
    assert.match(report.diagnostics.pty.rawSse, /"exitCode":7/);
    assert.deepEqual(report.diagnostics.pty.eventTypes, ['output', 'exit']);
    assert.ok(Buffer.byteLength(report.diagnostics.pty.rawSse) <= diagnosticLimits.transcriptBytes);
    assert.equal(report.diagnostics.requests[0].closed, true); assert.equal(fs.existsSync(path.join(root, 'pty.json')), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a diagnostic write refusal preserves the exact primary error and never overwrites a linked destination', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-failed-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sentinel = path.join(root, 'sentinel'); fs.writeFileSync(sentinel, 'original', { mode: 0o600 });
  fs.symlinkSync(sentinel, path.join(root, 'seed-failure.json'));
  const logs = []; t.mock.method(console, 'error', message => logs.push(message));
  const original = new Error('original seed failure');
  await assert.rejects(recordSmokeMode(root, 'seed', async () => { throw original; }), error => error === original);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'original');
  assert.equal(logs.length, 1); assert.match(logs[0], /Failure diagnostic retention failed/);
});

test('actual driver retains guest hash authority, safe core exports and bounded existing-channel boot diagnostics', () => {
  const file = new URL('../nix/vm-test.py', import.meta.url).pathname;
  execFileSync('python3', ['-I', '-B', '-c', `
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import tempfile
import traceback
from types import SimpleNamespace
source = Path(${JSON.stringify(file)}).read_text()
parsed = ast.parse(source)
proof = next(node for node in parsed.body if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == 'proof')
assert ast.unparse(proof.annotation) == 'dict[str, Any]'
assert any(isinstance(node, ast.ImportFrom) and node.module == 'typing' and any(alias.name == 'Any' for alias in node.names) for node in parsed.body)
names = {'require_existing_channel', 'copy_evidence', 'verify_exported_artifacts', 'diagnostic_channel_reachable', 'collect_helper_evidence', 'collect_core_evidence'}
functions = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in names]
assert len(functions) == len(names)
namespace = {'hashlib': hashlib, 'json': json, 'os': os, 're': re, 'shlex': shlex, 'stat': stat, 'traceback': traceback,
    'core_stage': '/var/lib/brabbler-evidence', 'helper_stage': '/var/lib/brabbler-helper-evidence', 'node': 'pinned-node',
    'service': {'home': '/home/t0', 'evidence': '/home/t0/evidence'}, 'errors': [], 'checks': [], 'proof': {'migration': None},
    'migration_execution': None,
    'clients_settled': True, 'acceptance_ready': False, 'diagnostic_reachable': True, 'collecting': True,
    'settlement': {'status': None, 'groups': [], 'port': None, 'migration': {'attempted': False, 'path': None, 'state': 'not-started'}}}
exec(compile(ast.Module(body=functions, type_ignores=[]), '<actual-service-collection>', 'exec'), namespace)
events = []
class Machine:
    up = True
    def is_up(self): return self.up
    def execute(self, command, timeout):
        assert timeout == 10
        events.append(('probe', command))
        return 0, 'brabbler-diagnostic-channel-v1'
    def succeed(self, command, timeout): events.append(('journal', command)); return ''
    def copy_from_machine(self, source, destination): events.append(('copy', source, destination))
    def start(self): raise AssertionError('diagnostics attempted another boot')
machine = Machine()
namespace['machine'] = machine
assert namespace['diagnostic_channel_reachable']() is True
assert namespace['acceptance_ready'] is False
machine.up = False
count = len(events)
assert namespace['diagnostic_channel_reachable']() is False
assert len(events) == count
machine.up = True
required = ${JSON.stringify(serviceArtifacts)}
namespace['plan'] = {'artifacts': required}
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    exported = root / 'guest' / 'brabbler-evidence'
    exported.mkdir(parents=True)
    guest_digests = {}
    for name in required:
        content = ('GUEST ' + name).encode()
        guest_digests[name] = hashlib.sha256(content).hexdigest()
        (exported / name).write_bytes(content)
    namespace['driver'] = SimpleNamespace(out_dir=root)
    namespace['command'] = lambda argv, **kwargs: events.append(('command', argv)) or ''
    def manifest(source, names=()):
        events.append(('guard-hash', source, bool(names)))
        if source == namespace['helper_stage']: raise ValueError('Unsafe evidence symbolic link: host-link')
        return {'digests': dict(guest_digests) if names else {}, 'missing': []}
    namespace['guest_tree_manifest'] = manifest
    helpers = namespace['collect_helper_evidence']()
    assert helpers is False
    assert namespace['collect_core_evidence'](helpers) is False
    assert not any(event[0] == 'copy' and event[1] == namespace['helper_stage'] for event in events)
    assert ('copy', namespace['core_stage'], 'guest') in events
    assert len([event for event in events if event[0] == 'journal']) == 2
    hashed = events.index(('guard-hash', namespace['core_stage'], True))
    copied = events.index(('copy', namespace['core_stage'], 'guest'))
    assert hashed < copied
    assert namespace['artifacts'] == guest_digests
    # Corruption on the transfer side cannot become a freshly matching receipt.
    (exported / 'journal.log').write_text('CORRUPTED DURING TRANSFER')
    assert namespace['collect_core_evidence'](True) is False
    assert namespace['artifacts'] == guest_digests
    assert any('hash mismatch' in error for error in namespace['errors'])
    try: namespace['verify_exported_artifacts'](exported, guest_digests, required)
    except AssertionError: pass
    else: raise AssertionError('transfer corruption was accepted')
assert source.index('assertEvidenceTree(root);') < source.index('for (const name of names)')
assert 'initial.uid === 0' in source and '(initial.mode & 0o777) === 0o700' in source
# Execute the ACTUAL converter settlement helper with bounded observation faults.
settler = next(node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == 'settle_migration')
unit = 'brabbler-migration-acceptance.service'
def setup_settler():
    events = []
    state = {'migration_started': True, 'migration_prior_clients': True, 'clients_settled': False,
        'migration_execution': None, 'registry': {'migration': {'unit': unit}},
        'settlement': {'migration': {'attempted': True, 'path': '/system.slice/' + unit, 'state': 'uncertain'}}}
    def command(argv, timeout):
        assert argv[0] == 'systemctl' and argv[2] == unit
        events.append(argv[1])
        return 'Result=success\\nExecMainCode=1\\nExecMainStatus=0\\n'
    def observe(group, *, migration):
        assert group == '/system.slice/' + unit and migration is True
        events.append('observe')
        return 'absent'
    state.update(command=command, observe_cgroup=observe)
    exec(compile(ast.Module(body=[settler], type_ignores=[]), '<actual-migration-settlement>', 'exec'), state)
    return state, events
state, events = setup_settler()
state['settle_migration']()
assert events == ['show', 'observe', 'stop', 'observe']
assert state['clients_settled'] is True and state['settlement']['migration']['state'] == 'absent'
state['settle_migration']()
assert events == ['show', 'observe', 'stop', 'observe']  # No repeat stop/late work.
state, events = setup_settler()
state['migration_prior_clients'] = False
state['settle_migration']()
assert state['clients_settled'] is False  # Cannot repair an earlier uncertain client.
state, events = setup_settler()
def populated(*args, **kwargs): raise AssertionError('populated')
state['observe_cgroup'] = populated
try: state['settle_migration']()
except AssertionError: pass
else: raise AssertionError('converter leak was accepted')
assert events == ['show', 'stop'] and state['clients_settled'] is False
assert state['settlement']['migration']['state'] == 'uncertain'
state, events = setup_settler()
def failed_stop(argv, timeout):
    if argv[1] == 'stop': raise RuntimeError('stop unavailable')
    return 'Result=timeout\\nExecMainCode=2\\nExecMainStatus=15\\n'
state['command'] = failed_stop
try: state['settle_migration']()
except RuntimeError: pass
else: raise AssertionError('uncertain converter stop was accepted')
assert state['clients_settled'] is False
assert state['settlement']['migration']['state'] == 'uncertain'
state, events = setup_settler()
state['migration_started'] = False
state['settle_migration']()
assert events == []
`]);
});
