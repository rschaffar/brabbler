import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServicePlan, serviceCgroup, serviceResources, validateServiceArtifacts, validateServiceEvidence, validateServiceRegistry } from '../nix/service-plan.mjs';
import { createSmokeDiagnostics, diagnosticLimits, parsePtyProof, recordSmokeMode, requestJSON, terminalOutput, writePrivateEnvironment } from '../nix/service-smoke.mjs';
import { validateArgs } from '../nix/test.mjs';

// Independent synthetic deployment bindings; never executable service authority.
const store = `/nix/store/${'a'.repeat(32)}-pi-web`;
const group = '/user.slice/user-1000.slice/user@1000.service/app.slice/pi-web.service';
function registryFixture() {
  return { version: 1, kind: 'pi-web-service-registry', package: `${store}/lib/node_modules/@agegr/pi-web`,
    launcher: `${store}/bin/pi-web`, shell: `/nix/store/${'b'.repeat(32)}-bash/bin/bash`,
    resources: { workers: 1, cpus: 1, memoryMiB: 1536, diskMiB: 2048 },
    service: { user: 't0', uid: 1000, home: '/home/t0', port: 30141, unit: 'pi-web.service',
      envFile: '/home/t0/service.env', fixture: '/home/t0/fixtures', agentDir: '/home/t0/fixtures/agent',
      evidence: '/home/t0/evidence', controller: `/nix/store/${'c'.repeat(32)}-control/bin/pi-web-deployment-control` } };
}
function fixture() {
  const registry = registryFixture(), plan = createServicePlan(registry);
  const before = { ActiveState: 'active', SubState: 'running', InvocationID: 'a'.repeat(32), MainPID: '42',
    NRestarts: '0', ControlGroup: group, Result: 'success' };
  const after = { ...before, InvocationID: 'b'.repeat(32), MainPID: '43' };
  const session = { ids: ['vm-service-smoke'], id: 'vm-service-smoke', name: 'VM durable service session',
    file: '/home/t0/fixtures/agent/sessions/smoke/2026-10-15T00-00-00-000Z_vm-service-smoke.jsonl' };
  const environment = { HOME: '/home/t0', PI_CODING_AGENT_DIR: '/home/t0/fixtures/agent', PI_WEB_SKIP_VERSION_CHECK: '1',
    PI_OFFLINE: '1', NODE_ENV: 'production', SHELL: registry.shell, PI_WEB_SERVICE_UNIT: 'unit-value',
    PI_WEB_SERVICE_FILE: 'runtime file $literal', PI_WEB_SERVICE_OVERRIDE: 'runtime-file-wins', PI_WEB_SERVICE_RUNTIME: '/run/user/1000' };
  const paths = Object.fromEntries([
    ['home', '/home/t0', '0700'], ['fixture', '/home/t0/fixtures', '0700'], ['agent', '/home/t0/fixtures/agent', '0700'],
    ['evidence', '/home/t0/evidence', '0700'], ['environment', '/home/t0/service.env', '0600'], ['session', session.file, '0600'],
  ].map(([name, file, mode]) => [name, { path: file, uid: 1000, mode, physical: true, ...(mode === '0600' ? { links: 1 } : {}) }]));
  const receipt = { version: 1, kind: 'pi-web-service-evidence', plan: structuredClone(plan), passed: true,
    checks: ['activation', 'environment-permissions', 'http-write', 'restart-persistence', 'production-pty']
      .map(name => ({ name, status: 'passed' })),
    proof: {
      activation: { link: '/home/t0/.config/systemd/user/default.target.wants/pi-web.service',
        target: `/nix/store/${'d'.repeat(32)}-pi-web.service`, fragment: `/nix/store/${'d'.repeat(32)}-pi-web.service`,
        launcher: registry.launcher, managerWasInactive: true, generation: before },
      permissions: { uid: 1000, umask: '0077', cwd: '/home/t0', launcherScript: `${registry.package}/bin/pi-web.js`,
        environment, paths, deniedReads: { environment: true, session: true } },
      write: { session: structuredClone(session), workspace: { path: '/home/t0/pi-cwd-20261015', uid: 1000, mode: '0700', physical: true } },
      restart: { before: structuredClone(before), after, session: structuredClone(session) },
      pty: { id: '0123456789abcdef0123456789abcdef', tty: '/dev/pts/0', uid: 1000, pid: '44', cwd: '/home/t0/pi-cwd-20261015',
        environment: { PI_WEB_SERVICE_UNIT: 'unit-value', PI_WEB_SERVICE_FILE: 'runtime file $literal', PI_WEB_SERVICE_OVERRIDE: 'runtime-file-wins' },
        cols: 91, rows: 27, controlGroup: group, alive: true, leftRunning: true },
    },
    clientsSettled: true, settlement: { status: { ActiveState: 'inactive', MainPID: '0', ControlGroup: '' },
      groups: [{ path: group, state: 'absent' }], port: 'refused' },
    collectionProbe: true, artifactsCollected: true,
    artifacts: Object.fromEntries(['journal.log', 'service.log', 'observations.json', 'fixtures.tar.gz'].map(name => [name, 'e'.repeat(64)])),
    errors: [], elapsedSeconds: 1,
  };
  return { registry, plan, receipt };
}

test('fixed deployment plan is independent of browser selection and has explicit mandatory proofs', () => {
  const { registry, plan } = fixture();
  assert.deepEqual(plan, createServicePlan(registry));
  assert.deepEqual(plan.checks, ['activation', 'environment-permissions', 'http-write', 'restart-persistence', 'production-pty']);
  assert.deepEqual(plan.registry.resources, { workers: 1, cpus: 1, memoryMiB: 1536, diskMiB: 2048 });
  assert.deepEqual(serviceResources, plan.registry.resources);
  assert.deepEqual(plan.artifacts, ['journal.log', 'service.log', 'observations.json', 'fixtures.tar.gz']);
  assert.equal(plan.jobs, undefined); assert.equal(plan.focus, undefined);
  for (const change of [r => r.service.uid = 0, r => r.service.user = 'other', r => r.service.port = 30142,
    r => r.service.home = '/root', r => r.service.envFile = '/tmp/env', r => r.service.unit = 'other.service',
    r => r.service.controller = '/tmp/control', r => r.resources.workers = 2, r => r.resources.memoryMiB = 4096,
    r => r.launcher = '/usr/bin/pi-web', r => r.package = '/checkout', r => r.shell = '/bin/bash',
    r => r.kind = 'browser', r => r.extra = true]) {
    const broken = structuredClone(registry); change(broken); assert.throws(() => validateServiceRegistry(broken));
  }
});

test('passed service evidence cannot omit activation, permissions, durable restart, native PTY or exact bindings', () => {
  const good = fixture(); assert.equal(validateServiceEvidence(good.receipt, good.plan), good.receipt);
  for (const change of [
    r => r.checks.pop(), r => r.checks[0].status = 'not-run', r => r.checks.reverse(),
    r => r.proof.activation.managerWasInactive = false, r => r.proof.activation.fragment = '/wrong/unit',
    r => r.proof.activation.generation.NRestarts = '1', r => r.proof.activation.generation.Result = 'signal',
    r => r.proof.permissions.environment.PI_WEB_SERVICE_OVERRIDE = 'unit-value-must-be-overridden',
    r => r.proof.permissions.umask = '0022', r => r.proof.permissions.paths.environment.links = 2,
    r => r.proof.permissions.paths.home.mode = '0755', r => r.proof.permissions.paths.session.uid = 0,
    r => r.proof.permissions.deniedReads.environment = false, r => r.proof.permissions.launcherScript = '/checkout/bin/pi-web.js',
    r => r.proof.write.session.name = 'not written', r => r.proof.write.workspace.path = '/tmp/workspace',
    r => r.proof.restart.after.InvocationID = r.proof.restart.before.InvocationID,
    r => r.proof.restart.before.MainPID = '999', r => r.proof.restart.session.ids = [],
    r => r.proof.pty.tty = 'pipe', r => r.proof.pty.uid = 0, r => r.proof.pty.cwd = '/tmp',
    r => r.proof.pty.environment.PI_WEB_SERVICE_FILE = 'missing', r => r.proof.pty.rows = 24,
    r => r.proof.pty.leftRunning = false, r => r.proof.pty.alive = false,
    r => r.proof.pty.controlGroup = '/user.slice/user-1001.slice/user@1001.service/app.slice/pi-web.service',
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
  receipt.proof = { activation: null, permissions: null, write: null, restart: null, pty: null };
  assert.equal(validateServiceEvidence(receipt, plan), receipt);
  for (const change of [r => r.clientsSettled = false, r => r.collectionProbe = false, r => r.artifactsCollected = false,
    r => delete r.artifacts['fixtures.tar.gz'], r => r.artifacts['journal.log'] = 'not a digest',
    r => r.settlement.status.MainPID = '42', r => r.settlement.status.ActiveState = 'active',
    r => r.settlement.port = 'HTTP 500', r => r.settlement.groups = [],
    r => r.settlement.groups[0].state = 'populated', r => r.settlement.groups[0].state = 'unreadable',
    r => r.settlement.groups[0].path += '/../../foreign', r => r.kind = 'pi-web-browser-evidence', r => r.version = 2,
    r => r.groups = []]) {
    const broken = structuredClone(receipt); change(broken);
    assert.throws(() => validateServiceEvidence(broken, plan), /service evidence/);
  }
  for (const value of [group + '-other', group + '\n', '/system.slice/pi-web.service', group.replace('1000', '1001'), group + '/../pi-web.service']) {
    assert.throws(() => serviceCgroup(value));
  }
});

test('host artifact verification refuses missing, changed, linked or aliased collection independently of receipt booleans', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-artifacts-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'evidence'); fs.mkdirSync(directory, { mode: 0o700 });
  const artifacts = {};
  for (const name of ['journal.log', 'service.log', 'observations.json', 'fixtures.tar.gz']) {
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
  const { registry, plan } = fixture(), workspace = '/home/t0/pi-cwd-20261015';
  const output = '\r\nPIWEB_BEGIN\r\nPIWEB_TTY:/dev/pts/0\r\nPIWEB_UID:1000\r\nPIWEB_PID:44\r\n' +
    'PIWEB_CWD:/home/t0/pi-cwd-20261015\r\nPIWEB_UNIT:unit-value\r\nPIWEB_FILE:runtime file $literal\r\n' +
    'PIWEB_OVERRIDE:runtime-file-wins\r\nPIWEB_SIZE:27 91\r\nPIWEB_END\r\n';
  assert.equal(parsePtyProof(output, workspace, registry, plan.terminal).pid, '44');
  for (const bad of ["printf '%s%s\\n' PIWEB_ BEGIN", JSON.stringify({ id: plan.terminal.id }),
    output.replace('PIWEB_TTY:/dev/pts/0\r\n', ''), output.replace('/dev/pts/0', 'pipe'),
    output.replace('PIWEB_UID:1000', 'PIWEB_UID:0'), output.replace('27 91', '24 80'),
    output.replace('runtime file $literal', 'missing'), output.replace('PIWEB_END', 'not done')]) {
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
  assert.doesNotMatch(nix, /pkgs\.chromium|cp -R|ln -s.*node_modules|modules\}\/node_modules|@chromium@|Service\.ExecStart|TimeoutStopSec/);
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
      try { return await terminalOutput(base, plan, '/home/t0/pi-cwd-20261015', undefined, diagnostics); }
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
    'core_stage': '/var/lib/pi-web-evidence', 'helper_stage': '/var/lib/pi-web-helper-evidence', 'node': 'pinned-node',
    'service': {'home': '/home/t0', 'evidence': '/home/t0/evidence'}, 'errors': [], 'checks': [], 'proof': {},
    'clients_settled': True, 'acceptance_ready': False, 'diagnostic_reachable': True, 'collecting': True,
    'settlement': {'status': None, 'groups': [], 'port': None}}
exec(compile(ast.Module(body=functions, type_ignores=[]), '<actual-service-collection>', 'exec'), namespace)
events = []
class Machine:
    up = True
    def is_up(self): return self.up
    def execute(self, command, timeout):
        assert timeout == 10
        events.append(('probe', command))
        return 0, 'pi-web-diagnostic-channel-v1'
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
required = ['journal.log', 'service.log', 'observations.json', 'fixtures.tar.gz']
namespace['plan'] = {'artifacts': required}
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    exported = root / 'guest' / 'pi-web-evidence'
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
`]);
});
