import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { pauseManagedSessions, resumeAllManagedSessions, resumeManagedSession, runPauseOperation } from "@/lib/session-pause-runtime";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  try {
    const body = await parseJsonWithinLimit(request, 4096) as { action?: unknown; sessionId?: unknown; pauseId?: unknown };
    const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
    if (!body || !["pause", "resume", "pause-all", "resume-all"].includes(body.action as string)
      || ((body.action === "pause" || body.action === "resume") && !validId(body.sessionId))
      || (body.action === "resume" && !validId(body.pauseId))) return NextResponse.json({ error: "Invalid pause command" }, { status: 400 });
    const result = body.action === "resume-all" ? await resumeAllManagedSessions()
      : body.action === "resume" ? (await resumeManagedSession(body.sessionId as string, body.pauseId as string), { errors: [] })
      : await runPauseOperation(() => pauseManagedSessions(body.action === "pause" ? body.sessionId as string : undefined));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
