// Fresh, bounded admission of whole-group Nix sandboxes. Never launch the app on the host.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateEnvironment, validateArgs } from './test.mjs';
import { workerBudget } from './vm-plan.mjs';
import { browserPlan, validateBrowserMetadata, requireBrowserPass } from './browser-plan.mjs';
import { assertEvidenceTree } from './vm-evidence.mjs';
import { runOwned } from './test-lifecycle.mjs';

export async function dispatchBrowserPlan(plan, execute, { signal, changed = () => {} } = {}) {
  let closed = false, persistenceError;
  const results = plan.jobs.map(job => ({ name: job.name, lane: job.lane, status: 'not-run' }));
  await Promise.allSettled(plan.lanes.map(async lane => {
    let result;
    try {
      for (const name of lane.groups) {
        if (closed || signal?.aborted) break;
        const job = plan.jobs.find(item => item.name === name);
        result = results[job.index];
        result.status = 'running'; changed(results);
        try { Object.assign(result, await execute(job)); result.status = 'passed'; }
        catch (error) { result.status = 'failed'; result.error = error.message; closed = true; }
        changed(results);
      }
    } catch (error) {
      closed = true; persistenceError ??= error;
      if (result?.status === 'running') { result.status = 'failed'; result.error = error.message; }
    }
  }));
  if (persistenceError) throw persistenceError;
  return results;
}

export function browserPreparationBudget(budget) {
  const GiB = 1024 ** 3;
  const maxJobs = Math.max(1, Math.min(2, budget.workers, Math.floor(budget.resources.cpus / 4),
    Math.floor((budget.resources.memory - 2 * GiB) / (4 * GiB))));
  const coresPerBuild = Math.max(1, Math.min(4, Math.floor(budget.resources.cpus / maxJobs)));
  return { maxJobs, coresPerBuild, peakCpus: maxJobs * coresPerBuild, memoryBytes: maxJobs * 4 * GiB,
    scope: 'Preparation admission estimate; capped by effective resources, not a reservation' };
}

export async function runBrowser(source, system, args) {
  const parsed = validateArgs(['e2e', ...args]);
  if (parsed.help) throw new Error('Use nix run .#test -- --help');
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(source ?? '') || !['x86_64-linux', 'aarch64-linux'].includes(system)) {
    throw new Error('Pinned Nix source and native Linux system required');
  }
  const option = name => parsed.options.includes(name) ? parsed.options[parsed.options.indexOf(name) + 1] : undefined;
  const group = option('--group') ?? 'all';
  const budget = workerBudget({ requested: option('--workers') ? Number(option('--workers')) : group === 'all' ? undefined : 1 });
  const preparationBudget = browserPreparationBudget(budget);
  const sourceDigest = process.env.PI_WEB_SOURCE_DIGEST ?? '';
  if (sourceDigest && !/^[a-f0-9]{64}$/.test(sourceDigest)) throw new Error('Invalid verified source digest');
  const hostNamespaces = Object.fromEntries(['net', 'pid', 'mnt'].map(name => [name, fs.readlinkSync(`/proc/self/ns/${name}`)]));
  const mask = process.umask(0o077);
  const root = fs.mkdtempSync('/tmp/pi-web-test-browser.');
  const env = privateEnvironment(root, process.env);
  for (const name of ['home', 'config', 'cache', 'data', 'state', 'runtime', 'agent', 'tmp', 'nix-conf', 'groups']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  const controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => controller.abort(signal)]));
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  const report = { version: 1, backend: 'nix-build-sandbox', fresh: true, source, sourceDigest, system, group, budget,
    runId: randomUUID(), hostNamespaces, preparationBudget, root, startedAt: new Date().toISOString(),
    sourceDigestProvenance: 'Outer-entrypoint value; pinned store source is independently matched, not an ambient authorization claim',
    containmentScope: 'Nix owns builder processes; host observations cover only the Nix clients' };
  const save = () => fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const common = ['build', '--extra-experimental-features', 'nix-command flakes', '--store', 'daemon', '--no-write-lock-file',
    '--option', 'accept-flake-config', 'false', '--option', 'sandbox', 'true', '--impure', '--keep-failed', '-L',
    ...(parsed.offline ? ['--offline'] : []), '--file', path.join(source, 'nix/fresh-browser.nix'), '--argstr', 'system', system];
  console.log(`Fresh browser acceptance: group=${group}, concurrent sandboxes=${budget.workers}${group === 'all' ? '' : ' (selected-only, NOT full acceptance)'}\nArtifacts: ${root}`);
  save();
  try {
    report.preparation = await runOwned('nix', [...common, '--max-jobs', String(preparationBudget.maxJobs), '--cores', String(preparationBudget.coresPerBuild), '--out-link', path.join(root, 'support')],
      { cwd: root, env, signal: controller.signal, logPath: path.join(root, 'preparation.log') });
    if (report.preparation.code !== 0 || !report.preparation.settled || report.preparation.interrupted) throw new Error('Browser prerequisite realization failed; stopped without retry');
    const support = fs.realpathSync(path.join(root, 'support'));
    const metadata = validateBrowserMetadata(JSON.parse(fs.readFileSync(path.join(support, 'browser.json'), 'utf8')));
    if (metadata.flakeSource !== source) throw new Error('Browser support source differs from pinned input');
    report.plan = browserPlan(metadata, group, budget.workers); save();
    report.groups = await dispatchBrowserPlan(report.plan, async job => {
      const directory = path.join(root, 'groups', job.name); fs.mkdirSync(directory, { mode: 0o700 });
      console.log(`START sandbox=${job.lane} group=${job.name}`);
      const execution = await runOwned('nix', [...common, '--max-jobs', '1', '--cores', '2', '--out-link', path.join(directory, 'result'),
        '--argstr', 'group', job.name, '--argstr', 'runId', report.runId, '--argstr', 'sourceDigest', sourceDigest,
        '--argstr', 'hostNamespaces', JSON.stringify(hostNamespaces)],
      { cwd: root, env, signal: controller.signal, graceMs: 45_000, logPath: path.join(directory, 'driver.log') });
      const row = report.groups?.find(item => item.name === job.name);
      if (row) row.execution = execution;
      if (execution.code !== 0 || !execution.settled || execution.interrupted) throw new Error(`${job.name}: capsule realization failed or interrupted; Nix retains builder containment`);
      const output = fs.realpathSync(path.join(directory, 'result'));
      if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(output)) throw new Error('Invalid sandbox output');
      assertEvidenceTree(output);
      const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
      if (row) { row.output = output; row.capsule = result; }
      requireBrowserPass(result, metadata, { group: job.name, runId: report.runId, sourceDigest, hostNamespaces }, output);
      console.log(`END sandbox=${job.lane} group=${job.name} seconds=${result.elapsedSeconds.toFixed(3)}`);
      return { output, capsule: result, execution };
    }, { signal: controller.signal, changed: rows => { report.groups = rows; save(); } });
    report.status = !controller.signal.aborted && report.groups.every(row => row.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message; console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString(); report.interrupted = controller.signal.aborted;
    try { save(); }
    catch (error) { report.status = 'failed'; report.error ??= error.message; console.error(`Cannot retain browser report: ${error.message}`); }
    finally {
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
      process.umask(mask);
    }
    process.exitCode = report.status === 'passed' ? 0 : 1;
    console.log(`Browser ${report.status}: ${root}/run.json`);
  }
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runBrowser(process.argv[2], process.argv[3], process.argv.slice(4)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
