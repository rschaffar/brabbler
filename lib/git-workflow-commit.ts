import type { GitCommitMode } from "./git-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionAttribution, type GitActionSink } from "./git-action-controller";
import { applyExactCommitOperation, captureExactCommitCandidate } from "./git-exact-commit-operation";
import type { GitActionCandidate } from "./types";
import { withGitCheckoutGate } from "./git-checkout-gate";
import { assertGitOperationAdmission, selectGitCommitAdmission, GitOperationRecoveryError } from "./git-operation-admission";
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
    const captured = await captureExactCommitCandidate(options.cwd, options.paths, options.message, options.mode ?? "whole-file");
    const action = await beginGitAction(options.sink, "agent", { ...captured.snapshot, ...gitActionAttribution(selection) });
    return { candidate: captured.candidate!, action, selection }; // Agent Ask requires a complete patch.
  });
  // No checkout reservation while a human reviews (or between capture and
  // apply on the no-prompt path). Admission is rechecked under the apply gate.
  let enteredApply = false;
  let atRefBoundary = false;
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
      enteredApply = true;
      return applyExactCommitOperation({ handle: action, preview: candidate.preview, message: options.message, selection,
        agentDir: options.agentDir, signal: options.signal, revalidateBeforeIntent: true,
        beforeApply: async () => { await options.beforeApply(); await assertStandingGrant(); },
        atRefBoundary: () => { atRefBoundary = true; },
        beforeRefUpdate: (reservation) => reservation.assertOwned(),
        finish: async (result) => { await finishGitAction(action, result, result.status === "partial-success"); return result; },
        shouldResolve: (result) => result.status === "committed",
      });
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: action.record.id,
      ...(options.skipApproval ? { approval: "saved-project-allow" } : {}),
      ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) } };
  } catch (cause) {
    // The shared operation settles post-admission failures; a busy apply gate
    // never entered it and must still preserve the already-recorded decision.
    if (!enteredApply) await failGitAction(action, false, options.signal, cause);
    if (!atRefBoundary && options.signal?.aborted && !(cause instanceof GitOperationRecoveryError)) return {
      content: [{ type: "text" as const, text: "Commit cancelled; no commit was made." }],
      details: { approved: false, actionId: action.record.id },
    };
    if (cause instanceof GitOperationRecoveryError) throw cause;
    throw cause;
  } finally { action.release(); }
}
