import { NextResponse } from "next/server";
import { getSessionPauseSnapshot } from "@/lib/session-pause-runtime";
import { getSessionListVersion } from "@/lib/session-reader";
import { readActivityReview } from "@/lib/activity-review-server";
import { getQueuedSubagentSessionIds } from "@/lib/subagent-runtime";
import {
  activityReviewPersistenceFailed,
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionAttention,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  const review = readActivityReview();
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      queuedSessionIds: getQueuedSubagentSessionIds(),
      attention: getRpcSessionAttention(),
      pauses: getSessionPauseSnapshot(),
      completedRuns: review.completedRuns,
      reviewedRuns: review.reviewedRuns,
      laterRuns: review.laterRuns,
      laterRequests: review.laterRequests,
      activityReviewPersistenceFailed: activityReviewPersistenceFailed(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
