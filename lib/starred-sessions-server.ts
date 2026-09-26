import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

const MAX_STARS = 10_000;

export function starredSessionsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "starred-sessions.json");
}

export function validStarredSessionId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 256;
}

export function validStarredSessionIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length <= MAX_STARS && ids.every(validStarredSessionId);
}

export function readStarredSessions(path = starredSessionsPath()): string[] {
  if (!existsSync(path)) return [];
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid starred sessions file");
  const data = value as { version?: unknown; ids?: unknown };
  if (data.version !== 1 || !validStarredSessionIds(data.ids)) throw new Error("Invalid starred sessions file");
  return [...new Set(data.ids)].sort();
}

/** Lock a stable pathname, not the replaced inode; every mutation re-reads inside the lock. */
async function changeStars(change: (ids: Set<string>) => void, path: string): Promise<string[]> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 30_000,
    retries: { retries: 10, minTimeout: 100, maxTimeout: 1_000 },
  });
  try {
    const ids = new Set(readStarredSessions(path));
    change(ids);
    if (ids.size > MAX_STARS) throw new Error("Too many starred sessions");
    const result = [...ids].sort();
    writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, ids: result }, null, 2));
    return result;
  } finally {
    await release();
  }
}

export async function setStarredSession(id: string, starred: boolean, path = starredSessionsPath()): Promise<string[]> {
  if (!validStarredSessionId(id)) throw new Error("Invalid session ID");
  return changeStars((ids) => { if (starred) ids.add(id); else ids.delete(id); }, path);
}

/** Merge a browser's legacy list without overwriting other clients' changes. */
export async function importStarredSessions(legacyIds: string[], path = starredSessionsPath()): Promise<string[]> {
  if (!validStarredSessionIds(legacyIds)) throw new Error("Invalid legacy session IDs");
  return changeStars((ids) => { for (const id of legacyIds) ids.add(id); }, path);
}
