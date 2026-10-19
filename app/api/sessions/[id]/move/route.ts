import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { moveSessionFamily, SessionMoveConflict } from "@/lib/session-move";
import { resolveSessionPath, readSessionHeader } from "@/lib/session-reader";
import { listWorktrees, resolveProject } from "@/lib/worktree";
import { samePath } from "@/lib/paths";
import { projectIdentityKey } from "@/lib/project-identity";

// POST /api/sessions/[id]/move  body: { cwd: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json() as { cwd?: unknown };
    const input = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!input) return NextResponse.json({ error: "Destination directory is required" }, { status: 400 });
    const cwd = resolve(input === "~" ? homedir() : input.startsWith("~/") ? resolve(homedir(), input.slice(2)) : input);
    if (!isAbsolute(cwd) || !statSync(cwd).isDirectory()) {
      return NextResponse.json({ error: "Destination must be an existing directory" }, { status: 400 });
    }
    const source = await resolveSessionPath(id);
    if (!source) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const header = readSessionHeader(source);
    if (!header?.cwd) return NextResponse.json({ error: "Session is not persisted" }, { status: 409 });
    // The transcript outlives its checkout. Only a genuinely missing source
    // bypasses source registration checks; permission/I/O failures still fail.
    let sourceMissing = false;
    try { statSync(header.cwd); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      sourceMissing = true;
    }
    const [from, to] = await Promise.all([resolveProject(header.cwd), resolveProject(cwd)]);
    // Recovered grouping can still identify same-repository destinations after
    // removal, but must never require the vanished checkout to be registered.
    const sourceWorktrees = await listWorktrees(sourceMissing ? from.projectRoot : header.cwd).catch(() => []);
    const destinationWorktrees = await listWorktrees(cwd).catch(() => []);
    // Subdirectories are distinct Pi Web project groups, but not distinct Git
    // repositories. Treat them as same-repository for this worktree-only action.
    const sameGitRepo = sourceWorktrees.some((source) =>
      destinationWorktrees.some((destination) => samePath(source.path, destination.path)));
    if (sameGitRepo || projectIdentityKey(from.projectRoot) === projectIdentityKey(to.projectRoot)) {
      if ((!sourceMissing && !from.isTopLevel) || !to.isTopLevel || samePath(header.cwd, cwd)) {
        return NextResponse.json({ error: "Choose another worktree or project" }, { status: 409 });
      }
      if ((!sourceMissing && !sourceWorktrees.some((item) => samePath(item.path, header.cwd)))
        || !destinationWorktrees.some((item) => samePath(item.path, cwd))) {
        return NextResponse.json({ error: "Choose a registered worktree" }, { status: 409 });
      }
    }
    return NextResponse.json({ ok: true, ...(await moveSessionFamily(id, cwd)) });
  } catch (error) {
    if (error instanceof SessionMoveConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Directory or session does not exist" }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
