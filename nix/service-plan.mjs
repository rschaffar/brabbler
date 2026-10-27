// Fixed deployment contract. No browser inventory, scheduler or test dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const serviceResources = Object.freeze({ workers: 1, cpus: 1, memoryMiB: 1536, diskMiB: 2048 });
export const serviceChecks = Object.freeze(['activation', 'environment-permissions', 'http-write', 'restart-persistence', 'production-pty']);
export const serviceArtifacts = Object.freeze(['journal.log', 'service.log', 'observations.json', 'fixtures.tar.gz']);
const store = '/nix/store/[a-z0-9]{32}-[^/]+';

export function validateServiceRegistry(registry) {
  assert.equal(registry?.version, 1);
  assert.equal(registry.kind, 'brabbler-service-registry');
  assert.match(registry.package ?? '', new RegExp(`^${store}/lib/node_modules/brabbler$`));
  const root = registry.package.slice(0, -'/lib/node_modules/brabbler'.length);
  assert.equal(registry.launcher, `${root}/bin/brabbler`);
  assert.match(registry.shell ?? '', new RegExp(`^${store}/bin/bash$`));
  assert.match(registry.service?.controller ?? '', new RegExp(`^${store}/bin/brabbler-deployment-control$`));
  assert.deepEqual(registry, {
    version: 1, kind: 'brabbler-service-registry', package: registry.package, launcher: registry.launcher, shell: registry.shell,
    resources: { ...serviceResources }, service: {
      user: 't0', uid: 1000, home: '/home/t0', port: 30141, unit: 'brabbler.service',
      envFile: '/home/t0/service.env', fixture: '/home/t0/fixtures', agentDir: '/home/t0/fixtures/agent',
      evidence: '/home/t0/evidence', controller: registry.service.controller,
    },
  });
  return registry;
}

export function createServicePlan(registry) {
  validateServiceRegistry(registry);
  return {
    version: 1, kind: 'brabbler-service-plan', registry: structuredClone(registry), checks: [...serviceChecks],
    session: { id: 'vm-service-smoke', name: 'VM durable service session',
      file: `${registry.service.agentDir}/sessions/smoke/2026-10-15T00-00-00-000Z_vm-service-smoke.jsonl` },
    terminal: { id: '0123456789abcdef0123456789abcdef', cols: 91, rows: 27 },
    artifacts: [...serviceArtifacts],
  };
}

export function serviceEnvironment(registry) {
  validateServiceRegistry(registry);
  return {
    HOME: registry.service.home, PI_CODING_AGENT_DIR: registry.service.agentDir, BRABBLER_SKIP_VERSION_CHECK: '1',
    PI_OFFLINE: '1', NODE_ENV: 'production', SHELL: registry.shell, BRABBLER_REQUIRE_AUTH: '1',
    BRABBLER_SERVICE_UNIT: 'unit-value', BRABBLER_SERVICE_FILE: 'runtime file $literal',
    BRABBLER_SERVICE_OVERRIDE: 'runtime-file-wins', BRABBLER_SERVICE_RUNTIME: '/run/user/1000',
  };
}

export function serviceCgroup(group) {
  assert.equal(typeof group, 'string');
  assert.match(group, /^\/user\.slice\/user-1000\.slice\/user@1000\.service\/(?:[A-Za-z0-9_.@:-]+\/)*brabbler\.service$/);
  assert.equal(group.trim(), group);
  assert.ok(!group.split('/').some(part => part === '.' || part === '..'));
  return group;
}

export function validateServiceGeneration(generation) {
  assert.deepEqual(Object.keys(generation ?? {}).sort(), ['ActiveState', 'SubState', 'InvocationID', 'MainPID', 'NRestarts', 'ControlGroup', 'Result'].sort());
  assert.equal(generation?.ActiveState, 'active'); assert.equal(generation.SubState, 'running');
  assert.match(generation.InvocationID ?? '', /^[a-f0-9]{32}$/);
  assert.match(generation.MainPID ?? '', /^[1-9][0-9]*$/);
  assert.equal(generation.NRestarts, '0'); assert.equal(generation.Result, 'success');
  serviceCgroup(generation.ControlGroup);
  return generation;
}

function sessionProof(snapshot, plan) {
  assert.deepEqual(snapshot, { ids: [plan.session.id], id: plan.session.id, name: plan.session.name, file: plan.session.file });
}

export function validateWorkspace(workspace, registry) {
  assert.match(workspace?.path ?? '', /^\/home\/t0\/brabbler-cwd-[0-9]{8}$/);
  assert.deepEqual(workspace, { path: workspace.path, uid: registry.service.uid, mode: '0700', physical: true });
  return workspace;
}

// The host independently verifies the files named by the guest driver's receipt.
// This never grants ownership/cleanup authority; it can only veto collection.
export function validateServiceArtifacts(root, artifacts) {
  assert.equal(fs.realpathSync(root), root);
  assert.ok(fs.lstatSync(root).isDirectory());
  assert.deepEqual(Object.keys(artifacts).sort(), [...serviceArtifacts].sort());
  for (const name of serviceArtifacts) {
    assert.match(artifacts[name], /^[a-f0-9]{64}$/);
    const fd = fs.openSync(path.join(root, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      assert.ok(stat.isFile() && stat.nlink === 1, `Unsafe collected service artifact: ${name}`);
      const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const size = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!size) break;
        hash.update(buffer.subarray(0, size));
      }
      assert.equal(hash.digest('hex'), artifacts[name], `Collected service artifact changed: ${name}`);
    } finally { fs.closeSync(fd); }
  }
  return artifacts;
}

export function validateServiceEvidence(receipt, plan) {
  try {
    assert.deepEqual(plan, createServicePlan(plan?.registry));
    const registry = plan.registry, service = registry.service;
    assert.deepEqual(Object.keys(receipt ?? {}).sort(), ['version', 'kind', 'plan', 'passed', 'checks', 'proof', 'clientsSettled',
      'settlement', 'collectionProbe', 'artifactsCollected', 'artifacts', 'errors', 'elapsedSeconds'].sort());
    assert.equal(receipt.version, 1); assert.equal(receipt.kind, 'brabbler-service-evidence'); assert.deepEqual(receipt.plan, plan);
    assert.equal(typeof receipt.passed, 'boolean');
    assert.equal(receipt.clientsSettled, true); assert.equal(receipt.collectionProbe, true); assert.equal(receipt.artifactsCollected, true);
    assert.ok(Number.isFinite(receipt.elapsedSeconds) && receipt.elapsedSeconds >= 0);
    assert.ok(Array.isArray(receipt.errors) && receipt.errors.every(error => typeof error === 'string' && error.length > 0));
    assert.deepEqual(Object.keys(receipt.artifacts).sort(), [...plan.artifacts].sort());
    for (const digest of Object.values(receipt.artifacts)) assert.match(digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(receipt.proof).sort(), ['activation', 'permissions', 'write', 'restart', 'pty'].sort());
    assert.equal(receipt.checks.length, serviceChecks.length);
    let admissionClosed = false;
    for (const [i, check] of receipt.checks.entries()) {
      assert.deepEqual(Object.keys(check).sort(), ['name', 'status']);
      assert.equal(check.name, serviceChecks[i]); assert.ok(['passed', 'failed', 'not-run'].includes(check.status));
      if (check.status === 'passed') assert.equal(admissionClosed, false, 'A failed/unstarted proof cannot be skipped');
      else {
        admissionClosed = true;
        assert.equal(receipt.proof[['activation', 'permissions', 'write', 'restart', 'pty'][i]], null);
      }
    }
    if (receipt.passed) {
      assert.deepEqual(receipt.checks.map(check => check.status), serviceChecks.map(() => 'passed'));
      assert.deepEqual(receipt.errors, []);
    } else assert.ok(receipt.errors.length || receipt.checks.some(check => check.status !== 'passed'));
    const completed = name => receipt.checks.find(check => check.name === name).status === 'passed';
    const proof = receipt.proof;
    if (completed('activation')) {
      assert.deepEqual(Object.keys(proof.activation).sort(), ['link', 'target', 'launcher', 'fragment', 'managerWasInactive', 'generation'].sort());
      assert.equal(proof.activation.managerWasInactive, true);
      assert.equal(proof.activation.link, `${service.home}/.config/systemd/user/default.target.wants/${service.unit}`);
      assert.match(proof.activation.target, new RegExp(`^${store}(?:/[^/]+)*$`));
      assert.equal(proof.activation.fragment, proof.activation.target);
      assert.equal(proof.activation.launcher, registry.launcher);
      validateServiceGeneration(proof.activation.generation);
    }
    if (completed('environment-permissions')) {
      const permissions = proof.permissions;
      assert.deepEqual(Object.keys(permissions).sort(), ['environment', 'uid', 'umask', 'cwd', 'launcherScript', 'paths', 'deniedReads'].sort());
      assert.deepEqual(permissions.environment, serviceEnvironment(registry));
      assert.equal(permissions.uid, service.uid); assert.equal(permissions.umask, '0077');
      assert.equal(permissions.cwd, service.home); assert.equal(permissions.launcherScript, `${registry.package}/bin/brabbler.js`);
      const expectedPaths = Object.fromEntries([
        ['home', service.home, '0700'], ['fixture', service.fixture, '0700'], ['agent', service.agentDir, '0700'],
        ['evidence', service.evidence, '0700'], ['environment', service.envFile, '0600'], ['session', plan.session.file, '0600'],
      ].map(([name, file, mode]) => [name, { path: file, uid: service.uid, mode, physical: true, ...(mode === '0600' ? { links: 1 } : {}) }]));
      assert.deepEqual(permissions.paths, expectedPaths);
      assert.deepEqual(permissions.deniedReads, { environment: true, session: true });
    }
    if (completed('http-write')) {
      assert.deepEqual(Object.keys(proof.write).sort(), ['session', 'workspace']);
      sessionProof(proof.write.session, plan); validateWorkspace(proof.write.workspace, registry);
    }
    if (completed('restart-persistence')) {
      assert.deepEqual(Object.keys(proof.restart).sort(), ['after', 'before', 'session']);
      assert.equal(completed('activation'), true); assert.equal(completed('http-write'), true);
      validateServiceGeneration(proof.restart.before); validateServiceGeneration(proof.restart.after);
      assert.deepEqual(proof.restart.before, proof.activation.generation);
      assert.notEqual(proof.restart.before.InvocationID, proof.restart.after.InvocationID);
      sessionProof(proof.restart.session, plan);
    }
    if (completed('production-pty')) {
      assert.equal(completed('restart-persistence'), true);
      const pty = proof.pty;
      assert.deepEqual(Object.keys(pty).sort(), ['id', 'tty', 'uid', 'cwd', 'environment', 'cols', 'rows', 'pid', 'controlGroup', 'alive', 'leftRunning'].sort());
      assert.equal(pty.id, plan.terminal.id); assert.match(pty.tty, /^\/dev\/pts\/[0-9]+$/);
      assert.equal(pty.uid, service.uid); assert.equal(pty.cwd, proof.write.workspace.path);
      assert.deepEqual(pty.environment, Object.fromEntries(['BRABBLER_SERVICE_UNIT', 'BRABBLER_SERVICE_FILE', 'BRABBLER_SERVICE_OVERRIDE']
        .map(key => [key, serviceEnvironment(registry)[key]])));
      assert.equal(pty.cols, plan.terminal.cols); assert.equal(pty.rows, plan.terminal.rows);
      assert.match(pty.pid, /^[1-9][0-9]*$/); assert.equal(pty.alive, true); assert.equal(pty.leftRunning, true);
      assert.equal(pty.controlGroup, proof.restart.after.ControlGroup); serviceCgroup(pty.controlGroup);
    }
    const settlement = receipt.settlement;
    assert.deepEqual(Object.keys(settlement).sort(), ['groups', 'port', 'status']);
    assert.equal(settlement.status?.ActiveState, 'inactive'); assert.equal(settlement.status.MainPID, '0');
    assert.equal(settlement.port, 'refused');
    assert.ok(Array.isArray(settlement.groups) && settlement.groups.length > 0);
    const paths = settlement.groups.map(group => {
      assert.deepEqual(Object.keys(group).sort(), ['path', 'state']);
      serviceCgroup(group.path); assert.ok(['empty', 'absent'].includes(group.state)); return group.path;
    });
    assert.equal(new Set(paths).size, paths.length);
    for (const generation of [proof.activation?.generation, proof.restart?.after]) {
      if (generation) assert.ok(paths.includes(serviceCgroup(generation.ControlGroup)));
    }
    if (settlement.status.ControlGroup) assert.ok(paths.includes(serviceCgroup(settlement.status.ControlGroup)));
    return receipt;
  } catch (error) { throw new Error(`Missing/incomplete service evidence collection: ${error.message}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, file] = process.argv.slice(2);
    if (mode === 'plan') console.log(JSON.stringify(createServicePlan(JSON.parse(fs.readFileSync(file, 'utf8')))));
    else if (mode === 'receipt') {
      const input = JSON.parse(fs.readFileSync(0, 'utf8')); validateServiceEvidence(input.receipt, input.plan);
    } else throw new Error('Unknown service plan operation');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
