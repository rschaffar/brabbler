import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { acknowledgePossibleInterruptedRun, readPossibleInterruptedRun } from "@/lib/session-run-recovery";

// Dismiss the warning for one recorded run. This does not settle or resume it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json() as { runId?: unknown };
    if (typeof body.runId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    if (!await resolveSessionPath(id)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const pending = readPossibleInterruptedRun(id);
    if (!pending || pending.runId !== body.runId) {
      return NextResponse.json({ error: "Run is not awaiting acknowledgement" }, { status: 409 });
    }
    if (!acknowledgePossibleInterruptedRun(id, body.runId)) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, possibleInterruptedRun: readPossibleInterruptedRun(id) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
