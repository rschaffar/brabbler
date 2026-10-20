import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { readDiskSessionUsage } from "@/lib/session-usage-reader";
import { computeSessionStats, type SessionUsageSummary } from "@/lib/session-stats";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { MAX_AGENT_USAGE_IDS } from "@/lib/agent-usage";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
type Manager = { getEntries: () => readonly { id?: string }[] };
const summaries = new WeakMap<Manager, { count: number; latest: string | undefined; summary: SessionUsageSummary }>();

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** No startup, eviction, resource reload, disk migration/repair or liveness renewal. */
async function readSummary(id: string): Promise<SessionUsageSummary | null> {
  const rpc = getRpcSession(id);
  if (!rpc?.isAlive()) {
    const path = await resolveSessionPath(id, { allowCatalogueScan: false });
    return path ? readDiskSessionUsage(path, id) : null;
  }
  const manager = rpc.inner.sessionManager;
  const entries = manager.getEntries();
  const latest = entries.at(-1)?.id;
  const cached = summaries.get(manager);
  if (cached && cached.count === entries.length && cached.latest === latest) return cached.summary;
  const stats = computeSessionStats(entries as unknown as SessionEntry[]);
  const summary = {
    tokens: stats.tokens, cost: stats.cost, toolCalls: stats.toolCalls,
    totalActiveMs: computeSessionTotalActiveMs(entries),
  };
  summaries.set(manager, { count: entries.length, latest, summary });
  return summary;
}

// ID-only, bounded batch. Omitted IDs are unavailable (missing, malformed or concurrently removed).
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return reply({ error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(request)) return reply({ error: "Content-Type must be application/json" }, 415);
  let body: unknown;
  try { body = await request.json(); }
  catch { return reply({ error: "Invalid JSON" }, 400); }
  const ids = body && typeof body === "object" && !Array.isArray(body) ? (body as { ids?: unknown }).ids : null;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_AGENT_USAGE_IDS
    || !ids.every((id) => typeof id === "string" && SESSION_ID.test(id))
    || Object.keys(body as object).some((key) => key !== "ids")) {
    return reply({ error: `Expected only ids: 1–${MAX_AGENT_USAGE_IDS} session IDs` }, 400);
  }
  const stats: Record<string, SessionUsageSummary> = Object.create(null);
  for (const id of new Set(ids as string[])) {
    try {
      const summary = await readSummary(id);
      if (summary) stats[id] = summary;
    } catch { /* One unreadable session must not hide the rest of the family. */ }
  }
  return reply({ stats });
}
