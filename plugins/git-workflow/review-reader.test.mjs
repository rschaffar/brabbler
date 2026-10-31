import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { captureGitReview, assertGitReviewAvailable, gitReviewPage, gitReviewPatch, gitReviewPreview, gitReviewContext,
  gitReviewRelation, GIT_REVIEW_PREVIEW_BYTES } = await jiti.import('./review-reader.ts');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
function fixture(t, objectFormat) {
  const root = mkdtempSync(join(tmpdir(), 'brabbler-git-review-reader-'));
  const readers = [];
  const closeReaders = async () => {
    for (const { controller } of readers) controller?.abort();
    const results = await Promise.allSettled(readers.map(({ reader }) => reader.return()));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Read closure failed; retain fixture');
    readers.length = 0;
  };
  t.after(async () => { await closeReaders(); rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, 'repo'); mkdirSync(repo);
  git(repo, 'init', '-qb', 'main', ...(objectFormat ? [`--object-format=${objectFormat}`] : []));
  git(repo, 'config', 'user.name', 'Review Test'); git(repo, 'config', 'user.email', 'review@example.invalid');
  writeFileSync(join(repo, 'file.txt'), 'old\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const before = git(repo, 'rev-parse', 'HEAD');
  const access = { async assertAllowed(path) { assert.ok(path === repo || path.startsWith(root + '/')); } };
  return { root, repo, before, access, closeReaders, own(reader, controller) { readers.push({ reader, controller }); return reader; } };
}
function candidate(repo, name = 'file.txt', contents = 'candidate\n') {
  writeFileSync(join(repo, name), contents); git(repo, 'add', '--', name);
  return git(repo, 'write-tree');
}
const collect = async source => { const chunks = []; for await (const chunk of source) chunks.push(chunk); return Buffer.concat(chunks); };
const captured = async f => captureGitReview(f.repo, { before: f.before, after: candidate(f.repo) });
const unavailable = error => error.code === 'UNAVAILABLE';
const denied = error => error.code === 'ACCESS_DENIED';
function paths(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? [entry.name + '/', ...paths(join(root, entry.name)).map(path => entry.name + '/' + path)] : [entry.name]).sort();
}

test('immutable candidate review survives index, worktree and branch drift without writing content or refs', async t => {
  const f = fixture(t), review = await captured(f);
  writeFileSync(join(f.repo, 'file.txt'), 'later staged\n'); git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'later');
  writeFileSync(join(f.repo, 'file.txt'), 'current worktree\n');
  const beforePaths = paths(f.root), index = readFileSync(join(f.repo, '.git/index'));
  const refs = git(f.repo, 'show-ref'), logs = readFileSync(join(f.repo, '.git/logs/HEAD'));
  const page = await gitReviewPage(review, f.access);
  assert.equal(page.total, 1); assert.equal(page.files[0].path, 'file.txt');
  const preview = await gitReviewPreview(review, f.access, 0);
  assert.equal(preview.complete, true); assert.match(preview.text, /\+candidate\n/);
  assert.doesNotMatch(preview.text, /later staged|current worktree/);
  const context = await gitReviewContext(review, f.access, 0);
  assert.equal(context.oldFile.contents, 'old\n'); assert.equal(context.newFile.contents, 'candidate\n');
  assert.deepEqual(readFileSync(join(f.repo, '.git/index')), index);
  assert.deepEqual(readFileSync(join(f.repo, '.git/logs/HEAD')), logs);
  assert.equal(git(f.repo, 'show-ref'), refs); assert.deepEqual(paths(f.root), beforePaths);
  assert.equal(readFileSync(join(f.repo, 'file.txt'), 'utf8'), 'current worktree\n');
});

test('generated inventories page at 40 and select literal unusual filenames, including trailing directory whitespace', async t => {
  const f = fixture(t), moved = join(f.root, 'repo with space \n'); renameSync(f.repo, moved); f.repo = moved;
  for (let i = 0; i < 45; i++) writeFileSync(join(f.repo, `file-${String(i).padStart(2, '0')}`), 'new\n');
  const names = ['-dash', ':(glob)*', 'line\nname', 'quote"name', 'tab\tname'];
  for (const name of names) writeFileSync(join(f.repo, name), `literal ${name}\n`);
  git(f.repo, 'add', '.');
  const review = await captureGitReview(f.repo, { before: f.before, after: git(f.repo, 'write-tree') });
  const first = await gitReviewPage(review, f.access), second = await gitReviewPage(review, f.access, 40);
  assert.equal(first.files.length, 40); assert.equal(first.next, 40); assert.equal(first.total, 50);
  assert.equal(second.files.length, 10); assert.equal(second.next, null);
  const files = [...first.files, ...second.files];
  assert.equal(new Set(files.map(file => file.id)).size, 50);
  for (const name of names) {
    const file = files.find(item => item.path === name); assert.ok(file);
    const patch = await collect(gitReviewPatch(review, f.access, file.id));
    assert.match(patch.toString(), /literal/);
    assert.equal((patch.toString().match(/^diff --git /gm) ?? []).length, 1, 'literal pathspec must not match other files');
  }
  await assert.rejects(gitReviewPage(review, f.access, 51), error => error.code === 'INVALID');
  await assert.rejects(collect(gitReviewPatch(review, f.access, '../file.txt')), error => error.code === 'INVALID');
});

test('large giant-line and binary patches stream completely while raw previews remain byte-bounded', async t => {
  const f = fixture(t), large = 'x'.repeat(3 * 1024 * 1024) + '\n';
  candidate(f.repo, 'large.txt', large);
  writeFileSync(join(f.repo, 'binary'), Buffer.from([0, 1, 2, 0, 255, 12])); git(f.repo, 'add', 'binary');
  const review = await captureGitReview(f.repo, { before: f.before, after: git(f.repo, 'write-tree') });
  const page = await gitReviewPage(review, f.access), id = page.files.find(file => file.path === 'large.txt').id;
  const full = await collect(gitReviewPatch(review, f.access));
  assert.ok(full.length > large.length); assert.match(full.toString(), /GIT binary patch/);
  const direct = execFileSync('git', ['-C', f.repo, 'diff', '--binary', '--full-index', '--no-renames', f.before, review.comparison.after, '--'], { maxBuffer: 16 * 1024 * 1024 });
  assert.deepEqual(full, direct);
  const selected = await collect(gitReviewPatch(review, f.access, id));
  const first = await gitReviewPreview(review, f.access, id), next = await gitReviewPreview(review, f.access, id, first.next);
  assert.equal(first.complete, false); assert.equal(first.bytes, selected.length);
  assert.equal(Buffer.byteLength(first.text), GIT_REVIEW_PREVIEW_BYTES);
  assert.equal(first.next, GIT_REVIEW_PREVIEW_BYTES);
  assert.equal(next.text, selected.subarray(first.next, first.next + GIT_REVIEW_PREVIEW_BYTES).toString());
  await assert.rejects(gitReviewPreview(review, f.access, id, selected.length + 1), error => error.code === 'INVALID');
  await assert.rejects(gitReviewContext(review, f.access, id), /1 MiB/);
  assert.equal(paths(f.root).some(path => path.includes('brabbler/reviews')), false);
});

test('removed feature worktree falls back only to the independently allowed primary repository', async t => {
  const f = fixture(t), feature = join(f.root, 'feature');
  git(f.repo, 'worktree', 'add', '-b', 'feature', feature);
  candidate(feature); git(feature, 'commit', '-qm', 'feature');
  const review = await captureGitReview(feature, { before: f.before, after: git(feature, 'rev-parse', 'HEAD') });
  git(f.repo, 'worktree', 'remove', feature);
  assert.equal((await gitReviewPage(review, f.access)).total, 1);
  const noPrimary = { async assertAllowed(path) { if (path === f.repo) throw new Error('denied'); } };
  await assert.rejects(gitReviewPage(review, noPrimary), denied);
});

test('replacement repository, substituted trees and missing original candidate objects are unavailable, never current files', async t => {
  const f = fixture(t), review = await captured(f);
  const wrong = structuredClone(review); wrong.trees.after = wrong.trees.before;
  await assert.rejects(gitReviewPage(wrong, f.access), unavailable);
  const object = review.comparison.after;
  rmSync(join(f.repo, '.git/objects', object.slice(0, 2), object.slice(2)));
  await assert.rejects(assertGitReviewAvailable(review, f.access), unavailable);
  assert.equal(await gitReviewRelation(review, review, f.access), 'unknown');
  // Recreating the same tree is deliberately NOT done by the reader.
  assert.equal(existsSync(join(f.repo, '.git/objects', object.slice(0, 2), object.slice(2))), false);
  const saved = join(f.root, 'saved'); renameSync(f.repo, saved); mkdirSync(f.repo);
  git(f.repo, 'clone', '-q', '--no-hardlinks', saved, f.repo);
  await assert.rejects(gitReviewPage(review, f.access), unavailable);
});

test('access is independently enforced and symlink aliases cannot select a captured repository', async t => {
  const f = fixture(t), review = await captured(f);
  await assert.rejects(gitReviewPage(review, { async assertAllowed() { throw new Error('private deny'); } }), denied);
  const alias = join(f.root, 'alias'); symlinkSync(f.repo, alias);
  const forged = structuredClone(review); forged.repository.checkout = forged.repository.primaryCheckout = alias;
  await assert.rejects(gitReviewPage(forged, f.access), unavailable);
  const invalid = structuredClone(review); invalid.comparison.before = 'HEAD';
  await assert.rejects(gitReviewPage(invalid, f.access), error => error.code === 'INVALID');
});

test('ambient ext-diff, textconv and fsmonitor do not execute; gitlinks remain descriptive/non-recursive', async t => {
  const f = fixture(t), marker = join(f.root, 'executed'), script = join(f.root, 'driver');
  writeFileSync(script, `#!/bin/sh\nprintf unsafe > '${marker}'\ncat\n`, { mode: 0o755 });
  writeFileSync(join(f.repo, '.gitattributes'), 'file.txt diff=unsafe\n');
  const after = candidate(f.repo); git(f.repo, 'add', '.gitattributes');
  git(f.repo, 'update-index', '--add', '--cacheinfo', `160000,${f.before},submodule`);
  const review = await captureGitReview(f.repo, { before: f.before, after: git(f.repo, 'write-tree') });
  for (const key of ['diff.external', 'diff.unsafe.command', 'diff.unsafe.textconv', 'core.fsmonitor']) git(f.repo, 'config', key, script);
  git(f.repo, 'config', 'diff.submodule', 'diff'); git(f.repo, 'config', 'diff.relative', 'true'); git(f.repo, 'config', 'diff.noprefix', 'true');
  const patch = await collect(gitReviewPatch(review, f.access));
  assert.match(patch.toString(), /diff --git a\/file.txt b\/file.txt/);
  assert.match(patch.toString(), /Subproject commit/); assert.equal(existsSync(marker), false);
  assert.ok(after);
});

test('rename chains/path reuse have explicit delete/add semantics and modes/symlinks remain inspectable', async t => {
  const f = fixture(t); renameSync(join(f.repo, 'file.txt'), join(f.repo, 'renamed.txt'));
  writeFileSync(join(f.repo, 'file.txt'), 'different replacement\n'); chmodSync(join(f.repo, 'file.txt'), 0o755);
  symlinkSync('renamed.txt', join(f.repo, 'link')); git(f.repo, 'add', '.');
  const review = await captureGitReview(f.repo, { before: f.before, after: git(f.repo, 'write-tree') });
  const page = await gitReviewPage(review, f.access);
  const oldPath = page.files.find(file => file.path === 'file.txt'), renamed = page.files.find(file => file.path === 'renamed.txt');
  assert.equal(oldPath.newMode, '100755'); assert.equal(renamed.status, 'A');
  const oldPatch = (await collect(gitReviewPatch(review, f.access, oldPath.id))).toString();
  assert.match(oldPatch, /different replacement/); assert.doesNotMatch(oldPatch, /renamed.txt/);
  const link = page.files.find(file => file.path === 'link'); assert.equal(link.newMode, '120000');
  assert.match((await collect(gitReviewPatch(review, f.access, link.id))).toString(), /new file mode 120000/);
  await assert.rejects(gitReviewContext(review, f.access, link.id), /regular text/);
});

test('relation compares changed versions, ignores disjoint target files and distinguishes an empty merge result', async t => {
  const f = fixture(t), proposalAfter = candidate(f.repo);
  git(f.repo, 'commit', '-qm', 'feature'); const feature = git(f.repo, 'rev-parse', 'HEAD');
  const proposal = await captureGitReview(f.repo, { before: f.before, after: proposalAfter });
  const committed = await captureGitReview(f.repo, { before: f.before, after: feature });
  assert.equal(await gitReviewRelation(proposal, committed, f.access), 'same');
  git(f.repo, 'checkout', '-qb', 'target', f.before); writeFileSync(join(f.repo, 'unrelated'), 'target\n');
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'target'); const target = git(f.repo, 'rev-parse', 'HEAD');
  git(f.repo, 'merge', '--no-ff', '-qm', 'merge', feature);
  const result = await captureGitReview(f.repo, { before: target, after: git(f.repo, 'rev-parse', 'HEAD') });
  assert.equal(await gitReviewRelation(proposal, result, f.access), 'same');
  const noop = await captureGitReview(f.repo, { before: feature, after: feature });
  assert.equal((await gitReviewPage(noop, f.access)).total, 0);
  assert.equal((await collect(gitReviewPatch(noop, f.access))).length, 0);
  assert.equal(await gitReviewRelation(proposal, noop, f.access), 'different');
  const modeAfter = candidate(f.repo, 'file.txt', 'another version\n');
  const different = await captureGitReview(f.repo, { before: target, after: modeAfter });
  assert.equal(await gitReviewRelation(proposal, different, f.access), 'different');
});

test('missing promisor blobs fail locally without running a fetch helper', async t => {
  const f = fixture(t), review = await captured(f), marker = join(f.root, 'fetch-ran');
  const blob = git(f.repo, 'rev-parse', `${review.comparison.after}:file.txt`);
  rmSync(join(f.repo, '.git/objects', blob.slice(0, 2), blob.slice(2)));
  const helper = join(f.root, 'fetch'); writeFileSync(helper, `#!/bin/sh\nprintf fetched > '${marker}'\nexit 1\n`, { mode: 0o755 });
  git(f.repo, 'config', 'remote.unsafe.url', `ext::${helper}`); git(f.repo, 'config', 'remote.unsafe.promisor', 'true');
  git(f.repo, 'config', 'extensions.partialClone', 'unsafe');
  await assert.rejects(collect(gitReviewPatch(review, f.access)));
  await assert.rejects(assertGitReviewAvailable(review, f.access), unavailable);
  assert.equal(await gitReviewRelation(review, review, f.access), 'unknown');
  assert.equal(existsSync(marker), false);
});

test('cancellation and failure after partial bytes do not complete a successful download', async t => {
  const f = fixture(t), review = await captureGitReview(f.repo, { before: f.before, after: candidate(f.repo, 'large', 'x'.repeat(3 * 1024 * 1024)) });
  const controller = new AbortController(), stream = f.own(gitReviewPatch(review, f.access, undefined, controller.signal), controller);
  assert.equal((await stream.next()).done, false); controller.abort();
  await assert.rejects(collect(stream), /Cancelled|abort/i);
  const partial = f.own(gitReviewPatch(review, f.access));
  assert.equal((await partial.next()).done, false);
  renameSync(f.repo, join(f.root, 'moved'));
  await assert.rejects(collect(partial));
  // Both generators have settled before registered fixture removal runs.
});

test('SHA-256 repository endpoints are full IDs too', async t => {
  const f = fixture(t, 'sha256'), review = await captured(f);
  assert.equal(review.comparison.before.length, 64); assert.equal(review.trees.after.length, 64);
  assert.equal((await gitReviewPage(review, f.access)).total, 1);
  assert.match((await collect(gitReviewPatch(review, f.access))).toString(), /candidate/);
  assert.equal((await gitReviewContext(review, f.access, 0)).newFile.contents, 'candidate\n');
  assert.equal(await gitReviewRelation(review, review, f.access), 'same');
  const bytes = await collect(gitReviewPatch(review, f.access));
  assert.equal(createHash('sha256').update(bytes).digest('hex').length, 64);
});

test('each selected file/directory transition patch excludes changed descendants in both directions', async t => {
  const f = fixture(t);
  rmSync(join(f.repo, 'file.txt')); mkdirSync(join(f.repo, 'file.txt'));
  writeFileSync(join(f.repo, 'file.txt/a'), 'child a\n'); writeFileSync(join(f.repo, 'file.txt/b'), 'child b\n'); git(f.repo, 'add', '.');
  const after = git(f.repo, 'write-tree');
  for (const comparison of [{ before: f.before, after }, { before: after, after: f.before }]) {
    const review = await captureGitReview(f.repo, comparison), page = await gitReviewPage(review, f.access);
    assert.equal(page.total, 3);
    for (const file of page.files) {
      const patch = (await collect(gitReviewPatch(review, f.access, file.id))).toString();
      assert.equal((patch.match(/^diff --git /gm) ?? []).length, 1, file.path);
      if (file.path === 'file.txt') assert.doesNotMatch(patch, /child a|child b/);
    }
  }
});

test('ambient order files cannot change ordinal file identities or same-change relation across worktrees', async t => {
  const f = fixture(t), aOrder = join(f.root, 'order-a'), bOrder = join(f.root, 'order-b'), other = join(f.root, 'other');
  writeFileSync(aOrder, 'a\nb\n'); writeFileSync(bOrder, 'b\na\n');
  candidate(f.repo, 'a', 'a\n'); const after = candidate(f.repo, 'b', 'b\n');
  git(f.repo, 'worktree', 'add', '-b', 'other', other);
  git(f.repo, 'config', 'extensions.worktreeConfig', 'true');
  git(f.repo, 'config', '--worktree', 'diff.orderFile', aOrder); git(other, 'config', '--worktree', 'diff.orderFile', bOrder);
  const proposal = await captureGitReview(f.repo, { before: f.before, after });
  const result = await captureGitReview(other, { before: f.before, after });
  assert.deepEqual((await gitReviewPage(proposal, f.access)).files.map(file => file.path), ['a', 'b']);
  assert.equal(await gitReviewRelation(proposal, result, f.access), 'same', 'opposite worktree order files cannot alter relation');
  writeFileSync(aOrder, 'b\na\n');
  assert.match((await collect(gitReviewPatch(proposal, f.access, 0))).toString(), /diff --git a\/a b\/a/);
});

test('missing gitlink target is not a missing superproject blob or a recursive read requirement', async t => {
  const f = fixture(t);
  git(f.repo, 'update-index', '--add', '--cacheinfo', `160000,${'e'.repeat(40)},unavailable-submodule`);
  const review = await captureGitReview(f.repo, { before: f.before, after: git(f.repo, 'write-tree') });
  await assertGitReviewAvailable(review, f.access);
  assert.equal(await gitReviewRelation(review, review, f.access), 'same');
  assert.match((await collect(gitReviewPatch(review, f.access))).toString(), /Subproject commit e+/);
});

test('fixture-error teardown closes a manually suspended native reader before removing its root', async t => {
  const f = fixture(t), review = await captureGitReview(f.repo, { before: f.before, after: candidate(f.repo, 'large', 'x'.repeat(3 * 1024 * 1024)) });
  const stream = f.own(gitReviewPatch(review, f.access));
  await assert.rejects(async () => {
    try { assert.equal((await stream.next()).done, false); throw new Error('named fixture failure'); }
    finally { await f.closeReaders(); }
  }, /named fixture failure/);
  assert.equal((await stream.next()).done, true);
});
