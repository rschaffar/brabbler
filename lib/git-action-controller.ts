import { captureGitActionCandidateSnapshot, captureGitActionOutcome, createGitAction, createGitActionWithId, emitGitActionAnchor, releaseGitAction, transitionGitAction } from "./git-action-journal";
import { GIT_ACTION_ANCHOR_TYPE, isGitActionAnchor, type GitActionCandidateSnapshot, type GitActionCheckoutSnapshot, type GitActionNativeOutcome, type GitActionOutcome, type GitActionRecord, type GitActionSource, type GitActionState } from "./git-action-types";
import { invalidateSessionListCache, invalidateSessionManagerCache } from "./session-reader";
import type { GitActionCandidate, SessionEntry } from "./types";
import { GitCommitOperationError } from "./git-commit";
import { samePath } from "./paths";
import type { GitProjectResources } from "./git-project-resources";
import type { GitWorkspaceCandidate } from "./git-workspace-operation";
import type { GitPreparationCandidate } from "./git-preparation-candidate";

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
  if (!manager?.getSessionId?.() || !manager.getEntries || typeof append !== "function" || manager.isPersisted?.() === false) {
    throw new Error("Persisted session required for durable Git action history");
  }
  return { sessionId: manager.getSessionId(), append(record) {
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
  update(state: GitActionState, extra?: { decision?: GitActionRecord["decision"]; reason?: string; outcome?: GitActionOutcome; intended?: GitActionOutcome }): Promise<void>;
  release(): void;
}
export async function beginGitAction(sink: GitActionSink, source: GitActionSource, candidate: GitActionCandidateSnapshot): Promise<GitActionHandle> {
  return anchorGitAction(sink, await createGitAction({ sessionId: sink.sessionId, source, candidate }));
}
/** INTERNAL trusted single-use native-capture correlation only. Never forward
 * caller-selected IDs. The native capture and journal must share this UUID. */
export async function beginGitActionWithId(recordId: string, sink: GitActionSink, source: GitActionSource,
  candidate: GitActionCandidateSnapshot, agentDir?: string): Promise<GitActionHandle> {
  return anchorGitAction(sink, await createGitActionWithId(recordId, { sessionId: sink.sessionId, source, candidate }, agentDir), agentDir);
}
async function anchorGitAction(sink: GitActionSink, initial: GitActionRecord, agentDir?: string): Promise<GitActionHandle> {
  let record = initial;
  const handle: GitActionHandle = {
    get record() { return record; },
    async update(state, extra = {}) { record = await transitionGitAction(record.id, record.revision, { state, ...extra }, agentDir); },
    release() { releaseGitAction(record.id, agentDir); },
  };
  try {
    const anchor = sink.append(record);
    emitGitActionAnchor(sink.sessionId, { type: "git_action_update", actionId: record.id, revision: record.revision, ...anchor });
    return handle;
  } catch (cause) {
    try { await handle.update("blocked", { reason: "Could not persist the transcript anchor; no ref/index/checkout update started." }); }
    finally { handle.release(); }
    throw cause;
  }
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
/** Trusted bootstrap seam only. readVerifiedResult MUST resolve identity in a
 * private completed-result registry populated after independent physical/ref/tree
 * verification against this exact action's captured resources and candidate.
 * Never parse a model result, history ID, candidate or boolean as proof. The
 * action ID binds evidence, not authority. For checkout-verification success,
 * the reader must attest the actually registered native receipt AFTER awaited
 * measurement journalling and admission settlement, never onExecution metadata.
 * This helper does not verify Git and
 * is not exposed by any route/tool. */
export type GitActionNativeCompletionReader = (actualNativeHandle: object) => { actionId: string; outcome: GitActionNativeOutcome } | undefined;
export async function finishVerifiedNativeGitAction(handle: GitActionHandle, completedResult: object,
  readVerifiedResult: GitActionNativeCompletionReader): Promise<void> {
  if (!["workspace", "preparation", "checkout-verification", "cleanup"].includes(handle.record.kind)) throw new Error("Native history kind required");
  if (handle.record.state !== "executing") throw new Error("Native completion requires an executing action; no execution is inferred from history");
  let proof: ReturnType<GitActionNativeCompletionReader>;
  try { proof = readVerifiedResult(completedResult); }
  catch { /* Verification failure supplies no completion evidence. */ }
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
  try { await handle.update(state, { outcome, ...(state === "recovery-required" ? { reason: "Measured partial effects require manual recovery; do not retry." } : {}) }); }
  catch { handle.release(); throw new GitActionRecordingError(handle.record.id, outcome); }
}
/** Actual-native identity reader only, after independent measured removal and
 * before branch deletion. A parsed historical proof/ID is never accepted. */
export async function recordVerifiedCleanupRemoval(handle: GitActionHandle, actualRemovalHandle: object,
  readVerifiedResult: GitActionNativeCompletionReader): Promise<void> {
  if (handle.record.kind !== "cleanup" || handle.record.state !== "executing") throw new Error("Live executing cleanup required");
  let proof: ReturnType<GitActionNativeCompletionReader>;
  try { proof = readVerifiedResult(actualRemovalHandle); } catch { /* No measured evidence. */ }
  let outcome: GitActionOutcome | undefined;
  try { if (proof) outcome = captureGitActionOutcome(proof.outcome); } catch { /* No raw diagnostics leave the private reader. */ }
  if (!proof || proof.actionId !== handle.record.id || outcome?.kind !== "cleanup" || outcome.status !== "worktree-removed") {
    await failGitAction(handle, true); handle.release(); throw new GitActionApplyError(handle.record.id, handle.record.intended);
  }
  try { await handle.update("executing", { outcome }); }
  catch { handle.release(); throw new GitActionRecordingError(handle.record.id, outcome); }
}
export async function finishGitAction(handle: GitActionHandle, outcome: GitActionOutcome, partial = false): Promise<void> {
  if (["workspace", "preparation", "checkout-verification", "cleanup"].includes(handle.record.kind)) {
    throw new Error("Native completion requires an independently verified actual-native result identity");
  }
  // Native partial results may carry extra diagnostics. Only durable facts enter history.
  outcome = Object.fromEntries(Object.entries(outcome).filter(([key]) =>
    ["status", "commit", "tree", "parents", "authorEmail", "targetBranch", "featureOid", "targetOid", "mergeOid", "kind", "workspace", "preparation", "checkoutVerification", "cleanup", "workingWorkspaceVerification"].includes(key)));
  if (outcome.workingWorkspaceVerification) outcome.workingWorkspaceVerification = captureGitActionOutcome({
    workingWorkspaceVerification: outcome.workingWorkspaceVerification }).workingWorkspaceVerification;
  try { await handle.update(partial ? "recovery-required" : "succeeded", { outcome,
    ...(partial ? { reason: "Git reported a partial result. Inspect the checkout before taking further action; do not retry." } : {}) }); }
  catch { throw new GitActionRecordingError(handle.record.id, outcome); }
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
