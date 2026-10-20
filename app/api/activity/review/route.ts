import { NextResponse } from "next/server";
import { ActivityReviewConflict, acknowledgeActivityCompletions, deferActivityCompletions, deferActivityRequests, validActivityCompletion, validActivityRequest } from "@/lib/activity-review-server";
import { isCurrentActivityRequest } from "@/lib/activity-review";
import { getRpcSessionAttention } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// POST /api/activity/review { op: "ack" | "later", entries: [{ sessionId, at }] }
// Legacy import only merges receipts for runs the server actually recorded.
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid review request" }, { status: 400 });
  }
  const command = body as { op?: unknown; entries?: unknown };
  if (command.op === "later-request") {
    if (!Array.isArray(command.entries) || command.entries.length > 1000 || !command.entries.every(validActivityRequest)) {
      return NextResponse.json({ error: "Invalid activity requests" }, { status: 400 });
    }
    const attention = getRpcSessionAttention();
    if (command.entries.some((entry) => !isCurrentActivityRequest(attention, entry))) {
      return NextResponse.json({ error: "Activity request is no longer pending" }, { status: 409 });
    }
    try {
      return NextResponse.json(deferActivityRequests(command.entries), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
  if ((command.op !== "ack" && command.op !== "import" && command.op !== "later") || !Array.isArray(command.entries)
    || command.entries.length > 1000 || !command.entries.every(validActivityCompletion)) {
    return NextResponse.json({ error: "Invalid review acknowledgements" }, { status: 400 });
  }
  try {
    const snapshot = command.op === "later" ? deferActivityCompletions(command.entries)
      : acknowledgeActivityCompletions(command.entries, undefined, command.op === "import");
    return NextResponse.json(snapshot,
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: error instanceof ActivityReviewConflict ? 409 : 500 });
  }
}
