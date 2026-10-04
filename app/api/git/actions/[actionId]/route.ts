import { NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { readGitAction, readLiveGitAction } from "@/lib/git-action-journal";
import { GIT_ACTION_ANCHOR_TYPE, GIT_ACTION_ID_PATTERN, isGitActionAnchor } from "@/lib/git-action-types";
import { AgentSessionWrapper, getRpcSession } from "@/lib/rpc-manager";
import { openSessionManager, readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Bounded read only: an original pending RPC question or a saved history anchor.
 * Neither association grants an executable capability or reconstructs controls. */
export async function GET(req: Request, context: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await context.params;
  const query = new URL(req.url).searchParams;
  const sessionId = query.get("sessionId");
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!GIT_ACTION_ID_PATTERN.test(actionId) || !sessionId || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)
    || [...query.keys()].some((key) => !["sessionId", "includeArtifact"].includes(key))
    || (query.has("includeArtifact") && query.get("includeArtifact") !== "1")) return json({ error: "Invalid action history request" }, 400);
  try {
    const live = getRpcSession(sessionId);
    // Capture ONCE, before session discovery/access awaits; never rebase onto a
    // replacement question with the same action ID after those awaits.
    const pending = live instanceof AgentSessionWrapper ? live.capturePendingGitActionRead(actionId) : undefined;
    const file = live?.isAlive() ? live.sessionFile : await resolveSessionPath(sessionId);
    if (!file) return json({ error: "Session not found" }, 404);
    const manager = live?.isAlive() ? live.inner.sessionManager : openSessionManager(file);
    const header = manager.getHeader();
    if (!header || header.id !== sessionId || typeof header.cwd !== "string"
      || manager.getSessionId() !== sessionId || manager.getSessionFile() !== file || manager.getCwd() !== header.cwd
      || readSessionHeader(file)?.id !== sessionId || readSessionHeader(file)?.cwd !== header.cwd) return json({ error: "Session identity mismatch" }, 409);
    const ownerHeader = JSON.stringify(header), ownerCwd = header.cwd;
    // Historical artifacts do not require the old checkout/branch to exist. The
    // referring session still must be in this server's allowed workspace roots.
    if (!isFilePathAllowed(ownerCwd, await getAllowedFileRoots())) return json({ error: "Access denied" }, 403);
    if (JSON.stringify(manager.getHeader()) !== ownerHeader || manager.getSessionId() !== sessionId
      || manager.getSessionFile() !== file || manager.getCwd() !== ownerCwd
      || readSessionHeader(file)?.id !== sessionId || readSessionHeader(file)?.cwd !== ownerCwd) return json({ error: "Session identity mismatch" }, 409);
    if (pending) {
      const original = live!.readPendingGitActionRead(pending);
      if (!original || original.sessionFile !== file || original.cwd !== ownerCwd) return json({ error: "Pending Git action unavailable" }, 404);
      const snapshot = readLiveGitAction(sessionId, actionId, { includeArtifact: query.get("includeArtifact") === "1" });
      if (!snapshot?.record || snapshot.record.kind !== original.kind
        || !["proposed", "awaiting-decision"].includes(snapshot.record.state)
        || snapshot.candidate && snapshot.candidate.kind !== original.kind
        || !live!.readPendingGitActionRead(pending)) return json({ error: "Pending Git action unavailable" }, 404);
      return json(snapshot);
    }
    const anchored = (manager.getEntries() as SessionEntry[]).some((entry) => entry.type === "custom"
      && entry.customType === GIT_ACTION_ANCHOR_TYPE && isGitActionAnchor(entry.data) && entry.data.actionId === actionId);
    if (!anchored) return json({ error: "Action not referenced by this session" }, 404);
    return json(await readGitAction(actionId, { includeArtifact: query.get("includeArtifact") === "1" }));
  } catch {
    // Paths, patches and storage diagnostics must not leak through errors.
    return json({ record: null, unavailable: "Saved Git action history is unavailable." });
  }
}
