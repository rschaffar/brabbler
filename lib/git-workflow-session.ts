import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";
import { GIT_WORKFLOW_TYPE, readSessionGitWorkflow, validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { policyFromWorkflowSettings, validateGitWorkflowOverrides, validateGitWorkflowSettings,
  type GitWorkflowOverrides, type GitWorkflowSettings, type GitWorkflowTask } from "./git-workflow-settings";

export interface ManagedSessionGitWorkflow {
  version: 2;
  overrides: GitWorkflowOverrides;
  task: GitWorkflowTask;
  /** Compatibility projection for the existing guarded engines, never a new grant. */
  policy: GitWorkflowPolicy | null;
}
export function policyForWorkflowTask(task: GitWorkflowTask): GitWorkflowPolicy | null {
  return task.kind === "legacy" ? task.policy : task.kind === "managed" ? policyFromWorkflowSettings(task.settings) : null;
}
export function validateManagedSessionGitWorkflow(input: unknown): ManagedSessionGitWorkflow {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid session workflow");
  const data = input as Record<string, unknown>;
  if (data.version !== 2 || Object.keys(data).sort().join(",") !== "overrides,policy,task,version"
    || !data.task || typeof data.task !== "object" || Array.isArray(data.task)) throw new Error("Unsupported session workflow version");
  const raw = data.task as Record<string, unknown>;
  let task: GitWorkflowTask;
  if (raw.kind === "none" && Object.keys(raw).length === 1) task = { kind: "none" };
  else if (raw.kind === "managed" && Object.keys(raw).sort().join(",") === "kind,settings") {
    task = { kind: "managed", settings: validateGitWorkflowSettings(raw.settings) };
  } else if (raw.kind === "legacy" && Object.keys(raw).sort().join(",") === "kind,policy") {
    task = { kind: "legacy", policy: raw.policy === null ? null : validateGitWorkflowPolicy(raw.policy) };
  } else throw new Error("Invalid session workflow task");
  const policy = policyForWorkflowTask(task);
  const supplied = data.policy === null ? null : validateGitWorkflowPolicy(data.policy);
  if (JSON.stringify(supplied) !== JSON.stringify(policy)) throw new Error("Session workflow projection mismatch");
  return { version: 2, overrides: validateGitWorkflowOverrides(data.overrides), task, policy };
}

/** A malformed/newer record is a blocker, not permission to resurrect old consent. */
export function readManagedSessionGitWorkflow(entries: readonly SessionEntry[]): ManagedSessionGitWorkflow | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== GIT_WORKFLOW_TYPE) continue;
    const data = entry.data as { version?: unknown } | undefined;
    if (data?.version === 1) {
      if (entries.slice(0, i).some((e) => e.type === "custom" && e.customType === GIT_WORKFLOW_TYPE && (e.data as { version?: unknown })?.version !== 1)) {
        throw new Error("Managed workflow cannot be downgraded through legacy settings");
      }
      return undefined;
    }
    return validateManagedSessionGitWorkflow(entry.data);
  }
}
export function workflowTaskFromEntries(entries: readonly SessionEntry[]): GitWorkflowTask {
  const managed = readManagedSessionGitWorkflow(entries);
  if (managed) return managed.task;
  const policy = readSessionGitWorkflow(entries);
  return policy === undefined ? { kind: "none" } : { kind: "legacy", policy };
}
export function appendManagedSessionGitWorkflow(
  manager: Pick<SessionManager, "appendCustomEntry">, overrides: GitWorkflowOverrides, task: GitWorkflowTask,
): void {
  const checked = validateManagedSessionGitWorkflow({ version: 2, overrides, task, policy: policyForWorkflowTask(task) });
  // An older runtime skips v2. A preceding v1 tombstone stops it falling back
  // to a historical agent-commit grant. Old runtimes must not execute this task.
  manager.appendCustomEntry(GIT_WORKFLOW_TYPE, { version: 1, policy: null });
  manager.appendCustomEntry(GIT_WORKFLOW_TYPE, checked);
}
export function snapshotManagedSessionGitWorkflow(
  manager: Pick<SessionManager, "appendCustomEntry">, settings: GitWorkflowSettings,
): void {
  appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings });
}
