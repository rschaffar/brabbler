// Core always exercises a real unavailable query, even on older Nix daemons.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { metadataFixture, ownerSnapshot, nodeChild, guardScript, cliScript, dryRunArgs } from './metadata-support.fixture.mjs';

function result(child) {
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
test('denied real descriptor query is unavailable, never an empty attribute list', t => {
  const f = metadataFixture(t), before = ownerSnapshot(f);
  const child = nodeChild(guardScript, [f.file], { blocked: true });
  assert.deepEqual(result(child), { reason: 'extended-metadata-query-unavailable' });
  assert.deepEqual(ownerSnapshot(f), before);
});
test('denied metadata inspection blocks real CLI planning and apply without replacing the owner', t => {
  const f = metadataFixture(t), before = ownerSnapshot(f);
  const child = nodeChild(cliScript, dryRunArgs(f), { blocked: true });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 2, child.stderr);
  const plan = JSON.parse(child.stdout);
  assert.equal(plan.blocks, 1);
  assert.deepEqual(plan.reasons, { 'extended-metadata-query-unavailable': 1 });
  assert.deepEqual(ownerSnapshot(f), before);
  const applied = nodeChild(cliScript, ['apply', '--output', f.output, '--confirm', plan.confirmation,
    '--writers-stopped', 'I_STOPPED_ALL_SELECTED_WRITERS'], { blocked: true });
  assert.equal(applied.error, undefined); assert.equal(applied.signal, null);
  assert.equal(applied.status, 1);
  assert.equal(JSON.parse(applied.stderr).reason, 'unresolved-blocks-retain-explicitly-required');
  assert.deepEqual(ownerSnapshot(f), before);
});
test('real permission-denied descriptor query fails closed rather than claiming empty metadata', t => {
  const f = metadataFixture(t), before = ownerSnapshot(f);
  assert.deepEqual(result(nodeChild(guardScript, [f.file], { denied: true })), { reason: 'extended-metadata-query-failed' });
  assert.deepEqual(ownerSnapshot(f), before);
});
test('signaled probe fails closed without disclosing child output', t => {
  const f = metadataFixture(t), bin = join(f.root, 'bin'); fs.mkdirSync(bin);
  const shell = process.env.SHELL; assert.ok(shell, 'declared test shell');
  const marker = 'synthetic-signaled-output-must-stay-private';
  fs.writeFileSync(join(bin, 'python3'), `#!${shell}\nprintf '%s\\n' '${marker}' >&2\nkill -TERM $$\n`, { mode: 0o700 });
  const child = nodeChild(guardScript, [f.file], { env: { ...process.env, PATH: bin } });
  assert.deepEqual(result(child), { reason: 'extended-metadata-probe-failed' });
  assert.equal((child.stdout + child.stderr).includes(marker), false);
});
test('missing Python fails closed with a bounded probe reason', t => {
  const f = metadataFixture(t), empty = join(f.root, 'empty-path'); fs.mkdirSync(empty);
  const child = nodeChild(guardScript, [f.file], { env: { ...process.env, PATH: empty } });
  assert.deepEqual(result(child), { reason: 'extended-metadata-probe-failed' });
});
for (const status of [1, 5, 7]) test(`failed probe exit ${status} refuses without disclosing child output`, t => {
  const f = metadataFixture(t), bin = join(f.root, 'bin'); fs.mkdirSync(bin);
  const shell = process.env.SHELL; assert.ok(shell, 'declared test shell');
  const marker = 'synthetic-child-output-must-stay-private';
  // Only this external subprocess failure is supplied; guard and CLI policy stay real.
  fs.writeFileSync(join(bin, 'python3'), `#!${shell}\nprintf '%s\\n' '${marker}' >&2\nexit ${status}\n`, { mode: 0o700 });
  const child = nodeChild(guardScript, [f.file], { env: { ...process.env, PATH: bin } });
  assert.deepEqual(result(child), { reason: 'extended-metadata-query-failed' });
  assert.equal((child.stdout + child.stderr).includes(marker), false);
});
