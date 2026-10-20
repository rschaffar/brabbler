import type { SessionInfo } from "./types";

/** Advisory server snapshot for automatic UI probes, never operation authorization.
 * Transient/legacy clients without this metadata retain their normal behavior. */
export function isHistoryOnlySession(session: Pick<SessionInfo, "cwdState"> | null | undefined): boolean {
  return session?.cwdState === "missing" || session?.cwdState === "unavailable";
}
