import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { GitActionDialog } = await jiti.import("./GitActionDialog.tsx");
const oid = (x) => x.repeat(40);
const diff = { fromTreeOid: oid("a"), toTreeOid: oid("b"), patch: "diff --git a/a b/a\n+new\n", hasBinaryChanges: false };
const render = (candidate) => renderToStaticMarkup(React.createElement(GitActionDialog, { request: { type: "extension_ui_request", id: "one", method: "git_action", candidate }, onRespond: () => {} }));

test("commit review displays exact identities, message and patch, with opt-in approval", () => {
  const html = render({ kind: "commit", preview: { repositoryRoot: "/repo", branch: "refs/heads/feature", head: oid("c"), paths: ["a"], tree: oid("b"), reviewToken: "token" }, message: "Exact message", diff });
  assert.match(html, /Review exact commit/);
  assert.match(html, /Exact message/);
  assert.match(html, /refs\/heads\/feature/);
  assert.match(html, /diff --git a\/a b\/a/);
  assert.match(html, /Approve exact commit/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /reviewToken|token/);
});

test("early chat preferences are not an operation approval", () => {
  const html = render({ kind: "preferences", featureBranch: "feature", targets: ["target"],
    checks: [{ label: "test", argv: ["npm", "test"] }] });
  assert.match(html, /Choose Git workflow preferences/);
  assert.match(html, /Save chat preferences/);
  assert.match(html, /No checks run and no commit, merge, cleanup or remote action is approved/);
  assert.match(html, /Prefer a dedicated worktree/);
  assert.doesNotMatch(html, /Approve exact local merge|Approve exact commit|Run these checks/);
});

test("read-only comparison cannot be confused with a merge confirmation", () => {
  const html = render({ kind: "review", featureCwd: "/repo-worktrees/feature", review: { featureBranch: "feature", featureOid: oid("c"), targetBranch: "target", targetOid: oid("d"), mergeTreeOid: oid("b") }, selection: { kind: "merge" }, diff });
  assert.match(html, /Whole proposed merge/);
  assert.match(html, /\/repo-worktrees\/feature/);
  assert.match(html, /does not approve or perform a merge/);
  assert.match(html, /I reviewed this comparison/);
  assert.doesNotMatch(html, /Approve exact commit|Confirm merge|Merge now/);
});

test("check and merge approval cards show both physical checkouts", () => {
  const check = render({ kind: "checks", featureCwd: "/repo/feature", targetCwd: "/repo/target",
    featureBranch: "feature", targetBranch: "target", checks: [{ label: "test", argv: ["npm", "test"] }] });
  assert.match(check, /\/repo\/feature/);
  assert.match(check, /\/repo\/target/);
  const merge = render({ kind: "integration", featureCwd: "/repo/feature", targetCwd: "/repo/target", receipts: [],
    plan: { review: { featureBranch: "feature", featureOid: oid("a"), targetBranch: "target", targetOid: oid("b"), mergeTreeOid: oid("c") },
      diff, mergeOid: oid("d"), message: "Merge", planId: "plan", expiresAt: Date.now() + 1000 } });
  assert.match(merge, /\/repo\/feature/);
  assert.match(merge, /\/repo\/target/);
});
