import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listMcpConfiguration } from "@/lib/native-mcp-configuration";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { getRpcSession } from "@/lib/rpc-manager";
import { samePath } from "@/lib/paths";

export const dynamic = "force-dynamic";
/** Catalogue reads never create/reopen a wrapper, connect a server, load a
 * credential backend or renew a session. Live status is metadata only. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams, requested = params.get("cwd");
  if (!requested?.trim()) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  const cwd = resolve(requested);
  try {
    if (!(await stat(cwd)).isDirectory()) return NextResponse.json({ error: "cwd must be a directory" }, { status: 400 });
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const sessionId = params.get("sessionId"), candidate = sessionId ? getRpcSession(sessionId) : undefined;
    const live = candidate?.isAlive() ? candidate : undefined;
    if (live && !samePath(live.cwd, cwd)) return NextResponse.json({ error: "Session directory changed" }, { status: 409 });
    const agentDir = getAgentDir();
    const configuration = await listMcpConfiguration({ agentDir, cwd, projectTrusted: getProjectTrustStatus(cwd, agentDir).trusted });
    const state = live ? await live.send({ type: "get_state" }) as Record<string, unknown> : undefined;
    return NextResponse.json({ configuration, ...(state ? { live: {
      nativeResources: state.nativeResources, effectiveNativeResources: state.effectiveNativeResources, mcpServers: state.mcpServers,
    } } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Native tool metadata is unavailable" }, { status: 500 }); }
}
