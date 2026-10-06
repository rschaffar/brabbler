import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";
import { listSessionFamilies } from "@/lib/session-family";
import { sessionsForProject } from "@/lib/project-groups";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const projectKey = params.get("projectKey");
  const scope = params.get("scope");
  const status = params.get("status");
  const field = params.get("field") ?? "all";
  const headers = { "Cache-Control": "no-store" };
  if (query.length > 200 || !["active", "archived", "both"].includes(status ?? "")
    || (scope !== "all" && (!projectKey || scope !== null))
    || (scope === "all" && projectKey !== null)
    || !["all", "title"].includes(field)
    || params.has("includeArchived")) {
    return NextResponse.json({ error: "Invalid search query or scope" }, { status: 400, headers });
  }
  try {
    // Match the sidebar: select project members before grouping families, then
    // filter by the root's archive state. Never fall back to global on a bad key.
    const catalog = query && !request.signal.aborted ? await listAllSessions() : [];
    const scoped = scope === "all" ? catalog : sessionsForProject(catalog, projectKey!);
    const families = listSessionFamilies(scoped)
      .filter((family) => status === "both" || Boolean(family.root.archived) === (status === "archived"));
    const sessions = families.flatMap((family) => [family.root, ...family.subagents]);
    const archiveById = new Map(families.flatMap((family) => [family.root, ...family.subagents]
      .map((session) => [session.id, Boolean(family.root.archived)] as const)));
    const result = await searchSessionContents(sessions, query, request.signal, { titlesOnly: field === "title" });
    return NextResponse.json({ ...result, results: result.results.map((hit) => ({
      ...hit, familyArchived: archiveById.get(hit.session.id),
    })) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers });
  }
}
