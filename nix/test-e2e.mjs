// Dependency-free launcher: imports the actual suite only from its owned snapshot.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixtureEnvironment } from '../e2e/harness.mjs';
import { cleanupBulk, directoryIdentity, runOwned, settlementScope } from './test-lifecycle.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const suites = { browser: 'browser-suite.mjs', terminal: 'terminal-suite.mjs' };
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function canonicalStorePath(value, suffix = '') {
  if (typeof value !== 'string' || !/^\/nix\/store\/[a-z0-9]{32}-[^/]+/.test(value) ||
      path.normalize(value) !== value || fs.realpathSync(value) !== value ||
      (suffix ? !value.endsWith(suffix) || path.dirname(path.dirname(value)) !== '/nix/store' : path.dirname(value) !== '/nix/store')) {
    throw new Error('Canonical physical Nix store path required');
  }
  return value;
}

export function validateInstalledLock(source, modules) {
  const expected = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8')).packages;
  const installed = JSON.parse(fs.readFileSync(path.join(modules, '.package-lock.json'), 'utf8')).packages;
  if (!expected?.[''] || !installed) throw new Error('Installed npm lock metadata required; prepare with npm ci');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const ordered = (object = {}) => JSON.stringify(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (ordered(manifest[key]) !== ordered(expected[''][key])) throw new Error(`Manifest/lockfile ${key} mismatch; update lockfile and run npm ci`);
  }
  for (const [name, entry] of Object.entries(installed)) {
    if (!expected[name] || entry.link || ['version', 'integrity', 'resolved'].some((key) => entry[key] !== expected[name][key])) {
      throw new Error(`Installed dependency metadata mismatch: ${name}; prepare with npm ci`);
    }
  }
  for (const [name, entry] of Object.entries(expected)) {
    if (name && !entry.optional && !installed[name]) throw new Error(`Missing installed dependency: ${name}`);
  }
}

export function dependencyInput(source, ambient = process.env) {
  const packageSha256 = digest(path.join(source, 'package.json')), lockSha256 = digest(path.join(source, 'package-lock.json'));
  let modules = path.join(source, 'node_modules'), descriptor;
  if (ambient.PI_WEB_TEST_INPUTS) {
    descriptor = canonicalStorePath(ambient.PI_WEB_TEST_INPUTS);
    const inputs = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    modules = canonicalStorePath(inputs.modules, '/node_modules');
    if (inputs.packageSha256 !== packageSha256 || inputs.lockSha256 !== lockSha256) {
      throw new Error('Test-shell manifests mismatch; re-enter the matching Nix shell');
    }
  }
  if (!fs.lstatSync(modules).isDirectory()) throw new Error('Prepare physical dependencies with nix develop .#test or npm ci');
  if (!descriptor) validateInstalledLock(source, modules);
  return { modules, descriptor, packageSha256, lockSha256 };
}

export async function trackedPhase(phases, name, execute, save = () => {}) {
  const record = { name, settled: false, status: 'running' };
  phases.push(record); save();
  try { Object.assign(record, await execute(), { status: 'finished' }); }
  catch (error) { record.status = 'unknown'; record.error = error.message; throw error; }
  finally { save(); }
  if (record.code !== 0 || !record.settled || record.interrupted) throw new Error(`${name} failed (exit ${record.code}, settled ${record.settled})`);
  return record;
}

export function acceptanceSettled(phases, startedSuite, harness) {
  return phases.length > 0 && phases.every((p) => p.settled === true) &&
    (!startedSuite || harness?.resourcesSettled === true && ['passed', 'failed'].includes(harness.status) && !!harness.finishedAt);
}

export async function runE2E(kind, args = process.argv.slice(2)) {
  if (!Object.hasOwn(suites, kind) || args.some((a) => !['--keep-workspace', '--in-place'].includes(a)) || new Set(args).size !== args.length) {
    throw new Error('Allowed: --keep-workspace, --in-place (explicit legacy execution)');
  }
  if (args.includes('--in-place')) {
    console.log('Explicit in-place acceptance: no same-worktree concurrency or bulk cleanup guarantee');
    await import(new URL(`../e2e/${suites[kind]}`, import.meta.url));
    return;
  }
  if (process.platform !== 'linux') throw new Error('Isolated acceptance currently requires Linux and Python 3; --in-place explicitly selects the legacy platform runner');
  const mask = process.umask(0o077);
  const root = fs.mkdtempSync('/tmp/pwe-');
  const original = directoryIdentity(root);
  const parent = path.join(project, 'test-results/e2e');
  fs.mkdirSync(parent, { recursive: true });
  const artifacts = fs.mkdtempSync(path.join(parent, `${kind}-`));
  const source = path.join(root, 'source');
  const env = fixtureEnvironment(path.join(root, 'environment'));
  fs.mkdirSync(path.join(root, 'tmp'), { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'fixtures'), { mode: 0o700 });
  env.TMPDIR = env.TMP = env.TEMP = path.join(root, 'tmp');
  env.PI_WEB_TEST_ARTIFACTS = artifacts;
  env.PI_WEB_TEST_FIXTURES = path.join(root, 'fixtures');
  env.PI_WEB_TEST_TMP = env.TMPDIR;
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT'), onTerm = () => controller.abort('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const state = { version: 1, kind, checkout: project, root, artifacts, startedAt: new Date().toISOString(),
    keepWorkspace: args.includes('--keep-workspace'), phases: [], cleanup: { status: 'not-attempted' }, scope: settlementScope };
  const save = () => fs.writeFileSync(path.join(artifacts, 'lifecycle.json'), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  let sourceIdentity, startedSuite = false;
  console.log(`Isolated ${kind} workspace: ${root}\nArtifacts: ${artifacts}`);
  save();
  const phase = (name, command, argv, cwd = root) => trackedPhase(state.phases, name,
    () => runOwned(command, argv, { cwd, env, signal: controller.signal,
      // Encompass inner server escalation and ordinary trace export. On timeout
      // the supervisor kills authenticated descendants before their owner.
      graceMs: name === 'suite' ? 45_000 : 10_000,
      logPath: path.join(artifacts, `${name}.log`) }), save);
  try {
    const exporter = path.join(project, 'nix/export-test-source.py');
    const exportArgs = ['-I', '-B', exporter, fs.realpathSync(project), '--output', source, '--manifest', path.join(root, 'source-input.json')];
    await phase('source-export', 'python3', exportArgs);
    await phase('source-verify', 'python3', [...exportArgs, '--verify-manifest']);
    sourceIdentity = directoryIdentity(source);
    fs.copyFileSync(path.join(root, 'source-input.json'), path.join(artifacts, 'source-input.json'));
    state.dependencies = process.env.PI_WEB_TEST_INPUTS ? dependencyInput(source) : dependencyInput(project, {});
    if (state.dependencies.packageSha256 !== digest(path.join(source, 'package.json')) ||
        state.dependencies.lockSha256 !== digest(path.join(source, 'package-lock.json'))) {
      throw new Error('Dependency manifests changed during snapshot creation');
    }
    await phase('source-mode', 'chmod', ['-R', 'u+w', source]);
    await phase('modules-copy', 'cp', ['-a', '--no-preserve=ownership', '--reflink=auto', state.dependencies.modules, path.join(source, 'node_modules')]);
    await phase('modules-mode', 'chmod', ['-R', 'u+w', path.join(source, 'node_modules')]);
    startedSuite = true;
    await phase('suite', process.execPath, [path.join(source, 'e2e', suites[kind])], source);
    state.status = 'passed';
  } catch (error) {
    state.status = 'failed'; state.error = error.message; process.exitCode = 1;
    console.error(error.message);
  } finally {
    try {
      const runPath = path.join(artifacts, 'run.json');
      const harness = fs.existsSync(runPath) ? JSON.parse(fs.readFileSync(runPath, 'utf8')) : null;
      const settled = acceptanceSettled(state.phases, startedSuite, harness);
      state.innerSettled = settled;
      if (!settled || startedSuite && harness?.status !== 'passed') { state.status = 'failed'; process.exitCode = 1; }
      state.cleanup = { status: 'in-progress' }; save();
      state.cleanup = cleanupBulk(root, original, { settled, interrupted: controller.signal.aborted,
        keepWorkspace: state.keepWorkspace, sourceIdentity });
    } catch (error) { state.cleanup = { status: 'refused-or-partial', error: error.message }; state.status = 'failed'; process.exitCode = 1; }
    state.finishedAt = new Date().toISOString(); save();
    console.log(`Run lifecycle: ${artifacts}/lifecycle.json; bulk ${state.cleanup.status}`);
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); process.umask(mask);
  }
}
