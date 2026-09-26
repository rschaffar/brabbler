import { statSync } from "node:fs";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { confirmGitCommit, prepareGitCommit, type GitCommitPreview } from "@/lib/git-commit";
import { acquireGitCheckoutGate, isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { getGitCommitTreeOid, getGitTreeDiff, GitReviewError, GIT_REVIEW_DIFF_MAX_BYTES } from "@/lib/git-review";
import { samePath } from "@/lib/paths";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Never accept a caller's cwd as the authority for a browser commit. */
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request", 400);
    const input = body as Record<string, unknown>;
    const id = input.sessionId;
    if (typeof id !== "string" || !id.trim() || id !== id.trim()) return error("Valid sessionId required", 400);
    if (Object.hasOwn(input, "cwd")) return error("cwd is derived from the session", 400);
    const file = await resolveSessionPath(id);
    if (!file) return error("Session not found", 404);
    const header = readSessionHeader(file);
    if (!header || header.id !== id || typeof header.cwd !== "string" || !header.cwd) {
      return error("Session identity mismatch", 409);
    }
    const cwd = header.cwd;
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, roots)) return error("Access denied", 403);
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(cwd); }
    catch { return error("Directory not found", 404); }
    if (!stat.isDirectory()) return error("Not a directory", 400);
    if (!isExistingFilePathAllowed(cwd, roots)) return error("Access denied", 403);
    if (isGitCheckoutGated(cwd)) return error("Checkout is busy with a Git transaction", 409);
    const live = getRpcSession(id);
    if (live?.isRunning()) return error("Stop the session before committing", 409);
    if (input.operation === "preview") {
      if (!Array.isArray(input.paths) || !input.paths.length || !input.paths.every((p) => typeof p === "string")) {
        return error("Select paths to commit", 400);
      }
      const preview = await prepareGitCommit(cwd, input.paths);
      // Both OIDs come from the server's prepared snapshot, never the request body.
      const headTree = await getGitCommitTreeOid(cwd, preview.head);
      let candidateDiff;
      let candidateDiffUnavailable;
      try {
        candidateDiff = await getGitTreeDiff(cwd, headTree, preview.tree);
      } catch (cause) {
        if (!(cause instanceof GitReviewError) || cause.code !== "DIFF_TOO_LARGE") throw cause;
        candidateDiffUnavailable = `Candidate patch exceeds the ${GIT_REVIEW_DIFF_MAX_BYTES / (1024 * 1024)} MB limit; review the whole-file candidate tree before confirming.`;
      }
      if (live?.isRunning()) return error("Stop the session before committing", 409);
      return NextResponse.json({ preview, ...(candidateDiff ? { candidateDiff } : { candidateDiffUnavailable }) });
    }
    if (input.operation === "confirm") {
      const preview = input.preview as GitCommitPreview | undefined;
      if (!preview || typeof preview !== "object" || Array.isArray(preview) ||
        typeof preview.repositoryRoot !== "string" || !samePath(preview.repositoryRoot, cwd) ||
        typeof preview.reviewToken !== "string" || typeof preview.tree !== "string" ||
        typeof preview.branch !== "string" || typeof preview.head !== "string" ||
        !Array.isArray(preview.paths) || !preview.paths.every((p) => typeof p === "string") ||
        typeof input.message !== "string") return error("Invalid or mismatched preview", 409);
      // Reserve this checkout against Pi Web prompts, session moves, and local
      // integration while the reviewed commit is confirmed. The library still
      // re-derives the whole snapshot and authenticates the token.
      const release = acquireGitCheckoutGate([cwd]);
      try {
        if (live?.isRunning()) return error("Stop the session before committing", 409);
        const result = await confirmGitCommit({ ...preview, repositoryRoot: cwd }, input.message);
        return NextResponse.json(result);
      } finally { release(); }
    }
    return error("Unknown commit operation", 400);
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("Invalid JSON", 400);
    // Git stderr and subprocess errors may contain remote credentials or config values.
    return error("Commit unavailable or preview stale; refresh the preview", 409);
  }
}
