import type { GitCommitMode } from "./git-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionAttribution, gitActionFailureResult, type GitActionSink } from "./git-action-controller";
import { applyExactCommitOperation, captureExactCommitCandidate } from "./git-exact-commit-operation";
import type { GitActionCandidate } from "./types";
import { withGitCheckoutGate } from "./git-checkout-gate";
import { assertGitOperationAdmission, selectGitCommitAdmission, GitOperationRecoveryError } from "./git-operation-admission";
import type { GitProjectResources } from "./git-project-resources";
import type { GitCommitVerificationContext, GitCommitVerificationSummary } from "./git-commit-verification";
import { GitCommitVerificationError } from "./git-commit-verification";
import { lookupGitCheckoutVerificationReceipt, readGitCheckoutVerificationNativeExecution } from "./git-checkout-verification";
import type { GitActionWorkingWorkspaceEvidence, GitActionOutcome } from "./git-action-types";

/** Public recovery retains effects/IDs but not private native receipt proofs. */
export function workflowCommitFailureResult(cause: unknown) {
  const recorded = gitActionFailureResult(cause);
  if (!recorded || !("outcome" in recorded.details)) return recorded;
  const project = (facts: GitActionOutcome | undefined) => {
    if (!facts?.workingWorkspaceVerification) return facts;
    const { workingWorkspaceVerification: evidence, ...effects } = facts;
    return { ...effects, workingWorkspaceVerification: { evidenceScope: evidence.evidenceScope,
      candidateTreeVerified: false, repositoryChecksWaived: false,
      checkIndexes: [...evidence.requiredSavedIndexes], receiptIds: evidence.runs.flatMap((r) => r.receipt ? [r.receipt.id] : []) } };
  };
  const details = { ...recorded.details, outcome: project(recorded.details.outcome),
    ...("intended" in recorded.details ? { intended: project(recorded.details.intended) } : {}) };
  return { ...recorded, content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

/** Projection of ORIGINAL live native v3 rows only, after common validation.
 * Historical IDs, clones, v2 receipts and invented execution metadata refuse. */
export function workflowCommitVerificationEvidence(context: GitCommitVerificationContext | undefined,
  summary: GitCommitVerificationSummary): GitActionWorkingWorkspaceEvidence {
  const runs = summary.checkIndexes.map((index) => {
    const receipt = summary.receiptIds.map((id) => lookupGitCheckoutVerificationReceipt(id)).find((r) => r?.checkIndex === index);
    const row = readGitCheckoutVerificationNativeExecution(receipt);
    if (!receipt || receipt.version !== 3 || receipt.stage !== "commit" || receipt.sessionId !== context?.sessionId || !row ||
      row.receipt?.id !== receipt.id || row.stage !== "commit" || row.checkIndex !== index || row.exitStatus !== 0 || !row.containmentComplete) throw new GitCommitVerificationError("stale");
    return structuredClone(row);
  });
  return { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false,
    requiredSavedIndexes: [...summary.checkIndexes], runs };
}

/** Shared exact-Ask and explicitly authorized selected-project commit path.
 * Patch bytes live in private artifacts/UI, never tool results. */
export async function requestWorkflowCommit(options: {
  cwd: string; paths: string[]; message: string; mode?: GitCommitMode; signal?: AbortSignal;
  sink: GitActionSink;
  ask: (candidate: GitActionCandidate, signal?: AbortSignal) => Promise<boolean>;
  /** Mandatory trusted final synchronous authority guard. Native invokes it
   * after its final launch preparation, with no intervening await before CAS. */
  beforeApply: () => Promise<void | (() => void)>;
  verificationContext?: GitCommitVerificationContext;
  /** Agent-only live authorization closure, not a boolean assumption of
   * authority. Supplied only for an explicit confirmation:none request. */
  authorizeWithoutConfirmation?: () => Promise<void>;
  /** Explicit-project callers supply a server-selected identity and its private
   * admission root. Legacy chat-checkout commits retain their existing route. */
  selected?: GitProjectResources;
  agentDir?: string;
}) {
  const assertStandingGrant = async () => { await options.authorizeWithoutConfirmation?.(); };
  const { candidate, action, selection, verification } = await withGitCheckoutGate([options.cwd], async () => {
    await options.beforeApply();
    await assertStandingGrant();
    const selection = options.selected ?? await selectGitCommitAdmission(options.cwd);
    if (options.selected) await assertGitOperationAdmission(selection, options.agentDir);
    const captured = await captureExactCommitCandidate(options.cwd, options.paths, options.message, options.mode ?? "whole-file", false, options.verificationContext);
    const action = await beginGitAction(options.sink, "agent", { ...captured.snapshot, ...gitActionAttribution(selection),
      workingWorkspaceVerification: workflowCommitVerificationEvidence(options.verificationContext, captured.verification.summary) });
    return { candidate: captured.candidate!, action, selection, verification: captured.verification }; // Agent Ask requires a complete patch.
  });
  // No checkout reservation while a human reviews (or between capture and
  // apply on the no-prompt path). Admission is rechecked under the apply gate.
  let enteredApply = false;
  let atRefBoundary = false;
  let approved = false;
  // Native core publishes executing+intent only from its genuine owned-FD/
  // held-reservation callback. Earlier execution history would quarantine its
  // own required receipt validation. Keep the real decision on failures too.
  const applyingAction = { get record() { return action.record; }, release: action.release,
    async update(state: Parameters<typeof action.update>[0], extra: Parameters<typeof action.update>[1] = {}) {
      return action.update(state, { ...(approved ? { decision: "approved" as const } : {}),
        ...(state === "executing" && options.authorizeWithoutConfirmation ? { reason: "Selected-project saved Allow and confirmation:none; no candidate prompt was requested." } : {}), ...extra,
        ...(extra.intended ? { intended: { ...extra.intended, workingWorkspaceVerification: action.record.summary.workingWorkspaceVerification } } : {}) });
    } };
  try {
    if (options.authorizeWithoutConfirmation) {
      await options.beforeApply();
      await assertStandingGrant();
      options.signal?.throwIfAborted();
      // No human decision. Native core will durably publish its exact intent
      // after it holds the real reservation and owned index-lock FD.
    } else {
      await action.update("awaiting-decision");
      if (!await options.ask({ ...candidate, actionId: action.record.id }, options.signal) || options.signal?.aborted) {
        await action.update(options.signal?.aborted ? "cancelled" : "declined", { decision: options.signal?.aborted ? "cancelled" : "declined" });
        return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." }], details: { approved: false, actionId: action.record.id } };
      }
      // Human approval is a fact, not an admission exemption.
      approved = true;
    }
    const result = await withGitCheckoutGate([options.cwd], async () => {
      enteredApply = true;
      return applyExactCommitOperation({ handle: applyingAction, preview: candidate.preview, message: options.message, selection,
        agentDir: options.agentDir, signal: options.signal, revalidateBeforeIntent: true,
        verificationContext: options.verificationContext, verificationHandle: verification.handle,
        beforeApply: async () => {
          await assertStandingGrant(); const guard = await options.beforeApply();
          if (typeof guard !== "function") throw new Error("Trusted synchronous commit authority guard required");
          return guard;
        },
        atRefBoundary: () => { atRefBoundary = true; },
        beforeRefUpdate: (reservation) => reservation.assertOwned(),
        finish: async (result) => { await finishGitAction(action, { ...result,
          workingWorkspaceVerification: action.record.summary.workingWorkspaceVerification }, result.status === "partial-success"); return result; },
        shouldResolve: (result) => result.status === "committed",
      });
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: action.record.id,
      workingWorkspaceVerification: verification.summary,
      ...(options.authorizeWithoutConfirmation ? { approval: "saved-project-allow" } : {}),
      ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) } };
  } catch (cause) {
    // The shared operation settles post-admission failures; a busy apply gate
    // never entered it and must still preserve the already-recorded decision.
    if (!enteredApply) await failGitAction(applyingAction, false, options.signal, cause);
    if (!atRefBoundary && options.signal?.aborted && !(cause instanceof GitOperationRecoveryError)) return {
      content: [{ type: "text" as const, text: "Commit cancelled; no commit was made." }],
      details: { approved: false, actionId: action.record.id },
    };
    if (cause instanceof GitOperationRecoveryError) throw cause;
    throw cause;
  } finally { action.release(); }
}
