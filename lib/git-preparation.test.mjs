import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const { preflightGitPreparation } = await createJiti(import.meta.url).import("./git-preparation.ts");
const { allowFileRoot } = await createJiti(import.meta.url).import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await createJiti(import.meta.url).import("./git-workflow-settings-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t, upstream = true) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-preflight-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent");
  mkdirSync(join(agentDir, "pi-web"), { recursive: true, mode: 0o700 });
  git(home, "init", "-q", "-b", "main", main);
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "file"), "base\n");
  git(main, "add", "file"); git(main, "commit", "-qm", "base");
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
    await f.blocked(kind === "detached" ? "unavailable" : "shared");
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
