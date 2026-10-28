import type { PluginManifest, RequiredCheck } from "../../lib/plugins/types";

export const actions = ["commit", "rebase", "merge", "createWorktree", "attachWorktree", "removeWorktree", "cleanupFeature"] as const;
export type GitAction = typeof actions[number];
/** Browser-only permissions never add model-facing tools. */
export const browserActions = ["discardResources"] as const;
export type GitOperationAction = GitAction | typeof browserActions[number];
export type Permission = "deny" | "ask" | "allow";
export interface GitWorkflowChoices {
  workspace: "ask" | "worktree" | "current-branch";
  completion: "ask" | "retain" | "integrate";
  targetSelection: "ask" | "configured";
  methodSelection: "ask" | "configured";
  cleanupWorktree: "ask" | "keep" | "remove-integrated";
  cleanupBranch: "ask" | "keep" | "delete-integrated";
  cleanupArtifacts: "ask" | "keep" | "remove-approved";
}
export const workflowDefaults: GitWorkflowChoices = {
  workspace: "ask", completion: "ask", targetSelection: "ask", methodSelection: "ask",
  cleanupWorktree: "ask", cleanupBranch: "ask", cleanupArtifacts: "ask",
};
export const workflowPresets = {
  "always-ask": { label: "Always ask", values: { ...workflowDefaults } },
  "isolated-retain": { label: "Isolated, retain", values: { ...workflowDefaults, workspace: "worktree", cleanupWorktree: "keep", cleanupBranch: "keep", cleanupArtifacts: "keep" } },
  "isolated-cleanup": { label: "Isolated, clean up", values: { ...workflowDefaults, workspace: "worktree", cleanupWorktree: "remove-integrated", cleanupBranch: "delete-integrated", cleanupArtifacts: "ask" } },
  "current-branch": { label: "Current branch", values: { ...workflowDefaults, workspace: "current-branch", completion: "retain", cleanupWorktree: "keep", cleanupBranch: "keep", cleanupArtifacts: "keep" } },
} satisfies NonNullable<PluginManifest["presets"]>;
export interface GitSettings extends GitWorkflowChoices {
  enabled: boolean;
  commit: Permission;
  rebase: Permission;
  merge: Permission;
  createWorktree: Permission;
  attachWorktree: Permission;
  removeWorktree: Permission;
  cleanupFeature: Permission;
  discardResources: Permission;
  approvedArtifactRoots: string | null;
  targetBranch: string | null;
  mergeMethod: "ff-only" | "non-ff";
  commitChecks: RequiredCheck[];
  mergeChecks: RequiredCheck[];
}
const approvalLabels = { deny: "gitSettings.option.block", ask: "gitSettings.option.approve", allow: "gitSettings.option.withoutApproval" };
const workflowGroup = { group: "Workflow choices" };
const safeguardsGroup = { group: "Checks and generated files" };
export const gitWorkflowManifest = {
  id: "git-workflow",
  name: "Git Workflow",
  schemaVersion: 1,
  settingsLayout: "scope-matrix",
  presets: workflowPresets,
  fields: {
    enabled: { label: "Enable plugin (all projects)", kind: "boolean", default: false, globalOnly: true,
      presentation: { labelKey: "gitSettings.field.enabled" } },
    workspace: { label: "Working location", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "worktree", "current-branch"],
      description: "Ask chooses the working location for each task. Repository instructions still take priority.",
      presentation: { labelKey: "gitSettings.field.workspace", descriptionKey: "gitSettings.help.workspace", groupKey: "gitSettings.group.workflow", optionLabelKeys: {
        ask: "gitSettings.option.askEachTime", worktree: "gitSettings.option.worktree", "current-branch": "gitSettings.option.currentBranch" } } },
    completion: { label: "After completing work", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "retain", "integrate"],
      presentation: { labelKey: "gitSettings.field.completion", optionLabelKeys: {
        ask: "gitSettings.option.askHowToFinish", retain: "gitSettings.option.retain", integrate: "gitSettings.option.integrate" } } },
    targetSelection: { label: "Choose integration target", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "configured"],
      description: "Ask chooses the target for each integration. A missing saved target still requires a question.",
      presentation: { labelKey: "gitSettings.field.targetSelection", descriptionKey: "gitSettings.help.targetSelection", optionLabelKeys: {
        ask: "gitSettings.option.askEachTime", configured: "gitSettings.option.savedTarget" } } },
    targetBranch: { label: "Target local branch", ...workflowGroup, kind: "text", default: null, nullable: true,
      description: "This is a saved local branch default, not an answer to an Ask choice. No configured branch means a target question is still required.",
      presentation: { labelKey: "gitSettings.field.targetBranch", descriptionKey: "gitSettings.help.targetBranch", nullLabelKey: "gitSettings.value.noTarget",
        relatedChoice: { field: "targetSelection", unresolvedValue: "ask" } } },
    methodSelection: { label: "Choose integration method", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "configured"],
      presentation: { labelKey: "gitSettings.field.methodSelection", optionLabelKeys: {
        ask: "gitSettings.option.askEachTime", configured: "gitSettings.option.savedMethod" } } },
    mergeMethod: { label: "Merge method", ...workflowGroup, kind: "enum", default: "non-ff", options: ["ff-only", "non-ff"],
      presentation: { labelKey: "gitSettings.field.mergeMethod", descriptionKey: "gitSettings.help.mergeMethod", relatedChoice: { field: "methodSelection", unresolvedValue: "ask" },
        optionLabelKeys: { "ff-only": "gitSettings.option.ffOnly", "non-ff": "gitSettings.option.nonFf" } } },
    cleanupWorktree: { label: "Completed feature worktree", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "keep", "remove-integrated"],
      description: "Keep blocks completed-feature cleanup, not a separately confirmed manual manager removal.",
      presentation: { labelKey: "gitSettings.field.cleanupWorktree", descriptionKey: "gitSettings.help.keep", optionLabelKeys: {
        ask: "gitSettings.option.askEachTime", keep: "gitSettings.option.keep", "remove-integrated": "gitSettings.option.removeIntegrated" } } },
    cleanupBranch: { label: "Completed feature branch", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "keep", "delete-integrated"],
      description: "Keep blocks completed-feature cleanup, not a separately confirmed manual manager removal.",
      presentation: { labelKey: "gitSettings.field.cleanupBranch", descriptionKey: "gitSettings.help.keep", optionLabelKeys: {
        ask: "gitSettings.option.askEachTime", keep: "gitSettings.option.keep", "delete-integrated": "gitSettings.option.deleteIntegrated" } } },
    cleanupArtifacts: { label: "Generated cleanup artifacts", ...workflowGroup, kind: "enum", default: "ask", options: ["ask", "keep", "remove-approved"],
      description: "Ask chooses cleanup intent. Removing generated files still requires exact-path approval; ignored status alone never permits deletion. Keep does not veto a separately confirmed manual manager removal.",
      presentation: { labelKey: "gitSettings.field.cleanupArtifacts", descriptionKey: "gitSettings.help.cleanupArtifacts", optionLabelKeys: {
        ask: "gitSettings.option.askEachTime", keep: "gitSettings.option.keep", "remove-approved": "gitSettings.option.removeApproved" } } },
    ...Object.fromEntries(actions.map((action) => [action, {
      label: action, group: "Operation permissions", kind: "enum" as const, default: "ask", options: ["deny", "ask", "allow"],
      description: action === "cleanupFeature"
        ? "Without approval skips the action prompt, not validation or required checks. Unlisted generated paths still require exact live approval."
        : "Without approval skips the action prompt, not validation, required checks or stronger repository instructions.",
      presentation: { labelKey: `gitSettings.field.${action}`, descriptionKey: action === "cleanupFeature" ? "gitSettings.help.cleanupFeature" : "gitSettings.help.approval", groupKey: "gitSettings.group.approvals", optionLabelKeys: approvalLabels },
    }])),
    discardResources: { label: "Manual manager discard", group: "Browser-only permission", kind: "enum", default: "ask", options: ["deny", "ask", "allow"], sessionOverridable: false,
      description: "Browser-only removal, including resources not proven integrated. Block refuses removal. Require approval and Allow both require exact live confirmation. Session overrides never apply. Keep preferences for completed features do not veto this separate operation; artifact and structural protections still apply.",
      presentation: { labelKey: "gitSettings.field.discardResources", descriptionKey: "gitSettings.help.discardResources", groupKey: "gitSettings.group.browser", optionLabelKeys: {
        ...approvalLabels, allow: "gitSettings.option.confirmedAllow" } } },
    approvedArtifactRoots: { label: "Permitted generated files and directories", ...safeguardsGroup, kind: "text", default: null, nullable: true,
      description: "Reusable exact worktree-relative paths, comma-separated; no defaults, globs or traversal. Nested paths use /. Permitting a parent does not permit separately selected children. Unlisted paths need one-time approval, even when cleanup is allowed without its action prompt. Source, nested-repository, mount and other protections remain.",
      presentation: { labelKey: "gitSettings.field.approvedArtifactRoots", descriptionKey: "gitSettings.help.approvedArtifactRoots", groupKey: "gitSettings.group.safeguards", nullLabelKey: "gitSettings.value.noPaths" } },
    commitChecks: { label: "Required commit checks", ...safeguardsGroup, kind: "checks", default: [],
      presentation: { labelKey: "gitSettings.field.commitChecks" } },
    mergeChecks: { label: "Required merge checks", ...safeguardsGroup, kind: "checks", default: [],
      presentation: { labelKey: "gitSettings.field.mergeChecks" } },
  },
} satisfies PluginManifest;
