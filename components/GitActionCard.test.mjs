import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { GitActionCardView } = await jiti.import("./GitActionCard.tsx");
const id = "12345678-1234-1234-1234-123456789abc";
const oid = (char) => char.repeat(40);
const record = { version: 1, id, sessionId: "old-owner", source: "agent", kind: "commit", state: "succeeded", revision: 4, createdAt: 1000, updatedAt: 2000, processId: "private",
  summary: { kind: "commit", repositoryRoot: "/deleted/worktree", featureBranch: "feature", targetBranch: "target", message: "Captured message", paths: ["gone.txt"], parentOid: oid("a"), candidateTreeOid: oid("b") },
  artifact: { sha256: "digest", bytes: 100 }, decision: "approved", outcome: { status: "committed", commit: oid("c"), tree: oid("b"), parents: [oid("a")], authorEmail: "human@example.test" } };
const live = { type: "extension_ui_request", method: "git_action", id: "actual-live-request", candidate: { actionId: id, kind: "commit", message: "Exact LIVE message", preview: { repositoryRoot: "/live", branch: "feature", head: oid("a"), tree: oid("b"), paths: ["gone.txt"] }, diff: { fromTreeOid: oid("a"), toTreeOid: oid("b"), patch: "", hasBinaryChanges: false } } };
const render = (props = {}) => renderToStaticMarkup(React.createElement(GitActionCardView, { actionId: id, history: { record }, expanded: false, onToggle: () => {}, artifact: null, ...props }));

test("compact durable card reports captured message, branch, time, actual result and author", () => {
  const html = render();
  assert.match(html, /Succeeded/);
  for (const value of ["Captured message", "feature", "target", "human@example.test", oid("c"), oid("a")]) assert.ok(html.includes(value));
  assert.match(html, /<time dateTime=/);
  assert.match(html, /Captured candidate · 1 file/);
  assert.match(html, /Captured project: not recorded \(legacy action\)/);
  assert.match(html, /Source checkout: \/deleted\/worktree \(legacy repositoryRoot\)/);
  assert.doesNotMatch(html, /Approve exact commit|private/);
});

test("unavailable diagnostics do not relabel native outcomes or restore approval controls", () => {
  const diagnostics = { status: "unavailable", reason: "storage-unavailable" };
  const html = render({ history: { record: { ...record, outcome: { ...record.outcome, diagnostics } } } });
  assert.match(html, /Succeeded/);
  assert.match(html, /Outcome: committed/);
  assert.match(html, /Some history or check output is unavailable/);
  assert.doesNotMatch(html, /Execution may have changed|Approve exact commit|Retry/);
  const failed = render({ history: { record: { ...record, state: "failed", outcome: { status: "failed", diagnostics } } } });
  assert.match(failed, /Failed/);
  assert.doesNotMatch(failed, /Succeeded/);
  const check = checkRecord();
  check.outcome.checkoutVerification.runs[0].diagnostics = diagnostics;
  assert.match(render({ history: { record: check } }), /some diagnostics unavailable/);
  const pending = render({ history: { record: { ...record, state: "awaiting-decision", outcome: undefined, diagnostics } }, liveRequest: live, onRespond: () => {} });
  assert.match(pending, /Some history or check output is unavailable/);
  assert.match(pending, /Approve exact commit/);
  assert.match(pending, /Exact LIVE message/);
});

test("collapsed and expanded cards distinguish identical branches across projects and physical checkouts", () => {
  for (const project of ["/projects/alpha", "/projects/beta"]) {
    const source = `${project}-worktrees/feature`, target = `${project}-worktrees/target`;
    const scoped = { ...record, summary: { ...record.summary, repositoryRoot: source,
      projectRoot: project, sourceCheckoutRoot: source, targetCheckoutRoot: target,
      featureBranch: "feature", targetBranch: "main" } };
    for (const expanded of [false, true]) {
      const html = render({ history: { record: scoped }, expanded,
        artifact: expanded ? { record: scoped, candidate: { ...scoped.summary, diffUnavailable: "No patch" } } : null });
      for (const value of [`Captured project: ${project}`, `Source checkout: ${source}`, `Target checkout: ${target}`, "feature", "main"])
        assert.ok(html.includes(value), value);
      assert.doesNotMatch(html, /Approve exact commit/);
    }
  }
  const legacy = render({ expanded: true, artifact: { record, unavailable: "missing" } });
  assert.match(legacy, /Captured project: not recorded \(legacy action\)/);
  assert.match(legacy, /Target branch: target \(checkout not recorded\)/);
  assert.match(legacy, /Not recorded in this legacy action/);
  assert.doesNotMatch(legacy, /Target checkout:/);
});

test("new comparison capture is not labelled as human review; old acknowledged review remains distinct", () => {
  const base = { ...record, kind: "review", state: "succeeded", outcome: undefined,
    summary: { kind: "review", repositoryRoot: "/deleted/worktree", featureBranch: "feature", targetBranch: "target",
      featureOid: oid("c"), targetOid: oid("a"), selection: { kind: "merge" } } };
  const captured = render({ history: { record: { ...base, decision: undefined } } });
  assert.match(captured, /Git review.*Comparison captured/);
  assert.doesNotMatch(captured, /Succeeded|acknowledged|Approve|I reviewed/);
  const acknowledged = render({ history: { record: { ...base, decision: "reviewed" } }, expanded: true,
    artifact: { record: base, candidate: { ...base.summary, diffUnavailable: "Retained legacy placeholder" } } });
  assert.match(acknowledged, /Git review.*Comparison acknowledged by human/);
  assert.match(acknowledged, /decision: reviewed/);
  assert.doesNotMatch(acknowledged, /Comparison captured|Approve exact commit/);
  assert.match(render(), /Commit.*Succeeded/, "mutation result wording is unchanged");
  assert.match(render({ history: { record: { ...record, kind: "integration" } } }), /Local integration.*Succeeded/);
});

test("prepared intent is visible during recovery but never called a confirmed result", () => {
  const intended = { commit: oid("d"), mergeOid: oid("e"), tree: oid("f"), parents: [oid("a")], featureOid: oid("1"), targetOid: oid("2"), authorEmail: "prepared@example.test" };
  const html = render({ history: { record: { ...record, state: "recovery-required", intended, outcome: undefined } } });
  assert.match(html, /Prepared OIDs only — not confirmation of a ref or index update/);
  for (const label of ["Prepared commit", "Prepared merge", "Prepared tree", "Prepared parents", "Prepared feature", "Prepared target", "Prepared author"]) assert.ok(html.includes(`${label}:`));
  for (const value of [intended.commit, intended.mergeOid, intended.tree, intended.featureOid, intended.targetOid, intended.authorEmail]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, />Commit:|Merged commit:|Result tree:|Outcome:|Succeeded/);
  const completed = render({ history: { record: { ...record, intended } } });
  assert.match(completed, new RegExp(`Prepared commit: <span[^>]*>${intended.commit}`));
  assert.match(completed, new RegExp(`>Commit: <span[^>]*>${record.outcome.commit}`));
});

test("partial-state integration reports a proposed recovery merge, not a ref-updated commit", () => {
  const merge = { ...record, kind: "integration", state: "recovery-required", outcome: { status: "partial-state", mergeOid: oid("e"), tree: oid("f"), parents: [oid("a"), oid("b")], authorEmail: "prepared@example.test" } };
  const partial = render({ history: { record: merge } });
  assert.match(partial, /Outcome: partial-state/);
  assert.match(partial, new RegExp(`Proposed/recovery merge: <span[^>]*>${oid("e")}`));
  assert.match(partial, /Ref\/index completion is unconfirmed; files may have changed/);
  assert.match(partial, /Proposed\/recovery tree:/);
  assert.doesNotMatch(partial, />Commit:|Merged commit:|Result tree:|Succeeded/);
  const completed = render({ history: { record: { ...merge, state: "succeeded", outcome: { ...merge.outcome, status: "integrated" } } } });
  assert.match(completed, /Merged commit:/);
  assert.match(completed, /Result tree:/);
  assert.doesNotMatch(completed, /Proposed\/recovery merge:|completion is unconfirmed/);
  const partialCommit = render({ history: { record: { ...record, state: "recovery-required", outcome: { ...record.outcome, status: "partial-success" } } } });
  assert.match(partialCommit, new RegExp(`>Commit: <span[^>]*>${record.outcome.commit}`));
  assert.match(partialCommit, /Outcome: partial-success/);
  assert.doesNotMatch(partialCommit, /Proposed\/recovery commit/);
});

test("every historical state is read-only, especially awaiting decision and interrupted execution", () => {
  for (const state of ["proposed", "awaiting-decision", "executing", "succeeded", "declined", "cancelled", "expired", "blocked", "failed", "recovery-required"]) {
    const html = render({ history: { record: { ...record, state, outcome: undefined } } });
    assert.doesNotMatch(html, /Approve|Run these checks|Decline commit|I reviewed/);
    if (state !== "succeeded") assert.doesNotMatch(html, /Succeeded/);
    if (state === "recovery-required") assert.match(html, /Inspect before any new action/);
    if (state === "expired") assert.match(html, /Expired \/ interrupted/);
    if (state === "awaiting-decision") assert.match(html, /No live approval request is attached/);
  }
});

test("only the matching CURRENT request and real responder render actionable controls", () => {
  const pending = { history: { record: { ...record, state: "awaiting-decision", outcome: undefined } } };
  assert.doesNotMatch(render({ ...pending, liveRequest: live }), /Approve exact commit/);
  const missing = render({ history: { record: null, unavailable: "corrupt" }, liveRequest: live, onRespond: () => {} });
  assert.match(missing, /Approve exact commit/);
  assert.match(missing, /Exact LIVE message/);
  assert.match(missing, /corrupt/);
  assert.doesNotMatch(render({ ...pending, liveRequest: { ...live, candidate: { ...live.candidate, actionId: "another" } }, onRespond: () => {} }), /Approve exact commit/);
  for (const state of ["succeeded", "executing", "expired", "cancelled", "recovery-required"]) {
    assert.match(render({ history: { record: { ...record, state } }, liveRequest: live, onRespond: () => {} }), /Approve exact commit/);
    assert.doesNotMatch(render({ history: { record: { ...record, state } }, onRespond: () => {} }), /Approve exact commit/);
  }
  const html = render({ ...pending, liveRequest: live, onRespond: () => {}, interactionBlocked: true });
  assert.equal((html.match(/Approve exact commit/g) ?? []).length, 1);
  assert.match(html, /Exact LIVE message/);
  assert.match(html, /inert=""/);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.doesNotMatch(html, /Captured candidate/);
});

test("expand shows captured identities and honest missing/corrupt/oversized placeholders", () => {
  for (const unavailable of ["missing", "corrupt", "oversized"]) {
    const html = render({ expanded: true, artifact: { record, unavailable } });
    assert.match(html, new RegExp(`Captured artifact unavailable: ${unavailable}`));
    assert.match(html, /No current worktree data is substituted/);
    assert.match(html, /\/deleted\/worktree/);
    assert.match(html, /not included in the standard session HTML export/);
    assert.doesNotMatch(html, /Approve exact commit/);
  }
  assert.match(render({ history: { record: null, unavailable: "record pruned" } }), /record pruned/);
  assert.match(render({ expanded: true, artifact: { record, candidate: { ...record.summary, diffUnavailable: "Patch not captured" } } }), /Patch not captured/);
});

test("staged history names the index source; old cards do not assume whole-file mode", () => {
  const staged = { ...record, summary: { ...record.summary, commitMode: "staged" } };
  const html = render({ history: { record: staged }, expanded: true,
    artifact: { record: staged, candidate: { ...staged.summary, diffUnavailable: "Patch not captured" } } });
  assert.match(html, /Selected staged index paths/);
  const legacy = render({ expanded: true, artifact: { record, candidate: { ...record.summary, diffUnavailable: "Patch not captured" } } });
  assert.match(legacy, /Selected paths \(legacy mode not recorded\)/);
  assert.doesNotMatch(legacy, /Selected whole-file paths/);
});

test("fast-forward history records the existing tip without inventing a merge object", () => {
  const ff = { ...record, kind: "integration", summary: { kind: "integration", repositoryRoot: "/repo/feature",
    integrationMethod: "ff", featureOid: oid("c"), targetOid: oid("a") },
    outcome: { status: "integrated", featureOid: oid("c"), targetOid: oid("a"), tree: oid("b"), parents: [oid("a")] } };
  const html = render({ history: { record: ff }, expanded: true,
    artifact: { record: ff, candidate: { ...ff.summary, diffUnavailable: "Patch not captured" } } });
  assert.match(html, /Fast-forward to existing feature tip \(no new merge commit\)/);
  assert.doesNotMatch(html, /Proposed merge:|Merged commit:/);
  assert.match(html, /Parents/);
});

const instance = { device: "1", inode: "2", birthtime: "3" };
const physical = { gitDir: "/repo/.git", checkoutIdentity: instance, gitIdentity: instance, markerIdentity: instance };
function nativeRecord(kind, mode = "create") {
  const workspace = { mode, destinationPath: "/deleted/destination", baseBranch: "main", baseOid: oid("a"), branch: "feature/new", tipOid: oid("b"), treeOid: oid("d") };
  const preparation = { oldSourceOid: oid("a"), newSourceOid: oid("b"), targetMainOid: oid("c"), resultTreeOid: oid("d"),
    commitCount: 1, emptyRetention: "keep", source: physical, target: physical };
  return { ...record, kind, decision: undefined, summary: { kind, repositoryRoot: "/deleted/source", projectRoot: "/deleted/project", sourceCheckoutRoot: "/deleted/source",
    ...(kind === "workspace" ? { workspace } : { preparation, targetCheckoutRoot: "/deleted/target", featureBranch: "feature", targetBranch: "main" }) },
    outcome: kind === "workspace" ? { kind, status: mode === "create" ? "created" : "attached", workspace: { mode, destinationPath: workspace.destinationPath, branch: workspace.branch, tipOid: workspace.tipOid, treeOid: oid("d") } }
      : { kind, status: "prepared", preparation: { oldSourceOid: oid("a"), newSourceOid: oid("b"), targetMainOid: oid("c"), resultTreeOid: oid("d") } } };
}

test("workspace and preparation history truthfully label verified results without inventing human review", () => {
  for (const [kind, mode, title] of [["workspace", "create", "Created worktree"], ["workspace", "attach", "Attached worktree"], ["preparation", "create", "Prepared history"]]) {
    const native = nativeRecord(kind, mode);
    for (const expanded of [false, true]) {
      const html = render({ history: { record: native }, expanded, artifact: { record: native, candidate: native.summary } });
      assert.ok(html.includes(title));
      assert.match(html, /Captured project: \/deleted\/project/);
      assert.doesNotMatch(html, /human|reviewed|Approve|Run these checks|Succeeded/);
      for (const value of [oid("b"), oid("d")]) assert.ok(html.includes(value));
      if (expanded) {
        assert.match(html, /No immutable patch was captured/);
        if (kind === "workspace") for (const value of ["Explicit destination", "Chosen local base", "Intended branch/tip", "Expected tracked tree", "feature/new"]) assert.ok(html.includes(value));
        else for (const value of ["Target main", "retain empty commits", "Source physical instance", "Target physical instance"]) assert.ok(html.includes(value));
      }
    }
  }
  const prepared = nativeRecord("preparation");
  const noOp = render({ history: { record: { ...prepared, outcome: { ...prepared.outcome, status: "already-prepared" } } } });
  assert.match(noOp, /Already prepared \(no rewrite\)/);
  assert.doesNotMatch(noOp, /Prepared history|human/);
});

test("new-kind pending/refused/partial records never synthesize approvals or claim completed effects", () => {
  for (const kind of ["workspace", "preparation"]) {
    const native = nativeRecord(kind);
    for (const state of ["proposed", "awaiting-decision", "executing", "cancelled", "blocked", "expired", "recovery-required"]) {
      const pending = { ...native, state, outcome: undefined, reason: state === "blocked" ? "Conflict/stale refusal before native operation." : undefined };
      const html = render({ history: { record: pending }, onRespond: () => {} });
      assert.doesNotMatch(html, /Created worktree|Attached worktree|Prepared history|Approve exact commit|Decline commit|human/);
      if (state === "blocked") assert.match(html, /Conflict\/stale refusal before native operation/);
      if (state === "cancelled" || state === "blocked" || state === "expired") assert.doesNotMatch(html, /manual recovery|Execution may have changed/);
    }
    const partial = render({ history: { record: { ...native, state: "recovery-required", outcome: { ...native.outcome, status: "partial-state" } } } });
    assert.match(partial, /Completion is unconfirmed/);
    assert.match(partial, /manual recovery; do not retry/);
    assert.doesNotMatch(partial, /Created worktree|Attached worktree|Prepared history|Result tree:/);
  }
});

test("only an actual matching live new-kind request renders simple approval controls; history remains read-only", () => {
  for (const kind of ["workspace", "preparation"]) {
    const native = nativeRecord(kind);
    const candidate = { ...native.summary, actionId: id, resourceAttribution: { version: 2, commonDir: "/deleted/project/.git", commonIdentity: instance, projectIdentity: instance } };
    if (kind === "preparation") candidate.preparation = { ...candidate.preparation, commitMapping: [] };
    const request = { type: "extension_ui_request", method: "git_action", id: "actual-new-live", candidate };
    const pending = { ...native, state: "awaiting-decision", outcome: undefined };
    const props = { history: { record: pending }, liveRequest: request, onRespond: () => {} };
    assert.match(render(props), /Approve exact (worktree creation|history preparation)/);
    assert.doesNotMatch(render(props), /type="checkbox"|Captured candidate|I reviewed/);
    assert.doesNotMatch(render({ ...props, onRespond: undefined }), /Approve exact/);
    assert.doesNotMatch(render({ ...props, liveRequest: { ...request, candidate: { ...candidate, actionId: "other" } } }), /Approve exact/);
    for (const state of ["succeeded", "executing", "cancelled", "expired", "recovery-required"]) {
      assert.match(render({ ...props, history: { record: { ...pending, state } } }), /Approve exact/);
      assert.doesNotMatch(render({ ...props, liveRequest: null, history: { record: { ...pending, state } } }), /Approve exact/);
    }
  }
});

test("preparation mapping is lazy captured evidence only, retaining empty-commit labels", () => {
  const native = nativeRecord("preparation");
  const candidate = { ...native.summary, preparation: { ...native.summary.preparation,
    commitMapping: [{ oldOid: oid("a"), newOid: oid("b"), oldTreeOid: oid("c"), newTreeOid: oid("d"), emptyAfterReplay: true }] } };
  const html = render({ history: { record: native }, expanded: true, artifact: { record: native, candidate } });
  assert.match(html, /Captured commit mapping/);
  assert.match(html, /empty commit retained/);
  assert.doesNotMatch(html, /Approve|live filesystem/);
});

test("workspace history explicitly retains measured parent-created facts, including partial recovery", () => {
  const native = nativeRecord("workspace"), measured = { path: "/deleted/project-worktrees", identity: instance, mode: 448, ownerUid: 1000, ancestorPath: "/deleted", ancestorIdentity: instance };
  const scoped = { ...native, state: "recovery-required", summary: { ...native.summary, workspace: { ...native.summary.workspace, parentCreation: { path: measured.path, expectedAbsent: true, mode: 448, ancestorPath: measured.ancestorPath, ancestorIdentity: instance } } },
    outcome: { ...native.outcome, status: "partial-state", workspace: { ...native.outcome.workspace, parentCreated: true, knownParentCreation: measured } } };
  const html = render({ history: { record: scoped }, expanded: true, artifact: { record: scoped, candidate: scoped.summary } });
  assert.match(html, /Measured parent created: true/);
  assert.match(html, /owner UID 1000/);
  assert.match(html, /Additional expected-absent parent/);
  assert.match(html, /manual recovery; do not retry/);
  assert.doesNotMatch(html, /Created worktree|Approve exact/);
  const unidentified = { ...scoped, outcome: { ...scoped.outcome, workspace: { ...scoped.outcome.workspace, knownParentCreation: undefined,
    parentCreationAttempted: true, phase: "create-parent", addAttempted: false, observedBranchOid: null, destinationPresent: false } } };
  const uncertain = render({ history: { record: unidentified } });
  assert.match(uncertain, /physical identity unconfirmed/);
  assert.match(uncertain, /Worktree add attempted: false/);
  assert.match(uncertain, /Observed local branch: absent/);
  assert.match(uncertain, /Destination present: false/);
  assert.doesNotMatch(uncertain, /Created worktree|Measured parent created/);
});

function checkRecord(stage = "commit") {
  const bound = { evidenceScope: stage === "commit" ? "working-workspace" : "clean-checkout", candidateTreeVerified: false, repositoryChecksWaived: false, sourceOid: oid("a"), sourceTreeOid: oid("b"), snapshotDigest: "1".repeat(64), policyDigest: "2".repeat(64), policyRevision: "source-policy", stage, requiredSavedIndexes: stage === "none" ? [] : [7] };
  const actual = { actionId: id, sessionId: "old-owner", checkIndex: 7, stage, recipeDigest: "3".repeat(64), policyDigest: bound.policyDigest, snapshotDigest: bound.snapshotDigest, environmentDigest: "4".repeat(64), executionCwd: "/deleted/source", startedAt: 1000, finishedAt: 1500, unit: "pi-web-check-fixture.service", cgroupIdentity: "1:2", invocation: "f".repeat(32), exitStatus: 0, containmentComplete: true, timedOut: false, overflow: false, logDigest: "5".repeat(64), logBytes: 10, receipt: { id, sha256: "6".repeat(64), expiresAt: 2000 } };
  return { ...record, kind: "checkout-verification", decision: undefined, summary: { kind: "checkout-verification", repositoryRoot: "/deleted/source", projectRoot: "/deleted/project", sourceCheckoutRoot: "/deleted/source", featureBranch: "feature",
    checkoutVerification: { ...bound, source: physical, checks: [{ checkIndex: 7, recipe: { label: "Saved tests", argv: ["npm", "test"], requiredStage: stage }, recipeDigest: actual.recipeDigest, environmentDigest: actual.environmentDigest, executionCwd: actual.executionCwd }] } },
    outcome: { kind: "checkout-verification", status: "passed", checkoutVerification: { ...bound, runs: [actual] } } };
}
function cleanupRecord() {
  const cleanup = { sourcePath: "/deleted/source", targetPath: "/deleted/target", mainPath: "/deleted/main", branchRef: "refs/heads/feature", featureOid: oid("a"), targetOid: oid("c"), mainOid: oid("c"),
    source: physical, target: physical, main: physical, ignoredCount: 2, ignoredDeletion: "exact-approval-required",
    integration: { method: "merge", resultOid: oid("c"), resultTree: oid("d") }, provenance: { mode: "create", originalSourcePath: "/deleted/original" } };
  return { ...record, kind: "cleanup", decision: "approved", summary: { kind: "cleanup", repositoryRoot: "/deleted/source", projectRoot: "/deleted/project", sourceCheckoutRoot: "/deleted/source", targetCheckoutRoot: "/deleted/target", featureBranch: "feature", targetBranch: "main", cleanup },
    outcome: { kind: "cleanup", status: "partial-state", cleanup: { ...cleanup, effects: [{ kind: "worktree-removed", sourcePath: cleanup.sourcePath, featureOid: cleanup.featureOid }], observedFeatureOid: oid("a") } }, state: "recovery-required" };
}

test("distinct checkout history is target-free and labels actual receipt/unit/log metadata as working-workspace evidence only", () => {
  const native = checkRecord(), html = render({ history: { record: native }, expanded: true, artifact: { record: native, candidate: native.summary } });
  for (const value of ["Checkout verification", "Checks passed in working workspace", "candidateTreeVerified: false", "repositoryChecksWaived: false", "Actual saved index 7", "pi-web-check-fixture.service", "cgroup 1:2", "log", "captured receipt", "digest"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /Target checkout:|Target branch:|Approve|Run these saved checks|Comparison acknowledged by human/);
  assert.match(html, /No log contents, live receipt, integration approval or human acknowledgement is restored/);
  const manual = render({ history: { record: checkRecord("none") } });
  assert.match(manual, /Manual-only optional receipts, not integration prerequisites/);
  const missing = render({ history: { record: { ...native, outcome: undefined } } });
  assert.match(missing, /Outcome unconfirmed/);
  assert.doesNotMatch(missing, /Checks passed in working workspace/);
  const commit = { ...record, summary: { ...record.summary, workingWorkspaceVerification: { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false, requiredSavedIndexes: [7], runs: native.outcome.checkoutVerification.runs } } };
  assert.match(render({ history: { record: commit } }), /Commit check evidence: working-workspace/);
});

test("independent native v2 history labels clean source evidence without dirty-workspace or paired claims", () => {
  const native = checkRecord("integration");
  const html = render({ history: { record: native }, expanded: true, artifact: { record: native, candidate: native.summary } });
  for (const value of ["Checks passed in selected clean checkout", "Evidence scope: clean-checkout", "native v2 clean-source checks only", "selected clean checkout (native v2)",
    "candidateTreeVerified: false", "repositoryChecksWaived: false", "Actual saved index 7"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /Checks passed in working workspace|Target checkout:|Target branch:|Approve|Retry/);
  assert.match(html, /not dirty working-workspace, paired checks or integration approval/);
  const pending = render({ history: { record: { ...native, state: "executing" } } });
  assert.match(pending, /settlement pending/);
  assert.doesNotMatch(pending, /Checks passed in selected clean checkout|Checks passed in working workspace/);
});

test("presettlement check facts never present proposed receipt metadata as published passing evidence", () => {
  const native = checkRecord();
  const pending = render({ history: { record: { ...native, state: "executing" } } });
  assert.match(pending, /Measured check result \(settlement pending\): passed/);
  assert.match(pending, /Native settlement pending; proposed receipt metadata is not a published passing receipt/);
  assert.match(pending, /exit 0/);
  assert.doesNotMatch(pending, /Checks passed in working workspace|Outcome: passed|Approve|Retry/);
  const recovery = render({ history: { record: { ...native, state: "recovery-required", outcome: { ...native.outcome, status: "partial-state" } } } });
  assert.match(recovery, /Native settlement unconfirmed; receipt metadata is not proof of publication/);
  assert.match(recovery, /exit 0/);
  assert.doesNotMatch(recovery, /Checks passed in working workspace|Approve|Retry/);
});

test("cleanup history names each measured effect/known OID and partial recovery without authorizing deletion", () => {
  const native = cleanupRecord();
  const html = render({ history: { record: native }, expanded: true, artifact: { record: native, candidate: { ...native.summary, cleanup: { ...native.summary.cleanup, ignored: [{ path: "cache", kind: "directory", size: "12", ...instance }, { path: "cache/important", kind: "file", size: "12", ...instance }] } } } });
  for (const value of ["Measured worktree/admin removal", "known source tip", oid("a"), "Observed recovery branch tip", "Surviving target", "Workspace provenance", "cache/important", "History never authorizes deletion"]) assert.ok(html.includes(value), value);
  assert.match(html, /Partial cleanup requires manual recovery; this card cannot retry it/);
  assert.doesNotMatch(html, /Cleaned up local workspace|Approve cleanup|Measured local branch deletion/);
  const completed = { ...native, state: "succeeded", outcome: { ...native.outcome, status: "cleaned-up", cleanup: { ...native.outcome.cleanup, effects: [...native.outcome.cleanup.effects, { kind: "branch-deleted", branchRef: "refs/heads/feature", deletedOid: oid("a") }] } } };
  assert.match(render({ history: { record: completed } }), /Measured local branch deletion/);
  assert.doesNotMatch(render({ history: { record: { ...completed, outcome: undefined } } }), /Cleaned up local workspace/);
  for (const kind of [checkRecord(), native]) for (const state of ["proposed", "awaiting-decision", "executing", "cancelled", "expired", "recovery-required"]) {
    const historical = { ...kind, state, outcome: undefined };
    assert.doesNotMatch(render({ history: { record: historical }, onRespond: () => {} }), /Run these saved checks|Approve cleanup|Approve exact commit/);
    assert.match(render({ history: { record: historical }, liveRequest: live, onRespond: () => {} }), /Approve exact commit/);
  }
});

test("binary and unavailable immutable workspace patches never substitute live filesystem content", () => {
  const native = nativeRecord("workspace");
  const candidate = { ...native.summary, diff: { fromTreeOid: oid("a"), toTreeOid: oid("d"), patch: "diff --git a/image b/image\nBinary files a/image and b/image differ\n", hasBinaryChanges: true } };
  const html = render({ history: { record: native }, expanded: true, artifact: { record: native, candidate } });
  assert.match(html, /Binary changes are summarized/);
  assert.match(html, /binary file contents were not captured as text/);
  const missing = render({ history: { record: native }, expanded: true, artifact: { record: native, candidate: { ...native.summary, diffUnavailable: "Binary patch was not captured" } } });
  assert.match(missing, /Binary patch was not captured/);
  assert.match(missing, /No current worktree data is substituted/);
});

test("live native Ask can lazily show its exact captured patch without a stored history row", () => {
  const pending = { ...nativeRecord("workspace"), state: "awaiting-decision", outcome: undefined };
  const request = { type: "extension_ui_request", method: "git_action", id: "current-native-request", candidate: { ...pending.summary, actionId: id,
    resourceAttribution: { version: 2, commonDir: "/deleted/project/.git", commonIdentity: instance, projectIdentity: instance } } };
  const candidate = { ...pending.summary, diff: { fromTreeOid: oid("a"), toTreeOid: oid("d"), hasBinaryChanges: false,
    patch: "diff --git a/exact b/exact\n--- a/exact\n+++ b/exact\n@@ -1 +1 @@\n-old\n+ONLY_CAPTURED_CONTENT\n" } };
  const props = { history: { record: null, unavailable: "anchor unavailable" }, expanded: true, liveRequest: request, onRespond: () => {},
    artifact: { record: pending, candidate } };
  const html = render(props);
  assert.match(html, /Hide captured patch/);
  assert.match(html, /ONLY_CAPTURED_CONTENT/);
  assert.match(html, /Approve exact worktree creation/);
  assert.match(html, /anchor unavailable/);
  const historical = render({ ...props, artifact: { record: { ...pending, state: "succeeded" }, candidate } });
  assert.doesNotMatch(historical, /ONLY_CAPTURED_CONTENT/);
  assert.match(historical, /Historical data cannot replace the live candidate/);
  assert.match(historical, /Approve exact worktree creation/);
  assert.doesNotMatch(render({ ...props, liveRequest: null }), /Approve exact/);
});

test("artifact request is gated on expansion; no focus theft, model calls or approval reconstruction", async () => {
  const source = await readFile(new URL("./GitActionCard.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!expanded \|\| !sessionId\) return/);
  assert.match(source, /readGitActionHistory\(sessionId, actionId, true, controller.signal\)/);
  const artifactRead = source.slice(source.indexOf("void readGitActionHistory"), source.indexOf("  return <div ref="));
  assert.doesNotMatch(artifactRead, /setHistory\(/, "slow artifact reads cannot restore live state");
  assert.match(source, /registerAnchor\?\.\(actionId\)/);
  assert.match(source, /GitActionDialog key=\{request.id\} request=\{request\} onRespond=\{onRespond\}/);
  assert.doesNotMatch(source, /\.focus\(|autoFocus|sendAgentCommand|approvePlanId|reviewToken|\/api\/agent|\/api\/files/);
});
