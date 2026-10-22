import type { GitOperationAction, GitSettings, Permission } from "./manifest";

interface InvocationChoices { action: GitOperationAction; targetBranch?: string; mergeMethod?: "ff-only" | "non-ff" }
/** Invocation choices never write settings or supply operation permission. */
export function invocationPolicy(policy: GitSettings, op?: InvocationChoices, browserConfirmation = false): GitSettings {
  const selected = { ...policy };
  if (op?.action === "rebase" || op?.action === "merge" || op?.action === "cleanupFeature") {
    if (op.targetBranch !== undefined) {
      if (browserConfirmation && policy.targetBranch && op.targetBranch !== policy.targetBranch) throw new Error("Cleanup target differs from designated project target");
      if (policy.targetSelection !== "ask" && policy.targetBranch && op.targetBranch !== policy.targetBranch) throw new Error("Target differs from configured policy");
      selected.targetBranch = op.targetBranch;
    }
    if ("mergeMethod" in op && op.mergeMethod !== undefined) {
      if (op.action !== "merge" || !["ff-only", "non-ff"].includes(op.mergeMethod)) throw new Error("Invalid merge method");
      if (policy.methodSelection !== "ask" && op.mergeMethod !== policy.mergeMethod) throw new Error("Method differs from configured policy");
      selected.mergeMethod = op.mergeMethod;
    }
  }
  return selected;
}
export function relevantPolicy(policy: GitSettings, action: GitOperationAction) {
  if (action === "discardResources") return [policy.discardResources, policy.targetBranch, policy.approvedArtifactRoots];
  return [policy[action], action === "commit" ? policy.commitChecks : action === "merge" ? policy.mergeChecks : [],
    action === "merge" || action === "rebase" || action === "cleanupFeature" ? [policy.targetSelection, policy.targetBranch] : null,
    action === "merge" ? [policy.methodSelection, policy.mergeMethod] : null,
    action === "cleanupFeature" ? [policy.cleanupWorktree, policy.cleanupBranch, policy.cleanupArtifacts, policy.approvedArtifactRoots] : null];
}
/** Called only after capture; a live decision is still required for effective Ask. */
export function operationAuthorization(permission: Permission, source: string, artifactApproval: boolean, browserConfirmation: boolean) {
  if (permission === "deny") throw new Error("Operation denied by current settings");
  const mode = browserConfirmation || artifactApproval ? "ask" : permission;
  return {
    mode,
    source: browserConfirmation ? `manual browser confirmation (${source} ${permission})`
      : artifactApproval ? `one-time artifacts (${source} ${permission})` : source,
    decision: mode === "allow" ? "policy-authorized" as const : "pending" as const,
    subtitle: browserConfirmation ? "Manual browser confirmation required" : artifactApproval ? "One-time artifact approval required"
      : mode === "allow" ? "Policy-authorized operation" : "Approval required",
  };
}
