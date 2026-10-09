// Run-owned process supervision and bulk retention, not a general cleanup tool.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOwnedTracker, processIdentity } from './test-runner.mjs';

export const settlementScope = 'Bounded observed Linux identities and final session scan; unobserved escaped descendants are not certified';
export function directoryIdentity(directory) {
  const st = fs.lstatSync(directory);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('Expected owned private physical directory');
  return [st.dev, st.ino];
}

export function stopObservedDescendants(survivors, leaderPid, { read = processIdentity, kill = process.kill } = {}) {
  const errors = [];
  for (const previous of survivors) {
    if (previous.pid === leaderPid) continue;
    try {
      const now = read(previous.pid);
      if (now?.start === previous.start && now.state !== 'Z') kill(now.pid, 'SIGKILL');
    } catch (cause) { if (cause.code !== 'ESRCH') errors.push(cause); }
  }
  return errors;
}

export async function runOwned(command, args, { cwd, env, signal, logPath, echo = true,
  graceMs = 10_000, killMs = 5000, pipeMs = 1500 } = {}) {
  if (process.platform !== 'linux') throw new Error('Owned test supervision requires Linux');
  if (signal?.aborted) return { code: 130, interrupted: true, settled: false, scope: settlementScope };
  const log = fs.openSync(logPath, 'wx', 0o600);
  let child, original, tracker, timer, killTimer, abandonTimer, pipeTimer;
  let interrupted = false, interruptedAt, uncertain = false, error, closed = false, code = null, exitSignal = null;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  function recordError(cause) { error ??= cause.message; uncertain = true; }
  function send(value) {
    try {
      const now = original && processIdentity(original.pid);
      if (now?.start === original?.start && now?.ppid === process.pid && now?.group === now?.pid && now?.session === now?.pid && now?.state !== 'Z') {
        process.kill(-now.pid, value);
      }
    } catch (cause) { if (cause.code !== 'ESRCH') recordError(cause); }
  }
  function abandon() {
    uncertain = true;
    child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); resolveDone();
  }
  function interrupt() {
    if (interrupted) return;
    interrupted = true; interruptedAt = Date.now(); send(signal?.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    killTimer = setTimeout(() => {
      // Detached servers/browsers may be outside the owner's process group.
      // Stop authenticated observed descendants FIRST, then their owner. Never
      // signal a recycled numeric PID or infer ownership from command lines.
      try {
        for (const cause of stopObservedDescendants(tracker?.settle().survivors ?? [], original?.pid)) recordError(cause);
      } catch (cause) { recordError(cause); }
      send('SIGKILL'); abandonTimer = setTimeout(abandon, killMs);
    }, graceMs);
  }
  try {
    child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { original = child.pid && processIdentity(child.pid); tracker = createOwnedTracker(original); }
    catch (cause) { recordError(cause); }
    timer = setInterval(() => { try { tracker?.sample(); } catch (cause) { recordError(cause); } }, 40);
    for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', (bytes) => {
        try {
          let offset = 0;
          while (offset < bytes.length) offset += fs.writeSync(log, bytes, offset, bytes.length - offset);
          if (echo) output.write(bytes);
        } catch (cause) { recordError(cause); }
      });
      stream.on('error', recordError);
    }
    child.once('error', recordError);
    child.once('exit', (status, sig) => {
      code = status; exitSignal = sig;
      // A descendant holding a pipe cannot hang the supervisor indefinitely.
      pipeTimer = setTimeout(abandon, pipeMs);
    });
    child.once('close', (status, sig) => { clearTimeout(pipeTimer); closed = true; code = status; exitSignal = sig; resolveDone(); });
    signal?.addEventListener('abort', interrupt, { once: true });
    if (signal?.aborted) interrupt();
    await done;
    let observation = tracker?.settle() ?? { uncertain: true, survivors: [] };
    // Owner closure must not cancel escalation of its detached descendants.
    const quietDeadline = Date.now() + pipeMs;
    while ((closed || interrupted) && observation.survivors.length &&
        Date.now() < (interrupted ? interruptedAt + graceMs + killMs : quietDeadline)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      observation = tracker.settle();
    }
    fs.fsyncSync(log);
    const settled = closed && !uncertain && !observation.uncertain && observation.survivors.length === 0;
    return { code: code ?? (interrupted ? 130 : 1), signal: exitSignal, interrupted, settled,
      error, ...observation, scope: settlementScope };
  } finally {
    for (const handle of [timer, killTimer, abandonTimer, pipeTimer]) clearTimeout(handle);
    signal?.removeEventListener('abort', interrupt);
    fs.closeSync(log);
  }
}

// Inner summaries can VETO cleanup, never establish ownership or grant it.
export function innerSettlement(root) {
  const parent = path.join(root, 'artifacts');
  if (!fs.existsSync(parent)) return true;
  for (const name of fs.readdirSync(parent)) {
    const file = path.join(parent, name, 'summary.json');
    if (!fs.existsSync(file)) continue;
    const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (summary.interrupted || summary.results?.some((r) => r.uncertain || r.survivors?.length || r.observationLimited || r.sessionScanLimited || r.sessionScanError || r.unreadableOwned?.length)) return false;
  }
  return true;
}

export function cleanupBulk(root, original, { settled, interrupted, keepWorkspace, sourceIdentity, python = 'python3' }) {
  if (keepWorkspace) return { status: 'retained', reason: 'keep-workspace' };
  if (!settled || interrupted) return { status: 'retained', reason: 'interrupted or settlement uncertain' };
  if (JSON.stringify(directoryIdentity(root)) !== JSON.stringify(original)) throw new Error('Run root identity changed');
  if (!sourceIdentity) return { status: 'retained', reason: 'No verified source identity' };
  const result = spawnSync(python, ['-I', '-B', fileURLToPath(new URL('./cleanup-test-workspace.py', import.meta.url)),
    root, ...original.map(String), ...sourceIdentity.map(String)], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  if (result.error || result.status !== 0) throw new Error(`Bulk cleanup refused: ${result.error?.message ?? result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

export async function supervise(root, keepWorkspace, command, args) {
  const original = directoryIdentity(root);
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT'), onTerm = () => controller.abort('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const file = path.join(root, 'lifecycle.json');
  const state = { version: 1, root, original, command, args, keepWorkspace,
    dependencies: process.env.PI_WEB_TEST_MODULES ?? null,
    startedAt: new Date().toISOString(), status: 'running', cleanup: { status: 'not-attempted' } };
  const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  save();
  try {
    state.execution = await runOwned(command, args, { cwd: root, env: process.env, signal: controller.signal, logPath: path.join(root, 'execution.log') });
    const manifest = path.join(root, 'source-input.json');
    const sourceIdentity = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')).roots?.export?.slice(0, 2) : null;
    state.innerSettled = innerSettlement(root);
    state.cleanup = { status: 'in-progress' }; save();
    state.cleanup = cleanupBulk(root, original, { ...state.execution, keepWorkspace,
      settled: state.execution.settled && state.innerSettled, sourceIdentity });
    state.status = state.execution.code === 0 && state.execution.settled && state.innerSettled && !state.execution.interrupted ? 'passed' : 'failed';
    return state.status === 'passed' ? 0 : (state.execution.code || 1);
  } catch (error) {
    state.status = 'failed'; state.error = error.message;
    if (state.cleanup.status === 'in-progress') state.cleanup = { status: 'refused-or-partial', error: error.message };
    throw error;
  } finally {
    state.finishedAt = new Date().toISOString(); save();
    console.log(`Run lifecycle: ${file}; bulk ${state.cleanup.status}`);
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, keep, command, ...args] = process.argv.slice(2);
    if (!root || !['0', '1'].includes(keep) || !command) throw new Error('Internal supervisor arguments required');
    process.exitCode = await supervise(root, keep === '1', command, args);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
