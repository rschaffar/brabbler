import { createGitAction, emitGitActionAnchor, releaseGitAction, transitionGitAction } from "./git-action-journal";
import { GIT_ACTION_ANCHOR_TYPE, isGitActionAnchor, type GitActionCandidateSnapshot, type GitActionOutcome, type GitActionRecord, type GitActionSource, type GitActionState } from "./git-action-types";
import { invalidateSessionListCache, invalidateSessionManagerCache } from "./session-reader";
import type { GitActionCandidate, SessionEntry } from "./types";
import { GitCommitOperationError } from "./git-commit";
import { samePath } from "./paths";
import type { GitProjectResources } from "./git-project-resources";

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
    case "commit": return { kind: "commit", repositoryRoot: candidate.preview.repositoryRoot, ...attribution,
      featureBranch: candidate.preview.branch, message: candidate.message, commitMode: candidate.preview.mode, paths: [...candidate.preview.paths],
      parentOid: candidate.preview.head, candidateTreeOid: candidate.preview.tree, diff: { ...candidate.diff } };
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
export interface GitActionHandle {
  readonly record: GitActionRecord;
  update(state: GitActionState, extra?: { decision?: GitActionRecord["decision"]; reason?: string; outcome?: GitActionOutcome; intended?: GitActionOutcome }): Promise<void>;
  release(): void;
}
export async function beginGitAction(sink: GitActionSink, source: GitActionSource, candidate: GitActionCandidateSnapshot): Promise<GitActionHandle> {
  let record = await createGitAction({ sessionId: sink.sessionId, source, candidate });
  const handle: GitActionHandle = {
    get record() { return record; },
    async update(state, extra = {}) { record = await transitionGitAction(record.id, record.revision, { state, ...extra }); },
    release() { releaseGitAction(record.id); },
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
export async function finishGitAction(handle: GitActionHandle, outcome: GitActionOutcome, partial = false): Promise<void> {
  // Native partial results may carry extra diagnostics. Only durable facts enter history.
  outcome = Object.fromEntries(Object.entries(outcome).filter(([key]) =>
    ["status", "commit", "tree", "parents", "authorEmail", "targetBranch", "featureOid", "targetOid", "mergeOid"].includes(key)));
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
