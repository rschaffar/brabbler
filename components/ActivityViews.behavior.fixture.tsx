import { useEffect } from "react";
import { useActivityController, useActivityNotifications, useActivityOwner } from "@/hooks/useActivityController";
import type { ActivityClientController, ActivityClientPorts, ActivityClientSnapshot } from "@/lib/activity-client-controller";
import type { ProjectPrivacy } from "@/hooks/useHiddenProjects";
import type { ActivityStatus } from "@/lib/activity";
import type { SessionInfo } from "@/lib/types";
import { ActivityViews } from "./ActivityViews";

/** Test composition replaces only external catalogue/navigation inputs, not wiring. */
export function ActivityFeatureFixture({ ports, sessions, view, privacy, hidden = false, selectedId = null,
  onOwner, captureOwner, onRecoveryWork, onSnapshot, onActions, onSelect, onClose, refreshCatalogue, onBackgroundTaskDone }: {
  ports: ActivityClientPorts;
  sessions: SessionInfo[];
  view: "activity" | "starred" | null;
  privacy: ProjectPrivacy;
  hidden?: boolean;
  selectedId?: string | null;
  refreshCatalogue: () => unknown;
  onBackgroundTaskDone: () => void;
  onOwner: (owner: ActivityClientController) => void;
  captureOwner?: (owner: ActivityClientController) => void;
  onRecoveryWork?: (work: Promise<void>) => void;
  onSnapshot: (snapshot: ActivityClientSnapshot) => void;
  onActions?: (actions: { markRead: (id: string) => void; markLater: (id: string, requestId?: string) => void }) => void;
  onSelect: (session: SessionInfo, status?: ActivityStatus) => void;
  onClose: () => void;
}) {
  const controller = useActivityOwner(ports);
  // Test composition captures the ACTUAL instance before any publication/effect work.
  captureOwner?.(controller);
  const { snapshot, markRead, markLater } = useActivityController(controller);
  useActivityNotifications({ controller, snapshot, sessions, selectedId, refreshCatalogue, onBackgroundTaskDone });
  useEffect(() => { onOwner(controller); }, [controller, onOwner]);
  useEffect(() => { controller.setSessions(sessions); }, [controller, sessions]);
  useEffect(() => { onSnapshot(snapshot); }, [snapshot, onSnapshot]);
  useEffect(() => { onActions?.({ markRead, markLater }); }, [onActions, markRead, markLater]);
  return view && <ActivityViews controller={controller} view={view} sessions={sessions}
    selectedId={selectedId} privacy={privacy} hidden={hidden} onSelect={onSelect} onClose={onClose} onRecoveryWork={onRecoveryWork} />;
}
