import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveSessionReview } from "@/lib/plugins/review-access";
import { operationReviewResponse } from "@/lib/plugins/review-provider";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string; reviewId: string }> }) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  const { id, reviewId } = await params;
  const owner = await resolveSessionReview(id, reviewId, request.signal);
  if (!owner) return Response.json({ error: "Review is not referenced by this saved session" }, { status: 404, headers });
  return operationReviewResponse(request, owner);
}
