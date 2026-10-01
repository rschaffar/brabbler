import { validateGitWorkflowPolicy, validLocalBranchName, type GitWorkflowCheck, type GitWorkflowPolicy } from "./git-workflow-policy";
import type { GitWorkflowPermissions } from "./git-workflow-permissions";

export type WorkflowScope = "global" | "project" | "session";
export interface GitWorkflowSettings {
  enabled: boolean;
  /** Prompt guidance only; never an execution sandbox or mutation authorization. */
  managedGitToolsOnly: boolean;
  workspace: "current" | "worktree";
  /** :project-main is not a valid Git branch name; legacy literal project-main stays literal. */
  mainBranch: string | null;
  baseBranch: string | ":project-main" | null;
  branch: string | null;
  onCreate: "continue" | "fork" | "stay";
  commits: "off" | "manual" | "ask";
  checks: GitWorkflowCheck[];
  targetBranch: string | ":project-main" | null;
  delivery: "local" | "pr" | "leave";
  method: "merge" | "ff" | "squash";
  /** Preferences only. None never constitutes saved execution authorization. */
  workspaceConfirmation: "disabled" | "ask" | "none";
  commitConfirmation: "ask" | "none";
  prepareConfirmation: "disabled" | "ask" | "none";
  checkConfirmation: "disabled" | "ask" | "none";
  integrateConfirmation: "disabled" | "ask" | "none";
  cleanupConfirmation: "disabled" | "ask" | "none";
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
  /** Explicit operation/configuration scope, independent of the chat cwd. */
  selection?: { projectRoot: string; cwd: string; branch: string };
  sessionScope?: "project";
  legacySessionSettings?: boolean;
  /** New project-keyed restrictions also clamp old mutation entry points. */
  projectSessionRestrictions?: { enabled?: false; commits?: "off" | "manual"; delivery?: "pr" | "leave" };
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
// until scoped authorization and operation-level recovery admission exist.
export const DEFAULT_GIT_WORKFLOW_SETTINGS: Readonly<GitWorkflowSettings> = Object.freeze({
  enabled: true, managedGitToolsOnly: true, workspace: "current", mainBranch: null, baseBranch: null, branch: null, onCreate: "continue",
  commits: "ask", checks: [], targetBranch: null, delivery: "local", method: "merge",
  workspaceConfirmation: "ask", commitConfirmation: "ask", prepareConfirmation: "disabled",
  checkConfirmation: "ask", integrateConfirmation: "ask", cleanupConfirmation: "disabled", cleanup: "retain",
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
      case "enabled": case "managedGitToolsOnly": valid = typeof value === "boolean"; break;
      case "workspace": valid = value === "current" || value === "worktree"; break;
      case "mainBranch": case "branch": valid = value === null || validLocalBranchName(value); break;
      case "baseBranch": case "targetBranch": valid = value === null || value === ":project-main" || validLocalBranchName(value); break;
      case "delivery": valid = value === "local" || value === "pr" || value === "leave"; break;
      case "commitConfirmation": valid = value === "ask" || value === "none"; break;
      case "workspaceConfirmation": case "prepareConfirmation": case "checkConfirmation": case "integrateConfirmation": case "cleanupConfirmation":
        valid = value === "disabled" || value === "ask" || value === "none"; break;
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

const POLICY_FIELDS: GitWorkflowField[] = ["managedGitToolsOnly", "mainBranch", "delivery", "workspaceConfirmation", "commitConfirmation",
  "prepareConfirmation", "checkConfirmation", "integrateConfirmation", "cleanupConfirmation"];
/** Old captured v2 tasks did not carry policy preferences. Read them conservatively. */
export function validateGitWorkflowSettings(input: unknown): GitWorkflowSettings {
  const checked = validateGitWorkflowOverrides(input);
  if (!GIT_WORKFLOW_FIELDS.every((key) => POLICY_FIELDS.includes(key) || Object.hasOwn(checked, key))) throw new Error("Incomplete workflow settings");
  return { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...checked };
}

/** Global and chat preferences cannot define a project's branch names or recipes. */
export function validateGitWorkflowScopeOverrides(input: unknown, scope: WorkflowScope, previous: GitWorkflowOverrides = {}): GitWorkflowOverrides {
  const checked = validateGitWorkflowOverrides(input);
  if (scope !== "project") {
    for (const key of ["mainBranch", "branch", "baseBranch", "targetBranch", "checks"] as const) {
      if (!Object.hasOwn(checked, key)) continue;
      const value = checked[key];
      const portable = (key === "baseBranch" || key === "targetBranch") && (value === ":project-main" || value === null)
        || key === "checks" && Array.isArray(value) && value.length === 0;
      // Existing legacy records remain readable and can be retained unchanged.
      if (!portable && JSON.stringify(value) !== JSON.stringify(previous[key])) throw new Error(`${scope} cannot define project-specific ${key}`);
    }
  }
  return checked;
}

/** Symbolic references never fall back to a branch in another project. */
export function projectPolicyBranches(settings: GitWorkflowSettings): { base: string | null; target: string | null } {
  const value = validateGitWorkflowSettings(settings);
  const branch = (name: string | null) => name === ":project-main" ? value.mainBranch : name;
  return { base: branch(value.baseBranch), target: value.delivery === "local" ? branch(value.targetBranch) : null };
}

/** Existing Global records remain readable, but named branches/recipes cannot leak into another project. */
function portableGlobalSettings(global: GitWorkflowOverrides): GitWorkflowOverrides {
  const portable = { ...global };
  for (const key of ["mainBranch", "branch", "baseBranch", "targetBranch", "checks"] as const) {
    const value = portable[key];
    if (key === "checks" ? Array.isArray(value) && value.length > 0
      : key === "baseBranch" || key === "targetBranch" ? typeof value === "string" && value !== ":project-main" : value !== undefined && value !== null) delete portable[key];
  }
  return portable;
}

/** Pass only the chosen scope's draft and SAVED ancestors when editing. Omitting project reads historical Global values. */
export function resolveGitWorkflowSettings(global: GitWorkflowOverrides = {}, project?: GitWorkflowOverrides, session: GitWorkflowOverrides = {}): GitWorkflowResolution {
  const values = { ...DEFAULT_GIT_WORKFLOW_SETTINGS, checks: [] } as GitWorkflowSettings;
  const origins = Object.fromEntries(GIT_WORKFLOW_FIELDS.map((key) => [key, "builtin"])) as GitWorkflowResolution["origins"];
  for (const [origin, input] of [["global", project === undefined ? global : portableGlobalSettings(global)], ["project", project ?? {}], ["session", session]] as const) {
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
  const { base, target } = projectPolicyBranches(value);
  if (!value.enabled || (value.workspace === "worktree" && !base)) return null;
  const common = {
    onCreate: value.onCreate, commits: "manual" as const, checks: value.checks,
    ...(target ? { integration: { targetBranch: target, method: value.method } } : {}),
  };
  // A legacy squash value remains readable, but this adapter never activates it.
  return validateGitWorkflowPolicy(value.workspace === "worktree"
    ? { mode: "worktree", baseBranch: base!, ...common }
    : { mode: "current", ...(value.branch ? { branch: value.branch } : {}), ...common });
}
