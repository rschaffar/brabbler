import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as filesystem } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const { createJiti } = await import("jiti");
const { prepareGitCommit, confirmGitCommit, readGitCommitNativeBoundary } = await createJiti(import.meta.url).import("./git-commit.ts");
async function git(cwd, ...args) { return (await exec("git", ["-C", cwd, ...args])).stdout.trim(); }
async function repo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"];
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, "config"),
    GIT_CONFIG_GLOBAL: path.join(root, "no-global"), GIT_CONFIG_NOSYSTEM: "1" });
  t.after(() => { for (const [key, value] of prior) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const dir = path.join(root, "repo"), template = path.join(root, "empty-template");
  await mkdir(template);
  await exec("git", ["init", "-q", `--template=${template}`, dir]);
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(dir, "a"), "first\n");
  await writeFile(path.join(dir, "other"), "other\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-qm", "initial");
  return { root, dir };
}

test("selected changes only: preserves unselected worktree and clean real index", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  await writeFile(path.join(dir, "other"), "untouched\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  assert.match(preview.reviewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.paths, ["a"]);
  const result = await confirmGitCommit(preview, "selected");
  assert.equal(result.status, "committed");
  assert.equal(result.authorEmail, "test@example.invalid");
  assert.deepEqual(result.parents, [preview.head]);
  assert.equal(result.tree, preview.tree);
  const raw = await git(dir, "cat-file", "-p", "HEAD");
  assert.match(raw, new RegExp(`^tree ${preview.tree}\\nparent ${preview.head}\\nauthor Test <test@example\\.invalid> \\d+ [+-]\\d{4}\\ncommitter Test <test@example\\.invalid> \\d+ [+-]\\d{4}\\n\\nselected$`));
  assert.equal(await git(dir, "show", "HEAD:a"), "second");
  assert.equal(await git(dir, "show", "HEAD:other"), "other");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  assert.equal(await git(dir, "status", "--porcelain"), "M other");
});

test("staged mode commits only selected partial index content, retaining other staged and unstaged changes", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "staged line\n");
  await git(dir, "add", "a");
  await writeFile(path.join(dir, "a"), "staged line\nunstaged line\n");
  await writeFile(path.join(dir, "other"), "other staged\n");
  await git(dir, "add", "other");
  await writeFile(path.join(dir, "other"), "other staged\nother unstaged\n");
  await writeFile(path.join(dir, "untracked"), "never staged\n");
  const before = await readFile(path.join(dir, ".git", "index"));
  const preview = await prepareGitCommit(dir, ["a"], "staged");
  assert.equal(preview.mode, "staged");
  assert.deepEqual(await readFile(path.join(dir, ".git", "index")), before);
  const result = await confirmGitCommit(preview, "partial staged");
  assert.equal(result.status, "committed");
  assert.equal(await git(dir, "show", "HEAD:a"), "staged line");
  assert.equal(await git(dir, "show", "HEAD:other"), "other");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "other");
  assert.equal(await git(dir, "show", ":a"), "staged line");
  assert.equal(await git(dir, "show", ":other"), "other staged");
  assert.equal(await git(dir, "diff", "--name-only"), "a\nother");
  assert.equal(await readFile(path.join(dir, "untracked"), "utf8"), "never staged\n");
  assert.deepEqual(await readFile(path.join(dir, ".git", "index")), before);
});

test("native protected boundary is FD-owned, invocation-only and cannot be copied from JSON", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  let handle;
  const result = await confirmGitCommit(preview, "bound message", async (intent, proof) => {
    handle = proof;
    const boundary = readGitCommitNativeBoundary(proof);
    assert.ok(boundary);
    assert.equal(boundary.message, "bound message");
    assert.equal(boundary.preview.reviewToken, preview.reviewToken);
    assert.equal(boundary.preview.mode, preview.mode);
    assert.equal(boundary.indexLockPath, path.join(dir, ".git", "index.lock"));
    assert.equal(intent.tree, preview.tree);
    assert.equal(readGitCommitNativeBoundary({ ...proof }), undefined);
    assert.equal(readGitCommitNativeBoundary(JSON.parse(JSON.stringify(boundary))), undefined);
    assert.equal(readGitCommitNativeBoundary({ indexLockPath: boundary.indexLockPath }), undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(readGitCommitNativeBoundary(proof));
    return () => { assert.ok(readGitCommitNativeBoundary(proof)); };
  });
  assert.equal(result.status, "committed");
  assert.equal(readGitCommitNativeBoundary(handle), undefined);
});

test("replacement index.lock is never treated as owned or removed by native cleanup", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const preview = await prepareGitCommit(dir, ["a"]), index = await readFile(path.join(dir, ".git", "index"));
  const lock = path.join(dir, ".git", "index.lock"), moved = lock + ".displaced";
  await assert.rejects(confirmGitCommit(preview, "must refuse", async (_, proof) => {
    assert.ok(readGitCommitNativeBoundary(proof));
    await rename(lock, moved);
    await writeFile(lock, "foreign writer\n");
    assert.equal(readGitCommitNativeBoundary(proof), undefined);
  }), /ownership lost|stale preview/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
  assert.deepEqual(await readFile(path.join(dir, ".git", "index")), index);
  assert.equal(await readFile(lock, "utf8"), "foreign writer\n");
});

test("same-byte original index replacement and late unrelated ref invalidate native proof", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const indexPath = path.join(dir, ".git", "index");
  for (const late of ["index", "refs"]) {
    const preview = await prepareGitCommit(dir, ["a"]), index = await readFile(indexPath);
    await assert.rejects(confirmGitCommit(preview, "must refuse", async (_, proof) => {
      assert.ok(readGitCommitNativeBoundary(proof));
      if (late === "index") {
        await rename(indexPath, indexPath + ".old");
        await writeFile(indexPath, index);
      } else await git(dir, "branch", "late-ref", preview.head);
      assert.equal(readGitCommitNativeBoundary(proof), undefined);
    }), /ownership lost|stale preview/);
    assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
    assert.deepEqual(await readFile(indexPath), index);
    await assert.rejects(readFile(indexPath + ".lock"), { code: "ENOENT" });
    if (late === "refs") await git(dir, "branch", "-D", "late-ref");
  }
});

test("whole-file recaptures selected bytes and index after awaited journal callback", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const preview = await prepareGitCommit(dir, ["a"]), indexPath = path.join(dir, ".git", "index"), index = await readFile(indexPath);
  await assert.rejects(confirmGitCommit(preview, "late write", async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await writeFile(path.join(dir, "a"), "new bytes after journal\n");
  }), /stale preview/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
  assert.deepEqual(await readFile(indexPath), index);
  assert.equal(await readFile(path.join(dir, "a"), "utf8"), "new bytes after journal\n");
});

for (const mode of ["whole-file", "staged"]) test(`native final guard refuses thenables before CAS (${mode})`, async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  if (mode === "staged") await git(dir, "add", "a");
  const preview = await prepareGitCommit(dir, ["a"], mode), indexPath = path.join(dir, ".git", "index");
  const before = await readFile(indexPath);
  let guarded = false, owned;
  await assert.rejects(confirmGitCommit(preview, "no async guard", async (_, proof) => {
    owned = proof; assert.ok(readGitCommitNativeBoundary(proof));
    return async () => { guarded = true; assert.ok(readGitCommitNativeBoundary(proof)); };
  }), /guard must be synchronous/);
  assert.equal(guarded, true);
  assert.equal(readGitCommitNativeBoundary(owned), undefined);
  assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
  assert.deepEqual(await readFile(indexPath), before);
  await assert.rejects(readFile(indexPath + ".lock"), { code: "ENOENT" });
});

test("returned synchronous guard fences late revocation after native recapture", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const original = new Error("authority revoked at the final fence");
  let called = false;
  await assert.rejects(confirmGitCommit(preview, "no CAS", async () => () => {
    called = true; throw original;
  }), (error) => error === original);
  assert.equal(called, true);
  assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
});

test("staged deletions and renames require explicit path selection", async (t) => {
  const { dir } = await repo(t);
  await rename(path.join(dir, "a"), path.join(dir, "new"));
  await git(dir, "add", "-A", "--", "a", "new");
  await writeFile(path.join(dir, "new"), "not staged\n");
  await assert.rejects(prepareGitCommit(dir, ["new", "missing"], "staged"), /not changed in index/);
  const deletion = await prepareGitCommit(dir, ["a"], "staged");
  assert.equal((await confirmGitCommit(deletion, "delete only")).status, "committed");
  assert.equal(await git(dir, "ls-tree", "--name-only", "HEAD"), "other");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "new");
  const addition = await prepareGitCommit(dir, ["new"], "staged");
  assert.equal((await confirmGitCommit(addition, "add new")).status, "committed");
  assert.equal(await git(dir, "show", "HEAD:new"), "first");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  assert.equal(await git(dir, "diff", "--name-only"), "new");
});

test("staged rename pair and executable mode preserve literal selection and worktree edits", async (t) => {
  const { dir } = await repo(t);
  await rename(path.join(dir, "a"), path.join(dir, "new"));
  await git(dir, "add", "-A", "--", "a", "new");
  await writeFile(path.join(dir, "new"), "unstaged\n");
  await writeFile(path.join(dir, "[literal]*"), "literal\n");
  await git(dir, "add", "--", "[literal]*");
  await git(dir, "update-index", "--chmod=+x", "other");
  await chmod(path.join(dir, "other"), 0o755);
  const preview = await prepareGitCommit(dir, ["a", "new", "[literal]*", "other"], "staged");
  assert.deepEqual(preview.paths, ["[literal]*", "a", "new", "other"]);
  assert.equal((await confirmGitCommit(preview, "rename and chmod")).status, "committed");
  assert.equal(await git(dir, "show", "--format=", "--name-status", "HEAD"), "A\t[literal]*\nR100\ta\tnew\nM\tother");
  assert.match(await git(dir, "ls-tree", "HEAD", "other"), /^100755 blob /);
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  assert.equal(await git(dir, "diff", "--name-only"), "new");
});

test("staged candidate rejects forged modes, paths, stale bytes and callback index changes before CAS", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "staged\n");
  await git(dir, "add", "a");
  await writeFile(path.join(dir, "a"), "worktree\n");
  await writeFile(path.join(dir, "other"), "other staged\n");
  await git(dir, "add", "other");
  let preview = await prepareGitCommit(dir, ["a"], "staged");
  const head = preview.head;
  await assert.rejects(confirmGitCommit({ ...preview, mode: "whole-file" }, "forged"), /index differs from HEAD|stale preview/);
  await assert.rejects(confirmGitCommit({ ...preview, mode: "unknown" }, "forged"), /invalid candidate mode/);
  await assert.rejects(confirmGitCommit({ ...preview, paths: ["other"] }, "forged"), /stale preview/);
  await assert.rejects(confirmGitCommit({ ...preview, tree: "0".repeat(40) }, "forged"), /stale preview/);
  await writeFile(path.join(dir, "other"), "changed staged\n");
  await git(dir, "add", "other");
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  preview = await prepareGitCommit(dir, ["a"], "staged");
  const indexPath = path.join(dir, ".git", "index");
  const before = await readFile(indexPath);
  const alternate = path.join(path.dirname(dir), "alternate-index");
  await writeFile(alternate, before);
  await writeFile(path.join(dir, "other"), "different again\n");
  await exec("git", ["-C", dir, "add", "other"], { env: { ...process.env, GIT_INDEX_FILE: alternate } });
  const changed = await readFile(alternate);
  assert.notDeepEqual(changed, before);
  let prepared = false;
  await assert.rejects(confirmGitCommit(preview, "stale callback", async () => {
    prepared = true;
    // Simulate a writer ignoring Git's lock but leaving a valid, changed index.
    await writeFile(indexPath, changed);
  }), /stale preview|index changed/);
  assert.equal(prepared, true);
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
  await writeFile(indexPath, before);
});

test("staged mode refuses intent-to-add, flags, submodules and staged filter attributes", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  await git(dir, "add", "a");
  await writeFile(path.join(dir, "new"), "intent\n");
  await git(dir, "add", "-N", "new");
  await assert.rejects(prepareGitCommit(dir, ["a"], "staged"), /nonstandard index flags|intent-to-add/);
  await git(dir, "reset", "-q", "--", "new");
  await git(dir, "update-index", "--skip-worktree", "other");
  await assert.rejects(prepareGitCommit(dir, ["a"], "staged"), /nonstandard index flags/);
  await git(dir, "update-index", "--no-skip-worktree", "other");
  await writeFile(path.join(dir, ".gitattributes"), "a filter=magic\n");
  await git(dir, "add", ".gitattributes");
  await rm(path.join(dir, ".gitattributes"));
  await assert.rejects(prepareGitCommit(dir, ["a"], "staged"), /filter attribute/);
  await git(dir, "reset", "-q", "--", ".gitattributes");
  const oid = await git(dir, "rev-parse", "HEAD:a");
  await git(dir, "update-index", "--add", "--cacheinfo", "160000", oid, "other");
  await assert.rejects(prepareGitCommit(dir, ["other"], "staged"), /submodule changes unsupported/);
});

test("staged post-ref installation failure reports partial success and retains original index", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "staged\n");
  await git(dir, "add", "a");
  await writeFile(path.join(dir, "a"), "unstaged\n");
  await writeFile(path.join(dir, "other"), "other staged\n");
  await git(dir, "add", "other");
  const preview = await prepareGitCommit(dir, ["a"], "staged");
  const indexPath = path.join(dir, ".git", "index");
  const before = await readFile(indexPath);
  const renameOriginal = filesystem.rename;
  filesystem.rename = async (from, to) => {
    if (from === `${indexPath}.lock` && to === indexPath) throw new Error("simulated installation failure");
    return renameOriginal(from, to);
  };
  let result;
  try { result = await confirmGitCommit(preview, "partial"); }
  finally { filesystem.rename = renameOriginal; }
  assert.equal(result.status, "partial-success");
  assert.equal(await git(dir, "rev-parse", "HEAD"), result.commit);
  assert.equal(await git(dir, "show", "HEAD:a"), "staged");
  assert.deepEqual(await readFile(indexPath), before);
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
});

test("stale worktree, index and branch are rejected; no commit on concurrent ref move", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  let preview = await prepareGitCommit(dir, ["a"]);
  await writeFile(path.join(dir, "a"), "third\n");
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  preview = await prepareGitCommit(dir, ["a"]);
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const beforeRefresh = await readFile(indexPath);
  // Make the stat-cache refresh deterministic; adding an untouched file can be a no-op.
  await utimes(path.join(dir, "other"), new Date(0), new Date(0));
  await git(dir, "add", "other");
  assert.notDeepEqual(await readFile(indexPath), beforeRefresh, "The fixture must actually change index bytes");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "", "Staged contents stay unchanged");
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  await git(dir, "reset", "-q");
  preview = await prepareGitCommit(dir, ["a"]);
  const base = await git(dir, "rev-parse", "HEAD");
  const tree = await git(dir, "rev-parse", "HEAD^{tree}");
  const outsider = await git(dir, "commit-tree", tree, "-p", base, "-m", "outsider");
  await git(dir, "update-ref", preview.branch, outsider, base);
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), outsider);
});

test("client cannot forge another selection or edit an approved preview", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "new a\n");
  await writeFile(path.join(dir, "other"), "new other\n");
  const approved = await prepareGitCommit(dir, ["a"]);
  const alternate = await prepareGitCommit(dir, ["other"]);
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const originalIndex = await readFile(indexPath);
  const indexHash = createHash("sha256").update(originalIndex).digest("hex");
  const forged = createHash("sha256")
    .update(JSON.stringify([alternate.branch, alternate.head, alternate.paths, indexHash, alternate.tree]))
    .digest("hex");
  const head = await git(dir, "rev-parse", "HEAD");
  await assert.rejects(confirmGitCommit({ ...alternate, reviewToken: forged }, "forged"), /stale preview/);
  await assert.rejects(confirmGitCommit({ ...alternate, reviewToken: approved.reviewToken }, "forged"), /stale preview/);
  await assert.rejects(confirmGitCommit({ ...approved, tree: alternate.tree }, "forged"), /stale preview/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  assert.deepEqual(await readFile(indexPath), originalIndex);
});

test("post-ref index installation failure is explicitly partial success, with the original index intact", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "new content\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const before = await readFile(indexPath);
  const renameOriginal = filesystem.rename;
  filesystem.rename = async (from, to) => {
    if (from === `${indexPath}.lock` && to === indexPath) throw new Error("simulated index installation failure");
    return renameOriginal(from, to);
  };
  let result;
  try { result = await confirmGitCommit(preview, "partial"); }
  finally { filesystem.rename = renameOriginal; }
  assert.equal(result.status, "partial-success");
  assert.match(result.reason, /checkout finalization failed/);
  assert.equal(result.authorEmail, "test@example.invalid");
  assert.deepEqual(result.parents, [preview.head]);
  assert.equal(result.tree, preview.tree);
  assert.equal(await git(dir, "rev-parse", "HEAD"), result.commit);
  assert.equal(await git(dir, "show", "HEAD:a"), "new content");
  assert.deepEqual(await readFile(indexPath), before);
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
});

test("untracked binary, literal glob characters and a rename pair are complete", async (t) => {
  const { dir } = await repo(t);
  await rename(path.join(dir, "a"), path.join(dir, "new"));
  await writeFile(path.join(dir, "[literal]*"), Buffer.from([0, 1, 255]));
  const preview = await prepareGitCommit(dir, ["a", "new", "[literal]*"]);
  assert.deepEqual(preview.paths, ["[literal]*", "a", "new"]);
  assert.equal((await confirmGitCommit(preview, "rename and binary")).status, "committed");
  assert.deepEqual(await readFile(path.join(dir, "[literal]*")), Buffer.from([0, 1, 255]));
  assert.equal(await git(dir, "show", "--format=", "--name-status", "HEAD"), "A\t[literal]*\nR100\ta\tnew");
  assert.equal(await git(dir, "status", "--porcelain"), "");
});

test("dirty index, detached head, subdirectory, symlink ancestor and existing lock fail closed", async (t) => {
  const { dir, root } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  await git(dir, "add", "a");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /index differs from HEAD/);
  await git(dir, "reset", "-q");
  await exec("git", ["-C", dir, "checkout", "--detach", "-q"]);
  await assert.rejects(prepareGitCommit(dir, ["a"]), /detached HEAD/);
  await git(dir, "switch", "-q", "-");
  await assert.rejects(prepareGitCommit(root, ["a"]), /repository-root|checkout root/);
  await assert.rejects(prepareGitCommit(path.join(dir, ".git"), ["a"]), /repository-root|checkout root/);
  if (process.platform !== "win32") {
    const external = path.join(root, "external");
    await mkdir(external);
    await symlink(external, path.join(dir, "link"), "dir");
    await assert.rejects(prepareGitCommit(dir, ["link/file"]), /not in current status/);
    await mkdir(path.join(dir, "nested"));
    await writeFile(path.join(dir, "nested", "file"), "inside\n");
    await git(dir, "add", "nested/file");
    await git(dir, "commit", "-qm", "nested");
    await rm(path.join(dir, "nested"), { recursive: true });
    await writeFile(path.join(external, "file"), "outside\n");
    await symlink(external, path.join(dir, "nested"), "dir");
    await assert.rejects(prepareGitCommit(dir, ["nested/file"]), /symlink ancestor/);
  }
  const index = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  await writeFile(`${index}.lock`, "another writer");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /index locked/);
  assert.equal(await readFile(`${index}.lock`, "utf8"), "another writer");
});

test("intent-to-add and nonstandard index flags are not silently overwritten", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  await writeFile(path.join(dir, "new"), "not actually staged\n");
  await git(dir, "add", "-N", "new");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /index differs from HEAD/);
  await git(dir, "reset", "-q", "--", "new");
  await git(dir, "update-index", "--assume-unchanged", "other");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /nonstandard index flags/);
});

test("whitespace errors fail diff --cached --check without mutating the index", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "bad trailing space \n");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /diff.*check|trailing whitespace|Command failed/);
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
});

test("unmerged index fails closed", async (t) => {
  const { dir } = await repo(t);
  const base = await git(dir, "branch", "--show-current");
  await git(dir, "switch", "-qc", "conflict-side");
  await writeFile(path.join(dir, "a"), "side\n");
  await git(dir, "commit", "-qam", "side");
  await git(dir, "switch", "-q", base);
  await writeFile(path.join(dir, "a"), "main\n");
  await git(dir, "commit", "-qam", "main");
  await assert.rejects(git(dir, "merge", "--no-commit", "conflict-side"));
  await assert.rejects(prepareGitCommit(dir, ["a"]), /merge is in progress/);
  // An unmerged index without a merge marker must independently remain blocked.
  await rm(path.join(dir, ".git", "MERGE_HEAD"));
  await assert.rejects(prepareGitCommit(dir, ["a"]), /unmerged index/);
  await assert.rejects(prepareGitCommit(dir, ["a"], "staged"), /unmerged index/);
});

test("linked checkout has its own index and branch", async (t) => {
  const { root, dir } = await repo(t);
  const linked = path.join(root, "linked");
  await git(dir, "worktree", "add", "-q", "-b", "linked", linked);
  await writeFile(path.join(linked, "a"), "linked\n");
  const preview = await prepareGitCommit(linked, ["a"]);
  assert.equal(preview.branch, "refs/heads/linked");
  assert.equal((await confirmGitCommit(preview, "linked")).status, "committed");
  assert.equal(await git(dir, "show", "HEAD:a"), "first");
  assert.equal(await git(linked, "show", "HEAD:a"), "linked");
});

test("atomic ref compare-and-swap rejects a branch move during confirmation", { skip: process.platform === "win32" }, async (t) => {
  const { root, dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const wrapper = path.join(bin, "git");
  await writeFile(wrapper, `#!/usr/bin/env node\nconst { execFileSync } = require('node:child_process');\nconst args = process.argv.slice(2);\nconst real = ${JSON.stringify(realGit)};\nif (args.includes('update-ref')) {\n  const cwd = args[args.indexOf('-C') + 1];\n  const ref = args[args.indexOf('update-ref') + 1];\n  const old = args.at(-1);\n  const tree = execFileSync(real, ['-C', cwd, 'rev-parse', 'HEAD^{tree}'], {encoding:'utf8'}).trim();\n  const rival = execFileSync(real, ['-C', cwd, 'commit-tree', tree, '-p', old, '-m', 'rival'], {encoding:'utf8'}).trim();\n  execFileSync(real, ['-C', cwd, 'update-ref', ref, rival, old]);\n}\ntry { process.stdout.write(execFileSync(real, args)); }\ncatch (e) { process.stderr.write(e.stderr || ''); process.exit(e.status || 1); }\n`);
  await chmod(wrapper, 0o755);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    await assert.rejects(confirmGitCommit(preview, "ours"), /update-ref/);
  } finally { process.env.PATH = originalPath; }
  assert.equal(await git(dir, "log", "-1", "--format=%s"), "rival");
  assert.equal(await git(dir, "show", "HEAD:a"), "first");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  const index = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  await assert.rejects(readFile(`${index}.lock`), { code: "ENOENT" });
});

test("commit object must have the approved tree, parent and identity before moving the ref", { skip: process.platform === "win32" }, async (t) => {
  const { root, dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "approved\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const bin = path.join(root, "fake-git");
  await mkdir(bin);
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const wrapper = path.join(bin, "git");
  await writeFile(wrapper, `#!/usr/bin/env node\nconst {execFileSync} = require('node:child_process');\nconst args = process.argv.slice(2);\nconst real = ${JSON.stringify(realGit)};\nif (args.includes('commit-tree')) {\n  process.stdout.write(execFileSync(real, ['-C', args[args.indexOf('-C') + 1], 'rev-parse', 'HEAD']));\n} else {\n  try { process.stdout.write(execFileSync(real, args)); }\n  catch (e) { process.stderr.write(e.stderr || ''); process.exit(e.status || 1); }\n}\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    await assert.rejects(confirmGitCommit(preview, "refused"), /commit object differs/);
  } finally { process.env.PATH = oldPath; }
  assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
});

test("hooks, configured filters, signing and attribute filters refuse preview", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  const hook = path.join(dir, ".git", "hooks", "pre-commit");
  await mkdir(path.dirname(hook), { recursive: true });
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /hook policy/);
  await rm(hook);
  for (const [key, value] of [["filter.test.clean", "cat"], ["commit.gpgsign", "true"], ["core.hooksPath", "/tmp/hooks"]]) {
    await git(dir, "config", key, value);
    await assert.rejects(prepareGitCommit(dir, ["a"]), /unsupported Git policy/);
    await git(dir, "config", "--unset", key);
  }
  await writeFile(path.join(dir, ".gitattributes"), "a filter=magic\n");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /filter attribute/);
});
