import { NextResponse } from "next/server";
import { getSessionWorktreeInventory, sessionMoveErrorMessage } from "@/lib/session-worktrees";
import { SessionWorktreeError } from "@/lib/session-worktrees-plan";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request) {
  try {
    const project = new URL(req.url).searchParams.get("project");
    if (!project) throw new SessionWorktreeError("Project is required");
    return NextResponse.json(await getSessionWorktreeInventory(project), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SessionWorktreeError ? error.message : "Unable to load session worktrees" },
      { headers, status: error instanceof SessionWorktreeError ? error.status : sessionMoveErrorMessage(error) === "Cannot access the directory or session files" ? 403 : 500 });
  }
}
