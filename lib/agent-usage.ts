import type { SessionUsageSummary } from "./session-stats";

export const MAX_AGENT_USAGE_IDS = 200;
export const AGENT_USAGE_POLL_MS = 3000;

export type AgentUsageEntry =
  | { status: "loading" | "unavailable" }
  | { status: "fresh" | "stale"; summary: SessionUsageSummary };
export type AgentUsageSnapshot = ReadonlyMap<string, AgentUsageEntry>;

export function isSessionUsageSummary(value: unknown): value is SessionUsageSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as SessionUsageSummary;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return finite(item.cost) && finite(item.toolCalls) && finite(item.totalActiveMs)
    && !!item.tokens && [item.tokens.input, item.tokens.output, item.tokens.cacheRead,
      item.tokens.cacheWrite, item.tokens.total].every(finite);
}

export function sumAgentUsage(ids: readonly string[], snapshot: AgentUsageSnapshot) {
  const summary: SessionUsageSummary = {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0, toolCalls: 0, totalActiveMs: 0,
  };
  let available = 0, stale = 0, loading = 0;
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const entry = snapshot.get(id);
    if (!entry || entry.status === "loading") loading++;
    if (!entry || !("summary" in entry)) continue;
    available++;
    if (entry.status === "stale") stale++;
    const item = entry.summary;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
      summary.tokens[key] += item.tokens[key];
    }
    summary.cost += item.cost;
    summary.toolCalls += item.toolCalls;
    summary.totalActiveMs += item.totalActiveMs;
  }
  return { summary, available, stale, loading, total: unique.length };
}

/** Injectable scheduling/IO keeps visibility, chunking and cancellation behavior testable. */
export function createAgentUsageCoordinator({
  read, visible, publish,
  schedule = (callback: () => void, ms: number) => setTimeout(callback, ms),
  cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}: {
  read: (ids: string[], signal: AbortSignal) => Promise<Record<string, SessionUsageSummary>>;
  visible: () => boolean;
  publish: (snapshot: AgentUsageSnapshot) => void;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let ids: string[] = [];
  let signature = "";
  let runningKey = "";
  let generation = 0;
  let disposed = false;
  let pending = false;
  let inFlight = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let snapshot = new Map<string, AgentUsageEntry>();
  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const emit = () => publish(new Map(snapshot));
  const markStale = () => {
    snapshot = new Map<string, AgentUsageEntry>([...snapshot].map(([id, entry]) => [id,
      "summary" in entry ? { status: "stale" as const, summary: entry.summary } : entry]));
  };
  const pump = async () => {
    if (disposed || inFlight || !pending || !visible() || ids.length === 0) return;
    clearTimer();
    pending = false;
    inFlight = true;
    const version = generation;
    const requested = ids;
    const current = new AbortController();
    controller = current;
    const next = new Map(snapshot);
    const valid = () => !disposed && version === generation && !current.signal.aborted && visible();
    try {
      for (let offset = 0; offset < requested.length; offset += MAX_AGENT_USAGE_IDS) {
        if (!valid()) return;
        const chunk = requested.slice(offset, offset + MAX_AGENT_USAGE_IDS);
        try {
          const stats = await read(chunk, current.signal);
          if (!valid()) return;
          for (const id of chunk) {
            next.set(id, Object.hasOwn(stats, id) && isSessionUsageSummary(stats[id])
              ? { status: "fresh", summary: stats[id] } : { status: "unavailable" });
          }
        } catch {
          if (!valid()) return;
          for (const id of chunk) {
            const previous = next.get(id);
            next.set(id, previous && "summary" in previous
              ? { status: "stale", summary: previous.summary } : { status: "unavailable" });
          }
        }
      }
      if (valid()) {
        snapshot = next;
        emit();
      }
    } finally {
      inFlight = false;
      if (controller === current) controller = null;
      if (!disposed && visible()) {
        if (pending) void pump();
        else if (runningKey) timer = schedule(() => { pending = true; void pump(); }, AGENT_USAGE_POLL_MS);
      }
    }
  };
  return {
    update(nextIds: readonly string[], nextRunningKey: string) {
      if (disposed) return;
      const unique = [...new Set(nextIds)].sort();
      const key = JSON.stringify(unique);
      if (key === signature && runningKey === nextRunningKey) return;
      signature = key;
      runningKey = nextRunningKey;
      ids = unique;
      generation++;
      clearTimer();
      controller?.abort();
      snapshot = new Map<string, AgentUsageEntry>(ids.map((id) => [id, snapshot.get(id) ?? { status: "loading" }]));
      markStale();
      emit();
      pending = true;
      void pump();
    },
    visibilityChanged() {
      if (disposed) return;
      generation++;
      clearTimer();
      controller?.abort();
      markStale();
      emit();
      pending = true;
      void pump();
    },
    dispose() {
      disposed = true;
      generation++;
      clearTimer();
      controller?.abort();
    },
  };
}

export async function readAgentUsage(ids: string[], signal: AbortSignal): Promise<Record<string, SessionUsageSummary>> {
  const response = await fetch("/api/sessions/stats", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }), signal, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Agent usage HTTP ${response.status}`);
  const data: unknown = await response.json();
  const stats = data && typeof data === "object" ? (data as { stats?: unknown }).stats : null;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) throw new Error("Invalid agent usage response");
  return stats as Record<string, SessionUsageSummary>;
}

export function formatAgentDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function formatAgentTokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value);
}

export function formatAgentCost(cost: number): string {
  return cost === 0 ? "$0.00" : cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
}
