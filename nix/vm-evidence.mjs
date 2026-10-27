// Validate guest-owned output BEFORE the pinned driver's host copytree, which
// dereferences symlinks. Only root-private, settled staging is exported.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertEvidenceTree(root) {
  const initial = fs.lstatSync(root);
  if (!initial.isDirectory() || fs.realpathSync(root) !== root) throw new Error('Evidence root must be a physical directory');
  let entries = 0;
  function visit(file) {
    if (++entries > 10000) throw new Error('Evidence entry bound exceeded');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Unsafe evidence symbolic link: ${file}`);
    if (stat.dev !== initial.dev || !stat.isFile() && !stat.isDirectory()) throw new Error(`Unsafe evidence special entry: ${file}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
  }
  visit(root);
}

export function assertPortClosed(port, { timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TCP port');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = error => { socket.destroy(); if (error) reject(error); else resolve(); };
    socket.setTimeout(timeoutMs, () => finish(new Error('TCP closure observation timed out')));
    socket.once('connect', () => finish(new Error('TCP port is still listening')));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? null : error));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (fs.readFileSync('/etc/brabbler-acceptance-guest', 'utf8').trim() !== 'brabbler-nixos-acceptance-v1') throw new Error('Disposable guest required');
    const [mode, value] = process.argv.slice(2);
    if (mode === 'tree' && ['/var/lib/brabbler-evidence', '/var/lib/brabbler-evidence-probe'].includes(value)) assertEvidenceTree(value);
    else if (mode === 'port' && /^3014[1-4]$/.test(value)) await assertPortClosed(Number(value));
    else throw new Error('Unknown evidence check');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
