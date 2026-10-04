import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const { preflightGitPreparation, verifyGitPreparationTrackedContents, GIT_PREPARATION_TRACKED_CONTENT_LIMITS } =
  await createJiti(import.meta.url).import("./git-preparation.ts");
const { selectCanonicalGitResources, withGitProjectReview } = await createJiti(import.meta.url).import("./git-project-resources.ts");
const { allowFileRoot } = await createJiti(import.meta.url).import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await createJiti(import.meta.url).import("./git-workflow-settings-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t, upstream = true, { unchanged = false, symlink = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-preflight-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent");
  mkdirSync(join(agentDir, "pi-web"), { recursive: true, mode: 0o700 });
  git(home, "init", "-q", "-b", "main", main);
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "file"), "base\n");
  if (unchanged) writeFileSync(join(main, "unchanged"), "stable\n");
  if (symlink) symlinkSync("file", join(main, "tracked-link"));
  git(main, "add", "."); git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-qb", "feature", feature);
  writeFileSync(join(feature, "file"), "feature\n");
  git(feature, "add", "file"); git(feature, "commit", "-qm", "feature");
  if (upstream) {
    writeFileSync(join(main, "upstream"), "upstream\n");
    git(main, "add", "upstream"); git(main, "commit", "-qm", "upstream");
  }
  allowFileRoot(main); allowFileRoot(feature);
  const saveMain = (name) => writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {},
    projects: { [main]: { mainBranch: name } } }, agentDir);
  saveMain("main");
  const request = { source: { repositoryPath: main, checkoutPath: feature },
    target: { repositoryPath: main, checkoutPath: main }, mainBranch: "main" };
  const read = () => preflightGitPreparation(request, agentDir);
  const blocked = async (code) => assert.rejects(read(), (e) => e.code === code);
  return { home, main, feature, agentDir, request, read, blocked, saveMain };
}

test("private divergent feature returns bounded physical, exact, read-only evidence (not publication proof)", async (t) => {
  const f = fixture(t);
  const before = [git(f.feature, "rev-parse", "HEAD"), git(f.main, "rev-parse", "HEAD")];
  const s = await f.read();
  assert.equal(s.status, "needs-rebase");
  assert.equal(s.source.cwd, f.feature);
  assert.equal(s.target.cwd, f.main);
  assert.equal(s.source.ref, "refs/heads/feature");
  assert.equal(s.source.oid, before[0]);
  assert.equal(s.target.oid, before[1]);
  assert.equal(s.designatedMain.oid, before[1]);
  assert.equal(s.mergeBaseOid, git(f.main, "merge-base", "feature", "main"));
  assert.deepEqual(s.rewriteSeries.map((c) => c.oid), [before[0]]);
  assert.equal(s.rewriteSeries[0].parentOid, s.mergeBaseOid);
  assert.equal(s.source.clean, true);
  assert.equal(s.target.indexFlags, "ordinary");
  assert.deepEqual(s.target.operationMarkers, []);
  assert.deepEqual(s.localSharedRefs, []);
  assert.deepEqual(s.localRefs.map((r) => r.ref), ["refs/heads/feature", "refs/heads/main"]);
  assert.equal(s.publication, "unknown-outside-local-repository");
  assert.deepEqual([git(f.feature, "rev-parse", "HEAD"), git(f.main, "rev-parse", "HEAD")], before);
  assert.equal(existsSync(join(f.feature, ".git", "index.lock")), false);
});

async function physicalRead(f, cwd = f.feature, options = {}) {
  const selection = await selectCanonicalGitResources({ repositoryPath: f.main, checkoutPath: cwd });
  const tree = git(cwd, "rev-parse", "HEAD^{tree}");
  return withGitProjectReview(selection, (repo) => verifyGitPreparationTrackedContents(repo, tree, options));
}

test("physical tracked verification catches unchanged same-length cached-clean bytes with trustctime=false/checkstat=minimal", async (t) => {
  for (const where of ["feature", "main"]) {
    const f = fixture(t, true, { unchanged: true }), cwd = f[where], path = join(cwd, "unchanged");
    git(f.main, "config", "core.trustctime", "false"); git(f.main, "config", "core.checkstat", "minimal");
    const old = new Date("2001-01-01T00:00:00Z");
    utimesSync(path, old, old); git(cwd, "update-index", "--refresh");
    assert.equal(git(cwd, "status", "--porcelain=v1"), "");
    assert.equal(git(cwd, "show", "HEAD:unchanged"), "stable");
    const index = readFileSync(git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index"));
    writeFileSync(path, "hidden\n"); utimesSync(path, old, old);
    assert.equal(readFileSync(path, "utf8"), "hidden\n");
    assert.equal(statSync(path).mtimeMs, old.getTime());
    assert.equal(git(cwd, "status", "--porcelain=v1"), "", "demonstrate the clean Git stat-cache lie");
    assert.equal(git(cwd, "diff-files", "--name-only"), "");
    assert.deepEqual(readFileSync(git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index")), index);
    await assert.rejects(physicalRead(f, cwd), (error) => error.code === "dirty");
    await f.blocked("dirty");
    assert.equal(readFileSync(path, "utf8"), "hidden\n", "read-only verification does not repair user bytes");
  }
});

test("physical tracked helper verifies raw blob/mode/index including symlink target bytes, never the referent", async (t) => {
  const f = fixture(t, true, { symlink: true });
  const outside = join(f.home, "outside"), link = join(f.feature, "external-link");
  writeFileSync(outside, "not a tracked blob\n");
  symlinkSync(outside, link); git(f.feature, "add", "external-link"); git(f.feature, "commit", "-qm", "external symlink target bytes only");
  const index = readFileSync(git(f.feature, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const proof = await physicalRead(f);
  assert.equal(proof.treeOid, git(f.feature, "rev-parse", "HEAD^{tree}"));
  assert.equal(proof.fileCount, 3);
  assert.equal(proof.digest.length, 64);
  assert.equal(proof.indexDigest.length, 64);
  writeFileSync(outside, "different outside bytes do not change a symlink blob\n");
  assert.deepEqual(await physicalRead(f), proof);
  assert.deepEqual(readFileSync(git(f.feature, "rev-parse", "--path-format=absolute", "--git-path", "index")), index);
  assert.equal(readlinkSync(link), outside);
  rmSync(join(f.feature, "tracked-link")); symlinkSync("fail", join(f.feature, "tracked-link"));
  await assert.rejects(physicalRead(f), (error) => error.code === "dirty");
  assert.equal(readlinkSync(join(f.feature, "tracked-link")), "fail");
});

test("physical tracked helper refuses mode lies, hardlinks, FIFO, missing files and substituted symlink parents", async (t) => {
  for (const kind of ["mode", "hardlink", "fifo", "missing", "parent-symlink"]) {
    const f = fixture(t), path = join(f.feature, "file");
    if (kind === "mode") {
      git(f.main, "config", "core.fileMode", "false");
      chmodSync(path, 0o755);
      assert.equal(git(f.feature, "status", "--porcelain=v1"), "");
    } else if (kind === "hardlink") linkSync(path, join(f.home, "linked-copy"));
    else if (kind === "fifo") { rmSync(path); execFileSync("mkfifo", [path]); }
    else if (kind === "missing") rmSync(path);
    else {
      const dir = join(f.feature, "tracked-dir"); mkdirSync(dir);
      writeFileSync(join(dir, "nested"), "nested\n"); git(f.feature, "add", "."); git(f.feature, "commit", "-qm", "nested");
      renameSync(dir, join(f.home, "renamed-dir")); symlinkSync(join(f.home, "renamed-dir"), dir);
    }
    await assert.rejects(physicalRead(f));
  }
});

test("physical tracked helper rejects unbound paths, wrong index/tree, and bounded oversized file/union inventories", async (t) => {
  const f = fixture(t);
  const tree = git(f.feature, "rev-parse", "HEAD^{tree}"), selection = await selectCanonicalGitResources(f.request.source);
  await assert.rejects(verifyGitPreparationTrackedContents(selection, tree), (error) => error.code === "unavailable");
  await withGitProjectReview(selection, async (repo) => {
    await assert.rejects(verifyGitPreparationTrackedContents(repo, git(f.main, "rev-parse", "main^{tree}")), (error) => error.code === "dirty");
  });
  writeFileSync(join(f.feature, "oversized"), Buffer.alloc(GIT_PREPARATION_TRACKED_CONTENT_LIMITS.fileBytes + 1, 0x61));
  git(f.feature, "add", "."); git(f.feature, "commit", "-qm", "oversized tracked blob");
  await assert.rejects(physicalRead(f), (error) => error.code === "oversized");
  const u = fixture(t);
  for (let i = 0; i < 9; i++) writeFileSync(join(u.feature, `bounded-${i}`), Buffer.alloc(GIT_PREPARATION_TRACKED_CONTENT_LIMITS.fileBytes, 0x62));
  git(u.feature, "add", "."); git(u.feature, "commit", "-qm", "oversized tracked union");
  await assert.rejects(physicalRead(u), (error) => error.code === "oversized");
});

test("physical tracked old/new union rejects an ignored leftover removed path and handles path type transitions", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.feature, "removed"), "old tracked\n");
  mkdirSync(join(f.feature, "directory")); writeFileSync(join(f.feature, "directory", "child"), "child\n");
  git(f.feature, "add", "."); git(f.feature, "commit", "-qm", "old tree");
  const previousTreeOid = git(f.feature, "rev-parse", "HEAD^{tree}");
  git(f.feature, "rm", "-q", "removed", "directory/child");
  writeFileSync(join(f.feature, "directory"), "now a regular file\n");
  writeFileSync(join(f.feature, ".gitignore"), "removed\n");
  git(f.feature, "add", "."); git(f.feature, "commit", "-qm", "new tree");
  await physicalRead(f, f.feature, { previousTreeOid });
  writeFileSync(join(f.feature, "removed"), "ignored leftover\n");
  assert.equal(git(f.feature, "status", "--porcelain=v1"), "");
  await physicalRead(f); // no claim about arbitrary ignored files outside the tracked union
  await assert.rejects(physicalRead(f, f.feature, { previousTreeOid }), (error) => error.code === "dirty");
  assert.equal(readFileSync(join(f.feature, "removed"), "utf8"), "ignored leftover\n");
});

test("designated main cannot be source, and designation cannot be guessed from target", async (t) => {
  const f = fixture(t);
  f.request.source = { repositoryPath: f.main, checkoutPath: f.main };
  f.request.target = { repositoryPath: f.main, checkoutPath: f.feature };
  await f.blocked("main-source");
  f.request.mainBranch = "feature"; // a forged designation cannot make the actual saved main eligible
  await f.blocked("invalid-selection");
  delete f.request.mainBranch;
  await f.blocked("main-source");
  f.saveMain(null);
  await f.blocked("missing-main");
  f.saveMain("main");
  f.request.mainBranch = "not-a-branch";
  await f.blocked("invalid-selection");
});

test("a registered third-branch target cannot substitute for saved main", async (t) => {
  const f = fixture(t);
  git(f.main, "switch", "-qc", "third");
  f.request.target.checkoutPath = f.main;
  await f.blocked("invalid-selection");
  f.request.mainBranch = "third"; // caller cannot forge a new designation
  await f.blocked("invalid-selection");
});

test("a local tag, other branch, remote-tracking ref or main containing rewritten commits blocks", async (t) => {
  for (const kind of ["tag", "annotated", "branch", "remote", "main"]) {
    const f = fixture(t);
    const tip = git(f.feature, "rev-parse", "HEAD");
    if (kind === "tag") git(f.main, "tag", "published", tip);
    if (kind === "annotated") git(f.main, "tag", "-am", "published", "published", tip);
    if (kind === "branch") git(f.main, "branch", "other", tip);
    if (kind === "remote") git(f.main, "update-ref", "refs/remotes/origin/feature", tip);
    if (kind === "main") git(f.main, "merge", "-q", "--no-ff", "-m", "share", "feature");
    await f.blocked(kind === "main" ? "history" : "shared");
  }
});

test("detached third checkout, target-private ref and historical remote-tracking tip block", async (t) => {
  for (const kind of ["detached", "private", "remote-log"]) {
    const f = fixture(t);
    const tip = git(f.feature, "rev-parse", "HEAD");
    if (kind === "detached") git(f.main, "worktree", "add", "-q", "--detach", join(f.home, "detached"), tip);
    if (kind === "private") git(f.main, "update-ref", "refs/worktree/held", tip);
    if (kind === "remote-log") {
      git(f.main, "update-ref", "--create-reflog", "refs/remotes/origin/feature", tip);
      git(f.main, "update-ref", "refs/remotes/origin/feature", git(f.main, "rev-parse", "HEAD~1"));
    }
    await f.blocked("shared");
  }
});

test("main plus two/three features inventories unrelated active/dirty worktrees without cleanliness inference", async (t) => {
  for (const count of [2, 3]) {
    const f = fixture(t);
    for (let i = 2; i <= count; i++) {
      const cwd = join(f.home, `feature${i}`);
      git(f.main, "worktree", "add", "-qb", `feature${i}`, cwd, "main~1");
      writeFileSync(join(cwd, `own${i}`), `own ${i}\n`);
      git(cwd, "add", "."); git(cwd, "commit", "-qm", `own ${i}`);
      writeFileSync(join(cwd, "file"), "unrelated dirty work\n");
      writeFileSync(join(cwd, "untracked"), "keep\n");
      mkdirSync(join(git(cwd, "rev-parse", "--absolute-git-dir"), "rebase-merge"));
    }
    const snapshot = await f.read();
    assert.equal(snapshot.status, "needs-rebase");
    assert.equal(snapshot.registeredWorktrees.length, count + 1);
    assert.equal(snapshot.registeredWorktrees.every((row) => row.identities.git.inode && row.metadataDigest.length === 64), true);
    assert.deepEqual(snapshot.localSharedRefs, []);
    assert.equal(snapshot.source.clean, true);
    assert.equal(snapshot.target.clean, true);
    const detached = join(f.home, "detached");
    git(f.main, "worktree", "add", "-q", "--detach", detached, "main~1");
    assert.equal((await f.read()).registeredWorktrees.find((row) => row.cwd === detached).headRef, null);
  }
});

test("additional private refs and historical detached HEAD sharing block, including no current holder", async (t) => {
  for (const kind of ["private", "historical"]) {
    const f = fixture(t), cwd = join(f.home, "extra"), tip = git(f.feature, "rev-parse", "HEAD");
    git(f.main, "worktree", "add", "-q", "--detach", cwd, kind === "historical" ? tip : "main~1");
    if (kind === "private") git(cwd, "update-ref", "refs/worktree/held", tip);
    else git(cwd, "checkout", "-q", "--detach", "main~1");
    await f.blocked("shared");
  }
});

test("missing/nonphysical/unknown additional inventory fails closed", async (t) => {
  for (const kind of ["missing", "head", "registration", "unknown"]) {
    const f = fixture(t), cwd = join(f.home, "extra");
    git(f.main, "worktree", "add", "-qb", "extra", cwd, "main~1");
    const admin = git(cwd, "rev-parse", "--absolute-git-dir");
    if (kind === "missing") rmSync(cwd, { recursive: true });
    if (kind === "head") writeFileSync(join(admin, "HEAD"), "unknown HEAD\n");
    if (kind === "registration") writeFileSync(join(admin, "commondir"), "/unreadable/foreign\n");
    if (kind === "unknown") mkdirSync(join(f.main, ".git", "worktrees", "unlisted"));
    await assert.rejects(f.read(), (error) => ["unavailable", "ref-moved"].includes(error.code));
  }
});

test("complete native worktree listing refuses more than 256 registrations or 128 KiB, never truncates", async (t) => {
  for (const kind of ["count", "bytes"]) {
    const f = fixture(t), base = git(f.main, "rev-parse", "HEAD~1");
    for (let i = 0; i < (kind === "count" ? 255 : 36); i++) {
      const admin = join(f.main, ".git", "worktrees", `bounded${i}`);
      mkdirSync(admin);
      const path = kind === "count" ? join(f.home, `absent${i}`)
        : join(f.home, ...Array.from({ length: 16 }, () => "x".repeat(240)), `absent${i}`);
      writeFileSync(join(admin, "HEAD"), `${base}\n`);
      writeFileSync(join(admin, "gitdir"), `${join(path, ".git")}\n`);
      writeFileSync(join(admin, "commondir"), "../..\n");
    }
    const listing = execFileSync("git", ["-C", f.main, "worktree", "list", "--porcelain", "-z"]);
    if (kind === "bytes") assert.ok(listing.length > 128 * 1024);
    else assert.equal(listing.toString().split("\0").filter((field) => field.startsWith("worktree ")).length, 257);
    await f.blocked("unavailable");
  }
});

test("changed source/target refs, invalid selection, and changed main block", async (t) => {
  const f = fixture(t);
  f.request.expectedSourceOid = git(f.feature, "rev-parse", "HEAD");
  f.request.expectedTargetOid = git(f.main, "rev-parse", "HEAD");
  git(f.feature, "commit", "--allow-empty", "-qm", "new feature");
  await f.blocked("ref-moved");
  f.request.expectedSourceOid = git(f.feature, "rev-parse", "HEAD");
  git(f.main, "commit", "--allow-empty", "-qm", "new target");
  await f.blocked("ref-moved");
  f.request.expectedTargetOid = git(f.main, "rev-parse", "HEAD");
  f.request.target.checkoutPath = f.feature;
  await f.blocked("invalid-selection");
});

test("dirty staged, untracked, unusual index flags, locks and operation markers block either checkout", async (t) => {
  for (const where of ["feature", "main"]) for (const state of ["dirty", "untracked", "staged", "flag", "lock", "marker", "marker-link"]) {
    const f = fixture(t), cwd = f[where];
    if (state === "dirty") writeFileSync(join(cwd, "file"), "dirty\n");
    if (state === "untracked" || state === "staged") {
      writeFileSync(join(cwd, "new"), "new\n");
      if (state === "staged") git(cwd, "add", "new");
    }
    if (state === "flag") git(cwd, "update-index", "--assume-unchanged", "file");
    if (state === "lock" || state.startsWith("marker")) {
      const dir = git(cwd, "rev-parse", "--absolute-git-dir");
      if (state === "lock") writeFileSync(join(dir, "index.lock"), "");
      else if (state === "marker") mkdirSync(join(dir, "rebase-merge"));
      else {
        const { symlinkSync } = await import("node:fs");
        symlinkSync(join(f.home, "missing"), join(dir, "MERGE_HEAD"));
      }
    }
    await f.blocked(state === "flag" ? "unsupported-index" : state === "lock" || state.startsWith("marker") ? "operation" : "dirty");
  }
});

test("configured status filters are refused without executing them", async (t) => {
  const f = fixture(t);
  const marker = join(f.home, "filter-ran");
  git(f.main, "config", "filter.untrusted.clean", `sh -c 'touch "${marker}"'`);
  await f.blocked("unavailable");
  assert.equal(existsSync(marker), false);
});

test("nonlinear feature history blocks", async (t) => {
  const f = fixture(t);
  git(f.feature, "branch", "side");
  git(f.feature, "switch", "side");
  writeFileSync(join(f.feature, "side"), "side\n");
  git(f.feature, "add", "side"); git(f.feature, "commit", "-qm", "side");
  git(f.feature, "switch", "feature");
  git(f.feature, "commit", "--allow-empty", "-qm", "more");
  git(f.feature, "merge", "-q", "--no-ff", "-m", "nonlinear", "side");
  await f.blocked("history");
});

test("target merge topology and shallow history block", async (t) => {
  const f = fixture(t);
  git(f.main, "branch", "side", "HEAD~1");
  git(f.main, "switch", "side");
  writeFileSync(join(f.main, "side"), "side\n");
  git(f.main, "add", "side"); git(f.main, "commit", "-qm", "side");
  git(f.main, "switch", "main");
  git(f.main, "merge", "-q", "--no-ff", "-m", "side merge", "side");
  await f.blocked("history");
  const base = git(f.feature, "merge-base", "feature", "main");
  writeFileSync(join(f.main, ".git", "shallow"), `${base}\n`);
  await f.blocked("shallow");
});

test("oversized source history is refused, never truncated", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 201; i++) git(f.feature, "commit", "--allow-empty", "-qm", `feature ${i}`);
  await f.blocked("oversized");
});

test("already prepared is a truthful no-op without a rewrite series", async (t) => {
  const f = fixture(t, false);
  const s = await f.read();
  assert.equal(s.status, "already-prepared");
  assert.deepEqual(s.rewriteSeries, []);
  assert.equal(s.mergeBaseOid, s.target.oid);
  assert.equal(s.localRefs.length, 2);
});
