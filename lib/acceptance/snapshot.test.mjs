import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createJiti } from 'jiti';
import { fixture, profile } from './test.fixture.mjs';
const jiti = createJiti(import.meta.url);
const { validateProfiles, acceptanceProject, saveProfiles, readProfiles } = await jiti.import('./config.ts');
const { captureSnapshot, verifySnapshot } = await jiti.import('./snapshot.ts');
const { nixAcceptanceProfile } = await jiti.import('./types.ts');

test('profile schemas refuse executable tool inputs, escapes, duplicate roots and sensitive/generated names', () => {
  assert.equal(validateProfiles([profile()])[0].name, 'full');
  for (const inputs of [['../secret'], ['/etc'], ['.env'], ['auth.json'], ['a/.ssh'], ['node_modules'], ['x', 'x/y'], ['x', 'x'], ['x\\y'], ['x:stream']]) {
    assert.throws(() => validateProfiles([{ ...profile(), inputs }]), /profile|Snapshot/i);
  }
  assert.throws(() => validateProfiles([{ ...profile(), command: 'sh' }]), /fields/);
  assert.throws(() => validateProfiles([{ ...profile(), cpus: 0 }]), /profile/);
  assert.throws(() => validateProfiles([{ ...profile(), permission: 'yes' }]), /profile/);
});
test('capture is content keyed across copies, ignores private descendants and verifies frozen contents', async (t) => {
  const f = fixture(t); mkdirSync(join(f.cwd, 'src'));
  writeFileSync(join(f.cwd, 'src', 'a.ts'), 'original');
  writeFileSync(join(f.cwd, 'src', '.env'), 'synthetic secret placeholder');
  writeFileSync(join(f.cwd, 'src', 'credentials.json'), 'synthetic');
  const first = await captureSnapshot(f.cwd, ['src'], join(f.root, 'first'));
  const second = await captureSnapshot(f.cwd, ['src'], join(f.root, 'second'));
  assert.equal(first.digest, second.digest); assert.equal(first.files, 1);
  await verifySnapshot(first);
  writeFileSync(join(f.cwd, 'src', 'a.ts'), 'later source edits');
  assert.equal(readFileSync(join(first.directory, 'src', 'a.ts'), 'utf8'), 'original');
  await verifySnapshot(first);
  chmodSync(join(first.directory, 'src', 'a.ts'), 0o600); writeFileSync(join(first.directory, 'src', 'a.ts'), 'tampered');
  await assert.rejects(verifySnapshot(first), /changed/);
});
test('snapshot refuses symlink files, directory ancestors and special source entries', async (t) => {
  const f = fixture(t);
  symlinkSync(join(f.cwd, 'test.mjs'), join(f.cwd, 'linked'));
  await assert.rejects(captureSnapshot(f.cwd, ['linked'], join(f.root, 'file-link')), /Unsafe/);
  symlinkSync(f.cwd, join(f.cwd, 'dir-link'));
  await assert.rejects(captureSnapshot(f.cwd, ['dir-link/test.mjs'], join(f.root, 'dir-link')), /ENOTDIR|ELOOP/);
  execFileSync('mkfifo', [join(f.cwd, 'pipe')]);
  await assert.rejects(captureSnapshot(f.cwd, ['pipe'], join(f.root, 'pipe')), /Unsafe/);
});
test('capture cancellation does not publish a usable snapshot', async (t) => {
  const f = fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(captureSnapshot(f.cwd, ['test.mjs'], join(f.root, 'cancelled'), controller.signal), /abort/i);
});
test('linked registered worktrees share project configuration while replacement directories do not', (t) => {
  const f = fixture(t);
  const git = (...args) => execFileSync('git', ['-C', f.cwd, ...args], { stdio: 'ignore' });
  git('init', '-b', 'main'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'fixture');
  const linked = join(f.root, 'linked'); git('worktree', 'add', '-b', 'feature', linked);
  const project = acceptanceProject(f.cwd), sibling = acceptanceProject(linked);
  assert.equal(project.identity, sibling.identity);
  saveProfiles(project, [profile()]); assert.equal(readProfiles(sibling)[0].name, 'full');
  assert.notEqual(acceptanceProject(f.root).identity, project.identity);
});
test('the explicit Pi Web Nix template captures a complete source root accepted by its real exporter', async (t) => {
  const f = fixture(t), normalized = validateProfiles([nixAcceptanceProfile])[0];
  const snapshot = await captureSnapshot(process.cwd(), normalized.inputs, join(f.root, 'nix-source'));
  await verifySnapshot(snapshot);
  const args = ['-I', '-B', join(process.cwd(), 'nix/export-test-source.py'), snapshot.directory,
    '--output', join(f.root, 'exported'), '--manifest', join(f.root, 'exported.json')];
  execFileSync('python3', args, { stdio: 'pipe' });
  execFileSync('python3', [...args, '--verify-manifest'], { stdio: 'pipe' });
  assert.ok(snapshot.files > 100);
});
