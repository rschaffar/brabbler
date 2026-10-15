// Nix-only developer entry point. Export current (including untracked) source
// safely, then let Nix realize and run the same definitions used by checks/CI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { availableResources } from './resources.mjs';
import { combinedBudget, workerBudget } from './vm-plan.mjs';

export const groups = Object.freeze(JSON.parse(fs.readFileSync(new URL('./e2e-groups.json', import.meta.url), 'utf8')));
const roots = new Set(['app', 'components', 'hooks', 'lib', 'public', 'plugins']);
export function validateArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const [kind, ...tail] = args;
  if (!['core', 'e2e', 'all'].includes(kind)) throw new Error('Choose core, e2e or all');
  const options = [], vmOptions = [], seen = new Set(), files = new Set();
  let offline = false;
  for (let i = 0; i < tail.length; i++) {
    const flag = tail[i];
    if (flag !== '--file' && seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--offline') { offline = true; continue; }
    if (flag === '--help') return { help: true };
    if ((kind === 'e2e' || kind === 'all') && flag === '--workers') {
      const value = tail[++i];
      if (!/^[1-4]$/.test(value ?? '')) throw new Error('workers must be 1..4');
      (kind === 'all' ? vmOptions : options).push(flag, value); continue;
    }
    if (kind === 'e2e') {
      const value = tail[++i];
      if (flag !== '--group' || !(value === 'all' || Object.hasOwn(groups, value))) throw new Error('Unknown E2E group/option');
      options.push(flag, value); continue;
    }
    if (kind === 'all' && flag !== '--jobs') throw new Error('all accepts only --jobs, --workers and --offline');
    if (flag === '--inventory-only') { options.push(flag); continue; }
    const value = tail[++i];
    if (flag === '--jobs') {
      if (!/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(value ?? '')) throw new Error('jobs must be 1..32');
    } else if (flag === '--file') {
      const parts = value?.split('/') ?? [];
      if (!roots.has(parts[0]) || !value.endsWith('.test.mjs') || /[\\\x00-\x1f\x7f]/.test(value) ||
          parts.some(p => !p || p === '.' || p === '..') || files.has(value)) throw new Error('Invalid/duplicate --file');
      files.add(value);
    } else throw new Error(`Unknown core option: ${flag}`);
    options.push(flag, value);
  }
  return { kind, options, offline, ...(kind === 'all' ? { vmOptions } : {}) };
}

export function privateEnvironment(root, ambient) {
  const env = { PATH: ambient.PATH ?? '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  for (const [key, dir] of Object.entries({ HOME: 'home', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache',
    XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', XDG_RUNTIME_DIR: 'runtime',
    PI_CODING_AGENT_DIR: 'agent', TMPDIR: 'tmp', NIX_CONF_DIR: 'nix-conf' })) env[key] = path.join(root, dir);
  env.TMP = env.TEMP = env.TMPDIR;
  env.XDG_CONFIG_DIRS = env.XDG_CONFIG_HOME; env.XDG_DATA_DIRS = env.XDG_DATA_HOME;
  return env;
}

async function execute(program, args, { cwd, env, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: 'inherit' });
    const interrupt = () => child.kill(signal.reason);
    signal.addEventListener('abort', interrupt, { once: true });
    child.once('error', reject);
    child.once('close', (code, sig) => {
      signal.removeEventListener('abort', interrupt);
      resolve(code ?? (sig === 'SIGINT' ? 130 : 143));
    });
  });
}

export async function run(args, { cwd = process.cwd(), ambient = process.env, command = execute, readResources = availableResources } = {}) {
  const parsed = validateArgs(args);
  if (parsed.help) {
    console.log('nix run .#test -- core [--file <path>] [--jobs 1..32] [--inventory-only] [--offline]');
    console.log('nix run .#test -- e2e [--group all|' + Object.keys(groups).join('|') + '] [--workers 1..4] [--offline]');
    console.log('nix run .#test -- all [--workers 1..4] [--jobs 1..32] [--offline] (one snapshot; overlap only with sufficient CPU/memory headroom)');
    console.log('Fresh execution, not a cached check. Selected groups/files are NOT full acceptance. Nix realizes prerequisites automatically.');
    return;
  }
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Native Linux x64/arm64 required');
  const source = fs.realpathSync(cwd);
  const mask = process.umask(0o077), controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(sig => [sig, () => controller.abort(sig)]));
  for (const [sig, handler] of Object.entries(handlers)) process.on(sig, handler);
  try {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pi-web-test-source-'));
    const env = privateEnvironment(root, ambient);
    for (const name of ['home', 'config', 'cache', 'data', 'state', 'runtime', 'agent', 'tmp', 'nix-conf']) {
      fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    }
    console.log(`Current source: ${source}\nRetained source snapshot: ${root}\nFresh ${parsed.kind} execution; scope: ${JSON.stringify(parsed.options)}`);
    const output = path.join(root, 'source'), manifest = path.join(root, 'source.json');
    async function checked(program, argv) {
      if (controller.signal.aborted) throw new Error('Interrupted; no further steps');
      const code = await command(program, argv, { cwd: root, env, signal: controller.signal });
      if (code !== 0 || controller.signal.aborted) throw Object.assign(new Error(`${program} exited ${code}; stopped without retry`), { exitCode: code || 1 });
    }
    const exporter = fileURLToPath(new URL('./export-test-source.py', import.meta.url));
    const exportArgs = ['-I', '-B', exporter, source, '--output', output, '--manifest', manifest];
    await checked('python3', exportArgs);
    await checked('python3', [...exportArgs, '--verify-manifest']);
    const launch = (kind, options) => checked('nix', ['run', '--extra-experimental-features', 'nix-command flakes', '--store', 'daemon',
      '--no-write-lock-file', '--option', 'accept-flake-config', 'false', '--max-jobs', '2', '--cores', '4',
      ...(parsed.offline ? ['--offline'] : []),
      `path:${output}#test-${kind}`, '--', ...options, ...(parsed.offline ? ['--offline'] : [])]);
    if (parsed.kind !== 'all') await launch(parsed.kind, parsed.options);
    else {
      const resources = readResources();
      const budget = workerBudget({ resources, requested: parsed.vmOptions.length ? Number(parsed.vmOptions[1]) : undefined });
      const coreJobs = parsed.options.length ? Number(parsed.options[1]) : 2;
      const admission = combinedBudget(resources, budget, coreJobs);
      const { overlap } = admission;
      const coreOptions = parsed.options.length ? parsed.options : ['--jobs', overlap ? '2' : '4'];
      const selection = { version: 1, source: output, budget, coreOptions, overlap, admission };
      fs.writeFileSync(path.join(root, 'selection.json'), JSON.stringify(selection, null, 2) + '\n', { mode: 0o600 });
      console.log(`Complete acceptance: ${overlap ? 'overlap' : 'serial (insufficient spare budget for overlap)'}, VM lanes=${budget.workers}, core=${JSON.stringify(coreOptions)}`);
      if (!overlap) { await launch('core', coreOptions); await launch('e2e', ['--workers', String(budget.workers)]); }
      else {
        let primary;
        const settle = async (kind, options) => {
          try { await launch(kind, options); }
          catch (error) { primary ??= error; controller.abort('SIGTERM'); throw error; }
        };
        await Promise.allSettled([settle('core', coreOptions), settle('e2e', ['--workers', String(budget.workers)])]);
        if (primary) throw primary;
      }
    }
    return root;
  } finally {
    for (const [sig, handler] of Object.entries(handlers)) process.off(sig, handler);
    process.umask(mask);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(process.argv.slice(2)); }
  catch (error) { console.error(`test: ${error.message}`); process.exitCode = error.exitCode ?? 2; }
}
