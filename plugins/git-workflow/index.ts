import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createPluginExtension } from "../../lib/plugins/runtime";
import type { BundledPlugin, PluginUiContext } from "../../lib/plugins/types";
import { gitWorkflowManifest } from "./manifest";
import { executeGitOperation } from "./server";

const checkout = Type.String({ description: "Absolute registered checkout root in any local repository; the selected repository's settings apply, independently of the session cwd" });
export const gitWorkflowPlugin: BundledPlugin = {
  manifest: gitWorkflowManifest,
  extension(cwd) {
    const commit = defineTool({
      name: "git_commit", label: "Git commit", executionMode: "sequential",
      description: "Commit selected whole files (including their unstaged content) or the complete staged set with an exact message. Current settings deny, ask or allow. Required checks run here; never change your own permissions. Stronger user/repository instructions apply.",
      parameters: Type.Object({ checkout, mode: Type.Union([Type.Literal("files"), Type.Literal("staged")]),
        files: Type.Optional(Type.Array(Type.String())), message: Type.String() }),
      execute: (_id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "commit", ...params }, ctx.ui as unknown as PluginUiContext, signal),
    });
    const rebase = defineTool({
      name: "git_rebase", label: "Git rebase", executionMode: "sequential",
      description: "Rebase the explicitly selected feature checkout onto the configured local target branch. No automatic retry or conflict cleanup. Current permission applies; stronger user/repository instructions apply.",
      parameters: Type.Object({ checkout, featureBranch: Type.String() }),
      execute: (_id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "rebase", ...params }, ctx.ui as unknown as PluginUiContext, signal),
    });
    const merge = defineTool({
      name: "git_merge", label: "Git merge", executionMode: "sequential",
      description: "Merge an explicitly selected feature into the configured local target's clean checkout using the configured FF-only or ordinary non-FF method. Runs required checks in the feature checkout. No rebase, fallback or cleanup. Stronger user/repository instructions apply.",
      parameters: Type.Object({ checkout, featureBranch: Type.String() }),
      execute: (_id, params, signal, _update, ctx) => executeGitOperation(cwd, { action: "merge", ...params }, ctx.ui as unknown as PluginUiContext, signal),
    });
    const worktree = defineTool({
      name: "git_worktree", label: "Git worktree", executionMode: "sequential",
      description: "Explicitly create, attach or remove a worktree in the selected checkout's repository, independently of the session cwd. Create/attach require a local base branch; attach uses that same existing branch. Destination is directly under <main-checkout>-worktrees. Removal refuses dirty/ignored content, keeps the branch and never removes main/caller checkout. Current per-action settings and stronger instructions apply.",
      parameters: Type.Union([
        Type.Object({ action: Type.Union([Type.Literal("createWorktree"), Type.Literal("attachWorktree")]), checkout, branch: Type.String(), baseBranch: Type.String(), path: Type.String() }),
        Type.Object({ action: Type.Literal("removeWorktree"), checkout, path: Type.String() }),
      ]),
      execute: (_id, params, signal, _update, ctx) => executeGitOperation(cwd, params, ctx.ui as unknown as PluginUiContext, signal),
    });
    return createPluginExtension(gitWorkflowManifest, cwd, [commit, rebase, merge, worktree]);
  },
};
