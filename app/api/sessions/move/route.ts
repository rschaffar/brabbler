import { NextResponse } from "next/server";
import { executeSessionMoves, previewSessionMoves, reconcileSessionMoves, sessionMoveErrorMessage } from "@/lib/session-worktrees";
import { readSessionMoveRequest, SessionWorktreeError } from "@/lib/session-worktrees-plan";
import { SessionMoveConflict } from "@/lib/session-move";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(req: Request) {
  try {
    const body = await readSessionMoveRequest(req);
    if (body.mode === "preview") return NextResponse.json(await previewSessionMoves(body), { headers });
    if (body.mode === "reconcile") return NextResponse.json(await reconcileSessionMoves(body.plan, body.rootIds), { headers });
    return NextResponse.json(await executeSessionMoves(body.plan, req.signal, body.rootIds), { headers });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    const status = error instanceof SessionWorktreeError ? error.status : error instanceof SessionMoveConflict ? 409
      : code === "ENOENT" ? 400 : code === "EACCES" || code === "EPERM" ? 403 : 500;
    return NextResponse.json({ error: sessionMoveErrorMessage(error) }, { status, headers });
  }
}
