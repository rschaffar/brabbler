import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { addWorktree, findCurrentWorktreePath, listLocalBranchTips, listMergedWorktreeBranches, listWorktrees, removeWorktree, resolveProject, WorktreeMutationError } from "@/lib/worktree";
import { allowFileRoot, getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";

/** Standalone worktree management shares the file browser's allowed roots.
 * Explicit base/tip and removal consent do not depend on chat or Workflow data. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}
function assertAccess(req: Request, cwd: string) {
  req.signal.throwIfAborted();
  const roots = getKnownAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) throw new Error("Access denied");
}

export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;
    const project = await resolveProject(cwd);
    let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
    let localBranches: Awaited<ReturnType<typeof listLocalBranchTips>> = [];
    let currentWorktreePath: string | null = null;
    let isGit = true;
    try {
      const gitCwd = existsSync(cwd) ? cwd : project.projectRoot;
      worktrees = await listWorktrees(gitCwd);
      const mergedBranches = await listMergedWorktreeBranches(gitCwd);
      worktrees = worktrees.map((w) => ({ ...w, isMerged: !w.isMain && w.branch !== null && mergedBranches.has(w.branch) }));
      localBranches = await listLocalBranchTips(gitCwd);
      currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
    } catch { isGit = false; }
    for (const w of worktrees) allowFileRoot(w.path);
    return NextResponse.json({ projectRoot: project.projectRoot, projectKey: projectIdentityKey(project.projectRoot),
      isGit, isTopLevel: project.isTopLevel, currentWorktreePath, worktrees, localBranches });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 500 }); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; branch?: string; baseBranch?: string; expectedBaseOid?: string; mode?: string; expectedTipOid?: string };
    if (!body.cwd || typeof body.cwd !== "string") return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!body.branch || typeof body.branch !== "string") return NextResponse.json({ error: "branch is required" }, { status: 400 });
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    if (!existsSync(body.cwd)) return NextResponse.json({ error: `Directory does not exist: ${body.cwd}` }, { status: 400 });
    if (typeof body.baseBranch !== "string" || typeof body.expectedBaseOid !== "string") {
      return NextResponse.json({ error: "Explicit local base branch and full expected HEAD are required" }, { status: 400 });
    }
    if (body.mode !== "create" && body.mode !== "attach") return NextResponse.json({ error: "Select create or attach explicitly" }, { status: 400 });
    if (body.mode === "attach" && typeof body.expectedTipOid !== "string") return NextResponse.json({ error: "Full expected branch tip is required for attach" }, { status: 400 });
    if (!(await resolveProject(body.cwd)).isTopLevel) return NextResponse.json({ error: "Git checkout root required" }, { status: 409 });
    const assertCurrentSync = () => assertAccess(req, body.cwd!);
    const beforeCreate = async () => {
      const denied = await checkCwdAllowed(body.cwd!);
      if (denied) throw new Error("Access denied");
      assertCurrentSync();
    };
    const result = await addWorktree(body.cwd, body.mode === "attach"
      ? { branch: body.branch, baseBranch: body.baseBranch, expectedBaseOid: body.expectedBaseOid, mode: "attach", expectedTipOid: body.expectedTipOid!, beforeCreate, assertCurrentSync }
      : { branch: body.branch, baseBranch: body.baseBranch, expectedBaseOid: body.expectedBaseOid, mode: "create", beforeCreate, assertCurrentSync });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error),
      ...(error instanceof WorktreeMutationError ? { effects: error.effects, recoveryRequired: true } : {}) },
    { status: error instanceof WorktreeMutationError ? 409 : 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; path?: string; force?: boolean };
    if (!body.cwd || typeof body.cwd !== "string") return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!body.path || typeof body.path !== "string") return NextResponse.json({ error: "path is required" }, { status: 400 });
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    if (!(await resolveProject(body.cwd)).isTopLevel) return NextResponse.json({ error: "Git checkout root required" }, { status: 409 });
    const assertCurrentSync = () => assertAccess(req, body.cwd!);
    const beforeRemove = async () => {
      const denied = await checkCwdAllowed(body.cwd!);
      if (denied) throw new Error("Access denied");
      assertCurrentSync();
    };
    await removeWorktree(body.cwd, body.path, body.force === true, { beforeRemove, assertCurrentSync });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const dirty = /contains modified or untracked files|is dirty/i.test(message);
    return NextResponse.json({ error: message, dirty,
      ...(error instanceof WorktreeMutationError ? { effects: error.effects, recoveryRequired: true } : {}) },
    { status: dirty || error instanceof WorktreeMutationError ? 409 : 400 });
  }
}
