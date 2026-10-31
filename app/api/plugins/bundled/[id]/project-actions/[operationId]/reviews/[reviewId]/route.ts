import { isApiRequestAllowed } from "@/lib/request-security";
import { projectOperationReview } from "@/lib/plugins/project-operations";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
/** Ownership/physical-anchor admission remains mandatory, including disabled-plugin
 * history. P3 supplies materialization; legacy bundles are never opened. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; operationId: string; reviewId: string }> }) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id, operationId, reviewId } = await params;
    const ref = await projectOperationReview(id, operationId, reviewId);
    return Response.json({ error: ref.version === 1 ? "Legacy review unavailable; offline migration required."
      : "Git-backed review viewer pending. Saved operation metadata and outcomes are retained." }, { status: 501, headers });
  } catch { return Response.json({ error: "Review unavailable; historical records never authorize execution." }, { status: 400, headers }); }
}
