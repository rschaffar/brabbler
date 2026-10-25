// FIRST dependency of selected client test entrypoints. Builtins only here:
// ESM evaluates this body before later Jiti/React/JSDOM dependency bodies.
// A bounded selected-graph capability fence, NOT a hostile-code sandbox.
import { beforeEach, after } from 'node:test';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import workerThreads from 'node:worker_threads';
import cluster from 'node:cluster';
import process from 'node:process';
import { syncBuiltinESMExports } from 'node:module';

export const NATIVE_DENIAL_CODE = 'PI_CLIENT_NATIVE_BOUNDARY_DENIED';
const define = Reflect.defineProperty, remove = Reflect.deleteProperty;
const descriptor = Object.getOwnPropertyDescriptor;
const records = [], unexpected = [], restorationFailures = [], preRootFatalCauses = [], deniedErrors = new WeakSet();
const installedHandles = new WeakSet();
let expectation, phase = 'installing', totalDenials = 0, unexpectedCount = 0;
let restoredCount = 0, omittedDiagnostics = 0;
let testBodyAdmission = false, restorationStarted = false, restorationMode;
// Retain EVERY event independently for the full module lifetime. Only the root
// AggregateError's displayed causes are bounded; overflow can never mean pass.
const DIAGNOSTIC_LIMIT = 64;
// Diagnostic metadata ONLY: original error objects stay in their existing ledger.
const restorationDiagnostics = [];
let restoreAttempts = 0, esmRestoreAttempted = false;
function diagnosticScalar(value, limit = 96) {
  return typeof value === 'string' ? value.slice(0, limit).replace(/[\x00-\x1f\x7f]/g, ' ') : '-';
}
function diagnosticData(object, key) {
  if ((typeof object !== 'object' || object === null) && typeof object !== 'function') return undefined;
  const own = descriptor(object, key);
  return own && Object.hasOwn(own, 'value') ? own.value : undefined;
}
function diagnosticError(error) {
  // Data descriptors only: no getters, toString, inspection or object graphs.
  const name = diagnosticData(error, 'name') ?? diagnosticData(Object.getPrototypeOf(error), 'name');
  const message = typeof error === 'string' ? error : diagnosticData(error, 'message');
  return `${diagnosticScalar(name, 24)}:${diagnosticScalar(message)}`;
}
function recordRestorationFailure(error, port, key, stage) {
  restorationFailures.push(error); // Preserve original identity BEFORE formatting.
  if (restorationDiagnostics.length >= 8) return;
  try {
    const cause = diagnosticData(error, 'cause'); // One bounded cause, no recursion.
    const details = `port=${diagnosticScalar(port, 48)} key=${diagnosticScalar(key, 40)} stage=${diagnosticScalar(stage, 24)} phase=${diagnosticScalar(phase, 24)} error=${diagnosticError(error)} cause=${cause === undefined ? '-' : diagnosticError(cause)}`;
    restorationDiagnostics.push(details.slice(0, 320));
  } catch {
    // Formatting cannot replace/clear a failure or skip another restore attempt.
    restorationDiagnostics.push(`port=${diagnosticScalar(port, 48)} key=${diagnosticScalar(key, 40)} stage=${diagnosticScalar(stage, 24)} phase=${diagnosticScalar(phase, 24)} diagnostic-unavailable`);
  }
}
function restorationFailureTitle() {
  // At most 8 x 320 chars plus scalar counts; keep Node TAP's title useful even
  // when it omits AggregateError.errors. No separate stdout/native capability.
  return `phase=${phase} mode=${restorationMode ?? '-'} restorationFailures=${restorationFailures.length} attempts=${restoreAttempts}/${records.length} restored=${restoredCount} esmRestoreAttempted=${esmRestoreAttempted} details=[${restorationDiagnostics.join(' | ')}] omitted=${Math.max(0, restorationFailures.length - restorationDiagnostics.length)}`;
}
function retain(error) {
  unexpectedCount++;
  unexpected.push(error);
}
function deny(port) {
  const error = new Error(`${NATIVE_DENIAL_CODE}: ${port}`);
  Object.defineProperties(error, {
    code: { value: NATIVE_DENIAL_CODE, enumerable: true },
    port: { value: port, enumerable: true },
  });
  deniedErrors.add(error); totalDenials++;
  if (expectation && expectation.port === port && expectation.error === undefined) expectation.error = error;
  else retain(error); // Independent of the caller catching/swallowing it.
  throw error;
}
const denied = port => function() { return deny(port); };
function sameDescriptor(a, b) {
  if (!a || !b) return a === b;
  const keys = ['value', 'writable', 'get', 'set', 'enumerable', 'configurable'];
  return keys.every(key => Object.hasOwn(a, key) === Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
function replace(object, key, value, port) {
  const previous = descriptor(object, key);
  const next = previous && Object.hasOwn(previous, 'value')
    ? { ...previous, value }
    : { configurable: true, writable: true, enumerable: previous?.enumerable ?? false, value };
  // Record BEFORE attempting installation: partial initialization still restores.
  records.push({ object, key, previous, next, port });
  if (!define(object, key, next)) throw new Error(`Cannot install client boundary: ${port}`);
}
function methods(object, names, prefix) {
  if (!object) return;
  for (const key of names) {
    if (typeof object[key] === 'function') replace(object, key, denied(`${prefix}.${key}`), `${prefix}.${key}`);
  }
}
function readFlags(flags) {
  if (flags === undefined || typeof flags === 'function') return true;
  if (typeof flags === 'string') return flags === 'r' || flags === 'rs' || flags === 'sr';
  if (typeof flags !== 'number' || !Number.isInteger(flags)) return false;
  const c = fs.constants;
  // Access mode zero is O_RDONLY. O_EXCL alone is harmless; a create/truncate,
  // append or non-read access mode is never a loader read capability.
  return (flags & (c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_APPEND)) === 0;
}
function fenceFileHandle(handle) {
  if (installedHandles.has(handle)) return handle;
  installedHandles.add(handle);
  // Even an O_RDONLY handle can chmod/chown/utimes. No private prototype import
  // or native open at bootstrap: fence the REAL handle returned by an allowed read.
  methods(handle, ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes',
    'sync', 'datasync', 'createWriteStream'], 'FileHandle');
  const stream = handle.createReadStream;
  if (typeof stream === 'function') replace(handle, 'createReadStream', function(options) {
    if (!readFlags(options?.flags)) return deny('FileHandle.createReadStream.writeFlags');
    return stream.call(this, options);
  }, 'FileHandle.createReadStream');
  return handle;
}

// Shared CLOSED synchronous descriptor restoration, never exported. One pass:
// idempotent even if a pre-root fatal is followed by root-after processing.
function restoreSynchronously(mode) {
  if (restorationStarted) return;
  restorationStarted = true;
  restorationMode = mode;
  phase = 'restoring';
  for (let index = records.length - 1; index >= 0; index--) {
    const { object, key, previous, next, port } = records[index];
    try {
      if (!sameDescriptor(descriptor(object, key), next)) recordRestorationFailure(new Error(`Client boundary descriptor drift: ${port}`), port, key, 'observe-drift');
    } catch (error) { recordRestorationFailure(error, port, key, 'observe-descriptor'); }
    // Observation failure never skips this restore; restore failure never skips
    // another actual descriptor. Collectors stay LIVE throughout the pass.
    restoreAttempts++; // Count the actual independently attempted descriptor.
    try {
      if (!(previous ? define(object, key, previous) : remove(object, key))) throw new Error(`Cannot restore client boundary: ${port}`);
      if (!sameDescriptor(descriptor(object, key), previous)) throw new Error(`Client boundary restore mismatch: ${port}`);
      restoredCount++;
    } catch (error) { recordRestorationFailure(error, port, key, 'restore-or-verify'); }
  }
  esmRestoreAttempted = true;
  try { syncBuiltinESMExports(); } catch (error) { recordRestorationFailure(error, 'node:module', 'syncBuiltinESMExports', 'esm-restore'); }
  phase = mode === 'pre-root-fatal' ? 'pre-root-restored' : 'restored';
}

// FIRST registered root beforeEach: actual per-test setup admission, not root
// before (which can run during pending TLA with no entry testcase admitted).
// Ancestor beforeEach hooks precede later per-test beforeEach/body work. This
// monotonic flag is never reset between cases; normal after owns all joins.
// Root/suite before hooks or import-time business work require separate review.
beforeEach(() => {
  testBodyAdmission = true;
  if (restorationStarted) throw new Error('Cannot admit test bodies after pre-root fatal restoration');
});
function preRootFatalMonitor(error) {
  if (testBodyAdmission || restorationStarted) return;
  preRootFatalCauses.push(error); // Preserve the ORIGINAL object, never replace it.
  try { restoreSynchronously('pre-root-fatal'); }
  catch (restoreError) {
    // Never throw from this passive monitor and mask the primary fatal error.
    // Individual descriptor and ESM failures above are already independent.
    recordRestorationFailure(restoreError, 'bootstrap', '-', 'fatal-restore-framework');
    phase = 'pre-root-restore-aborted';
  }
}
// A monitor only: no uncaughtException/rejection handler, return-value policy,
// manual event replay, forced exit, warning suppression or exit-time fallback.
process.on('uncaughtExceptionMonitor', preRootFatalMonitor);

// Normal children still finish their actual per-test joins BEFORE root-after.
// No async join is invented for fatal pre-root module evaluation.
after(() => {
  restoreSynchronously('normal-after');
  try { process.off('uncaughtExceptionMonitor', preRootFatalMonitor); }
  catch (error) { recordRestorationFailure(error, 'process.off', 'uncaughtExceptionMonitor', 'remove-monitor'); }
  const allFailures = [...preRootFatalCauses, ...restorationFailures, ...unexpected];
  const errors = allFailures.slice(0, DIAGNOSTIC_LIMIT);
  omittedDiagnostics = Math.max(0, allFailures.length - DIAGNOSTIC_LIMIT);
  if (omittedDiagnostics) errors.push(new Error(`Client boundary omitted ${omittedDiagnostics} diagnostics from display; all causes retained and fatal`));
  if (errors.length) throw new AggregateError(errors, `Client native boundary failed (${unexpectedCount} unexpected events, ${totalDenials} denials); ${restorationFailureTitle()}`);
});

try {
  const mutations = ['writeFile', 'appendFile', 'truncate', 'unlink', 'rename', 'rm', 'mkdir', 'mkdtemp', 'rmdir',
    'copyFile', 'cp', 'chmod', 'chown', 'lchmod', 'lchown', 'link', 'symlink', 'utimes', 'lutimes'];
  methods(fs, mutations.flatMap(name => [name, `${name}Sync`]), 'fs');
  methods(fsPromises, mutations, 'fs.promises');
  methods(fs, ['write', 'writeSync', 'writev', 'writevSync', 'ftruncate', 'ftruncateSync', 'fchmod', 'fchmodSync',
    'fchown', 'fchownSync', 'futimes', 'futimesSync', 'fsync', 'fsyncSync', 'fdatasync', 'fdatasyncSync',
    'createWriteStream', 'WriteStream', 'FileWriteStream', 'watch', 'watchFile'], 'fs');
  methods(fsPromises, ['watch'], 'fs.promises');
  for (const [object, name, port] of [[fs, 'open', 'fs.open'], [fs, 'openSync', 'fs.openSync'], [fsPromises, 'open', 'fs.promises.open']]) {
    const original = object[name];
    replace(object, name, function(path, flags, ...args) {
      if (!readFlags(flags)) return deny(`${port}.writeFlags`);
      const result = original.call(this, path, flags, ...args);
      return object === fsPromises ? result.then(fenceFileHandle) : result;
    }, port);
  }
  // readFile's singular `flag` can otherwise create/truncate via builtin-internal
  // opens; guarding only the exported fs.open functions does not cover it.
  for (const [object, name, port] of [[fs, 'readFile', 'fs.readFile'], [fs, 'readFileSync', 'fs.readFileSync'],
    [fsPromises, 'readFile', 'fs.promises.readFile']]) {
    const original = object[name];
    replace(object, name, function(path, options, ...args) {
      if (!readFlags(typeof options === 'object' ? options?.flag : undefined)) return deny(`${port}.writeFlags`);
      return original.call(this, path, options, ...args);
    }, port);
  }
  for (const name of ['ReadStream', 'FileReadStream']) {
    const Original = fs[name];
    if (typeof Original !== 'function') continue;
    const FencedReadStream = function(path, options) {
      if (!readFlags(typeof options === 'object' ? options?.flags : undefined)) return deny(`fs.${name}.writeFlags`);
      return Reflect.construct(Original, [path, options], new.target === FencedReadStream || !new.target ? Original : new.target);
    };
    Object.setPrototypeOf(FencedReadStream, Original);
    FencedReadStream.prototype = Original.prototype;
    replace(fs, name, FencedReadStream, `fs.${name}`);
  }
  const readStream = fs.createReadStream;
  replace(fs, 'createReadStream', function(path, options) {
    if (!readFlags(typeof options === 'object' ? options?.flags : undefined)) return deny('fs.createReadStream.writeFlags');
    return readStream.call(this, path, options);
  }, 'fs.createReadStream');
  methods(childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'], 'child_process');
  methods(childProcess.ChildProcess?.prototype, ['spawn'], 'ChildProcess.prototype');
  methods(cluster, ['fork'], 'cluster');
  methods(workerThreads, ['Worker'], 'worker_threads');
  methods(http, ['request', 'get', 'createServer', 'ClientRequest'], 'http');
  methods(https, ['request', 'get', 'createServer'], 'https');
  methods(http.Agent?.prototype, ['createConnection', 'addRequest'], 'http.Agent.prototype');
  methods(https.Agent?.prototype, ['createConnection', 'addRequest'], 'https.Agent.prototype');
  methods(net, ['connect', 'createConnection', 'createServer'], 'net');
  methods(net.Socket?.prototype, ['connect'], 'net.Socket.prototype');
  methods(net.Server?.prototype, ['listen'], 'net.Server.prototype');
  methods(tls, ['connect', 'createServer'], 'tls');
  methods(tls.TLSSocket?.prototype, ['connect'], 'tls.TLSSocket.prototype');
  const DatagramSocket = dgram.Socket;
  methods(DatagramSocket?.prototype, ['connect', 'bind', 'send', 'sendto', 'addMembership', 'addSourceSpecificMembership'], 'dgram.Socket.prototype');
  methods(dgram, ['createSocket', 'Socket'], 'dgram');
  methods(http2, ['connect', 'createServer', 'createSecureServer'], 'http2');
  methods(process, ['chdir', 'kill', '_kill', '_debugProcess', '_debugEnd', 'abort', 'exit', 'reallyExit', 'dlopen', 'setuid', 'seteuid', 'setgid', 'setegid',
    'setgroups', 'initgroups', 'send'], 'process');
  const umask = process.umask;
  replace(process, 'umask', function(...args) {
    if (args.length) return deny('process.umask.set');
    return umask.call(this);
  }, 'process.umask');
  // These host defaults are replaced only by existing controlled client ports.
  // Memory, native JS clocks, React and DOM internals are NOT substituted.
  for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'SharedWorker']) {
    replace(globalThis, key, denied(`globalThis.${key}`), `globalThis.${key}`);
  }
  syncBuiltinESMExports(); // BEFORE any subsequent dependency initializes.
  phase = 'active';
} catch (error) {
  retain(error);
  // Do not eagerly unguard on partial setup: root hook restores all actual
  // descriptors independently. A failed dependency cannot lose its collector.
  throw error;
}

// Only one explicitly registered synchronous denial call. A swallowed marker,
// wrong port, extra attempt, async callback or missing guard cannot pass. This
// grants no native capability and cannot erase any earlier/unrelated denial.
export function expectNativeDenial(port, call) {
  if (expectation || phase !== 'active' || typeof port !== 'string' || typeof call !== 'function') {
    const error = new Error('Invalid/nested client native denial probe'); retain(error); throw error;
  }
  const registered = { port, error: undefined };
  expectation = registered;
  let caught, returned;
  try { returned = call(); } catch (error) { caught = error; }
  finally { expectation = undefined; }
  if (!registered.error || caught !== registered.error || !deniedErrors.has(caught)) {
    // Do not await arbitrary work under an expectation. Probes must be sync.
    if (returned && typeof returned.then === 'function') void returned.catch(() => {});
    const error = new Error(`Missing exact synchronous client native denial: ${port}`, { cause: caught });
    if (registered.error) retain(registered.error); // Invalid expectation cannot launder its original denial.
    retain(error); throw error;
  }
  return caught;
}

// Read-only status for a later root-after witness. No error objects, mutable
// ledger, descriptors, original native functions, restore or allow API escapes.
export function clientNativeBoundaryStatus() {
  return Object.freeze({ phase, installed: records.length, restored: restoredCount, totalDenials, unexpectedCount,
    testBodyAdmission, restorationMode, restorationFailures: restorationFailures.length, preRootFatalCount: preRootFatalCauses.length });
}
