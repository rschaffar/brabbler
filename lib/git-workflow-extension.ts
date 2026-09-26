import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { GitWorkflowPolicy } from "./git-workflow-policy";

/** Session intent, not a grant to merge, delete a worktree, or contact a remote. */
export function gitWorkflowInstructions(policy: GitWorkflowPolicy): string {
  const checkout = policy.mode === "worktree"
    ? `Use a dedicated linked worktree starting from the local branch ${JSON.stringify(policy.baseBranch)}. After creating it, ${policy.onCreate === "continue" ? "continue this chat in it" : policy.onCreate === "fork" ? "fork this chat into it" : "keep this chat in its current checkout"}.`
    : `Work in the current checkout${policy.branch ? ` only if it is on branch ${JSON.stringify(policy.branch)}` : ""}.`;
  const commits = policy.commits === "agent"
    ? "You may make reviewable feature commits for the user's requested work; inspect selected changes and verify the actual commit."
    : "Do not commit on the user's behalf; leave reviewed changes for a manual commit.";
  const destination = policy.integration
    ? `The intended LOCAL integration target is ${JSON.stringify(policy.integration.targetBranch)}, using ${policy.integration.method}. Prepare verification and an exact-state proposal, but request approval for the specific integration before executing it.`
    : "No integration target has been selected; ask before preparing an integration.";
  return `[Pi Web session Git workflow preferences]\n${checkout}\n${commits}\n${destination}\nPreferences are not approval for an unseen integration, cleanup, or remote operation. Follow any stricter repository instructions. Never assume files edited in an earlier checkout moved into a new worktree.`;
}

/** Re-evaluate the session's persisted snapshot before every new agent run. */
export function createGitWorkflowExtension(getPolicy: () => GitWorkflowPolicy | null | undefined): InlineExtension {
  return {
    name: "pi-web-git-workflow",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", () => {
        const policy = getPolicy();
        if (!policy) return;
        return { message: {
          customType: "pi-web:git-workflow-context",
          content: gitWorkflowInstructions(policy),
          display: false,
        } };
      });
    },
  };
}
