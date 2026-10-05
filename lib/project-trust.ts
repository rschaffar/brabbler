import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import type { ProjectTrustStatus } from "./api-types";

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };
  return { requiresTrust: true, trusted: new ProjectTrustStore(agentDir).get(cwd) === true };
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
  const store = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => store.get(cwd) === true };
}
