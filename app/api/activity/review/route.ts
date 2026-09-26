import { NextResponse } from "next/server";
import { ActivityReviewConflict, acknowledgeActivityCompletions, validActivityCompletion } from "@/lib/activity-review-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// POST /api/activity/review { op: "ack", entries: [{ sessionId, at }] }
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
  if ((command.op !== "ack" && command.op !== "import") || !Array.isArray(command.entries)
    || command.entries.length > 1000 || !command.entries.every(validActivityCompletion)) {
    return NextResponse.json({ error: "Invalid review acknowledgements" }, { status: 400 });
  }
  try {
    return NextResponse.json(acknowledgeActivityCompletions(command.entries, undefined, command.op === "import"),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: error instanceof ActivityReviewConflict ? 409 : 500 });
  }
}
