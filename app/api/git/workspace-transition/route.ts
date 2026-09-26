import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { readGitWorkspaceTransitionStatus } from "@/lib/git-workspace-transition";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { samePath } from "@/lib/paths";

export const dynamic = "force-dynamic";
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only outcome of an explicitly invoked git_workspace_start operation. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sessionId = params.get("sessionId");
  if ([...params.keys()].length !== 1 || !sessionId || !SESSION_ID.test(sessionId)) {
    return NextResponse.json({ error: "Valid sessionId required" }, { status: 400 });
  }
  try {
    const file = await resolveSessionPath(sessionId);
    const header = file && readSessionHeader(file);
    if (!file || !header || header.id !== sessionId || !header.cwd) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(header.cwd, roots)) {
      return NextResponse.json({ error: "Checkout not allowed" }, { status: 403 });
    }
    const transition = await readGitWorkspaceTransitionStatus(sessionId);
    if (transition && !samePath(header.cwd, transition.sourceCwd) && !samePath(header.cwd, transition.destinationPath)) {
      return NextResponse.json({ error: "Session checkout changed; inspect manually" }, { status: 409 });
    }
    return NextResponse.json({ transition: transition ?? null });
  } catch {
    return NextResponse.json({ error: "Workspace transition status unavailable" }, { status: 409 });
  }
}
