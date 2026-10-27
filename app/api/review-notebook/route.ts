import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { NotebookReadError, readNotebook, readNotebookBinary, readNotebookText } from "@/lib/guided-review-server";
import { isReviewSourcePath } from "@/lib/review-notebook";
import { isNotebookAssetPath, notebookAssetMime } from "@/lib/guided-review-assets";

export const dynamic = "force-dynamic";
/** GET only; no discovery, writes, root additions or session-reference transitive grants. */
export async function GET(request: NextRequest) {
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
  if (!isApiRequestAllowed(request)) return fail("Untrusted API request", 403);
  const p = request.nextUrl.searchParams, index = p.get("index") ?? "";
  const keys = p.has("asset") ? ["index", "asset"] : ["index"];
  if (p.size !== keys.length || keys.some(k => !p.has(k)) || !path.isAbsolute(index)) return fail("Invalid notebook request", 400);
  try {
    const roots = await getAllowedFileRoots();
    if (p.has("asset")) {
      const asset = p.get("asset")!;
      if (!isReviewSourcePath(asset) || !isNotebookAssetPath(asset)) return fail("Unsupported local evidence format", 400);
      // The manifest identifies presentation, never authority over this sibling.
      if (notebookAssetMime(asset)) {
        const { bytes, mime } = readNotebookBinary(path.join(path.dirname(index), asset), roots, path.dirname(index));
        return new NextResponse(new Uint8Array(bytes), { headers: {
          "Content-Type": mime, "Content-Length": String(bytes.length), "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
          "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
        } });
      }
      return NextResponse.json({ content: readNotebookText(path.join(path.dirname(index), asset), roots, path.dirname(index)), mutable: true });
    }
    return NextResponse.json(readNotebook(index, roots));
  } catch (error) {
    if (error instanceof NotebookReadError) return fail(error.message, error.status);
    return fail(error instanceof Error && !('code' in error) ? error.message : "Notebook unavailable (missing or unsafe file)", 400);
  }
}
