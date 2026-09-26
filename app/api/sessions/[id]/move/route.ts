import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { moveSessionFamily, SessionMoveConflict } from "@/lib/session-move";
import { resolveSessionPath, readSessionHeader } from "@/lib/session-reader";
import { resolveProject } from "@/lib/worktree";
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
    const [from, to] = await Promise.all([resolveProject(header.cwd), resolveProject(cwd)]);
    if (projectIdentityKey(from.projectRoot) === projectIdentityKey(to.projectRoot)) {
      return NextResponse.json({ error: "Choose another project" }, { status: 409 });
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
