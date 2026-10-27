import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";

export const SESSION_ARCHIVE_TYPE = "brabbler:archive";

/** The newest valid marker wins; false explicitly restores an earlier archive. */
export function appendSessionArchiveState(sessionManager: SessionManager, archived: boolean): void {
  sessionManager.appendCustomEntry(SESSION_ARCHIVE_TYPE, { version: 1, archived });
}

export function isSessionArchived(entries: readonly SessionEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== SESSION_ARCHIVE_TYPE) continue;
    if (typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data)) continue;
    const data = entry.data as { version?: unknown; archived?: unknown };
    if (data.version === 1 && typeof data.archived === "boolean") return data.archived;
  }
  return false;
}
