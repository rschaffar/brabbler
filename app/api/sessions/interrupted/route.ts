import { NextResponse } from "next/server";
import { listPossibleInterruptedSessionIds } from "@/lib/session-run-recovery";

export const dynamic = "force-dynamic";

// Activity-only snapshot. The browser intersects IDs with its saved session
// catalogue; journal records are not themselves recoverable chat sessions.
export async function GET() {
  try {
    return NextResponse.json(
      { interruptedSessionIds: listPossibleInterruptedSessionIds() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
