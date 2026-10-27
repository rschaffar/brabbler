export const STARRED_SESSIONS_STORAGE_KEY = "brabbler:starred-sessions";

export function parseStarredSessionIds(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))
      : new Set();
  } catch {
    return new Set();
  }
}

export function serializeStarredSessionIds(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}
