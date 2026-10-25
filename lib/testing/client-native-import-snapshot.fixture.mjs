// N child's pre-bootstrap descriptor snapshot. No native mutations or allows.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import wt from 'node:worker_threads';
import cluster from 'node:cluster';
import process from 'node:process';
import 'node:test'; // Initialize the actual test harness before the snapshot.
const get = Object.getOwnPropertyDescriptor;
const entries = [];
function take(object, names) {
  if (!object) return;
  for (const key of names) entries.push([object, key, get(object, key)]);
}
const mutations = ['writeFile', 'appendFile', 'truncate', 'unlink', 'rename', 'rm', 'mkdir', 'mkdtemp', 'rmdir',
  'copyFile', 'cp', 'chmod', 'chown', 'lchmod', 'lchown', 'link', 'symlink', 'utimes', 'lutimes'];
// Read exported lazy stream constructors as the bootstrap's method checks do,
// before retaining their actual descriptors; no constructor is invoked.
void fs.ReadStream; void fs.FileReadStream; void fs.WriteStream; void fs.FileWriteStream;
take(fs, [...mutations.flatMap(n => [n, `${n}Sync`]), 'write', 'writeSync', 'writev', 'writevSync',
  'ftruncate', 'ftruncateSync', 'fchmod', 'fchmodSync', 'fchown', 'fchownSync', 'futimes', 'futimesSync',
  'fsync', 'fsyncSync', 'fdatasync', 'fdatasyncSync', 'createWriteStream', 'WriteStream', 'FileWriteStream',
  'watch', 'watchFile', 'open', 'openSync', 'readFile', 'readFileSync', 'ReadStream', 'FileReadStream', 'createReadStream']);
take(fsp, [...mutations, 'watch', 'open', 'readFile']);
take(cp, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
take(cp.ChildProcess?.prototype, ['spawn']); take(cluster, ['fork']); take(wt, ['Worker']);
take(http, ['request', 'get', 'createServer', 'ClientRequest']); take(https, ['request', 'get', 'createServer']);
take(http.Agent?.prototype, ['createConnection', 'addRequest']); take(https.Agent?.prototype, ['createConnection', 'addRequest']);
take(net, ['connect', 'createConnection', 'createServer']); take(net.Socket?.prototype, ['connect']); take(net.Server?.prototype, ['listen']);
take(tls, ['connect', 'createServer']); take(tls.TLSSocket?.prototype, ['connect']);
take(dgram.Socket?.prototype, ['connect', 'bind', 'send', 'sendto', 'addMembership', 'addSourceSpecificMembership']);
take(dgram, ['createSocket', 'Socket']); take(http2, ['connect', 'createServer', 'createSecureServer']);
take(process, ['chdir', 'kill', '_kill', '_debugProcess', '_debugEnd', 'abort', 'exit', 'reallyExit', 'dlopen',
  'setuid', 'seteuid', 'setgid', 'setegid', 'setgroups', 'initgroups', 'send', 'umask']);
take(globalThis, ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'SharedWorker']);
// N-only diagnostic delivery: capture BEFORE the bootstrap fences fs.writeSync.
// Closed over here, never exported, and usable only for fixed stdout fd 1.
// Receipts below contain actual booleans/exit code, not reconstructed outcomes.
const diagnosticWriteSync = fs.writeSync;
const emit = text => {
  const receipt = Buffer.from(text, 'utf8');
  if (receipt.length > 256) throw new Error('CNB lifecycle receipt exceeds 256 bytes');
  let offset = 0;
  while (offset < receipt.length) {
    const written = diagnosticWriteSync(1, receipt, offset, receipt.length - offset);
    if (written <= 0) throw new Error('CNB lifecycle receipt made no write progress');
    offset += written;
  }
};
let rootAfter = false, restored = false;
function same(a, b) {
  if (!a || !b) return a === b;
  return ['value', 'writable', 'get', 'set', 'enumerable', 'configurable'].every(key =>
    Object.hasOwn(a, key) === Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
function actualDescriptorsMatch() { return entries.every(([o, k, d]) => same(get(o, k), d)); }
export function recordRootAfter(status) {
  rootAfter = true;
  restored = actualDescriptorsMatch() && status.phase === 'restored' && status.installed > 0 &&
    status.restored === status.installed && status.unexpectedCount === 0;
  emit(`CNB_ROOT_AFTER restored=${restored} descriptors=${actualDescriptorsMatch()}\n`);
}
// Called by the POST-bootstrap passive monitor observer, after the boundary's
// earlier monitor. Fixed boolean receipts only, using the existing private fd 1.
export function recordFatalMonitor(status, guarded, kind) {
  const descriptors = actualDescriptorsMatch();
  if (kind === 'pre-root') {
    const phase = status.phase === 'pre-root-restored' && status.restorationMode === 'pre-root-fatal';
    const clean = status.unexpectedCount === 0 && status.restorationFailures === 0;
    const complete = status.installed > 0 && status.restored === status.installed && status.preRootFatalCount > 0;
    emit(`CNB_PRE_ROOT_FATAL admission=${status.testBodyAdmission} phase=${phase} descriptors=${descriptors} clean=${clean} complete=${complete}\n`);
  } else if (kind === 'post-root') {
    const active = status.phase === 'active' && status.restorationMode === undefined;
    const restoredEarly = status.restored !== 0;
    emit(`CNB_POST_ROOT_MONITOR admission=${status.testBodyAdmission} active=${active} guarded=${guarded && !descriptors} restoredEarly=${restoredEarly}\n`);
  }
}
process.once('exit', code => {
  emit(`CNB_EXIT rootAfter=${rootAfter} descriptors=${actualDescriptorsMatch()} restored=${restored} code=${code}\n`);
});
