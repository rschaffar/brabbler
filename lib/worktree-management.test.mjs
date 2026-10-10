import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, symlinkSync, renameSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const { captureWorktreeManagement, worktreeManagementDetails, managementContains, managementMergeDate, managementStatus, managementCheckout } = await import("./worktree-management.ts");
const { managementRemovalBlockers, managementSelection } = await import("./worktree-management-view.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, format = "sha1") {
  const root = mkdtempSync(join(tmpdir(), "pi-management-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-qb", "main", `--object-format=${format}`, join(root, "repo"));
  const cwd = join(root, "repo"); git(cwd, "config", "user.name", "Fixture"); git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "source"), "base\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "Base");
  return { root, cwd };
}
const tip = (cwd) => git(cwd, "rev-parse", "HEAD");
function commit(cwd, name, date) {
  writeFileSync(join(cwd, name), `${name}\n`); git(cwd, "add", name);
  execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", "commit", "-qm", name], { env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) } });
  return tip(cwd);
}
function merge(cwd, branch, date = "2001-01-01T00:00:00+00:00") {
  execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", "merge", "--no-ff", "-qm", "Graph join", branch], { env: { ...process.env, GIT_COMMITTER_DATE: date } }); return tip(cwd);
}
test("related status is allowed-root and captured-project bound, including rebound registrations and replaced physical directories", async (t) => {
  const { root, cwd } = fixture(t); const path = join(root, "linked");
  git(cwd, "worktree", "add", "-qb", "linked", path);
  let inventory = await captureWorktreeManagement(cwd);
  const read = (allowed) => worktreeManagementDetails(cwd, inventory.captureId, ["branch:linked"], undefined, false, allowed);
  assert.equal((await read(() => false)).rows[0].statuses[0].state, "unavailable");
  assert.equal((await read(() => true)).rows[0].statuses[0].state, "clean");
  const original = join(root, "original"); renameSync(path, original); mkdirSync(path);
  copyFileSync(join(original, ".git"), join(path, ".git"));
  writeFileSync(join(path, "unrelated-private-path"), "not source inventory");
  assert.equal((await read(() => true)).rows[0].statuses[0].state, "unavailable", "same repository but replaced physical directory");
  rmSync(join(path, ".git")); git(root, "init", "-qb", "foreign", path);
  git(path, "config", "user.name", "Fixture"); git(path, "config", "user.email", "test@example.invalid");
  git(path, "add", "."); git(path, "commit", "-qm", "Foreign");
  // Capture the stale original registration AFTER rebound: lexical/physical root
  // admission alone is insufficient; the captured project must still match.
  inventory = await captureWorktreeManagement(cwd);
  const detail = await read(() => true);
  assert.equal(detail.rows[0].statuses[0].state, "unavailable");
  assert.deepEqual(detail.rows[0].statuses[0].untracked, []);
});
test("all local branches and diagnostic registrations; inventory needs no target and revalidates captures", async (t) => {
  const { root, cwd } = fixture(t);
  git(cwd, "branch", "branch/only");
  const linked = join(root, "checkout\nwith newline"); git(cwd, "worktree", "add", "-qb", "linked", linked);
  git(cwd, "worktree", "lock", "--reason", "keep", linked);
  const detached = join(root, "detached"); git(cwd, "worktree", "add", "--detach", detached);
  const missing = join(root, "missing"); git(cwd, "worktree", "add", "-qb", "missing", missing); rmSync(missing, { recursive: true });
  const inventory = await captureWorktreeManagement(cwd);
  assert.equal(inventory.target.tip, null); assert.equal(inventory.complete, true);
  assert.equal(inventory.counts.branches, 4); assert.equal(inventory.counts.worktrees, 4); assert.equal(inventory.counts.diagnostics, 3);
  assert.equal(inventory.rows.find((r) => r.branch === "branch/only").worktrees.length, 0);
  assert.equal(inventory.rows.find((r) => r.branch === "linked").worktrees[0].locked, "keep");
  assert.ok(inventory.rows.some((r) => r.worktrees.some((w) => w.detached)));
  assert.ok(inventory.rows.some((r) => r.worktrees.some((w) => w.missing && w.prunable !== null)));
  assert.ok(inventory.rows.find((r) => r.branch === "main").worktrees[0].selected);
  assert.ok(inventory.rows.find((r) => r.branch === "main").tipDate);
  await assert.rejects(captureWorktreeManagement(cwd, { target: "main~1" }), { code: "INVALID" });
  git(cwd, "branch", "late");
  await assert.rejects(worktreeManagementDetails(cwd, inventory.captureId, ["branch:main"]), { code: "STALE" });
});
test("containment is not a hard blocker; configured and comparison targets are independently protected", async (t) => {
  const { cwd } = fixture(t);
  git(cwd, "branch", "configured"); git(cwd, "branch", "comparison");
  git(cwd, "switch", "-qc", "unintegrated"); commit(cwd, "unique"); git(cwd, "switch", "-q", "main");
  let inventory = await captureWorktreeManagement(cwd, { configuredTarget: "configured", target: "comparison" });
  assert.deepEqual(inventory.rows.find((r) => r.branch === "configured").blockers, ["configured-target"]);
  assert.deepEqual(inventory.rows.find((r) => r.branch === "comparison").blockers, ["comparison-target"]);
  const unintegrated = inventory.rows.find((r) => r.branch === "unintegrated");
  assert.equal(unintegrated.kind, "branch"); assert.equal(unintegrated.integration, "not-integrated"); assert.deepEqual(unintegrated.blockers, []);
  assert.deepEqual(managementRemovalBlockers(unintegrated, { resource: "branch", worktreePath: "" }), []);
  inventory = await captureWorktreeManagement(cwd, { configuredTarget: "missing" });
  assert.equal(inventory.target.branch, null);
  assert.deepEqual(inventory.rows.find((r) => r.branch === "unintegrated").blockers, []);
  assert.equal(inventory.rows.find((r) => r.branch === "unintegrated").integration, "unknown");
});
test("valid detached HEAD metadata enables worktree-only review and path-derived IDs survive registration reordering", async (t) => {
  const { root, cwd } = fixture(t); const detached = join(root, "z-detached");
  git(cwd, "worktree", "add", "--detach", detached);
  const find = (inventory, path) => inventory.rows.find((r) => r.worktrees.some((w) => w.path === path));
  let inventory = await captureWorktreeManagement(cwd);
  const row = find(inventory, detached);
  assert.equal(row.kind, "detached"); assert.equal(row.branch, null); assert.equal(row.tip, tip(detached));
  assert.ok(row.tipDate); assert.ok(row.authorDate); assert.ok(row.subject); assert.deepEqual(row.blockers, []);
  assert.equal(row.integrationReason, "detached-head");
  const detail = await worktreeManagementDetails(cwd, inventory.captureId, [row.id], undefined, false, () => true);
  assert.equal(detail.rows[0].statuses[0].state, "clean");
  assert.deepEqual(managementSelection(row, { resource: "both", worktreePath: detached }), { resource: "worktree", worktreePath: detached });
  assert.deepEqual(managementRemovalBlockers(row, { resource: "branch", worktreePath: "" }, detail.rows[0].statuses), []);
  git(cwd, "worktree", "add", "--detach", join(root, "a-earlier"));
  inventory = await captureWorktreeManagement(cwd);
  assert.equal(find(inventory, detached).id, row.id);
  const selected = find(await captureWorktreeManagement(detached), detached);
  assert.ok(managementRemovalBlockers(selected, { resource: "worktree", worktreePath: detached }, detail.rows[0].statuses).includes("selected-checkout"));
  git(cwd, "worktree", "lock", "--reason", "retain", detached);
  const locked = find(await captureWorktreeManagement(cwd), detached);
  assert.equal(locked.id, row.id); assert.equal(locked.kind, "diagnostic"); assert.ok(locked.blockers.includes("diagnostic-registration"));
});
test("detached HEAD movement or reattachment stales details; missing/prunable and unreadable HEAD remain diagnostic", async (t) => {
  const { root, cwd } = fixture(t); const detached = join(root, "detached");
  git(cwd, "worktree", "add", "--detach", detached); commit(detached, "detached-unique");
  const find = (inventory) => inventory.rows.find((r) => r.worktrees.some((w) => w.path === detached));
  let inventory = await captureWorktreeManagement(cwd), row = find(inventory);
  git(detached, "switch", "--detach", "HEAD~1");
  await assert.rejects(worktreeManagementDetails(cwd, inventory.captureId, [row.id], undefined, false, () => true), { code: "STALE" });
  inventory = await captureWorktreeManagement(cwd); row = find(inventory);
  git(detached, "switch", "-qc", "reattached");
  await assert.rejects(worktreeManagementDetails(cwd, inventory.captureId, [row.id], undefined, false, () => true), { code: "STALE" });
  assert.equal(find(await captureWorktreeManagement(cwd)).kind, "branch");
  git(detached, "switch", "--detach"); const unreadable = commit(detached, "unreadable-head");
  rmSync(join(cwd, ".git/objects", unreadable.slice(0, 2), unreadable.slice(2)));
  const invalid = find(await captureWorktreeManagement(cwd));
  assert.equal(invalid.kind, "diagnostic"); assert.equal(invalid.tip, unreadable); assert.equal(invalid.tipDate, null);
  rmSync(detached, { recursive: true });
  const missing = find(await captureWorktreeManagement(cwd));
  assert.equal(missing.kind, "diagnostic"); assert.equal(missing.worktrees[0].missing, true); assert.notEqual(missing.worktrees[0].prunable, null);
});
test("recorded merge committer date is graph introduction, independent of date order and later commits", async (t) => {
  const { cwd } = fixture(t);
  git(cwd, "switch", "-qc", "feature"); const feature = commit(cwd, "feature", "2025-01-01T00:00:00+00:00");
  git(cwd, "switch", "-q", "main"); commit(cwd, "main", "2027-01-01T00:00:00+00:00");
  const introducing = merge(cwd, "feature"); commit(cwd, "later", "1999-01-01T00:00:00+00:00");
  const inventory = await captureWorktreeManagement(cwd, { configuredTarget: "main", targetSource: "project" });
  const row = inventory.rows.find((r) => r.branch === "feature");
  assert.equal(row.integration, "integrated"); assert.equal(Date.parse(row.tipDate), Date.parse("2025-01-01T00:00:00+00:00"));
  assert.equal(row.mergeDate.state, "not-loaded");
  const detail = await worktreeManagementDetails(cwd, inventory.captureId, [row.id]);
  assert.deepEqual({ ...detail.rows[0].mergeDate, date: new Date(detail.rows[0].mergeDate.date).toISOString() }, { state: "available", date: "2001-01-01T00:00:00.000Z", commit: introducing, source: "first-parent-graph" });
  assert.equal(inventory.rows.find((r) => r.branch === "main").integration, "target");
  git(cwd, "switch", "-q", "feature"); commit(cwd, "new-feature"); git(cwd, "switch", "-q", "main");
  const changed = await captureWorktreeManagement(cwd, { target: "main" });
  assert.equal(changed.rows.find((r) => r.branch === "feature").integration, "not-integrated");
  assert.equal(await managementContains(cwd, feature, tip(cwd)), "yes");
});
test("nested merge, pre-existing merge fast-forward and equal merge tips retain graph evidence", async (t) => {
  const { cwd } = fixture(t);
  git(cwd, "switch", "-qc", "feature"); const feature = commit(cwd, "feature");
  git(cwd, "switch", "-qc", "intermediate", "main"); commit(cwd, "intermediate"); merge(cwd, "feature");
  git(cwd, "switch", "-q", "main"); commit(cwd, "main"); const introducing = merge(cwd, "intermediate");
  assert.equal((await managementMergeDate(cwd, feature, introducing)).commit, introducing);
  git(cwd, "branch", "equal", introducing);
  assert.equal((await managementMergeDate(cwd, introducing, introducing)).commit, introducing);
  git(cwd, "branch", "fast-forward", git(cwd, "rev-list", "--max-parents=0", "HEAD"));
  git(cwd, "switch", "-q", "fast-forward"); git(cwd, "merge", "--ff-only", "main");
  assert.equal((await managementMergeDate(cwd, feature, tip(cwd))).commit, introducing);
});
test("ordinary/root and fast-forward introduction have no integration timestamp; squash/cherry-pick do not prove containment", async (t) => {
  const { cwd } = fixture(t); const root = tip(cwd);
  git(cwd, "switch", "-qc", "feature"); const feature = commit(cwd, "feature");
  git(cwd, "switch", "-q", "main"); git(cwd, "merge", "--ff-only", "feature");
  assert.equal((await managementMergeDate(cwd, feature, tip(cwd))).reason, "ordinary-or-root-introduction");
  assert.equal((await managementMergeDate(cwd, root, tip(cwd))).reason, "ordinary-or-root-introduction");
  git(cwd, "switch", "-qc", "squashed", root); git(cwd, "merge", "--squash", "feature"); git(cwd, "commit", "-qm", "Squashed feature");
  assert.equal(await managementContains(cwd, feature, tip(cwd)), "no");
  git(cwd, "switch", "-qc", "picked", root); git(cwd, "cherry-pick", "--no-commit", feature); git(cwd, "commit", "-qm", "Different picked commit");
  assert.equal(await managementContains(cwd, feature, tip(cwd)), "no");
});
test("reverts preserve containment but rewritten target history does not", async (t) => {
  const { cwd } = fixture(t); const root = tip(cwd);
  git(cwd, "switch", "-qc", "feature"); const feature = commit(cwd, "feature");
  git(cwd, "switch", "-q", "main"); const merged = merge(cwd, "feature"); git(cwd, "revert", "--no-edit", "-m", "1", merged);
  assert.equal(await managementContains(cwd, feature, tip(cwd)), "yes"); assert.equal((await managementMergeDate(cwd, feature, tip(cwd))).commit, merged);
  git(cwd, "branch", "rewritten", root); assert.equal(await managementContains(cwd, feature, root), "no");
});
test("shallow negative with both endpoint objects present is unknown; demonstrated paths still prove containment", async (t) => {
  const { root, cwd } = fixture(t);
  git(cwd, "switch", "-qc", "feature"); const feature = commit(cwd, "feature");
  git(cwd, "switch", "-q", "main"); merge(cwd, "feature"); commit(cwd, "later");
  const shallow = join(root, "shallow"); git(root, "clone", "--depth=1", "--no-single-branch", `file://${cwd}`, shallow);
  git(shallow, "branch", "feature", "origin/feature");
  assert.equal(git(shallow, "cat-file", "-t", feature), "commit"); assert.equal(await managementContains(shallow, feature, tip(shallow)), "unknown");
  const inventory = await captureWorktreeManagement(shallow, { target: "main" }); assert.equal(inventory.rows.find((r) => r.branch === "feature").integration, "unknown");
  assert.equal(await managementContains(shallow, tip(shallow), tip(shallow)), "yes");
  assert.notEqual((await managementMergeDate(shallow, tip(shallow), tip(shallow))).state, "available");
});
test("hardened narrow status disables fsmonitor and refuses filters before source-content reads", async (t) => {
  const { root, cwd } = fixture(t); const sentinel = join(root, "executed");
  const hook = join(root, "command"); writeFileSync(hook, `#!/bin/sh\necho ran > '${sentinel}'\nexit 0\n`); chmodSync(hook, 0o700);
  git(cwd, "config", "core.fsmonitor", hook);
  const clean = await managementStatus(cwd); assert.equal(clean.state, "clean"); assert.equal(existsSync(sentinel), false);
  writeFileSync(join(cwd, ".gitattributes"), "source filter=custom\n"); git(cwd, "config", "filter.custom.clean", hook);
  const unsupported = await managementStatus(cwd); assert.equal(unsupported.state, "unavailable"); assert.match(unsupported.reason, /filter/); assert.equal(existsSync(sentinel), false);
  rmSync(join(cwd, ".gitattributes")); writeFileSync(join(cwd, ".gitignore"), "generated/\n"); mkdirSync(join(cwd, "generated")); writeFileSync(join(cwd, "generated/cache"), "cache");
  writeFileSync(join(cwd, "untracked\nfile"), "file"); writeFileSync(join(cwd, "source"), "dirty");
  const dirty = await managementStatus(cwd); assert.equal(dirty.state, "dirty"); assert.equal(dirty.trackedDirty, true); assert.ok(dirty.untracked.includes("untracked\nfile")); assert.ok(dirty.ignored.some((path) => path.startsWith("generated/")));
});
test("grafts, missing objects, unsafe paths and cancellation never imply negative containment or clean status", async (t) => {
  const { root, cwd } = fixture(t); const oid = tip(cwd);
  writeFileSync(join(cwd, ".git/info/grafts"), `${oid}\n`);
  assert.equal(await managementContains(cwd, oid, oid), "unknown");
  const graph = await captureWorktreeManagement(cwd, { target: "main" }); assert.equal(graph.rows.find((r) => r.branch === "main").integration, "target");
  rmSync(join(cwd, ".git/info/grafts")); assert.equal(await managementContains(cwd, "f".repeat(40), oid), "unknown");
  const alias = join(root, "alias"); symlinkSync(cwd, alias); await assert.rejects(managementCheckout(alias), { code: "INVALID" });
  const controller = new AbortController(); controller.abort(); await assert.rejects(captureWorktreeManagement(cwd, { signal: controller.signal }));
});
test("SHA-256 capture and containment use full IDs", async (t) => {
  const { cwd } = fixture(t, "sha256"); git(cwd, "branch", "equal");
  const inventory = await captureWorktreeManagement(cwd, { target: "main", configuredTarget: "missing" });
  assert.equal(inventory.target.tip.length, 64); assert.equal(inventory.target.missingConfigured, true); assert.equal(inventory.target.temporary, true);
  assert.equal(inventory.rows.find((r) => r.branch === "equal").integration, "integrated");
});
test("many-ref complete capture and shared deep first-parent traversal", async (t) => {
  const { cwd } = fixture(t);
  const base = tip(cwd); let parent = base;
  const tree = git(cwd, "rev-parse", "HEAD^{tree}");
  for (let i = 0; i < 120; i++) parent = git(cwd, "commit-tree", tree, "-p", parent, "-m", `graph-${i}`);
  git(cwd, "update-ref", "refs/heads/main", parent);
  for (let i = 0; i < 160; i++) git(cwd, "branch", `feature-${i}`, base);
  const start = performance.now(), inventory = await captureWorktreeManagement(cwd, { target: "main" });
  assert.equal(inventory.counts.branches, 161); assert.equal(inventory.counts.integrated, 160);
  const ids = inventory.rows.filter((r) => r.integration === "integrated").slice(0, 50).map((r) => r.id);
  const details = await worktreeManagementDetails(cwd, inventory.captureId, ids); assert.equal(details.rows.length, 50); assert.ok(details.rows.every((r) => r.mergeDate.state === "unavailable"));
  t.diagnostic(`161 refs / 121 first-parent commits / 50 complete date reads: ${(performance.now() - start).toFixed(0)}ms`);
});
test("octopus introduction is recorded once for each contained side tip", async (t) => {
  const { cwd } = fixture(t); const base = tip(cwd);
  git(cwd, "switch", "-qc", "one"); const one = commit(cwd, "one");
  git(cwd, "switch", "-qc", "two", base); const two = commit(cwd, "two");
  git(cwd, "switch", "-q", "main"); commit(cwd, "main-only");
  git(cwd, "merge", "--no-ff", "-qm", "Octopus", "one", "two"); const introduction = tip(cwd);
  assert.equal((await managementMergeDate(cwd, one, introduction)).commit, introduction);
  assert.equal((await managementMergeDate(cwd, two, introduction)).commit, introduction);
});
test("unavailable tip objects retain branch inventory, and symbolic refs remain explicit blockers", async (t) => {
  const { cwd } = fixture(t);
  git(cwd, "symbolic-ref", "refs/heads/alias", "refs/heads/main");
  git(cwd, "switch", "-qc", "unavailable"); const feature = commit(cwd, "unavailable"); git(cwd, "switch", "-q", "main");
  rmSync(join(cwd, ".git/objects", feature.slice(0, 2), feature.slice(2)));
  const inventory = await captureWorktreeManagement(cwd, { target: "main" });
  assert.equal(inventory.rows.find((r) => r.branch === "unavailable").tip, feature);
  assert.equal(inventory.rows.find((r) => r.branch === "unavailable").tipDate, null);
  assert.equal(inventory.rows.find((r) => r.branch === "unavailable").integration, "unknown");
  assert.ok(inventory.rows.find((r) => r.branch === "alias").blockers.includes("symbolic-ref"));
});
