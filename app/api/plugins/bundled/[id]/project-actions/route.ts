import { isApiRequestAllowed } from "@/lib/request-security";
import { listProjectOperations, prepareProjectAction } from "@/lib/plugins/project-operations";
import { bundledPlugin } from "@/lib/plugins/registry";
import { readPluginSettings } from "@/lib/plugins/settings";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id } = await params;
    return Response.json(await prepareProjectAction(id, await request.json()), { status: 202, headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
}
export async function GET(request: Request, { params }: Params) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id } = await params, cwd = new URL(request.url).searchParams.get("cwd");
    if (!cwd) throw new Error("cwd is required");
    const operations = await listProjectOperations(id, cwd);
    const plugin = bundledPlugin(id);
    return Response.json({ operations, enabled: readPluginSettings(plugin.manifest, cwd).enabled, capability: Boolean(plugin.projectActions) }, { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
}
