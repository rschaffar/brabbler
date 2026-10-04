import { captureGitActionCandidateSnapshot, captureGitActionOutcome, captureGitActionRecord, advanceGitActionRecord, registerLiveGitAction,
  gitActionDiagnosticAvailability, persistCompletedGitAction, emitGitActionAnchor } from "./git-action-journal";
import { GIT_ACTION_ANCHOR_TYPE, isGitActionAnchor, isTerminalGitAction, type GitActionDiagnosticReport, type GitActionDiagnosticWarning, type GitActionCandidateSnapshot, type GitActionCheckoutSnapshot, type GitActionNativeOutcome, type GitActionOutcome, type GitActionRecord, type GitActionSource, type GitActionState } from "./git-action-types";
import { invalidateSessionListCache, invalidateSessionManagerCache } from "./session-reader";
import type { GitActionCandidate, SessionEntry } from "./types";
import { GitCommitOperationError } from "./git-commit";
import { samePath } from "./paths";
import type { GitProjectResources } from "./git-project-resources";
import type { GitWorkspaceCandidate } from "./git-workspace-operation";
import type { GitPreparationCandidate } from "./git-preparation-candidate";
import { createHash } from "node:crypto";
import { readGitWorkspaceNativeProof } from "./git-workspace-operation";
import { readGitPreparationCompletion } from "./git-preparation-apply";
import { readGitCleanupNativeProof } from "./git-cleanup-operation";
import { readGitCheckoutVerificationNativeExecution } from "./git-checkout-verification";

const liveHandles = new WeakSet<GitActionHandle>();

/** Only server-captured physical identities; not an access check or grant. */
export function gitActionAttribution(source: GitProjectResources, target?: GitProjectResources) {
  // Equal project paths can name different repositories after a replacement.
  // Both checkouts must have captured the same actual common Git directory.
  if (target && (!samePath(source.projectRoot, target.projectRoot)
    || !samePath(source.commonDir, target.commonDir)
    || source.identities.common.device !== target.identities.common.device
    || source.identities.common.inode !== target.identities.common.inode
    || source.identities.common.birthtime !== target.identities.common.birthtime
    || source.identities.project.device !== target.identities.project.device
    || source.identities.project.inode !== target.identities.project.inode
    || source.identities.project.birthtime !== target.identities.project.birthtime)) {
    throw new Error("Git action target belongs to a different captured repository");
  }
  return { projectRoot: source.projectRoot, sourceCheckoutRoot: source.cwd,
    ...(target ? { targetCheckoutRoot: target.cwd } : {}),
    resourceAttribution: { version: 2 as const, commonDir: source.commonDir,
      commonIdentity: { ...source.identities.common }, projectIdentity: { ...source.identities.project } } };
}

function capturedCheckout(resource: GitProjectResources): GitActionCheckoutSnapshot {
  return { gitDir: resource.gitDir, checkoutIdentity: { ...resource.identities.checkout }, gitIdentity: { ...resource.identities.git },
    markerIdentity: { ...resource.identities.marker } };
}
function assertCapturedCheckout(snapshot: GitActionCheckoutSnapshot, resource: GitProjectResources): void {
  const expected = capturedCheckout(resource);
  if (!samePath(snapshot.gitDir, expected.gitDir) || (["checkoutIdentity", "gitIdentity", "markerIdentity"] as const).some((key) => {
    const a = snapshot[key], b = expected[key];
    return a.device !== b.device || a.inode !== b.inode || a.birthtime !== b.birthtime;
  }) || snapshot.markerIdentity.changed !== expected.markerIdentity.changed || snapshot.markerIdentity.size !== expected.markerIdentity.size) {
    throw new Error("Git history physical checkout does not match its trusted source");
  }
}

export interface GitActionSink {
  sessionId: string;
  append(record: GitActionRecord): { entryId: string; timestamp: number };
}
type ActionManager = {
  getSessionId(): string;
  getEntries(): readonly unknown[];
  getSessionFile?(): string | undefined;
  isPersisted?(): boolean;
};
export function gitActionSink(manager: ActionManager, append: (type: string, data: unknown) => void): GitActionSink {
  if (!manager?.getSessionId?.() || !manager.getEntries || typeof append !== "function") {
    throw new Error("Current session required for Git action correlation");
  }
  return { sessionId: manager.getSessionId(), append(record) {
    if (manager.isPersisted?.() === false) throw new Error("Optional Git history is unavailable");
    append(GIT_ACTION_ANCHOR_TYPE, { version: 1, actionId: record.id });
    const entry = [...manager.getEntries() as SessionEntry[]].reverse().find((e) => e.type === "custom"
      && e.customType === GIT_ACTION_ANCHOR_TYPE && isGitActionAnchor(e.data) && e.data.actionId === record.id);
    if (!entry?.id) throw new Error("Git action anchor could not be persisted");
    const file = manager.getSessionFile?.();
    if (file) invalidateSessionManagerCache(file);
    invalidateSessionListCache();
    return { entryId: entry.id, timestamp: Date.parse(entry.timestamp) || record.createdAt };
  } };
}

/** Explicitly omit all native live tokens/plan/receipt capabilities. */
export function snapshotGitActionCandidate(candidate: Exclude<GitActionCandidate, { kind: "preferences" }>,
  source?: GitProjectResources, target?: GitProjectResources): GitActionCandidateSnapshot {
  const attribution = source ? gitActionAttribution(source, target) : {};
  switch (candidate.kind) {
    case "workspace":
    case "preparation":
    case "checkout-verification":
    case "cleanup": {
      // Already server-projected, patch-free display data. Never reconstruct a
      // native capture or approval from it; prefer the source-specific helpers.
      const { actionId: _actionId, ...display } = candidate;
      void _actionId;
      return captureGitActionCandidateSnapshot(display);
    }
    case "commit": return { kind: "commit", repositoryRoot: candidate.preview.repositoryRoot, ...attribution,
      featureBranch: candidate.preview.branch, message: candidate.message, commitMode: candidate.preview.mode, paths: [...candidate.preview.paths],
      parentOid: candidate.preview.head, candidateTreeOid: candidate.preview.tree, diff: { ...candidate.diff },
      ...(candidate.workingWorkspaceVerification ? { workingWorkspaceVerification: candidate.workingWorkspaceVerification } : {}) };
    case "review": return { kind: "review", repositoryRoot: candidate.featureCwd, ...attribution,
      featureBranch: candidate.review.featureBranch, targetBranch: candidate.review.targetBranch,
      featureOid: candidate.review.featureOid, targetOid: candidate.review.targetOid,
      selection: candidate.selection, diff: { ...candidate.diff } };
    case "checks": return { kind: "checks", repositoryRoot: candidate.featureCwd, ...attribution,
      featureBranch: candidate.featureBranch, targetBranch: candidate.targetBranch, checks: candidate.checks };
    case "integration": return { kind: "integration", repositoryRoot: candidate.featureCwd, ...attribution,
      featureBranch: candidate.plan.review.featureBranch, targetBranch: candidate.plan.review.targetBranch,
      featureOid: candidate.plan.review.featureOid, targetOid: candidate.plan.review.targetOid,
      integrationMethod: "method" in candidate.plan ? "ff" : "merge",
      ...("method" in candidate.plan ? {} : { mergeOid: candidate.plan.mergeOid, message: candidate.plan.message }),
      checks: candidate.receipts.map((receipt) => ({ label: `Check ${receipt.checkIndex + 1}`, argv: [...receipt.argv] })), diff: { ...candidate.plan.diff } };
  }
}
/** Pure display capture. source/candidate must come from trusted server capture,
 * never a model-serialized candidate. No native action, authority or verification. */
export function snapshotGitWorkspaceAction(source: GitProjectResources, candidate: GitWorkspaceCandidate): GitActionCandidateSnapshot {
  const request = candidate.request;
  if (!samePath(source.projectRoot, request.repositoryPath) || !samePath(source.cwd, request.sourceCheckoutPath)
    || candidate.resultOid !== (request.mode === "create" ? request.expectedBaseOid : request.expectedTipOid)) {
    throw new Error("Workspace history capture does not match the server source/candidate");
  }
  return { kind: "workspace", repositoryRoot: source.cwd, ...gitActionAttribution(source),
    workspace: { mode: request.mode, destinationPath: request.destinationPath, baseBranch: request.baseBranch,
      baseOid: request.expectedBaseOid, branch: request.branch, tipOid: candidate.resultOid, treeOid: candidate.treeOid,
      ...(candidate.parentCreation ? { parentCreation: { ...candidate.parentCreation, ancestorIdentity: { ...candidate.parentCreation.ancestorIdentity } } } : {}) } };
}
export function snapshotGitPreparationAction(source: GitProjectResources, target: GitProjectResources,
  candidate: GitPreparationCandidate, resultTreeOid: string,
  diff?: GitActionCandidateSnapshot["diff"]): GitActionCandidateSnapshot {
  return { kind: "preparation", repositoryRoot: source.cwd, ...gitActionAttribution(source, target),
    featureBranch: source.branch, targetBranch: target.branch,
    preparation: { oldSourceOid: candidate.oldSourceOid, newSourceOid: candidate.newSourceOid,
      targetMainOid: candidate.targetOid, resultTreeOid, emptyRetention: "keep",
      commitCount: candidate.comparison.commits.length,
      commitMapping: candidate.comparison.commits.map((row) => ({ ...row })), source: capturedCheckout(source), target: capturedCheckout(target) },
    ...(diff ? { diff: { ...diff } } : {}) };
}

/** Pure trusted-source captures for distinct target-free clean v2/commit v3 checks and
 * exact cleanup. They project no jobs, native handles, grants or live receipts. */
export function snapshotGitCheckoutVerificationAction(source: GitProjectResources,
  details: NonNullable<GitActionCandidateSnapshot["checkoutVerification"]>): GitActionCandidateSnapshot {
  const snapshot = captureGitActionCandidateSnapshot({ kind: "checkout-verification", repositoryRoot: source.cwd, ...gitActionAttribution(source),
    featureBranch: source.branch, checkoutVerification: details });
  assertCapturedCheckout(snapshot.checkoutVerification!.source, source);
  return snapshot;
}
export function snapshotGitCleanupAction(source: GitProjectResources, target: GitProjectResources,
  details: NonNullable<GitActionCandidateSnapshot["cleanup"]>): GitActionCandidateSnapshot {
  const snapshot = captureGitActionCandidateSnapshot({ kind: "cleanup", repositoryRoot: source.cwd, ...gitActionAttribution(source, target),
    featureBranch: source.branch, targetBranch: target.branch, cleanup: details });
  assertCapturedCheckout(snapshot.cleanup!.source, source);
  assertCapturedCheckout(snapshot.cleanup!.target, target);
  if (samePath(snapshot.cleanup!.mainPath, target.cwd)) assertCapturedCheckout(snapshot.cleanup!.main, target);
  if (samePath(snapshot.cleanup!.provenance.originalSourcePath, target.cwd)) assertCapturedCheckout(snapshot.cleanup!.provenance.originalSource, target);
  return snapshot;
}

export interface GitActionHandle {
  readonly record: GitActionRecord;
  /** Exact detached original, never reconstructed from history/current checkout. */
  readonly candidate?: GitActionCandidateSnapshot;
  readonly diagnosticsUnavailable?: boolean;
  readonly diagnostics?: GitActionDiagnosticWarning;
  update(state: GitActionState, extra?: { decision?: GitActionRecord["decision"]; reason?: string; outcome?: GitActionOutcome; intended?: GitActionOutcome }): Promise<void>;
  release(): void;
}
export function gitActionDiagnosticReport(handle: GitActionHandle): GitActionDiagnosticReport {
  const diagnostics = handle.diagnostics ?? handle.record.diagnostics ?? handle.record.outcome?.diagnostics;
  return diagnostics ? { diagnosticsUnavailable: true, diagnostics } : {};
}
export async function beginGitAction(sink: GitActionSink, source: GitActionSource, candidate: GitActionCandidateSnapshot, agentDir?: string): Promise<GitActionHandle> {
  const captured = captureGitActionRecord({ sessionId: sink.sessionId, source, candidate });
  return anchorGitAction(sink, captured, agentDir);
}
/** INTERNAL trusted native-capture correlation only. IDs never confer authority. */
export async function beginGitActionWithId(recordId: string, sink: GitActionSink, source: GitActionSource,
  candidate: GitActionCandidateSnapshot, agentDir?: string): Promise<GitActionHandle> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(recordId)) throw new Error("Invalid native action ID");
  const captured = captureGitActionRecord({ sessionId: sink.sessionId, source, candidate }, recordId, true);
  return anchorGitAction(sink, captured, agentDir);
}
function anchorGitAction(sink: GitActionSink, captured: ReturnType<typeof captureGitActionRecord>, agentDir?: string): GitActionHandle {
  let record = captured.record, released = false;
  let diagnostics: GitActionDiagnosticWarning | undefined;
  // This projection is diagnostic only. Live native/receipt owners retire their
  // own invocation independently; JSON, anchors and this handle grant nothing.
  const projection = registerLiveGitAction(record, captured.candidate, agentDir);
  const warn = (warning: GitActionDiagnosticWarning | undefined) => {
    if (!warning) return;
    if (!diagnostics || warning.reason === "storage-unavailable") diagnostics = warning;
    record = { ...record, diagnostics, ...(record.outcome ? { outcome: { ...record.outcome, diagnostics } } : {}) };
    projection.update(record);
  };
  const handle: GitActionHandle = {
    get record() { return structuredClone(record); },
    get candidate() { return structuredClone(captured.candidate); },
    get diagnosticsUnavailable() { return diagnostics !== undefined; },
    get diagnostics() { return diagnostics ? { ...diagnostics } : undefined; },
    async update(state, extra = {}) {
      if (released) throw new Error("Git action is no longer live; history is read-only");
      // Pure shape/binding/transition validation is NEVER inside a storage catch.
      record = advanceGitActionRecord(record, captured.candidate, { state, ...extra });
      warn(record.outcome?.diagnostics);
      if (isTerminalGitAction(state)) {
        // Only completed copies become retention-eligible. The original live
        // candidate remains available through this handle until explicit release.
        warn(persistCompletedGitAction(record, agentDir, captured.candidate).diagnostics);
      } else warn(diagnostics);
      projection.update(record);
    },
    release() { released = true; liveHandles.delete(handle); projection.release(); },
  };
  liveHandles.add(handle);
  warn(gitActionDiagnosticAvailability(agentDir).diagnostics);
  try {
    const anchor = sink.append(handle.record);
    emitGitActionAnchor(record.sessionId, { type: "git_action_update", actionId: record.id, revision: record.revision, ...anchor });
  } catch {
    // Append may already have published. Keep the known ID, never replay it or
    // convert a diagnostic failure into a native rejection/quarantine.
    warn({ status: "unavailable", reason: "storage-unavailable" });
  }
  projection.update(record);
  return Object.freeze(handle);
}

/** A mutation may have succeeded even if recording its result fails. Never retry it. */
export class GitActionRecordingError extends Error {
  constructor(readonly actionId: string, readonly outcome?: GitActionOutcome) {
    super(`Git action ${actionId} requires manual recovery: outcome recording failed. Do not retry the operation.`);
  }
}
export class GitActionApplyError extends GitActionRecordingError {
  constructor(actionId: string, readonly intended?: GitActionOutcome) {
    super(actionId);
    this.message = `Git action ${actionId} has an uncertain execution result. Inspect the captured intent and actual checkout; do not retry the operation.`;
  }
}
/** Deprecated projection callback type, retained for source compatibility only.
 * Supplied callbacks are NEVER called. Fixed native identity readers below are
 * the only source of completed facts. Diagnostics do not issue registry seals. */
export type GitActionNativeCompletionReader = (actualNativeHandle: object) => { actionId: string; outcome: GitActionNativeOutcome } | undefined;
function nativeCompletion(handle: GitActionHandle, original: object): { actionId: string; outcome: GitActionNativeOutcome } | undefined {
  const kind = handle.record.kind;
  if (kind === "workspace") {
    const p = readGitWorkspaceNativeProof(original);
    if (!p) return;
    return { actionId: p.actionId, outcome: { kind, status: p.mode === "create" ? "created" : "attached", workspace: {
      mode: p.mode, destinationPath: p.destination.cwd, branch: p.destination.branch!, tipOid: p.resultOid, treeOid: p.treeOid,
      ...(p.knownParentCreation ? { parentCreated: true, knownParentCreation: p.knownParentCreation } : {}) } } };
  }
  if (kind === "preparation") {
    const p = readGitPreparationCompletion(original);
    if (!p?.actionId || p.stage !== "completed") return;
    return { actionId: p.actionId, outcome: { kind, status: "prepared", preparation: { oldSourceOid: p.result.oldSourceOid,
      newSourceOid: p.result.newSourceOid, targetMainOid: p.result.targetOid, resultTreeOid: p.result.treeOid } } };
  }
  if (kind === "cleanup") {
    const p = readGitCleanupNativeProof(original), c = handle.candidate?.cleanup;
    if (!p || !c) return;
    const r = p.kind === "removed" ? p : p.removal;
    const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map(key => [key, stable((v as Record<string, unknown>)[key])])) : v;
    const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
    const effects: NonNullable<GitActionOutcome["cleanup"]>["effects"] = [{ kind: "worktree-removed", sourcePath: r.sourcePath,
      sourceIdentity: r.sourceIdentity, adminPath: r.adminPath, featureOid: r.featureOid, exit: r.exit, sourceAbsent: r.sourceAbsent,
      adminAbsent: r.adminAbsent, beforeInventoryDigest: digest(r.before), afterInventoryDigest: digest(r.after) }];
    if (p.kind === "completed") effects.push({ kind: "branch-deleted", branchRef: p.deletedRef, deletedOid: p.deletedOid,
      transactionExit: p.transactionExit, finalInventoryDigest: digest(p.finalInventory) });
    return { actionId: p.actionId, outcome: { kind, status: p.kind === "removed" ? "worktree-removed" : "cleaned-up", cleanup: {
      featureOid: c.featureOid, targetOid: c.targetOid, mainOid: c.mainOid, sourcePath: c.sourcePath, branchRef: c.branchRef,
      targetPath: c.targetPath, mainPath: c.mainPath, effects, ...(c.ignoredCount ? { ignoredDataDeletionApproved: true } : {}),
      ...(p.kind === "completed" ? { nativeHeadReflogMayHaveChanged: p.nativeHeadReflogMayHaveChanged } : {}) } } };
  }
  if (kind === "checkout-verification") {
    const c = handle.candidate?.checkoutVerification;
    if (!c) return;
    // Success requires every ORIGINAL published receipt. Genuine measured
    // failure/uncertainty may be recorded without a receipt, but zero-exit
    // onExecution metadata (even authentic) cannot certify passing checks.
    const originals: object[] = Array.isArray(original) ? original : [original];
    const runs = originals.map(value => readGitCheckoutVerificationNativeExecution(value));
    if (!runs.length || runs.length > c.checks.length || runs.some(run => !run || run.actionId !== handle.record.id
      || run.sessionId !== handle.record.sessionId)) return;
    const uncertain = runs.some(run => !run!.containmentComplete);
    const failed = runs.some(run => run!.exitStatus !== 0 || run!.timedOut || run!.overflow);
    if (!uncertain && !failed && (runs.length !== c.checks.length || runs.some(run => !run!.receipt))) return;
    const { source: _source, checks: _checks, ...binding } = c; void _source; void _checks;
    return { actionId: handle.record.id, outcome: { kind, status: uncertain ? "partial-state" : failed ? "failed" : "passed", checkoutVerification: {
      ...binding, runs: runs.map(run => structuredClone(run!)) } } };
  }
}
export async function finishVerifiedNativeGitAction(handle: GitActionHandle, completedResult: object,
  _readVerifiedResult?: GitActionNativeCompletionReader): Promise<GitActionDiagnosticReport> {
  void _readVerifiedResult; // Compatibility only; never execute caller-supplied readers.
  if (!liveHandles.has(handle)) throw new Error("Original live diagnostic handle required");
  if (!["workspace", "preparation", "checkout-verification", "cleanup"].includes(handle.record.kind)) throw new Error("Native history kind required");
  if (handle.record.state !== "executing") throw new Error("Native completion requires an executing action; no execution is inferred from history");
  const proof = nativeCompletion(handle, completedResult);
  let outcome: GitActionOutcome | undefined;
  try { if (proof) outcome = captureGitActionOutcome(proof.outcome); } catch { /* Never disclose raw diagnostics on invalid evidence. */ }
  const statuses = handle.record.kind === "workspace" ? ["created", "attached", "partial-state"] : handle.record.kind === "preparation" ? ["prepared", "already-prepared", "partial-state"]
    : handle.record.kind === "checkout-verification" ? ["passed", "failed", "cancelled", "partial-state"] : ["cleaned-up", "partial-state"];
  if (proof?.actionId !== handle.record.id || !outcome || outcome.kind !== handle.record.kind || !statuses.includes(outcome.status ?? "")) {
    await failGitAction(handle, true);
    handle.release();
    throw new GitActionApplyError(handle.record.id, handle.record.intended);
  }
  const state = outcome.status === "partial-state" ? "recovery-required" : outcome.status === "failed" ? "failed" : outcome.status === "cancelled" ? "cancelled" : "succeeded";
  await handle.update(state, { outcome, ...(state === "recovery-required" ? { reason: "Measured partial effects require manual recovery; do not retry." } : {}) });
  return gitActionDiagnosticReport(handle);
}
/** Actual-native identity reader only, after independent measured removal and
 * before branch deletion. A parsed historical proof/ID is never accepted. */
export async function recordVerifiedCleanupRemoval(handle: GitActionHandle, actualRemovalHandle: object,
  _readVerifiedResult?: GitActionNativeCompletionReader): Promise<GitActionDiagnosticReport> {
  void _readVerifiedResult; // Compatibility only; never execute caller-supplied readers.
  if (!liveHandles.has(handle) || handle.record.kind !== "cleanup" || handle.record.state !== "executing") throw new Error("Live executing cleanup required");
  const proof = nativeCompletion(handle, actualRemovalHandle);
  let outcome: GitActionOutcome | undefined;
  try { if (proof) outcome = captureGitActionOutcome(proof.outcome); } catch { /* No raw diagnostics leave the private reader. */ }
  if (!proof || proof.actionId !== handle.record.id || outcome?.kind !== "cleanup" || outcome.status !== "worktree-removed") {
    await failGitAction(handle, true); handle.release(); throw new GitActionApplyError(handle.record.id, handle.record.intended);
  }
  await handle.update("executing", { outcome });
  return gitActionDiagnosticReport(handle);
}
export async function finishGitAction(handle: GitActionHandle, outcome: GitActionOutcome, partial = false): Promise<void> {
  if (["workspace", "preparation", "checkout-verification", "cleanup"].includes(handle.record.kind)) {
    throw new Error("Native completion requires an independently verified actual-native result identity");
  }
  // Non-native-kind diagnostics do not certify authority. Existing caller-owned
  // wrappers may project their independently known native commit/integration.
  // Native caller warnings are projected explicitly rather than silently lost
  // with other non-history fields. A boolean is never native success evidence.
  const sourceWarning = (outcome as GitActionOutcome & { diagnosticsUnavailable?: boolean }).diagnosticsUnavailable === true;
  // Native partial results may carry extra diagnostics. Only durable facts enter history.
  outcome = Object.fromEntries(Object.entries(outcome).filter(([key]) =>
    ["status", "commit", "tree", "parents", "authorEmail", "targetBranch", "featureOid", "targetOid", "mergeOid", "kind", "workspace", "preparation", "checkoutVerification", "cleanup", "workingWorkspaceVerification", "diagnostics"].includes(key)));
  if (sourceWarning && outcome.diagnostics === undefined) outcome.diagnostics = { status: "unavailable", reason: "storage-unavailable" };
  if (outcome.workingWorkspaceVerification) outcome.workingWorkspaceVerification = captureGitActionOutcome({
    workingWorkspaceVerification: outcome.workingWorkspaceVerification }).workingWorkspaceVerification;
  outcome = captureGitActionOutcome(outcome);
  await handle.update(partial ? "recovery-required" : "succeeded", { outcome,
    ...(partial ? { reason: "Git reported a partial result. Inspect the checkout before taking further action; do not retry." } : {}) });
}
export class GitActionDecisionEndedError extends Error {
  constructor(readonly state: "expired" | "cancelled") { super(`Git decision ${state}; no approval was given.`); }
}
export function gitActionFailureResult(cause: unknown) {
  if (!(cause instanceof GitActionRecordingError) && !(cause instanceof GitActionDecisionEndedError)) return undefined;
  const details = cause instanceof GitActionRecordingError
    ? { error: cause.message, actionId: cause.actionId, outcome: cause.outcome,
      ...(cause instanceof GitActionApplyError ? { intended: cause.intended } : {}), recoveryRequired: true }
    : { error: cause.message, decision: cause.state };
  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], isError: true, details };
}
export async function failGitAction(handle: GitActionHandle, applying: boolean, signal?: AbortSignal, cause?: unknown): Promise<void> {
  // This specific native refusal is guaranteed to precede ref CAS, including
  // after the intent callback. Arbitrary post-callback errors remain uncertain.
  const operationBlocked = cause instanceof GitCommitOperationError;
  if (operationBlocked) applying = false;
  try {
    await handle.update(applying ? "recovery-required" : cause instanceof GitActionDecisionEndedError ? cause.state : signal?.aborted ? "cancelled" : "blocked", {
      reason: applying ? "Execution was interrupted or its final result could not be proven. Inspect the captured candidate and checkout; do not retry."
        : cause instanceof GitActionDecisionEndedError ? cause.message
          : operationBlocked ? cause.message
            : signal?.aborted ? "Cancelled before applying Git changes." : "Candidate validation or authorization failed; no ref/index/checkout update started.",
    });
  } catch { /* An executing record projects as recovery-required after release. */ }
}
