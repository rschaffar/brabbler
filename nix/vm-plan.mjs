// Shared acceptance budgets and genuine service-lane bindings.
// Browser planning and genuine deployment evidence have separate current owners.
import assert from 'node:assert/strict';
import { scenarios } from '../e2e/scenarios.mjs';
import { availableResources } from './resources.mjs';

const GiB = 1024 ** 3;
export const MAX_BROWSER_WORKERS = 8;
export const coverageIds = group => group === 'terminal' ? ['terminal/native-fonts-pty-touch-bounded-held-create-v3@production-pty'] : [...scenarios[group]];

export function workerBudget({ requested, resources = availableResources() } = {}) {
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > MAX_BROWSER_WORKERS)) throw new Error('workers must be 1..8');
  const capacity = Math.min(MAX_BROWSER_WORKERS, Math.floor(resources.cpus / 2), Math.floor((resources.memory - 2 * GiB) / (4 * GiB)));
  // Wider execution is opt-in until measured; retain the four-sandbox default.
  const workers = requested ?? Math.min(4, capacity);
  if (workers < 1 || workers > capacity) throw new Error('Insufficient VM budget: require 2 effective CPUs and 4GiB per lane, plus 2GiB host headroom');
  return { workers, cpus: workers * 2, memoryMiB: workers * 4096, resources,
    scope: 'Admission estimate, not a CPU/RSS reservation or machine-exclusive claim' };
}

export function coreBuildBudget(coreJobs = 4) {
  if (!Number.isInteger(coreJobs) || coreJobs < 1 || coreJobs > 32) throw new Error('jobs must be 1..32');
  return { maxJobs: 2, coresPerBuild: Math.max(4, Math.min(coreJobs, 12)) };
}

export function combinedBudget(resources, vm, coreJobs) {
  // Core realization can overlap browser preparation/execution or deployment.
  // Include both core builders at the SAME allocation used by run-core.mjs.
  const core = coreBuildBudget(coreJobs);
  const coreSlots = Math.min(coreJobs, core.coresPerBuild);
  const corePeakCpus = core.maxJobs * core.coresPerBuild;
  const cpuRequired = Math.max(vm.cpus, 8) + corePeakCpus;
  const memoryRequired = (Math.max(vm.memoryMiB / 1024, 8) + Math.max(1 + coreSlots * 2, corePeakCpus) + 2) * GiB;
  return { overlap: resources.cpus >= cpuRequired && resources.memory >= memoryRequired,
    cpuRequired, memoryRequired, realization: { maxJobsPerClient: core.maxJobs, coresPerBuild: core.coresPerBuild },
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
