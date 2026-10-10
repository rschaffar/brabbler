import type { SessionEntry } from "./types";

export const SESSION_SPAWN_TYPE = "pi-web:session-spawn";
export interface SessionSpawn { version: 1; sessionId: string; creatorSessionId: string; operationId: string }
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
export function readSessionSpawn(value: unknown, sessionId: string): SessionSpawn | null {
  if (!value || typeof value !== "object") return null;
  const data = value as SessionSpawn;
  // Copied metadata on forks/clones must never attribute the copy to this creator.
  return data.version === 1 && data.sessionId === sessionId && safeId(data.creatorSessionId)
    && data.creatorSessionId !== sessionId && safeId(data.operationId) ? data : null;
}
export function sessionSpawnFromEntries(entries: readonly SessionEntry[], sessionId: string): SessionSpawn | null {
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== SESSION_SPAWN_TYPE) continue;
    const spawn = readSessionSpawn(entry.data, sessionId);
    if (spawn) return spawn;
  }
  return null;
}
