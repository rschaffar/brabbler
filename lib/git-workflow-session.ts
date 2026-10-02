import { existsSync } from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionHeader } from "./types";
import { GIT_WORKFLOW_TYPE, appendSessionGitWorkflow, readSessionGitWorkflow, validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { policyFromWorkflowSettings, validateGitWorkflowOverrides, validateGitWorkflowSettings,
  type GitWorkflowOverrides, type GitWorkflowSettings, type GitWorkflowTask } from "./git-workflow-settings";

/** Creation eligibility only: never approval or an execution grant. */
export interface FreshCommitPolicyProvenance {
  kind: "post-upgrade-create";
  sessionId: string;
}

export interface ManagedSessionGitWorkflow {
  version: 2;
  overrides: GitWorkflowOverrides;
  task: GitWorkflowTask;
  /** Chat-wide opt-out; absence in older v2 entries means active. */
  optedOut?: boolean;
  /** Non-inheritable origin of implicit managed creation, bound to the header id. */
  freshCommitPolicyProvenance?: FreshCommitPolicyProvenance;
  /** Compatibility projection for the existing guarded engines, never a new grant. */
  policy: GitWorkflowPolicy | null;
}
export function policyForWorkflowTask(task: GitWorkflowTask): GitWorkflowPolicy | null {
  return task.kind === "legacy" ? task.policy : task.kind === "managed" ? policyFromWorkflowSettings(task.settings) : null;
}
function validateFreshCommitPolicyProvenance(input: unknown): FreshCommitPolicyProvenance {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid fresh commit policy provenance");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).sort().join(",") !== "kind,sessionId" || data.kind !== "post-upgrade-create"
    || typeof data.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.sessionId)) {
    throw new Error("Invalid fresh commit policy provenance");
  }
  return { kind: "post-upgrade-create", sessionId: data.sessionId };
}

export function validateManagedSessionGitWorkflow(input: unknown): ManagedSessionGitWorkflow {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid session workflow");
  const data = input as Record<string, unknown>;
  if (data.version !== 2 || Object.keys(data).some((key) => !["version", "overrides", "task", "policy", "optedOut", "freshCommitPolicyProvenance"].includes(key))
    || !["version", "overrides", "task", "policy"].every((key) => Object.hasOwn(data, key))
    || (Object.hasOwn(data, "optedOut") && typeof data.optedOut !== "boolean")
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
  return { version: 2, overrides: validateGitWorkflowOverrides(data.overrides), task, policy,
    ...(Object.hasOwn(data, "optedOut") ? { optedOut: data.optedOut as boolean } : {}),
    ...(Object.hasOwn(data, "freshCommitPolicyProvenance")
      ? { freshCommitPolicyProvenance: validateFreshCommitPolicyProvenance(data.freshCommitPolicyProvenance) } : {}) };
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
type SessionWorkflowIdentity = { sessionId: string; header: Pick<SessionHeader, "id" | "parentSession"> | null | undefined };

function currentFreshCommitPolicyProvenance(
  entries: readonly SessionEntry[], current: SessionWorkflowIdentity,
): FreshCommitPolicyProvenance | undefined {
  if (!current.header || current.header.id !== current.sessionId || current.header.parentSession !== undefined
    || entries.some((entry) => entry.type === "custom" && entry.customType === "pi-web:subagent")) return undefined;
  // Minting precedes ALL other metadata. Only the original creation pair may
  // qualify: any later workflow write permanently invalidates eligibility,
  // even a raw replay of the original marked v2 data in the same session.
  const records = entries.filter((entry): entry is Extract<SessionEntry, { type: "custom" }> =>
    entry.type === "custom" && entry.customType === GIT_WORKFLOW_TYPE);
  if (records.length !== 2 || records[0] !== entries[0] || records[1] !== entries[1]) return undefined;
  const tombstone = records[0].data as Record<string, unknown> | undefined;
  if (!tombstone || Object.keys(tombstone).sort().join(",") !== "policy,version"
    || tombstone.version !== 1 || tombstone.policy !== null) return undefined;
  try {
    const creation = validateManagedSessionGitWorkflow(records[1].data);
    if (creation.task.kind !== "managed" || Object.keys(creation.overrides).length !== 0 || creation.optedOut !== false) return undefined;
    const provenance = creation.freshCommitPolicyProvenance;
    return provenance?.sessionId === current.sessionId ? provenance : undefined;
  } catch { return undefined; }
}

/**
 * Pure proof for the CURRENT persisted ordinary session's untouched creation
 * workflow, never latest-marker authority. Subsequent workflow writes revoke it.
 * Callers must supply complete raw history (not a branch slice) and its current
 * persisted header/id, not the marker's id. Opt-out, pinned settings, caller
 * capability and live authorization remain separate gates.
 */
export function hasFreshCommitPolicyProvenance(
  entries: readonly SessionEntry[], current: SessionWorkflowIdentity & { persisted: boolean },
): boolean {
  return current.persisted === true && currentFreshCommitPolicyProvenance(entries, current) !== undefined;
}

export function appendManagedSessionGitWorkflow(
  manager: Pick<SessionManager, "appendCustomEntry">, overrides: GitWorkflowOverrides, task: GitWorkflowTask, optedOut = false,
): void {
  // Every settings/task/opt-out write and fork/clone inheritance supersedes
  // creation eligibility. Never copy or recover a marker from older entries.
  appendManagedWorkflowRecord(manager, overrides, task, optedOut);
}

function appendManagedWorkflowRecord(
  manager: Pick<SessionManager, "appendCustomEntry">, overrides: GitWorkflowOverrides, task: GitWorkflowTask,
  optedOut: boolean, provenance?: FreshCommitPolicyProvenance,
): void {
  const checked = validateManagedSessionGitWorkflow({ version: 2, overrides, task, policy: policyForWorkflowTask(task), optedOut,
    ...(provenance ? { freshCommitPolicyProvenance: provenance } : {}) });
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

/**
 * Internal wrapper recreation copies the effective workflow, never project
 * defaults or creation eligibility. Missing workflow stays missing; v2 tasks,
 * overrides and opt-out survive without conversion to legacy policy.
 */
export function restoreSessionGitWorkflowForRecreation(
  manager: Pick<SessionManager, "appendCustomEntry">, sourceEntries: readonly SessionEntry[],
): void {
  const managed = readManagedSessionGitWorkflow(sourceEntries);
  if (managed) {
    appendManagedSessionGitWorkflow(manager, managed.overrides, managed.task, managed.optedOut);
  } else {
    const policy = readSessionGitWorkflow(sourceEntries);
    if (policy !== undefined) appendSessionGitWorkflow(manager, policy);
  }
}

/**
 * Startup-only: call solely for a new ordinary session's implicit managed choice,
 * BEFORE any other entries (including benign account/tool/name/model metadata).
 * Initialized composers, recreation and reopen are not fresh startup.
 */
export function snapshotFreshManagedSessionGitWorkflow(
  manager: Pick<SessionManager, "appendCustomEntry" | "getEntries" | "getHeader" | "getSessionId" | "getSessionFile">,
  settings: GitWorkflowSettings,
): void {
  const header = manager.getHeader();
  const file = manager.getSessionFile();
  // SDK isPersisted() means disk-backed, even before the first flush.
  if (!file || existsSync(file) || manager.getEntries().length !== 0 || !header
    || header.id !== manager.getSessionId() || header.parentSession !== undefined) {
    throw new Error("Fresh workflow provenance requires a genuinely new ordinary session");
  }
  appendManagedWorkflowRecord(manager, {}, { kind: "managed", settings }, false,
    { kind: "post-upgrade-create", sessionId: header.id });
}
