import type { getSessionFamily } from "@/lib/session-family";

/** Default shell → chat archive binding. The notice/route still owns restore;
 * archived history is never a new authorization or a navigation command. */
export function sessionNavigationArchiveBinding(
  family: ReturnType<typeof getSessionFamily>,
  runningIds: ReadonlySet<string>, queuedIds: ReadonlySet<string>,
  onSessionRestored: (id: string) => void,
) {
  return {
    archivedRootSessionId: family?.root.archived ? family.root.id : null,
    archiveActionBusy: Boolean(family && [family.root, ...family.subagents]
      .some(item => runningIds.has(item.id) || queuedIds.has(item.id))),
    onSessionRestored,
  };
}
