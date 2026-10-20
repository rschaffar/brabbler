import type { SessionAttention, SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";
import { hasResolvedProjectIdentity } from "./hidden-projects";

export type ActivityStatus = "needs-you" | "working" | "queued" | "interrupted" | "ready" | "later";
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

/** A blocking request takes precedence over a run in both Activity and Starred. */
export function liveSessionActivityStatus(
  sessionId: string,
  runningIds: ReadonlySet<string>,
  attentionById: ReadonlyMap<string, SessionAttention>,
): "needs-you" | "working" | null {
  return attentionById.has(sessionId) ? "needs-you" : runningIds.has(sessionId) ? "working" : null;
}

export function activitySessionName(session: SessionInfo): string {
  return session.name?.trim() || (session.relation?.kind === "subagent" ? session.relation.description?.trim() : "")
    || session.firstMessage?.trim() || session.id;
}

export function activityProjectName(session: SessionInfo): string {
  const path = session.projectRoot ?? session.cwd;
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || path;
}

/** Hide a project's subagents too, even when their cwd belongs to another project. */
export function hiddenActivitySessionIds(sessions: readonly SessionInfo[], hiddenProjectKeys: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  if (hiddenProjectKeys.size === 0) return hidden;
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const session of sessions) {
    const visited = new Set<string>();
    let current: SessionInfo | undefined = session;
    while (current && !visited.has(current.id)) {
      // Unknown worktree identity or missing ancestry is not proof of a public project.
      if (!hasResolvedProjectIdentity(current) || hiddenProjectKeys.has(workspaceKeyOf(current))
        || (current.relation?.kind === "subagent" && !byId.has(current.relation.parentSessionId))) {
        hidden.add(session.id);
        break;
      }
      visited.add(current.id);
      current = current.relation?.kind === "subagent" ? byId.get(current.relation.parentSessionId) : undefined;
    }
  }
  return hidden;
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
  hiddenProjectKeys: ReadonlySet<string> = new Set(),
  laterIds: ReadonlySet<string> = new Set(),
  laterAttentionIds: ReadonlySet<string> = new Set(),
): ActivitySections {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const attentionById = new Map(attention.map((request) => [request.sessionId, request]));
  const sections: ActivitySections = { "needs-you": [], working: [], queued: [], interrupted: [], ready: [], later: [] };
  const statusById = new Map<string, ActivityStatus>();
  const hiddenIds = hiddenActivitySessionIds(sessions, hiddenProjectKeys);

  for (const session of sessions) {
    if (hiddenIds.has(session.id)) continue;
    const projectKey = workspaceKeyOf(session);
    if (projectFilter && projectKey !== projectFilter) continue;
    const request = attentionById.get(session.id);
    // A live run supersedes an old unread marker; an actual dialog supersedes both.
    const live = liveSessionActivityStatus(session.id, runningIds, attentionById);
    const status = live === "needs-you" && laterAttentionIds.has(session.id) ? "later" : live
      ?? (queuedIds.has(session.id) ? "queued"
        : !session.transient && interruptedIds.has(session.id) ? "interrupted"
        : reviewIds.has(session.id) ? laterIds.has(session.id) ? "later" : "ready" : null);
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
