import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

const MAX_STARS = 10_000;

export function starredSessionsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "brabbler", "starred-sessions.json");
}

export function validStarredSessionId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 256;
}

export function validStarredSessionIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length <= MAX_STARS && ids.every(validStarredSessionId);
}

export function validStarredProjectKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= 16_384;
}

export function validStarredProjectKeys(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.length <= MAX_STARS && keys.every(validStarredProjectKey);
}

interface StarredData { ids: string[]; projectKeys: string[] }

function readStarredData(path: string): StarredData {
  if (!existsSync(path)) return { ids: [], projectKeys: [] };
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid starred sessions file");
  const data = value as { version?: unknown; ids?: unknown; projectKeys?: unknown };
  if (data.version !== 1 || !validStarredSessionIds(data.ids)
    || (data.projectKeys !== undefined && !validStarredProjectKeys(data.projectKeys))) {
    throw new Error("Invalid starred sessions file");
  }
  return {
    ids: [...new Set(data.ids)].sort(),
    projectKeys: [...new Set((data.projectKeys as string[] | undefined) ?? [])].sort(),
  };
}

export function readStarredSessions(path = starredSessionsPath()): string[] {
  return readStarredData(path).ids;
}

export function readStarredProjects(path = starredSessionsPath()): string[] {
  return readStarredData(path).projectKeys;
}

/** Lock a stable pathname, not the replaced inode; every mutation re-reads inside the lock. */
async function changeStars(change: (ids: Set<string>, projectKeys: Set<string>) => void, path: string): Promise<StarredData> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 30_000,
    retries: { retries: 10, minTimeout: 100, maxTimeout: 1_000 },
  });
  try {
    const data = readStarredData(path);
    const ids = new Set(data.ids);
    const projectKeys = new Set(data.projectKeys);
    change(ids, projectKeys);
    if (ids.size > MAX_STARS || projectKeys.size > MAX_STARS) throw new Error("Too many stars");
    const result = [...ids].sort();
    const projects = [...projectKeys].sort();
    writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, ids: result, projectKeys: projects }, null, 2));
    return { ids: result, projectKeys: projects };
  } finally {
    await release();
  }
}

export async function setStarredSession(id: string, starred: boolean, path = starredSessionsPath()): Promise<StarredData> {
  if (!validStarredSessionId(id)) throw new Error("Invalid session ID");
  return changeStars((ids) => { if (starred) ids.add(id); else ids.delete(id); }, path);
}

/** Merge a browser's legacy list without overwriting other clients' changes. */
export async function importStarredSessions(legacyIds: string[], path = starredSessionsPath()): Promise<StarredData> {
  if (!validStarredSessionIds(legacyIds)) throw new Error("Invalid legacy session IDs");
  return changeStars((ids) => { for (const id of legacyIds) ids.add(id); }, path);
}

export async function setStarredProject(key: string, starred: boolean, path = starredSessionsPath()): Promise<StarredData> {
  if (!validStarredProjectKey(key)) throw new Error("Invalid project key");
  return changeStars((_ids, projectKeys) => { if (starred) projectKeys.add(key); else projectKeys.delete(key); }, path);
}
