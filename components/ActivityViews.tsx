"use client";

import { useActivityController } from "@/hooks/useActivityController";
import type { ProjectPrivacy } from "@/hooks/useHiddenProjects";
import type { ActivityClientController } from "@/lib/activity-client-controller";
import type { ActivityStatus } from "@/lib/activity";
import type { SessionInfo } from "@/lib/types";
import { ActivityOverview } from "./ActivityOverview";
import { StarredOverview } from "./StarredOverview";

interface Props {
  controller: ActivityClientController;
  view: "activity" | "starred";
  sessions: SessionInfo[];
  selectedId: string | null;
  onSelect: (session: SessionInfo, status?: ActivityStatus) => void;
  onClose: () => void;
  hidden?: boolean;
  recoveryRefreshKey?: number;
  privacy: ProjectPrivacy;
}

/** The same production wiring is mounted in the app and feature-slice tests. */
export function ActivityViews({ controller, view, ...props }: Props) {
  const { snapshot, markRead, markLater } = useActivityController(controller);
  const shared = {
    sessions: props.sessions, selectedId: props.selectedId,
    runningIds: snapshot.runningIds, queuedIds: snapshot.queuedIds,
    attention: snapshot.attention, reviewIds: snapshot.reviewIds,
    onSelect: props.onSelect, onClose: props.onClose, hidden: props.hidden,
  };
  return view === "activity"
    ? <ActivityOverview {...shared} pauses={snapshot.pauses} available={snapshot.available}
        laterIds={snapshot.laterIds} laterAttentionIds={snapshot.laterAttentionIds}
        onMarkRead={markRead} onMarkLater={markLater}
        recoveryRefreshKey={props.recoveryRefreshKey} privacy={props.privacy} />
    : <StarredOverview {...shared} />;
}
