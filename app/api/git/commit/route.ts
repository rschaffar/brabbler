import { statSync } from "node:fs";
import { NextResponse } from "next/server";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, ManagedGitAccessError } from "@/lib/git-workflow-access";
import type { SessionEntry } from "@/lib/types";
import { failGitAction, gitActionFailureResult, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError } from "@/lib/git-action-controller";
import { finishHumanGitAction, humanGitActionSink, HumanGitCandidateError, HumanGitSessionChangedError, keepHumanGitCandidate, readHumanGitSessionManager, takeHumanGitCandidate } from "@/lib/git-action-human";
import { GIT_ACTION_ID_PATTERN, type GitActionCandidateSnapshot } from "@/lib/git-action-types";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { confirmGitCommit, prepareGitCommit, GitCommitOperationError, type GitCommitMode, type GitCommitPreview } from "@/lib/git-commit";
import { acquireGitCheckoutGate, isGitCheckoutGated, GitCheckoutBusyError } from "@/lib/git-checkout-gate";
import { getGitCommitTreeOid, getGitTreeDiff, GitReviewError, GIT_REVIEW_DIFF_MAX_BYTES } from "@/lib/git-review";
import { samePath } from "@/lib/paths";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { beginSupervisedGitCommitIntent, revalidateGitCommitAdmission, selectGitCommitAdmission, GitOperationRecoveryError, type GitOperationReservation } from "@/lib/git-operation-admission";

export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Never accept a caller's cwd as the authority for a browser commit. */
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request", 400);
    const input = body as Record<string, unknown>;
    const id = input.sessionId;
    if (typeof id !== "string" || !id.trim() || id !== id.trim()) return error("Valid sessionId required", 400);
    if (Object.hasOwn(input, "cwd")) return error("cwd is derived from the session", 400);
    const file = await resolveSessionPath(id);
    if (!file) return error("Session not found", 404);
    const header = readSessionHeader(file);
    if (!header || header.id !== id || typeof header.cwd !== "string" || !header.cwd) {
      return error("Session identity mismatch", 409);
    }
    const cwd = header.cwd;
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, roots)) return error("Access denied", 403);
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(cwd); }
    catch { return error("Directory not found", 404); }
    if (!stat.isDirectory()) return error("Not a directory", 400);
    if (!isExistingFilePathAllowed(cwd, roots)) return error("Access denied", 403);
    if (isGitCheckoutGated(cwd)) return error("Checkout is busy with a Git transaction", 409);
    const scope = { sessionId: id, sessionFile: file, cwd };
    const guard = async () => {
      req.signal.throwIfAborted();
      const manager = readHumanGitSessionManager(scope);
      const state = await assertManagedGitAction(cwd, manager.getEntries() as SessionEntry[], "commit", "human");
      await assertManagedGitProjectDenial(cwd, { sessionId: id, sessionFile: file, sessionCwd: cwd }, "commit");
      await assertManagedGitWorkspace(state, cwd);
      const latestRoots = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, latestRoots) || !isExistingFilePathAllowed(cwd, latestRoots)) throw new ManagedGitAccessError("Checkout no longer allowed");
      req.signal.throwIfAborted();
      return manager;
    };
    await guard();
    if (input.operation === "preview") {
      if (!Array.isArray(input.paths) || !input.paths.length || !input.paths.every((p) => typeof p === "string")) {
        return error("Select paths to commit", 400);
      }
      if (typeof input.message !== "string" || !input.message.trim() || input.message.includes("\0")) return error("Preview requires the exact commit message", 400);
      if (input.mode !== undefined && input.mode !== "whole-file" && input.mode !== "staged") return error("Invalid commit mode", 400);
      const mode = (input.mode ?? "whole-file") as GitCommitMode;
      // Also serialize metadata appends with managed checkout/session operations.
      const release = acquireGitCheckoutGate([cwd]);
      try {
        await guard();
        const preview = await prepareGitCommit(cwd, input.paths, mode);
        // Both OIDs come from the server's prepared snapshot, never the request body.
        const headTree = await getGitCommitTreeOid(cwd, preview.head);
        let candidateDiff;
        let candidateDiffUnavailable;
        try {
          candidateDiff = await getGitTreeDiff(cwd, headTree, preview.tree);
        } catch (cause) {
          if (!(cause instanceof GitReviewError) || cause.code !== "DIFF_TOO_LARGE") throw cause;
          candidateDiffUnavailable = `Candidate patch exceeds the ${GIT_REVIEW_DIFF_MAX_BYTES / (1024 * 1024)} MB limit; review the whole-file candidate tree before confirming.`;
        }
        const snapshot: GitActionCandidateSnapshot = candidateDiff
          ? snapshotGitActionCandidate({ kind: "commit", preview, message: input.message, diff: candidateDiff })
          : { kind: "commit", repositoryRoot: cwd, featureBranch: preview.branch, message: input.message,
            commitMode: preview.mode, paths: [...preview.paths], parentOid: preview.head, candidateTreeOid: preview.tree, diffUnavailable: candidateDiffUnavailable };
        await guard();
        const action = await keepHumanGitCandidate(humanGitActionSink(scope), scope, { kind: "commit", preview, message: input.message }, snapshot);
        return NextResponse.json({ ...action, preview, ...(candidateDiff ? { candidateDiff } : { candidateDiffUnavailable }) });
      } finally { release(); }
    }
    if (input.operation === "confirm") {
      const preview = input.preview as GitCommitPreview | undefined;
      if (!preview || typeof preview !== "object" || Array.isArray(preview) ||
        typeof preview.repositoryRoot !== "string" || !samePath(preview.repositoryRoot, cwd) ||
        typeof preview.reviewToken !== "string" || typeof preview.tree !== "string" || !["whole-file", "staged"].includes(preview.mode) ||
        typeof preview.branch !== "string" || typeof preview.head !== "string" ||
        !Array.isArray(preview.paths) || !preview.paths.every((p) => typeof p === "string") ||
        typeof input.message !== "string" || typeof input.actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(input.actionId)) return error("Invalid or mismatched preview; prepare a new preview", 409);
      // Reserve this checkout against Pi Web prompts, session moves, and local
      // integration while the reviewed commit is confirmed. The library still
      // re-derives the whole snapshot and authenticates the token.
      const release = acquireGitCheckoutGate([cwd]);
      try {
        await guard();
        const selection = await selectGitCommitAdmission(cwd);
        const { handle, native } = takeHumanGitCandidate(scope, input.actionId, { kind: "commit", preview, message: input.message });
        let applying = false;
        let reservation: GitOperationReservation | undefined;
        try {
          await handle.update("executing", { decision: "approved" });
          await guard();
          reservation = await beginSupervisedGitCommitIntent(selection, handle.record.id);
          const result = await confirmGitCommit(native.preview, native.message, async (intended) => {
            // Approval alone is not success. Persist the actual object identity before the ref CAS.
            await handle.update("executing", { intended });
            await guard(); // revocation/cancellation after journal I/O, immediately before mutation
            await revalidateGitCommitAdmission(selection);
            applying = true;
          });
          const response = await finishHumanGitAction(handle, result, result, result.status === "partial-success");
          if (result.status === "committed" && !("recoveryRequired" in response && response.recoveryRequired)) {
            try { reservation.resolve(); } catch { throw new GitOperationRecoveryError(handle.record.id); }
          }
          return NextResponse.json({ ...response, ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) });
        } catch (cause) {
          await failGitAction(handle, applying, req.signal, cause);
          if (reservation && handle.record.state === "blocked" && (!applying || cause instanceof GitCommitOperationError)) {
            try { reservation.resolve(); } catch { cause = new GitOperationRecoveryError(handle.record.id); }
          }
          if (cause instanceof GitOperationRecoveryError) return NextResponse.json({ actionId: handle.record.id,
            error: cause.message, recoveryRequired: true }, { status: 409 });
          if (applying && !(cause instanceof GitCommitOperationError) && !(cause instanceof GitActionRecordingError)) cause = new GitActionApplyError(handle.record.id, handle.record.intended);
          if (cause instanceof GitActionRecordingError) return NextResponse.json({ ...gitActionFailureResult(cause)!.details,
            recoveryWarning: cause.message }, { status: 409 });
          return NextResponse.json({ actionId: handle.record.id, error: cause instanceof ManagedGitAccessError || cause instanceof HumanGitSessionChangedError || cause instanceof GitCommitOperationError ? cause.message
            : "Commit unavailable or preview stale; refresh the preview" }, { status: 409 });
        } finally { handle.release(); }
      } finally { release(); }
    }
    return error("Unknown commit operation", 400);
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("Invalid JSON", 400);
    if (cause instanceof GitOperationRecoveryError) return NextResponse.json({ error: cause.message, recoveryRequired: true,
      actionId: cause.actionId }, { status: 409 });
    if (cause instanceof ManagedGitAccessError || cause instanceof HumanGitCandidateError || cause instanceof HumanGitSessionChangedError
      || cause instanceof GitCheckoutBusyError || cause instanceof GitCommitOperationError) return error(cause.message, 409);
    // Git stderr and subprocess errors may contain remote credentials or config values.
    return error("Commit unavailable or preview stale; refresh the preview", 409);
  }
}
