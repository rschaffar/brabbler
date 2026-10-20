import type { SessionInfo } from "@/lib/types";
import { isHistoryOnlySession } from "@/lib/session-directory";

/**
 * Overlay a catalogue row onto the session already on screen.
 *
 * Catalogue rows omit optional keys instead of setting them to undefined, so a
 * plain spread can never clear one that stopped being true: a hydrated row drops
 * `detailsPending`, a restored session drops `archived`, a session that left a
 * worktree drops `branch`/`isWorktree`, and a fork whose parent went away drops
 * `relation`. Reset those from the refreshed row explicitly. Locally applied fields such as an auto-generated
 * title still survive until the next listing carries them.
 */
export function mergeCatalogRow(current: SessionInfo, refreshed: SessionInfo): SessionInfo {
  return {
    ...current,
    ...refreshed,
    // A stale catalogue must not readmit a cwd just classified as missing by a
    // fresh detail read. An explicit reselect/reload or move can admit it again.
    cwdState: current.cwd === refreshed.cwd && isHistoryOnlySession(current) ? current.cwdState : refreshed.cwdState,
    detailsPending: refreshed.detailsPending,
    archived: refreshed.archived,
    relation: refreshed.relation,
    branch: refreshed.branch,
    isWorktree: refreshed.isWorktree,
  };
}
