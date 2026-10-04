import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { prepareGitCommit, GitCommitOperationError, type GitCommitPreview } from "./git-commit";
import { captureGitCommitAuthority } from "./git-commit-invocation";
import type { GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath } from "./paths";
import { selectGitWorkspace } from "./git-workspace-selector";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, ManagedGitAccessError } from "./git-workflow-access";
import { isWorkflowCommitCancellation, GIT_COMMIT_DIAGNOSTICS_WARNING, requestWorkflowCommit, workflowCommitDiagnosticReport, workflowCommitVerificationEvidence, workflowCommitFailureResult } from "./git-workflow-commit";
import { agentGitCommitAuthorization } from "./git-agent-commit-authorization";
import { selectGitProjectResources, GitProjectResourceError } from "./git-project-resources";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { beginGitAction, finishGitAction, gitActionSink, snapshotGitActionCandidate } from "./git-action-controller";
import { applyExactCommitOperation, GitExactCommitCompletionError } from "./git-exact-commit-operation";
import { getGitCommitTreeOid, getGitTreeDiff } from "./git-review";
import type { AgentGitWorkflowUiContext } from "./agent-git-workflow-extension";
import type { SessionEntry } from "./types";
import type { createGitSelectedOperationRuntime } from "./git-selected-operation-runtime";
import { GitCommitVerificationError, captureGitCommitVerification, bindGitCommitVerification } from "./git-commit-verification";

/** Shared Ask commits plus isolated legacy saved-consent preview/confirm. */
export function createGitCommitExtension(
  sessionCwd: string,
  getSavedPolicy: () => GitWorkflowPolicy | null | undefined,
  trustedRuntime?: { readSelectionRevisionSync(): string },
): InlineExtension {
  return {
    name: "pi-web-git-commit",
    hidden: true,
    factory: (pi) => {
      const legacyPreviews = new Map<string, { authority: ReturnType<typeof captureGitCommitAuthority>; expiresAt: number }>();
      pi.registerTool({
        name: "git_commit",
        label: "Git Commit",
        description: "Request a commit of explicit paths and an exact message with operation commit. Default whole-file mode stages selected working-tree files; mode:staged commits only the named changed index entries and preserves other staged/unstaged content. Default/confirmation:ask requests exact-candidate approval once. Request confirmation:none only when compatible with all applicable repository/user instructions: it requires fresh untouched persisted ordinary creation provenance, an enabled managed Ask caller task, live selected commitConfirmation:none and fresh saved Allow. Saved Allow alone never skips Ask. No UI is needed for a qualified none request. Select a registered local worktree with workspaceBranch. Legacy preview/confirm requires saved agent-commit consent. No remote or integration operations; follow stricter repository instructions.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"commit" | "preview" | "confirm">({ type: "string", enum: ["commit", "preview", "confirm"] }),
          repositoryPath: Type.Optional(Type.String({ maxLength: 4096, description: "Canonical physical repository root; operation commit only, never chat relocation" })),
          checkoutPath: Type.Optional(Type.String({ maxLength: 4096, description: "Explicit registered physical checkout in repositoryPath; operation commit only" })),
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch identifying a registered worktree in this chat's repository; omit for this chat's checkout" })),
          paths: Type.Optional(Type.Array(Type.String())),
          confirmation: Type.Optional(Type.Unsafe<"ask" | "none">({ type: "string", enum: ["ask", "none"], description: "operation:commit only; default ask. Request none only when compatible with stricter instructions and eligible fresh provenance, live policy and saved Allow." })),
          mode: Type.Optional(Type.Unsafe<"whole-file" | "staged">({ type: "string", enum: ["whole-file", "staged"], description: "Explicit staged index entries, or whole files (default); only for commit/preview" })),
          preview: Type.Optional(Type.Object({
            repositoryRoot: Type.String(), branch: Type.String(), head: Type.String(),
            paths: Type.Array(Type.String()), mode: Type.Unsafe<"whole-file" | "staged">({ type: "string", enum: ["whole-file", "staged"] }), tree: Type.String(), reviewToken: Type.String(),
          })),
          message: Type.Optional(Type.String()),
          receiptIds: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 64, uniqueItems: true,
            description: "Actual returned commit-stage working-workspace receipt IDs; never check commands or a checks waiver" })),
        }),
        async execute(_id, params, _signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          const props = Object.getOwnPropertyDescriptors(params), operation = props.operation?.value;
          const fields = { commit: ["paths", "confirmation", "mode", "message", "receiptIds", "repositoryPath", "checkoutPath"], preview: ["paths", "mode"], confirm: ["preview", "message", "receiptIds"] };
          const allowed = ["operation", "workspaceBranch", ...(fields[operation as keyof typeof fields] ?? [])];
          if (![Object.prototype, null].includes(Object.getPrototypeOf(params)) || typeof operation !== "string" || !Object.hasOwn(fields, operation) ||
            Reflect.ownKeys(params).some((key) => typeof key !== "string" || !allowed.includes(key) || !props[key].enumerable || !("value" in props[key])) ||
            params.receiptIds !== undefined && (!Array.isArray(params.receiptIds) || params.receiptIds.length > 64 || new Set(params.receiptIds).size !== params.receiptIds.length ||
              params.receiptIds.some((id) => typeof id !== "string" || !id || id.length > 256))) return failure("Unsupported commit arguments");
          let commitRuntime: ReturnType<typeof createGitSelectedOperationRuntime> | undefined;
          if (!samePath(ctx.cwd, sessionCwd)) return failure("Session checkout changed; commit refused");
          if (params.confirmation !== undefined && (params.operation !== "commit" || !["ask", "none"].includes(params.confirmation))) return failure("confirmation is supported only for operation commit (ask or none)");
          try {
            if (params.checkoutPath !== undefined && params.repositoryPath === undefined) return failure("checkoutPath requires canonical repositoryPath");
            const file = ctx.sessionManager.getSessionFile();
            if (!file) return failure("Persisted commit owner required");
            const authority = captureGitCommitAuthority({
              scope: { sessionId: ctx.sessionManager.getSessionId(), sessionFile: file, cwd: sessionCwd },
              manager: ctx.sessionManager,
              effectiveTools: () => pi.getActiveTools?.(), readSelectionRevisionSync: trustedRuntime?.readSelectionRevisionSync,
              assertCurrentSync: () => { _signal?.throwIfAborted(); if (!samePath(ctx.cwd, sessionCwd)) throw new ManagedGitAccessError("Session checkout changed"); },
            });
            // Explicit selected commit precedes legacy task/workspace selection.
            // It uses precisely the same captured-caller/source-B authority as
            // git_workflow; neither recipe inheritance nor task adoption occurs.
            if (params.repositoryPath !== undefined) {
              if (params.checkoutPath === undefined || !params.paths?.length || !params.message?.trim() || params.preview ||
                params.mode !== undefined && !["whole-file", "staged"].includes(params.mode)) return failure("Select a canonical repository, explicit checkout, changed paths and exact message");
              const source = await selectGitProjectResources(params.repositoryPath, params.workspaceBranch, params.checkoutPath);
              const none = params.confirmation === "none", ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
              if (!none && (!ctx.hasUI || !ui?.gitAction)) return failure("Commit approval requires an interactive Pi Web session");
              const authorize = agentGitCommitAuthorization({ sessionCwd, manager: ctx.sessionManager, selected: source,
                explicitProject: true, confirmation: none ? "none" : "ask", effectiveTools: () => pi.getActiveTools?.(), agentDir: getAgentDir() });
              const { createGitSelectedOperationRuntime } = await import("./git-selected-operation-runtime");
              commitRuntime = createGitSelectedOperationRuntime({ sessionCwd, manager: ctx.sessionManager,
                effectiveTools: () => pi.getActiveTools?.(), readSelectionRevisionSync: trustedRuntime?.readSelectionRevisionSync,
                appendEntry: (type, data) => pi.appendEntry(type, data),
                ask: (candidate) => ui.gitAction!(candidate, _signal),
                isCancelled: () => !!_signal?.aborted || !samePath(ctx.cwd, sessionCwd) });
              const beforeApply = async () => {
                await authorize(); _signal?.throwIfAborted();
                if (!samePath(ctx.cwd, sessionCwd)) throw new ManagedGitAccessError("Session checkout changed; commit refused");
                authority.assertCurrentSync();
                return authority.assertCurrentSync;
              };
              await beforeApply();
              return await requestWorkflowCommit({ cwd: source.cwd, paths: params.paths, mode: params.mode, message: params.message,
                selected: source, agentDir: getAgentDir(), signal: _signal, authority,
                verificationContext: commitRuntime.commitVerificationContext(source, params.receiptIds ?? []),
                ...(none ? { authorizeWithoutConfirmation: authorize } : {}), beforeApply,
                sink: gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                ask: (candidate, signal) => ui.gitAction!(candidate, signal) });
            }
            const guard = () => assertManagedGitAction(sessionCwd, (ctx.sessionManager?.getEntries?.() ?? []) as SessionEntry[], "commit", "agent", undefined, pi.getActiveTools?.());
            const state = await guard();
            const workspace = await selectGitWorkspace(sessionCwd, params.workspaceBranch);
            const liveGuard = async () => {
              const current = await guard();
              await assertManagedGitProjectDenial(workspace, {
                sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile()!, sessionCwd,
              }, "commit");
              return current;
            };
            await liveGuard(); // Includes legacy preview/confirm invocation, not just the final write.
            const source = await selectGitProjectResources(workspace);
            if (params.operation !== "preview") {
              const { createGitSelectedOperationRuntime } = await import("./git-selected-operation-runtime");
              commitRuntime = createGitSelectedOperationRuntime({ sessionCwd, manager: ctx.sessionManager,
                effectiveTools: () => pi.getActiveTools?.(), readSelectionRevisionSync: trustedRuntime?.readSelectionRevisionSync,
                appendEntry: (type, data) => pi.appendEntry(type, data),
                ask: (candidate) => (ctx.ui as typeof ctx.ui & AgentGitWorkflowUiContext).gitAction(candidate, _signal),
                isCancelled: () => !!_signal?.aborted || !samePath(ctx.cwd, sessionCwd) });
            }
            const verificationContext = commitRuntime?.commitVerificationContext(source, params.receiptIds ?? []);
            if (params.operation === "commit") {
              if (!params.paths?.length || !params.message?.trim() || params.preview) return failure("Select paths and an exact commit message");
              if (params.mode !== undefined && params.mode !== "whole-file" && params.mode !== "staged") return failure("Unsupported commit mode");
              const ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
              const none = params.confirmation === "none";
              const selected = none ? await selectGitProjectResources(workspace) : undefined;
              const authorizeWithoutConfirmation = selected ? agentGitCommitAuthorization({ sessionCwd,
                manager: ctx.sessionManager, selected, confirmation: "none", effectiveTools: () => pi.getActiveTools?.() }) : undefined;
              await authorizeWithoutConfirmation?.();
              if (!none && (!ctx.hasUI || !ui?.gitAction)) return failure("Commit approval requires an interactive Pi Web session");
              return await requestWorkflowCommit({ cwd: workspace, paths: params.paths, mode: params.mode, message: params.message, signal: _signal, verificationContext, authority,
                ...(selected ? { selected, agentDir: getAgentDir(), authorizeWithoutConfirmation } : {}),
                sink: gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                ask: (candidate, signal) => ui.gitAction!(candidate, signal), beforeApply: async () => {
                  await assertManagedGitWorkspace(await liveGuard(), workspace);
                  if (_signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
                  authority.assertCurrentSync();
                  return authority.assertCurrentSync;
                } });
            }
            if (state.task.kind === "managed" || getSavedPolicy()?.commits !== "agent") return failure("Use operation commit to request approval; legacy preview/confirm requires saved agent-commit consent");
            if (params.operation === "preview") {
              if (!Array.isArray(params.paths) || !params.paths.length || params.mode !== undefined && !["whole-file", "staged"].includes(params.mode)) return failure("Select paths and a supported mode to preview");
              const paths = params.paths;
              await authority.selectSource(source);
              await liveGuard();
              const preview = await prepareGitCommit(workspace, paths, params.mode);
              authority.assertCurrentSync();
              for (const [token, saved] of legacyPreviews) if (saved.expiresAt <= Date.now()) legacyPreviews.delete(token);
              if (legacyPreviews.size >= 128) return failure("Too many pending commit previews");
              legacyPreviews.set(preview.reviewToken, { authority, expiresAt: Date.now() + 15 * 60_000 });
              return { content: [{ type: "text" as const, text: JSON.stringify(preview) }], details: { preview } };
            }
            if (params.operation !== "confirm" || params.mode !== undefined || !params.preview || typeof params.message !== "string" ||
              !samePath(params.preview.repositoryRoot, workspace)) return failure("Invalid or mismatched preview");
            const preview = params.preview as GitCommitPreview;
            const message = params.message;
            return await (async () => {
              await liveGuard();
              if (_signal?.aborted) return failure("Commit cancelled; no commit was made");
              const diff = await getGitTreeDiff(workspace, await getGitCommitTreeOid(workspace, preview.head), preview.tree);
              const selection = source;
              const verification = await captureGitCommitVerification(workspace, verificationContext);
              bindGitCommitVerification(verification.handle, preview, message);
              const original = legacyPreviews.get(preview.reviewToken);
              legacyPreviews.delete(preview.reviewToken);
              if (!original || original.expiresAt <= Date.now()) return failure("Original commit preview unavailable; prepare a new preview");
              original.authority.assertCurrentSync();
              const assertConsentSync = () => {
                original.authority.assertCurrentSync(); authority.assertCurrentSync();
                if (getSavedPolicy()?.commits !== "agent") throw new ManagedGitAccessError("Legacy commit consent changed");
              };
              const workingWorkspaceVerification = workflowCommitVerificationEvidence(verificationContext, verification.summary);
              const action = await beginGitAction(gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                "legacy-agent", { ...snapshotGitActionCandidate({ kind: "commit", preview, message, diff }, selection), workingWorkspaceVerification });
              const applyingAction = { get record() { return action.record; }, release: action.release,
                update(state: Parameters<typeof action.update>[0], extra: Parameters<typeof action.update>[1] = {}) {
                  return action.update(state, { ...extra, ...(extra.intended ? { intended: { ...extra.intended, workingWorkspaceVerification } } : {}) });
                } };
              try {
                // Saved legacy consent is not a human decision. The original
                // preview authority and required receipts still fence native CAS.
                const invocation = original.authority.bind(selection, preview, message, assertConsentSync);
                let diagnosticsUnavailable = false;
                const result = await applyExactCommitOperation({ handle: applyingAction, preview, message, selection, invocation, signal: _signal, verificationContext, verificationHandle: verification.handle,
                  onRecordingUnavailable: () => { diagnosticsUnavailable = true; },
                  beforeApply: async () => {
                    await liveGuard();
                    if (_signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) {
                      throw new ManagedGitAccessError("Commit cancelled or workspace changed");
                    }
                    assertConsentSync();
                    return assertConsentSync;
                  },
                  finish: async (result) => result,
                  record: (result) => finishGitAction(action, { ...result,
                    workingWorkspaceVerification }, result.status === "partial-success"),
                });
                const report = workflowCommitDiagnosticReport(applyingAction, diagnosticsUnavailable);
                const diagnostics = { ...report, ...(report.diagnosticsUnavailable ? { recoveryWarning: GIT_COMMIT_DIAGNOSTICS_WARNING } : {}) };
                return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, ...diagnostics }) }], details: { ...result, ...diagnostics, actionId: action.record.id,
                  ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) } };
              } finally { action.release(); }
            })();
          } catch (cause) {
            if (cause instanceof GitExactCommitCompletionError) return {
              content: [{ type: "text" as const, text: GIT_COMMIT_DIAGNOSTICS_WARNING }],
              details: { ...cause.completion, diagnosticsUnavailable: true, recoveryWarning: GIT_COMMIT_DIAGNOSTICS_WARNING },
            };
            const recorded = workflowCommitFailureResult(cause);
            if (recorded) return recorded;
            const { readGitSelectedRuntimeRefusal } = await import("./git-selected-operation-runtime");
            const refusal = readGitSelectedRuntimeRefusal(cause);
            if (refusal) return { ...failure(`Commit refused: ${refusal}.`), details: { error: `Commit refused: ${refusal}.`, code: refusal } };
            // Only the exact signal reason or its definite pre-CAS native
            // wrapper proves cancellation; unrelated errors after Stop remain errors.
            if (params.operation === "confirm" && isWorkflowCommitCancellation(cause, _signal)) return failure("Commit cancelled; no commit was made");
            if (cause instanceof GitProjectResourceError) return { ...failure(cause.message), details: { error: cause.message, code: cause.code } };
            if (cause instanceof GitCommitVerificationError) return failure(cause.message);
            if (cause instanceof ManagedGitAccessError || cause instanceof GitCommitOperationError) return failure(cause.message);
            // Never return raw Git stderr, which can contain credentials in config or URLs.
            return failure("Commit unavailable or preview stale; refresh the preview");
          } finally { commitRuntime?.dispose(); }
        },
      });
    },
  };
}
