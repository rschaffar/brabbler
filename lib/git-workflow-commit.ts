import { prepareGitCommit, confirmGitCommit, GitCommitOperationError, type GitCommitMode } from "./git-commit";
import { getGitCommitTreeOid, getGitTreeDiff } from "./git-review";
import { beginGitAction, failGitAction, finishGitAction, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError, type GitActionSink } from "./git-action-controller";
import type { GitActionCandidate } from "./types";
import { withGitCheckoutGate } from "./git-checkout-gate";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent, revalidateGitCommitAdmission, selectGitCommitAdmission, GitOperationRecoveryError, type GitOperationReservation } from "./git-operation-admission";
import type { GitProjectResources } from "./git-project-resources";
import { readProjectAuthorization, type ProjectAuthorizationOwner } from "./git-project-authorization";

/** Shared exact-Ask and explicitly authorized selected-project commit path.
 * Patch bytes live in private artifacts/UI, never tool results. */
export async function requestWorkflowCommit(options: {
  cwd: string; paths: string[]; message: string; mode?: GitCommitMode; signal?: AbortSignal;
  sink: GitActionSink;
  ask: (candidate: GitActionCandidate, signal?: AbortSignal) => Promise<boolean>;
  beforeApply: () => Promise<void>;
  /** Only a caller with its own live selected-project Allow/None gate may set
   * this. This flag is a request, not authorization; beforeApply rechecks. */
  skipApproval?: boolean;
  /** Explicit-project callers supply a server-selected identity and its private
   * admission root. Legacy chat-checkout commits retain their existing route. */
  selected?: GitProjectResources;
  agentDir?: string;
  owner?: ProjectAuthorizationOwner;
}) {
  const assertStandingGrant = async () => {
    if (!options.skipApproval) return;
    if (!options.selected || !options.owner || !options.agentDir ||
      (await readProjectAuthorization(options.selected, options.owner, options.agentDir)).actions.commit.effective !== "allow") {
      throw new Error("No-prompt commit requires a fresh effective saved selected-project Allow");
    }
  };
  const { candidate, action, selection } = await withGitCheckoutGate([options.cwd], async () => {
    await options.beforeApply();
    await assertStandingGrant();
    const selection = options.selected ?? await selectGitCommitAdmission(options.cwd);
    if (options.selected) await assertGitOperationAdmission(selection, options.agentDir);
    const preview = await prepareGitCommit(options.cwd, options.paths, options.mode);
    const parentTree = await getGitCommitTreeOid(options.cwd, preview.head);
    const diff = await getGitTreeDiff(options.cwd, parentTree, preview.tree);
    const candidate = { kind: "commit" as const, preview, message: options.message, diff };
    const action = await beginGitAction(options.sink, "agent", snapshotGitActionCandidate(candidate));
    return { candidate, action, selection };
  });
  // No checkout reservation while a human reviews (or between capture and
  // apply on the no-prompt path). Admission is rechecked under the apply gate.
  let applying = false;
  let reservation: GitOperationReservation | undefined;
  try {
    if (options.skipApproval) {
      await options.beforeApply();
      await assertStandingGrant();
      options.signal?.throwIfAborted();
      // Never record a human decision that did not occur. The durable action
      // enters executing directly, with an explicit standing-grant rationale.
      await action.update("executing", { reason: "Selected-project saved Allow and confirmation:none; no candidate prompt was requested." });
    } else {
      await action.update("awaiting-decision");
      if (!await options.ask({ ...candidate, actionId: action.record.id }, options.signal) || options.signal?.aborted) {
        await action.update(options.signal?.aborted ? "cancelled" : "declined", { decision: options.signal?.aborted ? "cancelled" : "declined" });
        return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." }], details: { approved: false, actionId: action.record.id } };
      }
      // Human approval is a fact, but never a substitute for native validation.
      await action.update("executing", { decision: "approved" });
    }
    const result = await withGitCheckoutGate([options.cwd], async () => {
      await options.beforeApply();
      await assertStandingGrant();
      options.signal?.throwIfAborted();
      await revalidateGitCommitAdmission(selection);
      reservation = await beginSupervisedGitOperationIntent(selection, action.record.id, "commit", options.agentDir);
      const result = await confirmGitCommit(candidate.preview, options.message, async (intended) => {
        await action.update("executing", { intended });
        await options.beforeApply();
        await assertStandingGrant();
        options.signal?.throwIfAborted();
        await revalidateGitCommitAdmission(selection);
        reservation!.assertOwned();
        applying = true;
      });
      await finishGitAction(action, result, result.status === "partial-success");
      if (result.status === "committed") {
        try { reservation.resolve(); } catch { throw new GitOperationRecoveryError(action.record.id); }
      }
      return result;
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: action.record.id,
      ...(options.skipApproval ? { approval: "saved-project-allow" } : {}),
      ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) } };
  } catch (cause) {
    await failGitAction(action, applying, options.signal, cause);
    // Only a journalled pre-CAS refusal is safe to resolve. Other failures
    // (including a failed journal write) remain durable recovery blockers.
    if (reservation && action.record.state === "blocked" && (!applying || cause instanceof GitCommitOperationError)) {
      try { reservation.resolve(); } catch { throw new GitOperationRecoveryError(action.record.id); }
    }
    if (!applying && options.signal?.aborted && !(cause instanceof GitOperationRecoveryError)) return {
      content: [{ type: "text" as const, text: "Commit cancelled; no commit was made." }],
      details: { approved: false, actionId: action.record.id },
    };
    if (cause instanceof GitOperationRecoveryError) throw cause;
    if (applying && !(cause instanceof GitCommitOperationError) && !(cause instanceof GitActionRecordingError)) throw new GitActionApplyError(action.record.id, action.record.intended);
    throw cause;
  } finally { action.release(); }
}
