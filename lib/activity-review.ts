import type { SessionAttention, SessionAttentionReceipt, SessionCompletion, SessionInfo } from "./types";

export function activityRequestKey(receipt: SessionAttentionReceipt): string {
  return JSON.stringify([receipt.sessionId, receipt.requestId]);
}

/** Validate the displayed token against the latest poll, never substitute a newer request. */
export function isCurrentActivityRequest(attention: readonly SessionAttention[], receipt: SessionAttentionReceipt): boolean {
  return attention.some((request) => request.sessionId === receipt.sessionId && request.requestId === receipt.requestId);
}

/** Exact request identity prevents an old deferral hiding a replacement question. */
export function deferredAttentionIds(attention: readonly SessionAttention[], keys: ReadonlySet<string>): Set<string> {
  return new Set(attention.filter((request) => request.requestId
    && keys.has(activityRequestKey({ sessionId: request.sessionId, requestId: request.requestId }))).map((request) => request.sessionId));
}

export const REVIEWED_RUN_TIMES_STORAGE_KEY = "brabbler:reviewed-run-times";

export function hasReviewedRunBaseline(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(REVIEWED_RUN_TIMES_STORAGE_KEY) !== null; }
  catch { return false; }
}

export function mergeReviewedRunTimes(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  const merged = new Map(a);
  for (const [id, at] of b) merged.set(id, Math.max(merged.get(id) ?? 0, at));
  return merged;
}

export function loadReviewedRunTimes(): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(REVIEWED_RUN_TIMES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.filter((entry): entry is [string, number] =>
      Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1])));
  } catch {
    return new Map();
  }
}

export function saveReviewedRunTimes(times: ReadonlyMap<string, number>): Map<string, number> {
  const merged = mergeReviewedRunTimes(times, loadReviewedRunTimes());
  if (typeof window === "undefined") return merged;
  try {
    window.localStorage.setItem(REVIEWED_RUN_TIMES_STORAGE_KEY, JSON.stringify([...merged]));
  } catch {
    // Best-effort per-browser acknowledgement.
  }
  return merged;
}

/** List unacknowledged completions; opening a session never marks it read. */
export function reconcileCompletedRuns(
  completions: readonly SessionCompletion[],
  acknowledged: ReadonlyMap<string, number>,
  runningIds: ReadonlySet<string>,
  sessions: readonly SessionInfo[],
): { rootReady: Set<string>; subagentReady: Set<string> } {
  const rootReady = new Set<string>();
  const subagentReady = new Set<string>();
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const { sessionId, at } of completions) {
    if (!Number.isFinite(at) || at <= (acknowledged.get(sessionId) ?? 0)) continue;
    if (runningIds.has(sessionId)) continue;
    const session = byId.get(sessionId);
    if (!session) continue; // A version-driven catalogue refresh may still be in flight.
    (session.relation?.kind === "subagent" ? subagentReady : rootReady).add(sessionId);
  }
  return { rootReady, subagentReady };
}
