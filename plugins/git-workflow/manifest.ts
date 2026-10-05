import type { PluginManifest, RequiredCheck } from "../../lib/plugins/types";

export const actions = ["commit", "rebase", "merge", "createWorktree", "attachWorktree", "removeWorktree"] as const;
export type GitAction = typeof actions[number];
export type Permission = "deny" | "ask" | "allow";
export interface GitSettings {
  enabled: boolean;
  commit: Permission;
  rebase: Permission;
  merge: Permission;
  createWorktree: Permission;
  attachWorktree: Permission;
  removeWorktree: Permission;
  targetBranch: string | null;
  mergeMethod: "ff-only" | "non-ff";
  commitChecks: RequiredCheck[];
  mergeChecks: RequiredCheck[];
}
export const gitWorkflowManifest = {
  id: "git-workflow",
  name: "Git Workflow",
  schemaVersion: 1,
  fields: {
    enabled: { label: "Enable plugin (all projects)", kind: "boolean", default: false, globalOnly: true },
    ...Object.fromEntries(actions.map((action) => [action, {
      label: action, kind: "enum" as const, default: "ask", options: ["deny", "ask", "allow"],
    }])),
    targetBranch: { label: "Target local branch", kind: "text", default: null, nullable: true },
    mergeMethod: { label: "Merge method", kind: "enum", default: "non-ff", options: ["ff-only", "non-ff"] },
    commitChecks: { label: "Required commit checks", kind: "checks", default: [] },
    mergeChecks: { label: "Required merge checks", kind: "checks", default: [] },
  },
} satisfies PluginManifest;
