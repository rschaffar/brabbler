import { Readable } from "node:stream";
import { isApiRequestAllowed } from "@/lib/request-security";
import { projectOperationReview } from "@/lib/plugins/project-operations";
import { reviewEntry, reviewManifest, reviewPage, reviewPreview, reviewStream } from "@/lib/plugins/review-store";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function integer(value: string | null) {
  if (value === null) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid page/entry");
  return Number(value);
}
/** Operation ownership, not session identity or arbitrary review UUIDs. Disabled plugins retain read access. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; operationId: string; reviewId: string }> }) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const { id, operationId, reviewId } = await params;
    const ref = await projectOperationReview(id, operationId, reviewId);
    await reviewManifest(ref, id);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["start", "entry", "offset", "download", "patch"].includes(key))) throw new Error("Invalid review query");
    if (query.get("patch") === "1") {
      async function* patches() {
        for (let index = 0; index < ref.entries; index++) {
          const item = await reviewEntry(ref, index);
          if (item.kind !== "patch") continue;
          const stream = await reviewStream(ref, item);
          if (stream) yield* stream;
        }
      }
      return new Response(Readable.toWeb(Readable.from(patches())) as ReadableStream<Uint8Array>, { headers: { ...headers,
        "Content-Type": "text/plain; charset=utf-8", ...(query.get("download") === "1" ? { "Content-Disposition": `attachment; filename="review-${reviewId}.patch"` } : {}) } });
    }
    if (query.has("patch")) throw new Error("Invalid patch request");
    const entry = query.has("entry") ? await reviewEntry(ref, integer(query.get("entry"))) : undefined;
    if (query.get("download") === "1") {
      const stream = await reviewStream(ref, entry);
      return new Response(stream ? Readable.toWeb(stream) as ReadableStream<Uint8Array> : "", { headers: { ...headers,
        "Content-Type": "application/octet-stream", "Content-Length": String(entry?.bytes ?? ref.bytes),
        "Content-Disposition": `attachment; filename="review-${reviewId}${entry ? `-${entry.id}` : ""}.txt"` } });
    }
    if (query.has("download")) throw new Error("Invalid download request");
    if (entry) return Response.json({ entry, ...await reviewPreview(ref, entry, integer(query.get("offset"))) }, { headers });
    return Response.json(await reviewPage(ref, integer(query.get("start"))), { headers });
  } catch { return Response.json({ error: "Exact review unavailable or request invalid; historical records never authorize execution." }, { status: 400, headers }); }
}
