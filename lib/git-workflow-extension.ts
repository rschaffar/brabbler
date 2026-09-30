import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { GitWorkflowPolicy } from "./git-workflow-policy";
import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";
import { hasManagedGitMutationTools } from "./git-workflow-permissions";
import { filterGitWorkflowContext } from "./git-workflow-context";

export const GIT_WORKFLOW_PROMPT_SECTION = "pi_web_git_workflow";

const CONDITIONAL_GUIDANCE = "Conditional Git guidance, not a request to do work. Answer an ordinary question, rendered example, or explanation directly, without Git setup, status checks, or approval questions. Apply these preferences only when the current user request calls for repository work or Git actions.";
const TOOL_GUIDANCE = "For requested Git actions, prefer available guarded Git tools, subject to stricter repository/user instructions. git_workflow status is optional, only when genuinely useful for the current Git request. Identify the repository/worktree; selecting it does not move this chat or its files. Let tools collect exact approval; do not duplicate it in prose. Preferences and historical approvals are not live grants; operation gates still apply. Never bypass blockers through shell commands. No remote operation or cleanup is authorized.";

function blockedGuidance(reason: string): string {
  return `${CONDITIONAL_GUIDANCE}\n${reason} Do not invoke managed Git mutation tools or bypass the restriction through another tool or shell command. Workflow settings and read-only Git inspection remain available. This guidance is not a shell sandbox.`;
}

/** Session preferences, not a task or fresh execution authority. */
export function gitWorkflowInstructions(policy: GitWorkflowPolicy | null | undefined): string {
  if (!policy) return `${CONDITIONAL_GUIDANCE}\nNo session Git workflow preferences are saved.\n${TOOL_GUIDANCE}`;
  const checkout = policy.mode === "worktree"
    ? `Saved workspace preference: a dedicated linked worktree from local branch ${JSON.stringify(policy.baseBranch)}; after creation, ${policy.onCreate === "continue" ? "continue this chat in it" : policy.onCreate === "fork" ? "fork this chat into it" : "keep this chat in its current checkout"}. This preference does not request creation.`
    : `Saved workspace preference: the current checkout${policy.branch ? ` on branch ${JSON.stringify(policy.branch)}; a branch mismatch blocks the operation` : ""}.`;
  const commits = policy.commits === "agent"
    ? "Saved commit preference: legacy agent-commit consent, still subject to live restrictions and the tool's candidate approval."
    : "Saved commit preference: manual. Do not commit on the user's behalf or bypass this restriction through shell commands.";
  const destination = policy.integration
    ? `Saved LOCAL integration target: ${JSON.stringify(policy.integration.targetBranch)} (${policy.integration.method}); an actual integration requires exact-state human approval.`
    : "No local integration target is saved; this does not require a setup question.";
  return `${CONDITIONAL_GUIDANCE}\n${checkout}\n${commits}\n${destination}\n${TOOL_GUIDANCE}`;
}

function liveCommitRestriction(state: GitWorkflowSettingsResponse): string {
  const live = state.resolved.session.values;
  if (live.commits === "off" || state.projectSessionRestrictions?.commits === "off") {
    return "Live commit restriction: off. Agent commits are blocked; do not bypass through shell commands.";
  }
  if (state.projectSessionRestrictions?.commits === "manual") {
    return "Live commit restriction: manual. Agent commits are blocked; do not bypass through shell commands.";
  }
  return "";
}

export function managedGitWorkflowInstructions(state: GitWorkflowSettingsResponse): string {
  if (state.paused) return blockedGuidance("Managed Git actions are paused.");
  if (!state.resolved.session.values.enabled || state.projectSessionRestrictions?.enabled === false) {
    return blockedGuidance("Managed Git is disabled for this project/chat.");
  }
  if (state.task.kind === "managed" && !state.task.settings.enabled) {
    return blockedGuidance("The captured managed Git task is disabled.");
  }
  if (state.sessionScope === "project") return blockedGuidance("Explicit-project scope is read-only; managed Git mutations are unavailable.");
  const commitRestriction = liveCommitRestriction(state);
  if (state.task.kind !== "managed") {
    return [gitWorkflowInstructions(state.task.kind === "legacy" ? state.task.policy : undefined), commitRestriction].filter(Boolean).join("\n");
  }
  const task = state.task.settings;
  const checkout = task.workspace === "worktree"
    ? `Captured workspace preference: a dedicated linked worktree${task.baseBranch ? ` from local branch ${JSON.stringify(task.baseBranch)}` : "; no base branch is captured"}.`
    : `Captured workspace preference: the current checkout${task.branch ? ` on branch ${JSON.stringify(task.branch)}; a branch mismatch blocks the operation` : ""}.`;
  const creation = task.workspace === "worktree"
    ? `${task.baseBranch
      ? `Creation requires exact confirmation; captured after-create preference: ${task.onCreate}.`
      : "If the current request needs worktree creation, git_workspace_start may supply baseBranch as one explicit creation proposal only for this missing-base managed worktree. Creation requires exact confirmation and is CREATE-ONLY: no chat movement and no settings write."} A supplied base cannot override a captured base; mismatches remain blockers.`
    : "";
  const commits = task.commits === "ask"
    ? "Captured commit preference: Ask (exact candidate confirmation), not a live grant."
    : `Captured commit preference: ${task.commits}. Agent commits are blocked; do not bypass through shell commands.`;
  const destination = `Captured LOCAL integration target: ${task.targetBranch ? JSON.stringify(task.targetBranch) : "none"}; method: ${task.method}; configured checks: ${task.checks.length}. Checks need their own approval; integration needs exact-state human approval. Missing or mismatched requirements block those operations.`;
  return [CONDITIONAL_GUIDANCE, checkout, creation, commits, commitRestriction, destination,
    "Changed defaults do not retarget a captured task; explicit application in Workflow is separate from execution approval. Automatic integration and cleanup are unsupported.", TOOL_GUIDANCE].filter(Boolean).join("\n");
}

/** Re-evaluate the session snapshot and live gates before every new agent run. */
export function createGitWorkflowExtension(getPolicy: () => GitWorkflowPolicy | null | undefined,
  getState?: () => Promise<GitWorkflowSettingsResponse>): InlineExtension {
  return {
    name: "pi-web-git-workflow",
    hidden: true,
    factory: (pi) => {
      // Ordinary requests only: SDK compaction/branch summaries bypass this hook.
      pi.on("context", (event) => ({ messages: filterGitWorkflowContext(event.messages) }));
      pi.on("before_agent_start", async (event) => {
        const options = event.systemPromptOptions;
        // An exact prompt is opaque, including the empty string. Never amend it.
        if (options.forceSystemPrompt !== undefined) return;
        let instructions: string;
        try {
          const activeTools = pi.getActiveTools();
          instructions = !hasManagedGitMutationTools(activeTools)
            ? blockedGuidance("This session has no coding mutation tools. Managed Git mutations are unavailable under the read-only tool selection.")
            : getState ? managedGitWorkflowInstructions(await getState()) : gitWorkflowInstructions(getPolicy());
        } catch {
          // Also catches synchronous policy/state loader and active-tool lookup failures.
          instructions = blockedGuidance("Workflow settings or active tools are unavailable or unsupported. Managed Git actions are blocked.");
        }
        options.sections[GIT_WORKFLOW_PROMPT_SECTION] = instructions;
      });
    },
  };
}
