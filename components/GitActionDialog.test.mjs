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

test("an older live request with a deadline does not falsely claim unlimited waiting", () => {
  const html = render({ kind: "checks", featureCwd: "/repo/feature", targetCwd: "/repo/target",
    featureBranch: "feature", targetBranch: "target", checks: [] }, { expiresAt: Date.now() + 1000 });
  assert.match(html, /Respond by/);
  assert.doesNotMatch(html, /no automatic response timeout/);
});
