import { statSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { explorerCompare, explorerCompareFile, explorerCommit, explorerFileContext, explorerLog, explorerPatch, explorerSource, GitExplorerError } from "@/lib/git-explorer";
import { DiffContextError } from "@/lib/git-file-context";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cwd = params.get("cwd") ?? "";
  const op = params.get("op");
  const fields = op === "compare" ? ["cwd", "op", "head", "base", "candidate", "branch"]
    : op === "compare-patch" || op === "compare-context" ? ["cwd", "op", "head", "base", "candidate", "branch", "identity", "path"]
    : op === "log" ? ["cwd", "op", ...(params.has("skip") ? ["skip"] : []), ...(params.has("head") ? ["head"] : []), ...(params.has("branch") ? ["branch"] : [])]
    : op === "commit" ? ["cwd", "op", "head", "oid", ...(params.has("branch") ? ["branch"] : [])]
    : op === "patch" || op === "context" ? ["cwd", "op", "head", "oid", "path", ...(params.has("branch") ? ["branch"] : [])]
    : op === "source" ? ["cwd", "op", "head", "oid", "path", "start", "end", ...(params.has("branch") ? ["branch"] : [])] : [];
  if (!fields.length || params.size !== fields.length || fields.some((field) => !params.has(field)) ||
    !cwd || (params.has("branch") && !params.get("branch")) ||
    (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) return failure("Invalid Git Explorer request", 400);
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots)) return failure("Access denied", 403);
  try {
    if (!statSync(cwd).isDirectory()) return failure("Not a directory", 400);
  } catch { return failure("Directory not found", 404); }
  if (!isExistingFilePathAllowed(cwd, roots)) return failure("Access denied", 403);
  try {
    if (op === "log") {
      const rawSkip = params.get("skip");
      if (rawSkip !== null && !/^(?:0|[1-9]\d*)$/.test(rawSkip)) return failure("Invalid history page", 400);
      const expectedHead = params.get("head") ?? undefined;
      return NextResponse.json(await explorerLog(cwd, rawSkip === null ? 0 : Number(rawSkip), expectedHead, params.get("branch") ?? undefined));
    }
    const head = params.get("head") ?? "";
    if (op === "compare") return NextResponse.json(await explorerCompare(cwd, head, params.get("base")!, params.get("candidate")!, params.get("branch")!));
    if (op === "compare-patch" || op === "compare-context") return NextResponse.json(await explorerCompareFile(cwd, head, params.get("base")!, params.get("candidate")!, params.get("branch")!, params.get("identity")!, params.get("path")!, op === "compare-context"));
    const oid = params.get("oid") ?? "";
    if (op === "source") {
      const start = params.get("start") ?? "", end = params.get("end") ?? "";
      if (!/^[1-9]\d*$/.test(start) || !/^[1-9]\d*$/.test(end)) return failure("Invalid source range", 400);
      return NextResponse.json(await explorerSource(cwd, head, oid, params.get("path") ?? "", Number(start), Number(end), params.get("branch") ?? undefined));
    }
    if (op === "commit") return NextResponse.json(await explorerCommit(cwd, head, oid, params.get("branch") ?? undefined));
    if (op === "patch") return NextResponse.json(await explorerPatch(cwd, head, oid, params.get("path") ?? "", params.get("branch") ?? undefined));
    if (op === "context") return NextResponse.json(await explorerFileContext(cwd, head, oid, params.get("path") ?? "", params.get("branch") ?? undefined));
    return failure("Invalid Git Explorer request", 400);
  } catch (error) {
    if (error instanceof DiffContextError) return failure(error.message, error.status);
    if (error instanceof GitExplorerError) {
      const status = { INVALID: 400, STALE: 409, NOT_FOUND: 404, TOO_LARGE: 413, UNAVAILABLE: 409 }[error.code];
      return failure(error.message, status);
    }
    return failure("Git history is unavailable", 409);
  }
}
