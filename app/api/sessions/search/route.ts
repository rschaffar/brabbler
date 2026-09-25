import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";
import { listSessionFamilies } from "@/lib/session-family";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const headers = { "Cache-Control": "no-store" };
  if (query.length > 200) {
    return NextResponse.json({ error: "Search query exceeds 200 characters" }, { status: 400, headers });
  }
  try {
    // Use an up-to-date catalogue so a just-archived family cannot appear in
    // search results from the stale list cache.
    const catalog = query && !request.signal.aborted ? await listAllSessions() : [];
    const sessions = listSessionFamilies(catalog)
      .filter((family) => !family.root.archived)
      .flatMap((family) => [family.root, ...family.subagents]);
    return NextResponse.json(await searchSessionContents(sessions, query, request.signal), { headers });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers });
  }
}
