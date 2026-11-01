import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveProjectOperationReview } from "@/lib/plugins/project-operations";
import { operationReviewResponse } from "@/lib/plugins/review-provider";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string; operationId: string; reviewId: string }> }) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id, operationId, reviewId } = await params;
    // Mandatory physical owner-anchor admission precedes provider/content fallback.
    const owner = await resolveProjectOperationReview(id, operationId, reviewId);
    return operationReviewResponse(request, owner);
  } catch { return Response.json({ error: "Review unavailable; historical records never authorize execution." }, { status: 400, headers }); }
}
