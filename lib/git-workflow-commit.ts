import { GitCommitOperationError, type GitCommitMode } from "./git-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionAttribution, gitActionFailureResult, gitActionDiagnosticReport, type GitActionHandle, type GitActionSink } from "./git-action-controller";
import { applyExactCommitOperation, captureExactCommitCandidate, GitExactCommitCompletionError } from "./git-exact-commit-operation";
import type { GitActionCandidate } from "./types";
import { selectGitProjectResources, type GitProjectResources } from "./git-project-resources";
import type { GitCommitAuthority } from "./git-commit-invocation";
import type { GitCommitVerificationContext, GitCommitVerificationSummary } from "./git-commit-verification";
import { GitCommitVerificationError } from "./git-commit-verification";
import { lookupGitCheckoutVerificationReceipt, readGitCheckoutVerificationNativeExecution } from "./git-checkout-verification";
import type { GitActionWorkingWorkspaceEvidence, GitActionOutcome } from "./git-action-types";

export const GIT_COMMIT_DIAGNOSTICS_WARNING = "Commit completed; outcome diagnostics unavailable. Do not repeat this operation.";

/** Exact signal provenance only. Native wraps pre-CAS refusals in this known
 * no-effect type; generic nested causes and coincident Stop prove nothing. */
export function isWorkflowCommitCancellation(cause: unknown, signal?: AbortSignal): boolean {
  const reason: unknown = signal?.aborted ? signal.reason : undefined;
  return reason !== undefined && (cause === reason || cause instanceof GitCommitOperationError && cause.cause === reason);
}

/** Read AFTER diagnostic awaits. A callback warning covers other optional
 * writers; storage loss takes precedence over bounded retention omission. */
export function workflowCommitDiagnosticReport(handle: GitActionHandle, recordingUnavailable = false) {
  const report = gitActionDiagnosticReport(handle);
  return recordingUnavailable ? { ...report, diagnosticsUnavailable: true as const,
    diagnostics: { status: "unavailable" as const, reason: "storage-unavailable" as const } } : report;
}

/** Public recovery retains effects/IDs but not private native receipt proofs. */
export function workflowCommitFailureResult(cause: unknown) {
  if (cause instanceof GitExactCommitCompletionError) return {
    content: [{ type: "text" as const, text: GIT_COMMIT_DIAGNOSTICS_WARNING }],
    details: { ...cause.completion, diagnosticsUnavailable: true, recoveryWarning: GIT_COMMIT_DIAGNOSTICS_WARNING },
  };
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
  /** Original trusted authority captured before asynchronous preparation. */
  authority: GitCommitAuthority;
  ask: (candidate: GitActionCandidate, signal?: AbortSignal) => Promise<boolean>;
  /** Fresh caller permission checks. The original authority below remains the
   * final native fence; any additional synchronous guard is retained too. */
  beforeApply: () => Promise<void | (() => void)>;
  verificationContext?: GitCommitVerificationContext;
  /** Agent-only live authorization closure, not a boolean assumption of
   * authority. Supplied only for an explicit confirmation:none request. */
  authorizeWithoutConfirmation?: () => Promise<void>;
  /** Explicit-project callers supply a server-selected identity and private
   * agent directory. Legacy chat-checkout commits retain their existing route. */
  selected?: GitProjectResources;
  agentDir?: string;
}) {
  const assertStandingGrant = async () => { await options.authorizeWithoutConfirmation?.(); };
  options.authority.assertCurrentSync();
  const { candidate, action, selection, verification } = await (async () => {
    await options.beforeApply();
    await assertStandingGrant();
    options.authority.assertCurrentSync();
    const selection = options.selected ?? await selectGitProjectResources(options.cwd);
    await options.authority.selectSource(selection);
    const captured = await captureExactCommitCandidate(options.cwd, options.paths, options.message, options.mode ?? "whole-file", false, options.verificationContext);
    const action = await beginGitAction(options.sink, "agent", { ...captured.snapshot, ...gitActionAttribution(selection),
      workingWorkspaceVerification: workflowCommitVerificationEvidence(options.verificationContext, captured.verification.summary) });
    return { candidate: captured.candidate!, action, selection, verification: captured.verification }; // Agent Ask requires a complete patch.
  })();
  // Only this invocation's exact approval and original authority matter.
  let enteredApply = false;
  let atRefBoundary = false;
  let approved = false;
  let diagnosticsUnavailable = false;
  // Native core publishes executing+intent only from its genuine owned-FD
  // callback. Keep the real own approval on pre-effect failures too.
  const applyingAction = { get record() { return action.record; }, release: action.release,
    async update(state: Parameters<typeof action.update>[0], extra: Parameters<typeof action.update>[1] = {}) {
      return action.update(state, { ...(approved ? { decision: "approved" as const } : {}),
        ...(state === "executing" && options.authorizeWithoutConfirmation ? { reason: "Selected-project saved Allow and confirmation:none; no candidate prompt was requested." } : {}), ...extra,
        ...(extra.intended ? { intended: { ...extra.intended, workingWorkspaceVerification: action.record.summary.workingWorkspaceVerification } } : {}) });
    } };
  try {
    options.authority.assertCurrentSync();
    if (options.authorizeWithoutConfirmation) {
      await options.beforeApply();
      await assertStandingGrant();
      options.signal?.throwIfAborted();
      // No human decision. Native core publishes optional intent diagnostics
      // only after it holds the real reservation and owned index-lock FD.
    } else {
      await action.update("awaiting-decision");
      if (!await options.ask({ ...structuredClone(candidate), actionId: action.record.id, ...gitActionDiagnosticReport(action) }, options.signal) || options.signal?.aborted) {
        await action.update(options.signal?.aborted ? "cancelled" : "declined", { decision: options.signal?.aborted ? "cancelled" : "declined" });
        const diagnostics = workflowCommitDiagnosticReport(action, diagnosticsUnavailable);
        return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." +
          (diagnostics.diagnosticsUnavailable ? " Commit diagnostics unavailable." : "") }],
          details: { approved: false, actionId: action.record.id, ...diagnostics } };
      }
      // Human approval is a fact, not an admission exemption.
      approved = true;
    }
    const assertApprovalSync = () => {
      options.signal?.throwIfAborted();
      if (!approved && !options.authorizeWithoutConfirmation) throw new Error("Exact commit approval required");
      options.authority.assertCurrentSync();
    };
    const invocation = options.authority.bind(selection, candidate.preview, options.message, assertApprovalSync);
    enteredApply = true;
    const result = await applyExactCommitOperation({ handle: applyingAction, preview: candidate.preview, message: options.message, selection, invocation,
        agentDir: options.agentDir, signal: options.signal,
        onRecordingUnavailable: () => { diagnosticsUnavailable = true; },
        verificationContext: options.verificationContext, verificationHandle: verification.handle,
        beforeApply: async () => {
          await assertStandingGrant(); const additionalGuard = await options.beforeApply();
          assertApprovalSync();
          return () => {
            assertApprovalSync();
            const value: unknown = additionalGuard?.();
            if (value !== undefined) { void Promise.resolve(value).catch(() => {}); throw new Error("Synchronous commit guard required"); }
            assertApprovalSync();
          };
        },
        atRefBoundary: () => { atRefBoundary = true; },
        beforeRefUpdate: (reservation) => reservation.assertOwned(),
        finish: async (result) => result,
        record: (result) => finishGitAction(applyingAction, { ...result,
          workingWorkspaceVerification: action.record.summary.workingWorkspaceVerification }, result.status === "partial-success"),
      });
    const report = workflowCommitDiagnosticReport(applyingAction, diagnosticsUnavailable);
    const diagnostics = { ...report, ...(report.diagnosticsUnavailable ? { recoveryWarning: GIT_COMMIT_DIAGNOSTICS_WARNING } : {}) };
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, ...diagnostics }) }], details: { ...result, ...diagnostics, actionId: action.record.id,
      workingWorkspaceVerification: verification.summary,
      ...(options.authorizeWithoutConfirmation ? { approval: "saved-project-allow" } : {}),
      ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) } };
  } catch (cause) {
    // Preserve the own decision on failures before native operation entry.
    if (!enteredApply) await failGitAction(applyingAction, false, options.signal, cause);
    if (!atRefBoundary && isWorkflowCommitCancellation(cause, options.signal)) {
      const diagnostics = workflowCommitDiagnosticReport(action, diagnosticsUnavailable);
      return { content: [{ type: "text" as const, text: "Commit cancelled; no commit was made." +
        (diagnostics.diagnosticsUnavailable ? " Commit diagnostics unavailable." : "") }],
        details: { approved: false, actionId: action.record.id, ...diagnostics } };
    }
    throw cause;
  } finally { action.release(); }
}
