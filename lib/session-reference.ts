/** A Pi Web link navigates to a local session; it is not a transcript URL or a capability. */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionDeepLink(origin: string, sessionId: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("session", sessionId);
  return url.toString();
}

/** Recognize explicit Pi Web deep links, not arbitrary UUIDs or other query parameters. */
export function referencedSessionIds(text: string, limit = 3): string[] {
  const ids = new Set<string>();
  const links = /(?:https?:\/\/[^\s<>"'`]+|\/\?session=[^\s<>"'`]+)/gi;
  for (const match of text.matchAll(links)) {
    const candidate = match[0].replace(/[),.!?;\]]+$/, "");
    try {
      const url = new URL(candidate, "http://pi-web.local");
      if (url.pathname !== "/" || url.searchParams.has("cwd")) continue;
      const id = url.searchParams.get("session");
      if (!id || !SESSION_ID_PATTERN.test(id)) continue;
      ids.add(id.toLowerCase());
      if (ids.size >= limit) break;
    } catch { /* Ignore malformed links. */ }
  }
  return [...ids];
}
