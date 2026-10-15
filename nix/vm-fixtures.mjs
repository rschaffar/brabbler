// Synthetic contract fixtures, never executable service bindings.
import { createPlan } from './vm-plan.mjs';
export function registryFixture(workers = 2) {
  return { version: 1, package: `/nix/store/${'a'.repeat(32)}-package/lib/node_modules/@agegr/pi-web`,
    resources: { workers, cpus: workers * 2, memoryMiB: workers * 4096 },
    lanes: Array.from({ length: workers }, (_, i) => ({ id: `l${i}`, user: `t${i}`, uid: 1000 + i,
      home: `/home/t${i}`, port: 30141 + i, envFile: `/home/t${i}/service.env`, unit: 'pi-web.service',
      controller: `/nix/store/${'b'.repeat(32)}-controller/bin/pi-web-test-service-l${i}` })) };
}
export function evidenceFixture(focus = 'all', workers = 2) {
  const plan = createPlan(registryFixture(workers), focus);
  const receipt = { version: 2, plan, passed: true, artifactsCollected: true, serviceStopped: true, runnersStopped: true, collectionProbe: true,
    lanes: plan.lanes.map(lane => ({ id: lane.id, collected: true, serviceStopped: true, runnersStopped: true,
      smoke: true, restart: lane.groups.length ? true : null })),
    groups: plan.jobs.map(job => {
      const lane = plan.lanes.find(lane => lane.id === job.lane);
      return { name: job.name, lane: lane.id, status: 'passed', elapsedSeconds: 1, runnerSettled: true,
        runner: { InvocationID: 'b'.repeat(32), ExecMainStatus: '0', Result: 'success', MainPID: '0', ControlGroup: `/system.slice/${job.unit}` },
        harness: { status: 'passed', root: plan.package, interrupted: false, errors: [], resourcesSettled: true, fixtureRoot: job.fixture, artifacts: job.evidence,
          server: { lane: lane.id, scope: 'systemd-user-service', settled: true, cgroup: 'absent',
            generation: { InvocationID: 'a'.repeat(32), MainPID: '42', NRestarts: '0', ControlGroup: `/user.slice/user-${lane.uid}.slice/user@${lane.uid}.service/app.slice/pi-web.service` } } },
        coverage: { version: 1, group: job.name, expected: job.scenarios, completed: job.scenarios, active: null, status: 'passed' } };
    }) };
  return { plan, receipt };
}
