import { validateGitWorkflowPolicy, validLocalBranchName, type GitWorkflowCheck, type GitWorkflowPolicy } from "./git-workflow-policy";
import type { GitWorkflowPermissions } from "./git-workflow-permissions";

export type WorkflowScope = "global" | "project" | "session";
export interface GitWorkflowSettings {
  enabled: boolean;
  workspace: "current" | "worktree";
  baseBranch: string | null;
  branch: string | null;
  onCreate: "continue" | "fork" | "stay";
  commits: "off" | "manual" | "ask";
  checks: GitWorkflowCheck[];
  targetBranch: string | null;
  method: "merge" | "ff" | "squash";
  cleanup: "retain";
}
export type GitWorkflowField = keyof GitWorkflowSettings;
export type GitWorkflowOverrides = Partial<GitWorkflowSettings>;
export type GitWorkflowOrigin = "builtin" | WorkflowScope;
export interface GitWorkflowResolution {
  values: GitWorkflowSettings;
  origins: Record<GitWorkflowField, GitWorkflowOrigin>;
}
export type GitWorkflowTask = { kind: "none" } | { kind: "legacy"; policy: GitWorkflowPolicy | null }
  | { kind: "managed"; settings: GitWorkflowSettings };
export interface GitWorkflowSettingsResponse {
  revision: string;
  paused: boolean;
  cwd?: string;
  projectRoot?: string;
  global: GitWorkflowOverrides;
  project: GitWorkflowOverrides;
  session: GitWorkflowOverrides | null;
  resolved: Record<WorkflowScope, GitWorkflowResolution>;
  task: GitWorkflowTask;
  sessionEditable: boolean;
  sessionReason?: string;
  /** Current-session eligibility, never derived from editor drafts or approvals. */
  permissions?: GitWorkflowPermissions;
}

// Preferences are not standing execution grants. Automatic remains unsupported
// until reviewed rules, scoped grants and task-bound execution admission exist.
export const DEFAULT_GIT_WORKFLOW_SETTINGS: Readonly<GitWorkflowSettings> = Object.freeze({
  enabled: true, workspace: "current", baseBranch: null, branch: null, onCreate: "continue",
  commits: "ask", checks: [], targetBranch: null, method: "merge", cleanup: "retain",
});
export const GIT_WORKFLOW_FIELDS = Object.keys(DEFAULT_GIT_WORKFLOW_SETTINGS) as GitWorkflowField[];
function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

/** Missing means inherit. Null/false/[] are actual overrides, never deletion. */
export function validateGitWorkflowOverrides(input: unknown): GitWorkflowOverrides {
  if (!record(input) || Object.keys(input).some((key) => !GIT_WORKFLOW_FIELDS.includes(key as GitWorkflowField))) {
    throw new Error("Invalid workflow settings fields");
  }
  const result: GitWorkflowOverrides = {};
  for (const key of GIT_WORKFLOW_FIELDS) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    let valid = false;
    switch (key) {
      case "enabled": valid = typeof value === "boolean"; break;
      case "workspace": valid = value === "current" || value === "worktree"; break;
      case "baseBranch": case "branch": case "targetBranch": valid = value === null || validLocalBranchName(value); break;
      case "onCreate": valid = value === "continue" || value === "fork" || value === "stay"; break;
      case "commits": valid = value === "off" || value === "manual" || value === "ask"; break;
      case "method": valid = value === "merge" || value === "ff" || value === "squash"; break;
      case "cleanup": valid = value === "retain"; break;
      case "checks": {
        result.checks = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual", checks: value }).checks!;
        continue;
      }
    }
    if (!valid) throw new Error(`Invalid workflow setting: ${key}`);
    Object.assign(result, { [key]: value });
  }
  return result;
}

export function validateGitWorkflowSettings(input: unknown): GitWorkflowSettings {
  const checked = validateGitWorkflowOverrides(input);
  if (!GIT_WORKFLOW_FIELDS.every((key) => Object.hasOwn(checked, key))) throw new Error("Incomplete workflow settings");
  return checked as GitWorkflowSettings;
}

/** Pass only the chosen scope's draft and SAVED ancestors when editing. */
export function resolveGitWorkflowSettings(global: GitWorkflowOverrides = {}, project: GitWorkflowOverrides = {}, session: GitWorkflowOverrides = {}): GitWorkflowResolution {
  const values = { ...DEFAULT_GIT_WORKFLOW_SETTINGS, checks: [] } as GitWorkflowSettings;
  const origins = Object.fromEntries(GIT_WORKFLOW_FIELDS.map((key) => [key, "builtin"])) as GitWorkflowResolution["origins"];
  for (const [origin, input] of [["global", global], ["project", project], ["session", session]] as const) {
    const checked = validateGitWorkflowOverrides(input);
    Object.assign(values, checked);
    for (const key of GIT_WORKFLOW_FIELDS) if (Object.hasOwn(checked, key)) origins[key] = origin;
  }
  return { values, origins };
}

/** Legacy snapshots remain untouched. Imported defaults never create new automatic authority. */
export function settingsFromLegacyPolicy(policy: GitWorkflowPolicy): GitWorkflowSettings {
  return {
    ...DEFAULT_GIT_WORKFLOW_SETTINGS, workspace: policy.mode,
    baseBranch: policy.mode === "worktree" ? policy.baseBranch : null,
    branch: policy.mode === "current" ? policy.branch ?? null : null,
    onCreate: policy.onCreate, commits: policy.commits === "agent" ? "ask" : "manual",
    checks: policy.checks?.map((check) => ({ label: check.label, argv: [...check.argv] })) ?? [],
    targetBranch: policy.integration?.targetBranch ?? null, method: policy.integration?.method ?? "merge",
  };
}

/** Adapter for existing exact-state engines. It deliberately cannot grant agent commits. */
export function policyFromWorkflowSettings(settings: GitWorkflowSettings): GitWorkflowPolicy | null {
  const value = validateGitWorkflowSettings(settings);
  if (!value.enabled || (value.workspace === "worktree" && !value.baseBranch)) return null;
  const common = {
    onCreate: value.onCreate, commits: "manual" as const, checks: value.checks,
    ...(value.targetBranch ? { integration: { targetBranch: value.targetBranch, method: value.method } } : {}),
  };
  return validateGitWorkflowPolicy(value.workspace === "worktree"
    ? { mode: "worktree", baseBranch: value.baseBranch!, ...common }
    : { mode: "current", ...(value.branch ? { branch: value.branch } : {}), ...common });
}
