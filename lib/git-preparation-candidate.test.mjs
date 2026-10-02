import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { preflightGitPreparation } = await jiti.import("./git-preparation.ts");
const { planGitPreparationCandidate } = await jiti.import("./git-preparation-candidate.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t, { upstream = true, conflict = false, equivalent = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-candidate-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent");
  mkdirSync(join(agentDir, "pi-web"), { recursive: true, mode: 0o700 });
  git(home, "init", "-q", "-b", "main", main);
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "base"), "base\n");
  git(main, "add", "base"); git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-qb", "feature", feature);
  writeFileSync(join(feature, conflict ? "base" : "feature"), "feature\n");
  git(feature, "add", "."); git(feature, "commit", "-qm", "feature");
  if (upstream) {
    writeFileSync(join(main, conflict ? "base" : equivalent ? "feature" : "upstream"), equivalent ? "feature\n" : "upstream\n");
    git(main, "add", "."); git(main, "commit", "-qm", "upstream");
  }
  allowFileRoot(main); allowFileRoot(feature);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [main]: { mainBranch: "main" } } }, agentDir);
  const request = { source: { repositoryPath: main, checkoutPath: feature }, target: { repositoryPath: main, checkoutPath: main } };
  const preflight = () => preflightGitPreparation(request, agentDir);
  const plan = (snapshot) => planGitPreparationCandidate(snapshot, agentDir);
  const state = () => ({ source: git(feature, "rev-parse", "HEAD"), target: git(main, "rev-parse", "HEAD"),
    sourceStatus: git(feature, "status", "--porcelain=v1"), targetStatus: git(main, "status", "--porcelain=v1"),
    sourceIndex: readFileSync(git(feature, "rev-parse", "--git-path", "index")),
    targetIndex: readFileSync(join(main, ".git", "index")),
    refs: git(main, "for-each-ref", "--format=%(refname) %(objectname)"),
    loose: git(main, "count-objects", "-v").split("\n")[0] });
  return { main, feature, home, preflight, plan, state };
}

// Object creation may reuse an existing reachable OID; this planner never changes worktrees, refs or indexes.
function unchanged(a, b) { assert.deepEqual({ ...a, loose: undefined }, { ...b, loose: undefined }); }

test("clean linear series creates candidate commits without moving the source or target", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.feature, "second"), "second\n");
  git(f.feature, "add", "second"); git(f.feature, "commit", "-qm", "second");
  const before = f.state(), snapshot = await f.preflight();
  const candidate = await f.plan(snapshot);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.oldSourceOid, before.source);
  assert.equal(candidate.targetOid, before.target);
  assert.equal(candidate.comparison.commits.length, 2);
  assert.deepEqual(candidate.comparison.commits.map((c) => c.oldOid), snapshot.rewriteSeries.map((c) => c.oid));
  assert.deepEqual(candidate.comparison.commits.map((c) => c.emptyAfterReplay), [false, false]);
  assert.equal(candidate.newSourceOid, candidate.comparison.newTipOid);
  assert.equal(candidate.comparison.newBaseOid, before.target);
  assert.equal(git(f.main, "rev-list", "--parents", "-n1", candidate.comparison.commits[0].newOid).split(" ")[1], before.target);
  assert.equal(git(f.main, "rev-list", "--parents", "-n1", candidate.newSourceOid).split(" ")[1], candidate.comparison.commits[0].newOid);
  assert.equal(git(f.main, "show", `${candidate.newSourceOid}:second`), "second");
  unchanged(before, f.state());
});

test("content-equivalent replay preserves an empty commit and subsequent first-parent work", async (t) => {
  const f = fixture(t, { equivalent: true });
  writeFileSync(join(f.feature, "second"), "second\n");
  git(f.feature, "add", "second"); git(f.feature, "commit", "-qm", "second");
  const before = f.state(), snapshot = await f.preflight();
  const candidate = await f.plan(snapshot);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.oldSourceOid, before.source);
  assert.equal(candidate.targetOid, before.target);
  assert.equal(candidate.comparison.commits.length, 2);
  const [empty, next] = candidate.comparison.commits;
  assert.deepEqual(candidate.comparison.commits.map((c) => c.oldOid), snapshot.rewriteSeries.map((c) => c.oid));
  assert.equal(empty.emptyAfterReplay, true);
  assert.equal(next.emptyAfterReplay, false);
  assert.equal(empty.newTreeOid, git(f.main, "rev-parse", `${before.target}^{tree}`));
  assert.equal(git(f.main, "rev-list", "--parents", "-n1", empty.newOid), `${empty.newOid} ${before.target}`);
  assert.equal(git(f.main, "rev-list", "--parents", "-n1", next.newOid), `${next.newOid} ${empty.newOid}`);
  assert.notEqual(empty.newOid, snapshot.rewriteSeries[0].oid);
  assert.equal(candidate.newSourceOid, next.newOid);
  assert.equal(git(f.main, "show", `${next.newOid}:second`), "second");
  unchanged(before, f.state());
});

test("implicit global merge=union attributes cannot silently resolve a conflict", async (t) => {
  const f = fixture(t, { conflict: true });
  const xdg = join(f.home, "xdg");
  mkdirSync(join(xdg, "git"), { recursive: true });
  writeFileSync(join(xdg, "git", "attributes"), "base merge=union\n");
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  t.after(() => { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; });
  // This same three-way replay succeeds and silently unions conflicting lines
  // without the candidate's global-attributes isolation/inspection.
  const base = git(f.main, "merge-base", "main", "feature");
  const mergedTree = execFileSync("git", ["-C", f.feature, "merge-tree", "--write-tree", "--merge-base",
    base, git(f.main, "rev-parse", "HEAD"), git(f.feature, "rev-parse", "HEAD")], { encoding: "utf8" }).trim();
  assert.match(git(f.main, "show", `${mergedTree}:base`), /feature/);
  assert.match(git(f.main, "show", `${mergedTree}:base`), /upstream/);
  const snapshot = await f.preflight(), before = f.state();
  await assert.rejects(f.plan(snapshot), (error) => error.code === "unavailable" && !String(error).includes(xdg));
  assert.deepEqual(f.state(), before); // including refs, indexes and loose object count
  assert.equal(readFileSync(join(f.main, "base"), "utf8"), "upstream\n");
  assert.equal(readFileSync(join(f.feature, "base"), "utf8"), "feature\n");
});

test("conflict returns no path data and leaves both branches, indexes and files unchanged", async (t) => {
  const f = fixture(t, { conflict: true });
  const before = f.state();
  await assert.rejects(f.plan(await f.preflight()), (error) => error.code === "conflict" && !String(error).includes("base"));
  unchanged(before, f.state());
  assert.equal(readFileSync(join(f.feature, "base"), "utf8"), "feature\n");
  assert.equal(readFileSync(join(f.main, "base"), "utf8"), "upstream\n");
});

test("known-shared refs cannot be bypassed by a forged preflight", async (t) => {
  const f = fixture(t);
  const snapshot = await f.preflight(), before = f.state();
  git(f.main, "update-ref", "refs/remotes/origin/feature", snapshot.source.oid);
  await assert.rejects(f.plan(snapshot), (error) => error.code === "shared");
  unchanged({ ...before, refs: f.state().refs }, f.state());
});

test("stale source or target and forged OIDs fail before writing candidate objects", async (t) => {
  for (const kind of ["source", "target", "forged"]) {
    const f = fixture(t), snapshot = await f.preflight();
    if (kind === "forged") snapshot.rewriteSeries[0].oid = snapshot.target.oid;
    else git(f[kind === "source" ? "feature" : "main"], "commit", "--allow-empty", "-qm", "moved");
    const before = f.state();
    await assert.rejects(f.plan(snapshot), (error) => error.code === "ref-moved" || error.code === "history");
    assert.deepEqual(f.state(), before);
  }
});

test("tracked attributes in an intermediate replay tree block despite clean checkout tips", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.feature, ".gitattributes"), "base merge=union\n");
  git(f.feature, "add", ".gitattributes"); git(f.feature, "commit", "-qm", "add attributes");
  git(f.feature, "rm", "-q", ".gitattributes"); git(f.feature, "commit", "-qm", "remove attributes");
  const snapshot = await f.preflight(), before = f.state();
  await assert.rejects(f.plan(snapshot), (error) => error.code === "unavailable");
  assert.deepEqual(f.state(), before);
});

test("configured merge drivers, signing, hooks and attributes refuse object creation", async (t) => {
  for (const kind of ["driver", "signing", "hook", "attributes", "attributes-config", "filter"]) {
    const f = fixture(t);
    const marker = join(f.home, "executed");
    if (kind === "driver") git(f.main, "config", "merge.untrusted.driver", `touch ${marker}`);
    if (kind === "signing") git(f.main, "config", "commit.gpgsign", "true");
    if (kind === "hook") writeFileSync(join(f.main, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch ${marker}\n`);
    if (kind === "attributes") writeFileSync(join(f.main, ".git", "info", "attributes"), "*.txt merge=untrusted\n");
    if (kind === "attributes-config") git(f.main, "config", "core.attributesFile", join(f.home, "other-attributes"));
    if (kind === "filter") git(f.main, "config", "filter.untrusted.smudge", `touch ${marker}`);
    const before = f.state();
    // Filters and info attributes are already refused by read-only preflight;
    // all others are rejected by the candidate's stricter safety check.
    if (kind === "filter" || kind === "attributes" || kind === "attributes-config") {
      await assert.rejects(f.preflight(), (error) => error.code === "unavailable");
    }
    else await assert.rejects(f.plan(await f.preflight()), (error) => error.code === "unavailable");
    assert.deepEqual(f.state(), before);
    assert.equal((await import("node:fs")).existsSync(marker), false);
  }
});

test("signed or unsupported source commit headers block without writing candidate objects", async (t) => {
  const f = fixture(t);
  const original = execFileSync("git", ["-C", f.feature, "cat-file", "commit", "HEAD"]);
  const boundary = original.indexOf("\n\n");
  const signed = Buffer.concat([original.subarray(0, boundary),
    Buffer.from("\ngpgsig -----BEGIN PGP SIGNATURE-----\n forged\n"), original.subarray(boundary)]);
  const replacement = execFileSync("git", ["-C", f.feature, "hash-object", "-w", "-t", "commit", "--stdin"],
    { input: signed, encoding: "utf8" }).trim();
  git(f.feature, "reset", "--hard", replacement);
  const snapshot = await f.preflight(), before = f.state();
  await assert.rejects(f.plan(snapshot), (error) => error.code === "history" && !String(error).includes("PGP"));
  assert.deepEqual(f.state(), before);
});

test("already-prepared is a no-op with no object writes", async (t) => {
  const f = fixture(t, { upstream: false });
  const snapshot = await f.preflight(), before = f.state();
  const result = await f.plan(snapshot);
  assert.equal(result.status, "already-prepared");
  assert.deepEqual(result.comparison.commits, []);
  assert.equal(result.oldSourceOid, result.newSourceOid);
  assert.deepEqual(f.state(), before);
});
