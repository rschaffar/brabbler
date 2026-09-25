import type { SessionAttention, SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

export type ActivityStatus = "needs-you" | "working" | "queued" | "interrupted" | "ready";
export interface ActivityItem {
  session: SessionInfo;
  status: ActivityStatus;
  attention?: SessionAttention;
  /** The immediate parent is in this section, so the row can be indented. */
  nested: boolean;
  parentName?: string;
  projectKey: string;
}
export type ActivitySections = Record<ActivityStatus, ActivityItem[]>;

export function activitySessionName(session: SessionInfo): string {
  return session.name?.trim() || (session.relation?.kind === "subagent" ? session.relation.description?.trim() : "")
    || session.firstMessage?.trim() || session.id;
}

export function activityProjectName(session: SessionInfo): string {
  const path = session.projectRoot ?? session.cwd;
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || path;
}

/** Classify only sessions known to this Pi Web catalogue; idle history is not an inbox. */
export function getActivitySections(
  sessions: readonly SessionInfo[],
  runningIds: ReadonlySet<string>,
  attention: readonly SessionAttention[],
  reviewIds: ReadonlySet<string>,
  projectFilter: string | null = null,
  queuedIds: ReadonlySet<string> = new Set(),
  interruptedIds: ReadonlySet<string> = new Set(),
): ActivitySections {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const attentionById = new Map(attention.map((request) => [request.sessionId, request]));
  const sections: ActivitySections = { "needs-you": [], working: [], queued: [], interrupted: [], ready: [] };
  const statusById = new Map<string, ActivityStatus>();
  const isArchived = (session: SessionInfo): boolean => {
    const visited = new Set<string>();
    let current: SessionInfo | undefined = session;
    while (current && !visited.has(current.id)) {
      if (current.archived) return true;
      visited.add(current.id);
      current = current.relation?.kind === "subagent" ? byId.get(current.relation.parentSessionId) : undefined;
    }
    return false;
  };

  for (const session of sessions) {
    if (isArchived(session)) continue;
    const projectKey = workspaceKeyOf(session);
    if (projectFilter && projectKey !== projectFilter) continue;
    const request = attentionById.get(session.id);
    // A live run supersedes an old unread marker; an actual dialog supersedes both.
    const status = request ? "needs-you" : runningIds.has(session.id) ? "working"
      : queuedIds.has(session.id) ? "queued"
      : !session.transient && interruptedIds.has(session.id) ? "interrupted"
      : reviewIds.has(session.id) ? "ready" : null;
    if (!status) continue;
    statusById.set(session.id, status);
    sections[status].push({ session, status, ...(request ? { attention: request } : {}), nested: false, projectKey });
  }
  for (const items of Object.values(sections)) {
    for (const item of items) {
      const parentId = item.session.relation?.kind === "subagent" ? item.session.relation.parentSessionId : null;
      if (!parentId) continue;
      const parent = byId.get(parentId);
      item.nested = statusById.get(parentId) === item.status;
      if (parent) item.parentName = activitySessionName(parent);
    }
    items.sort((a, b) => {
      const aTime = a.attention?.since ?? (Date.parse(a.status === "working" || a.status === "queued" ? a.session.created : a.session.modified) || 0);
      const bTime = b.attention?.since ?? (Date.parse(b.status === "working" || b.status === "queued" ? b.session.created : b.session.modified) || 0);
      return a.status === "needs-you" ? aTime - bTime || a.session.id.localeCompare(b.session.id)
        : bTime - aTime || a.session.id.localeCompare(b.session.id);
    });
    const ordered: ActivityItem[] = [];
    const placed = new Set<string>();
    const append = (item: ActivityItem) => {
      if (placed.has(item.session.id)) return;
      placed.add(item.session.id);
      ordered.push(item);
      for (const child of items) {
        if (child.nested && child.session.relation?.kind === "subagent"
          && child.session.relation.parentSessionId === item.session.id) append(child);
      }
    };
    items.filter((item) => !item.nested).forEach(append);
    items.forEach(append); // Orphans or cyclic metadata remain visible.
    items.splice(0, items.length, ...ordered);
  }
  return sections;
}
