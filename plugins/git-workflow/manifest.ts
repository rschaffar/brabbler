import type { PluginManifest, RequiredCheck } from "../../lib/plugins/types";

export const actions = ["commit", "rebase", "merge", "createWorktree", "attachWorktree", "removeWorktree", "cleanupFeature"] as const;
export type GitAction = typeof actions[number];
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
  approvedArtifactRoots: string | null;
  targetBranch: string | null;
  mergeMethod: "ff-only" | "non-ff";
  commitChecks: RequiredCheck[];
  mergeChecks: RequiredCheck[];
}
export const gitWorkflowManifest = {
  id: "git-workflow",
  name: "Git Workflow",
  schemaVersion: 1,
  presets: workflowPresets,
  fields: {
    enabled: { label: "Enable plugin (all projects)", kind: "boolean", default: false, globalOnly: true },
    ...Object.fromEntries(actions.map((action) => [action, {
      label: action, group: "Operation permissions", kind: "enum" as const, default: "ask", options: ["deny", "ask", "allow"],
    }])),
    workspace: { label: "Working location", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "worktree", "current-branch"], description: "Ask uses ask_user for each applicable decision. Otherwise create a dedicated worktree or work on the current branch; stronger repository rules still apply." },
    completion: { label: "After completing work", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "retain", "integrate"] },
    targetSelection: { label: "Choose integration target", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "configured"], description: "Ask via ask_user, or use the configured local target below. A missing configured target still needs a choice." },
    methodSelection: { label: "Choose integration method", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "configured"] },
    cleanupWorktree: { label: "Completed feature worktree", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "keep", "remove-integrated"] },
    cleanupBranch: { label: "Completed feature branch", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "keep", "delete-integrated"] },
    cleanupArtifacts: { label: "Generated cleanup artifacts", group: "Workflow choices", kind: "enum", default: "ask", options: ["ask", "keep", "remove-approved"], description: "Ask via ask_user. Remove-approved only covers explicitly permitted, verified generated resources, never arbitrary ignored files." },
    approvedArtifactRoots: { label: "Permitted generated directories", kind: "text", default: null, nullable: true, description: "Explicit disposable top-level directory names, comma-separated (for example .codegraph, node_modules, .next). No default list. Cleanup still inventories contents, refuses tracked source/nested repositories/mounts, and uses its separate permission. Names or ignored status alone grant nothing." },
    targetBranch: { label: "Target local branch", kind: "text", default: null, nullable: true },
    mergeMethod: { label: "Merge method", kind: "enum", default: "non-ff", options: ["ff-only", "non-ff"] },
    commitChecks: { label: "Required commit checks", kind: "checks", default: [] },
    mergeChecks: { label: "Required merge checks", kind: "checks", default: [] },
  },
} satisfies PluginManifest;
