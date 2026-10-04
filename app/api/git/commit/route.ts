import { statSync } from "node:fs";
import { NextResponse } from "next/server";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, ManagedGitAccessError } from "@/lib/git-workflow-access";
import type { SessionEntry } from "@/lib/types";
import { failGitAction, finishGitAction, gitActionAttribution, gitActionFailureResult, GitActionRecordingError, type GitActionHandle } from "@/lib/git-action-controller";
import { humanGitActionSink, HumanGitCandidateError, HumanGitSessionChangedError, keepHumanGitCandidate, readHumanGitSessionManager, takeHumanGitCandidate } from "@/lib/git-action-human";
import { GIT_ACTION_ID_PATTERN } from "@/lib/git-action-types";
import { readLiveGitAction } from "@/lib/git-action-journal";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { GitCommitOperationError, type GitCommitMode, type GitCommitPreview } from "@/lib/git-commit";
import { applyExactCommitOperation, captureExactCommitCandidate, GitExactCommitCompletionError } from "@/lib/git-exact-commit-operation";
import { captureGitCommitAuthority, type GitCommitAuthority } from "@/lib/git-commit-invocation";
import { GIT_COMMIT_DIAGNOSTICS_WARNING, isWorkflowCommitCancellation, workflowCommitDiagnosticReport, workflowCommitVerificationEvidence } from "@/lib/git-workflow-commit";
import { samePath } from "@/lib/paths";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { selectGitProjectResources, type GitProjectResources } from "@/lib/git-project-resources";
import { createHumanGitCommitVerificationContext } from "@/lib/git-check-authority-fence";
import { GitCommitVerificationError, type GitCommitVerificationHandle } from "@/lib/git-commit-verification";

// Only the live process association binds check evidence to the exact preview.
// No receipt objects, policy callbacks or approval facts are taken from JSON.
const bindingKey = Symbol.for("pi-web:human-commit-verification:v1");
type CheckBinding = Readonly<{ scope: Readonly<{ sessionId: string; sessionFile: string; cwd: string }>; receiptIds: readonly string[];
  handle: GitCommitVerificationHandle; authority: GitCommitAuthority; selection: GitProjectResources; expiresAt: number }>;
function bindings(): Map<string, CheckBinding> {
  const g = globalThis as unknown as Record<symbol, Map<string, CheckBinding>>;
  return g[bindingKey] ??= new Map();
}
function validReceiptIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every((id) => typeof id === "string" && GIT_ACTION_ID_PATTERN.test(id)) && new Set(value).size === value.length;
}

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
    if (input.receiptIds !== undefined && !validReceiptIds(input.receiptIds)) return error("Only receipt IDs are accepted as check evidence", 400);
    if (["command", "argv", "env", "proof", "receipts", "agentDir", "skip", "skipChecks", "skipRequiredChecks", "verificationContext"].some((key) => Object.hasOwn(input, key))) return error("Caller check overrides are not accepted", 400);
    const file = await resolveSessionPath(id);
    if (!file) return error("Session not found", 404);
    const header = readSessionHeader(file);
    if (!header || header.id !== id || typeof header.cwd !== "string" || !header.cwd) {
      return error("Session identity mismatch", 409);
    }
    const cwd = header.cwd;
    const scope = { sessionId: id, sessionFile: file, cwd };
    // Capture as soon as the saved owner is known, before even roots lookup
    // can await a relevant change-and-restore. Confirmation keeps the preview's
    // original authority below; it never captures a replacement baseline.
    const authority = input.operation === "preview" ? captureGitCommitAuthority({ scope }) : undefined;
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, roots)) return error("Access denied", 403);
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(cwd); }
    catch { return error("Directory not found", 404); }
    if (!stat.isDirectory()) return error("Not a directory", 400);
    if (!isExistingFilePathAllowed(cwd, roots)) return error("Access denied", 403);
    authority?.assertCurrentSync();
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
      {
        await guard();
        // Both trees and the mode are native server-derived facts, not caller OIDs.
        const selection = await selectGitProjectResources(cwd);
        await authority!.selectSource(selection);
        const receiptIds = [...(input.receiptIds as string[] | undefined ?? [])];
        const context = createHumanGitCommitVerificationContext(scope, receiptIds, selection);
        const { preview, snapshot, candidateDiff, candidateDiffUnavailable, verification } = await captureExactCommitCandidate(cwd, input.paths, input.message, mode, true, context);
        if (verification.summary.receiptIds.length !== receiptIds.length) return error("Only required commit-stage receipt IDs are accepted", 409);
        await guard();
        authority!.assertCurrentSync();
        const action = await keepHumanGitCandidate(humanGitActionSink(scope), scope, { kind: "commit", preview, message: input.message },
          { ...snapshot, ...gitActionAttribution(selection), workingWorkspaceVerification: workflowCommitVerificationEvidence(context, verification.summary) });
        authority!.assertCurrentSync();
        for (const [id, binding] of bindings()) if (binding.expiresAt <= Date.now()) bindings().delete(id);
        bindings().set(action.actionId, Object.freeze({ scope: Object.freeze({ ...scope }), receiptIds: Object.freeze([...receiptIds].sort()),
          handle: verification.handle, authority: authority!, selection, expiresAt: action.expiresAt }));
        // This request just created the exact live pending owner. Read only its
        // diagnostic projection (no disk fallback, never approval authority).
        const pending = readLiveGitAction(scope.sessionId, action.actionId)?.record;
        const diagnostic = pending?.diagnostics ?? (!pending ? { status: "unavailable" as const, reason: "storage-unavailable" as const } : undefined);
        return NextResponse.json({ ...action, preview, verification: verification.summary,
          ...(diagnostic ? { diagnosticsUnavailable: true, diagnostics: diagnostic, diagnosticWarning: "Commit preview captured; diagnostics unavailable." } : {}),
          ...(candidateDiff ? { candidateDiff } : { candidateDiffUnavailable }) });
      }
    }
    if (input.operation === "confirm") {
      const preview = input.preview as GitCommitPreview | undefined;
      if (!preview || typeof preview !== "object" || Array.isArray(preview) ||
        typeof preview.repositoryRoot !== "string" || !samePath(preview.repositoryRoot, cwd) ||
        typeof preview.reviewToken !== "string" || typeof preview.tree !== "string" || !["whole-file", "staged"].includes(preview.mode) ||
        typeof preview.branch !== "string" || typeof preview.head !== "string" ||
        !Array.isArray(preview.paths) || !preview.paths.every((p) => typeof p === "string") ||
        typeof input.message !== "string" || typeof input.actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(input.actionId)) return error("Invalid or mismatched preview; prepare a new preview", 409);
      {
        await guard();
        const binding = bindings().get(input.actionId);
        const receiptIds = input.receiptIds as string[] | undefined ?? [];
        if (binding && binding.expiresAt <= Date.now()) {
          bindings().delete(input.actionId);
          // Retire the original action too; restoring a test/system clock must
          // not revive an awaiting historical approval or its evidence binding.
          takeHumanGitCandidate(scope, input.actionId, { kind: "commit", preview, message: input.message });
          throw new HumanGitCandidateError();
        }
        if (!binding || binding.expiresAt <= Date.now() || binding.scope.sessionId !== id ||
          !samePath(binding.scope.sessionFile, file) || !samePath(binding.scope.cwd, cwd) ||
          JSON.stringify(binding.receiptIds) !== JSON.stringify([...receiptIds].sort())) return error("Check evidence set mismatched or expired; prepare a new preview", 409);
        binding.authority.assertCurrentSync();
        const selection = binding.selection;
        const { handle, native } = takeHumanGitCandidate(scope, input.actionId, { kind: "commit", preview, message: input.message });
        bindings().delete(input.actionId);
        let enteredApply = false;
        let diagnosticsUnavailable = false;
        try {
          // Keep the action awaiting during the native receipt/admission
          // preflight. An executing journal entry would quarantine its own
          // unreserved resource. Persist the actual approval together with the
          // native prepared intent (or a definite preflight refusal), not a
          // premature execution claim. No native admission exemption is added.
          const approvedHandle: GitActionHandle = {
            get record() { return handle.record; }, release: () => handle.release(),
            update: (state, extra = {}) => handle.update(state, { ...extra,
              ...(extra.intended ? { intended: { ...extra.intended, workingWorkspaceVerification: handle.record.summary.workingWorkspaceVerification } } : {}),
              ...(handle.record.decision === undefined ? { decision: "approved" as const } : {}) }),
          };
          // takeHumanGitCandidate authenticated and consumed the original exact
          // live approval; durable diagnostic availability is not permission.
          const assertApprovalSync = () => {
            req.signal.throwIfAborted(); binding.authority.assertCurrentSync();
            if (handle.record.sessionId !== id || handle.record.id !== input.actionId ||
              !["awaiting-decision", "executing"].includes(handle.record.state)) throw new HumanGitCandidateError();
          };
          const invocation = binding.authority.bind(selection, native.preview, native.message, assertApprovalSync);
          enteredApply = true;
          const response = await applyExactCommitOperation({ handle: approvedHandle, preview: native.preview, message: native.message, selection, invocation,
            onRecordingUnavailable: () => { diagnosticsUnavailable = true; },
            signal: req.signal, beforeApply: async () => {
              await guard();
              assertApprovalSync();
              return assertApprovalSync;
            },
            verificationHandle: binding.handle,
            verificationContext: createHumanGitCommitVerificationContext(scope, binding.receiptIds, selection),
            finish: async (result) => ({ ...result, actionId: handle.record.id }),
            record: (result) => finishGitAction(approvedHandle, { ...result,
              workingWorkspaceVerification: handle.record.summary.workingWorkspaceVerification }, result.status === "partial-success"),
          });
          const diagnostics = workflowCommitDiagnosticReport(approvedHandle, diagnosticsUnavailable);
          return NextResponse.json({ ...response, ...diagnostics,
            ...(diagnostics.diagnosticsUnavailable ? { recoveryWarning: GIT_COMMIT_DIAGNOSTICS_WARNING } : {}),
            ...(response.status === "partial-success" ? { recoveryRequired: true } : {}) });
        } catch (cause) {
          if (cause instanceof GitExactCommitCompletionError) return NextResponse.json({ ...cause.completion,
            actionId: handle.record.id, diagnosticsUnavailable: true,
            recoveryWarning: GIT_COMMIT_DIAGNOSTICS_WARNING });
          // An executing-update refusal predates admission; the shared apply
          // function owns failures after entry, including durable intent cleanup.
          if (!enteredApply) await failGitAction(handle, false, req.signal, cause);
          const diagnostics = workflowCommitDiagnosticReport(handle, diagnosticsUnavailable);
          if (cause instanceof GitActionRecordingError) return NextResponse.json({ ...gitActionFailureResult(cause)!.details, ...diagnostics,
            recoveryWarning: cause.message }, { status: 409 });
          if (isWorkflowCommitCancellation(cause, req.signal)) return NextResponse.json({ actionId: handle.record.id, ...diagnostics,
            error: "Commit cancelled; no commit was made" }, { status: 409 });
          return NextResponse.json({ actionId: handle.record.id, ...diagnostics, error: cause instanceof ManagedGitAccessError || cause instanceof HumanGitSessionChangedError || cause instanceof GitCommitOperationError || cause instanceof GitCommitVerificationError ? cause.message
            : "Commit unavailable or preview stale; refresh the preview" }, { status: 409 });
        } finally { handle.release(); }
      }
    }
    return error("Unknown commit operation", 400);
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("Invalid JSON", 400);
    if (cause instanceof ManagedGitAccessError || cause instanceof HumanGitCandidateError || cause instanceof HumanGitSessionChangedError
      || cause instanceof GitCommitOperationError || cause instanceof GitCommitVerificationError) return error(cause.message, 409);
    // Git stderr and subprocess errors may contain remote credentials or config values.
    return error("Commit unavailable or preview stale; refresh the preview", 409);
  }
}
