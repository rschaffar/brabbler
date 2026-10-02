import assert from "node:assert/strict";
import test from "node:test";
import { createGitPreparationReentryController, GitPreparationReentryError } from "./git-preparation-reentry.ts";

const oldOid = "a".repeat(40), newOid = "b".repeat(40), targetOid = "c".repeat(40), treeOid = "d".repeat(40);
const copy = (value) => structuredClone(value);
const identity = (inode) => ({ device: "1", inode: String(inode), birthtime: "100" });
function resource(branch, inode) {
  return { projectRoot: "/repo", cwd: `/repo/${branch}`, branch, commonDir: "/repo/.git",
    gitDir: `/repo/.git/worktrees/${branch}`, identities: { project: identity(1), common: identity(2),
      checkout: identity(inode), git: identity(inode + 1), marker: { ...identity(inode + 2), changed: "50", size: "20" } } };
}
function state(overrides = {}) {
  return { sessionId: "session", operationId: "request", policyRevision: "policy-1",
    source: resource("feature", 10), target: resource("main", 20), sourceOid: newOid, targetOid, ...overrides };
}
function refused(fn, code) {
  assert.throws(fn, (error) => error instanceof GitPreparationReentryError && error.code === code);
}
function fixture({ lifetimeMs = 1000, pendingLifetimeMs } = {}) {
  let clock = 100;
  // Model TRUSTED registries: only completing server-owned operations writes
  // these WeakMaps. Untrusted objects/history never become entries. No Git or
  // filesystem mutation is performed by this standalone unit suite.
  const preparations = new WeakMap(), verifications = new WeakMap(), reconciliations = new WeakMap();
  const options = { now: () => clock, lifetimeMs, pendingLifetimeMs,
    readPreparationResult: (handle) => preparations.get(handle),
    readVerificationResult: (handle) => verifications.get(handle),
    readReconciliationResult: (handle) => reconciliations.get(handle) };
  const controller = createGitPreparationReentryController(options);
  function completedPreparation({ after = state(), result, before, completedAt = clock } = {}) {
    const native = result ?? { status: "prepared", oldSourceOid: oldOid, newSourceOid: after.sourceOid,
      targetOid: after.targetOid, treeOid, recoveryPath: "/private/recovery" };
    const handle = Object.freeze({ result: native });
    const proof = { context: controller.issuer.context, result: native,
      before: before ?? { ...copy(after), sourceOid: native.oldSourceOid }, after: copy(after), completedAt };
    preparations.set(handle, proof);
    return { handle, proof };
  }
  function completedVerification(launch, { before = state(), after = before, status = "passed", receiptIds = ["check-1"], completedAt = clock } = {}) {
    const handle = Object.freeze({ status, receiptIds });
    verifications.set(handle, { launch, before: copy(before), after: copy(after), status, receiptIds, completedAt });
    return handle;
  }
  function completedReconciliation({ before = state(), after = before, context = controller.issuer.context,
    startedAt = clock, completedAt = clock, status = "completed", disposition = "revalidated", previousLaunch,
    independentlyProven = true } = {}) {
    const handle = Object.freeze({ status, disposition });
    const proof = { context, startedAt, completedAt, before: copy(before), after: copy(after), status, disposition, previousLaunch };
    // Model independent native/admission/recovery/containment work completing:
    // flags in an argument do NOT put unproven objects into the trusted registry.
    if (independentlyProven) reconciliations.set(handle, proof);
    return { handle, proof };
  }
  function reconcile(args) {
    return controller.issuer.publishReconciliationResult(completedReconciliation(args).handle);
  }
  function publish(args) {
    return controller.issuer.publishPreparationResult(completedPreparation(args).handle);
  }
  function consume(dependency, { stage = "verify", current = state(), receiptIds = [] } = {}) {
    return controller.gate.consume({ stage, revisionDependency: dependency, state: current, receiptIds });
  }
  return { ...controller, options, completedPreparation, completedVerification, completedReconciliation, reconcile, publish, consume,
    setClock: (value) => { clock = value; } };
}

test("plain native result, candidate, snapshots, approval, receipt and copied history cannot issue", () => {
  const f = fixture();
  for (const handle of [state(), { status: "prepared", oldSourceOid: oldOid, newSourceOid: newOid, targetOid, treeOid },
    { status: "candidate" }, { approved: true }, { receiptIds: ["passing-check"] }, { actionId: "journal-entry" }]) {
    refused(() => f.issuer.publishPreparationResult(handle), "unissued-result");
  }
  const completed = f.completedPreparation();
  refused(() => f.issuer.publishPreparationResult(copy(completed.handle)), "unissued-result");
  refused(() => f.issuer.publishPreparationResult(completed.proof), "unissued-result");
  const issued = f.issuer.publishPreparationResult(completed.handle);
  assert.match(issued.revisionDependency, /^[a-f0-9]{64}$/);
  refused(() => f.issuer.publishPreparationResult(completed.handle), "unissued-result");
});

test("prequeued/batched guessing cannot launch before result or reuse preparation token for integration", () => {
  const f = fixture(), launchRequest = { stage: "verify", state: state(), receiptIds: [] };
  refused(() => f.gate.consume(launchRequest), "dependency-required");
  for (const guess of ["0".repeat(64), "b".repeat(64), newOid, targetOid, { revision: newOid }, 42]) {
    refused(() => f.gate.consume({ ...launchRequest, revisionDependency: guess }), "invalid-dependency");
  }
  const completed = f.completedPreparation();
  // Actual server result exists, but has not been published to the agent.
  refused(() => f.consume("0".repeat(64)), "invalid-dependency");
  const result = f.issuer.publishPreparationResult(completed.handle);
  const launch = f.consume(result.revisionDependency);
  // A pending verifier has no completed-result identity, even with a known launch.
  refused(() => f.issuer.publishVerificationResult({ launch, status: "passed" }), "unissued-result");
  refused(() => f.consume(result.revisionDependency, { stage: "integrate" }), "invalid-dependency");
  const verified = f.issuer.publishVerificationResult(f.completedVerification(launch));
  assert.notEqual(verified.revisionDependency, result.revisionDependency);
  f.consume(verified.revisionDependency, { stage: "integrate", receiptIds: ["check-1"] });
  refused(() => f.consume(verified.revisionDependency, { stage: "integrate", receiptIds: ["check-1"] }), "invalid-dependency");
});

test("content-equivalent actual rewrite still issues; same old/new IDs are not an actual rewrite", () => {
  const f = fixture();
  // This models the native retained empty replay: the new parent/commit ID
  // changes while old/new/result trees may all be identical. Trees do not gate reentry.
  const result = f.publish({ result: { status: "prepared", oldSourceOid: oldOid, newSourceOid: newOid,
    targetOid, treeOid, recoveryPath: "/private/empty-replay" } });
  assert.equal(result.status, "rewritten");
  f.consume(result.revisionDependency, { stage: "integrate" });
  refused(() => f.publish({ result: { status: "prepared", oldSourceOid: newOid, newSourceOid: newOid,
    targetOid, treeOid, recoveryPath: "/private" } }), "invalid-proof");
});

test("no-op is distinct, issues nothing and cannot reset an outstanding rewrite", () => {
  const f = fixture(), rewritten = f.publish();
  const noop = f.publish({ result: { status: "already-prepared", oldSourceOid: newOid, newSourceOid: newOid, targetOid } });
  assert.deepEqual(noop, { status: "already-prepared" });
  assert.equal(noop.revisionDependency, undefined);
  refused(() => f.consume(noop.revisionDependency), "dependency-required");
  f.consume(rewritten.revisionDependency);
  refused(() => f.publish({ result: { status: "already-prepared", oldSourceOid: oldOid, newSourceOid: newOid, targetOid } }), "invalid-proof");
});

test("terminal conflict/partial/failed/cancelled preparation never issues a dependency", () => {
  const f = fixture();
  for (const status of ["conflict", "partial-state", "failed", "cancelled"]) {
    refused(() => f.publish({ result: { status, oldSourceOid: oldOid, observedSourceOid: newOid,
      targetOid, recoveryPath: "/private/partial" } }), "terminal-result");
  }
  refused(() => f.consume(undefined), "dependency-required");
});

test("proof must verify old/new IDs and unchanged target, physical resources, session and policy", () => {
  for (const change of [
    (p) => { p.before.sourceOid = targetOid; },
    (p) => { p.after.sourceOid = oldOid; },
    (p) => { p.after.targetOid = newOid; },
    (p) => { p.after.policyRevision = "policy-2"; },
    (p) => { p.after.sessionId = "fork"; },
    (p) => { p.after.operationId = "another-request"; },
    (p) => { p.after.source.identities.checkout.inode = "999"; },
    (p) => { p.after.target.identities.git.birthtime = "999"; },
  ]) {
    const f = fixture(), { handle, proof } = f.completedPreparation();
    change(proof);
    refused(() => f.issuer.publishPreparationResult(handle), "invalid-proof");
    refused(() => f.issuer.publishPreparationResult(handle), "unissued-result");
  }
});

test("changed source, target, policy, session, request or any captured resource refuses before launch", () => {
  for (const change of [
    (s) => { s.sourceOid = oldOid; },
    (s) => { s.targetOid = newOid; },
    (s) => { s.policyRevision = "policy-2"; },
    (s) => { s.sessionId = "another-session"; },
    (s) => { s.operationId = "another-request"; },
    (s) => { s.source.cwd = "/repo/replaced"; },
    (s) => { s.target.branch = "other"; },
    (s) => { s.target.gitDir = "/repo/.git/replaced"; },
    ...["source", "target"].flatMap((side) => ["project", "checkout", "common", "git", "marker"].map((part) =>
      (s) => { s[side].identities[part].inode = "999"; })),
    (s) => { s.source.identities.marker.changed = "999"; },
    (s) => { s.target.identities.marker.size = "999"; },
  ]) {
    const f = fixture(), issued = f.publish(), changed = state(); change(changed);
    assert.throws(() => f.consume(issued.revisionDependency, { current: changed }), GitPreparationReentryError);
    refused(() => f.consume(issued.revisionDependency), "invalid-dependency");
  }
});

test("sequential checks each require a new completed result and preserve exact accumulated receipts", () => {
  const f = fixture();
  let issued = f.publish(), accumulated = [];
  for (let i = 1; i <= 3; i++) {
    const previous = issued.revisionDependency;
    const launch = f.consume(previous, { receiptIds: accumulated });
    refused(() => f.consume(previous, { receiptIds: accumulated }), "invalid-dependency");
    const handle = f.completedVerification(launch, { receiptIds: [`check-${i}`] });
    issued = f.issuer.publishVerificationResult(handle);
    accumulated.push(`check-${i}`);
    refused(() => f.issuer.publishVerificationResult(handle), "unissued-result");
  }
  f.consume(issued.revisionDependency, { stage: "integrate", receiptIds: accumulated.reverse() });
});

test("successor cannot omit, add, duplicate or substitute accumulated receipt IDs", () => {
  for (const receiptIds of [[], ["historical"], ["check-1", "extra"], ["check-1", "check-1"]]) {
    const f = fixture(), issued = f.publish(), launch = f.consume(issued.revisionDependency);
    const verified = f.issuer.publishVerificationResult(f.completedVerification(launch));
    assert.throws(() => f.consume(verified.revisionDependency, { stage: "integrate", receiptIds }), GitPreparationReentryError);
    refused(() => f.consume(verified.revisionDependency, { receiptIds: ["check-1"] }), "invalid-dependency");
  }
});

test("copied/unissued launch handles and integration launches cannot publish verification successors", () => {
  for (const stage of ["verify", "integrate"]) {
    const f = fixture(), issued = f.publish(), launch = f.consume(issued.revisionDependency, { stage });
    const badLaunch = stage === "verify" ? copy(launch) : launch;
    refused(() => f.issuer.publishVerificationResult(f.completedVerification(badLaunch)), "unissued-result");
    if (stage === "verify") f.issuer.publishVerificationResult(f.completedVerification(launch));
  }
});

test("failed/cancelled/partial or moved verifier results cannot issue a successor", () => {
  for (const status of ["failed", "cancelled", "partial-state"]) {
    const f = fixture(), issued = f.publish(), launch = f.consume(issued.revisionDependency);
    refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch, { status })), "terminal-result");
    refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch)), "unissued-result");
    refused(() => f.reconcile({ previousLaunch: launch, disposition: "definite-no-effect" }), "terminal-result");
    const renewed = f.reconcile({ previousLaunch: launch, disposition: "recovered" });
    f.consume(renewed.revisionDependency);
  }
  for (const overrides of [{ sourceOid: oldOid }, { targetOid: newOid }, { policyRevision: "moved" }, { sessionId: "fork" }]) {
    for (const phase of ["before", "after"]) {
      const f = fixture(), issued = f.publish(), launch = f.consume(issued.revisionDependency);
      refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch, { [phase]: state(overrides) })), "state-changed");
    }
  }
});

test("empty/duplicate/previously accumulated verification receipts do not invent a check", () => {
  for (const receiptIds of [[], ["same", "same"]]) {
    const f = fixture(), launch = f.consume(f.publish().revisionDependency);
    refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch, { receiptIds })), "invalid-proof");
  }
  const f = fixture(), first = f.consume(f.publish().revisionDependency);
  const next = f.issuer.publishVerificationResult(f.completedVerification(first));
  const second = f.consume(next.revisionDependency, { receiptIds: ["check-1"] });
  refused(() => f.issuer.publishVerificationResult(f.completedVerification(second)), "invalid-proof");
});

test("new actual rewrite supersedes outstanding token and pending verifier in only the same operation", () => {
  for (const pending of [false, true]) {
    const f = fixture(), old = f.publish();
    const launch = pending ? f.consume(old.revisionDependency) : undefined;
    const newerState = state({ sourceOid: "e".repeat(40) });
    const next = f.publish({ after: newerState });
    refused(() => f.consume(old.revisionDependency), "invalid-dependency");
    if (launch) refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch)), "stale");
    f.consume(next.revisionDependency, { current: newerState });
  }
  const f = fixture(), a = f.publish(), bState = state({ operationId: "second-request" });
  const b = f.publish({ after: bState });
  f.consume(a.revisionDependency);
  f.consume(b.revisionDependency, { current: bState });
});

test("journal/JSON/structured clones omit dependencies; historical results cannot restore issuance", () => {
  const f = fixture(), issued = f.publish();
  assert.deepEqual(JSON.parse(JSON.stringify(issued)), { status: "rewritten" });
  assert.deepEqual(copy(issued), { status: "rewritten" });
  assert.equal(Object.isFrozen(issued), true);
  refused(() => f.issuer.publishPreparationResult(JSON.parse(JSON.stringify(issued))), "unissued-result");
  const launch = f.consume(issued.revisionDependency);
  const verified = f.issuer.publishVerificationResult(f.completedVerification(launch));
  assert.deepEqual(JSON.parse(JSON.stringify(verified)), { status: "verified" });
  refused(() => f.consume(issued.revisionDependency), "invalid-dependency");
});

test("each completed result gets its own freshness window, measured from completion not publication", () => {
  const f = fixture(), completed = f.completedPreparation();
  f.setClock(600);
  const issued = f.issuer.publishPreparationResult(completed.handle), launch = f.consume(issued.revisionDependency);
  f.setClock(1500); // Past the preparation's old TTL, but verifier is pending.
  const verified = f.issuer.publishVerificationResult(f.completedVerification(launch));
  f.setClock(2499);
  f.consume(verified.revisionDependency, { receiptIds: ["check-1"] });
  const stale = fixture(), old = stale.completedPreparation(); stale.setClock(1100);
  refused(() => stale.issuer.publishPreparationResult(old.handle), "stale");
  const delayed = fixture(), p = delayed.consume(delayed.publish().revisionDependency);
  const result = delayed.completedVerification(p); delayed.setClock(1100);
  refused(() => delayed.issuer.publishVerificationResult(result), "stale");
});

test("a check crossing five minutes can publish and its successor stays fresh for up to five more minutes", () => {
  const f = fixture({ lifetimeMs: 5 * 60_000 });
  const launch = f.consume(f.publish().revisionDependency);
  f.setClock(100 + 6 * 60_000);
  const next = f.issuer.publishVerificationResult(f.completedVerification(launch));
  f.setClock(100 + 10 * 60_000);
  f.consume(next.revisionDependency, { stage: "integrate", receiptIds: ["check-1"] });
  const expired = fixture({ lifetimeMs: 5 * 60_000 });
  const pending = expired.consume(expired.publish().revisionDependency);
  expired.setClock(100 + 6 * 60_000);
  const successor = expired.issuer.publishVerificationResult(expired.completedVerification(pending));
  expired.setClock(100 + 11 * 60_000);
  refused(() => expired.consume(successor.revisionDependency, { receiptIds: ["check-1"] }), "invalid-dependency");
});

test("pending launch has a separate finite runner bound; timeout does not prove recovery", () => {
  const f = fixture({ lifetimeMs: 5 * 60_000, pendingLifetimeMs: 10 * 60_000 });
  const issued = f.publish(), launch = f.consume(issued.revisionDependency);
  f.setClock(101 + 10 * 60_000); // Actual completion is beyond the runner bound.
  refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch)), "stale");
  refused(() => f.reconcile({ previousLaunch: launch }), "terminal-result");
  refused(() => f.reconcile({ previousLaunch: launch, disposition: "recovered", independentlyProven: false }), "unissued-result");
  const renewed = f.reconcile({ previousLaunch: launch, disposition: "recovered" });
  assert.notEqual(renewed.revisionDependency, issued.revisionDependency);
  f.consume(renewed.revisionDependency);
});

test("timely completed verification may publish across the pending deadline with a fresh successor", () => {
  for (const completionOffset of [29 * 60_000 + 59_000, 30 * 60_000]) {
    const f = fixture({ lifetimeMs: 5 * 60_000 });
    const issued = f.publish(), launch = f.consume(issued.revisionDependency);
    f.setClock(100 + completionOffset);
    const completed = f.completedVerification(launch);
    f.setClock(100 + 30 * 60_000 + 1000);
    const successor = f.issuer.publishVerificationResult(completed);
    assert.equal(successor.status, "verified");
    assert.notEqual(successor.revisionDependency, issued.revisionDependency);
    refused(() => f.issuer.publishVerificationResult(completed), "unissued-result");
    refused(() => f.consume(issued.revisionDependency), "invalid-dependency");
    f.consume(successor.revisionDependency, { stage: "integrate", receiptIds: ["check-1"] });
  }
});

test("completion after the launch deadline fails even when its publication is fresh", () => {
  const f = fixture({ lifetimeMs: 5 * 60_000 });
  const issued = f.publish(), launch = f.consume(issued.revisionDependency);
  f.setClock(100 + 30 * 60_000 + 1000);
  const completed = f.completedVerification(launch);
  f.setClock(100 + 30 * 60_000 + 2000);
  refused(() => f.issuer.publishVerificationResult(completed), "stale");
  refused(() => f.issuer.publishVerificationResult(completed), "unissued-result");
  refused(() => f.consume(issued.revisionDependency), "invalid-dependency");
  refused(() => f.reconcile({ previousLaunch: launch }), "terminal-result");
});

test("timely completion cannot publish beyond completed-result freshness", () => {
  const f = fixture({ lifetimeMs: 5 * 60_000 });
  const issued = f.publish(), launch = f.consume(issued.revisionDependency);
  f.setClock(100 + 29 * 60_000 + 59_000);
  const completed = f.completedVerification(launch);
  f.setClock(100 + 35 * 60_000);
  refused(() => f.issuer.publishVerificationResult(completed), "stale");
  refused(() => f.issuer.publishVerificationResult(completed), "unissued-result");
  refused(() => f.consume(issued.revisionDependency), "invalid-dependency");
  refused(() => f.reconcile({ previousLaunch: launch }), "terminal-result");
});

test("delayed timely completion never revives a chain superseded by rewrite or reconciliation", () => {
  for (const superseding of ["rewrite", "reconciliation"]) {
    const f = fixture({ lifetimeMs: 5 * 60_000 });
    const issued = f.publish(), launch = f.consume(issued.revisionDependency);
    f.setClock(100 + 29 * 60_000 + 59_000);
    const completed = f.completedVerification(launch);
    f.setClock(100 + 30 * 60_000 + 1000);
    const nextState = state({ sourceOid: "e".repeat(40) });
    const newer = superseding === "rewrite" ? f.publish({ after: nextState }) :
      f.reconcile({ before: nextState, disposition: "recovered", previousLaunch: launch });
    refused(() => f.issuer.publishVerificationResult(completed), superseding === "rewrite" ? "stale" : "unissued-result");
    refused(() => f.issuer.publishVerificationResult(completed), "unissued-result");
    refused(() => f.consume(issued.revisionDependency), "invalid-dependency");
    f.consume(newer.revisionDependency, { stage: "integrate", current: nextState });
  }
});

test("future/retrograde completion and clock rollback fail closed", () => {
  const f = fixture();
  refused(() => f.publish({ completedAt: 101 }), "stale");
  const launch = f.consume(f.publish().revisionDependency);
  refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch, { completedAt: 99 })), "stale");
  const next = f.publish(); f.setClock(99);
  refused(() => f.consume(next.revisionDependency), "stale");
  f.setClock(100);
  refused(() => f.publish(), "stale");
});

test("restart/controller replacement and teardown cannot replay old dependencies or launches", () => {
  const f = fixture(), issued = f.publish(), launch = f.consume(issued.revisionDependency);
  const next = f.issuer.publishVerificationResult(f.completedVerification(launch));
  const replacement = createGitPreparationReentryController(f.options);
  refused(() => replacement.gate.consume({ stage: "integrate", revisionDependency: next.revisionDependency,
    state: state(), receiptIds: ["check-1"] }), "invalid-dependency");
  refused(() => replacement.issuer.publishVerificationResult(f.completedVerification(launch)), "unissued-result");
  f.issuer.dispose();
  refused(() => f.consume(next.revisionDependency, { receiptIds: ["check-1"] }), "stale");
});

test("bounded scope budgets survive expiry; no repository ownership or expiry-based budget reset", () => {
  const f = fixture();
  for (let i = 0; i < 128; i++) f.publish({ after: state({ operationId: `request-${i}` }) });
  refused(() => f.publish(), "capacity");
  f.setClock(1100);
  refused(() => f.publish(), "capacity");
  const existing = state({ operationId: "request-0" });
  const renewed = f.reconcile({ before: existing });
  f.consume(renewed.revisionDependency, { current: existing });
});

test("check-stage count is bounded across renewed chains within one operation", () => {
  const f = fixture(); let issued = f.publish(), accumulated = [];
  for (let i = 0; i < 64; i++) {
    const launch = f.consume(issued.revisionDependency, { receiptIds: accumulated });
    issued = f.issuer.publishVerificationResult(f.completedVerification(launch, { receiptIds: [`check-${i}`] }));
    accumulated.push(`check-${i}`);
  }
  refused(() => f.consume(issued.revisionDependency, { receiptIds: accumulated }), "capacity");
  const renewed = f.reconcile();
  refused(() => f.consume(renewed.revisionDependency), "capacity");
});

test("failed check needs independently proved recovery, then renews with zero ordering receipts", () => {
  const f = fixture(), initial = f.publish();
  const first = f.consume(initial.revisionDependency);
  const verified = f.issuer.publishVerificationResult(f.completedVerification(first));
  const second = f.consume(verified.revisionDependency, { receiptIds: ["check-1"] });
  refused(() => f.issuer.publishVerificationResult(f.completedVerification(second, { status: "failed" })), "terminal-result");
  refused(() => f.reconcile({ disposition: "revalidated", previousLaunch: second }), "terminal-result");
  refused(() => f.reconcile({ disposition: "recovered", previousLaunch: second, independentlyProven: false }), "unissued-result");
  const renewed = f.reconcile({ disposition: "recovered", previousLaunch: second });
  assert.equal(renewed.status, "reconciled");
  assert.notEqual(renewed.revisionDependency, verified.revisionDependency);
  refused(() => f.consume(verified.revisionDependency), "invalid-dependency");
  const launch = f.consume(renewed.revisionDependency); // No old check-1 receipt.
  const next = f.issuer.publishVerificationResult(f.completedVerification(launch, { receiptIds: ["fresh-check"] }));
  f.consume(next.revisionDependency, { stage: "integrate", receiptIds: ["fresh-check"] });
});

test("definite not-launched/no-effect can reconcile after admission refusal without restoring a token", () => {
  for (const stage of ["verify", "integrate"]) {
    for (const disposition of ["not-launched", "definite-no-effect"]) {
      const f = fixture(), initial = f.publish();
      const launch = f.consume(initial.revisionDependency, { stage });
      // The independent admission/runner refuses or cancels BEFORE any launch/effect.
      // No implicit rollback/renewal: an explicit completed trusted result is needed.
      refused(() => f.consume(initial.revisionDependency, { stage }), "invalid-dependency");
      refused(() => f.reconcile({ disposition, previousLaunch: launch, independentlyProven: false }), "unissued-result");
      const renewed = f.reconcile({ disposition, previousLaunch: launch });
      assert.notEqual(renewed.revisionDependency, initial.revisionDependency);
      f.consume(renewed.revisionDependency, { stage });
      refused(() => f.reconcile({ disposition, previousLaunch: launch }), "unissued-result");
    }
  }
});

test("active, partial, uncertain or incomplete reconciliation cannot renew; timeout alone is no proof", () => {
  const f = fixture(), launch = f.consume(f.publish().revisionDependency);
  for (const status of ["active", "partial-state", "uncertain", "pending", "failed"]) {
    refused(() => f.reconcile({ status, disposition: "recovered", previousLaunch: launch }), "terminal-result");
  }
  for (const disposition of ["active", "partial-state", "uncertain", "quarantined", "admission-allowed"]) {
    refused(() => f.reconcile({ disposition, previousLaunch: launch }), "terminal-result");
  }
  refused(() => f.reconcile(), "invalid-proof");
  refused(() => f.reconcile({ previousLaunch: launch }), "terminal-result");
  refused(() => f.reconcile({ disposition: "not-launched", previousLaunch: copy(launch) }), "unissued-result");
  f.setClock(100 + 30 * 60_000);
  refused(() => f.reconcile({ previousLaunch: launch }), "terminal-result");
  refused(() => f.reconcile({ disposition: "recovered", previousLaunch: launch, independentlyProven: false }), "unissued-result");
});

test("adaptation can reenter exact current state without a new rewrite or borrowed receipts", () => {
  const f = fixture(), initial = f.publish();
  const adapted = state({ sourceOid: "e".repeat(40), targetOid: "f".repeat(40), policyRevision: "policy-2" });
  adapted.source.identities.checkout.inode = "99";
  adapted.target.identities.git.birthtime = "300";
  refused(() => f.consume(initial.revisionDependency, { current: adapted }), "state-changed");
  const renewed = f.reconcile({ before: adapted });
  assert.equal(renewed.status, "reconciled");
  f.consume(renewed.revisionDependency, { stage: "integrate", current: adapted });
});

test("ordinary already-prepared no-op cannot clear, renew or bypass failed/stale chains", () => {
  const f = fixture(), initial = f.publish();
  const launch = f.consume(initial.revisionDependency);
  refused(() => f.issuer.publishVerificationResult(f.completedVerification(launch, { status: "cancelled" })), "terminal-result");
  const noop = f.publish({ result: { status: "already-prepared", oldSourceOid: newOid, newSourceOid: newOid, targetOid } });
  assert.equal(noop.revisionDependency, undefined);
  refused(() => f.consume(initial.revisionDependency), "invalid-dependency");
  refused(() => f.reconcile({ previousLaunch: launch }), "terminal-result");
  const renewed = f.reconcile({ disposition: "recovered", previousLaunch: launch });
  f.consume(renewed.revisionDependency);
});

test("restart accepts a fresh live revalidated registry object, not old objects/context/history", () => {
  const f = fixture(), oldPreparation = f.completedPreparation(), oldReconciliation = f.completedReconciliation();
  const old = f.publish();
  f.issuer.dispose();
  const replacement = createGitPreparationReentryController(f.options);
  refused(() => replacement.issuer.publishPreparationResult(oldPreparation.handle), "unissued-result");
  refused(() => replacement.issuer.publishReconciliationResult(oldReconciliation.handle), "unissued-result");
  refused(() => replacement.gate.consume({ stage: "integrate", revisionDependency: old.revisionDependency,
    state: state(), receiptIds: [] }), "invalid-dependency");
  // A new trusted reconciliation executes admission/recovery/cleanliness checks
  // after restart and stamps its NEW actual completion with the new generation.
  const live = f.completedReconciliation({ context: replacement.issuer.context });
  refused(() => replacement.issuer.publishReconciliationResult(copy(live.handle)), "unissued-result");
  const next = replacement.issuer.publishReconciliationResult(live.handle);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), { status: "reconciled" });
  refused(() => replacement.issuer.publishReconciliationResult(live.handle), "unissued-result");
  replacement.gate.consume({ stage: "integrate", revisionDependency: next.revisionDependency, state: state(), receiptIds: [] });
});

test("reconciliation proof needs fresh stable current observations, correct scope/launch and completion", () => {
  for (const change of [
    (p) => { p.after.sourceOid = oldOid; },
    (p) => { p.after.targetOid = newOid; },
    (p) => { p.after.policyRevision = "changed"; },
    (p) => { p.after.sessionId = "fork"; },
    (p) => { p.after.source.identities.marker.changed = "999"; },
    (p) => { p.after.target.identities.checkout.inode = "999"; },
  ]) {
    const f = fixture(), { handle, proof } = f.completedReconciliation(); change(proof);
    refused(() => f.issuer.publishReconciliationResult(handle), "state-changed");
  }
  const f = fixture(), old = f.completedReconciliation();
  refused(() => f.reconcile({ previousLaunch: {} }), "unissued-result");
  f.setClock(1100);
  refused(() => f.issuer.publishReconciliationResult(old.handle), "stale");
  refused(() => f.reconcile({ completedAt: 1101 }), "stale");
  refused(() => f.reconcile({ startedAt: 1101 }), "invalid-proof");
  const launch = f.consume(f.publish().revisionDependency);
  refused(() => f.reconcile({ previousLaunch: launch, disposition: "not-launched", startedAt: 1099 }), "invalid-proof");
  refused(() => f.reconcile({ previousLaunch: launch, disposition: "not-launched", before: state({ operationId: "other" }) }), "unissued-result");
});

test("at most three explicit reconciliations per operation; expiry, no-op and actual prep do not reset budget", () => {
  const f = fixture();
  const first = f.reconcile(); f.setClock(1100);
  refused(() => f.consume(first.revisionDependency), "invalid-dependency");
  f.reconcile();
  f.publish({ result: { status: "already-prepared", oldSourceOid: newOid, newSourceOid: newOid, targetOid } });
  f.publish(); // Actual rewrite does not reset the same request's renewal budget.
  f.reconcile();
  refused(() => f.reconcile(), "capacity");
  const other = state({ operationId: "independent-request" });
  const issued = f.reconcile({ before: other });
  f.consume(issued.revisionDependency, { current: other });
});

test("reconciliation cannot be minted from an admission flag, snapshot, receipt, approval or copied history", () => {
  const f = fixture();
  for (const handle of [state(), { admission: true, clean: true, recovered: true }, { status: "already-prepared" },
    { actionId: "recovery-journal", disposition: "recovered" }, { approved: true }, { receiptIds: ["passed"] }]) {
    refused(() => f.issuer.publishReconciliationResult(handle), "unissued-result");
  }
  const actual = f.completedReconciliation();
  refused(() => f.issuer.publishReconciliationResult(actual.proof), "unissued-result");
  refused(() => f.issuer.publishReconciliationResult(copy(actual.handle)), "unissued-result");
  const issued = f.issuer.publishReconciliationResult(actual.handle);
  assert.deepEqual(copy(issued), { status: "reconciled" });
  refused(() => f.issuer.publishReconciliationResult(JSON.parse(JSON.stringify(issued))), "unissued-result");
});

test("token freshness and finite runner bounds cannot be widened by options", () => {
  const f = fixture();
  for (const overrides of [{ lifetimeMs: 300001 }, { pendingLifetimeMs: 1800001 }, { pendingLifetimeMs: Infinity }, { pendingLifetimeMs: 0 }]) {
    refused(() => createGitPreparationReentryController({ ...f.options, ...overrides }), "invalid-proof");
  }
});

test("the control-flow gate is not authorization or semantic/receipt validation", () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.gate), ["consume"]);
  // An empty recipe list needs no fabricated passing check. This permits only
  // result order: an independent integration authority/receipt gate can refuse.
  const launch = f.consume(f.publish().revisionDependency, { stage: "integrate" });
  assert.deepEqual(Object.keys(launch), []);
  const authorize = () => { throw new Error("integration denied independently"); };
  assert.throws(authorize, /denied independently/);
});
