import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync,
  utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-working-diff-context-"));
const isolated = {
  HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"),
  PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1",
};
const previous = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(isolated)) process.env[key] = value;
mkdirSync(isolated.HOME);
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { fsCache: false });
const { getGitFileDiff } = await jiti.import("./git-changes.ts");
const {
  captureWorkingDiff, getWorkingDiffContext, readWorkingDiffFile, workingDiffHead, workingFileDigest,
} = await jiti.import("./working-diff-context.ts");
const { MAX_DIFF_FILE_BYTES, MAX_DIFF_CONTEXT_LINES } = await jiti.import("./diff-context.ts");
// These are process-global hot-reload caches; keep quota/expiry cases independent.
beforeEach(() => globalThis[Symbol.for("brabbler:working-diff-context")].clear());
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
}).trim();
let sequence = 0;
function fixture({ unborn = false } = {}) {
  const cwd = join(root, `repo-${++sequence}`);
  mkdirSync(cwd);
  git(cwd, "init", "-qb", "main");
  git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "core.autocrlf", "false"); git(cwd, "config", "core.filemode", "true");
  if (!unborn) { writeFileSync(join(cwd, "file.txt"), "before\nunchanged context\n"); commit(cwd); }
  return cwd;
}
function commit(cwd) {
  git(cwd, "add", "--all"); git(cwd, "commit", "-qm", "fixture");
  return git(cwd, "rev-parse", "HEAD");
}
async function diff(cwd, name = "file.txt") {
  const filePath = join(cwd, name), result = await getGitFileDiff(cwd, filePath);
  assert.equal(result.supported, true, JSON.stringify(result));
  assert.match(result.revision, /^[0-9a-f]{64}$/);
  return { ...result, filePath, context: () => getWorkingDiffContext(cwd, filePath, result.revision) };
}
async function snapshot(cwd, name = "file.txt") {
  const filePath = join(cwd, name);
  return { cwd, root: cwd, filePath, gitPath: name, oldPath: name,
    head: await workingDiffHead(cwd), signature: workingFileDigest(readWorkingDiffFile(cwd, filePath)) };
}

// Shared Git blob/decoder and Explorer coverage lives in git-file-context.test.mjs.
// Here we exercise the working revision producer/consumer and filesystem identity.
test("a working revision binds complete HEAD/working text, not the index or a hunk preview", async () => {
  const cwd = fixture(), filePath = join(cwd, "file.txt");
  const old = Array.from({ length: 30 }, (_, index) => `context ${index}`).join("\n") + "\n";
  writeFileSync(filePath, old); commit(cwd);
  writeFileSync(filePath, old.replace("context 15\n", "staged only\n")); git(cwd, "add", "file.txt");
  const current = old.replace("context 15\n", "working edit\n"); writeFileSync(filePath, current);
  const value = await diff(cwd), context = await value.context();
  assert.equal(context.oldFile.contents, old); assert.equal(context.newFile.contents, current);
  assert.equal(context.oldFile.name, "file.txt"); assert.equal(context.newFile.name, "file.txt");
  assert.equal(context.newFile.cacheKey, `working:${value.revision}`);
  assert.ok(!value.patch.includes("context 0\n"), "The patch omits distant unchanged lines");
  assert.equal((await diff(cwd)).revision, value.revision);
  assert.deepEqual(await value.context(), context);
});

test("added, untracked, deleted and empty working sides remain distinct from absent sides", async () => {
  const cwd = fixture();
  writeFileSync(join(cwd, "added.txt"), "staged addition\n"); git(cwd, "add", "added.txt");
  writeFileSync(join(cwd, "untracked.txt"), "new, no final newline");
  writeFileSync(join(cwd, "empty.txt"), ""); writeFileSync(join(cwd, "file.txt"), "");
  for (const [name, status, contents] of [
    ["added.txt", "added", "staged addition\n"], ["untracked.txt", "untracked", "new, no final newline"],
    ["empty.txt", "untracked", ""],
  ]) {
    const value = await diff(cwd, name), context = await value.context();
    assert.equal(value.status, status); assert.equal(context.oldFile, null);
    assert.equal(context.newFile.contents, contents);
  }
  const empty = await diff(cwd); assert.equal((await empty.context()).newFile.contents, "");
  assert.equal((await empty.context()).oldFile.contents, "before\nunchanged context\n");
  rmSync(join(cwd, "file.txt"));
  const deleted = await diff(cwd), context = await deleted.context();
  assert.equal(deleted.status, "deleted"); assert.equal(context.newFile, null);
  assert.equal(context.oldFile.contents, "before\nunchanged context\n");
  writeFileSync(join(cwd, "file.txt"), "recreated\n");
  await assert.rejects(deleted.context(), { status: 409 });
});

test("an unborn repository supplies added/untracked context with an absent HEAD side", async () => {
  const cwd = fixture({ unborn: true });
  assert.equal(await workingDiffHead(cwd), null);
  writeFileSync(join(cwd, "added.txt"), "first staged file\n"); git(cwd, "add", "added.txt");
  writeFileSync(join(cwd, "untracked.txt"), "first untracked file\n");
  for (const name of ["added.txt", "untracked.txt"]) {
    const value = await diff(cwd, name), context = await value.context();
    assert.equal(context.oldFile, null); assert.ok(context.newFile.contents.startsWith("first "));
  }
});

test("a content-changing staged rename binds the source HEAD path and new working path", async () => {
  const cwd = fixture(), oldName = "file.txt", newName = ":(glob) renamed.txt";
  // Enough unchanged content for Git's rename detection.
  const old = "unchanged line\n".repeat(30) + "before\n";
  writeFileSync(join(cwd, oldName), old); commit(cwd);
  renameSync(join(cwd, oldName), join(cwd, newName));
  writeFileSync(join(cwd, newName), old.replace("before\n", "after\n")); git(cwd, "add", "--all");
  const value = await diff(cwd, newName), context = await value.context();
  assert.equal(value.status, "renamed"); assert.equal(context.oldFile.name, oldName);
  assert.equal(context.oldFile.contents, old); assert.equal(context.newFile.name, newName);
  assert.ok(context.newFile.contents.endsWith("after\n"));
});

test("revisions refuse another cwd/path, unknown IDs, unchanged files and repository escapes", async () => {
  const cwd = fixture(); writeFileSync(join(cwd, "file.txt"), "working edit\n");
  const value = await diff(cwd), other = fixture();
  for (const [requestedCwd, filePath, revision] of [
    [other, value.filePath, value.revision], [cwd, join(cwd, "other.txt"), value.revision],
    [cwd, value.filePath, "HEAD"], [cwd, value.filePath, "f".repeat(64)],
  ]) await assert.rejects(getWorkingDiffContext(requestedCwd, filePath, revision), { status: 409 });
  for (const path of [join(other, "file.txt"), join(cwd, "..", "outside.txt"), join(cwd, ".git", "config")]) {
    assert.deepEqual(await getGitFileDiff(cwd, path), { supported: false });
  }
  assert.deepEqual(await getGitFileDiff(other, join(other, "file.txt")), { supported: false });
});

test("same-length edits, inode replacement and mode changes invalidate a captured working file", async (t) => {
  for (const kind of ["content", "inode", "mode"]) await t.test(kind, async () => {
    const cwd = fixture(), filePath = join(cwd, "file.txt"); writeFileSync(filePath, "working edit\n");
    const value = await diff(cwd), before = lstatSync(filePath);
    if (kind === "content") { writeFileSync(filePath, "another edit\n"); utimesSync(filePath, before.atime, before.mtime); }
    if (kind === "inode") {
      const replacement = join(cwd, "replacement"); writeFileSync(replacement, "working edit\n");
      renameSync(replacement, filePath); assert.notEqual(lstatSync(filePath).ino, before.ino);
    }
    if (kind === "mode") chmodSync(filePath, 0o755);
    await assert.rejects(value.context(), { status: 409, message: /changed.*refresh/i });
  });
});

test("a changed HEAD invalidates context even if the working file and its contents did not change", async () => {
  const cwd = fixture(); writeFileSync(join(cwd, "file.txt"), "working edit\n");
  const value = await diff(cwd);
  git(cwd, "commit", "--allow-empty", "-qm", "advance HEAD without touching file");
  await assert.rejects(value.context(), { status: 409, message: /HEAD changed/ });
});

test("no-follow reads refuse live/dangling symlinks, directories and escaped parent directories", async () => {
  const cwd = fixture(), filePath = join(cwd, "file.txt"), outside = join(root, "outside.txt");
  writeFileSync(outside, "must not be followed\n");
  for (const [name, target] of [["internal", filePath], ["external", outside], ["dangling", join(root, "missing")]]) {
    const link = join(cwd, name); symlinkSync(target, link);
    assert.throws(() => readWorkingDiffFile(cwd, link), { status: 409 });
    assert.deepEqual(await getGitFileDiff(cwd, link), { supported: false });
  }
  assert.throws(() => readWorkingDiffFile(cwd, outside), { status: 403 });
  symlinkSync(root, join(cwd, "escape"), "dir");
  assert.throws(() => readWorkingDiffFile(cwd, join(cwd, "escape", "outside.txt")), { status: 403 });
  assert.throws(() => readWorkingDiffFile(cwd, join(cwd, "escape", "missing", "file.txt")), { status: 403 });
  assert.throws(() => readWorkingDiffFile(cwd, cwd), { status: 403 });
  mkdirSync(join(cwd, "directory"));
  assert.throws(() => readWorkingDiffFile(cwd, join(cwd, "directory")), { status: 409 });
  assert.equal(readWorkingDiffFile(cwd, join(cwd, "not-created", "missing.txt")), null);
  writeFileSync(filePath, "working edit\n"); const value = await diff(cwd);
  rmSync(filePath); symlinkSync(outside, filePath);
  await assert.rejects(value.context(), { status: 409 });
});

test("files swapped or removed between lstat and no-follow open yield a refresh-required conflict", async (t) => {
  for (const kind of ["symlink swap", "disappearance"]) await t.test(kind, async (st) => {
    const cwd = fixture(), filePath = join(cwd, "file.txt"); writeFileSync(filePath, "working edit\n");
    const value = await diff(cwd), outside = join(root, `race-target-${sequence}`);
    writeFileSync(outside, "must not be followed\n");
    const open = fs.openSync; let changed = false;
    st.mock.method(fs, "openSync", (requestedPath, flags, ...args) => {
      if (requestedPath === filePath && !changed) {
        changed = true;
        assert.ok(flags & fs.constants.O_NOFOLLOW, "The descriptor must be opened without following symlinks");
        renameSync(filePath, `${filePath}-saved`);
        if (kind === "symlink swap") symlinkSync(outside, filePath);
      }
      return open(requestedPath, flags, ...args);
    });
    await assert.rejects(value.context(), { status: 409, message: /changed|refresh/i });
    assert.equal(changed, true, "The deterministic swap reached the no-follow open");
  });
});

test("working context rechecks file identity after asynchronous immutable Git reads", async (t) => {
  const cwd = fixture(), filePath = join(cwd, "file.txt"); writeFileSync(filePath, "working edit\n");
  const value = await diff(cwd), lstat = fs.lstatSync;
  let reads = 0;
  t.mock.method(fs, "lstatSync", (requestedPath, ...args) => {
    if (requestedPath === filePath && ++reads === 3) writeFileSync(filePath, "changed during context read\n");
    return lstat(requestedPath, ...args);
  });
  // The first bounded read uses two lstats; mutate when the final verification
  // begins, after the old immutable side has been loaded asynchronously.
  await assert.rejects(value.context(), { status: 409, message: /changed.*refresh/i });
  assert.equal(reads, 4);
});

test("working reads enforce 1 MiB and reject invalid UTF-8 context instead of replacement text", async () => {
  assert.equal(MAX_DIFF_FILE_BYTES, 1024 * 1024);
  const cwd = fixture(), filePath = join(cwd, "file.txt");
  writeFileSync(filePath, Buffer.alloc(MAX_DIFF_FILE_BYTES, 120));
  assert.equal(readWorkingDiffFile(cwd, filePath).buffer.length, MAX_DIFF_FILE_BYTES);
  writeFileSync(filePath, Buffer.alloc(MAX_DIFF_FILE_BYTES + 1, 120));
  assert.throws(() => readWorkingDiffFile(cwd, filePath), { status: 413 });
  assert.deepEqual(await getGitFileDiff(cwd, filePath), { supported: false });
  writeFileSync(filePath, Buffer.from([0xff, 10]));
  const invalid = await diff(cwd); await assert.rejects(invalid.context(), { status: 409, message: /UTF-8/ });
  writeFileSync(filePath, Buffer.from([65, 0, 66]));
  assert.deepEqual(await getGitFileDiff(cwd, filePath), { supported: false });
});

test("working context enforces the 50,000 combined-line bound, not only each side's limit", async () => {
  assert.equal(MAX_DIFF_CONTEXT_LINES, 50_000);
  const cwd = fixture(), filePath = join(cwd, "file.txt"), old = "line\n".repeat(25_000);
  writeFileSync(filePath, old); commit(cwd);
  writeFileSync(filePath, "edit\n" + "line\n".repeat(24_999));
  const atLimit = await diff(cwd); assert.ok((await atLimit.context()).newFile);
  writeFileSync(filePath, "edit\n" + old);
  const overLimit = await diff(cwd); await assert.rejects(overLimit.context(), { status: 413 });
});

test("working revisions expire at one hour and a refreshed identical comparison is available again", async (t) => {
  const cwd = fixture(); writeFileSync(join(cwd, "file.txt"), "working edit\n");
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const value = await diff(cwd), created = now;
  now = created + 60 * 60 * 1000 - 1; assert.ok((await value.context()).newFile);
  now++; await assert.rejects(value.context(), { status: 409, message: /unavailable.*refresh/i });
  const refreshed = await diff(cwd); assert.equal(refreshed.revision, value.revision);
  assert.ok((await refreshed.context()).newFile);
});

test("the working cache retains only the latest 512 distinct revisions", async () => {
  const cwd = fixture(); writeFileSync(join(cwd, "file.txt"), "working edit\n");
  const value = await snapshot(cwd), revisions = [];
  for (let index = 0; index < 512; index++) revisions.push(captureWorkingDiff(value, `patch ${index}`));
  assert.ok((await getWorkingDiffContext(cwd, value.filePath, revisions[0])).newFile);
  // Recapturing the same revision must not evict a different entry.
  assert.equal(captureWorkingDiff(value, "patch 511"), revisions[511]);
  assert.ok((await getWorkingDiffContext(cwd, value.filePath, revisions[0])).newFile);
  captureWorkingDiff(value, "patch 512");
  await assert.rejects(getWorkingDiffContext(cwd, value.filePath, revisions[0]), { status: 409 });
  assert.ok((await getWorkingDiffContext(cwd, value.filePath, revisions[1])).newFile);
  assert.equal(globalThis[Symbol.for("brabbler:working-diff-context")].size, 512);
});
