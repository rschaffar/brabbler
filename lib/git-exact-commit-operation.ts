import { confirmGitCommit, prepareGitCommit, captureGitCommitProtectedBoundary, gitCommitInvocationBinding, readGitCommitNativeCompletion, GitCommitOperationError, type GitCommitMode, type GitCommitPreview, type GitCommitResult } from "./git-commit";
import { assertGitInvocationCurrentSync, retireGitInvocation, type GitInvocationBinding, type GitInvocationHandle } from "./git-invocation";
import { failGitAction, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError, type GitActionHandle } from "./git-action-controller";
import type { GitActionCandidateSnapshot } from "./git-action-types";
import { getGitCommitTreeOid, getGitTreeDiff, GitReviewError, GIT_REVIEW_DIFF_MAX_BYTES } from "./git-review";
import { beginSupervisedGitOperationIntent, revalidateGitCommitAdmission, type GitOperationInvocation } from "./git-operation-admission";
import type { GitProjectResources } from "./git-project-resources";
import { captureGitCommitVerification, bindGitCommitVerification, revalidateGitCommitVerification,
  type GitCommitVerificationContext, type GitCommitVerificationHandle, type GitCommitProtectedBoundary } from "./git-commit-verification";

/** Capture the exact candidate before approval. Only the browser may offer an oversized
 * patch as explicitly unavailable; the agent's Ask card still requires a diff. */
export async function captureExactCommitCandidate(cwd: string, paths: string[], message: string, mode: GitCommitMode,
  allowOversizedDiff = false, verificationContext?: GitCommitVerificationContext) {
  const verification = await captureGitCommitVerification(cwd, verificationContext);
  const preview = await prepareGitCommit(cwd, paths, mode);
  bindGitCommitVerification(verification.handle, preview, message);
  const parentTree = await getGitCommitTreeOid(cwd, preview.head);
  try {
    const diff = await getGitTreeDiff(cwd, parentTree, preview.tree);
    const candidate = { kind: "commit" as const, preview, message, diff };
    return { preview, candidate, snapshot: snapshotGitActionCandidate(candidate), candidateDiff: diff, candidateDiffUnavailable: undefined, verification };
  } catch (cause) {
    if (!allowOversizedDiff || !(cause instanceof GitReviewError) || cause.code !== "DIFF_TOO_LARGE") throw cause;
    const candidateDiffUnavailable = `Candidate patch exceeds the ${GIT_REVIEW_DIFF_MAX_BYTES / (1024 * 1024)} MB limit; review the whole-file candidate tree before confirming.`;
    const snapshot: GitActionCandidateSnapshot = { kind: "commit", repositoryRoot: cwd, featureBranch: preview.branch, message,
      commitMode: preview.mode, paths: [...preview.paths], parentOid: preview.head, candidateTreeOid: preview.tree, diffUnavailable: candidateDiffUnavailable };
    return { preview, candidate: undefined, snapshot, candidateDiff: undefined, candidateDiffUnavailable, verification };
  }
}

export { gitCommitInvocationBinding as gitExactCommitInvocationBinding } from "./git-commit";
/** An orchestration error AFTER native completion is not a native failure.
 * completion is the original privately issued result, not reconstructed JSON. */
export class GitExactCommitCompletionError extends Error {
  constructor(readonly completion: GitCommitResult, cause: unknown) {
    super("Git commit completed; caller finalization failed", { cause });
  }
}
/** TypeScript's void callback type also accepts async functions. Enforce the
 * runtime contract without awaiting caller work; drain rejected returns AND
 * throws (including arbitrary thenables) so refusal cannot leak rejections. */
function runCommitBoundaryGuardSync(callback: () => unknown): void {
  let value: unknown;
  try { value = callback(); }
  catch (cause) {
    void Promise.resolve(cause).catch(() => {});
    throw cause;
  }
  if (value !== undefined) {
    void Promise.resolve(value).catch(() => {});
    throw new Error("Git commit authority guard must be synchronous and return undefined");
  }
}
/** Called only AFTER actor-specific approval. The caller captures the original
 * session/file/generation and scoped authority before waiting. No application
 * admission gate or historical record confers permission on this adapter. */
export async function applyExactCommitOperation<T>(options: {
  handle: GitActionHandle; preview: GitCommitPreview; message: string; selection: GitProjectResources;
  signal?: AbortSignal; agentDir?: string;
  invocation: { handle: GitInvocationHandle; owner: GitInvocationBinding["owner"] };
  beforeApply: (protectedBoundary?: GitCommitProtectedBoundary) => Promise<void | (() => void)>;
  /** Server-only source B callbacks/IDs, independent of old caller A policy. */
  verificationContext?: GitCommitVerificationContext;
  /** Process-owned capture result; never reconstruct from JSON/history. */
  verificationHandle?: GitCommitVerificationHandle;
  /** Optional extra physical revalidation; never scans history. */
  revalidateBeforeIntent?: boolean;
  atRefBoundary?: () => void;
  beforeRefUpdate?: (operation: GitOperationInvocation) => void;
  /** Essential orchestration. Errors propagate WITH authentic native completion. */
  finish: (result: GitCommitResult) => Promise<T>;
  /** Optional diagnostics only; do not place authorization/orchestration here. */
  record?: (result: GitCommitResult, finished: T) => Promise<void>;
  onRecordingUnavailable?: () => void;
}): Promise<T> {
  const { handle, preview, message, selection } = options;
  let applying = false;
  let operation: GitOperationInvocation | undefined;
  let completion: GitCommitResult | undefined;
  const invocation = options.invocation?.handle;
  const binding = options.invocation && gitCommitInvocationBinding(selection, preview, message, options.invocation.owner);
  const unavailable = () => {
    if (options.onRecordingUnavailable) options.onRecordingUnavailable();
    else console.warn("Git commit diagnostics unavailable; native outcome is independent of recording.");
  };
  try {
    if (!invocation || !binding || binding.owner.sessionId !== handle.record.sessionId)
      throw new GitCommitOperationError("Git commit requires its original caller invocation.");
    assertGitInvocationCurrentSync(invocation, binding);
    if (selection.cwd !== preview.repositoryRoot || `refs/heads/${selection.branch}` !== preview.branch) {
      throw new GitCommitOperationError("Git commit source does not match the captured physical checkout.");
    }
    // Even legacy/manual apply callers that omit both new fields must discover
    // the actual canonical source prerequisites. No optional-callback bypass.
    let verificationHandle = options.verificationHandle;
    if (!verificationHandle) {
      const captured = await captureGitCommitVerification(preview.repositoryRoot, options.verificationContext);
      verificationHandle = captured.handle;
      bindGitCommitVerification(verificationHandle, preview, message);
    }
    await options.beforeApply();
    options.signal?.throwIfAborted();
    const beforeIntentGuard = await revalidateGitCommitVerification(verificationHandle, preview, message, undefined, handle.record.sessionId);
    if (options.revalidateBeforeIntent) await revalidateGitCommitAdmission(selection);
    beforeIntentGuard();
    operation = await beginSupervisedGitOperationIntent(selection, handle.record.id, "commit", options.agentDir);
    const result = await confirmGitCommit(preview, message, async (intended, ownedLock) => {
      // Recording does not authorize or prove effects. Keep its failure separate
      // from the essential original authority and required-receipt callbacks.
      try { await handle.update("executing", { intended }); } catch { unavailable(); }
      const protectedBoundary = captureGitCommitProtectedBoundary(ownedLock, operation!, selection, invocation, binding, options.agentDir);
      const authorityGuard = await options.beforeApply(protectedBoundary);
      options.signal?.throwIfAborted();
      await revalidateGitCommitAdmission(selection);
      const evidenceGuard = await revalidateGitCommitVerification(verificationHandle!, preview, message, protectedBoundary, handle.record.sessionId);
      operation!.assertOwned();
      // Native runs this AFTER its post-await real status/index recapture and
      // immediately before starting ref CAS. No optimistic async authority stamp.
      return () => {
        options.signal?.throwIfAborted();
        operation!.assertOwned();
        runCommitBoundaryGuardSync(() => options.beforeRefUpdate?.(operation!));
        runCommitBoundaryGuardSync(() => options.atRefBoundary?.());
        if (authorityGuard !== undefined) {
          if (typeof authorityGuard !== "function") throw new Error("Git commit authority guard must be synchronous");
          runCommitBoundaryGuardSync(authorityGuard);
        }
        evidenceGuard();
        operation!.assertOwned();
        assertGitInvocationCurrentSync(invocation, binding);
        applying = true;
      };
    }, { operation, invocation, binding });
    if (!readGitCommitNativeCompletion(result, invocation)) throw new Error("Missing authentic native commit completion");
    completion = result;
    const finished = await options.finish(result);
    if (options.record) { try { await options.record(result, finished); } catch { unavailable(); } }
    return finished;
  } catch (cause) {
    // Never turn known CAS completion into a fictitious native failure because
    // a journal or essential caller finalizer threw. No diagnostic is authority.
    if (completion) throw new GitExactCommitCompletionError(completion, cause);
    await failGitAction(handle, applying, options.signal, cause);
    if (applying && !(cause instanceof GitCommitOperationError) && !(cause instanceof GitActionRecordingError)) {
      throw new GitActionApplyError(handle.record.id, handle.record.intended);
    }
    throw cause;
  } finally {
    operation?.retire();
    if (invocation) retireGitInvocation(invocation);
  }
}
