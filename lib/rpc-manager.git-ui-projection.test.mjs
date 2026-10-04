import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectNativeGitActionCandidate, projectGitActionUiCandidate, gitActionAttentionSummary } = await jiti.import("./rpc-manager.git-ui.ts");
const { snapshotGitActionCandidate } = await jiti.import("./git-action-controller.ts");
const oid = (c) => c.repeat(40);
const instance = { device: "1", inode: "2", birthtime: "3" };
const attribution = { repositoryRoot: "/repo-worktrees/source", projectRoot: "/repo", sourceCheckoutRoot: "/repo-worktrees/source",
  resourceAttribution: { version: 2, commonDir: "/repo/.git", commonIdentity: instance, projectIdentity: instance } };
const physical = { gitDir: "/repo/.git", checkoutIdentity: instance, gitIdentity: instance, markerIdentity: instance };
const workspaceSnapshot = (mode = "create") => ({ ...attribution, kind: "workspace",
  workspace: { mode, destinationPath: "/repo-worktrees/new", baseBranch: "main", baseOid: oid("a"), branch: "new", tipOid: oid("a"), treeOid: oid("b") } });
const preparationSnapshot = () => ({ ...attribution, kind: "preparation", featureBranch: "feature", targetBranch: "main", targetCheckoutRoot: "/repo",
  preparation: { oldSourceOid: oid("c"), newSourceOid: oid("d"), targetMainOid: oid("a"), resultTreeOid: oid("b"), emptyRetention: "keep", commitCount: 1,
    commitMapping: [{ oldOid: oid("c"), newOid: oid("d"), oldTreeOid: oid("e"), newTreeOid: oid("b"), emptyAfterReplay: true }], source: physical, target: physical } });

test("native Ask projection preserves exact tree/mapping/physical identities but never includes patch bytes", () => {
  for (const snapshot of [workspaceSnapshot(), workspaceSnapshot("attach"), preparationSnapshot()]) {
    const id = randomUUID(), request = projectNativeGitActionCandidate(id, { ...snapshot,
      diff: { fromTreeOid: oid("e"), toTreeOid: oid("b"), patch: "PRIVATE_PATCH_NOT_FOR_ASK", hasBinaryChanges: false } });
    assert.equal(request.actionId, id);
    assert.equal(request.projectRoot, "/repo");
    assert.deepEqual(request.resourceAttribution, attribution.resourceAttribution);
    assert.deepEqual(projectGitActionUiCandidate(request), request);
    assert.equal(request.diff, undefined);
    assert.equal(request.diffUnavailable, undefined);
    assert.doesNotMatch(JSON.stringify(request), /PRIVATE_PATCH_NOT_FOR_ASK|reviewToken|planId|receipt|job/);
    if (request.kind === "workspace") assert.equal(request.workspace.treeOid, oid("b"));
    else assert.deepEqual(request.preparation.commitMapping, snapshot.preparation.commitMapping);
    const { actionId, ...display } = request;
    assert.deepEqual(snapshotGitActionCandidate(request), display);
    assert.equal(actionId, id);
  }
});

test("projection is a strict bounded copy, not model-candidate deserialization or native capability reconstruction", () => {
  const id = randomUUID(), snapshot = preparationSnapshot();
  const request = projectNativeGitActionCandidate(id, snapshot);
  snapshot.preparation.commitMapping[0].newTreeOid = oid("f");
  snapshot.resourceAttribution.commonIdentity.inode = "999";
  assert.equal(request.preparation.commitMapping[0].newTreeOid, oid("b"));
  assert.equal(request.resourceAttribution.commonIdentity.inode, "2");
  instance.inode = "2";
  for (const bad of [
    { ...workspaceSnapshot(), reviewToken: "not-allowed" },
    { ...workspaceSnapshot(), workspace: { ...workspaceSnapshot().workspace, treeOid: "short" } },
    { ...preparationSnapshot(), preparation: { ...preparationSnapshot().preparation, commitMapping: undefined } },
    { ...preparationSnapshot(), preparation: { ...preparationSnapshot().preparation, commitMapping: Array(201).fill(preparationSnapshot().preparation.commitMapping[0]) } },
    { kind: "commit", repositoryRoot: "/repo" },
  ]) assert.throws(() => projectNativeGitActionCandidate(id, bad));
  assert.throws(() => projectNativeGitActionCandidate("tool-selected-id", workspaceSnapshot()));
});

test("RPC wrapper seam strips only new native patches; v1 candidate identity/bytes are unchanged", () => {
  const native = { ...preparationSnapshot(), actionId: randomUUID(), diff: { fromTreeOid: oid("e"), toTreeOid: oid("b"), patch: "LAZY_HISTORY_ONLY", hasBinaryChanges: false } };
  assert.equal(projectGitActionUiCandidate(native).diff, undefined);
  for (const kind of ["commit", "review", "checks", "integration", "preferences"]) {
    const old = { kind, actionId: "legacy", diff: { patch: "original v1 bytes" } };
    assert.equal(projectGitActionUiCandidate(old), old);
  }
});

test("attention summaries distinguish exact new requests without altering old wording", () => {
  assert.equal(gitActionAttentionSummary(projectNativeGitActionCandidate(randomUUID(), workspaceSnapshot())), "Approve exact worktree creation");
  assert.equal(gitActionAttentionSummary(projectNativeGitActionCandidate(randomUUID(), workspaceSnapshot("attach"))), "Approve exact worktree attachment");
  assert.equal(gitActionAttentionSummary(projectNativeGitActionCandidate(randomUUID(), preparationSnapshot())), "Approve exact history preparation");
  for (const [kind, label] of [["commit", "Review exact Git commit"], ["review", "Review local Git comparison"], ["checks", "Approve Git checks"],
    ["integration", "Approve exact Git merge"], ["preferences", "Choose Git workflow preferences"]]) assert.equal(gitActionAttentionSummary({ kind }), label);
});
