import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { validateGitWorkflowOverrides, type GitWorkflowOverrides } from "./git-workflow-settings";
import type { SessionEntry } from "./types";

// Separate from unqualified v1/v2 workflow snapshots: old records cannot safely
// acquire a project identity from a request or a header rewritten by a move.
// These are preferences only; copying one can never transfer execution grants.
export const GIT_PROJECT_SETTINGS_TYPE = "pi-web:git-project-settings";
export interface GitProjectSessionSettings {
  version: 1;
  projectRoot: string;
  overrides: GitWorkflowOverrides;
}
export function validateGitProjectSessionSettings(input: unknown): GitProjectSessionSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid project-scoped chat settings");
  const data = input as Record<string, unknown>;
  if (data.version !== 1 || Object.keys(data).sort().join(",") !== "overrides,projectRoot,version"
    || typeof data.projectRoot !== "string" || !data.projectRoot || data.projectRoot.length > 4096
    || data.projectRoot.trim() !== data.projectRoot || /[\x00-\x1f\x7f]/.test(data.projectRoot)
    || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(data.projectRoot)) {
    throw new Error("Unsupported project-scoped chat settings");
  }
  return { version: 1, projectRoot: data.projectRoot, overrides: validateGitWorkflowOverrides(data.overrides) };
}

/** Validate all records; a malformed/newer entry never resurrects an older one. */
export function readGitProjectSessionSettings(entries: readonly SessionEntry[]): Map<string, GitProjectSessionSettings> {
  const projects = new Map<string, GitProjectSessionSettings>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== GIT_PROJECT_SETTINGS_TYPE) continue;
    const data = validateGitProjectSessionSettings(entry.data);
    projects.set(data.projectRoot, data);
    if (projects.size > 256) throw new Error("Too many project-scoped chat settings");
  }
  return projects;
}
export function appendGitProjectSessionSettings(
  manager: Pick<SessionManager, "appendCustomEntry">, projectRoot: string, overrides: GitWorkflowOverrides,
): void {
  manager.appendCustomEntry(GIT_PROJECT_SETTINGS_TYPE, validateGitProjectSessionSettings({ version: 1, projectRoot, overrides }));
}

/** Forks preserve explicitly keyed preferences, not jobs, receipts or authority. */
export function inheritGitProjectSessionSettings(entries: readonly SessionEntry[], destination: Pick<SessionManager, "appendCustomEntry">): void {
  for (const { projectRoot, overrides } of readGitProjectSessionSettings(entries).values()) {
    appendGitProjectSessionSettings(destination, projectRoot, overrides);
  }
}
