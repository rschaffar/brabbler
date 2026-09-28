import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./worktree.ts");
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

test("main and linked worktrees share one canonical project root", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  const linked = path.join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-b", "feature/test", linked]);

  const { findCurrentWorktreePath, listWorktrees, resolveProject } = await loadSubject();
  const mainProject = await resolveProject(`${repo}${path.sep}`);
  const linkedProject = await resolveProject(linked);

  assert.equal(mainProject.isTopLevel, true);
  assert.equal(mainProject.isWorktree, false);
  assert.equal(linkedProject.isTopLevel, true);
  assert.equal(linkedProject.isWorktree, true);
  assert.equal(linkedProject.branch, "feature/test");
  assert.equal(mainProject.projectRoot, linkedProject.projectRoot);

  const worktrees = await listWorktrees(linked);
  const listedLinked = worktrees.find((worktree) => worktree.branch === "feature/test");
  assert.ok(listedLinked);
  assert.equal(findCurrentWorktreePath(worktrees, `${linked}${path.sep}`), listedLinked.path);
});

test("merged status follows local rst-main ancestry, not remote refs or branch names", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-merged-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const linked = path.join(root, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repo, "README.md"), "start\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["branch", "-m", "rst-main"]);
  await git(repo, ["worktree", "add", "-b", "feature/linked", linked]);
  const { listMergedWorktreeBranches } = await loadSubject();
  assert.ok((await listMergedWorktreeBranches(linked)).has("feature/linked"));

  await writeFile(path.join(linked, "feature.txt"), "change\n");
  await git(linked, ["add", "."]);
  await git(linked, ["commit", "-m", "feature"]);
  await git(repo, ["update-ref", "refs/remotes/origin/rst-main", await git(linked, ["rev-parse", "HEAD"])]);
  assert.equal((await listMergedWorktreeBranches(repo)).has("feature/linked"), false);

  await git(repo, ["merge", "--no-ff", "--no-edit", "feature/linked"]);
  assert.ok((await listMergedWorktreeBranches(linked)).has("feature/linked"));
  await git(repo, ["branch", "-m", "rst-main", "renamed-main"]);
  assert.equal((await listMergedWorktreeBranches(repo)).size, 0);
});

test("creation requires a clean checkout, explicit local base and full matching HEAD; attach requires captured tip", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-create-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repo, "README.md"), "start\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  const { addWorktree, listLocalBranchTips } = await loadSubject();
  const baseBranch = await git(repo, ["branch", "--show-current"]);
  const expectedBaseOid = await git(repo, ["rev-parse", "HEAD"]);
  const opts = { branch: "feature/new", baseBranch, expectedBaseOid, mode: "create" };
  assert.deepEqual(await listLocalBranchTips(repo), [{ branch: baseBranch, oid: expectedBaseOid }]);
  await assert.rejects(addWorktree(repo, "feature/old"), /explicit local base/i);
  await assert.rejects(addWorktree(repo, { ...opts, baseBranch: "origin/main" }), /local base branch does not exist/i);
  await assert.rejects(addWorktree(repo, { ...opts, branch: "bad..name" }), /invalid branch name/i);
  await assert.rejects(addWorktree(repo, { ...opts, expectedBaseOid: "abc" }), /full expected base/i);
  await writeFile(path.join(repo, "dirty.txt"), "dirty\n");
  await assert.rejects(addWorktree(repo, opts), /not clean/i);
  await rm(path.join(repo, "dirty.txt"));
  await git(repo, ["branch", "feature/existing"]);
  await assert.rejects(addWorktree(repo, { ...opts, branch: "feature/existing" }), /already exists/i);
  // Even a remote-tracking ref with the target name must not be chosen.
  await git(repo, ["update-ref", "refs/remotes/origin/feature/new", expectedBaseOid]);
  const made = await addWorktree(repo, opts);
  assert.equal(await git(made.path, ["rev-parse", "HEAD"]), expectedBaseOid);
  assert.equal(await git(made.path, ["branch", "--show-current"]), "feature/new");
  const attach = { ...opts, branch: "feature/existing", mode: "attach", expectedTipOid: expectedBaseOid };
  await assert.rejects(addWorktree(repo, { ...attach, expectedTipOid: undefined }), /full expected branch tip/i);
  await assert.rejects(addWorktree(repo, { ...attach, expectedTipOid: "a".repeat(40) }), /stale branch tip/i);
  const attached = await addWorktree(repo, attach);
  assert.equal(await git(attached.path, ["branch", "--show-current"]), "feature/existing");
  await writeFile(path.join(made.path, "untracked.txt"), "dirty base\n");
  await assert.rejects(addWorktree(repo, { ...opts, baseBranch: "feature/new", branch: "feature/dirty-base" }), /not clean/i);
  await rm(path.join(made.path, "untracked.txt"));
  await writeFile(path.join(repo, "README.md"), "changed\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "changed"]);
  await assert.rejects(addWorktree(repo, { ...opts, branch: "feature/stale" }), /stale local base/i);
  assert.equal(await git(repo, ["branch", "--list", "feature/stale"]), "");
  const fresh = { ...opts, expectedBaseOid: await git(repo, ["rev-parse", "HEAD"]) };
  await assert.rejects(addWorktree(repo, { ...fresh, branch: "feature/new" }), /already exists/i);
  // Distinct branch names can sanitize to the same destination directory.
  await assert.rejects(addWorktree(repo, { ...fresh, branch: "feature-new" }), /directory already exists/i);
});
