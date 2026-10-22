import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
// These are production leaves: no server, SDK, settings store or Git fixture.
const { validateArtifactRoots, permittedArtifactRoots, unapprovedArtifactRoots, artifactParentsOf, pathKey } = await jiti.import("./artifact-rules.ts");
const { invocationPolicy, relevantPolicy, operationAuthorization } = await jiti.import("./operation-rules.ts");
const { browserDiscardOperation, validateBrowserDiscardOperation, discardLossEvidence, requiresDiscardLossAcknowledgment } = await jiti.import("./discard.ts");
const { browserDiscardCard, cleanupCard } = await jiti.import("./resource-cards.ts");
const { gitWorkflowManifest, actions } = await jiti.import("./manifest.ts");
const defaults = () => Object.fromEntries(Object.entries(gitWorkflowManifest.fields).map(([key, field]) => [key, structuredClone(field.default)]));
const tip = "a".repeat(40), targetTip = "b".repeat(40);
const comparison = { branch: "main", tip: targetTip };
const payload = { subject: { kind: "branch", branch: "feature", tip }, removeWorktree: true, deleteBranch: true, worktreePath: "/feature", comparisonTarget: comparison };
const cleanupOp = { action: "cleanupFeature", checkout: "/repo", featureBranch: "feature", featureTip: tip, integrationCommit: targetTip, removeWorktree: true, deleteBranch: true, worktreePath: "/feature", artifactRoots: [] };
const capture = (extra = {}) => ({ cwd: "/repo", path: "/feature", target: "main", identity: "identity", repositoryIdentity: "repository", fingerprint: "fresh",
  artifacts: [{ path: "src/cache", entries: 2, bytes: 13, digest: "c".repeat(64) }, { path: "types.d.ts", entries: 1, bytes: 0, digest: "d".repeat(64) }],
  unapprovedArtifacts: ["src/cache"], artifactParents: ["src"], artifactParentMetadata: [], artifactParentIdentities: [], ...extra });

test("literal roots reject traversal, metadata aliases, malformed values and normalized overlap", () => {
  const invalid = [["src/meetings", "src/meetings/__pycache__"], ["src/meetings/__pycache__", "SRC/MEETINGS/__PYCACHE__"],
    ["src//cache"], ["src/./cache"], ["src/../cache"], ["/src/cache"], ["src\\cache"], ["src/.GIT/cache"], ["src/.git./cache"], ["src/cache/"],
    ...[".GIT", ".git.", ".GiT...", ".", "..", "...", ""].map((name) => [name]),
    ["cache", "cache"], ["cache.", "CACHE..."], ["CACHE./child", "cache"], ["cache", 1], [null], null, "cache"];
  for (const roots of invalid) assert.throws(() => validateArtifactRoots(roots), /literal relative|overlap or alias/, JSON.stringify(roots));
  for (const root of [".GIT", ".git.", ".GiT...", ".", "..", "...", "src/.GIT/cache", "src//cache", "src\\cache"]) {
    assert.throws(() => permittedArtifactRoots(root), /Invalid configured/, root);
  }
  for (const roots of [[], ["node_modules", "next-env.d.ts"], ["src/meetings/__pycache__", "src/meetings/main.pyc"], ["..cache", "cache-two", "cache/child"]]) {
    assert.doesNotThrow(() => validateArtifactRoots(roots));
  }
  assert.deepEqual(permittedArtifactRoots(null), []);
  assert.deepEqual(permittedArtifactRoots(" , node_modules, src/cache, , types.d.ts "), ["node_modules", "src/cache", "types.d.ts"]);
  assert.deepEqual(artifactParentsOf(["src/meetings/cache", "src/other/cache"]), ["src", "src/meetings", "src/other"]);
  assert.equal(pathKey("SRC./Meetings.../CACHE"), "src/meetings/cache");
});

test("reusable artifact authority is exact, not parent, child, case or trailing-dot authority", () => {
  const root = "src/meetings/__pycache__";
  for (const permitted of ["src", "src/meetings", root, root.toUpperCase(), `${root}.`, `${root}/child`]) {
    assert.deepEqual(unapprovedArtifactRoots([root], permittedArtifactRoots(permitted)), permitted === root ? [] : [root]);
  }
  assert.deepEqual(unapprovedArtifactRoots(["node_modules", "types.d.ts"], ["node_modules"]), ["types.d.ts"]);
});

test("authorization matrix never turns artifact selection or browser Allow into authority", () => {
  for (const permission of ["deny", "ask", "allow"]) for (const artifactApproval of [false, true]) for (const browser of [false, true]) for (const source of ["built-in", "global", "project", "session"]) {
    if (permission === "deny") { assert.throws(() => operationAuthorization(permission, source, artifactApproval, browser), /denied/); continue; }
    const auth = operationAuthorization(permission, source, artifactApproval, browser);
    const mode = browser || artifactApproval ? "ask" : permission;
    assert.equal(auth.mode, mode);
    assert.equal(auth.decision, mode === "allow" ? "policy-authorized" : "pending");
    assert.equal(auth.source, browser ? `manual browser confirmation (${source} ${permission})` : artifactApproval ? `one-time artifacts (${source} ${permission})` : source);
    assert.equal(auth.subtitle, browser ? "Manual browser confirmation required" : artifactApproval ? "One-time artifact approval required" : mode === "allow" ? "Policy-authorized operation" : "Approval required");
  }
});

test("invocation choices obey designated/configured targets and methods without mutating policy", () => {
  for (const action of ["merge", "rebase", "cleanupFeature"]) for (const selection of ["ask", "configured"]) for (const targetBranch of [null, "main"]) for (const browser of [false, true]) {
    const policy = Object.freeze({ ...defaults(), targetSelection: selection, targetBranch });
    const op = { ...cleanupOp, action, targetBranch: "other" };
    if (targetBranch && (browser || selection === "configured")) assert.throws(() => invocationPolicy(policy, op, browser), /target|Target/);
    else { assert.equal(invocationPolicy(policy, op, browser).targetBranch, "other"); assert.equal(policy.targetBranch, targetBranch); }
  }
  for (const selection of ["ask", "configured"]) for (const method of ["ff-only", "non-ff", "squash"]) {
    const policy = Object.freeze({ ...defaults(), methodSelection: selection });
    const op = { action: "merge", checkout: "/repo", featureBranch: "feature", mergeMethod: method };
    if (method === "squash") assert.throws(() => invocationPolicy(policy, op), /Invalid merge method/);
    else if (selection === "configured" && method !== policy.mergeMethod) assert.throws(() => invocationPolicy(policy, op), /Method differs/);
    else assert.equal(invocationPolicy(policy, op).mergeMethod, method);
    assert.equal(policy.mergeMethod, "non-ff");
  }
  assert.throws(() => invocationPolicy(defaults(), { action: "rebase", mergeMethod: "ff-only" }), /Invalid merge method/);
});

test("policy projection includes each relevant field and excludes unrelated permissions and workflow choices", () => {
  const owned = {
    commit: ["commit", "commitChecks"], rebase: ["rebase", "targetSelection", "targetBranch"],
    merge: ["merge", "mergeChecks", "targetSelection", "targetBranch", "methodSelection", "mergeMethod"],
    createWorktree: ["createWorktree"], attachWorktree: ["attachWorktree"], removeWorktree: ["removeWorktree"],
    cleanupFeature: ["cleanupFeature", "targetSelection", "targetBranch", "cleanupWorktree", "cleanupBranch", "cleanupArtifacts", "approvedArtifactRoots"],
    discardResources: ["discardResources", "targetBranch", "approvedArtifactRoots"],
  };
  const policy = defaults();
  for (const [action, fields] of Object.entries(owned)) for (const key of Object.keys(policy)) {
    const changed = { ...policy, [key]: `changed-${key}` };
    if (fields.includes(key)) assert.notDeepEqual(relevantPolicy(changed, action), relevantPolicy(policy, action), `${action}/${key}`);
    else assert.deepEqual(relevantPolicy(changed, action), relevantPolicy(policy, action), `${action}/${key}`);
  }
});

test("strict browser payload rejects authority switches and malformed subjects without native setup", () => {
  const valid = { subject: payload.subject, removeWorktree: false, deleteBranch: true };
  assert.deepEqual(browserDiscardOperation(valid, "/repo"), { ...valid, action: "discardResources", checkout: "/repo", artifactRoots: [] });
  assert.equal(browserDiscardOperation({ ...valid, subject: { ...valid.subject, tip: "a".repeat(64) } }, "/repo").subject.tip.length, 64);
  for (const invalid of [null, [], { ...valid, acknowledgeUnintegratedLoss: true }, { ...valid, skipIntegration: true }, { ...valid, ignoreKeep: true },
    { ...valid, artifactRoots: [] }, { ...valid, subject: { ...valid.subject, skipIntegration: true } },
    { ...valid, subject: { kind: "branch", branch: "HEAD", tip } }, { ...valid, subject: { ...valid.subject, tip: "abcd" } },
    { ...valid, removeWorktree: true }, { ...valid, worktreePath: "/other" }, { ...valid, deleteBranch: false },
    { ...valid, subject: { kind: "detached", head: tip } },
    { ...valid, subject: { kind: "detached", head: tip }, removeWorktree: true, worktreePath: "/other" },
    { ...valid, comparisonTarget: { ...comparison, authority: true } }]) assert.throws(() => browserDiscardOperation(invalid, "/repo"));
  const op = browserDiscardOperation(payload, "/repo");
  for (const invalid of [{ ...op, artifactRoots: ["cache"] }, { ...op, bypass: true }, { ...op, action: "cleanupFeature" }]) assert.throws(() => validateBrowserDiscardOperation(invalid));
  assert.equal(actions.includes("discardResources"), false);
  assert.equal(defaults().discardResources, "ask");
});

test("graph classification distinguishes absent containment, unknown graph and lost comparison proof", () => {
  for (const contained of ["yes", "no", "unknown"]) for (const retained of ["yes", "no", "unknown"]) {
    const evidence = discardLossEvidence(comparison, contained, retained);
    assert.equal(evidence.state, retained !== "yes" ? "unknown" : contained === "yes" ? "integrated" : contained === "no" ? "not-integrated" : "unknown");
    assert.equal(evidence.reason, retained !== "yes" ? "comparison-proof-lost" : contained === "unknown" ? "graph-unavailable-or-incomplete" : undefined);
    assert.deepEqual(evidence.comparisonTarget, comparison);
  }
});

test("final browser cards derive loss acknowledgment from captured evidence and effects, not configured permission", () => {
  for (const evidence of [{ state: "integrated", comparisonTarget: comparison }, { state: "not-integrated", comparisonTarget: comparison },
    { state: "unknown", reason: "graph-unavailable-or-incomplete", comparisonTarget: comparison }, { state: "unknown", reason: "no-comparison-target" }]) {
    for (const permission of ["ask", "allow"]) for (const deleteBranch of [false, true]) {
      const op = { ...browserDiscardOperation(payload, "/repo"), deleteBranch, ...(evidence.reason === "no-comparison-target" ? { comparisonTarget: undefined } : {}) };
      const snapshot = capture({ lossEvidence: evidence }); const before = structuredClone({ op, snapshot });
      const card = browserDiscardCard(op, { ...defaults(), discardResources: permission, targetBranch: "designated" }, snapshot);
      const needs = deleteBranch && evidence.state !== "integrated";
      assert.equal(requiresDiscardLossAcknowledgment(op, evidence), needs);
      assert.equal(Boolean(card.requiredAcknowledgment), needs);
      assert.equal(card.sections.some((section) => section.title === "Branch loss warning"), needs);
      assert.equal(card.fields.find((field) => field.label === "Integration evidence").value, `${evidence.state}${evidence.reason ? `: ${evidence.reason}` : ""}`);
      assert.equal(card.fields.find((field) => field.label === "Protected designated target").value, "designated");
      assert.equal(card.fields.find((field) => field.label === "Captured comparison (not policy authority)").value, op.comparisonTarget ? `main at ${targetTip}` : "None");
      assert.equal(operationAuthorization(permission, "project", false, true).mode, "ask");
      assert.deepEqual({ op, snapshot }, before);
    }
  }
  const op = browserDiscardOperation({ ...payload, subject: { kind: "detached", head: tip }, deleteBranch: false }, "/repo");
  const card = browserDiscardCard(op, defaults(), capture({ lossEvidence: { state: "unknown" } }));
  assert.equal(card.requiredAcknowledgment, undefined);
  assert.ok(card.sections.some((section) => section.title === "Detached commit warning"));
  assert.match(card.fields.find((field) => field.label === "Exact subject").value, /Detached HEAD/);
});

test("resource cards show every exact inventory entry and one-time authority without altering captures", () => {
  for (const unapprovedArtifacts of [[], ["src/cache"], ["src/cache", "types.d.ts"]]) {
    const snapshot = capture({ unapprovedArtifacts, lossEvidence: { state: "unknown" } });
    const before = structuredClone(snapshot);
    for (const card of [cleanupCard(cleanupOp, snapshot), browserDiscardCard(browserDiscardOperation(payload, "/repo"), defaults(), snapshot)]) {
      const fields = card.sections.find((section) => section.title === "Generated files and directories to remove").fields;
      assert.deepEqual(fields, snapshot.artifacts.map((item) => ({ label: item.path, code: true,
        value: `${unapprovedArtifacts.includes(item.path) ? "Needs one-time approval" : "Permitted by settings"} · ${item.entries} entries · ${item.bytes} bytes · SHA256 ${item.digest}` })));
      assert.equal(card.sections.some((section) => section.title === "One-time artifact permission"), !!unapprovedArtifacts.length);
      assert.equal(card.actions.filter((action) => action.primary).length, 1);
      assert.match(card.scope, /resources together/);
    }
    assert.deepEqual(snapshot, before);
  }
});
