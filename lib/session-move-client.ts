import { SESSION_MOVE_BATCH_ROOT_LIMIT } from "./session-worktrees-types";
import type { SessionMoveExecuteResponse, SessionMovePlan, SessionMoveReconcileResponse, SessionMoveRequest } from "./session-worktrees-types";

export class SessionMoveResponseError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

/** Do not display a proxy HTML body (or its JSON parser exception) as an app error. */
export async function readSessionMoveResponse<T>(response: Response): Promise<T> {
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new SessionMoveResponseError(response.status); }
  const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : undefined;
  if (!response.ok || message !== undefined) throw new Error(message ?? `HTTP ${response.status}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new SessionMoveResponseError(response.status);
  return data as T;
}

const stringIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string") && new Set(value).size === value.length;
function validateExecution(data: SessionMoveExecuteResponse, plan: SessionMovePlan, ids: string[]): void {
  if (!stringIds(data.succeeded) || !stringIds(data.skipped) || !stringIds(data.pending) || !stringIds(data.movedIds)
    || !Array.isArray(data.failed) || data.failed.some(row => !row || typeof row.id !== "string" || typeof row.error !== "string")) throw new SessionMoveResponseError(200);
  const settled = [...data.succeeded, ...data.skipped, ...data.failed.map(row => row.id)];
  const all = [...settled, ...data.pending];
  if (all.length !== ids.length || new Set(all).size !== all.length || ids.some(id => !all.includes(id)) || !settled.length) throw new SessionMoveResponseError(200);
  const expectedMembers = plan.roots.filter(root => data.succeeded.includes(root.id)).flatMap(root => root.memberIds);
  if (data.movedIds.length !== expectedMembers.length || expectedMembers.some(id => !data.movedIds.includes(id))) throw new SessionMoveResponseError(200);
}
function validateObservation(data: SessionMoveReconcileResponse, plan: SessionMovePlan, ids: string[]): void {
  if (!Array.isArray(data.roots) || data.roots.length !== ids.length || new Set(data.roots.map(root => root.id)).size !== ids.length) throw new SessionMoveResponseError(200);
  for (const root of data.roots) {
    const expected = plan.roots.find(item => item.id === root.id);
    if (!ids.includes(root.id) || !expected || !["destination", "source", "changed", "unknown"].includes(root.state)
      || !stringIds(root.memberIds) || root.memberIds.length !== expected.memberIds.length || expected.memberIds.some(id => !root.memberIds.includes(id))) throw new SessionMoveResponseError(200);
  }
}
export interface SessionMoveProgress {
  completedRoots: number;
  totalRoots: number;
  movedSessions: number;
  checking: boolean;
}
export interface SessionMoveBatchResult extends SessionMoveExecuteResponse {
  uncertain: boolean;
  error?: unknown;
  observation?: SessionMoveReconcileResponse;
  /** Current locations observed after a lost response, NOT execution receipts. */
  observedDestinationIds: string[];
  /** Chat views possibly invalidated by an uncertain dispatch, not moved counts. */
  invalidatedIds: string[];
}

/** One reviewed user action, sequential bounded requests, no mutation retries.
 * Unknown acknowledgement stops admission and permits only a read-only observation.
 * Remaining work must be selected/reviewed again by the user. */
export async function runSessionMoveBatches(plan: SessionMovePlan, onProgress: (progress: SessionMoveProgress) => void, fetchRequest: typeof fetch = fetch): Promise<SessionMoveBatchResult> {
  const result: SessionMoveBatchResult = { succeeded: [], failed: [], skipped: [], movedIds: [], pending: plan.roots.map(root => root.id), uncertain: false, observedDestinationIds: [], invalidatedIds: [] };
  const post = async <T>(request: SessionMoveRequest): Promise<T> => readSessionMoveResponse<T>(await fetchRequest("/api/sessions/move", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  }));
  const progress = (checking = false) => onProgress({ completedRoots: result.succeeded.length + result.skipped.length + result.failed.length,
    totalRoots: plan.roots.length, movedSessions: result.movedIds.length, checking });
  progress();
  while (result.pending.length) {
    const ids = result.pending.slice(0, SESSION_MOVE_BATCH_ROOT_LIMIT);
    try {
      const data = await post<SessionMoveExecuteResponse>({ mode: "execute", plan, rootIds: ids });
      validateExecution(data, plan, ids);
      result.succeeded.push(...data.succeeded); result.skipped.push(...data.skipped);
      result.failed.push(...data.failed); result.movedIds.push(...data.movedIds);
      result.pending = [...data.pending, ...result.pending.slice(ids.length)];
      progress();
    } catch (error) {
      result.uncertain = true; result.error = error;
      result.invalidatedIds = plan.roots.filter(root => ids.includes(root.id)).flatMap(root => root.memberIds);
      progress(true);
      try {
        const data = await post<SessionMoveReconcileResponse>({ mode: "reconcile", plan, rootIds: ids });
        validateObservation(data, plan, ids);
        result.observation = data;
        result.observedDestinationIds = data.roots.filter(root => root.state === "destination").flatMap(root => root.memberIds);
      } catch { /* Observation can also fail/timeout. Nothing is certified or replayed. */ }
      break;
    }
  }
  return result;
}
