// Pure, deterministic planning/receipt contracts shared by fresh and check drivers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groups, scenarios } from '../e2e/scenarios.mjs';
import { availableResources } from './resources.mjs';

const GiB = 1024 ** 3;
export const weights = Object.freeze({
  state: 65, history: 190, 'extension-dialogs': 100, 'mobile-sidebar': 100,
  worktrees: 116, 'session-launch': 38, 'running-forks': 24, 'model-speed': 117,
  trust: 16, 'git-plugin': 216, appearance: 35, timestamps: 18,
  'diff-context': 110, markdown: 163, 'file-edit': 97, archive: 38, privacy: 113,
  activity: 169, accounts: 55, questions: 165, 'session-links': 16, bulk: 47,
  move: 68, 'ssh-agent': 30, terminal: 48,
});
export const coverageIds = group => group === 'terminal' ? ['terminal/full@production-pty'] : [...scenarios[group]];

export function workerBudget({ requested, resources = availableResources() } = {}) {
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > 4)) throw new Error('workers must be 1..4');
  const capacity = Math.min(4, Math.floor(resources.cpus / 2), Math.floor((resources.memory - 2 * GiB) / (4 * GiB)));
  const workers = requested ?? capacity;
  if (workers < 1 || workers > capacity) throw new Error('Insufficient VM budget: require 2 effective CPUs and 4GiB per lane, plus 2GiB host headroom');
  return { workers, cpus: workers * 2, memoryMiB: workers * 4096, resources,
    scope: 'Admission estimate, not a CPU/RSS reservation or machine-exclusive claim' };
}

export function combinedBudget(resources, vm, coreJobs) {
  // Each internal realization admits two builds of up to four cores. VM
  // realization precedes guest startup; core realization can overlap either.
  // Budget those peaks, not just the later Node file-worker count.
  const coreSlots = Math.min(coreJobs, 4);
  const cpuRequired = Math.max(vm.cpus, 8) + 8;
  const memoryRequired = (Math.max(vm.memoryMiB / 1024, 8) + Math.max(1 + coreSlots * 2, 8) + 2) * GiB;
  return { overlap: resources.cpus >= cpuRequired && resources.memory >= memoryRequired,
    cpuRequired, memoryRequired, realization: { maxJobsPerClient: 2, coresPerBuild: 4 },
    scope: 'Conservative admission estimate including realization, not a reservation' };
}

export function validateRegistry(registry) {
  assert.equal(registry?.version, 1);
  assert.match(registry.package, /^\/nix\/store\/[a-z0-9]{32}-[^/]+\/lib\/node_modules\/@agegr\/pi-web$/);
  assert.ok(Array.isArray(registry.lanes) && registry.lanes.length >= 1 && registry.lanes.length <= 4);
  assert.deepEqual(registry.resources, { workers: registry.lanes.length, cpus: registry.lanes.length * 2, memoryMiB: registry.lanes.length * 4096 });
  registry.lanes.forEach((lane, i) => {
    assert.equal(lane.id, `l${i}`); assert.equal(lane.user, `t${i}`); assert.equal(lane.uid, 1000 + i);
    assert.equal(lane.home, `/home/t${i}`); assert.equal(lane.port, 30141 + i);
    assert.equal(lane.envFile, `${lane.home}/service.env`); assert.equal(lane.unit, 'pi-web.service');
    assert.match(lane.controller, new RegExp(`^/nix/store/[a-z0-9]{32}-[^/]+/bin/pi-web-test-service-l${i}$`));
  });
  return registry;
}

export function createPlan(registry, focus = 'all') {
  validateRegistry(registry);
  assert.ok(focus === 'all' || Object.hasOwn(groups, focus), 'Unknown E2E group');
  assert.deepEqual(Object.keys(weights).sort(), Object.keys(groups).sort(), 'Every group requires a reviewed scheduling weight');
  const selected = focus === 'all' ? Object.keys(groups) : [focus];
  const lanes = registry.lanes.map(lane => ({ ...lane, groups: [], weightSeconds: 0 }));
  const jobs = selected.map((name, index) => ({ name, index, ...groups[name], scenarios: coverageIds(name), weightSeconds: weights[name] }));
  const sorted = [...jobs].sort((a, b) => b.weightSeconds - a.weightSeconds || a.index - b.index);
  for (const job of sorted) {
    const lane = [...lanes].sort((a, b) => a.weightSeconds - b.weightSeconds || a.id.localeCompare(b.id))[0];
    lane.groups.push(job.name); lane.weightSeconds += job.weightSeconds;
    Object.assign(job, { lane: lane.id, fixture: `${lane.home}/f/${String(job.index).padStart(2, '0')}`,
      evidence: `${lane.home}/evidence/${job.name}`, unit: `pi-web-e2e-${lane.id}-g${String(job.index).padStart(2, '0')}.service` });
  }
  return { version: 1, package: registry.package, resources: registry.resources, focus, selected, lanes, jobs };
}

export function validateGroup(job, lane, result, expectedPackage) {
  assert.equal(result?.status, 'passed', `${job.name}: non-pass result`);
  assert.equal(result.runner?.ExecMainStatus, '0'); assert.equal(result.runner?.Result, 'success');
  assert.match(result.runner?.InvocationID ?? '', /^[a-f0-9]{32}$/); assert.equal(result.runnerSettled, true);
  assert.equal(result.runner?.MainPID, '0');
  if (result.runner.ControlGroup) assert.equal(result.runner.ControlGroup, `/system.slice/${job.unit}`);
  const run = result.harness;
  assert.equal(run?.status, 'passed'); assert.equal(run?.resourcesSettled, true);
  assert.equal(run?.root, expectedPackage); assert.equal(run?.interrupted, false); assert.deepEqual(run?.errors, []);
  assert.equal(run?.fixtureRoot, job.fixture); assert.equal(run?.artifacts, job.evidence);
  assert.equal(run?.server?.scope, 'systemd-user-service'); assert.equal(run?.server?.settled, true);
  assert.ok(['empty', 'absent'].includes(run.server.cgroup));
  assert.equal(run.server.lane, lane.id);
  for (const field of ['unexpectedExit', 'error', 'logError']) assert.equal(run.server[field], undefined);
  assert.match(run.server.generation.InvocationID, /^[a-f0-9]{32}$/);
  assert.match(run.server.generation.MainPID, /^[1-9][0-9]*$/); assert.equal(run.server.generation.NRestarts, '0');
  assert.ok(run.server.generation.ControlGroup.startsWith(`/user.slice/user-${lane.uid}.slice/user@${lane.uid}.service/`));
  assert.ok(run.server.generation.ControlGroup.endsWith('/pi-web.service'));
  assert.deepEqual(result.coverage?.expected, job.scenarios); assert.deepEqual(result.coverage?.completed, job.scenarios);
  assert.equal(result.coverage?.version, 1); assert.equal(result.coverage?.group, job.name); assert.equal(result.coverage?.status, 'passed'); assert.equal(result.coverage?.active, null);
  return result;
}

export function validateEvidence(receipt, plan) {
  try {
    assert.equal(receipt?.version, 2); assert.deepEqual(receipt.plan, plan);
    assert.equal(typeof receipt.passed, 'boolean'); assert.equal(receipt.artifactsCollected, true); assert.equal(receipt.collectionProbe, true);
    assert.equal(receipt.serviceStopped, true); assert.equal(receipt.runnersStopped, true);
    assert.equal(receipt.lanes.length, plan.lanes.length); assert.equal(receipt.groups.length, plan.jobs.length);
    for (const [i, lane] of plan.lanes.entries()) {
      const result = receipt.lanes[i]; assert.equal(result.id, lane.id);
      assert.equal(result.collected, true); assert.equal(result.serviceStopped, true); assert.equal(result.runnersStopped, true);
      if (receipt.passed) { assert.equal(result.smoke, true); assert.equal(result.restart, lane.groups.length ? true : null); }
    }
    for (const [i, job] of plan.jobs.entries()) {
      const result = receipt.groups[i]; assert.equal(result.name, job.name); assert.equal(result.lane, job.lane);
      assert.ok(['passed', 'failed', 'not-run'].includes(result.status));
      if (result.status !== 'not-run') { assert.equal(result.runnerSettled, true); assert.ok(Number.isFinite(result.elapsedSeconds) && result.elapsedSeconds >= 0); }
      if (receipt.passed || result.status === 'passed') validateGroup(job, plan.lanes.find(lane => lane.id === job.lane), result, plan.package);
    }
    return receipt;
  } catch (error) { throw new Error(`Missing/incomplete VM evidence collection: ${error.message}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, registry, focus] = process.argv.slice(2);
  if (mode === 'plan') console.log(JSON.stringify(createPlan(JSON.parse(fs.readFileSync(registry, 'utf8')), focus)));
  else {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (mode === 'group') validateGroup(input.job, input.lane, input.result, input.package);
    else if (mode === 'receipt') validateEvidence(input.receipt, input.plan);
    else throw new Error('Unknown plan operation');
  }
}
