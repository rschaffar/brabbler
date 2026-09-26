import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { importStarredSessions, readStarredProjects, readStarredSessions, setStarredProject, setStarredSession, validStarredProjectKey, validStarredSessionId, validStarredSessionIds } from "@/lib/starred-sessions-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ids: readStarredSessions(), projectKeys: readStarredProjects() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid starred sessions request" }, { status: 400 });
  }
  const command = body as { op?: unknown; id?: unknown; starred?: unknown; ids?: unknown; key?: unknown };
  if (command.op === "set") {
    if (!validStarredSessionId(command.id) || typeof command.starred !== "boolean") {
      return NextResponse.json({ error: "Valid id and starred boolean required" }, { status: 400 });
    }
    try {
      return NextResponse.json(await setStarredSession(command.id, command.starred));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
  if (command.op === "set-project") {
    if (!validStarredProjectKey(command.key) || typeof command.starred !== "boolean") {
      return NextResponse.json({ error: "Valid key and starred boolean required" }, { status: 400 });
    }
    try {
      return NextResponse.json(await setStarredProject(command.key, command.starred));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
  if (command.op === "import") {
    if (!validStarredSessionIds(command.ids)) {
      return NextResponse.json({ error: "Valid ids array required" }, { status: 400 });
    }
    try {
      return NextResponse.json(await importStarredSessions(command.ids));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Unknown starred sessions operation" }, { status: 400 });
}
