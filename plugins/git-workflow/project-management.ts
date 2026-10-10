import type { BundledPlugin, PluginUiContext } from "../../lib/plugins/types";
import { managementCheckout, managementStatus } from "../../lib/worktree-management";
import { gitWorkflowManifest } from "./manifest";
import { readPluginSettings } from "../../lib/plugins/settings";
import { executeGitOperation, executeBrowserDiscard } from "./server";
import type { CleanupOperation } from "./cleanup";
import { browserDiscardOperation } from "./discard";
export type { BrowserDiscardPayload, BrowserDiscardOperation } from "./discard";

export interface BrowserCleanupPayload {
  featureBranch: string; featureTip: string; integrationCommit: string; targetBranch: string;
  worktreePath?: string; removeWorktree: boolean; deleteBranch: boolean;
}
function payload(raw: unknown, cwd: string): CleanupOperation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid cleanup payload");
  const value = raw as Record<string, unknown>;
  const keys = ["featureBranch", "featureTip", "integrationCommit", "targetBranch", "worktreePath", "removeWorktree", "deleteBranch"];
  if (Object.keys(value).some((key) => !keys.includes(key)) || ["featureBranch", "featureTip", "integrationCommit", "targetBranch"].some((key) => typeof value[key] !== "string")
    || typeof value.removeWorktree !== "boolean" || typeof value.deleteBranch !== "boolean"
    || value.worktreePath !== undefined && typeof value.worktreePath !== "string" || !value.removeWorktree && !value.deleteBranch)
    throw new Error("Select exact branch/worktree cleanup resources; explicit artifact roots are not supported in the manager");
  if (value.removeWorktree !== Boolean(value.worktreePath)) throw new Error("Worktree removal must select its exact path; branch-only cleanup has no path");
  return { ...value as unknown as BrowserCleanupPayload, action: "cleanupFeature", checkout: cwd, artifactRoots: [] };
}
export const gitProjectActions: NonNullable<BundledPlugin["projectActions"]> = {
  async resolveProject(cwd) {
    const project = await managementCheckout(cwd);
    const relatedDirectories: string[] = [];
    for (const w of project.registrations) if (!w.missing && w.prunable === null) {
      try { if ((await managementCheckout(w.path)).project === project.project) relatedDirectories.push(w.path); }
      catch { /* Diagnostic registrations are visible but never grant file access. */ }
    }
    return { identity: project.project, anchor: project.registrations[0].path, relatedDirectories };
  },
  async execute(cwd, action, raw, ui: PluginUiContext, signal, progress) {
    if (action === "remove") {
      const op = browserDiscardOperation(raw, cwd);
      const settings = readPluginSettings(gitWorkflowManifest, cwd);
      if (!settings.enabled || settings.effective.discardResources === "deny") throw new Error("Git Workflow manual discard is disabled or denied");
      // The authoritative executor repeats structural/status validation. No raw
      // acknowledgment, integration/Keep override, or artifact roots are accepted.
      if (op.worktreePath) {
        const status = await managementStatus(op.worktreePath, signal);
        if (status.state === "unavailable") throw new Error(`Checkout status unavailable: ${status.reason}`);
        if (status.untracked.length) throw new Error(`Unignored untracked files block manager removal; resolve manually: ${status.untracked.join(", ")}`);
      }
      return executeBrowserDiscard(cwd, op, ui, signal, progress);
    }
    if (action !== "cleanup") throw new Error("Unsupported project action");
    // Compatibility path: legacy cleanup remains verified-integrated only.
    const op = payload(raw, cwd);
    // Explicit comparison is not a policy override: configured targets always win.
    const settings = readPluginSettings(gitWorkflowManifest, cwd);
    if (!settings.enabled || settings.effective.cleanupFeature === "deny") throw new Error("Git Workflow cleanup is disabled or denied");
    if (settings.effective.targetBranch && settings.effective.targetBranch !== op.targetBranch) throw new Error("Cleanup target differs from designated project target; use the designated target or change project settings");
    if (op.worktreePath) {
      const status = await managementStatus(op.worktreePath, signal);
      if (status.state === "unavailable") throw new Error(`Checkout status unavailable: ${status.reason}`);
      if (status.untracked.length) throw new Error(`Unignored untracked files block manager cleanup; resolve manually: ${status.untracked.join(", ")}`);
    }
    return executeGitOperation(cwd, op, ui, signal, undefined, undefined, progress, { browserConfirmation: true });
  },
};
