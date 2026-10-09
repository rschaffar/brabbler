import { Readable } from "node:stream";
import { resolveSessionReview } from "@/lib/plugins/review-access";
import { reviewEntry, reviewManifest, reviewPage, reviewPreview, reviewStream } from "@/lib/plugins/review-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function integer(value: string | null, fallback = 0) {
  if (value === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid review page/entry");
  return Number(value);
}
/** Existing proxy authentication/origin policy applies. This route never creates
 * sessions, accesses checkouts, invokes Git or grants execution authority. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; reviewId: string }> }) {
  const { id, reviewId } = await params;
  try {
    const owner = await resolveSessionReview(id, reviewId);
    if (!owner) return Response.json({ error: "Review is not referenced by this saved session" }, { status: 404, headers });
    await reviewManifest(owner.ref, owner.pluginId);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["start", "entry", "offset", "download", "patch"].includes(key))) throw new Error("Invalid review query");
    if (query.get("patch") === "1") {
      async function* patches() {
        for (let index = 0; index < owner!.ref.entries; index++) {
          const item = await reviewEntry(owner!.ref, index);
          if (item.kind !== "patch") continue;
          const stream = await reviewStream(owner!.ref, item);
          if (stream) yield* stream;
        }
      }
      return new Response(Readable.toWeb(Readable.from(patches())) as ReadableStream<Uint8Array>, { headers: { ...headers,
        "Content-Type": "text/plain; charset=utf-8",
        ...(query.get("download") === "1" ? { "Content-Disposition": `attachment; filename="review-${reviewId}.patch"` } : {}) } });
    }
    if (query.has("patch")) throw new Error("Invalid patch request");
    const entry = query.has("entry") ? await reviewEntry(owner.ref, integer(query.get("entry"))) : undefined;
    if (query.get("download") === "1") {
      const stream = await reviewStream(owner.ref, entry);
      return new Response(stream ? Readable.toWeb(stream) as ReadableStream<Uint8Array> : "", { headers: { ...headers,
        "Content-Type": "application/octet-stream", "Content-Length": String(entry?.bytes ?? owner.ref.bytes),
        "Content-Disposition": `attachment; filename="review-${reviewId}${entry ? `-${entry.id}` : ""}.txt"` } });
    }
    if (query.has("download")) throw new Error("Invalid download request");
    if (entry) return Response.json({ entry, ...await reviewPreview(owner.ref, entry, integer(query.get("offset"))) }, { headers });
    return Response.json(await reviewPage(owner.ref, integer(query.get("start"))), { headers });
  } catch {
    return Response.json({ error: "Exact review unavailable or request invalid. The operation's authorization scope is unchanged." }, { status: 400, headers });
  }
}
