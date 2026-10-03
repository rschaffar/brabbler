import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { GitActionDialog } = await jiti.import("./GitActionDialog.tsx");
const oid = (x) => x.repeat(40);
const diff = { fromTreeOid: oid("a"), toTreeOid: oid("b"), patch: "diff --git a/a b/a\n+new\n", hasBinaryChanges: false };
const render = (candidate, request = {}) => renderToStaticMarkup(React.createElement(GitActionDialog, { request: { type: "extension_ui_request", id: "one", method: "git_action", candidate, ...request }, onRespond: () => {} }));

test("commit review displays exact identities, message and patch, with one explicit approval button", () => {
  const html = render({ kind: "commit", preview: { repositoryRoot: "/repo", branch: "refs/heads/feature", head: oid("c"), paths: ["a"], mode: "whole-file", tree: oid("b"), reviewToken: "token" }, message: "Exact message", diff });
  assert.match(html, /Review exact commit/);
  assert.match(html, /Waits for your response or Stop; no automatic response timeout/);
  assert.match(html, /Exact message/);
  assert.match(html, /refs\/heads\/feature/);
  assert.match(html, /diff --git a\/a b\/a/);
  assert.match(html, /Approve exact commit/);
  assert.doesNotMatch(html, /type="checkbox"|disabled=""/);
  assert.doesNotMatch(html, /reviewToken|token/);
});

test("staged commit approval names the index source instead of promising complete working-tree files", () => {
  const html = render({ kind: "commit", preview: { repositoryRoot: "/repo", branch: "refs/heads/feature", head: oid("c"),
    paths: ["a"], mode: "staged", tree: oid("b"), reviewToken: "token" }, message: "Partial edit", diff });
  assert.match(html, /Only the selected staged index entries/);
  assert.match(html, /Other staged and unstaged changes remain/);
  assert.match(html, /Selected staged index paths/);
  assert.doesNotMatch(html, /selected complete|Complete working-tree files/);
});

test("early chat preferences are not an operation approval", () => {
  const html = render({ kind: "preferences", featureBranch: "feature", targets: ["target"],
    checks: [{ label: "test", argv: ["npm", "test"] }] });
  assert.match(html, /Choose Git workflow preferences/);
  assert.match(html, /Save chat preferences/);
  assert.match(html, /No checks run and no commit, merge, cleanup or remote action is approved/);
  assert.match(html, /Prefer a dedicated worktree/);
  assert.doesNotMatch(html, /Approve exact local merge|Approve exact commit|Run these checks/);
  assert.match(html, /type="checkbox"/, "Check selection still needs its ordinary selector");
});

test("an older pending read-only comparison remains answerable without a new approval claim", () => {
  const candidate = { kind: "review", featureCwd: "/repo-worktrees/feature", review: { featureBranch: "feature", featureOid: oid("c"), targetBranch: "target", targetOid: oid("d"), mergeTreeOid: oid("b") }, selection: { kind: "merge" }, diff };
  const html = render(candidate);
  assert.match(html, /Whole proposed merge/);
  assert.match(html, /\/repo-worktrees\/feature/);
  assert.match(html, /Earlier read-only comparison still waiting for a response/);
  assert.match(html, /neither authorizes a commit, merge, cleanup or remote action/);
  assert.match(html, /Waits for your response or Stop/);
  assert.match(html, /Dismiss pending comparison/);
  assert.match(html, /Continue read-only comparison/);
  assert.doesNotMatch(html, /I reviewed|Approve exact commit|Confirm merge|Merge now|type="checkbox"/);
  const timed = render(candidate, { expiresAt: Date.now() + 1000 });
  assert.match(timed, /Respond by/);
  assert.doesNotMatch(timed, /no automatic response timeout/);
});

test("check and merge approval cards show both physical checkouts", () => {
  const check = render({ kind: "checks", featureCwd: "/repo/feature", targetCwd: "/repo/target",
    featureBranch: "feature", targetBranch: "target", checks: [{ label: "test", argv: ["npm", "test"] }] });
  assert.match(check, /\/repo\/feature/);
  assert.match(check, /\/repo\/target/);
  assert.doesNotMatch(check, /type="checkbox"|disabled=""/);
  const merge = render({ kind: "integration", featureCwd: "/repo/feature", targetCwd: "/repo/target", receipts: [],
    plan: { review: { featureBranch: "feature", featureOid: oid("a"), targetBranch: "target", targetOid: oid("b"), mergeTreeOid: oid("c") },
      diff, mergeOid: oid("d"), message: "Merge", planId: "plan", expiresAt: Date.now() + 1000 } });
  assert.match(merge, /\/repo\/feature/);
  assert.match(merge, /\/repo\/target/);
  assert.doesNotMatch(merge, /type="checkbox"|disabled=""/);
  assert.match(merge, /no automatic response timeout/);
  assert.match(merge, /Verification plan expires/);
  assert.match(merge, /Waiting does not renew verification/);
});

test("FF approval identifies the existing commit and never labels it a merge object", () => {
  const html = render({ kind: "integration", featureCwd: "/repo/feature", targetCwd: "/repo/target", receipts: [],
    plan: { method: "ff", review: { featureBranch: "feature", featureOid: oid("c"), targetBranch: "target", targetOid: oid("a"), mergeTreeOid: oid("b") },
      diff, featureOid: oid("c"), treeOid: oid("b"), parents: [oid("a")], planId: "ff-plan", expiresAt: Date.now() + 1000 } });
  assert.match(html, /Approve exact local fast-forward/);
  assert.match(html, /No merge commit/);
  assert.match(html, /Fast-forward target to/);
  assert.doesNotMatch(html, /Merge commit|Merge branch|unsigned non-fast-forward merge/);
});

const nativeInstance = { device: "1", inode: "2", birthtime: "3" };
const nativePhysical = { gitDir: "/project/.git", checkoutIdentity: nativeInstance, gitIdentity: nativeInstance, markerIdentity: nativeInstance };
const nativeAttribution = { actionId: "11111111-1111-4111-8111-111111111111", repositoryRoot: "/project-worktrees/feature", projectRoot: "/project",
  sourceCheckoutRoot: "/project-worktrees/feature", resourceAttribution: { version: 2, commonDir: "/project/.git", commonIdentity: nativeInstance, projectIdentity: nativeInstance } };

test("live workspace Ask shows create/attach exact destination/base/tip/tree with one explicit approval and no patch", () => {
  for (const mode of ["create", "attach"]) {
    const candidate = { ...nativeAttribution, kind: "workspace", workspace: { mode, destinationPath: "/project-worktrees/new", baseBranch: "main", baseOid: oid("c"),
      branch: "feature/new", tipOid: oid("c"), treeOid: oid("d") } };
    const html = render(candidate);
    for (const value of ["/project", "/project-worktrees/feature", "/project-worktrees/new", "main", "feature/new", oid("c"), oid("d"), "Expected tracked tree"]) assert.ok(html.includes(value), value);
    const operation = mode === "create" ? "worktree creation" : "worktree attachment";
    assert.ok(html.includes(`Approve exact ${operation}`));
    assert.ok(html.includes(`Decline ${operation}`));
    assert.equal((html.match(/<button/g) ?? []).length, 2);
    assert.match(html, /does not move or fork the chat, change its cwd/);
    assert.match(html, /no automatic response timeout/);
    assert.match(html, /No patch is included in this live request/);
    assert.doesNotMatch(html, /type="checkbox"|I reviewed|Candidate diff|diff --git|approvePlanId|reviewToken/);
  }
});

test("live preparation Ask shows exact source-target history and bounded mapping/empty retention without patch or hidden authority", () => {
  const candidate = { ...nativeAttribution, kind: "preparation", featureBranch: "feature", targetBranch: "main", targetCheckoutRoot: "/project",
    preparation: { oldSourceOid: oid("a"), newSourceOid: oid("b"), targetMainOid: oid("c"), resultTreeOid: oid("d"), emptyRetention: "keep", commitCount: 1,
      commitMapping: [{ oldOid: oid("a"), newOid: oid("b"), oldTreeOid: oid("e"), newTreeOid: oid("d"), emptyAfterReplay: true }], source: nativePhysical, target: nativePhysical } };
  const html = render(candidate);
  for (const value of ["Approve exact history preparation", "Decline history preparation", "Target checkout/branch", "main", "feature", "Old source", "Intended new source",
    "Target main", "Expected result tree", "Source physical identity", "Target physical identity", "Exact commit mapping (oldest first)", "empty commit retained",
    ...["a", "b", "c", "d", "e"].map(oid)]) assert.ok(html.includes(value), value);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.match(html, /target checkout\/branch is not changed/);
  assert.match(html, /partial effects require manual recovery/);
  assert.doesNotMatch(html, /type="checkbox"|I reviewed|Candidate diff|diff --git|approvePlanId|reviewToken/);
  const noOp = render({ ...candidate, preparation: { ...candidate.preparation, newSourceOid: oid("a"), commitCount: 0, commitMapping: [] } });
  assert.match(noOp, /No rewrite proposed; source is already prepared/);
});

test("workspace Ask explicitly includes one conventional parent creation rather than a silent side effect", () => {
  const html = render({ ...nativeAttribution, kind: "workspace", workspace: { mode: "create", destinationPath: "/project-worktrees/new", baseBranch: "main", baseOid: oid("a"), branch: "new", tipOid: oid("a"), treeOid: oid("b"),
    parentCreation: { path: "/project-worktrees", expectedAbsent: true, ancestorPath: "/", ancestorIdentity: nativeInstance, mode: 448 } } });
  assert.match(html, /Approval additionally creates exactly one expected-absent conventional parent/);
  assert.match(html, /\/project-worktrees \(mode 0700\)/);
  assert.match(html, /No missing ancestor chain/);
});

const checkoutAsk = (stage = "commit") => ({ ...nativeAttribution, kind: "checkout-verification", featureBranch: "feature",
  checkoutVerification: { evidenceScope: stage === "commit" ? "working-workspace" : "clean-checkout", candidateTreeVerified: false, repositoryChecksWaived: false, sourceOid: oid("a"), sourceTreeOid: oid("b"), snapshotDigest: "1".repeat(64),
    policyDigest: "2".repeat(64), policyRevision: "source-policy", stage, requiredSavedIndexes: stage === "none" ? [] : [7], source: nativePhysical,
    checks: [{ checkIndex: 7, recipe: { label: "Saved tests", argv: ["npm", "test"], cwd: "tests", env: { CI: "1" }, requiredStage: stage }, recipeDigest: "3".repeat(64), environmentDigest: "4".repeat(64), executionCwd: "/project-worktrees/feature/tests" }] } });
const cleanupAsk = () => ({ ...nativeAttribution, kind: "cleanup", featureBranch: "feature", targetBranch: "main", targetCheckoutRoot: "/project",
  cleanup: { sourcePath: nativeAttribution.sourceCheckoutRoot, branchRef: "refs/heads/feature", featureOid: oid("a"), targetPath: "/project", targetOid: oid("c"), mainPath: "/project", mainOid: oid("c"),
    source: nativePhysical, target: nativePhysical, main: nativePhysical,
    integration: { completedAt: 100, delivery: "selected-local", method: "merge", actualFF: false, featureOid: oid("a"), previousTargetOid: oid("b"), resultOid: oid("c"), resultTree: oid("d"), parents: [oid("b"), oid("a")] },
    provenance: { mode: "create", originalSourcePath: "/project", originalSource: nativePhysical, branchRef: "refs/heads/feature" },
    ignoredCount: 2, ignoredDeletion: "exact-approval-required", ignored: ["cache", "cache/important-result"].map((path) => ({ path, kind: "file", ...nativeInstance, size: "12", mode: "33152", changed: "4", modified: "5" })) } });

test("target-free check Ask shows exact saved indexes/recipes/source/cwd/env/stage without inventing target, task, receipt or checkbox", () => {
  const html = render(checkoutAsk());
  for (const value of ["Authorize saved checkout checks", "Run these saved checks", "Saved index 7", "Saved tests", "Checkout-relative cwd: tests", "Execution cwd: /project-worktrees/feature/tests",
    "CI", "Stage: commit", oid("a"), oid("b"), "candidateTreeVerified: false", "repositoryChecksWaived: false"]) assert.ok(html.includes(value), value);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(html, /type="checkbox"|I reviewed|Target checkout|Target branch|Candidate diff|diff --git/);
  assert.match(html, /no automatic response timeout/);
  const manual = render(checkoutAsk("none"));
  assert.match(manual, /Manual-only optional checks/);
  assert.match(manual, /receipts are not integration prerequisites/);
});

test("clean v2 Ask grants only exact saved source recipes, never dirty-workspace evidence, paired approval or a commit", () => {
  for (const stage of ["integration", "handoff", "none"]) {
    const html = render(checkoutAsk(stage));
    assert.match(html, /selected physical clean checkout \(native v2\)/);
    assert.match(html, /Evidence scope: clean-checkout/);
    assert.match(html, /not dirty working-workspace evidence, paired checks, a commit candidate tree/);
    assert.match(html, /candidateTreeVerified: false/);
    assert.match(html, /repositoryChecksWaived: false/);
    assert.match(html, /No passing receipt is claimed/);
    assert.doesNotMatch(html, /Evidence scope: working-workspace|in this physical working workspace|Target checkout|Target branch|type="checkbox"|Approve exact commit/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  }
});

test("cleanup Ask names exact source/branch/surviving target/provenance and ALL ignored entries with explicit deletion approval", () => {
  const html = render(cleanupAsk());
  for (const value of ["Remove source worktree", "refs/heads/feature", "Surviving target", "Surviving project main", "Completed safe integration", "Workspace provenance", "cache", "cache/important-result",
    "ALL named ignored data (2 entries)", "Approve cleanup and delete ALL named ignored data"]) assert.ok(html.includes(value), value);
  assert.match(html, /Generic Allow is not approval to delete ignored data/);
  assert.match(html, /No deletion has happened yet/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(html, /type="checkbox"|I reviewed|Candidate diff|diff --git/);
  assert.match(html, /no automatic response timeout/);
});

test("an older live request with a deadline does not falsely claim unlimited waiting", () => {
  const html = render({ kind: "checks", featureCwd: "/repo/feature", targetCwd: "/repo/target",
    featureBranch: "feature", targetBranch: "target", checks: [] }, { expiresAt: Date.now() + 1000 });
  assert.match(html, /Respond by/);
  assert.doesNotMatch(html, /no automatic response timeout/);
});
