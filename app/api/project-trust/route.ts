import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { clearWorktreeTrust, getProjectTrustDetails, setProjectTrust } from "@/lib/project-trust";
import { trustedGitRepository } from "@/lib/project-trust-repository";
import { destroyRpcSessionsInWorktrees, hasBusyRpcSessionWithin } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

async function validateCwd(value: unknown): Promise<
  { cwd: string } | { response: NextResponse }
> {
  if (typeof value !== "string" || !value.trim()) {
    return { response: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  }

  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return { response: NextResponse.json({ error: "cwd must be a directory" }, { status: 400 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: "Directory does not exist" }, { status: 400 }) };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  return NextResponse.json(getProjectTrustDetails(result.cwd, getAgentDir()));
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { cwd?: unknown; scope?: unknown; action?: unknown };
    if (body.scope !== undefined && body.scope !== "worktree" && body.scope !== "repository") {
      return NextResponse.json({ error: "Invalid trust scope" }, { status: 400 });
    }
    if (body.action !== undefined && body.action !== "trust" && body.action !== "revoke" && body.action !== "clear") {
      return NextResponse.json({ error: "Invalid trust action" }, { status: 400 });
    }
    const scope = body.scope ?? "worktree";
    const action = body.action ?? "trust";
    if (scope === "repository" && action === "clear") return NextResponse.json({ error: "Invalid trust action" }, { status: 400 });
    const result = await validateCwd(body.cwd);
    if ("response" in result) return result.response;
    const agentDir = getAgentDir();
    const repository = trustedGitRepository(result.cwd);
    if (scope === "repository" && !repository) {
      return NextResponse.json({ error: "Select a registered Git checkout for project-wide trust" }, { status: 409 });
    }
    const current = getProjectTrustDetails(result.cwd, agentDir);
    if (action === "trust" && scope === "worktree" && !current.requiresTrust && !current.checkoutRoot) {
      return NextResponse.json({ error: "This directory has no resources that require trust" }, { status: 409 });
    }
    const worktreeCwd = repository?.checkout ?? result.cwd;
    const affected = scope === "repository" ? repository!.worktrees : [worktreeCwd];
    if (affected.some(hasBusyRpcSessionWithin)) {
      return NextResponse.json({ error: "Wait for active sessions in the affected checkout(s) to finish before changing trust" }, { status: 409 });
    }
    // No await between the last busy check and the persisted decision. Every loader
    // resolves the effective decision again on startup/reload.
    if (action === "clear") clearWorktreeTrust(worktreeCwd, agentDir);
    else setProjectTrust(scope === "worktree" ? worktreeCwd : result.cwd, agentDir, scope as "worktree" | "repository", action === "trust");
    invalidateModelsCache();
    await destroyRpcSessionsInWorktrees(affected);
    return NextResponse.json(getProjectTrustDetails(result.cwd, agentDir));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
