import { isApiRequestAllowed } from "@/lib/request-security";
import { decideProjectOperation, getProjectOperation } from "@/lib/plugins/project-operations";
import { parseProjectActionDecision } from "@/lib/plugins/project-acknowledgment";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string; operationId: string }> };
export async function GET(request: Request, { params }: Params) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id, operationId } = await params;
    return Response.json(await getProjectOperation(id, operationId), { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404, headers }); }
}
export async function POST(request: Request, { params }: Params) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id, operationId } = await params;
    const body = parseProjectActionDecision(await request.json());
    return Response.json(await decideProjectOperation(id, operationId, body.cwd, body.decision, body.acknowledgment), { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409, headers }); }
}
