import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { confirmGitCommit, prepareGitCommit, type GitCommitPreview } from "./git-commit";
import type { GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath } from "./paths";
import { selectGitWorkspace } from "./git-workspace-selector";

/** Only saved per-session consent enables this tool; a project default is not consent. */
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
        description: "Preview selected paths, then confirm the authenticated preview with a commit message. Optionally select another registered local-branch worktree in this chat's repository by workspaceBranch. Saved chat consent is required; follow stricter repository instructions. No remote or integration operations.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"preview" | "confirm">({ type: "string", enum: ["preview", "confirm"] }),
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
          if (getSavedPolicy()?.commits !== "agent") return failure("Agent commits require a saved session policy allowing them");
          if (!samePath(ctx.cwd, sessionCwd)) return failure("Session checkout changed; commit refused");
          try {
            const workspace = await selectGitWorkspace(sessionCwd, params.workspaceBranch);
            if (params.operation === "preview") {
              if (!Array.isArray(params.paths) || !params.paths.length) return failure("Select paths to preview");
              const preview = await prepareGitCommit(workspace, params.paths);
              return { content: [{ type: "text" as const, text: JSON.stringify(preview) }], details: { preview } };
            }
            if (params.operation !== "confirm" || !params.preview || typeof params.message !== "string" ||
              !samePath(params.preview.repositoryRoot, workspace)) return failure("Invalid or mismatched preview");
            const result = await confirmGitCommit(params.preview as GitCommitPreview, params.message);
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
          } catch {
            // Never return raw Git stderr, which can contain credentials in config or URLs.
            return failure("Commit unavailable or preview stale; refresh the preview");
          }
        },
      });
    },
  };
}
