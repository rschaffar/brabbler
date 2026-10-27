import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSubject(options = {}) {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url, options).import("./worktree.ts");
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

test("main and linked worktrees share one canonical project root", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "brabbler-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  const linked = path.join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Brabbler Test"]);
  await git(repo, ["config", "user.email", "brabbler-test@example.invalid"]);
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

test("merged status follows local main ancestry, not remote refs or branch names", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brabbler-worktree-merged-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const linked = path.join(root, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Brabbler Test"]);
  await git(repo, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repo, "README.md"), "start\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["branch", "-m", "main"]);
  await git(repo, ["worktree", "add", "-b", "feature/linked", linked]);
  const { listMergedWorktreeBranches } = await loadSubject();
  assert.ok((await listMergedWorktreeBranches(linked)).has("feature/linked"));

  await writeFile(path.join(linked, "feature.txt"), "change\n");
  await git(linked, ["add", "."]);
  await git(linked, ["commit", "-m", "feature"]);
  await git(repo, ["update-ref", "refs/remotes/origin/main", await git(linked, ["rev-parse", "HEAD"])]);
  assert.equal((await listMergedWorktreeBranches(repo)).has("feature/linked"), false);

  await git(repo, ["merge", "--no-ff", "--no-edit", "feature/linked"]);
  assert.ok((await listMergedWorktreeBranches(linked)).has("feature/linked"));
  await git(repo, ["branch", "-m", "main", "renamed-main"]);
  assert.equal((await listMergedWorktreeBranches(repo)).size, 0);
});

test("creation requires a clean checkout, explicit local base and full matching HEAD; attach requires captured tip", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brabbler-worktree-create-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Brabbler Test"]);
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
  let rechecked = 0;
  await assert.rejects(addWorktree(repo, { ...opts, branch: "feature/revoked", beforeCreate: async () => {
    rechecked++;
    throw new Error("live settings revoked before creation");
  } }), /settings revoked/);
  assert.equal(rechecked, 1, "a failed late admission must not create the checkout or branch");
  assert.equal(await git(repo, ["branch", "--list", "feature/revoked"]), "");
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

async function fencedHelperFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "worktree-dispatch-fence-")); t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"); await execFileAsync("git", ["init", "-qb", "main", repo]);
  await git(repo, ["config", "user.name", "Fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(repo, "tracked"), "tracked fixture\n"); await git(repo, ["add", "tracked"]); await git(repo, ["commit", "-qm", "base"]);
  const options = { branch: "feature", baseBranch: "main", expectedBaseOid: await git(repo, ["rev-parse", "HEAD"]), mode: "create" };
  const snapshot = async () => ({ refs: await git(repo, ["show-ref"]), worktrees: await git(repo, ["worktree", "list", "--porcelain"]),
    index: (await readFile(path.join(repo, ".git", "index"))).toString("hex") });
  return { repo, options, snapshot, parent: `${repo}-worktrees` };
}

test("synchronous original guard protects mkdir and rejects async/non-void guards without index/ref/worktree effects", async t => {
  const { addWorktree } = await loadSubject();
  for (const mode of ["revoked", "async", "non-void"]) await t.test(mode, async t => {
    const f = await fencedHelperFixture(t), before = await f.snapshot();
    // A stat-refresh candidate proves preflight status itself does not write the index.
    await utimes(path.join(f.repo, "tracked"), new Date(1_000_000), new Date(1_000_000));
    const assertCurrentSync = mode === "revoked" ? () => { throw new Error("original authority revoked"); }
      : mode === "async" ? async () => {} : () => "not a synchronous void assertion";
    await assert.rejects(addWorktree(f.repo, { ...f.options, assertCurrentSync }), /revoked|synchronous void postguard/);
    assert.equal(existsSync(f.parent), false); assert.deepEqual(await f.snapshot(), before);
  });
});

test("dispatch guard runs AFTER environment construction; known parent creation is reported honestly on later revocation", async t => {
  const { addWorktree, WorktreeMutationError } = await loadSubject(), f = await fencedHelperFixture(t), before = await f.snapshot();
  const originalEnv = process.env; let revoked = false, environmentObserved = false;
  process.env = new Proxy(originalEnv, { ownKeys(target) {
    if (existsSync(f.parent)) { environmentObserved = true; revoked = true; }
    return Reflect.ownKeys(target);
  } });
  let cause;
  try {
    await addWorktree(f.repo, { ...f.options, assertCurrentSync() { if (revoked) throw new Error("revoked at options construction"); } });
  } catch (error) { cause = error; }
  finally { process.env = originalEnv; }
  assert.equal(environmentObserved, true); assert.ok(cause instanceof WorktreeMutationError); assert.match(cause.message, /revoked at options construction/);
  assert.deepEqual(cause.effects, { operation: "add", parentPath: f.parent, parentCreationAttempted: true, parentCreated: true, gitDispatchAttempted: false });
  assert.equal(existsSync(f.parent), true); assert.deepEqual(await f.snapshot(), before);
  // No rollback or hidden retry; an explicit ordinary caller remains compatible.
  const made = await addWorktree(f.repo, f.options); assert.equal(await git(made.path, ["rev-parse", "HEAD"]), f.options.expectedBaseOid);
});

test("a late mkdir error preserves unknown parent outcome without claiming no effects or dispatching Git", async t => {
  const f = await fencedHelperFixture(t), before = await f.snapshot();
  const mkdir = fs.mkdirSync;
  const mocked = t.mock.method(fs, "mkdirSync", (...args) => {
    const result = mkdir(...args);
    if (args[0] === f.parent) throw Object.assign(new Error("late mkdir acknowledgement failure"), { code: "EIO" });
    return result;
  });
  syncBuiltinESMExports();
  try {
    const { addWorktree, WorktreeMutationError } = await loadSubject({ moduleCache: false });
    await assert.rejects(addWorktree(f.repo, { ...f.options, assertCurrentSync() {} }), cause => {
      assert.ok(cause instanceof WorktreeMutationError);
      assert.deepEqual(cause.effects, { operation: "add", parentPath: f.parent, parentCreationAttempted: true, parentCreated: null, gitDispatchAttempted: false });
      return true;
    });
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(existsSync(f.parent), true); assert.deepEqual(await f.snapshot(), before);
});

test("remove retains original target/marker identity through awaited policy and performs a no-yield final guard", async t => {
  const { addWorktree, removeWorktree } = await loadSubject();
  for (const mode of ["revoked", "replaced-marker", "environment", "async"]) await t.test(mode, async t => {
    const f = await fencedHelperFixture(t), made = await addWorktree(f.repo, f.options), before = await f.snapshot();
    let revoked = false, environmentArmed = false, environmentObserved = false;
    const originalEnv = process.env;
    if (mode === "environment") process.env = new Proxy(originalEnv, { ownKeys(target) {
      if (environmentArmed) { environmentObserved = true; revoked = true; }
      return Reflect.ownKeys(target);
    } });
    try {
      await assert.rejects(removeWorktree(f.repo, made.path, false, {
        beforeRemove: async () => {
          if (mode === "revoked") revoked = true;
          if (mode === "replaced-marker") {
            const marker = path.join(made.path, ".git"), bytes = await readFile(marker);
            await rename(marker, `${marker}.original`); await writeFile(marker, bytes);
          }
          environmentArmed = true;
        },
        assertCurrentSync: mode === "async" ? async () => {} : () => { if (revoked) throw new Error("original remove revoked"); },
      }), /revoked|physical path changed|synchronous void postguard/);
    } finally { process.env = originalEnv; }
    if (mode === "environment") assert.equal(environmentObserved, true);
    if (mode === "replaced-marker") { await rm(path.join(made.path, ".git")); await rename(path.join(made.path, ".git.original"), path.join(made.path, ".git")); }
    assert.equal(existsSync(made.path), true); assert.deepEqual(await f.snapshot(), before);
    await removeWorktree(f.repo, made.path); assert.equal(existsSync(made.path), false, "unguarded ordinary caller remains supported");
  });
});

test("final synchronous owner callbacks cannot replace helper repo/parent/target after physical validation", async t => {
  const { addWorktree, removeWorktree, WorktreeMutationError } = await loadSubject();
  for (const mode of ["add-repo", "add-parent", "remove-source", "remove-target"]) await t.test(mode, async t => {
    const f = await fencedHelperFixture(t), removing = mode.startsWith("remove"), made = removing ? await addWorktree(f.repo, f.options) : undefined;
    const before = await f.snapshot(); let calls = 0, switched = false;
    const target = mode === "add-parent" ? f.parent : mode === "remove-target" ? made.path : f.repo;
    const replacement = `${target}-replacement`, parked = `${target}-parked`;
    if (mode !== "add-parent") fs.cpSync(target, replacement, { recursive: true });
    const assertCurrentSync = () => {
      calls++; if (calls !== (removing ? 1 : 2)) return;
      switched = true; fs.renameSync(target, parked);
      if (mode === "add-parent") fs.mkdirSync(target); else fs.renameSync(replacement, target);
    };
    try {
      await assert.rejects(removing ? removeWorktree(f.repo, made.path, false, { assertCurrentSync })
        : addWorktree(f.repo, { ...f.options, assertCurrentSync }), cause => {
        assert.match(cause.message, /physical path changed/);
        if (!removing) {
          assert.ok(cause instanceof WorktreeMutationError);
          assert.equal(cause.effects.parentCreated, true); assert.equal(cause.effects.gitDispatchAttempted, false);
        }
        return true;
      });
    } finally {
      if (switched) { fs.renameSync(target, replacement); fs.renameSync(parked, target); }
    }
    assert.equal(switched, true); assert.deepEqual(await f.snapshot(), before);
    if (removing) assert.equal(existsSync(made.path), true);
    else assert.equal(existsSync(f.parent), true, "known mkdir is preserved, never rolled back or called no-effect");
  });
});

test("a policy edit after successful Git dispatch never turns a completed mutation into a refusal", async t => {
  const { addWorktree, removeWorktree } = await loadSubject(), f = await fencedHelperFixture(t);
  let revoked = false, calls = 0;
  const assertCurrentSync = () => { if (revoked) throw new Error("late revocation"); calls++; if (calls === 2) queueMicrotask(() => { revoked = true; }); };
  const made = await addWorktree(f.repo, { ...f.options, assertCurrentSync });
  assert.equal(revoked, true); assert.equal(await git(made.path, ["branch", "--show-current"]), "feature");
  revoked = false;
  await removeWorktree(f.repo, made.path, false, { assertCurrentSync() {
    assert.equal(revoked, false); queueMicrotask(() => { revoked = true; });
  } });
  assert.equal(revoked, true); assert.equal(existsSync(made.path), false);
});
