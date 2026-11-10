// Validate guest-owned output BEFORE the pinned driver's host copytree, which
// dereferences symlinks. Only root-private, settled staging is exported.
import assert from 'node:assert/strict';
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

function readMigrationFile(root, name, limit) {
  assert.equal(fs.realpathSync(root), root);
  const fd = fs.openSync(path.join(root, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= limit, `Unsafe/oversized migration artifact: ${name}`);
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

export async function inspectMigrationArtifacts(root, plan) {
  // Reuse only validators, never the core runner's scheduler/resource admission.
  const { parseTap, validateCases } = await import('./test-runner.mjs');
  const text = readMigrationFile(root, 'migration.tap', 8 * 1024 * 1024);
  readMigrationFile(root, 'migration.stderr.log', 2 * 1024 * 1024);
  const tap = parseTap(text), contract = validateCases(tap, plan.migration.expectedCases);
  assert.equal(contract.success, true, `Incomplete migration cases: ${contract.errors.join('; ')}`);
  const identities = [...text.matchAll(/^# BRABBLER_MIGRATION_IDENTITY (.+)$/gm)];
  assert.equal(identities.length, 1, 'Exactly one executed converter identity required');
  return { identity: JSON.parse(identities[0][1]), counts: tap.counts };
}

export async function validateMigrationArtifacts(root, plan, proof, settlement) {
  const report = JSON.parse(readMigrationFile(root, 'migration.json', 64 * 1024));
  assert.deepEqual(Object.keys(report).sort(), ['execution', 'proof', 'settlement']);
  assert.deepEqual(report.proof, proof); assert.deepEqual(report.settlement, settlement);
  if (proof !== null) {
    assert.deepEqual(report.execution, proof.execution);
    const actual = await inspectMigrationArtifacts(root, plan);
    assert.deepEqual(actual, { identity: proof.identity, counts: proof.counts });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (fs.readFileSync('/etc/brabbler-acceptance-guest', 'utf8').trim() !== 'brabbler-nixos-acceptance-v1') throw new Error('Disposable guest required');
    const [mode, value] = process.argv.slice(2);
    if (mode === 'tree' && ['/var/lib/brabbler-evidence', '/var/lib/brabbler-evidence-probe'].includes(value)) assertEvidenceTree(value);
    else if (mode === 'port' && /^3014[1-4]$/.test(value)) await assertPortClosed(Number(value));
    else if (mode === 'migration' && process.argv[4] === '/var/lib/brabbler-evidence') {
      const { createServicePlan } = await import('./service-plan.mjs');
      const plan = createServicePlan(JSON.parse(fs.readFileSync(value, 'utf8')));
      console.log(JSON.stringify(await inspectMigrationArtifacts(process.argv[4], plan)));
    } else throw new Error('Unknown evidence check');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
