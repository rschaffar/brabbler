import { NextResponse } from "next/server";
import { resolveSessionPath, openSessionManager, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const ancestorId = url.searchParams.get("ancestorId");
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  // `tail` caps the ancestor chain returned (default 50); `before` rewinds the
  // walk start to an older entry so the client can page upward without
  // re-fetching the whole active branch.
  const rawTail = Number(url.searchParams.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  const before = url.searchParams.get("before") ?? undefined;

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let sm = liveRpc?.inner.sessionManager ?? openSessionManager(filePath!);
    // Restore can append while startup is still opening the old file, before
    // its wrapper enters the registry. A reconnect anchored to the saved marker
    // must not read that stale index (or let a later prompt overwrite the marker).
    // Probe only a missing anchor, never ordinary reads or sibling navigation;
    // evictIfDiskAhead proves disk advancement and refuses active wrappers.
    if (ancestorId && liveRpc && !sm.getEntry(ancestorId) && liveRpc.evictIfDiskAhead()) {
      const freshPath = await resolveSessionPath(id);
      if (!freshPath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      sm = openSessionManager(freshPath);
    }
    // Receipt reconnects may follow a growing branch, but never a different
    // browser's navigation to a sibling branch. Check the full raw ancestry,
    // not the bounded visible page (which may no longer contain the anchor).
    const contextLeafId = before ?? leafId ?? (ancestorId ? sm.getLeafId() : undefined);
    if (ancestorId && !sm.getBranch(contextLeafId ?? undefined).some((entry) => entry.id === ancestorId)) {
      return NextResponse.json({ error: "Branch changed" }, { status: 409 });
    }
    // `before` is the oldest entry already on the client; fetch its ancestors
    // only (excludeLeaf) so prepending the page does not duplicate `before`.
    const context = buildSessionContext(sm.getEntries() as never, contextLeafId, {
      deferThinking,
      deferToolResultImages,
      tail,
      excludeLeaf: Boolean(before),
      sessionId: id,
    });

    return NextResponse.json({ context, tail, before: before ?? null });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
