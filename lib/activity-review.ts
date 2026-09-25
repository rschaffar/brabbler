import type { SessionCompletion, SessionInfo } from "./types";

export const REVIEWED_RUN_TIMES_STORAGE_KEY = "pi-web:reviewed-run-times";

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

/** Acknowledge only completions actually viewed; do not infer completion from idle history. */
export function reconcileCompletedRuns(
  completions: readonly SessionCompletion[],
  acknowledged: ReadonlyMap<string, number>,
  selectedId: string | null,
  runningIds: ReadonlySet<string>,
  sessions: readonly SessionInfo[],
): { rootReady: Set<string>; subagentReady: Set<string>; acknowledged: Map<string, number> } {
  const rootReady = new Set<string>();
  const subagentReady = new Set<string>();
  const next = new Map(acknowledged);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const { sessionId, at } of completions) {
    if (!Number.isFinite(at) || at <= (next.get(sessionId) ?? 0)) continue;
    if (sessionId === selectedId) {
      next.set(sessionId, at);
      continue;
    }
    if (runningIds.has(sessionId)) continue;
    const session = byId.get(sessionId);
    if (!session) continue; // A version-driven catalogue refresh may still be in flight.
    const visited = new Set<string>();
    let family: SessionInfo | undefined = session;
    let archived = false;
    while (family && !visited.has(family.id)) {
      if (family.archived) { archived = true; break; }
      visited.add(family.id);
      family = family.relation?.kind === "subagent" ? byId.get(family.relation.parentSessionId) : undefined;
    }
    if (archived) continue;
    (session.relation?.kind === "subagent" ? subagentReady : rootReady).add(sessionId);
  }
  return { rootReady, subagentReady, acknowledged: next };
}
