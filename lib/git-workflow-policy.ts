import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";
import { appendManagedSessionGitWorkflow, readManagedSessionGitWorkflow, validateManagedSessionGitWorkflow } from "./git-workflow-session";
import { inheritGitProjectSessionSettings } from "./git-project-session";

import { GIT_WORKFLOW_TYPE, validateGitWorkflowPolicy, type GitWorkflowPolicy, type SessionGitWorkflowData } from "./git-workflow-policy-contract";
// Compatibility exports for server consumers; browser values use the pure contract directly.
export * from "./git-workflow-policy-contract";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function parseSessionData(data: unknown, includeOptedOut = false): GitWorkflowPolicy | null | undefined {
  if (record(data) && data.version !== 1) {
    try {
      const managed = validateManagedSessionGitWorkflow(data);
      return managed.optedOut && !includeOptedOut ? null : managed.policy;
    } catch { return null; }
  }
  if (!record(data) || !fields(data, ["version", "policy"]) || data.version !== 1) return undefined;
  if (data.policy === null) return null;
  try { return validateGitWorkflowPolicy(data.policy); } catch { return undefined; }
}

/** Latest valid entry wins; null is a deliberate override, not an absent snapshot. */
export function readSessionGitWorkflow(entries: readonly SessionEntry[]): GitWorkflowPolicy | null | undefined {
  return readSessionGitWorkflowPolicy(entries, false);
}
/** Recovery-only historical projection: opt-out never destroys the captured policy. */
export function readCapturedSessionGitWorkflow(entries: readonly SessionEntry[]): GitWorkflowPolicy | null | undefined {
  return readSessionGitWorkflowPolicy(entries, true);
}
function readSessionGitWorkflowPolicy(entries: readonly SessionEntry[], includeOptedOut: boolean): GitWorkflowPolicy | null | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== GIT_WORKFLOW_TYPE) continue;
    const policy = parseSessionData(entry.data, includeOptedOut);
    if (policy !== undefined) return policy;
  }
  return undefined;
}

export function appendSessionGitWorkflow(manager: Pick<SessionManager, "appendCustomEntry">, policy: GitWorkflowPolicy | null): void {
  manager.appendCustomEntry(GIT_WORKFLOW_TYPE, {
    version: 1,
    policy: policy === null ? null : validateGitWorkflowPolicy(policy),
  } satisfies SessionGitWorkflowData);
}

/** Forks copy the effective session snapshot, not a newly changed project default. */
export function inheritSessionGitWorkflow(
  sourceEntries: readonly SessionEntry[], destination: Pick<SessionManager, "appendCustomEntry">,
): void {
  const managed = readManagedSessionGitWorkflow(sourceEntries);
  inheritGitProjectSessionSettings(sourceEntries, destination);
  if (managed) {
    appendManagedSessionGitWorkflow(destination, managed.overrides, managed.task, managed.optedOut);
    return;
  }
  const policy = readSessionGitWorkflow(sourceEntries);
  if (policy !== undefined) appendSessionGitWorkflow(destination, policy);
}
