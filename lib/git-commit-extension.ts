import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { confirmGitCommit, prepareGitCommit, GitCommitOperationError, type GitCommitPreview } from "./git-commit";
import { GitCheckoutBusyError, withGitCheckoutGate } from "./git-checkout-gate";
import { hasBusyRpcSessionForCwd } from "./rpc-manager";
import type { GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath } from "./paths";
import { selectGitWorkspace } from "./git-workspace-selector";
import { assertManagedGitAction, assertManagedGitWorkspace, ManagedGitAccessError } from "./git-workflow-access";
import { requestWorkflowCommit } from "./git-workflow-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionFailureResult, gitActionSink, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError } from "./git-action-controller";
import { getGitCommitTreeOid, getGitTreeDiff } from "./git-review";
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
        description: "Request a commit of explicit paths and an exact message with operation commit. Workflow settings decide whether the agent may request exact-candidate approval or must refuse; no prose approval is needed. Select a registered local worktree with workspaceBranch. Legacy preview/confirm requires saved agent-commit consent. No remote or integration operations; follow stricter repository instructions.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"commit" | "preview" | "confirm">({ type: "string", enum: ["commit", "preview", "confirm"] }),
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch identifying a registered worktree in this chat's repository; omit for this chat's checkout" })),
          paths: Type.Optional(Type.Array(Type.String())),
          preview: Type.Optional(Type.Object({
            repositoryRoot: Type.String(), branch: Type.String(), head: Type.String(),
            paths: Type.Array(Type.String()), tree: Type.String(), reviewToken: Type.String(),
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
            const assertIdle = () => {
              if (hasBusyRpcSessionForCwd(workspace, ctx.sessionManager?.getSessionId())) throw new ManagedGitAccessError("Stop other sessions in the selected checkout before committing.");
            };
            if (params.operation === "commit") {
              if (!params.paths?.length || !params.message?.trim() || params.preview) return failure("Select paths and an exact commit message");
              const ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
              if (!ctx.hasUI || !ui.gitAction) return failure("Commit approval requires an interactive Pi Web session");
              return await requestWorkflowCommit({ cwd: workspace, paths: params.paths, message: params.message, signal: _signal,
                sink: gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                ask: (candidate, signal) => ui.gitAction!(candidate, signal), beforeApply: async () => {
                  await assertManagedGitWorkspace(await guard(), workspace);
                  assertIdle();
                  if (_signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
                } });
            }
            if (state.task.kind === "managed" || getSavedPolicy()?.commits !== "agent") return failure("Use operation commit to request approval; legacy preview/confirm requires saved agent-commit consent");
            if (params.operation === "preview") {
              if (!Array.isArray(params.paths) || !params.paths.length) return failure("Select paths to preview");
              const paths = params.paths;
              const preview = await withGitCheckoutGate([workspace], async () => {
                await guard(); assertIdle();
                return prepareGitCommit(workspace, paths);
              });
              return { content: [{ type: "text" as const, text: JSON.stringify(preview) }], details: { preview } };
            }
            if (params.operation !== "confirm" || !params.preview || typeof params.message !== "string" ||
              !samePath(params.preview.repositoryRoot, workspace)) return failure("Invalid or mismatched preview");
            const preview = params.preview as GitCommitPreview;
            const message = params.message;
            return await withGitCheckoutGate([workspace], async () => {
              await guard(); assertIdle();
              if (_signal?.aborted) return failure("Commit cancelled; no commit was made");
              const diff = await getGitTreeDiff(workspace, await getGitCommitTreeOid(workspace, preview.head), preview.tree);
              const action = await beginGitAction(gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
                "legacy-agent", snapshotGitActionCandidate({ kind: "commit", preview, message, diff }));
              let applying = false;
              try {
                await action.update("executing");
                const result = await confirmGitCommit(preview, message, async (intended) => {
                  await action.update("executing", { intended });
                  await guard(); assertIdle();
                  if (_signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
                  _signal?.throwIfAborted();
                  applying = true;
                });
                await finishGitAction(action, result, result.status === "partial-success");
                return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: action.record.id } };
              } catch (cause) {
                await failGitAction(action, applying, _signal, cause);
                if (applying && !(cause instanceof GitCommitOperationError) && !(cause instanceof GitActionRecordingError)) throw new GitActionApplyError(action.record.id, action.record.intended);
                throw cause;
              } finally { action.release(); }
            });
          } catch (cause) {
            const recorded = gitActionFailureResult(cause);
            if (recorded) return recorded;
            if (cause instanceof ManagedGitAccessError || cause instanceof GitCheckoutBusyError || cause instanceof GitCommitOperationError) return failure(cause.message);
            // Never return raw Git stderr, which can contain credentials in config or URLs.
            return failure("Commit unavailable or preview stale; refresh the preview");
          }
        },
      });
    },
  };
}
