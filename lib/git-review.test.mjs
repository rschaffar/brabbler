import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { reviewGitBranches, getGitReviewDiff, getGitTreeDiff, getGitCommitTreeOid, GIT_REVIEW_DIFF_MAX_BYTES } = await import("./git-review.ts");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-git-review-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-q", "-b", "target");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  writeFileSync(join(cwd, ".gitignore"), "secret.env\n*.log\n");
  writeFileSync(join(cwd, "note.txt"), "base\n");
  git(cwd, "add", ".gitignore", "note.txt");
  git(cwd, "commit", "-qm", "base");
  const target = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-qc", "feature");
  return { cwd, target };
}

function commit(cwd, filename, contents, message = filename) {
  writeFileSync(join(cwd, filename), contents);
  git(cwd, "add", filename);
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function errorCode(code) {
  return (error) => error?.code === code;
}

test("captures exact local identity and trees, individual, contiguous range, and whole merge diffs", async (t) => {
  const { cwd, target } = fixture(t);
  const first = commit(cwd, "note.txt", "first\n");
  const second = commit(cwd, "other.txt", "second\n");
  const third = commit(cwd, "note.txt", "third\n");
  writeFileSync(join(cwd, "secret.env"), "DO_NOT_READ\n");
  writeFileSync(join(cwd, "debug.log"), "DO_NOT_READ\n");
  writeFileSync(join(cwd, "note.txt"), "uncommitted secret\n");

  const review = await reviewGitBranches(cwd, "feature", "target");
  assert.equal(review.targetOid, target);
  assert.equal(review.featureOid, third);
  assert.equal(review.targetTreeOid, git(cwd, "rev-parse", "target^{tree}"));
  assert.equal(review.featureTreeOid, git(cwd, "rev-parse", "feature^{tree}"));
  assert.equal(review.mergeTreeOid, review.featureTreeOid);
  assert.deepEqual(review.commits.map((entry) => entry.oid), [first, second, third]);
  assert.deepEqual(review.commits.map((entry) => entry.parentOid), [target, first, second]);

  const one = await getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [second] });
  assert.equal(one.fromTreeOid, review.commits[0].treeOid);
  assert.equal(one.toTreeOid, review.commits[1].treeOid);
  assert.match(one.patch, /\+second/);
  assert.doesNotMatch(one.patch, /\+first|\+third/);

  const range = await getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [second, third] });
  assert.equal(range.fromTreeOid, review.commits[0].treeOid);
  assert.equal(range.toTreeOid, review.commits[2].treeOid);
  assert.match(range.patch, /\+third/);
  assert.match(range.patch, /\+second/);
  assert.doesNotMatch(range.patch, /uncommitted secret|DO_NOT_READ/);

  const whole = await getGitReviewDiff(cwd, review, { kind: "merge" });
  assert.equal(whole.fromTreeOid, review.targetTreeOid);
  assert.equal(whole.toTreeOid, review.mergeTreeOid);
  assert.match(whole.patch, /\+third/);
  assert.match(whole.patch, /\+second/);
  assert.doesNotMatch(whole.patch, /uncommitted secret|DO_NOT_READ/);
  assert.deepEqual(await getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [first, second, third] }), {
    ...whole, toTreeOid: review.featureTreeOid,
  });
  for (const selection of [[first, third], [third, second], [first, first], [], ["f".repeat(40)]]) {
    await assert.rejects(getGitReviewDiff(cwd, review, { kind: "commits", commitOids: selection }), errorCode("INVALID_SELECTION"));
  }
});

test("shared tree diff is bounded, uses exact objects rather than working files, and rejects invalid OIDs", async (t) => {
  const { cwd, target } = fixture(t);
  const headTree = await getGitCommitTreeOid(cwd, target);
  const next = commit(cwd, "note.txt", "committed only\n");
  writeFileSync(join(cwd, "note.txt"), "private uncommitted\n");
  const diff = await getGitTreeDiff(cwd, headTree, await getGitCommitTreeOid(cwd, next));
  assert.equal(diff.fromTreeOid, headTree);
  assert.match(diff.patch, /\+committed only/);
  assert.doesNotMatch(diff.patch, /private uncommitted/);
  await assert.rejects(getGitTreeDiff(cwd, "HEAD", diff.toTreeOid), errorCode("GIT_FAILURE"));
  await assert.rejects(getGitTreeDiff(cwd, headTree, "f".repeat(40)), errorCode("GIT_FAILURE"));
  const large = commit(cwd, "large.txt", "a".repeat(GIT_REVIEW_DIFF_MAX_BYTES + 100) + "\n");
  await assert.rejects(getGitTreeDiff(cwd, headTree, await getGitCommitTreeOid(cwd, large)), errorCode("DIFF_TOO_LARGE"));
});

test("rejects stale feature and target even when diff objects remain available", async (t) => {
  const { cwd, target } = fixture(t);
  const first = commit(cwd, "note.txt", "first\n");
  let review = await reviewGitBranches(cwd, "feature", "target");
  commit(cwd, "note.txt", "second\n");
  for (const selection of [{ kind: "merge" }, { kind: "commits", commitOids: [first] }]) {
    await assert.rejects(getGitReviewDiff(cwd, review, selection), errorCode("STALE_REFS"));
  }
  git(cwd, "update-ref", "refs/heads/feature", first);
  review = await reviewGitBranches(cwd, "feature", "target");
  git(cwd, "update-ref", "refs/heads/target", first, target);
  await assert.rejects(getGitReviewDiff(cwd, review, { kind: "merge" }), errorCode("STALE_REFS"));
  await assert.rejects(getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [first] }), errorCode("STALE_REFS"));
});

test("a merge commit is diffed against its first parent, including changes brought from its other parent", async (t) => {
  const { cwd } = fixture(t);
  git(cwd, "switch", "-qc", "side");
  commit(cwd, "side.txt", "from side\n");
  git(cwd, "switch", "-q", "feature");
  const first = commit(cwd, "note.txt", "from feature\n");
  git(cwd, "merge", "-q", "--no-ff", "side", "-m", "merge side");
  const merged = git(cwd, "rev-parse", "HEAD");
  const review = await reviewGitBranches(cwd, "feature", "target");
  assert.deepEqual(review.commits.map((item) => item.oid), [first, merged]);
  assert.equal(review.commits[1].parentOid, first);
  const diff = await getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [merged] });
  assert.match(diff.patch, /\+from side/);
  assert.doesNotMatch(diff.patch, /\+from feature/);
});

test("refuses diverged/conflicting branches and a target merged only on a second-parent path", async (t) => {
  const { cwd } = fixture(t);
  commit(cwd, "note.txt", "feature edits\n");
  git(cwd, "switch", "-q", "target");
  commit(cwd, "note.txt", "target conflicts\n");
  await assert.rejects(reviewGitBranches(cwd, "feature", "target"), errorCode("NOT_ANCESTOR"));

  // Even when target is an ancestor via a merge's second parent, it cannot
  // serve as the base for a contiguous first-parent commit review.
  git(cwd, "switch", "-q", "feature");
  git(cwd, "merge", "-q", "-s", "ours", "--no-ff", "target", "-m", "merge target");
  await assert.rejects(reviewGitBranches(cwd, "feature", "target"), errorCode("NOT_ANCESTOR"));
});

test("binary patches are summaries, text patches are readable, oversized patches fail explicitly", async (t) => {
  const { cwd } = fixture(t);
  const text = commit(cwd, "note.txt", "human readable\n");
  const binary = commit(cwd, "image.bin", Buffer.from([0, 1, 2, 3, 255]));
  let review = await reviewGitBranches(cwd, "feature", "target");
  const textDiff = await getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [text] });
  assert.equal(textDiff.hasBinaryChanges, false);
  assert.match(textDiff.patch, /\+human readable/);
  const binaryDiff = await getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [binary] });
  assert.equal(binaryDiff.hasBinaryChanges, true);
  assert.match(binaryDiff.patch, /Binary files .* differ/);
  assert.doesNotMatch(binaryDiff.patch, /GIT binary patch/);

  const large = commit(cwd, "large.txt", "x".repeat(GIT_REVIEW_DIFF_MAX_BYTES + 100) + "\n");
  review = await reviewGitBranches(cwd, "feature", "target");
  await assert.rejects(getGitReviewDiff(cwd, review, { kind: "commits", commitOids: [large] }), errorCode("DIFF_TOO_LARGE"));
  await assert.rejects(getGitReviewDiff(cwd, review, { kind: "merge" }), errorCode("DIFF_TOO_LARGE"));
});

test("equal tips on different branches produce an empty, valid review", async (t) => {
  const { cwd, target } = fixture(t);
  const review = await reviewGitBranches(cwd, "feature", "target");
  assert.equal(review.featureOid, target);
  assert.deepEqual(review.commits, []);
  assert.equal((await getGitReviewDiff(cwd, review, { kind: "merge" })).patch, "");
});

test("only exact existing local branch refs are accepted", async (t) => {
  const { cwd } = fixture(t);
  for (const branch of ["missing", "--bad", "../target", "HEAD", "target^{tree}"]) {
    await assert.rejects(reviewGitBranches(cwd, branch, "target"), errorCode("INVALID_REF"));
  }
});
