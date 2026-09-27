import { statSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { explorerCommit, explorerLog, explorerPatch, GitExplorerError } from "@/lib/git-explorer";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cwd = params.get("cwd") ?? "";
  const op = params.get("op");
  const fields = op === "log" ? ["cwd", "op", ...(params.has("skip") ? ["skip"] : []), ...(params.has("head") ? ["head"] : [])]
    : op === "commit" ? ["cwd", "op", "head", "oid"]
    : op === "patch" ? ["cwd", "op", "head", "oid", "path"] : [];
  if (!fields.length || params.size !== fields.length || fields.some((field) => !params.has(field)) ||
    !cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) return failure("Invalid Git Explorer request", 400);
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
      return NextResponse.json(await explorerLog(cwd, rawSkip === null ? 0 : Number(rawSkip), expectedHead));
    }
    const head = params.get("head") ?? "";
    const oid = params.get("oid") ?? "";
    if (op === "commit") return NextResponse.json(await explorerCommit(cwd, head, oid));
    if (op === "patch") return NextResponse.json(await explorerPatch(cwd, head, oid, params.get("path") ?? ""));
    return failure("Invalid Git Explorer request", 400);
  } catch (error) {
    if (error instanceof GitExplorerError) {
      const status = { INVALID: 400, STALE: 409, NOT_FOUND: 404, TOO_LARGE: 413, UNAVAILABLE: 409 }[error.code];
      return failure(error.message, status);
    }
    return failure("Git history is unavailable", 409);
  }
}
