import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groups, privateEnvironment, validateArgs } from './test.mjs';
import { directoryIdentity, runOwned } from './test-lifecycle.mjs';

export function validateEvidence(receipt, group) {
  const selected = group === 'all' ? Object.keys(groups) : [group];
  if (receipt?.version !== 1 || receipt.artifactsCollected !== true || receipt.serviceStopped !== true ||
      typeof receipt.passed !== 'boolean' || !receipt.package?.startsWith('/nix/store/') ||
      JSON.stringify(receipt.selected) !== JSON.stringify(selected)) throw new Error('Missing/incomplete VM evidence collection');
  return receipt;
}

export async function runVM(driver, args) {
  const parsed = validateArgs(['e2e', ...args]);
  if (parsed.help) throw new Error('Use nix run .#test -- --help');
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(driver ?? '')) throw new Error('Pinned Nix VM driver required');
  const group = parsed.options[1] ?? 'all';
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
  const report = { version: 1, driver, group, fresh: true, root, startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  for (const [sig, handler] of Object.entries(handlers)) process.on(sig, handler);
  console.log(`Fresh VM acceptance, group=${group}${group === 'all' ? '' : ' (selected-only, NOT full acceptance)'}\nArtifacts: ${root}`);
  save();
  try {
    report.execution = await runOwned(path.join(driver, 'bin/nixos-test-driver'),
      ['--no-interactive', '--output_directory', path.join(root, 'artifacts'), '--junit-xml', 'junit.xml'],
      { cwd: root, env, signal: controller.signal, graceMs: 45_000, logPath: path.join(root, 'driver.log') });
    try { report.evidence = validateEvidence(JSON.parse(fs.readFileSync(path.join(root, 'artifacts/acceptance.json'), 'utf8')), group); }
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
  try { await runVM(process.argv[2], process.argv.slice(3)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
