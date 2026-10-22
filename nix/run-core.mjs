// Fresh execution of the same Nix-sandboxed core check, not a host test runner.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateEnvironment, validateArgs } from './test.mjs';
import { runOwned } from './test-lifecycle.mjs';
import { coreBuildBudget } from './vm-plan.mjs';

export async function runCore(source, system, args) {
  const parsed = validateArgs(['core', ...args]);
  if (parsed.help) throw new Error('Use nix run .#test -- --help');
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(source ?? '') || !['x86_64-linux', 'aarch64-linux'].includes(system)) {
    throw new Error('Pinned Nix source and native Linux system required');
  }
  const jobsIndex = parsed.options.indexOf('--jobs');
  const buildBudget = coreBuildBudget(jobsIndex < 0 ? undefined : Number(parsed.options[jobsIndex + 1]));
  const mask = process.umask(0o077);
  const root = fs.mkdtempSync('/tmp/pi-web-test-core.');
  const env = privateEnvironment(root, process.env);
  for (const name of ['home', 'config', 'cache', 'data', 'state', 'runtime', 'agent', 'tmp', 'nix-conf']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  const controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(sig => [sig, () => controller.abort(sig)]));
  for (const [sig, handler] of Object.entries(handlers)) process.on(sig, handler);
  const report = { version: 1, fresh: true, source, system, selection: parsed.options, buildBudget,
    runId: randomUUID(), startedAt: new Date().toISOString(), settlementScope: 'Nix sandbox owns builder processes; host observations cover the Nix CLI only' };
  console.log(`Private core test root (sandbox execution; evidence retained): ${root}`);
  console.log(`Fresh core selection: ${JSON.stringify(parsed.options)}${parsed.options.includes('--file') || parsed.options.includes('--inventory-only') ? ' (NOT full acceptance)' : ''}`);
  try {
    report.execution = await runOwned('nix', ['build', '--extra-experimental-features', 'nix-command flakes',
      '--store', 'daemon', '--no-write-lock-file', '--option', 'accept-flake-config', 'false',
      '--option', 'sandbox', 'true', '--max-jobs', String(buildBudget.maxJobs), '--cores', String(buildBudget.coresPerBuild), '--impure', '--keep-failed', '-L',
      ...(parsed.offline ? ['--offline'] : []), '--out-link', path.join(root, 'result'),
      '--file', path.join(source, 'nix/fresh-core.nix'), '--argstr', 'system', system,
      '--argstr', 'selection', JSON.stringify(parsed.options), '--argstr', 'runId', report.runId],
    { cwd: root, env, signal: controller.signal, logPath: path.join(root, 'driver.log') });
    report.status = report.execution.code === 0 && report.execution.settled && !report.execution.interrupted ? 'passed' : 'failed';
    if (report.status === 'passed') {
      const output = fs.realpathSync(path.join(root, 'result'));
      if (!output.startsWith('/nix/store/')) throw new Error('Missing sandbox result');
      for (const name of ['artifacts', 'source-input.json', 'execution.log', 'lifecycle.json']) {
        fs.symlinkSync(path.join(output, name), path.join(root, name));
      }
      report.output = output;
    }
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    report.status = 'failed'; report.error = error.message; process.exitCode = 1;
    console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    for (const [sig, handler] of Object.entries(handlers)) process.off(sig, handler);
    process.umask(mask);
    console.log(`Core ${report.status}: ${root}/run.json`);
  }
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runCore(process.argv[2], process.argv[3], process.argv.slice(4)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
