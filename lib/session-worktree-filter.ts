import type { SessionInfo } from "./types";
import type { SessionFamily } from "./session-family";
import { workspaceKeyOf } from "./workspace-memory";
import { normalizeFilePathSlashes } from "./file-paths";

/** Display equality only; the server owns existence, registration and move checks. */
export function sameSessionDirectory(left: string, right: string): boolean {
  const key = (value: string) => {
    const normalized = normalizeFilePathSlashes(value).replace(/\/+$/, "") || "/";
    return /^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  return key(left) === key(right);
}

export interface SessionWorktreeFamily extends SessionFamily {
  archiveOwnerId: string;
  familyArchived: boolean;
}

/** Build context from the full catalogue before filtering. A matching subagent whose
 * parent lives elsewhere becomes a visible subtree root, not a discarded orphan.
 * Only matching sessions appear; moving a displayed root still expands descendants
 * on the server and requires its separate expanded-scope confirmation. */
export function sessionFamiliesForWorktree(
  catalog: readonly SessionInfo[], projectKey: string | null, cwd: string | null,
  status: "active" | "archived" | "both",
): SessionWorktreeFamily[] {
  const scoped = projectKey === null ? [...catalog] : catalog.filter(session => workspaceKeyOf(session) === projectKey);
  const byId = new Map(catalog.map(session => [session.id, session]));
  const matching = scoped.filter(session => !cwd || sameSessionDirectory(session.cwd, cwd));
  const selected = new Set(matching.map(session => session.id));
  const families = new Map<string, SessionWorktreeFamily>();
  const owners = new Map<string, string>();
  const archiveOwners = new Map<string, SessionInfo>();
  for (const session of matching) {
    let current = session, owner = session.id;
    const seen = new Set([current.id]);
    while (current.relation?.kind === "subagent") {
      const parent = byId.get(current.relation.parentSessionId);
      if (!parent) break;
      if (seen.has(parent.id)) { owner = session.id; break; }
      seen.add(parent.id); current = parent;
      if (selected.has(parent.id)) owner = parent.id;
    }
    owners.set(session.id, owner);
    archiveOwners.set(session.id, current);
  }
  for (const session of matching) {
    const owner = owners.get(session.id)!;
    if (!families.has(owner)) {
      const root = byId.get(owner)!;
      const archiveOwner = archiveOwners.get(owner)!;
      families.set(owner, { root, subagents: [], latestModified: root.modified,
        archiveOwnerId: archiveOwner.id, familyArchived: Boolean(archiveOwner.archived) });
    }
    const family = families.get(owner)!;
    if (session.id !== owner) family.subagents.push(session);
    if (session.modified > family.latestModified) family.latestModified = session.modified;
  }
  return [...families.values()].filter(family => status === "both"
    || family.familyArchived === (status === "archived"))
    .sort((a, b) => b.latestModified.localeCompare(a.latestModified));
}
