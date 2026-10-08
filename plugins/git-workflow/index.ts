import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createPluginExtension } from "../../lib/plugins/runtime";
import type { BundledPlugin, PluginUiContext } from "../../lib/plugins/types";
import { gitWorkflowManifest } from "./manifest";
import { executeGitOperation } from "./server";
import { readGitPatchContext } from "./context";
import { gitPolicy, gitPolicyGuidance } from "./policy";

const checkout = Type.String({ description: "Absolute registered checkout root in any local repository; the selected repository's settings apply, independently of the session cwd" });
export const gitWorkflowPlugin: BundledPlugin = {
  manifest: gitWorkflowManifest,
  readPatchContext: readGitPatchContext,
  extension(cwd) {
    const commit = defineTool({
      name: "git_commit", label: "Git commit", executionMode: "sequential",
      description: "Commit selected whole files (including their unstaged content) or the complete staged set with an exact message. Current settings deny, ask or allow. Required checks run here; never change your own permissions. Stronger user/repository instructions apply.",
      parameters: Type.Object({ checkout, mode: Type.Union([Type.Literal("files"), Type.Literal("staged")]),
        files: Type.Optional(Type.Array(Type.String())), message: Type.String() }),
      execute: (id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "commit", ...params }, ctx.ui as unknown as PluginUiContext, signal, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, id),
    });
    const rebase = defineTool({
      name: "git_rebase", label: "Git rebase", executionMode: "sequential",
      description: "Rebase the explicitly selected feature checkout onto the configured local target branch. No automatic retry or conflict cleanup. Current permission applies; stronger user/repository instructions apply.",
      parameters: Type.Object({ checkout, featureBranch: Type.String(), targetBranch: Type.Optional(Type.String({ description: "Local target chosen via ask_user when target selection is Ask; does not change settings" })) }),
      execute: (id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "rebase", ...params }, ctx.ui as unknown as PluginUiContext, signal, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, id),
    });
    const merge = defineTool({
      name: "git_merge", label: "Git merge", executionMode: "sequential",
      description: "Merge an explicitly selected feature into the configured local target's clean checkout using the configured FF-only or ordinary non-FF method. Runs required checks in the feature checkout. No rebase, fallback or cleanup. Stronger user/repository instructions apply.",
      parameters: Type.Object({ checkout, featureBranch: Type.String(), targetBranch: Type.Optional(Type.String({ description: "Local target chosen via ask_user when target selection is Ask" })),
        mergeMethod: Type.Optional(Type.Union([Type.Literal("ff-only"), Type.Literal("non-ff")], { description: "Method chosen via ask_user when method selection is Ask; does not change settings" })) }),
      execute: (id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "merge", ...params }, ctx.ui as unknown as PluginUiContext, signal, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, id),
    });
    const worktree = defineTool({
      name: "git_worktree", label: "Git worktree", executionMode: "sequential",
      description: "Explicitly create, attach or remove a worktree in the selected checkout's repository, independently of the session cwd. Create/attach require a local base branch; attach uses that same existing branch. Destination is directly under <main-checkout>-worktrees. Removal refuses dirty/ignored content, keeps the branch and never removes main/caller checkout. Current per-action settings and stronger instructions apply.",
      parameters: Type.Union([
        Type.Object({ action: Type.Union([Type.Literal("createWorktree"), Type.Literal("attachWorktree")]), checkout, branch: Type.String(), baseBranch: Type.String(), path: Type.String() }),
        Type.Object({ action: Type.Literal("removeWorktree"), checkout, path: Type.String() }),
      ]),
      execute: (id, params, signal, _update, ctx) => executeGitOperation(cwd, params, ctx.ui as unknown as PluginUiContext, signal, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, id),
    });
    const cleanup = defineTool({
      name: "git_cleanup", label: "Git feature cleanup", executionMode: "sequential",
      description: "Clean up explicitly selected, verified integrated local feature resources together. Separate cleanupFeature permission defaults Ask. Requires full feature/integration IDs and named resources. Generated directories need a user-configured permitted-root entry, not merely ignored status. Never removes main/caller/active/locked worktrees, unknown files or source changes. No remote operations, retries or rollback; partial effects are reported. Workflow choices set to Ask require ask_user before invoking; never edit your own permissions.",
      parameters: Type.Object({ checkout, featureBranch: Type.String(), featureTip: Type.String(), integrationCommit: Type.String(),
        targetBranch: Type.Optional(Type.String()), worktreePath: Type.Optional(Type.String()), removeWorktree: Type.Boolean(), deleteBranch: Type.Boolean(),
        artifactRoots: Type.Array(Type.String(), { description: "Exact top-level generated directories selected from the user-owned permitted directory setting; empty means none" }) }),
      execute: (id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "cleanupFeature", ...params }, ctx.ui as unknown as PluginUiContext, signal, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, id),
    });
    const policy = defineTool({
      name: "git_policy", label: "Git policy", executionMode: "sequential",
      description: "Read current user-configured Git choices, permissions and their origins for an explicit repository. Session overrides apply only in this session's own project. Workflow Ask requires ask_user; this read never grants permission or changes settings.",
      parameters: Type.Object({ checkout }),
      execute: async (_id, params, _signal, _update, ctx) => {
        const result = gitPolicy(params.checkout, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd });
        if (!result.project) throw new Error("Select an existing Git repository");
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
      },
    });
    return createPluginExtension(gitWorkflowManifest, cwd, [commit, rebase, merge, worktree, cleanup, policy],
      (ctx) => gitPolicyGuidance({ id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }));
  },
};
