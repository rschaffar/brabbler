import { resolveSessionReview } from "@/lib/plugins/review-access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
/** P2 ownership boundary. P3 supplies plugin-dispatched materialization here;
 * neither version is interpreted as an archive or a browser-supplied revision. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; reviewId: string }> }) {
  const { id, reviewId } = await params;
  try {
    const owner = await resolveSessionReview(id, reviewId);
    if (!owner) return Response.json({ error: "Review is not referenced by this saved session" }, { status: 404, headers });
    return Response.json({ error: owner.ref.version === 1 ? "Legacy review unavailable; offline migration required."
      : "Git-backed review viewer pending. Saved operation metadata and outcomes are retained." }, { status: 501, headers });
  } catch {
    return Response.json({ error: "Review unavailable. The operation's authorization scope is unchanged." }, { status: 400, headers });
  }
}
