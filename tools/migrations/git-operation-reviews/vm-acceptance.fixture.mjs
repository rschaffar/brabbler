// Guest-only registration: every original converter assertion runs unconditionally.
import './converter.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { metadataFixture, ownerSnapshot, nodeChild, guardScript, cliScript, dryRunArgs } from './metadata-support.fixture.mjs';
import { toolIdentity } from './run.mjs';
import { sdkVersion } from './target.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function childResult(child, status = 0) {
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, status, child.stderr);
  return JSON.parse(child.stdout);
}
function names(file, set = false) {
  const fd = fs.openSync(file, 'r');
  try {
    const script = `import os,json\n${set ? "os.setxattr(3,'user.brabbler-test',b'synthetic')\n" : ''}print(json.dumps(os.listxattr(3)))`;
    return childResult(spawnSync('python3', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8' }));
  } finally { fs.closeSync(fd); }
}
function guestFixture(t) {
  assert.equal(fs.readFileSync('/etc/brabbler-acceptance-guest', 'utf8').trim(), 'brabbler-nixos-acceptance-v1');
  assert.equal(process.getuid(), 1000); assert.equal(process.getgid(), 100);
  assert.equal(process.cwd(), source);
  assert.equal(process.env.TMPDIR, '/home/t0/migration/tmp');
  const tmp = fs.lstatSync(process.env.TMPDIR);
  assert.ok(tmp.isDirectory() && tmp.uid === 1000 && (tmp.mode & 0o777) === 0o700);
  assert.equal(fs.realpathSync(process.env.TMPDIR), process.env.TMPDIR);
  const f = metadataFixture(t);
  assert.equal(dirname(f.root), process.env.TMPDIR);
  return f;
}
function blocked(f) {
  const before = ownerSnapshot(f), beforeNames = names(f.file);
  assert.deepEqual(childResult(nodeChild(guardScript, [f.file])), { reason: 'unsupported-extended-metadata' });
  const plan = childResult(nodeChild(cliScript, dryRunArgs(f)), 2);
  assert.equal(plan.blocks, 1); assert.deepEqual(plan.reasons, { 'unsupported-extended-metadata': 1 });
  const apply = nodeChild(cliScript, ['apply', '--output', f.output, '--confirm', plan.confirmation,
    '--writers-stopped', 'I_STOPPED_ALL_SELECTED_WRITERS']);
  assert.equal(apply.error, undefined); assert.equal(apply.signal, null); assert.equal(apply.status, 1);
  assert.equal(JSON.parse(apply.stderr).reason, 'unresolved-blocks-retain-explicitly-required');
  assert.deepEqual(ownerSnapshot(f), before); assert.deepEqual(names(f.file), beforeNames);
}

test('guest empty descriptor query permits conversion and exact restore', t => {
  const f = guestFixture(t), before = ownerSnapshot(f);
  assert.deepEqual(names(f.file), []); // Real FD query; unavailable is a hard failure.
  assert.deepEqual(childResult(nodeChild(guardScript, [f.file])), { accepted: true });
  const plan = childResult(nodeChild(cliScript, dryRunArgs(f)));
  assert.equal(plan.blocks, 0); assert.equal(plan.classifications.convertible, 1);
  assert.deepEqual(ownerSnapshot(f), before);
  const args = ['--output', f.output, '--confirm', plan.confirmation, '--writers-stopped', 'I_STOPPED_ALL_SELECTED_WRITERS'];
  assert.equal(childResult(nodeChild(cliScript, ['apply', ...args])).states.installed, 1);
  assert.notEqual(ownerSnapshot(f).bytes, before.bytes);
  assert.equal(childResult(nodeChild(cliScript, ['check', '--output', f.output])).states.installed, 1);
  assert.equal(childResult(nodeChild(cliScript, ['resume', ...args])).states.installed, 1);
  childResult(nodeChild(cliScript, ['restore', ...args]));
  const after = ownerSnapshot(f);
  for (const key of ['bytes', 'mode', 'uid', 'gid']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(names(f.file), []);
  const inputs = JSON.parse(fs.readFileSync('/etc/brabbler-service.json', 'utf8')).migration;
  assert.equal(inputs.source, source);
  assert.equal(fs.realpathSync(join(source, 'node_modules')), inputs.modules);
  assert.equal(process.execPath, fs.realpathSync(inputs.node));
  assert.equal(fs.readFileSync('/proc/self/cgroup', 'utf8').trim(), `0::/system.slice/${inputs.unit}`);
  // One machine-readable TAP comment, bound to the exact executed local closure.
  console.log('BRABBLER_MIGRATION_IDENTITY ' + JSON.stringify({ inputs, uid: process.getuid(),
    tmp: { path: process.env.TMPDIR, uid: tmpOwner(), mode: '0700', physical: true },
    node: process.versions.node, sdk: sdkVersion, tool: toolIdentity(), probe: 'available' }));
});
function tmpOwner() { return fs.lstatSync(process.env.TMPDIR).uid; }

test('guest user xattr refuses guard and CLI without replacing owner', t => {
  const f = guestFixture(t);
  assert.deepEqual(names(f.file), []);
  assert.deepEqual(names(f.file, true), ['user.brabbler-test']);
  blocked(f); // Attribute values are never read.
});

test('guest POSIX ACL refuses guard and CLI without replacing owner', t => {
  const f = guestFixture(t);
  assert.deepEqual(names(f.file), []);
  execFileSync('setfacl', ['-m', 'u:65534:r--', f.file], { stdio: 'pipe' });
  assert.ok(names(f.file).includes('system.posix_acl_access'));
  blocked(f); // No getfacl/getxattr or secret-value diagnostic.
});
