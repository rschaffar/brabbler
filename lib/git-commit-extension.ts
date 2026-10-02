import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { prepareGitCommit, GitCommitOperationError, type GitCommitPreview } from "./git-commit";
import { GitCheckoutBusyError, withGitCheckoutGate } from "./git-checkout-gate";
import type { GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath } from "./paths";
import { selectGitWorkspace } from "./git-workspace-selector";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, ManagedGitAccessError } from "./git-workflow-access";
import { requestWorkflowCommit } from "./git-workflow-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionFailureResult, gitActionSink, snapshotGitActionCandidate } from "./git-action-controller";
import { applyExactCommitOperation } from "./git-exact-commit-operation";
import { getGitCommitTreeOid, getGitTreeDiff } from "./git-review";
import { selectGitCommitAdmission, GitOperationRecoveryError } from "./git-operation-admission";
import type { AgentGitWorkflowUiContext } from "./agent-git-workflow-extension";
import type { SessionEntry } from "./types";

/** Shared Ask commits plus isolated legacy saved-consent preview/confirm. */
export function createGitCommitExtension(
  sessionCwd: string,
  getSavedPolicy: () => GitWorkflowPolicy | null | undefined,
): InlineExtension {
  return {
    name: "pi-web-git-commit",
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "git_commit",
        label: "Git Commit",
        description: "Request a commit of explicit paths and an exact message with operation commit. Default whole-file mode stages selected working-tree files; mode:staged commits only the named changed index entries and preserves other staged/unstaged content. Workflow settings decide whether the agent may request exact-candidate approval or must refuse; no prose approval is needed. Select a registered local worktree with workspaceBranch. Legacy preview/confirm requires saved agent-commit consent. No remote or integration operations; follow stricter repository instructions.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"commit" | "preview" | "confirm">({ type: "string", enum: ["commit", "preview", "confirm"] }),
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch identifying a registered worktree in this chat's repository; omit for this chat's checkout" })),
          paths: Type.Optional(Type.Array(Type.String())),
          mode: Type.Optional(Type.Unsafe<"whole-file" | "staged">({ type: "string", enum: ["whole-file", "staged"], description: "Explicit staged index entries, or whole files (default); only for commit/preview" })),
          preview: Type.Optional(Type.Object({
            repositoryRoot: Type.String(), branch: Type.String(), head: Type.String(),
            paths: Type.Array(Type.String()), mode: Type.Unsafe<"whole-file" | "staged">({ type: "string", enum: ["whole-file", "staged"] }), tree: Type.String(), reviewToken: Type.String(),
          })),
          message: Type.Optional(Type.String()),
        }),
        async execute(_id, params, _signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          if (!samePath(ctx.cwd, sessionCwd)) return failure("Session checkout changed; commit refused");
          try {
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
            if (params.operation === "commit") {
              if (!params.paths?.length || !params.message?.trim() || params.preview) return failure("Select paths and an exact commit message");
              if (params.mode !== undefined && params.mode !== "whole-file" && params.mode !== "staged") return failure("Unsupported commit mode");
              const ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
              if (!ctx.hasUI || !ui.gitAction) return failure("Commit approval requires an interactive Pi Web session");
              return await requestWorkflowCommit({ cwd: workspace, paths: params.paths, mode: params.mode, message: params.message, signal: _signal,
                sink: gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                ask: (candidate, signal) => ui.gitAction!(candidate, signal), beforeApply: async () => {
                  await assertManagedGitWorkspace(await liveGuard(), workspace);
                  if (_signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
                } });
            }
            if (state.task.kind === "managed" || getSavedPolicy()?.commits !== "agent") return failure("Use operation commit to request approval; legacy preview/confirm requires saved agent-commit consent");
            if (params.operation === "preview") {
              if (!Array.isArray(params.paths) || !params.paths.length || params.mode !== undefined && !["whole-file", "staged"].includes(params.mode)) return failure("Select paths and a supported mode to preview");
              const paths = params.paths;
              const preview = await withGitCheckoutGate([workspace], async () => {
                await liveGuard();
                return prepareGitCommit(workspace, paths, params.mode);
              });
              return { content: [{ type: "text" as const, text: JSON.stringify(preview) }], details: { preview } };
            }
            if (params.operation !== "confirm" || params.mode !== undefined || !params.preview || typeof params.message !== "string" ||
              !samePath(params.preview.repositoryRoot, workspace)) return failure("Invalid or mismatched preview");
            const preview = params.preview as GitCommitPreview;
            const message = params.message;
            return await withGitCheckoutGate([workspace], async () => {
              await liveGuard();
              if (_signal?.aborted) return failure("Commit cancelled; no commit was made");
              const diff = await getGitTreeDiff(workspace, await getGitCommitTreeOid(workspace, preview.head), preview.tree);
              const selection = await selectGitCommitAdmission(workspace);
              const action = await beginGitAction(gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                "legacy-agent", snapshotGitActionCandidate({ kind: "commit", preview, message, diff }, selection));
              try {
                // Direct legacy confirm is saved consent, not a human decision.
                // The shared operation settles only after entry; a failed entry
                // gets one failure-settlement attempt, never a second one.
                try { await action.update("executing"); }
                catch (cause) { await failGitAction(action, false, _signal, cause); throw cause; }
                const result = await applyExactCommitOperation({ handle: action, preview, message, selection, signal: _signal,
                  beforeApply: async () => {
                    await liveGuard();
                    if (_signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) {
                      throw new ManagedGitAccessError("Commit cancelled or workspace changed");
                    }
                  },
                  finish: async (result) => { await finishGitAction(action, result, result.status === "partial-success"); return result; },
                  shouldResolve: (result) => result.status === "committed",
                });
                return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: action.record.id,
                  ...(result.status === "partial-success" ? { recoveryRequired: true } : {}) } };
              } finally { action.release(); }
            });
          } catch (cause) {
            const recorded = gitActionFailureResult(cause);
            if (recorded) return recorded;
            if (cause instanceof GitOperationRecoveryError) return { content: [{ type: "text" as const, text: cause.message }], isError: true,
              details: { error: cause.message, actionId: cause.actionId, recoveryRequired: true } };
            // Only the signal's own thrown reason proves cancellation here; an
            // unrelated failure after Stop must retain its ordinary handling.
            if (params.operation === "confirm" && _signal?.aborted && cause === _signal.reason) return failure("Commit cancelled; no commit was made");
            if (cause instanceof ManagedGitAccessError || cause instanceof GitCheckoutBusyError || cause instanceof GitCommitOperationError) return failure(cause.message);
            // Never return raw Git stderr, which can contain credentials in config or URLs.
            return failure("Commit unavailable or preview stale; refresh the preview");
          }
        },
      });
    },
  };
}
