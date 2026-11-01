import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { readGitFileContext } from './git-file-context.ts';
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check) {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error('Native context gate did not settle'); await delay(10); }
}
function fixture(t, mode) {
  const root = mkdtempSync(join(tmpdir(), 'brabbler-context-lifecycle-')), repo = join(root, 'repo'), bin = join(root, 'bin');
  const originalPath = process.env.PATH;
  const executable = originalPath.split(delimiter).map(path => join(path, 'git')).find(path => existsSync(path));
  const controller = new AbortController(), work = [];
  t.after(async () => {
    controller.abort();
    await Promise.allSettled(work);
    try {
      await until(() => readdirSync(root).filter(name => name.endsWith('.start')).every(name => !alive(Number(readFileSync(join(root, name), 'utf8')))));
      rmSync(root, { recursive: true, force: true });
    } finally { process.env.PATH = originalPath; }
  });
  mkdirSync(repo); mkdirSync(bin);
  const git = (...args) => execFileSync(executable, ['-C', repo, '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '-qb', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, 'file'), 'old\n'); git('add', '.'); git('commit', '-qm', 'old'); const before = git('rev-parse', 'HEAD');
  const oldBlob = git('rev-parse', 'HEAD:file');
  writeFileSync(join(repo, 'file'), 'new\n'); git('add', '.'); git('commit', '-qm', 'new'); const after = git('rev-parse', 'HEAD'), newBlob = git('rev-parse', 'HEAD:file');
  // A real private native child owns the held boundary. It has no grandchildren
  // while held; unmodified probes delegate synchronously to the original Git.
  writeFileSync(join(bin, 'git'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2), root = ${JSON.stringify(root)}, mode = ${JSON.stringify(mode)};
fs.appendFileSync(root + '/probes', JSON.stringify(args) + '\\n');
const index = args.indexOf('cat-file');
if (index >= 0 && args[index + 1] === 'blob') {
  const oid = args[index + 2];
  fs.writeFileSync(root + '/' + oid + '.start', String(process.pid));
  process.on('exit', () => fs.writeFileSync(root + '/' + oid + '.closed', 'closed'));
  process.on('SIGTERM', () => { fs.writeFileSync(root + '/' + oid + '.terminated', 'terminated'); setTimeout(() => process.exit(0), 20); });
  // Safety closure for a deliberately broken-owner negative, not a production deadline.
  setTimeout(() => process.exit(29), 2000);
  if (mode === 'fail-side' && oid === ${JSON.stringify(oldBlob)}) {
    const poll = setInterval(() => { if (fs.existsSync(root + '/' + ${JSON.stringify(newBlob)} + '.start')) { clearInterval(poll); process.exit(23); } }, 5);
  } else setInterval(() => {}, 100);
} else {
  try { process.stdout.write(cp.execFileSync(${JSON.stringify(executable)}, args)); }
  catch (error) { process.stderr.write(error.stderr || 'probe failed'); process.exit(error.status || 1); }
}
`, { mode: 0o755 });
  process.env.PATH = bin + delimiter + originalPath;
  return { root, repo, before, after, oldBlob, newBlob, controller,
    own(promise) { promise.catch(() => {}); work.push(promise); return promise; },
    started() { return [oldBlob, newBlob].every(oid => existsSync(join(root, oid + '.start'))); },
    assertClosed() {
      for (const oid of [oldBlob, newBlob]) {
        assert.ok(existsSync(join(root, oid + '.closed')));
        assert.equal(alive(Number(readFileSync(join(root, oid + '.start'), 'utf8'))), false);
      }
    } };
}

test('context cancellation joins both held native children and pipes before rejecting', async t => {
  const f = fixture(t, 'hold');
  const value = f.own(readGitFileContext(f.repo, f.before, f.after, 'file', 'file', f.controller.signal));
  await until(f.started); f.controller.abort(new Error('explicit context cancellation'));
  await assert.rejects(value, /explicit context cancellation/); f.assertClosed();
  assert.ok(existsSync(join(f.root, f.oldBlob + '.terminated'))); assert.ok(existsSync(join(f.root, f.newBlob + '.terminated')));
});

test('one failed context side cancels and joins its held sibling without external cancellation', async t => {
  const f = fixture(t, 'fail-side');
  const value = f.own(readGitFileContext(f.repo, f.before, f.after, 'file', 'file', f.controller.signal));
  await assert.rejects(value, /snapshot is unavailable/); f.assertClosed();
  assert.ok(existsSync(join(f.root, f.newBlob + '.terminated')));
  assert.equal(f.controller.signal.aborted, false, 'read owner, not caller, cancels the sibling');
});

test('an already cancelled context starts no Git probes', async t => {
  const f = fixture(t, 'hold'); f.controller.abort(new Error('cancelled before read'));
  await assert.rejects(f.own(readGitFileContext(f.repo, f.before, f.after, 'file', 'file', f.controller.signal)), /cancelled before read/);
  assert.equal(existsSync(join(f.root, 'probes')), false);
});
