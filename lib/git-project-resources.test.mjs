import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-project-resources-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
const jiti = createJiti(import.meta.url);
const { selectGitProjectResources: select, revalidateGitProjectResources: validate, withGitProjectReview } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { reviewGitBranches, getGitReviewDiff } = await jiti.import("./git-review.ts");
const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "no-config") };
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { env })).stdout.trim();
after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(home, { recursive: true, force: true });
});
async function repo() {
  const dir = await mkdtemp(join(home, "repo-"));
  await git(dir, "init", "-qb", "main");
  await git(dir, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(home, "no-hooks")}`, "commit", "--allow-empty", "-qm", "base");
  return dir;
}
async function linked(root, branch) {
  const dir = `${root}-${branch}`;
  await git(root, "worktree", "add", "-qb", branch, dir);
  allowFileRoot(dir);
  return dir;
}

test("one caller can select A/topic, B/topic, then A/other with no cwd or ref mutation", async () => {
  const a = await repo(), b = await repo();
  allowFileRoot(a); allowFileRoot(b);
  const a1 = await linked(a, "topic"), a2 = await linked(a, "other"), b1 = await linked(b, "topic");
  const cwd = process.cwd();
  const ids = await Promise.all([a, b].map((root) => git(root, "rev-parse", "HEAD")));
  for (const [root, branch, expected] of [[a, "topic", a1], [b, "topic", b1], [a1, "other", a2]]) {
    const selected = await select(root === b ? b : a, branch, expected);
    assert.equal(selected.cwd, expected);
    assert.equal(selected.projectRoot, root === b ? b : a);
    assert.equal(selected.branch, branch);
    assert.equal(selected.commonDir, join(root === b ? b : a, ".git"));
    await validate(selected);
  }
  assert.equal(process.cwd(), cwd);
  assert.deepEqual(await Promise.all([a, b].map((root) => git(root, "rev-parse", "HEAD"))), ids);
  assert.equal((await select(b)).cwd, b, "omission means the supplied checkout, never the last selected branch");
  await assert.rejects(select(a1, "other", a2), (e) => e.code === "invalid-selection", "new path selectors require canonical root");
  await assert.rejects(select(a, "topic", b1), (e) => e.code === "unavailable", "identical branch names cannot cross repository registration");
});

test("denied, ambiguous-looking, aliased, detached and missing selections fail closed", async () => {
  const a = await repo();
  await assert.rejects(select(a), (e) => e.code === "access-denied");
  allowFileRoot(a);
  for (const input of ["relative", "", ` ${a}`, `${a}\n`, null, [], {}]) await assert.rejects(select(input), (e) => e.code === "invalid-selection");
  for (const branch of ["../x", "refs/heads/main", "missing"]) await assert.rejects(select(a, branch));
  const alias = `${a}-alias`;
  await symlink(a, alias, "dir"); allowFileRoot(alias);
  await assert.rejects(select(alias), (e) => e.code === "unavailable");
  await assert.rejects(select(join(a, "missing")));
  await git(a, "checkout", "--detach", "-q");
  await assert.rejects(select(a), /registered checkout of a local branch/);
});

test("registered worktrees need their own allowed physical root", async () => {
  const a = await repo(); allowFileRoot(a);
  const outside = `${a}-outside`;
  await git(a, "worktree", "add", "-qb", "outside", outside);
  await assert.rejects(select(a, "outside"), (e) => e.code === "access-denied");
  allowFileRoot(outside);
  assert.equal((await select(a, "outside")).cwd, outside);
  await git(outside, "branch", "-m", "renamed");
  await assert.rejects(select(a, "outside"));
});

test("copied repository replacement cannot reuse a captured identity despite matching refs and paths", async () => {
  const a = await repo(); allowFileRoot(a);
  const selected = await select(a);
  const before = await git(a, "rev-parse", "HEAD");
  await rename(a, `${a}-original`);
  await cp(`${a}-original`, a, { recursive: true });
  assert.equal(await git(a, "rev-parse", "HEAD"), before);
  assert.equal((await select(a)).branch, selected.branch);
  await assert.rejects(validate(selected), (e) => e.code === "selection-changed");
});

test("forced duplicate branch registrations are ambiguous rather than first-match selection", async () => {
  const a = await repo(); allowFileRoot(a);
  await linked(a, "topic");
  await git(a, "worktree", "add", "--force", `${a}-duplicate`, "topic");
  allowFileRoot(`${a}-duplicate`);
  await assert.rejects(select(a, "topic"), (error) => error.code === "unavailable");
  await assert.rejects(select(a, "topic", `${a}-duplicate`), (error) => error.code === "selection-changed" || error.code === "unavailable");
});

async function committedFeature(root, sentinel) {
  const dir = await linked(root, "topic");
  await writeFile(join(dir, "sentinel.txt"), `${sentinel}\n`);
  await git(dir, "add", "sentinel.txt");
  await git(dir, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(home, "no-hooks")}`, "commit", "-qm", sentinel);
  return dir;
}

test("bound review never follows transient .git retargeting, and restored indirection still invalidates capture", { skip: process.platform !== "linux" }, async () => {
  const a = await repo(), b = await repo(); allowFileRoot(a); allowFileRoot(b);
  const source = await committedFeature(a, "A-only-patch");
  await committedFeature(b, "B-private-patch");
  const selected = await select(a, "topic"), foreign = await select(b, "topic");
  const marker = join(source, ".git"), original = await readFile(marker, "utf8");
  let readOriginal = false;
  await assert.rejects(withGitProjectReview(selected, async (repository) => {
    await writeFile(marker, `gitdir: ${foreign.gitDir}\n`);
    try {
      const review = await reviewGitBranches(repository, selected.branch, "main");
      const diff = await getGitReviewDiff(repository, review, { kind: "merge" });
      assert.match(diff.patch, /A-only-patch/); assert.doesNotMatch(diff.patch, /B-private-patch/);
      readOriginal = true;
    } finally { await writeFile(marker, original); }
  }), (error) => error.code === "selection-changed");
  assert.equal(readOriginal, true, "actual reads stayed in the captured repository");
});

test("bound review keeps its selected branch and directories during transient checkout/directory substitution", { skip: process.platform !== "linux" }, async () => {
  const a = await repo(), b = await repo(); allowFileRoot(a); allowFileRoot(b);
  await committedFeature(a, "A-selected-branch");
  await committedFeature(b, "B-private-patch");
  await git(a, "switch", "-q", "-c", "alternative");
  const selected = await select(a, "topic"), original = `${a}-original`;
  const diff = await withGitProjectReview(selected, async (repository) => {
    // The common directory's pathname is occupied by a different valid repo.
    // Reading through --git-dir=<path> alone would be insufficient.
    await git(selected.cwd, "symbolic-ref", "HEAD", "refs/heads/alternative");
    await rename(a, original); await cp(b, a, { recursive: true });
    try {
      const review = await reviewGitBranches(repository, selected.branch, "main");
      assert.equal(review.featureBranch, "topic");
      return await getGitReviewDiff(repository, review, { kind: "merge" });
    } finally {
      await rm(a, { recursive: true }); await rename(original, a);
      await git(selected.cwd, "symbolic-ref", "HEAD", "refs/heads/topic");
    }
  });
  assert.match(diff.patch, /A-selected-branch/); assert.doesNotMatch(diff.patch, /B-private-patch/);
});

test("failed comparison closes every pinned descriptor", { skip: process.platform !== "linux" }, async () => {
  const a = await repo(); allowFileRoot(a);
  const selected = await select(a), pinned = [];
  await assert.rejects(withGitProjectReview(selected, async (repository) => {
    pinned.push(repository.cwd, repository.gitDir, repository.commonDir);
    for (const path of pinned) assert.equal((await stat(path)).isDirectory(), true);
    throw new Error("fixture capture failure");
  }), /fixture capture failure/);
  assert.equal(pinned.length, 3);
  for (const path of pinned) await assert.rejects(stat(path), (error) => error.code === "ENOENT");
});

test("branch switches and symlinked Git indirection cannot validate the original selection", async () => {
  const a = await repo(); allowFileRoot(a);
  const original = await select(a);
  await git(a, "checkout", "-qb", "other");
  await assert.rejects(validate(original), (e) => e.code === "selection-changed");
  const moved = `${a}-metadata`;
  await rename(join(a, ".git"), moved);
  await symlink(moved, join(a, ".git"), "dir");
  await assert.rejects(select(a), /physical Git checkout/);
});
