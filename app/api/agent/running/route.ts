import { NextResponse } from "next/server";
import { getSessionListVersion } from "@/lib/session-reader";
import { getQueuedSubagentSessionIds } from "@/lib/subagent-runtime";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionAttention,
  getRecentRpcSessionCompletions,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      queuedSessionIds: getQueuedSubagentSessionIds(),
      attention: getRpcSessionAttention(),
      completedRuns: getRecentRpcSessionCompletions(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
