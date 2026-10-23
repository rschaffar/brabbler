"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createActivityClientController, type ActivityClientController, type ActivityClientPorts, type ActivityClientSnapshot } from "@/lib/activity-client-controller";
import type { SessionInfo } from "@/lib/types";

/** One application owner. Strict Effects replay is observation replay, not disposal. */
export function useActivityOwner(ports?: ActivityClientPorts): ActivityClientController {
  const [controller] = useState(() => createActivityClientController(ports));
  useEffect(() => {
    const release = controller.retain();
    return () => {
      release();
      // React replays setup synchronously before this final-owner check. Actual
      // teardown closes admission and joins requests without cancelling native jobs.
      void controller.disposeWhenUnobserved();
    };
  }, [controller]);
  return controller;
}

/** Views share observation; actions bind the completion actually displayed. */
export function useActivityController(controller: ActivityClientController) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => controller.retain(), [controller]);
  const markRead = useCallback((id: string) => {
    controller.markRead(id, snapshot.completedRunTimes.get(id));
  }, [controller, snapshot.completedRunTimes]);
  const markLater = useCallback((id: string, requestId?: string) => {
    controller.markLater(id, requestId, snapshot.completedRunTimes.get(id));
  }, [controller, snapshot.completedRunTimes]);
  return { snapshot, markRead, markLater };
}

/** Sidebar-only notification/navigation ports, never completion or Read authority. */
export function useActivityNotifications({ controller, snapshot, sessions, selectedId, refreshCatalogue, onBackgroundTaskDone }: {
  controller: ActivityClientController;
  snapshot: ActivityClientSnapshot;
  sessions: readonly SessionInfo[];
  selectedId: string | null;
  refreshCatalogue: () => unknown;
  onBackgroundTaskDone?: () => void;
}) {
  const previousRunning = useRef<ReadonlySet<string>>(new Set());
  const previousSuppressed = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const { runningIds, suppressedCompletionIds, pauses } = snapshot;
    const previous = previousRunning.current;
    const completedInBackground = [...previous].filter(id => !runningIds.has(id) && id !== selectedId);
    const subagents = new Set(sessions.filter(session => session.relation?.kind === "subagent").map(session => session.id));
    const paused = new Set(pauses.map(row => row.sessionId));
    const withNotifications = completedInBackground.filter(id => !previousSuppressed.current.has(id)
      && !subagents.has(id) && !paused.has(id) && controller.isUnreviewedCompletion(id));
    const hasUnlistedRunning = [...runningIds].some(id => !previous.has(id) && !sessions.some(session => session.id === id));
    if (completedInBackground.length > 0 || hasUnlistedRunning) refreshCatalogue();
    if (withNotifications.length > 0) onBackgroundTaskDone?.();
    previousRunning.current = runningIds;
    previousSuppressed.current = new Set([...runningIds].filter(id => suppressedCompletionIds.has(id) || subagents.has(id)));
  }, [controller, snapshot, sessions, selectedId, refreshCatalogue, onBackgroundTaskDone]);
}
