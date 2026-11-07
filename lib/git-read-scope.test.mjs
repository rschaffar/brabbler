import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { withGitReadScope, scopedGitRead } from './git-read-scope.ts';
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check) { const end = Date.now() + 4000; while (!check()) { if (Date.now() > end) throw new Error('Owned Git read gate did not settle'); await delay(10); } }
function fixture(t, mode = 'hold') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-read-owner-')), bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const previousPath = process.env.PATH, controller = new AbortController(), work = [];
  let closed = false;
  t.after(async () => {
    closed = true; controller.abort(); await Promise.allSettled(work);
    try { await until(() => !fs.existsSync(path.join(root, 'pid')) || !alive(Number(fs.readFileSync(path.join(root, 'pid'), 'utf8')))); fs.rmSync(root, { recursive: true, force: true }); }
    finally { process.env.PATH = previousPath; }
  });
  fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\n` + `
const fs = require('node:fs'), root = ${JSON.stringify(root)}, mode = ${JSON.stringify(mode)};
fs.writeFileSync(root + '/pid', String(process.pid));
fs.appendFileSync(root + '/arguments', JSON.stringify(process.argv.slice(2)) + '\\n');
fs.writeFileSync(root + '/environment', JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')))));
if (mode === 'success') { process.stdout.write('ok'); }
else {
  process.on('SIGTERM', () => fs.writeFileSync(root + '/terminated', 'yes'));
  fs.writeFileSync(root + '/ready', 'handler installed');
  // A finite escape hatch exposes a broken production owner without keeping a
  // native fixture alive forever. The tested owner must settle first.
  setTimeout(() => process.exit(29), 8000);
  setInterval(() => {}, 100);
  if (mode === 'stdout') process.stdout.write(Buffer.alloc(4096, 65));
  if (mode === 'stderr') process.stderr.write(Buffer.alloc(4096, 66));
}
`, { mode: 0o755 });
  process.env.PATH = bin + path.delimiter + previousPath;
  return { root, controller,
    own(promise) { assert.equal(closed, false); work.push(promise); void promise.catch(() => {}); return promise; },
    started: () => fs.existsSync(path.join(root, 'pid')),
    ready: () => fs.existsSync(path.join(root, 'ready')),
    assertClosed() { assert.equal(alive(Number(fs.readFileSync(path.join(root, 'pid'), 'utf8'))), false); },
  };
}
test('bounded short-lived native Git reads settle even when children close stdin immediately', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-short-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await withGitReadScope(undefined, () => {}, async () => {
    for (let batch = 0; batch < 32; batch++) {
      const results = await Promise.allSettled(Array.from({ length: 16 }, () => scopedGitRead(root, ['--version'])));
      for (const result of results) { if (result.status === 'rejected') throw result.reason; assert.match(result.value.toString(), /^git version /); }
    }
  });
});
test('pre-abort and live read refusal start no native process', async t => {
  const f = fixture(t); f.controller.abort(new Error('Already cancelled'));
  await assert.rejects(f.own(withGitReadScope(f.controller.signal, () => {}, () => scopedGitRead(f.root, ['rev-parse', 'HEAD']))), /Already cancelled/);
  await assert.rejects(f.own(withGitReadScope(undefined, () => { throw new Error('Read revoked'); }, () => scopedGitRead(f.root, ['rev-parse', 'HEAD']))), /Read revoked/);
  assert.equal(f.started(), false);
});
test('abort escalates an ignoring native child and joins close before rejection', async t => {
  const f = fixture(t), work = f.own(withGitReadScope(f.controller.signal, () => {}, () => scopedGitRead(f.root, ['rev-parse', 'HEAD'])));
  await Promise.race([until(f.ready), work.then(() => { throw new Error('Read completed before gate'); })]); f.controller.abort(new Error('Explicit abort'));
  await assert.rejects(work, /Explicit abort/); f.assertClosed(); assert.equal(fs.existsSync(path.join(f.root, 'terminated')), true);
});
for (const mode of ['stdout', 'stderr']) test(`${mode} overflow terminates and joins an ignoring child`, async t => {
  const f = fixture(t, mode); await assert.rejects(f.own(withGitReadScope(f.controller.signal, () => {}, () => scopedGitRead(f.root, ['cat-file', 'blob', 'a'.repeat(40)], 128))), /output budget/); f.assertClosed();
});
test('aggregate deadline joins a held native process rather than racing its promise', async t => {
  const f = fixture(t); await assert.rejects(f.own(withGitReadScope(f.controller.signal, () => {}, () => scopedGitRead(f.root, ['rev-parse', 'HEAD']), { milliseconds: 2000 })), /deadline/); f.assertClosed();
});
test('aggregate byte and process budgets refuse further work independently of per-read bounds', async t => {
  const f = fixture(t, 'success');
  await assert.rejects(f.own(withGitReadScope(f.controller.signal, () => {}, async () => { await scopedGitRead(f.root, ['rev-parse', 'HEAD']); await scopedGitRead(f.root, ['rev-parse', 'HEAD']); }, { processes: 1 })), /aggregate work/);
  await assert.rejects(f.own(withGitReadScope(f.controller.signal, () => {}, () => scopedGitRead(f.root, ['rev-parse', 'HEAD']), { bytes: 1 })), /output budget/); f.assertClosed();
});
test('fixed helper suppression, sanitized inherited Git state and live post-read grants are explicit', async t => {
  const f = fixture(t, 'success'), old = process.env.GIT_INDEX_FILE; process.env.GIT_INDEX_FILE = path.join(f.root, 'must-not-use-index');
  t.after(() => { if (old === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = old; });
  await f.own(withGitReadScope(f.controller.signal, () => {}, () => scopedGitRead(f.root, ['show', '-s', 'a'.repeat(40)])));
  const args = fs.readFileSync(path.join(f.root, 'arguments'), 'utf8'), env = JSON.parse(fs.readFileSync(path.join(f.root, 'environment'), 'utf8'));
  for (const option of ['core.fsmonitor=false', '--no-ext-diff', '--no-textconv', '--no-show-signature']) assert.ok(args.includes(option));
  assert.equal(env.GIT_INDEX_FILE, undefined); assert.equal(env.GIT_ALLOW_PROTOCOL, ''); assert.equal(env.GIT_NO_LAZY_FETCH, '1'); assert.equal(env.GIT_OPTIONAL_LOCKS, '0'); assert.equal(env.GIT_NO_REPLACE_OBJECTS, '1');
  let checks = 0;
  await assert.rejects(f.own(withGitReadScope(f.controller.signal, () => { if (++checks === 3) throw new Error('Post-read revoked'); }, () => scopedGitRead(f.root, ['rev-parse', 'HEAD']))), /Post-read revoked/); f.assertClosed();
});
