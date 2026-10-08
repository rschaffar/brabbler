import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { validHiddenProjectKey } from "@/lib/hidden-projects";
import { readHiddenProjects, setHiddenProject } from "@/lib/hidden-projects-server";

export const dynamic = "force-dynamic";
const unavailable = () => NextResponse.json({ error: "Project privacy settings unavailable" }, { status: 500 });

export async function GET() {
  try {
    return NextResponse.json(readHiddenProjects(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const command = body as { key?: unknown; hidden?: unknown } | null;
  if (!command || Array.isArray(command) || !validHiddenProjectKey(command.key) || typeof command.hidden !== "boolean") {
    return NextResponse.json({ error: "Valid key and hidden boolean required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setHiddenProject(command.key, command.hidden));
  } catch {
    return unavailable();
  }
}
