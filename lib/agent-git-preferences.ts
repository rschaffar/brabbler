import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { validateGitWorkflowPolicy, validLocalBranchName, type GitWorkflowCheck } from "./git-workflow-policy";
import type { SessionEntry } from "./types";

export const AGENT_GIT_PREFERENCES_TYPE = "pi-web:agent-git-preferences";
export type AgentGitPreferences = {
  targetBranch: string;
  method: "merge";
  checks: GitWorkflowCheck[];
  cleanup: "retain" | "offer";
  mode: "current" | "worktree";
};
export type AgentGitPreferenceChoice = {
  targetBranch: string;
  method: "merge";
  checkIndexes: number[];
  cleanup: "retain" | "offer";
  mode: "current" | "worktree";
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** Only choices on this server-owned card can become preferences. Never an operation approval. */
export function resolveAgentGitPreferenceChoice(
  value: unknown, targets: readonly string[], checks: readonly GitWorkflowCheck[],
): AgentGitPreferences | null {
  if (!object(value) || !keys(value, ["targetBranch", "method", "checkIndexes", "cleanup", "mode"])
    || !validLocalBranchName(value.targetBranch) || !targets.includes(value.targetBranch)
    || value.method !== "merge" || !["retain", "offer"].includes(value.cleanup as string)
    || !["current", "worktree"].includes(value.mode as string)
    || !Array.isArray(value.checkIndexes) || value.checkIndexes.length > checks.length
    || !value.checkIndexes.every((index: unknown, i: number) => Number.isInteger(index) && (index as number) >= 0
      && (index as number) < checks.length && (i === 0 || (index as number) > (value.checkIndexes as number[])[i - 1]))) return null;
  try {
    const selected = value.checkIndexes.map((index: number) => checks[index]);
    const policy = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual",
      integration: { targetBranch: value.targetBranch, method: "merge" }, checks: selected });
    return { targetBranch: value.targetBranch, method: "merge", checks: policy.checks ?? [],
      cleanup: value.cleanup as AgentGitPreferences["cleanup"], mode: value.mode as AgentGitPreferences["mode"] };
  } catch { return null; }
}

export function readAgentGitPreferences(entries: readonly SessionEntry[]): AgentGitPreferences | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== AGENT_GIT_PREFERENCES_TYPE) continue;
    const data: unknown = entry.data;
    if (!object(data) || !keys(data, ["version", "preferences"]) || data.version !== 1) continue;
    const pref = data.preferences;
    if (!object(pref) || !keys(pref, ["targetBranch", "method", "checks", "cleanup", "mode"])
      || !validLocalBranchName(pref.targetBranch) || pref.method !== "merge"
      || !["retain", "offer"].includes(pref.cleanup as string) || !["current", "worktree"].includes(pref.mode as string)) continue;
    try {
      const policy = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual",
        integration: { targetBranch: pref.targetBranch, method: "merge" }, checks: pref.checks });
      return { targetBranch: pref.targetBranch, method: "merge", checks: policy.checks ?? [],
        cleanup: pref.cleanup as AgentGitPreferences["cleanup"], mode: pref.mode as AgentGitPreferences["mode"] };
    } catch { /* Skip malformed entries; do not turn them into approvals. */ }
  }
  return undefined;
}

export function appendAgentGitPreferences(manager: Pick<SessionManager, "appendCustomEntry">, preferences: AgentGitPreferences): void {
  const checked = readAgentGitPreferences([{ type: "custom", customType: AGENT_GIT_PREFERENCES_TYPE,
    data: { version: 1, preferences } } as SessionEntry]);
  if (!checked) throw new Error("Invalid Git preferences");
  manager.appendCustomEntry(AGENT_GIT_PREFERENCES_TYPE, { version: 1, preferences: checked });
}

export function inheritAgentGitPreferences(entries: readonly SessionEntry[], manager: Pick<SessionManager, "appendCustomEntry">): void {
  const preferences = readAgentGitPreferences(entries);
  if (preferences) appendAgentGitPreferences(manager, preferences);
}
