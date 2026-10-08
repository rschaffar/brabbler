import { createHash } from "node:crypto";
import { readPluginSettings } from "../../lib/plugins/settings";
import type { PluginSession } from "../../lib/plugins/types";
import { gitWorkflowManifest } from "./manifest";

export const GIT_POLICY_CONTRACT = "pi-web:git-policy/v1";
export function gitPolicy(checkout: string, session: PluginSession) {
  const settings = readPluginSettings(gitWorkflowManifest, checkout, undefined, session);
  if (!settings.enabled) throw new Error("Git Workflow plugin is disabled");
  const policy = { contract: GIT_POLICY_CONTRACT, project: settings.project, sessionProject: settings.sessionProject,
    sessionOverridesApply: settings.sessionApplicable === true,
    effective: settings.effective, sources: settings.sources,
    capabilities: { durableOperationReceipts: true, boundedCleanup: "git_cleanup", remoteOperations: false,
      cleanupArtifactAuthority: "approvedArtifactRoots: reusable user-owned comma-separated top-level files/directories; no defaults. Unlisted artifacts require one-time live cleanup-card approval even under Allow",
      cleanupArtifactDiscovery: "worktree removal proposes top-level ignored artifacts; explicit artifactRoots may add generated files/directories; neither is deletion authority" } };
  return { ...policy, revision: createHash("sha256").update(JSON.stringify(policy)).digest("hex") };
}
export function gitPolicyGuidance(session: PluginSession): string {
  return `Current harness Git policy (${GIT_POLICY_CONTRACT}); user-configured choices, not a new task request.\n` +
    `Use git_policy with the explicitly selected checkout before a foreign-repository operation. Session overrides apply ONLY to the session's own repository, including its linked worktrees. Never carry these choices to a different project.\n` +
    `Workflow choices are separate from action permissions. Every applicable choice set to ask MUST use the ask_user tool; ask one focused question, do not guess, auto-answer, or persist that answer as a setting. A choice already answered for this bounded operation need not be repeated. Presets never authorize implementation, publication or remote operations.\n` +
    `Non-ask choices supply standing workflow intent where applicable instructions recognize this contract. Ask for unresolved values or genuine conflicts. Stronger explicit user/repository requirements still apply; this snapshot does not override them. Never edit settings to grant yourself permission.\n` +
    `Operation Ask belongs to the Git tool's exact-action approval card: do not precede it with an equivalent ask_user approval. Workflow questions select intent, not blanket permission. Read-only preparation does not need a separate consent question. Checks and state revalidation still apply under Allow.\n` +
    `Configured target/method use targetBranch/mergeMethod; a missing target needs ask_user. Current-branch work does not create a worktree for convenience. Cleanup applies only after verified integration to the named feature resources; unknown ignored files, backups and caller/main checkouts are never implicitly disposable. Generated artifacts require explicit bounded permission, not merely a familiar path or .gitignore entry. Use git_cleanup for combined verified integration cleanup. It discovers top-level ignored artifacts when removing a worktree, including regular files; artifactRoots may be empty for discovery or name additional explicit generated paths. Its separate cleanupFeature permission and reusable user-owned approvedArtifactRoots apply. Unlisted artifacts require one-time approval in the same cleanup card, even under Allow; do not stop merely because the allowlist is empty, edit it yourself, or add a duplicate artifact-permission ask_user question. The old removeWorktree remains strict and retains branches. A kept checked-out worktree cannot have its branch deleted.\n` +
    JSON.stringify(gitPolicy(session.cwd, session));
}
