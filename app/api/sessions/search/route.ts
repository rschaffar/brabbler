import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";
import { sessionFamiliesForWorktree } from "@/lib/session-worktree-filter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const projectKey = params.get("projectKey");
  const scope = params.get("scope");
  const status = params.get("status");
  const field = params.get("field") ?? "all";
  const cwd = params.get("cwd");
  const headers = { "Cache-Control": "no-store" };
  if (query.length > 200 || !["active", "archived", "both"].includes(status ?? "")
    || (scope !== "all" && (!projectKey || scope !== null))
    || (scope === "all" && projectKey !== null)
    || !["all", "title"].includes(field)
    || (cwd !== null && (!cwd || cwd.length > 16_384 || cwd.includes("\0")))
    || params.has("includeArchived")) {
    return NextResponse.json({ error: "Invalid search query or scope" }, { status: 400, headers });
  }
  try {
    // Same exact-directory and child-only filtering as the Sidebar. A cwd is a
    // catalogue filter, never a filesystem grant or a fallback to global scope.
    const catalog = query && !request.signal.aborted ? await listAllSessions() : [];
    const families = sessionFamiliesForWorktree(catalog, scope === "all" ? null : projectKey!, cwd,
      status as "active" | "archived" | "both");
    const sessions = families.flatMap((family) => [family.root, ...family.subagents]);
    const archiveById = new Map(families.flatMap((family) => [family.root, ...family.subagents]
      .map((session) => [session.id, family.familyArchived] as const)));
    const result = await searchSessionContents(sessions, query, request.signal, { titlesOnly: field === "title" });
    return NextResponse.json({ ...result, results: result.results.map((hit) => ({
      ...hit, familyArchived: archiveById.get(hit.session.id),
    })) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers });
  }
}
