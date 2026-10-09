import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import type { ProjectTrustStatus } from "./api-types";
import { isGitRepositoryTrusted, setGitRepositoryTrusted, trustedGitRepository } from "./project-trust-repository";

/** SDK path decisions (including explicit denial) take precedence over a Pi Web repository grant. */
export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };
  const decision = new ProjectTrustStore(agentDir).get(cwd);
  if (decision !== null) return { requiresTrust: true, trusted: decision };
  const repository = trustedGitRepository(cwd);
  return { requiresTrust: true, trusted: repository ? isGitRepositoryTrusted(repository, agentDir) : false };
}

export function getProjectTrustDetails(cwd: string, agentDir: string) {
  const repository = trustedGitRepository(cwd);
  const worktreeDecision = new ProjectTrustStore(agentDir).get(cwd);
  const repositoryTrusted = repository ? isGitRepositoryTrusted(repository, agentDir) : false;
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  return {
    requiresTrust,
    trusted: !requiresTrust || (worktreeDecision ?? repositoryTrusted),
    scope: worktreeDecision === true ? "worktree" as const : worktreeDecision === false ? "denied" as const
      : repositoryTrusted ? "repository" as const : "none" as const,
    worktreeDecision,
    repositoryTrusted,
    repositoryRoot: repository?.root ?? null,
    checkoutRoot: repository?.checkout ?? null,
  };
}

export function setProjectTrust(cwd: string, agentDir: string, scope: "worktree" | "repository", trusted: boolean): void {
  if (scope === "worktree") new ProjectTrustStore(agentDir).set(cwd, trusted);
  else {
    const repository = trustedGitRepository(cwd);
    if (!repository) throw new Error("Select a registered Git checkout for project-wide trust");
    setGitRepositoryTrusted(repository, agentDir, trusted);
  }
}

export function clearWorktreeTrust(cwd: string, agentDir: string): void {
  new ProjectTrustStore(agentDir).set(cwd, null);
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;
  // Use the SDK's shared trust store and native locking/normalization. Trust
  // enables project-controlled resources, not managed Git permissions.
  new ProjectTrustStore(agentDir).set(cwd, true);
  return { requiresTrust: true, trusted: true };
}

/** Project extensions execute on import/session startup. Keep them and other
 * trust-requiring project resources behind the SDK's explicit trust decision.
 * Pi Web and the CLI share this store. Projects without gated resources retain
 * their ordinary load path. Reload reads today's persisted decision. */
export function projectTrustReloadOptions(cwd: string, agentDir: string): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  if (!getProjectTrustStatus(cwd, agentDir).requiresTrust) return undefined;
  return { resolveProjectTrust: async () => getProjectTrustStatus(cwd, agentDir).trusted };
}
