import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const exec = promisify(execFile);
const { addWorktree, currentLocalBranchTip, removeWorktree } = await createJiti(import.meta.url).import("./worktree.ts");

async function git(cwd, ...args) {
  await exec("git", ["-C", cwd, ...args]);
}

test("isolated worktrees are unique, write-safe, and cleaned without deleting dirty work", async () => {
  const repo = await mkdtemp(join(tmpdir(), "brabbler-agent-isolation-"));
  try {
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Brabbler Test");
    await writeFile(join(repo, "README.md"), "parent\n");
    await git(repo, "add", "README.md");
    await git(repo, "commit", "-qm", "initial");

    const { branch: baseBranch, oid: expectedBaseOid } = await currentLocalBranchTip(repo);
    const first = await addWorktree(repo, { branch: "brabbler-test-one", baseBranch, expectedBaseOid, mode: "create" });
    const second = await addWorktree(repo, { branch: "brabbler-test-two", baseBranch, expectedBaseOid, mode: "create" });
    assert.notEqual(first.path, second.path);
    await writeFile(join(first.path, "child.txt"), "child\n");
    await assert.rejects(stat(join(repo, "child.txt")));

    await assert.rejects(removeWorktree(repo, first.path), /modified|untracked|dirty/i);
    await removeWorktree(repo, first.path, true);
    await removeWorktree(repo, second.path);
    await assert.rejects(stat(first.path));
    await assert.rejects(stat(second.path));
    assert.equal(await readFile(join(repo, "README.md"), "utf8"), "parent\n");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("worktree isolation rejects dirty, detached, and moved parent branches", async () => {
  const repo = await mkdtemp(join(tmpdir(), "brabbler-agent-base-"));
  try {
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Brabbler Test");
    await writeFile(join(repo, "README.md"), "initial\n");
    await git(repo, "add", "README.md");
    await git(repo, "commit", "-qm", "initial");
    const captured = await currentLocalBranchTip(repo);
    await writeFile(join(repo, "dirty.txt"), "untracked\n");
    await assert.rejects(currentLocalBranchTip(repo), /not clean/i);
    await assert.rejects(addWorktree(repo, {
      branch: "agent-dirty", baseBranch: captured.branch, expectedBaseOid: captured.oid, mode: "create",
    }), /not clean/i);
    await rm(join(repo, "dirty.txt"));
    await git(repo, "checkout", "--detach", "-q");
    await assert.rejects(currentLocalBranchTip(repo), /local branch/i);
    await git(repo, "checkout", "-q", captured.branch);
    await writeFile(join(repo, "README.md"), "next\n");
    await git(repo, "commit", "-qam", "next");
    await assert.rejects(addWorktree(repo, {
      branch: "agent-stale", baseBranch: captured.branch, expectedBaseOid: captured.oid, mode: "create",
    }), /stale local base/i);
    await assert.rejects(stat(join(`${repo}-worktrees`, "agent-stale")));
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(`${repo}-worktrees`, { recursive: true, force: true });
  }
});

test("worktree isolation rejects non-git directories", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "brabbler-agent-non-git-"));
  try {
    await assert.rejects(currentLocalBranchTip(cwd), /local branch/i);
    await assert.rejects(addWorktree(cwd, {
      branch: "agent", baseBranch: "main", expectedBaseOid: "a".repeat(40), mode: "create",
    }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
