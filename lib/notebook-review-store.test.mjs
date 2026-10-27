import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { authorizeReview, readReview, appendReview, inspectReviewMaterial, importReviewReply } = await jiti.import('./notebook-review-store.ts');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const index = path.join(root, 'index.md'), chapter = path.join(root, 'one.md');
  fs.writeFileSync(index, '```pi-notebook\n{"version":1,"id":"constructor","title":"Review","chapters":[{"id":"one","title":"One","path":"one.md"}]}\n```');
  fs.writeFileSync(chapter, '```pi-step\n{"version":1,"id":"toString","title":"Step"}\n```\nProse\n```pi-evidence\n{"version":1,"kind":"file","id":"asset","title":"Asset","path":"asset.txt"}\n```');
  fs.writeFileSync(path.join(root, 'asset.txt'), 'Original bytes');
  const roots = new Set([root]), auth = () => authorizeReview(index, roots);
  return { root, index, chapter, roots, auth };
}
const expected = tip => ({ sequence: tip.sequence, digest: tip.digest });
test('native read creates nothing; independent roots/symlinks/special files and bounded inventory fail closed', async t => {
  const f = fixture(t), before = fs.readdirSync(f.root).sort();
  assert.equal(readReview(f.auth()).sequence, 0);
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
  assert.throws(() => authorizeReview(f.index, new Set()), /denied/);
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.root, alias);
  assert.throws(() => authorizeReview(path.join(alias, 'index.md'), f.roots), /denied/);
  let tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const history = path.join(f.root, 'review-data/reviewer');
  assert.equal(fs.statSync(path.join(history, '0000000001.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(history).mode & 0o777, 0o700);
  fs.symlinkSync(path.join(history, '0000000001.json'), path.join(history, '0000000002.json'));
  assert.throws(() => readReview(f.auth()), /Unsafe/);
  fs.unlinkSync(path.join(history, '0000000002.json'));
  await appendReview(f.auth(), expected(tip), 'resume', { kind: 'resume', stepId: 'toString' });
  fs.renameSync(path.join(history, '0000000001.json'), path.join(history, 'saved-original'));
  assert.throws(() => readReview(f.auth()), /Unknown|hole/);
});
test('native append CAS, old history tamper, pre/post-link failure and exact submission reconciliation', async t => {
  const f = fixture(t); let tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  await assert.rejects(appendReview(f.auth(), { sequence: 0, digest: '' }, 'stale', { kind: 'resume', stepId: 'toString' }), /Conflict/);
  const material = await inspectReviewMaterial(f.auth(), 'toString');
  await assert.rejects(appendReview(f.auth(), expected(tip), 'pre', { kind: 'mark', stepId: 'toString', fingerprint: material.fingerprint, mark: 'Reviewed' }, { fsync() { throw new Error('injected fsync failure'); } }), /fsync failure/);
  assert.equal(readReview(f.auth()).sequence, 1);
  const op = { kind: 'mark', stepId: 'toString', fingerprint: material.fingerprint, mark: 'Reviewed' };
  await assert.rejects(appendReview(f.auth(), expected(tip), 'post', op, { afterLink() { throw new Error('lost acknowledgement'); } }), e => e.possiblyCommitted === true);
  assert.equal(readReview(f.auth()).sequence, 2);
  tip = await appendReview(f.auth(), expected(tip), 'post', op);
  assert.equal(tip.sequence, 2, 'same exact submission reconciles, never duplicates');
  const first = path.join(f.root, 'review-data/reviewer/0000000001.json'), bytes = fs.readFileSync(first);
  fs.writeFileSync(first, bytes.toString().replace('enable', 'enablE'));
  assert.throws(() => readReview(f.auth()), /chain|Malformed|Invalid/);
  fs.writeFileSync(first, bytes);
  assert.equal(readReview(f.auth()).sequence, 2);
});
test('native physical directory swap never writes outside sentinel and preserves ambiguous bytes', async t => {
  const f = fixture(t); const tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'review-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'sentinel'), 'unchanged');
  const auth = f.auth(); readReview(auth);
  await assert.rejects(appendReview(auth, expected(tip), 'swapped', { kind: 'resume', stepId: 'toString' }, { beforeLink() {
    fs.renameSync(path.join(f.root, 'review-data/reviewer'), path.join(f.root, 'review-data/parked'));
    fs.symlinkSync(outside, path.join(f.root, 'review-data/reviewer'));
  } }), /denied|identity|directory/);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'unchanged');
});
test('native short-write, directory-fsync ambiguity, FIFO/oversize/excess inventory and read-only directory are bounded', async t => {
  const f = fixture(t); let tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const op = { kind: 'resume', stepId: 'toString' };
  await assert.rejects(appendReview(f.auth(), expected(tip), 'short', op, { write(fd, bytes, offset) { if (offset) throw new Error('partial write failure'); return fs.writeSync(fd, bytes, offset, 8); } }), /partial write/);
  assert.equal(readReview(f.auth()).sequence, 1);
  let syncs = 0;
  await assert.rejects(appendReview(f.auth(), expected(tip), 'dir-fsync', op, { fsync(fd) { fs.fsyncSync(fd); if (++syncs === 2) throw new Error('directory fsync failure'); } }), e => e.possiblyCommitted === true);
  tip = readReview(f.auth()); assert.equal(tip.sequence, 2);
  const reviewer = path.join(f.root, 'review-data/reviewer'), third = path.join(reviewer, '0000000003.json');
  execFileSync('mkfifo', [third]); assert.throws(() => readReview(f.auth()), /Unsafe/); fs.unlinkSync(third);
  fs.writeFileSync(third, 'x'); fs.truncateSync(third, 2 * 1024 * 1024 + 1); assert.throws(() => readReview(f.auth()), /exceeds/); fs.unlinkSync(third);
  for (let n = 3; n < 1045; n++) fs.writeFileSync(path.join(reviewer, `${String(n).padStart(10, '0')}.json`), '');
  assert.throws(() => readReview(f.auth()), /inventory quota/);
  for (let n = 3; n < 1045; n++) fs.unlinkSync(path.join(reviewer, `${String(n).padStart(10, '0')}.json`));
  fs.chmodSync(reviewer, 0o500);
  try { await assert.rejects(appendReview(f.auth(), expected(tip), 'readonly', op), /read-only/); }
  finally { fs.chmodSync(reviewer, 0o700); }
});
test('current material changes only relevant bytes; Unavailable is not a fabricated fingerprint', async t => {
  const f = fixture(t), a = await inspectReviewMaterial(f.auth(), 'toString');
  fs.appendFileSync(f.chapter, '\n\n');
  const b = await inspectReviewMaterial(f.auth(), 'toString'); assert.equal(a.fingerprint, b.fingerprint);
  fs.writeFileSync(path.join(f.root, 'asset.txt'), 'Changed bytes');
  const c = await inspectReviewMaterial(f.auth(), 'toString'); assert.notEqual(c.fingerprint, a.fingerprint);
  fs.unlinkSync(path.join(f.root, 'asset.txt'));
  const d = await inspectReviewMaterial(f.auth(), 'toString'); assert.equal(d.fingerprint, null); assert.match(d.unavailable[0], /Unavailable/);
});
test('native pinned fingerprints exclude branch advancement, chapter reorder, sidecar writes and JSON key order', async t => {
  const f = fixture(t), repo = path.join(f.root, 'repo'); fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Review fixture', '-c', 'user.email=review@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=feature'); fs.writeFileSync(path.join(repo, 'code.txt'), 'Pinned text\n'); git('add', 'code.txt'); git('commit', '--quiet', '-m', 'Pinned baseline');
  const oid = git('rev-parse', 'HEAD'); git('branch', 'authorized');
  const target = { version: 1, id: 'source', title: 'Pinned', kind: 'source', cwd: repo, branch: 'feature', oid, path: 'code.txt', start: 1, end: 1 };
  const chapter = definition => '```pi-step\n{"version":1,"id":"toString","title":"Step"}\n```\nProse\n```pi-review\n' + JSON.stringify(definition) + '\n```';
  fs.writeFileSync(f.chapter, chapter(target)); const a = await inspectReviewMaterial(f.auth(), 'toString');
  git('commit', '--allow-empty', '--quiet', '-m', 'Advance authority only');
  assert.equal((await inspectReviewMaterial(f.auth(), 'toString')).fingerprint, a.fingerprint);
  const chapters = [{ id: 'one', title: 'One', path: 'one.md' }, { id: 'two', title: 'Two', path: 'two.md' }];
  fs.writeFileSync(path.join(f.root, 'two.md'), '```pi-step\n{"version":1,"id":"other","title":"Other"}\n```\nOther prose');
  fs.writeFileSync(f.index, '```pi-notebook\n' + JSON.stringify({ version: 1, id: 'constructor', title: 'Review', chapters: chapters.toReversed() }) + '\n```');
  await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  fs.writeFileSync(f.chapter, chapter(Object.fromEntries(Object.entries({ ...target, branch: 'authorized' }).reverse())));
  assert.equal((await inspectReviewMaterial(f.auth(), 'toString')).fingerprint, a.fingerprint);
  assert.equal(git('status', '--porcelain'), '', 'immutable inspection never mutates its repository');
});
test('validated agent bytes are privately copied and cannot resolve reviewer feedback', async t => {
  const f = fixture(t); let tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const material = await inspectReviewMaterial(f.auth(), 'toString');
  const item = { id: 'constructor', version: 1, kind: 'finding', text: 'Concern', resolved: false, anchor: { stepId: 'toString', fingerprint: material.fingerprint } };
  tip = await appendReview(f.auth(), expected(tip), 'feedback', { kind: 'feedback', item });
  const batch = { id: 'batch', items: [item], materials: [material], destination: { id: 'A', label: 'Existing A' }, replyPath: path.join(tip.directory, 'replies/batch.json') };
  tip = await appendReview(f.auth(), expected(tip), 'prepare', { kind: 'prepare', batch });
  const text = JSON.stringify({ version: 1, batchId: 'batch', items: [{ id: item.id, version: 1, fingerprint: item.anchor.fingerprint, response: 'Investigated', evidence: 'asset', proposedChanges: 'Proposal' }] }, null, 2);
  fs.writeFileSync(batch.replyPath, text);
  const importExpected = expected(tip), copies = path.join(tip.directory, 'imported-replies');
  const beforeStale = fs.readdirSync(copies);
  for (let n = 0; n < 3; n++) await assert.rejects(importReviewReply(f.auth(), { sequence: 0, digest: '' }, `stale-${n}`, 'batch', text.replace('Investigated', `Stale ${n}`)), /Conflict/);
  assert.deepEqual(fs.readdirSync(copies), beforeStale, 'stale imports install no bytes or stage entries');
  assert.equal(readReview(f.auth()).sequence, tip.sequence);
  tip = await importReviewReply(f.auth(), importExpected, 'import', 'batch');
  assert.equal((await importReviewReply(f.auth(), importExpected, 'import', 'batch', text)).sequence, tip.sequence, 'same submission + exact bytes reconciles a lost ACK');
  await assert.rejects(importReviewReply(f.auth(), importExpected, 'import', 'batch', text + '\n'), /Submission ID reused/);
  const imported = fs.readdirSync(path.join(tip.directory, 'imported-replies'));
  fs.writeFileSync(batch.replyPath, '{"now":"different raw bytes"}');
  assert.equal(fs.readFileSync(path.join(tip.directory, 'imported-replies', imported[0]), 'utf8'), text);
  assert.equal(readReview(f.auth()).state.events.at(-1).operation.reply.items[0].response, 'Investigated');
  await assert.rejects(importReviewReply(f.auth(), expected(tip), 'forged', 'batch', text.replace('"response":', '"resolved":true,"response":')), /Malformed/);
  for (let n = 0; n < 1038; n++) fs.writeFileSync(path.join(copies, `quota-${n.toString(16).padStart(64, '0')}.json`), '');
  const inventory = fs.readdirSync(copies).sort();
  await assert.rejects(importReviewReply(f.auth(), expected(tip), 'no-capacity', 'batch', text.replace('Investigated', 'Another investigation')), /capacity/);
  assert.deepEqual(fs.readdirSync(copies).sort(), inventory, 'capacity refusal creates neither target nor private stage');
  assert.equal(readReview(f.auth()).sequence, tip.sequence);
});
test('native growing historical file is refused during the original bounded read without replacing external bytes', async t => {
  const f = fixture(t); await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const file = path.join(f.root, 'review-data/reviewer/0000000001.json'), originalBytes = fs.readFileSync(file), identity = fs.statSync(file), nativeRead = fs.readSync; let grew = false;
  const spy = t.mock.method(fs, 'readSync', function(fd, ...args) { const st = fs.fstatSync(fd), n = nativeRead.call(this, fd, ...args); if (!grew && n && st.dev === identity.dev && st.ino === identity.ino) { grew = true; fs.appendFileSync(file, ' '); } return n; });
  try { assert.throws(() => readReview(f.auth()), /File changed during read/); } finally { spy.mock.restore(); }
  assert.equal(grew, true); assert.deepEqual(fs.readFileSync(file), Buffer.concat([originalBytes, Buffer.from(' ')]), 'external growing bytes are preserved');
  fs.writeFileSync(file, originalBytes); assert.equal(readReview(f.auth()).sequence, 1);
});
test('native aggregate inspection budget counts bodies and never consumes later assets after exhaustion', async t => {
  const f = fixture(t), names = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'], bytes = 12 * 1024 * 1024;
  const inodes = new Map(), consumed = new Map(names.map(n => [n, 0]));
  let source = '```pi-step\n{"version":1,"id":"toString","title":"Step"}\n```\nProse\n';
  for (const [i, name] of names.entries()) {
    const file = path.join(f.root, name); fs.writeFileSync(file, '%PDF-1.4'); fs.truncateSync(file, bytes); const st = fs.statSync(file); inodes.set(`${st.dev}:${st.ino}`, name);
    source += '```pi-evidence\n' + JSON.stringify({ version: 1, id: `asset-${i}`, title: name, kind: 'file', path: name }) + '\n```\n';
  }
  fs.writeFileSync(f.chapter, source);
  const original = fs.readSync;
  const spy = t.mock.method(fs, 'readSync', function(fd, ...args) { const st = fs.fstatSync(fd), n = original.call(this, fd, ...args), name = inodes.get(`${st.dev}:${st.ino}`); if (name) consumed.set(name, consumed.get(name) + n); return n; });
  let material; try { material = await inspectReviewMaterial(f.auth(), 'toString'); } finally { spy.mock.restore(); }
  assert.equal(consumed.get('a.pdf'), bytes); assert.equal(consumed.get('b.pdf'), bytes);
  assert.equal(consumed.get('c.pdf'), 0); assert.equal(consumed.get('d.pdf'), 0);
  assert.equal([...consumed.values()].reduce((a, b) => a + b, 0) <= 32 * 1024 * 1024, true);
  assert.equal(material.targets[2].fingerprint, null); assert.equal(material.targets[3].fingerprint, null);
});
test('Unavailable material still permits guidance-only progress/concerns and explicit outcomes, never Reviewed or carried-forward answers', async t => {
  const f = fixture(t); fs.appendFileSync(f.chapter, '\n```pi-question\n{"version":1,"id":"_q","shortLabel":"Q","question":"Inspect?","type":"text","required":true}\n```');
  fs.unlinkSync(path.join(f.root, 'asset.txt'));
  let tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const unavailable = await inspectReviewMaterial(f.auth(), 'toString'); assert.equal(unavailable.fingerprint, null);
  tip = await appendReview(f.auth(), expected(tip), 'attention', { kind: 'mark', stepId: 'toString', fingerprint: unavailable.guidanceFingerprint, basis: 'guidance', mark: 'Needs attention' });
  tip = await appendReview(f.auth(), expected(tip), 'missing-concern', { kind: 'feedback', item: { id: 'missing', version: 1, text: 'Evidence missing; please repair the guide', kind: 'guide-issue', resolved: false, anchor: { stepId: 'toString', fingerprint: unavailable.guidanceFingerprint, basis: 'guidance' } } });
  tip = await appendReview(f.auth(), expected(tip), 'unsure', { kind: 'answer', stepId: 'toString', questionId: '_q', fingerprint: unavailable.questions[0].fingerprint, outcome: { kind: 'unsure' } });
  await assert.rejects(appendReview(f.auth(), expected(tip), 'bad-reviewed', { kind: 'mark', stepId: 'toString', fingerprint: unavailable.guidanceFingerprint, basis: 'guidance', mark: 'Reviewed' }), /Guidance-only/);
  fs.writeFileSync(path.join(f.root, 'asset.txt'), 'Recovered bytes'); const available = await inspectReviewMaterial(f.auth(), 'toString');
  assert.notEqual(available.questions[0].fingerprint, unavailable.questions[0].fingerprint);
  await assert.rejects(appendReview(f.auth(), expected(tip), 'fresh-required', { kind: 'mark', stepId: 'toString', fingerprint: available.fingerprint, mark: 'Reviewed' }), /Required/);
  const outside = path.join(path.dirname(f.root), `${path.basename(f.root)}-not-authorized`); fs.mkdirSync(outside); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(f.chapter, '```pi-step\n{"version":1,"id":"toString","title":"Step"}\n```\n```pi-review\n' + JSON.stringify({ version: 1, id: 'unauthorized', title: 'Unavailable repository', kind: 'source', cwd: outside, branch: 'feature', oid: 'a'.repeat(40), path: 'code.ts', start: 1, end: 1 }) + '\n```');
  const denied = await inspectReviewMaterial(f.auth(), 'toString'); assert.equal(denied.fingerprint, null);
  tip = await appendReview(f.auth(), expected(tip), 'denied-concern', { kind: 'feedback', item: { id: 'denied', version: 1, text: 'Repository access is missing', kind: 'question', resolved: false, anchor: { stepId: 'toString', fingerprint: denied.guidanceFingerprint, basis: 'guidance' } } });
  assert.deepEqual([...f.roots], [f.root]); assert.deepEqual(fs.readdirSync(outside), []); assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
  assert.equal(readReview(f.auth()).sequence, tip.sequence);
});
test('guidance-only feedback cannot become a finding on edit or stored replay; text edits retain deleted/unavailable anchors', async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'asset.txt'));
  let tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const missing = await inspectReviewMaterial(f.auth(), 'toString');
  const item = { id: 'missing', version: 1, text: 'Unavailable evidence', kind: 'guide-issue', resolved: false, anchor: { stepId: 'toString', fingerprint: missing.guidanceFingerprint, basis: 'guidance' } };
  tip = await appendReview(f.auth(), expected(tip), 'create', { kind: 'feedback', item });
  const reviewer = path.join(tip.directory, 'reviewer'), inventory = () => fs.readdirSync(reviewer).sort().map(name => [name, fs.readFileSync(path.join(reviewer, name)).toString('hex')]);
  const original = inventory(), originalTip = expected(tip);
  await assert.rejects(appendReview(f.auth(), originalTip, 'convert', { kind: 'feedback', item: { ...item, version: 2, kind: 'finding' } }), /Guidance-only feedback cannot be a finding/);
  assert.deepEqual(expected(readReview(f.auth())), originalTip); assert.deepEqual(inventory(), original, 'rejected conversion has no revision or byte effects');
  fs.writeFileSync(f.chapter, '```pi-step\n{"version":1,"id":"replacement","title":"Replacement"}\n```\nThe old step was deleted.');
  const edited = { ...item, version: 2, text: 'Text-only edit after the step disappeared' };
  tip = await appendReview(f.auth(), expected(tip), 'edit-text', { kind: 'feedback', item: edited });
  assert.deepEqual(tip.state.events.at(-1).operation.item, edited);
  const last = path.join(reviewer, `${String(tip.sequence).padStart(10, '0')}.json`), bytes = fs.readFileSync(last), forged = JSON.parse(bytes);
  forged.state.events.at(-1).operation.item.kind = 'finding'; fs.writeFileSync(last, JSON.stringify(forged));
  try { assert.throws(() => readReview(f.auth()), /Guidance-only feedback cannot be a finding/, 'stored snapshot validation enforces the same all-version invariant'); }
  finally { fs.writeFileSync(last, bytes); }
  assert.deepEqual(expected(readReview(f.auth())), expected(tip));
});
test('two real processes both reach same-slot installation: one exclusive link wins, prior bytes never change', async t => {
  const children = [], work = [], ready = [], failures = [];
  t.after(async () => { for (const c of children) if (c.exitCode === null) c.kill(); await Promise.all(work); if (failures.length) throw new AggregateError(failures, 'Native writer failures'); });
  const f = fixture(t), tip = await appendReview(f.auth(), { sequence: 0, digest: '' }, 'enable', { kind: 'enable' });
  const first = path.join(f.root, 'review-data/reviewer/0000000001.json'), original = fs.readFileSync(first), releases = [];
  for (const submission of ['writer-A', 'writer-B']) {
    const releasePath = path.join(f.root, `${submission}.release`); releases.push(releasePath);
    const child = spawn(process.execPath, [new URL('./notebook-review-writer.fixture.mjs', import.meta.url).pathname, f.index, submission, releasePath, String(tip.sequence), tip.digest], { stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
    let markReady; ready.push(new Promise(resolve => markReady = resolve));
    work.push(new Promise(resolve => {
      let out = '', err = '', result;
      child.stdout.on('data', b => { out += b; for (;;) { const end = out.indexOf('\n'); if (end < 0) break; const line = out.slice(0, end); out = out.slice(end + 1); try { const value = JSON.parse(line); if (value.ready) markReady(true); else result = value; } catch (e) { failures.push(e); } } });
      child.stderr.on('data', b => err += b); child.once('error', e => failures.push(e));
      child.once('close', code => { if (code !== 0 || !result) failures.push(new Error(`Writer ${submission} exit ${code}: ${err}`)); markReady(false); resolve(result); });
    }));
  }
  assert.deepEqual(await Promise.all(ready), [true, true], 'both original writers validated/staged the same expected tip before either exclusive link');
  for (const release of releases) fs.writeFileSync(release, 'release');
  const results = await Promise.all(work);
  assert.equal(results.filter(r => r?.ok).length, 1);
  assert.match(results.find(r => !r.ok).error, /Conflict: another writer claimed this revision/);
  assert.equal(readReview(f.auth()).sequence, 2);
  assert.deepEqual(fs.readFileSync(first), original);
});
