import { randomUUID } from "node:crypto";
import type { GitTaskBindingSnapshot } from "./git-workflow-binding-types";

export interface PendingGitTaskBinding {
  sessionId: string;
  revision: string;
  settingsRevision: string;
  headOid: string;
  snapshot: GitTaskBindingSnapshot;
}
const key = Symbol.for("pi-web:git-task-bindings:v1");
interface Runtime { epoch: string; previews: Map<string, PendingGitTaskBinding> }
export function gitTaskBindingRuntime(): Runtime {
  const shared = globalThis as unknown as Record<symbol, Runtime | undefined>;
  return shared[key] ??= { epoch: randomUUID(), previews: new Map() };
}
/** Metadata previews only; no jobs/approval capabilities are recovered from disk. */
export function retireGitTaskBindingPreviews(sessionIds: readonly string[]): void {
  for (const [id, item] of gitTaskBindingRuntime().previews) if (sessionIds.includes(item.sessionId)) gitTaskBindingRuntime().previews.delete(id);
}
