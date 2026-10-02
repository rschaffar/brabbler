import { confirmGitCommit, prepareGitCommit, GitCommitOperationError, type GitCommitMode, type GitCommitPreview, type GitCommitResult } from "./git-commit";
import { failGitAction, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError, type GitActionHandle } from "./git-action-controller";
import type { GitActionCandidateSnapshot } from "./git-action-types";
import { getGitCommitTreeOid, getGitTreeDiff, GitReviewError, GIT_REVIEW_DIFF_MAX_BYTES } from "./git-review";
import { beginSupervisedGitOperationIntent, revalidateGitCommitAdmission, GitOperationRecoveryError, type GitOperationReservation } from "./git-operation-admission";
import type { GitProjectResources } from "./git-project-resources";

/** Run under the caller's capture gate. Only the browser may offer an oversized
 * patch as explicitly unavailable; the agent's Ask card still requires a diff. */
export async function captureExactCommitCandidate(cwd: string, paths: string[], message: string, mode: GitCommitMode,
  allowOversizedDiff = false) {
  const preview = await prepareGitCommit(cwd, paths, mode);
  const parentTree = await getGitCommitTreeOid(cwd, preview.head);
  try {
    const diff = await getGitTreeDiff(cwd, parentTree, preview.tree);
    const candidate = { kind: "commit" as const, preview, message, diff };
    return { preview, candidate, snapshot: snapshotGitActionCandidate(candidate), candidateDiff: diff, candidateDiffUnavailable: undefined };
  } catch (cause) {
    if (!allowOversizedDiff || !(cause instanceof GitReviewError) || cause.code !== "DIFF_TOO_LARGE") throw cause;
    const candidateDiffUnavailable = `Candidate patch exceeds the ${GIT_REVIEW_DIFF_MAX_BYTES / (1024 * 1024)} MB limit; review the whole-file candidate tree before confirming.`;
    const snapshot: GitActionCandidateSnapshot = { kind: "commit", repositoryRoot: cwd, featureBranch: preview.branch, message,
      commitMode: preview.mode, paths: [...preview.paths], parentOid: preview.head, candidateTreeOid: preview.tree, diffUnavailable: candidateDiffUnavailable };
    return { preview, candidate: undefined, snapshot, candidateDiff: undefined, candidateDiffUnavailable };
  }
}

/** Called only AFTER actor-specific approval, inside that actor's apply gate.
 * The caller owns permission/revocation checks, approval and final recording;
 * this owns the shared durable intent, native CAS boundary and failure rules. */
export async function applyExactCommitOperation<T>(options: {
  handle: GitActionHandle; preview: GitCommitPreview; message: string; selection: GitProjectResources;
  signal?: AbortSignal; agentDir?: string;
  beforeApply: () => Promise<void>;
  /** The agent previously revalidated before writing intent; the browser did
   * so in the native callback. Neither actor's admission order is relaxed. */
  revalidateBeforeIntent?: boolean;
  atRefBoundary?: () => void;
  /** Agent callers already checked reservation ownership here; browser callers
   * retain their existing pre-CAS admission protocol. */
  beforeRefUpdate?: (reservation: GitOperationReservation) => void;
  finish: (result: GitCommitResult) => Promise<T>;
  shouldResolve: (result: GitCommitResult, recorded: T) => boolean;
}): Promise<T> {
  const { handle, preview, message, selection } = options;
  let applying = false;
  let reservation: Awaited<ReturnType<typeof beginSupervisedGitOperationIntent>> | undefined;
  try {
    await options.beforeApply();
    options.signal?.throwIfAborted();
    if (options.revalidateBeforeIntent) await revalidateGitCommitAdmission(selection);
    reservation = await beginSupervisedGitOperationIntent(selection, handle.record.id, "commit", options.agentDir);
    const result = await confirmGitCommit(preview, message, async (intended) => {
      // No ref CAS until the exact object identity is durable and access is live.
      await handle.update("executing", { intended });
      await options.beforeApply();
      options.signal?.throwIfAborted();
      await revalidateGitCommitAdmission(selection);
      reservation!.assertOwned();
      options.beforeRefUpdate?.(reservation!);
      options.atRefBoundary?.();
      applying = true;
    });
    const recorded = await options.finish(result);
    if (options.shouldResolve(result, recorded)) {
      try { reservation.resolve(); } catch { throw new GitOperationRecoveryError(handle.record.id); }
    }
    return recorded;
  } catch (cause) {
    await failGitAction(handle, applying, options.signal, cause);
    // A definite pre-CAS refusal may release the intent; uncertain results,
    // partial success and failed journal writes remain quarantined.
    if (reservation && handle.record.state === "blocked" && (!applying || cause instanceof GitCommitOperationError)) {
      try { reservation.resolve(); } catch { throw new GitOperationRecoveryError(handle.record.id); }
    }
    if (applying && !(cause instanceof GitCommitOperationError) && !(cause instanceof GitActionRecordingError) && !(cause instanceof GitOperationRecoveryError)) {
      throw new GitActionApplyError(handle.record.id, handle.record.intended);
    }
    throw cause;
  }
}
