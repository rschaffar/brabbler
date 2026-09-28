import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { GitWorkflowPolicy } from "./git-workflow-policy";
import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";
import { hasManagedGitMutationTools } from "./git-workflow-access";

/** Session intent, not a grant to merge, delete a worktree, or contact a remote. */
export function gitWorkflowInstructions(policy: GitWorkflowPolicy | null | undefined): string {
  const toolGuidance = "When the Git tools are available and repository/user instructions permit, configure early choices in the single Workflow panel and prefer git_workflow for status, review, exact commit and local merge approval; use git_commit only with saved agent-commit consent, and git_workspace_start only with a saved worktree policy. These tools can select another registered local-branch worktree in this chat's repository; identify the source explicitly. Do not ask in prose for approvals the tool already collects, but never treat a tool call or preference as permission to skip required human approval or stricter instructions. Other projects, cleanup and remote actions are not supported by these tools.";
  if (!policy) return `[Pi Web Git tool guidance]\n${toolGuidance}`;
  const checkout = policy.mode === "worktree"
    ? `Use a dedicated linked worktree starting from the local branch ${JSON.stringify(policy.baseBranch)}. After creating it, ${policy.onCreate === "continue" ? "continue this chat in it" : policy.onCreate === "fork" ? "fork this chat into it" : "keep this chat in its current checkout"}.`
    : `Work in the current checkout${policy.branch ? ` only if it is on branch ${JSON.stringify(policy.branch)}` : ""}.`;
  const commits = policy.commits === "agent"
    ? "You may make reviewable feature commits for the user's requested work; inspect selected changes and verify the actual commit."
    : "Do not commit on the user's behalf; leave reviewed changes for a manual commit.";
  const destination = policy.integration
    ? `The intended LOCAL integration target is ${JSON.stringify(policy.integration.targetBranch)}, using ${policy.integration.method}. Prepare verification and an exact-state proposal, but request approval for the specific integration before executing it.`
    : "No integration target has been selected; ask before preparing an integration.";
  return `[Pi Web session Git workflow preferences]\n${checkout}\n${commits}\n${destination}\n${toolGuidance}\nPreferences are not approval for an unseen integration, cleanup, or remote operation. Follow any stricter repository instructions. Never assume files edited in an earlier checkout moved into a new worktree.`;
}

export function managedGitWorkflowInstructions(state: GitWorkflowSettingsResponse): string {
  if (state.paused || !state.resolved.session.values.enabled) return "[Pi Web managed Git disabled]\nManaged Git actions are paused or disabled. Do not invoke mutation tools or bypass the restriction with shell commands. Workflow settings and read-only Git Explorer remain available. This gate is not a shell sandbox.";
  if (state.task.kind !== "managed") return gitWorkflowInstructions(state.task.kind === "legacy" ? state.task.policy : undefined);
  const task = state.task.settings;
  return `[Pi Web managed Git task]\nCaptured task settings: ${JSON.stringify(task)}\nUse git_workflow status to inspect the task. Configure Global/Project/Session defaults together in the Workflow panel; legacy preferences do not override this task. Defaults do not retarget a captured task: compare and explicitly apply them in Workflow.\n${task.commits === "ask" ? "Use git_commit operation commit with selected paths and an exact message; the tool collects candidate approval. Do not ask the same approval in prose." : "Agent commits are disabled/manual; do not commit or bypass through shell commands."}\nWorktree creation and check execution require their own approval. Local integration requires an exact-state human approval, even when its target/checks are configured. Automatic integration and cleanup are not supported. Follow stricter repository/user instructions; no remote operation is authorized.`;
}

/** Re-evaluate the session snapshot and live gates before every new agent run. */
export function createGitWorkflowExtension(getPolicy: () => GitWorkflowPolicy | null | undefined,
  getState?: () => Promise<GitWorkflowSettingsResponse>): InlineExtension {
  return {
    name: "pi-web-git-workflow",
    hidden: true,
    factory: (pi) => {
      const message = (content: string) => ({ message: {
        customType: "pi-web:git-workflow-context", content, display: false,
      } });
      pi.on("before_agent_start", () => {
        const activeTools = pi.getActiveTools?.();
        if (activeTools && !hasManagedGitMutationTools(activeTools)) return message("[Pi Web read-only Git]\nThis session has no coding mutation tools. Managed Git mutations are unavailable; do not bypass the read-only selection through another tool.");
        if (!getState) return message(gitWorkflowInstructions(getPolicy()));
        return getState().then((state) => message(managedGitWorkflowInstructions(state)))
          .catch(() => message("[Pi Web managed Git unavailable]\nWorkflow settings are invalid or unsupported. Do not execute managed Git actions or bypass this blocker through shell commands."));
      });
    },
  };
}
