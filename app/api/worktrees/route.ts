import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { addWorktree, findCurrentWorktreePath, listLocalBranchTips, listMergedWorktreeBranches, listWorktrees, removeWorktree, resolveProject } from "@/lib/worktree";
import { allowFileRoot, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";
import { acquireGitCheckoutGate, isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { assertManagedGitAction } from "@/lib/git-workflow-access";

/** Same gate as /api/files: only session cwds / project roots / explicitly
 *  allowed dirs may be inspected or mutated through this endpoint. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

// GET /api/worktrees?cwd=  →  { projectRoot, projectKey, isGit, isTopLevel, currentWorktreePath, worktrees, localBranches }
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const project = await resolveProject(cwd);
    let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
    let localBranches: Awaited<ReturnType<typeof listLocalBranchTips>> = [];
    let currentWorktreePath: string | null = null;
    let isGit = true;
    try {
      // For a removed-worktree cwd (session of a deleted worktree), fall back
      // to the inferred project root so the switcher still shows the project.
      const gitCwd = existsSync(cwd) ? cwd : project.projectRoot;
      worktrees = await listWorktrees(gitCwd);
      const mergedBranches = await listMergedWorktreeBranches(gitCwd);
      worktrees = worktrees.map((worktree) => ({
        ...worktree,
        isMerged: !worktree.isMain && worktree.branch !== null && mergedBranches.has(worktree.branch),
      }));
      localBranches = await listLocalBranchTips(gitCwd);
      currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
    } catch {
      isGit = false;
    }
    // Every listed path is a git-verified worktree of this project; allow the
    // file explorer to browse them even before they have any session (the
    // in-memory allowlist from addWorktree does not survive server restarts).
    for (const w of worktrees) allowFileRoot(w.path);
    return NextResponse.json({
      projectRoot: project.projectRoot,
      projectKey: projectIdentityKey(project.projectRoot),
      isGit,
      isTopLevel: project.isTopLevel,
      currentWorktreePath,
      worktrees,
      localBranches,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/worktrees  body: { cwd, branch, baseBranch, expectedBaseOid, mode, expectedTipOid? }
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; branch?: string; baseBranch?: string; expectedBaseOid?: string; mode?: string; expectedTipOid?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.branch || typeof body.branch !== "string") {
      return NextResponse.json({ error: "branch is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    if (isGitCheckoutGated(body.cwd)) return NextResponse.json({ error: "Checkout is being integrated" }, { status: 409 });
    if (!existsSync(body.cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${body.cwd}` }, { status: 400 });
    }

    if (typeof body.baseBranch !== "string" || typeof body.expectedBaseOid !== "string") {
      return NextResponse.json({ error: "Explicit local base branch and full expected HEAD are required" }, { status: 400 });
    }
    if (body.mode !== "create" && body.mode !== "attach") {
      return NextResponse.json({ error: "Select create or attach explicitly" }, { status: 400 });
    }
    if (body.mode === "attach" && typeof body.expectedTipOid !== "string") {
      return NextResponse.json({ error: "Full expected branch tip is required for attach" }, { status: 400 });
    }
    const release = acquireGitCheckoutGate([body.cwd]);
    try {
      // Git accepts a subdirectory here, but workflow project identity does
      // not. Never authorize /repo/subdir and then mutate /repo instead.
      if (!(await resolveProject(body.cwd)).isTopLevel) return NextResponse.json({ error: "Git checkout root required" }, { status: 409 });
      await assertManagedGitAction(body.cwd, [], "workspace", "human");
      const result = await addWorktree(body.cwd, body.mode === "attach"
        ? { branch: body.branch, baseBranch: body.baseBranch, expectedBaseOid: body.expectedBaseOid, mode: "attach", expectedTipOid: body.expectedTipOid! }
        : { branch: body.branch, baseBranch: body.baseBranch, expectedBaseOid: body.expectedBaseOid, mode: "create" });
      return NextResponse.json(result);
    } finally { release(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE /api/worktrees  body: { cwd, path, force? }
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; path?: string; force?: boolean };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.path || typeof body.path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    if (isGitCheckoutGated(body.cwd) || isGitCheckoutGated(body.path)) {
      return NextResponse.json({ error: "Checkout is being integrated" }, { status: 409 });
    }

    const release = acquireGitCheckoutGate([body.cwd, body.path]);
    try {
      if (!(await resolveProject(body.cwd)).isTopLevel) return NextResponse.json({ error: "Git checkout root required" }, { status: 409 });
      await assertManagedGitAction(body.cwd, [], "settings", "human");
      await removeWorktree(body.cwd, body.path, body.force === true);
      return NextResponse.json({ success: true });
    } finally { release(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // git refuses to remove dirty worktrees without --force; surface that so
    // the UI can offer a force-remove confirmation.
    const dirty = /contains modified or untracked files|is dirty/i.test(message);
    return NextResponse.json({ error: message, dirty }, { status: dirty ? 409 : 400 });
  }
}
