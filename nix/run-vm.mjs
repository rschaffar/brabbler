import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateEnvironment, validateArgs } from './test.mjs';
import { directoryIdentity, runOwned } from './test-lifecycle.mjs';
import { createPlan, validateEvidence, workerBudget } from './vm-plan.mjs';
export { validateEvidence } from './vm-plan.mjs';

export async function runVM(source, system, args) {
  const parsed = validateArgs(['e2e', ...args]);
  if (parsed.help) throw new Error('Use nix run .#test -- --help');
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(source ?? '') || !['x86_64-linux', 'aarch64-linux'].includes(system)) {
    throw new Error('Pinned Nix source and native Linux system required');
  }
  const option = name => parsed.options.includes(name) ? parsed.options[parsed.options.indexOf(name) + 1] : undefined;
  const group = option('--group') ?? 'all';
  const budget = workerBudget({ requested: option('--workers') ? Number(option('--workers')) : group === 'all' ? undefined : 1 });
  const mask = process.umask(0o077);
  const root = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'pwv-'));
  const original = directoryIdentity(root), env = privateEnvironment(root, process.env);
  for (const name of ['home', 'config', 'cache', 'data', 'state', 'runtime', 'agent', 'tmp', 'nix-conf', 'artifacts']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  const runtime = directoryIdentity(env.XDG_RUNTIME_DIR);
  env.PI_WEB_E2E_GROUP = group;
  const controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(sig => [sig, () => controller.abort(sig)]));
  const report = { version: 2, source, system, group, budget, fresh: true, root, startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  for (const [sig, handler] of Object.entries(handlers)) process.on(sig, handler);
  console.log(`Fresh VM acceptance, group=${group}, lanes=${budget.workers}${group === 'all' ? '' : ' (selected-only, NOT full acceptance)'}\nArtifacts: ${root}`);
  save();
  try {
    report.realization = await runOwned('nix', ['build', '--extra-experimental-features', 'nix-command flakes',
      '--store', 'daemon', '--no-write-lock-file', '--option', 'accept-flake-config', 'false',
      '--option', 'sandbox', 'true', '--max-jobs', '2', '--cores', '4', '--impure', '--keep-failed', '-L',
      ...(parsed.offline ? ['--offline'] : []), '--out-link', path.join(root, 'driver'),
      '--file', path.join(source, 'nix/fresh-vm.nix'), '--argstr', 'system', system,
      '--argstr', 'workers', String(budget.workers)],
    { cwd: root, env, signal: controller.signal, logPath: path.join(root, 'realization.log') });
    if (report.realization.code !== 0 || !report.realization.settled || report.realization.interrupted) throw new Error('VM prerequisite realization failed; stopped without retry');
    const driver = fs.realpathSync(path.join(root, 'driver'));
    report.driver = driver;
    report.plan = createPlan(JSON.parse(fs.readFileSync(path.join(driver, 'lanes.json'), 'utf8')), group);
    save();
    report.execution = await runOwned(path.join(driver, 'bin/nixos-test-driver'),
      ['--no-interactive', '--output_directory', path.join(root, 'artifacts'), '--junit-xml', 'junit.xml'],
      { cwd: root, env, signal: controller.signal, graceMs: 45_000, logPath: path.join(root, 'driver.log') });
    try { report.evidence = validateEvidence(JSON.parse(fs.readFileSync(path.join(root, 'artifacts/acceptance.json'), 'utf8')), report.plan); }
    catch (error) { report.error = error.message; }
    report.status = report.execution.code === 0 && report.execution.settled && !report.execution.interrupted && report.evidence?.passed ? 'passed' : 'failed';
    process.exitCode = report.status === 'passed' ? 0 : 1;
    if (report.execution.settled && !report.execution.interrupted && report.evidence) {
      const clean = spawnSync('python3', ['-I', '-B', fileURLToPath(new URL('./cleanup-test-workspace.py', import.meta.url)),
        '--vm', root, ...original.map(String), ...runtime.map(String)], { env, encoding: 'utf8' });
      if (clean.status !== 0) throw new Error(`VM bulk cleanup refused/partial: ${clean.stderr}`);
      report.cleanup = JSON.parse(clean.stdout);
    } else report.cleanup = { status: 'retained', reason: 'Interrupted/uncertain settlement or incomplete evidence collection' };
  } catch (error) {
    report.status = 'failed'; report.error = error.message; process.exitCode = 1;
    console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString(); save();
    for (const [sig, handler] of Object.entries(handlers)) process.off(sig, handler);
    process.umask(mask);
    console.log(`VM ${report.status}: ${root}/run.json`);
  }
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runVM(process.argv[2], process.argv[3], process.argv.slice(4)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
