import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { selectGitWorkspace } = await jiti.import("./git-workspace-selector.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = promisify(execFile);

test("selects only physical registered same-repository worktrees within allowed roots", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-selector-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = path.join(home, "source"), other = path.join(home, "other");
  await git("git", ["init", "-q", "-b", "source", source]);
  await git("git", ["-C", source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base", "--allow-empty"]);
  await git("git", ["-C", source, "worktree", "add", "-qb", "other", other]);
  assert.equal(await selectGitWorkspace(source), source);
  await assert.rejects(selectGitWorkspace(source, "other"));
  allowFileRoot(other);
  assert.equal(await selectGitWorkspace(source, "other"), other);
  await assert.rejects(selectGitWorkspace(source, "../other"));
  await assert.rejects(selectGitWorkspace(source, "missing"));
  const alias = path.join(home, "alias");
  await symlink(other, alias);
  await assert.rejects(selectGitWorkspace(alias, "other"));
  const foreign = path.join(home, "foreign");
  await git("git", ["init", "-q", "-b", "foreign", foreign]);
  allowFileRoot(foreign);
  await assert.rejects(selectGitWorkspace(source, "foreign"));
});
