// Local working-tree entrypoint: never pass the populated checkout to a path flake.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = new Set(['app', 'components', 'hooks', 'lib', 'public']);
const nixFlags = ['--extra-experimental-features', 'nix-command flakes', '--store', 'daemon',
  '--offline', '--builders', '', '--no-write-lock-file', '--keep-failed', '--max-jobs', '1', '--cores', '8',
  '--option', 'substitute', 'false', '--option', 'substituters', '', '--option', 'flake-registry', '',
  '--option', 'accept-flake-config', 'false', '--option', 'eval-cache', 'false'];
const fail = (message, exitCode = 2) => Object.assign(new Error(message), { exitCode });

export function validateArgs(args) {
  const seen = new Set(), files = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag !== '--file' && seen.has(flag)) throw fail(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--help' || flag === '--inventory-only') continue;
    if (flag === '--jobs') {
      const value = args[++i];
      if (!/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(value ?? '')) throw fail('--jobs must be a canonical integer 1..32');
    } else if (flag === '--file') {
      const value = args[++i], parts = value?.split('/') ?? [];
      if (!roots.has(parts[0]) || !value.endsWith('.test.mjs') || /[\\\x00-\x1f\x7f]/.test(value) ||
          parts.some((p) => !p || p === '.' || p === '..') || files.has(value)) throw fail('Invalid/duplicate --file');
      files.add(value);
    } else throw fail(`Unknown option: ${flag}`);
  }
  return [...args];
}

export function privateEnvironment(root, ambient) {
  const env = { PATH: ambient.PATH ?? '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PI_OFFLINE: '1' };
  for (const [key, dir] of Object.entries({ HOME: 'home', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache',
    XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', XDG_RUNTIME_DIR: 'runtime',
    PI_CODING_AGENT_DIR: 'agent', TMPDIR: 'tmp', NIX_CONF_DIR: 'nix-conf' })) env[key] = path.join(root, dir);
  env.XDG_CONFIG_DIRS = env.XDG_CONFIG_HOME; env.XDG_DATA_DIRS = env.XDG_DATA_HOME;
  env.TMP = env.TEMP = env.TMPDIR;
  if (ambient.NIX_BUILD_CORES !== undefined) {
    const cores = ambient.NIX_BUILD_CORES;
    if (!/^[1-9]\d*$/.test(cores) || !Number.isSafeInteger(Number(cores))) throw fail('Invalid supplied NIX_BUILD_CORES');
    env.NIX_BUILD_CORES = cores; // Preserve a supplied cap; never invent a host allocation.
  }
  return env;
}

// Importable orchestration contracts use an injected command, never public CLI bindings.
async function execute(program, args, { cwd, env, capture, signal }) {
  if (signal.aborted) throw fail('Interrupted; retained export is not acceptance', signal.reason);
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    const chunks = []; let bytes = 0, oversized = false;
    const interrupt = () => child.kill(signal.reason === 130 ? 'SIGINT' : 'SIGTERM');
    signal.addEventListener('abort', interrupt, { once: true });
    child.stdout?.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) { oversized = true; child.kill('SIGTERM'); }
      else chunks.push(chunk);
    });
    child.once('error', (error) => { signal.removeEventListener('abort', interrupt); reject(fail(error.message, 127)); });
    child.once('close', (code, childSignal) => {
      signal.removeEventListener('abort', interrupt);
      if (oversized) reject(fail('Nix metadata exceeded 64MiB; stopped without retry', 1));
      else resolve({ code: code ?? (childSignal === 'SIGINT' ? 130 : 143), stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

export function cachedInputs(document, rootDrv, exists = fs.existsSync) {
  const graph = document.derivations ?? document, cached = new Set(), visited = new Set();
  const helpers = new Set(['pi-web-test-offline', 'pi-web-test-offline-body', 'pi-web-test-git-forwarder']);
  const store = path.dirname(rootDrv);
  const storePath = (p) => path.isAbsolute(p) ? p : path.join(store, p);
  for (const d of Object.values(graph)) {
    const attrs = d.structuredAttrs ?? d.env ?? {};
    const name = d.name ?? attrs.name ?? '';
    if (/^pi-web-\d/.test(name) || attrs.pname === 'pi-web' ||
        [attrs.buildCommand, attrs.buildPhase].some((s) => typeof s === 'string' &&
          (s.includes('next build') || (name.startsWith('pi-web') && s.includes('npm run build'))))) {
      throw fail('Production build edge in test app closure');
    }
  }
  function walk(key, names) {
    key = path.basename(key);
    const tag = `${key}:${[...names].sort().join(',')}`;
    if (visited.has(tag)) return;
    visited.add(tag);
    const d = graph[key] ?? graph[storePath(key)];
    if (!d) throw fail(`Missing derivation metadata: ${key}`);
    const attrs = d.structuredAttrs ?? d.env;
    const name = d.name ?? attrs.name;
    let missing = false;
    for (const n of names) {
      const output = d.outputs[n]?.path ?? attrs[n];
      if (!output) throw fail('Unresolved Nix output');
      const p = storePath(output);
      if (exists(p)) cached.add(p); else missing = true;
    }
    if (!missing) return;
    if (Object.values(d.outputs).some((o) => o.hash) || attrs.outputHash) throw fail(`Missing cached fetcher: ${name}`);
    if (!helpers.has(name)) throw fail(`Missing cached prerequisite: ${name}. No fetch/build fallback; prepare dependencies separately.`);
    for (const p of d.inputs?.srcs ?? d.inputSrcs ?? []) if (!exists(storePath(p))) throw fail(`Missing source input: ${p}`);
    for (const [drv, spec] of Object.entries(d.inputs?.drvs ?? d.inputDrvs ?? {})) {
      if (spec.dynamicOutputs && Object.keys(spec.dynamicOutputs).length) throw fail('Dynamic derivations require separate review');
      walk(drv, Array.isArray(spec) ? spec : spec.outputs);
    }
  }
  walk(rootDrv, ['out']);
  return [...cached].sort();
}

export async function run(args, { cwd = process.cwd(), ambient = process.env, command = execute } = {}) {
  args = validateArgs(args);
  const source = fs.realpathSync(cwd);
  if (source !== fs.realpathSync(project)) throw fail('Run from this working-tree root (not a store copy or another cwd)');
  const system = { x64: 'x86_64-linux', arm64: 'aarch64-linux' }[process.arch];
  if (process.platform !== 'linux' || !system) throw fail('This offline entrypoint requires Linux x64/arm64');
  const previousMask = process.umask(0o077);
  const controller = new AbortController();
  const handlers = { SIGINT: () => controller.abort(130), SIGTERM: () => controller.abort(143) };
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  let root;
  try {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pi-web-test-source-'));
    console.log(`Current source: ${source}\nPrivate source export (retained, not acceptance): ${root}`);
    const env = privateEnvironment(root, ambient);
    for (const dir of ['home', 'config', 'cache', 'data', 'state', 'runtime', 'agent', 'tmp', 'nix-conf']) {
      fs.mkdirSync(path.join(root, dir), { mode: 0o700 });
    }
    async function checked(program, argv, capture = false) {
      if (controller.signal.aborted) throw fail('Interrupted; no further steps', controller.signal.reason);
      const result = await command(program, argv, { cwd: root, env, capture, signal: controller.signal });
      if (controller.signal.aborted) throw fail('Interrupted; no further steps', controller.signal.reason);
      if (result.code !== 0) throw fail(`${program} exited ${result.code}; stopped without retry`, result.code);
      return result.stdout;
    }
    const exporter = path.join(source, 'nix/export-test-source.py');
    const output = path.join(root, 'source'), manifest = path.join(root, 'source.json');
    const exportArgs = ['-I', '-B', exporter, source, '--output', output, '--manifest', manifest];
    await checked('python3', exportArgs); // Original EXIT0 is mandatory; a pathname is not proof.
    await checked('python3', [...exportArgs, '--verify-manifest']);
    const nix = (sub, tail, capture = true) => checked('nix', [...sub, ...nixFlags, ...tail], capture);
    const app = JSON.parse(await nix(['eval'], ['--json', `path:${output}#apps.${system}.test-offline`, '--apply',
      'a: { context = builtins.getContext a.program; }']));
    const drvs = Object.keys(app.context);
    if (drvs.length !== 1) throw fail('Unexpected app derivation context');
    const graph = JSON.parse(await nix(['derivation', 'show'], ['--recursive', drvs[0]]));
    const cached = cachedInputs(graph, drvs[0]);
    if (cached.length) await nix(['path-info'], ['--json', ...cached]);
    // Always a fresh app invocation, never a cached check substituted for execution.
    await nix(['run'], [`path:${output}#test-offline`, '--', ...args], false);
    return root;
  } finally {
    for (const [name, handler] of Object.entries(handlers)) process.removeListener(name, handler);
    process.umask(previousMask);
    // No automatic deletion: failures/interruption/descendant uncertainty retain evidence.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(process.argv.slice(2)); }
  catch (error) { console.error(`test-offline: ${error.message}`); process.exitCode = error.exitCode ?? 1; }
}
