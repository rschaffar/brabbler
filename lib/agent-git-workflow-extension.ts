import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { confirmGitCommit, prepareGitCommit } from "./git-commit";
import { getGitCommitTreeOid, getGitReviewDiff, getGitTreeDiff, reviewGitBranches, type GitReviewSelection } from "./git-review";
import { gitExecEnv } from "./git-exec";
import { samePath, toNativePath } from "./paths";
import type { GitActionCandidate } from "./types";

const exec = promisify(execFile);

/** Pi Web's browser UI transport, deliberately not a generic confirmation dialog. */
export interface AgentGitWorkflowUiContext {
  gitAction(candidate: GitActionCandidate, signal?: AbortSignal): Promise<boolean>;
}

async function featureBranch(cwd: string): Promise<string> {
  const { stdout: root } = await exec("git", ["--no-optional-locks", "-C", cwd, "rev-parse", "--show-toplevel"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 });
  if (!samePath(cwd, toNativePath(root.trim()))) throw new Error("Checkout root required");
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "symbolic-ref", "--quiet", "HEAD"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 });
  if (!stdout.trim().startsWith("refs/heads/")) throw new Error("Local feature branch required");
  return stdout.trim().slice("refs/heads/".length);
}

/** A human-bound first slice of the generic Git workflow: no saved policy is needed for inspection or an approved commit. */
export function createAgentGitWorkflowExtension(sessionCwd: string): InlineExtension {
  return {
    name: "pi-web-agent-git-workflow",
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "git_workflow",
        label: "Git Workflow",
        description: "Show an exact local Git candidate in the chat. `review` compares a proposed merge or contiguous commit range without approving integration; `commit` shows the selected whole-file tree and message, asks for exact human approval, and commits only that candidate. No saved session policy required; no remote operations. Merge execution and cleanup are not available in this tool yet.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"review" | "commit">({ type: "string", enum: ["review", "commit"] }),
          targetBranch: Type.Optional(Type.String({ description: "Existing local target branch for review" })),
          commitOids: Type.Optional(Type.Array(Type.String(), { description: "Optional ordered consecutive commits to compare instead of the whole proposed merge" })),
          paths: Type.Optional(Type.Array(Type.String(), { description: "Complete changed file paths for commit" })),
          message: Type.Optional(Type.String({ description: "Exact commit message for approval" })),
        }),
        async execute(_id, params, signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          if (!samePath(ctx.cwd, sessionCwd)) return failure("Session checkout changed; Git workflow refused");
          const ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
          if (!ctx.hasUI || !ui.gitAction) return failure("Git workflow review requires an interactive Pi Web session");
          if (signal?.aborted) return failure("Git workflow cancelled");
          try {
            if (params.operation === "review") {
              if (!params.targetBranch || params.paths || params.message) return failure("Choose a local target branch to review");
              const review = await reviewGitBranches(ctx.cwd, await featureBranch(ctx.cwd), params.targetBranch);
              const selection: GitReviewSelection = params.commitOids?.length
                ? { kind: "commits", commitOids: params.commitOids }
                : { kind: "merge" };
              const diff = await getGitReviewDiff(ctx.cwd, review, selection);
              const viewed = await ui.gitAction({ kind: "review", review, selection, diff }, signal);
              return { content: [{ type: "text" as const, text: viewed
                ? `User reviewed ${selection.kind === "merge" ? "the whole proposed merge" : "the selected contiguous commits"}. No integration was approved or executed. Target ${review.targetBranch} ${review.targetOid}; feature ${review.featureBranch} ${review.featureOid}.`
                : "Git comparison dismissed. No operation was approved or executed." }],
                details: { viewed, selection, targetOid: review.targetOid, featureOid: review.featureOid } };
            }
            if (params.operation !== "commit" || !params.paths?.length || typeof params.message !== "string" || !params.message.trim() || params.targetBranch || params.commitOids) {
              return failure("Select complete changed paths and provide an exact commit message");
            }
            const preview = await prepareGitCommit(ctx.cwd, params.paths);
            const parentTree = await getGitCommitTreeOid(ctx.cwd, preview.head);
            const diff = await getGitTreeDiff(ctx.cwd, parentTree, preview.tree);
            if (!await ui.gitAction({ kind: "commit", preview, message: params.message, diff }, signal) || signal?.aborted) {
              return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." }], details: { approved: false } };
            }
            const result = await confirmGitCommit(preview, params.message);
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
          } catch {
            // Never send raw Git stderr or file contents back through a failed tool result.
            return failure("Git candidate unavailable or stale; inspect the checkout and request a fresh review");
          }
        },
      });
    },
  };
}
