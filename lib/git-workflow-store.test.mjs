import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const git = promisify(execFile);
const { gitWorkflowDefaultsPath, getProjectGitWorkflow, setProjectGitWorkflow, snapshotNewSessionGitWorkflow } =
  await createJiti(import.meta.url).import("./git-workflow-store.ts");
const { readSessionGitWorkflow } = await createJiti(import.meta.url).import("./git-workflow-policy.ts");
const first = { mode: "worktree", baseBranch: "main", onCreate: "continue", commits: "agent" };
const second = { mode: "current", branch: "feature/b", onCreate: "stay", commits: "manual" };

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-workflow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo");
  const linked = path.join(dir, "linked");
  const other = path.join(dir, "other");
  await git("git", ["init", repo]);
  await git("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  await git("git", ["-C", repo, "worktree", "add", "-b", "feature/linked", linked]);
  await git("git", ["init", other]);
  return { dir, repo, linked, other, store: gitWorkflowDefaultsPath(path.join(dir, "agent")) };
}

function manager() {
  const entries = [];
  return { entries, appendCustomEntry(customType, data) { entries.push({ type: "custom", customType, data }); } };
}

test("missing defaults do not affect legacy sessions; snapshots do not change when defaults change", async (t) => {
  const { repo, store } = await fixture(t);
  assert.equal(await getProjectGitWorkflow(repo, store), undefined);
  const old = manager();
  assert.equal(readSessionGitWorkflow(old.entries), undefined);
  assert.equal(await snapshotNewSessionGitWorkflow(repo, old, store), undefined);
  assert.equal(old.entries.length, 0);
  await setProjectGitWorkflow(repo, first, store);
  const created = manager();
  assert.deepEqual(await snapshotNewSessionGitWorkflow(repo, created, store), first);
  await setProjectGitWorkflow(repo, second, store);
  assert.deepEqual(readSessionGitWorkflow(created.entries), first);
  assert.equal(readSessionGitWorkflow(old.entries), undefined);
  assert.deepEqual(await getProjectGitWorkflow(repo, store), second);
  await setProjectGitWorkflow(repo, null, store);
  assert.equal(await getProjectGitWorkflow(repo, store), undefined);
  assert.deepEqual(readSessionGitWorkflow(created.entries), first);
});

test("main, linked, and symlinked checkout share defaults; other project is isolated", async (t) => {
  const { dir, repo, linked, other, store } = await fixture(t);
  await setProjectGitWorkflow(linked, first, store);
  assert.deepEqual(await getProjectGitWorkflow(repo, store), first);
  await symlink(repo, path.join(dir, "alias"), "dir");
  assert.deepEqual(await getProjectGitWorkflow(path.join(dir, "alias"), store), first);
  await setProjectGitWorkflow(other, second, store);
  assert.deepEqual(await getProjectGitWorkflow(other, store), second);
  assert.deepEqual(await getProjectGitWorkflow(linked, store), first);
  await setProjectGitWorkflow(repo, null, store);
  assert.deepEqual(await getProjectGitWorkflow(other, store), second);
});

test("private atomic JSON and concurrent locked changes retain both projects", async (t) => {
  const { repo, other, store } = await fixture(t);
  await Promise.all(Array.from({ length: 8 }, (_, i) => setProjectGitWorkflow(i % 2 ? repo : other, i % 2 ? first : second, store)));
  assert.deepEqual(await getProjectGitWorkflow(repo, store), first);
  assert.deepEqual(await getProjectGitWorkflow(other, store), second);
  assert.equal((await stat(store)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(store))).mode & 0o777, 0o700);
  const data = JSON.parse(await readFile(store, "utf8"));
  assert.equal(data.version, 1);
  assert.equal(Object.keys(data.projects).length, 2);
  assert.equal(JSON.stringify(data).includes("approved"), false);
});

test("malformed, unsupported, or secret-bearing storage fails closed without overwriting", async (t) => {
  const { repo, store } = await fixture(t);
  await setProjectGitWorkflow(repo, first, store);
  const saved = await readFile(store, "utf8");
  for (const bad of ["{", '{"version":2,"projects":{}}', '{"version":1,"projects":[]}',
    JSON.stringify({ version: 1, projects: { [repo]: { ...first, token: "secret" } } })]) {
    await writeFile(store, bad);
    await assert.rejects(getProjectGitWorkflow(repo, store));
    await assert.rejects(setProjectGitWorkflow(repo, second, store));
    assert.equal(await readFile(store, "utf8"), bad);
  }
  await writeFile(store, saved);
  await assert.rejects(setProjectGitWorkflow(repo, { ...first, autoApprove: true }, store));
  assert.equal(await readFile(store, "utf8"), saved);
});
