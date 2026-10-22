// Test infrastructure only. Importing this module never discovers or runs tests.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableResources } from './resources.mjs';

export const ROOTS = Object.freeze(['app', 'components', 'hooks', 'lib', 'public', 'plugins']);
const DEFAULT_JOBS = 8;
const MAX_JOBS = 32;
const validJobs = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_JOBS;
const GiB = 1024 ** 3;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const identity = (file) => {
  const s = fs.lstatSync(file);
  return { dev: s.dev, ino: s.ino };
};
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;

export function discover(root) {
  const files = [];
  function walk(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Discovery refuses symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) {
        if (entry === 'node_modules') continue;
        walk(`${relative}/${entry}`);
      }
    } else if (stat.isFile() && relative.endsWith('.test.mjs')) {
      files.push({ path: relative, sha256: hash(fs.readFileSync(absolute)) });
    }
  }
  for (const entry of ROOTS) {
    if (fs.existsSync(path.join(root, entry))) walk(entry);
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function planFiles(inventory, manifest, selection = []) {
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid lane manifest');
  const discovered = new Set(inventory.map((f) => f.path));
  if (discovered.size !== inventory.length) throw new Error('Duplicate discovery path');
  const reviewed = new Map();
  for (const entry of manifest.files) {
    if (!discovered.has(entry.path)) throw new Error(`Stale manifest path: ${entry.path}`);
    if (reviewed.has(entry.path)) throw new Error(`Duplicate manifest path: ${entry.path}`);
    if (!['F', 'N', 'E'].includes(entry.lane) || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`Invalid review: ${entry.path}`);
    }
    if (entry.estimatedMs !== undefined && (!Number.isSafeInteger(entry.estimatedMs) || entry.estimatedMs < 1)) {
      throw new Error(`Invalid duration estimate: ${entry.path}`);
    }
    if (entry.expectedCases !== undefined && (!Array.isArray(entry.expectedCases) || !entry.expectedCases.length ||
        entry.expectedCases.some((name) => typeof name !== 'string' || !name.trim()) ||
        new Set(entry.expectedCases).size !== entry.expectedCases.length)) throw new Error(`Invalid expectedCases: ${entry.path}`);
    reviewed.set(entry.path, entry);
  }
  // Holds are live unresolved reviews, not reviewed E entries or historical authority.
  // Optional for existing API callers; repository coverage is enforced by test-design.
  const holdObject = manifest.holds === undefined ? {} : manifest.holds;
  if (!holdObject || typeof holdObject !== 'object' || Array.isArray(holdObject) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(holdObject))) throw new Error('Invalid manifest holds');
  const holds = new Map();
  for (const [file, reason] of Object.entries(holdObject)) {
    if (!discovered.has(file)) throw new Error(`Unknown hold path: ${file}`);
    if (reviewed.has(file)) throw new Error(`Duplicate manifest/hold path: ${file}`);
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`Invalid hold reason: ${file}`);
    holds.set(file, reason);
  }
  const selected = new Set(selection);
  if (selected.size !== selection.length) throw new Error('Duplicate selected file');
  for (const file of selected) if (!discovered.has(file)) throw new Error(`Unknown selected file: ${file}`);
  return inventory.filter((f) => !selected.size || selected.has(f.path)).map((file) => ({
    ...file,
    lane: reviewed.get(file.path)?.lane ?? 'E',
    reason: reviewed.get(file.path)?.reason ?? (holds.has(file.path)
      ? `UNREVIEWED HOLD: exclusive; still included; ${holds.get(file.path)}`
      : 'UNREVIEWED: exclusive fallback; still included'),
    reviewed: reviewed.has(file.path),
    expectedCases: reviewed.get(file.path)?.expectedCases,
    estimatedMs: reviewed.get(file.path)?.estimatedMs ?? 0,
  }));
}

export function resourceProfile({ requested = DEFAULT_JOBS, cores = process.env.NIX_BUILD_CORES,
  cpus = availableResources().cpus, memory = availableResources().memory } = {}) {
  if (!validJobs(requested)) throw new Error(`jobs must be an integer from 1 to ${MAX_JOBS}`);
  if (cores !== undefined && (!/^\d+$/.test(cores) || !Number.isSafeInteger(Number(cores)))) throw new Error('Invalid NIX_BUILD_CORES');
  const nixCores = Number(cores) > 0 ? Number(cores) : null;
  const memorySlots = Math.max(0, Math.floor((memory - GiB) / (2 * GiB)));
  const effective = Math.min(requested, Math.max(1, Math.floor(cpus)), nixCores ?? MAX_JOBS, memorySlots);
  return { requested, effective, availableCpus: cpus, nixCores, availableMemoryBytes: memory,
    reserveBytes: GiB, bytesPerWorker: 2 * GiB, memorySlots,
    scope: 'Runner-local admission estimate, not a CPU/RSS reservation or machine-exclusive claim' };
}

export function nodeArgs(file) {
  if (!path.isAbsolute(file) || !file.endsWith('.test.mjs')) throw new Error('Expected absolute test file');
  // The old npm trailing flag did NOT cap file concurrency. Never put options after this file.
  return ['--experimental-strip-types', '--test', '--test-concurrency=1', '--test-reporter=tap', file];
}

export function privateEnvironment(workspace, { gitBin, toolPath }) {
  const env = {
    PATH: [gitBin, ...toolPath].join(path.delimiter),
    LC_ALL: 'C', LANG: 'C', TZ: 'UTC', PI_OFFLINE: '1', JITI_FS_CACHE: '0',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const [key, directory] of Object.entries({ HOME: 'home', XDG_CONFIG_HOME: 'config',
    XDG_CACHE_HOME: 'cache', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state',
    XDG_RUNTIME_DIR: 'runtime', PI_CODING_AGENT_DIR: 'agent', TMPDIR: 'tmp' })) {
    env[key] = path.join(workspace, directory);
    fs.mkdirSync(env[key], { mode: 0o700 });
  }
  env.XDG_CONFIG_DIRS = env.XDG_CONFIG_HOME;
  env.XDG_DATA_DIRS = env.XDG_DATA_HOME;
  env.TMP = env.TEMP = env.TMPDIR;
  const bash = toolPath.map((dir) => path.join(dir, 'bash')).find((file) => fs.existsSync(file));
  if (bash) env.SHELL = bash;
  return env;
}

const ownedWorkspaces = new WeakMap();
export function createWorkspace() {
  // Nix supplies a short private TMPDIR inside its retained build root; os.tmpdir() keeps the normal fallback.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pitr-'));
  fs.chmodSync(directory, 0o700);
  const handle = Object.freeze({ directory });
  ownedWorkspaces.set(handle, identity(directory));
  return handle;
}

export function removeWorkspace(handle, { settled, success, interrupted, survivors }) {
  const original = ownedWorkspaces.get(handle);
  if (!original || !settled || !success || interrupted || survivors !== false) return false;
  const stat = fs.lstatSync(handle.directory);
  if (!stat.isDirectory() || !sameIdentity(original, stat)) return false;
  fs.rmSync(handle.directory, { recursive: true });
  ownedWorkspaces.delete(handle);
  return true;
}

// Linux /proc stat fields: state=3, ppid=4, pgrp=5, session=6, starttime=22.
export function processIdentity(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid, state: fields[0], ppid: Number(fields[1]), group: Number(fields[2]),
      session: Number(fields[3]), start: fields[19] };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}

export function signalOwnedGroup(original, signal, readIdentity = processIdentity, kill = process.kill) {
  if (!original || !['SIGINT', 'SIGTERM'].includes(signal)) return false;
  const now = readIdentity(original.pid);
  if (!now || now.start !== original.start || now.ppid !== process.pid ||
      now.group !== original.pid || now.session !== original.pid || now.state === 'Z') return false;
  // No await between identity validation and kill. Never signal a shared web/user cgroup.
  try { kill(-original.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

function childPids(pid) {
  const fd = fs.openSync(`/proc/${pid}/task/${pid}/children`, 'r');
  try {
    const bytes = Buffer.alloc(65537);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length === bytes.length) throw new Error('Owned children metadata limit');
    return bytes.toString('utf8', 0, length).trim().split(/\s+/).filter(Boolean).map(Number);
  } finally { fs.closeSync(fd); }
}

function* procPids() {
  // Names only: Dirent conversion can lstat a DT_UNKNOWN PID after it exits and
  // abort the whole iterator. Individual identity reads already handle vanished
  // PIDs; real directory failures still propagate and refuse settlement.
  // The caller's candidate/owned limits still bound identity reads, not this
  // kernel directory-name allocation (and never promise an atomic host snapshot).
  for (const name of fs.readdirSync('/proc')) if (/^\d+$/.test(name)) yield Number(name);
}

// Bounded live observations, not a host process registry. Sampling follows only authenticated
// parent/child identities; one final session scan also finds same-session orphans. No environments.
export function createOwnedTracker(original, { readIdentity = processIdentity, readChildren = childPids,
  listPids = procPids, limit = 4096 } = {}) {
  const owned = new Map();
  let limited = false, observed = 0;
  const read = (pid) => {
    try { return readIdentity(pid); }
    catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
  };
  function remember(current) {
    if (owned.get(current.pid)?.start === current.start) return;
    if (!owned.has(current.pid) && owned.size >= limit) { limited = true; return; }
    owned.set(current.pid, current); observed++;
  }
  if (original) remember(original);
  function sample() {
    let remaining = 256; // Bound own-tree stat reads per tick, including parent revalidation.
    const sampledRead = (pid) => { remaining--; return read(pid); };
    const queue = [...owned.values()];
    for (let i = 0; i < queue.length && i < limit; i++) {
      if (remaining < 1) { limited = true; return; }
      const previous = queue[i];
      let current;
      try { current = sampledRead(previous.pid); } catch { continue; } // Keep known identity for final audit.
      if (!current || current.start !== previous.start || current.state === 'Z') {
        owned.delete(previous.pid); continue; // Gone or reused PID is not an owned live process.
      }
      try {
        for (const pid of readChildren(current.pid)) {
          if (owned.has(pid)) continue;
          if (remaining < 2) { limited = true; return; }
          let child, parent;
          try { child = sampledRead(pid); parent = sampledRead(current.pid); } catch { continue; }
          if (child && parent?.start === current.start && child.ppid === current.pid &&
              BigInt(child.start) >= BigInt(current.start)) {
            remember(child);
            if (owned.has(pid)) queue.push(child);
          }
        }
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code)) limited = true; // Own observation incomplete.
      }
    }
  }
  function settle() {
    const survivors = [], unreadableOwned = [];
    let uncertain = !original || limited, sessionScanLimited = false;
    let sessionScanError;
    // Do not infer session ownership from a demonstrably reused leader PID.
    let sessionAvailable = !!original;
    try { const now = original && read(original.pid); if (now && now.start !== original.start) sessionAvailable = false; }
    catch { sessionAvailable = false; } // The retained known identity is checked below, never swallowed.
    if (sessionAvailable) {
      try {
        let candidates = 0;
        for (const pid of listPids()) {
          if (++candidates > 16384) { sessionScanLimited = uncertain = true; break; }
          // A previously observed PID may now name a new same-session child.
          // Read its identity rather than skipping the recycled numeric PID.
          try {
            const current = read(pid);
            if (current && current.state !== 'Z' && current.session === original.pid &&
                BigInt(current.start) >= BigInt(original.start)) remember(current);
          } catch { /* Unknown/unrelated unreadable processes never gate this job. */ }
        }
      } catch (error) {
        uncertain = true;
        sessionScanError = { code: error.code ?? 'metadata_error', message: error.message };
      } // This job's final session observation could not be made.
    }
    for (const previous of owned.values()) {
      try {
        const current = read(previous.pid);
        if (current?.start === previous.start && current.state !== 'Z') survivors.push(current);
      } catch (error) {
        uncertain = true;
        unreadableOwned.push({ pid: previous.pid, start: previous.start, code: error.code ?? 'metadata_error' });
      }
    }
    return { survivors, uncertain: uncertain || limited, unreadableOwned,
      observedIdentities: observed, observationLimited: limited, sessionScanLimited, sessionScanError };
  }
  return { sample, settle };
}

// Only Node's FINAL, unindented footer contributes totals. Embedded child TAP diagnostics do not.
export function parseTap(text) {
  const footer = text.match(/(?:^|\n)1\.\.([0-9]+)\n# tests ([0-9]+)\n# suites ([0-9]+)\n# pass ([0-9]+)\n# fail ([0-9]+)\n# cancelled ([0-9]+)\n# skipped ([0-9]+)\n# todo ([0-9]+)\n# duration_ms [^\n]+\n?$/);
  const keys = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  const counts = footer ? Object.fromEntries(keys.map((key, i) => [key, Number(footer[i + 2])])) : null;
  const cases = [], outcomes = [];
  const stack = [];
  for (const line of text.split('\n')) {
    const outcome = line.match(/^( *)(ok|not ok) ([0-9]+) - (.*?)(?: # (SKIP|TODO)(?: .*)?)?$/i);
    if (outcome) outcomes.push({ depth: outcome[1].length, number: Number(outcome[3]), name: outcome[4],
      status: outcome[5]?.toLowerCase() ?? (outcome[2] === 'ok' ? 'pass' : 'fail') });
    const match = line.match(/^( *)# Subtest: (.*)$/);
    if (!match) continue;
    const depth = match[1].length;
    while (stack.length && stack.at(-1).depth >= depth) stack.pop();
    stack.push({ depth, name: match[2] });
    cases.push(stack.map((item) => item.name).join(' > '));
  }
  return { counts, cases, outcomes, planCount: footer ? Number(footer[1]) : null };
}

export function validateCases(tap, expectedCases) {
  // Ordinary files may legitimately be script-style. Only reviewed mandatory contracts require node:test cases.
  if (!expectedCases) return { required: false, success: true };
  const equal = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const errors = [];
  if (!equal(tap.cases, expectedCases)) errors.push('Registered title multiset mismatch');
  const outcomes = tap.outcomes ?? [];
  if (!equal(outcomes.map((r) => r.name), expectedCases)) errors.push('Completed title multiset mismatch');
  if (outcomes.some((r) => r.depth !== 0 || r.status !== 'pass') ||
      !equal(outcomes.map((r) => r.number), expectedCases.map((_, i) => i + 1))) errors.push('Mandatory case outcome incomplete/non-pass');
  const count = expectedCases.length, c = tap.counts;
  if (!c || tap.planCount !== count || c.tests !== count || c.suites !== 0 || c.pass !== count ||
      c.fail !== 0 || c.cancelled !== 0 || c.skipped !== 0 || c.todo !== 0) errors.push('Mandatory case totals mismatch');
  return { required: true, success: errors.length === 0, expectedCases, errors };
}

// Mechanism seam for tiny worker tests, not a substitute for native Git/SDK acceptance.
export async function schedule(plan, { jobs, run, signal }) {
  if (!validJobs(jobs)) throw new Error('Invalid pool size');
  // Historical estimates only prioritize reviewed parallel work, never E barriers.
  const pool = plan.filter((file) => file.lane !== 'E').sort((a, b) =>
    (b.estimatedMs ?? 0) - (a.estimatedMs ?? 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const ordered = [...pool, ...plan.filter((file) => file.lane === 'E')];
  const results = new Map();
  const active = new Set();
  let failed = false;
  async function launch(file) {
    let result;
    try { result = await run(file); }
    catch (error) { result = { status: 'failed', error: String(error.message), success: false }; }
    results.set(file.path, { ...result, path: file.path });
    if (!result.success) failed = true;
  }
  for (const file of ordered) {
    if (file.lane === 'E') await Promise.all(active);
    while (active.size >= jobs) await Promise.race(active);
    if (failed || signal?.aborted) break;
    const promise = launch(file).finally(() => active.delete(promise));
    active.add(promise);
    if (file.lane === 'E') await promise;
  }
  await Promise.all(active);
  for (const file of plan) if (!results.has(file.path)) results.set(file.path, {
    path: file.path, status: 'not_started', success: false, reason: signal?.aborted ? 'interrupted' : 'fail-stop',
  });
  return plan.map((file) => results.get(file.path));
}

function validateTools(gitBin, toolPath) {
  for (const dir of [gitBin, ...toolPath]) {
    if (!dir || !path.isAbsolute(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Pinned absolute tool directories required');
  }
  const git = path.join(gitBin, 'git');
  fs.accessSync(git, fs.constants.X_OK);
  const fd = fs.openSync(git, 'r');
  try {
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    if (!magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Native ELF Git forwarder required; no shell/host fallback');
  } finally { fs.closeSync(fd); }
}

function privateParent(parent) {
  if (!path.isAbsolute(parent)) throw new Error('Absolute artifact parent required');
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Artifact parent must be an owned 0700 directory');
  }
}

export async function runSuite({ root, artifacts, gitBin, toolPath = [], jobs = DEFAULT_JOBS, files = [],
  inventoryOnly = false, signal, resources = resourceProfile({ requested: jobs }), onEvent = () => {} }) {
  if (process.platform !== 'linux') throw new Error('Linux process identity required');
  root = fs.realpathSync(root);
  privateParent(artifacts);
  const previousMask = process.umask(0o077);
  let runDir;
  try { runDir = fs.mkdtempSync(path.join(artifacts, 'run-')); }
  catch (error) { process.umask(previousMask); throw error; }
  const eventFile = path.join(runDir, 'events.jsonl');
  let planned = [];
  function event(value) {
    const record = { time: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString(), ...value };
    fs.appendFileSync(eventFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    onEvent(record);
  }
  try {
    event({ type: 'run', runDir });
    const manifestBytes = fs.readFileSync(path.join(root, 'nix/test-lanes.json'));
    const inventory = discover(root);
    const plan = planFiles(inventory, JSON.parse(manifestBytes), files);
    planned = plan;
    if (!plan.length) throw new Error('Empty test selection');
    json(path.join(runDir, 'inventory.json'), { root, node: process.version, manifestSha256: hash(manifestBytes),
      inventory, plan, resources, tools: { node: process.execPath, gitBin, toolPath },
      scope: files.length ? 'selected-files' : 'core-and-plugin-suite',
      excludedProfiles: ['opt-in real cgroup cases (original skips)', 'e2e/browser and terminal scripts'] });
    for (const file of plan) if (!file.reviewed) event({ type: 'warning', path: file.path, message: file.reason });
    if (inventoryOnly) return { runDir, inventory, plan, resources, exitCode: 0 };
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Execution requires pinned Node 24');
    if (resources.effective < 1) throw new Error('Insufficient memory: require 1GiB reserve + 2GiB per worker');
    validateTools(gitBin, toolPath);
    async function run(file) {
      const started = process.hrtime.bigint();
      const id = String(plan.indexOf(file)).padStart(4, '0');
      const stdout = path.join(runDir, `${id}.tap`);
      const stderr = path.join(runDir, `${id}.stderr.log`);
      const workspace = createWorkspace();
      const argv = nodeArgs(path.join(root, file.path));
      const record = { path: file.path, lane: file.lane, estimatedMs: file.estimatedMs, argv: [process.execPath, ...argv],
        workspace: workspace.directory, stdout, stderr, startedAt: new Date().toISOString() };
      let child, original, spawnError, exitCode = null, exitSignal = null, interrupted = signal?.aborted ?? false;
      const handles = [];
      let tracker, observationTimer;
      function interrupt() {
        interrupted = true;
        try {
          if (child) event({ type: 'signal', path: file.path, signal: signal.reason,
            delivered: signalOwnedGroup(original, signal.reason) });
        } catch (error) {
          // Own identity/signal uncertainty retains this job; never broaden to other processes.
          spawnError = `Own signal delivery uncertain: ${error.message}`;
        }
      }
      try {
        if (hash(fs.readFileSync(path.join(root, file.path))) !== file.sha256) throw new Error('Test source changed after inventory');
        const env = privateEnvironment(workspace.directory, { gitBin, toolPath });
        handles.push(fs.openSync(stdout, 'wx', 0o600), fs.openSync(stderr, 'wx', 0o600));
        child = spawn(process.execPath, argv, { cwd: root, env, detached: true,
          stdio: ['ignore', handles[0], handles[1]] });
        signal?.addEventListener('abort', interrupt, { once: true });
        await new Promise((resolve) => {
          child.once('spawn', () => {
            try {
              original = processIdentity(child.pid);
              tracker = createOwnedTracker(original);
              tracker.sample();
              observationTimer = setInterval(() => tracker.sample(), 250);
              observationTimer.unref();
              event({ type: 'start', ...record, pid: child.pid, identity: original });
              if (signal?.aborted) interrupt();
            } catch (error) { spawnError = error.message; }
          });
          child.once('error', (error) => { spawnError = error.message; });
          child.once('close', (code, sig) => { exitCode = code; exitSignal = sig; resolve(); });
        });
      } catch (error) { spawnError = error.message; }
      finally {
        clearInterval(observationTimer);
        signal?.removeEventListener('abort', interrupt);
        for (const fd of handles) fs.closeSync(fd);
      }
      let audit = { survivors: [], uncertain: false };
      let tap = { counts: null, cases: [] };
      try {
        if (child?.pid) audit = tracker ? tracker.settle() : { survivors: [], uncertain: true };
        if (fs.existsSync(stdout)) tap = parseTap(fs.readFileSync(stdout, 'utf8'));
      } catch (error) { spawnError = error.message; audit.uncertain = true; }
      const caseContract = validateCases(tap, file.expectedCases);
      const success = !spawnError && exitCode === 0 && !exitSignal && !interrupted && caseContract.success &&
        !audit.uncertain && audit.survivors.length === 0 && tap.counts !== null &&
        tap.counts.fail === 0 && tap.counts.cancelled === 0;
      const result = { ...record, status: interrupted ? 'interrupted' : success ? 'passed' : 'failed', success,
        exitCode, signal: exitSignal, error: spawnError, identity: original, ...tap, ...audit, caseContract,
        settlementScope: 'Observed owned identities and final session metadata only; unobserved/escaped descendants not certified',
        endedAt: new Date().toISOString(), durationMs: Number(process.hrtime.bigint() - started) / 1e6 };
      try {
        result.workspaceRemoved = removeWorkspace(workspace, { settled: true, success, interrupted,
          survivors: audit.uncertain || audit.survivors.length > 0 });
        if (success && !result.workspaceRemoved) throw new Error('Owned workspace identity changed; retained');
      } catch (error) {
        result.success = false; result.status = 'failed'; result.error = error.message; result.workspaceRemoved = false;
      }
      event({ type: 'end', ...result });
      return result;
    }
    const results = await schedule(plan, { jobs: resources.effective, run, signal });
    const counts = Object.fromEntries(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
      .map((key) => [key, results.reduce((n, result) => n + (result.counts?.[key] ?? 0), 0)]));
    const exitCode = signal?.aborted ? (signal.reason === 'SIGINT' ? 130 : 143) : results.every((r) => r.success) ? 0 : 1;
    const summary = { runDir, exitCode, complete: results.every((r) => r.status !== 'not_started'),
      success: exitCode === 0, interrupted: signal?.aborted ?? false, resources, counts, results };
    json(path.join(runDir, 'summary.json'), summary);
    return summary;
  } catch (error) {
    json(path.join(runDir, 'error.json'), { error: error.message, success: false });
    json(path.join(runDir, 'summary.json'), { runDir, exitCode: 1, success: false, complete: false,
      error: error.message, results: planned.map((file) => ({ path: file.path, status: 'not_started',
        success: false, reason: 'preflight refused' })) });
    throw error;
  } finally { process.umask(previousMask); }
}

export function parseArgs(args) {
  const options = { files: [], toolPath: [], jobs: DEFAULT_JOBS };
  const seen = new Set();
  const names = { '--root': 'root', '--artifacts': 'artifacts', '--git-bin': 'gitBin', '--tool-path': 'toolPath', '--jobs': 'jobs' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--file') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('Missing file');
      options.files.push(args[++i]);
    } else if (flag === '--inventory-only') {
      if (seen.has(flag)) throw new Error('Duplicate option');
      seen.add(flag); options.inventoryOnly = true;
    } else {
      if (!names[flag] || seen.has(flag) || !args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`Invalid option: ${flag}`);
      seen.add(flag); options[names[flag]] = args[++i];
    }
  }
  if (!options.root || !options.artifacts || !path.isAbsolute(options.root)) throw new Error('--root and --artifacts required (absolute paths)');
  if (!/^[1-9]\d*$/.test(String(options.jobs)) || !validJobs(Number(options.jobs))) {
    throw new Error(`jobs must be an integer from 1 to ${MAX_JOBS}`);
  }
  options.jobs = Number(options.jobs);
  if (typeof options.toolPath === 'string') options.toolPath = options.toolPath.split(path.delimiter);
  if (!options.inventoryOnly && (!options.gitBin || !options.toolPath.length)) throw new Error('Explicit --git-bin and --tool-path required');
  return options;
}

export const DIAGNOSTIC_LOG_BYTES = 256 * 1024; // Per stream: full small logs, otherwise head + tail.
function diagnosticText(value, workspace) {
  let text = String(value);
  if (workspace) text = text.split(workspace).join('[private-workspace]');
  // Keep TAP newlines/indentation, but never execute terminal controls or bidi overrides.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
const diagnosticWrite = (stream, text) => new Promise((resolve, reject) => {
  stream.write(text, (error) => error ? reject(error) : resolve());
});

async function printFailedLog(result, key, stream) {
  const label = `${key === 'stdout' ? 'TAP' : 'stderr'} for ${JSON.stringify(result.path)}`;
  const write = (text) => diagnosticWrite(stream, diagnosticText(text, result.workspace));
  await write(`--- BEGIN failed ${label} ---\n`);
  let fd;
  try {
    if (!result[key]) throw new Error('No log recorded for this job');
    // Only the runner's original TAP/stderr paths: no HOME/config/session/fixture reads or export.
    fd = fs.openSync(result[key], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Diagnostic log is not a regular file');
    const size = stat.size, half = DIAGNOSTIC_LOG_BYTES / 2;
    const ranges = size <= DIAGNOSTIC_LOG_BYTES ? [[0, size]] : [[0, half], [size - half, half]];
    await write(`Log snapshot: ${size} bytes; display limit ${DIAGNOSTIC_LOG_BYTES} bytes; full file retained.\n`);
    for (const [index, [position, length]] of ranges.entries()) {
      if (index) await write(`[TRUNCATED: omitted ${size - DIAGNOSTIC_LOG_BYTES} middle bytes; showing tail]\n`);
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const count = fs.readSync(fd, buffer, read, length - read, position + read);
        if (!count) break;
        read += count;
      }
      // Prefix diagnostic lines so child output cannot masquerade as runner status lines.
      await write(buffer.toString('utf8', 0, read).split('\n').map((line) => `| ${line}`).join('\n') + '\n');
      if (read !== length) await write(`[Log changed while reading: expected ${length}, read ${read} bytes]\n`);
    }
  } catch (error) {
    await write(`[Diagnostic log unavailable: ${error.code ?? error.message}]\n`);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  await write(`--- END failed ${label} ---\n`);
}

// Print only existing test diagnostics and allowlisted runner facts, never the full result/env/workspace.
// Called after started jobs settle: output backpressure cannot consume an active SDK/check deadline.
export async function reportResults(summary, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const results = summary.results;
  for (const result of results.filter((r) => !r.success && r.status !== 'not_started')) {
    const reasons = [];
    if (result.error) reasons.push(result.error);
    if (result.exitCode !== 0) reasons.push(`Exit code ${result.exitCode ?? 'unrecorded'}`);
    if (result.signal) reasons.push(`Signal ${result.signal}`);
    if (result.status === 'interrupted') reasons.push('Interrupted');
    if (!result.counts) reasons.push('Missing complete parent TAP footer');
    if (result.counts?.fail || result.counts?.cancelled) reasons.push('Failed/cancelled TAP cases');
    if (result.caseContract?.success === false) reasons.push(...result.caseContract.errors);
    if (result.uncertain) reasons.push('Owned-process settlement uncertain');
    if (result.survivors?.length) reasons.push(`${result.survivors.length} observed owned processes still live`);
    await diagnosticWrite(stderr, diagnosticText('FAILED FILE ' + JSON.stringify({ file: result.path,
      status: result.status, exitCode: result.exitCode ?? null, signal: result.signal ?? null,
      counts: result.counts ?? null, reasons, expectedCases: result.caseContract?.expectedCases?.length,
      settlementUncertain: result.uncertain ?? null, observedSurvivors: result.survivors?.length ?? null,
      observationLimited: result.observationLimited ?? null, sessionScanLimited: result.sessionScanLimited ?? null,
      sessionScanError: result.sessionScanError ?? null, unreadableOwned: result.unreadableOwned ?? [],
      workspaceRetained: result.workspaceRemoved === false }) + '\n', result.workspace));
    await printFailedLog(result, 'stdout', stdout);
    await printFailedLog(result, 'stderr', stderr);
  }
  await diagnosticWrite(summary.success ? stdout : stderr, 'TEST SUMMARY ' + JSON.stringify({
    exitCode: summary.exitCode, success: summary.success, completePlannedCoverage: summary.complete,
    interrupted: summary.interrupted, plannedFiles: results.length,
    passedFiles: results.filter((r) => r.success).length,
    failedFiles: results.filter((r) => !r.success && r.status !== 'not_started').length,
    notStartedFiles: results.filter((r) => r.status === 'not_started').length,
    settlementUncertainFiles: results.filter((r) => r.uncertain).length,
    observedSurvivingProcesses: results.reduce((n, r) => n + (r.survivors?.length ?? 0), 0), counts: summary.counts,
    settlementScope: 'Bounded owned observations only; unobserved/escaped descendants not certified',
  }) + '\n');
}

async function main() {
  const controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map((sig) => [sig, () => controller.abort(sig)]));
  for (const [sig, handler] of Object.entries(handlers)) process.on(sig, handler);
  try {
    const summary = await runSuite({ ...parseArgs(process.argv.slice(2)), signal: controller.signal,
      onEvent: (e) => {
        if (e.type === 'run') console.log(`Test artifacts: ${diagnosticText(JSON.stringify(e.runDir))}`);
        if (e.type === 'warning') console.error(diagnosticText(`WARNING ${JSON.stringify(e.path)}: ${e.message}`));
        if (e.type === 'start' || e.type === 'end') console.log(diagnosticText(`${e.type} ${JSON.stringify(e.path)}${e.status ? ` ${e.status}` : ''}`));
      } });
    process.exitCode = summary.exitCode;
    if (summary.results) await reportResults(summary); // Inventory-only is not test execution/acceptance.
  } catch (error) {
    console.error('RUNNER ERROR ' + diagnosticText(JSON.stringify({ message: error.message, code: error.code })));
    console.error('TEST SUMMARY ' + JSON.stringify({ exitCode: 1, success: false, completePlannedCoverage: false,
      reason: 'Runner setup, execution or diagnostic publication failed; not a successful test result' }));
    process.exitCode = 1;
  }
  finally { for (const [sig, handler] of Object.entries(handlers)) process.removeListener(sig, handler); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
