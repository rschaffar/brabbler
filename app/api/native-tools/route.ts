import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listMcpConfiguration } from "@/lib/native-mcp-configuration";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { getRpcSession } from "@/lib/rpc-manager";
import { samePath } from "@/lib/paths";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { validateNativeResourceSelection } from "@/lib/session-native-resources";
import { ProjectNativeResourcesConflict, readProjectNativeResources, saveProjectNativeResources } from "@/lib/project-native-resources";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
async function authorizedDirectory(value: unknown): Promise<{ cwd: string } | { response: NextResponse }> {
  if (typeof value !== "string" || !value.trim()) return { response: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) return { response: NextResponse.json({ error: "cwd must be a directory" }, { status: 400 }) };
  } catch { return { response: NextResponse.json({ error: "Directory does not exist" }, { status: 400 }) }; }
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  return { cwd };
}

/** Catalogue/default reads never create/reopen a wrapper, connect a server,
 * initialize a repository identity or renew a session. Live status is metadata. */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const checked = await authorizedDirectory(params.get("cwd"));
    if ("response" in checked) return checked.response;
    const { cwd } = checked;
    const sessionId = params.get("sessionId"), candidate = sessionId ? getRpcSession(sessionId) : undefined;
    const live = candidate?.isAlive() ? candidate : undefined;
    if (live && !samePath(live.cwd, cwd)) return NextResponse.json({ error: "Session directory changed" }, { status: 409 });
    const agentDir = getAgentDir();
    const configuration = await listMcpConfiguration({ agentDir, cwd, projectTrusted: getProjectTrustStatus(cwd, agentDir).trusted });
    const projectDefault = readProjectNativeResources(cwd, agentDir);
    const state = live ? await live.send({ type: "get_state" }) as Record<string, unknown> : undefined;
    return NextResponse.json({ configuration, projectDefault, ...(state ? { live: {
      nativeResources: state.nativeResources, effectiveNativeResources: state.effectiveNativeResources, mcpServers: state.mcpServers,
    } } : {}) }, { headers: noStore });
  } catch { return NextResponse.json({ error: "Native tool metadata is unavailable" }, { status: 500, headers: noStore }); }
}

/** Save intent for future ordinary sessions only; never apply it to a wrapper. */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { cwd?: unknown; revision?: unknown; nativeResources?: unknown };
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["cwd", "revision", "nativeResources"].includes(key))) {
      return NextResponse.json({ error: "Invalid project native-tool default" }, { status: 400 });
    }
    let selection;
    try { selection = body.nativeResources === null ? null : validateNativeResourceSelection(body.nativeResources); }
    catch { return NextResponse.json({ error: "Invalid native resource selection" }, { status: 400 }); }
    const checked = await authorizedDirectory(body.cwd);
    if ("response" in checked) return checked.response;
    const { cwd } = checked, agentDir = getAgentDir();
    if (!readProjectNativeResources(cwd, agentDir).supported) {
      return NextResponse.json({ error: "Project defaults require a registered Git checkout root" }, { status: 409 });
    }
    if (selection?.mcpServers.length) {
      const configuration = await listMcpConfiguration({ agentDir, cwd, projectTrusted: getProjectTrustStatus(cwd, agentDir).trusted });
      if (!configuration.ok || selection.mcpServers.some(selected => !configuration.servers.some(server =>
        server.scope === selected.scope && server.name === selected.name && server.eligible))) {
        return NextResponse.json({ error: "Selected MCP server is unavailable or unsupported" }, { status: 400 });
      }
    }
    const projectDefault = saveProjectNativeResources(cwd, agentDir, body.revision, selection);
    return NextResponse.json({ projectDefault }, { headers: noStore });
  } catch (error) {
    if (error instanceof ProjectNativeResourcesConflict) return NextResponse.json({ error: error.message }, { status: 409, headers: noStore });
    return NextResponse.json({ error: "Project native-tool defaults could not be saved" }, { status: 500, headers: noStore });
  }
}
