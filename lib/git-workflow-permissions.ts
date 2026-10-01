import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";

export const MANAGED_GIT_STAGES = ["workspace", "commit", "checks", "integration", "settings"] as const;
export type ManagedGitStage = typeof MANAGED_GIT_STAGES[number];
export type ManagedGitActor = "agent" | "human";
export type GitWorkflowPermission = {
  kind: "blocked" | "confirmation-required" | "configuration-only" | "legacy-consent";
  code: string;
  reason: string;
};
export interface GitWorkflowSessionFacts {
  subagent: boolean;
  /** Actual active tools win over a saved selection. Missing is unknown, not Full. */
  tools?: readonly string[];
}
export interface GitWorkflowPermissions {
  /** Policy eligibility only: neither an approval nor a native candidate preflight. */
  agent: Record<ManagedGitStage, GitWorkflowPermission>;
  human: Record<ManagedGitStage, GitWorkflowPermission>;
  legacyAgentCommitConsent: boolean;
}

// Keep unsupported modes visible without pretending that durable cards alone
// make automation safe. This is capability information, never a grant.
export const AUTOMATIC_COMMIT_UNAVAILABLE = "Confirmation-free commits are not implemented yet: scoped authorization and operation-level recovery admission are still required.";
export const AUTOMATIC_WORKFLOW_UNAVAILABLE = "Confirmation-free execution is not implemented yet. Project selection and saved preferences are not execution permission.";
export const PROJECT_GIT_WRITES_UNAVAILABLE = "This project-scoped managed action is unavailable. Status, read-only review and a separate bounded selected-project commit path are supported; no checkout is changed.";

export function hasManagedGitMutationTools(tools: readonly string[]): boolean {
  return tools.some((name) => ["bash", "powershell", "edit", "write"].includes(name));
}
const blocked = (code: string, reason: string): GitWorkflowPermission => ({ kind: "blocked", code, reason });
const confirmation = (): GitWorkflowPermission => ({ kind: "confirmation-required", code: "exact-confirmation", reason: "Exact approval required; checkout, candidate and execution guards still apply." });

/** Includes the target Automatic mode for the design matrix, not settings storage. */
export function gitCommitModePermission(mode: unknown, actor: ManagedGitActor): GitWorkflowPermission {
  if (mode === "off") return blocked("task-commits-off", "Commits are disabled for this task.");
  if (mode === "manual" && actor === "agent") return blocked("manual-commits", "Commits are manual for this task. Use the Workflow panel; do not bypass with a shell.");
  if (mode === "ask" || mode === "manual") return confirmation();
  if (mode === "automatic") return blocked("automatic-unavailable", AUTOMATIC_COMMIT_UNAVAILABLE);
  return blocked("unsupported-commit-mode", "Unsupported commit mode; managed commits are blocked.");
}

/**
 * Shared, pure availability matrix for routes, loaded tools and status. Choices
 * stay captured; Pause, effective disablement and Commit Off remain live. This
 * deliberately does not infer repository rules, grants or native Git safety.
 */
export function managedGitPermission(
  state: GitWorkflowSettingsResponse, facts: GitWorkflowSessionFacts,
  stage: ManagedGitStage, actor: ManagedGitActor,
): GitWorkflowPermission {
  if (!MANAGED_GIT_STAGES.includes(stage)) return blocked("unsupported-stage", "Unsupported managed Git action.");
  if (facts.subagent) return blocked("subagent", "Subagents cannot execute managed Git mutations.");
  if (actor === "agent") {
    if (!facts.tools) return blocked("unknown-tools", "Active agent tools are unknown. Load the session before checking managed Git mutation availability.");
    if (!hasManagedGitMutationTools(facts.tools)) return blocked("read-only", "Chat-only and read-only sessions cannot execute managed Git mutations.");
  }
  if (state.paused) return blocked("paused", "All managed Git actions are paused. Resume them in Workflow.");
  if (!state.resolved.session.values.enabled || state.projectSessionRestrictions?.enabled === false) return blocked("disabled", "Managed Git is disabled for this project/chat. Configure it in Workflow.");
  if (stage === "commit" && (state.resolved.session.values.commits === "off" || state.projectSessionRestrictions?.commits === "off")) return blocked("session-commits-off", "Commits are disabled for this project/chat.");
  if (stage === "integration" && (state.resolved.project.values.delivery !== "local" || state.resolved.session.values.delivery !== "local"
    || state.projectSessionRestrictions?.delivery)) return blocked("delivery-no-local-integration", "This project delivers by handoff or leaves the branch; local integration is disabled.");
  if (stage === "commit" && actor === "agent" && (state.projectSessionRestrictions?.commits === "manual"
    || state.sessionScope === "project" && state.resolved.session.values.commits === "manual")) return gitCommitModePermission("manual", actor);
  if (state.sessionScope === "project" && stage !== "settings") return blocked("project-scope-read-only", PROJECT_GIT_WRITES_UNAVAILABLE);
  if (state.task.kind === "managed") {
    const task = state.task.settings;
    if (!task.enabled) return blocked("task-disabled", "This task is disabled. Apply enabled settings explicitly in Workflow.");
    if (stage === "commit") return gitCommitModePermission(task.commits, actor);
    if (stage === "workspace" && task.workspace !== "worktree") {
      return blocked("not-worktree-task", "This task uses the current checkout; creating a feature worktree requires explicitly applied worktree settings.");
    }
    if (stage === "workspace" && !task.baseBranch) {
      return blocked("missing-worktree-base", "This task has no captured worktree base. For one create-only worktree the agent can propose an exact-approved local base; to use automatic chat continuation, Stop the run and Save/Apply the base in Workflow.");
    }
    if ((stage === "integration" || stage === "checks") && (!task.targetBranch || task.method !== "merge" || !task.checks.length)) {
      return blocked("missing-integration-setup", "This task needs a local non-FF merge target and ordered checks. Configure and apply them in Workflow.");
    }
  }
  if (stage === "workspace" && actor === "agent" && state.task.kind !== "managed") {
    if (state.task.kind !== "legacy" || state.task.policy?.mode !== "worktree") {
      return blocked("missing-legacy-worktree-policy", "Worktree creation requires a captured task or saved worktree policy. Configure it in Workflow.");
    }
    return { kind: "legacy-consent", code: "legacy-worktree-policy", reason: "Uses this chat’s saved worktree policy without a new per-start approval. Exact checkout and base-ref checks still apply." };
  }
  if (stage === "settings") return { kind: "configuration-only", code: "preferences-only", reason: "Preferences are not execution approval. Configure managed tasks in Workflow." };
  return confirmation();
}

/** Selected-project policy eligibility for a new operation. This does not grant
 * confirmation-free execution: a separate current authorization must be checked
 * after resource selection and again immediately before the native write. Old
 * captured task consent is intentionally not consulted for another project.
 */
export function selectedProjectCommitEligibility(
  state: GitWorkflowSettingsResponse, facts: GitWorkflowSessionFacts, actor: ManagedGitActor,
): GitWorkflowPermission {
  if (facts.subagent) return blocked("subagent", "Subagents cannot execute managed Git mutations.");
  if (actor === "agent" && (!facts.tools || !hasManagedGitMutationTools(facts.tools))) {
    return blocked(!facts.tools ? "unknown-tools" : "read-only", "Active coding mutation tools are required for agent commits.");
  }
  if (state.paused) return blocked("paused", "All managed Git actions are paused.");
  if (!state.resolved.session.values.enabled) return blocked("disabled", "Managed Git is disabled for this project/chat.");
  const values = state.resolved.session.values;
  if (state.project.commits === "off" || values.commits === "off") {
    return blocked("session-commits-off", "Commits are disabled for this project/chat.");
  }
  if (actor === "agent" && (state.project.commits === "manual" || values.commits === "manual")) {
    return gitCommitModePermission("manual", actor);
  }
  // No preference (including confirmation:none) is execution authority.
  return confirmation();
}

export function managedGitPermissions(state: GitWorkflowSettingsResponse, facts: GitWorkflowSessionFacts): GitWorkflowPermissions {
  const actorPermissions = (actor: ManagedGitActor) => Object.fromEntries(MANAGED_GIT_STAGES.map((stage) => [stage, managedGitPermission(state, facts, stage, actor)])) as Record<ManagedGitStage, GitWorkflowPermission>;
  const agent = actorPermissions("agent");
  return { agent, human: actorPermissions("human"), legacyAgentCommitConsent: agent.commit.kind !== "blocked"
    && state.task.kind === "legacy" && state.task.policy?.commits === "agent" };
}
