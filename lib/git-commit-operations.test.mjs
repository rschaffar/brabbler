import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const { prepareGitCommit, confirmGitCommit, GitCommitOperationError } = await createJiti(import.meta.url).import("./git-commit.ts");
const exec = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-git-operation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = new Map(["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, ".config"), GIT_CONFIG_GLOBAL: join(root, "no-config"), GIT_CONFIG_NOSYSTEM: "1" });
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const git = async (cwd, ...args) => (await exec("git", ["--no-optional-locks", "-C", cwd, ...args])).stdout.trim();
  const main = join(root, "main"), linked = join(root, "linked"), template = join(root, "empty-template");
  await fs.mkdir(template);
  await git(root, "init", "-qb", "base", `--template=${template}`, main);
  await git(main, "config", "user.name", "Operation Fixture");
  await git(main, "config", "user.email", "fixture@example.invalid");
  await fs.writeFile(join(main, "a"), "base\n");
  await git(main, "add", "a"); await git(main, "commit", "-qm", "base");
  await git(main, "worktree", "add", "-qb", "feature", linked);
  const metadata = async (cwd, name) => normalize(await git(cwd, "rev-parse", "--path-format=absolute", "--git-path", name));
  const snapshot = async (cwd) => ({ head: await git(cwd, "rev-parse", "HEAD"), index: await fs.readFile(await metadata(cwd, "index")), content: await fs.readFile(join(cwd, "a")) });
  const unchanged = async (cwd, before) => {
    assert.deepEqual(await snapshot(cwd), before);
    await assert.rejects(fs.lstat(`${await metadata(cwd, "index")}.lock`), { code: "ENOENT" });
  };
  return { root, main, linked, git, metadata, snapshot, unchanged };
}
const markers = [
  ["MERGE_HEAD", false, /merge is in progress/], ["CHERRY_PICK_HEAD", false, /cherry-pick is in progress/],
  ["REVERT_HEAD", false, /revert is in progress/], ["rebase-merge", true, /rebase is in progress/],
  ["rebase-apply", true, /rebase or git am is in progress/], ["sequencer", true, /sequenced cherry-pick or revert/],
  ["BISECT_START", false, /bisect is in progress/],
];

test("every worktree-local operation blocks an otherwise valid clean-index candidate, without touching its marker", async (t) => {
  const f = await fixture(t);
  for (const cwd of [f.main, f.linked]) {
    await fs.writeFile(join(cwd, "a"), "selected\n");
    const before = await f.snapshot(cwd);
    assert.equal(await f.git(cwd, "diff", "--cached", "--name-only"), "");
    for (const [name, directory, reason] of markers) {
      const marker = await f.metadata(cwd, name);
      if (directory) await fs.mkdir(marker); else await fs.writeFile(marker, `${before.head}\n`);
      try {
        await assert.rejects(prepareGitCommit(cwd, ["a"]), (error) => error instanceof GitCommitOperationError && reason.test(error.message));
        assert.equal((await fs.lstat(marker)).isDirectory(), directory);
        await f.unchanged(cwd, before);
      } finally { await fs.rm(marker, { recursive: true }); }
    }
  }
});

test("operation begun after preview, or during final journal callback, refuses before ref update", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.linked, "a"), "candidate\n");
  for (const late of [false, true]) {
    const preview = await prepareGitCommit(f.linked, ["a"]), before = await f.snapshot(f.linked);
    const marker = await f.metadata(f.linked, "sequencer");
    if (!late) await fs.mkdir(marker);
    let recorded = false;
    try {
      await assert.rejects(confirmGitCommit(preview, "no commit", async (intent) => {
        recorded = true;
        assert.equal(intent.parents[0], before.head);
        await new Promise((resolve) => setImmediate(resolve));
        await fs.mkdir(marker);
      }), /sequenced cherry-pick or revert/);
      assert.equal(recorded, late);
      assert.equal((await fs.lstat(marker)).isDirectory(), true);
      await f.unchanged(f.linked, before);
    } finally { await fs.rm(marker, { recursive: true }); }
  }
});

test("a primary checkout operation does not contaminate a sibling's per-worktree preflight", async (t) => {
  const f = await fixture(t);
  const marker = await f.metadata(f.main, "MERGE_HEAD");
  await fs.writeFile(marker, `${await f.git(f.main, "rev-parse", "HEAD")}\n`);
  await fs.writeFile(join(f.linked, "a"), "independent\n");
  const preview = await prepareGitCommit(f.linked, ["a"]);
  assert.equal((await confirmGitCommit(preview, "independent commit")).status, "committed");
  assert.equal(await f.git(f.main, "show", "HEAD:a"), "base");
  assert.equal(await f.git(f.linked, "show", "HEAD:a"), "independent");
  assert.equal((await fs.lstat(marker)).isFile(), true);
});

test("actual no-commit empty merge is refused even with attached HEAD and clean real index", async (t) => {
  const f = await fixture(t);
  await f.git(f.linked, "commit", "--allow-empty", "-qm", "empty side");
  await f.git(f.main, "merge", "--no-ff", "--no-commit", "feature");
  assert.equal(await f.git(f.main, "diff", "--cached", "--name-only"), "");
  assert.equal(await f.git(f.main, "symbolic-ref", "HEAD"), "refs/heads/base");
  await fs.writeFile(join(f.main, "a"), "unrelated candidate\n");
  const before = await f.snapshot(f.main);
  await assert.rejects(prepareGitCommit(f.main, ["a"]), /merge is in progress/);
  await f.unchanged(f.main, before);
});

test("historical ORIG_HEAD/FETCH_HEAD and a squash message alone are not ongoing operations", async (t) => {
  const f = await fixture(t);
  const head = await f.git(f.main, "rev-parse", "HEAD");
  for (const name of ["ORIG_HEAD", "FETCH_HEAD", "SQUASH_MSG", "MERGE_MSG"]) await fs.writeFile(await f.metadata(f.main, name), `${head}\n`);
  await fs.writeFile(join(f.main, "a"), "ordinary\n");
  const preview = await prepareGitCommit(f.main, ["a"]);
  assert.equal((await confirmGitCommit(preview, "ordinary commit")).status, "committed");
});

test("unreadable operation probes fail closed, and dangling markers are not treated as absence", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.main, "a"), "candidate\n");
  const before = await f.snapshot(f.main), marker = await f.metadata(f.main, "MERGE_HEAD");
  const original = fs.lstat;
  const mock = t.mock.method(fs, "lstat", async (file, ...args) => {
    if (file === marker) throw Object.assign(new Error("private filesystem diagnostic"), { code: "EACCES" });
    return original(file, ...args);
  });
  try {
    await assert.rejects(prepareGitCommit(f.main, ["a"]), (error) => error instanceof GitCommitOperationError
      && /could not be inspected/.test(error.message) && !/private/.test(error.message));
  } finally { mock.mock.restore(); }
  if (process.platform !== "win32") {
    await fs.symlink(join(f.root, "missing-marker-target"), marker);
    await assert.rejects(prepareGitCommit(f.main, ["a"]), /merge is in progress/);
    assert.equal((await fs.lstat(marker)).isSymbolicLink(), true);
  }
  await f.unchanged(f.main, before);
});
