import { realpathSync } from "node:fs";
import { getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../file-access";
import { samePath } from "../paths";
import { bundledPlugin } from "./registry";
import { readOperationReview, type OperationReviewRecord } from "./review-metadata";
import type { OperationReviewReference } from "./review-reference";
import type { PluginReviewReference } from "./types";
import { ReviewReadError, type ReviewOverview, type ReviewQuery } from "./review-protocol";
export { ReviewReadError } from "./review-protocol";

export interface ReviewOwner {
  ref: PluginReviewReference; pluginId: string; metadata?: OperationReviewRecord | null;
  resolveLinked?: (ref: OperationReviewReference) => OperationReviewRecord | null;
  /** Standalone physical owner admission, independent of content fallback. */
  revalidate?: () => Promise<void>;
}
export interface ReviewProviderContext {
  metadata: OperationReviewRecord;
  resolveLinked(ref: OperationReviewReference): OperationReviewRecord | null;
  assertAllowed(path: string): Promise<void>;
  signal: AbortSignal;
}
export interface ReviewResource {
  body: unknown | AsyncIterable<Uint8Array>;
  filename?: string;
}
export interface OperationReviewProvider {
  formats: readonly string[];
  read(context: ReviewProviderContext, query: ReviewQuery): Promise<ReviewResource>;
}
export function assertReviewPathAllowed(path: string) {
  const roots = getKnownAllowedFileRoots();
  const denied = () => new ReviewReadError("Access to this review repository is denied.", 403);
  if (!isFilePathAllowed(path, roots)) throw denied();
  let physical: string;
  try { physical = realpathSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ReviewReadError("The captured review repository is unavailable.");
    throw denied();
  }
  if (!isExistingFilePathAllowed(path, roots) || !samePath(physical, path)) throw denied();
}
function query(request: Request): ReviewQuery {
  const params = new URL(request.url).searchParams;
  const invalid = () => { throw new ReviewReadError("Invalid review selection.", 400); };
  const op = params.get("op") ?? "overview";
  const allowed: Record<string, string[]> = { overview: ["op"], page: ["op", "view", "start"],
    preview: ["op", "view", "file", "offset"], context: ["op", "view", "file"], patch: ["op", "view", "file"], details: ["op", "offset", "download"] };
  if (!Object.hasOwn(allowed, op) || [...params.keys()].some(key => !allowed[op].includes(key) || params.getAll(key).length !== 1)) invalid();
  const number = (key: string, fallback?: number) => {
    const value = params.get(key);
    if (value === null && fallback !== undefined) return fallback;
    if (value === null || !/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return invalid();
    return Number(value);
  };
  if (op === "overview") return { op };
  if (op === "details") {
    if (params.has("download") && params.get("download") !== "1") invalid();
    return { op, offset: number("offset", 0), download: params.has("download") };
  }
  const view = params.get("view");
  if (view !== "proposal" && view !== "result") return invalid();
  if (op === "page") { const start = number("start", 0); if (start % 40) invalid(); return { op, view, start }; }
  if (op === "preview") return { op, view, file: number("file"), offset: number("offset", 0) };
  if (op === "context") return { op, view, file: number("file") };
  return { op: "patch", view, ...(params.has("file") ? { file: number("file") } : {}) };
}
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
/** Pull-based streaming. Cancellation aborts AND joins the iterator/native child;
 * a late Git/identity failure errors the body, never a successful partial archive. */
function stream(source: AsyncIterable<Uint8Array>, controller: AbortController, detach: () => void) {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const next = await iterator.next();
        if (next.done) { detach(); output.close(); } else output.enqueue(next.value);
      } catch (error) { detach(); output.error(error); }
    },
    async cancel(reason) {
      controller.abort(reason);
      try { await iterator.return?.(); } finally { detach(); }
    },
  }, { highWaterMark: 0 });
}
export async function operationReviewResponse(request: Request, owner: ReviewOwner): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const detach = () => request.signal.removeEventListener("abort", abort);
  try {
    await owner.revalidate?.();
    const selection = query(request);
    let provider: OperationReviewProvider | undefined;
    try { provider = bundledPlugin(owner.pluginId).reviewProvider; } catch { /* Unsupported retained owner. */ }
    const metadata = readOperationReview(owner.metadata);
    if (owner.ref.version !== 2 || !metadata || metadata.id !== owner.ref.id || metadata.pluginId !== owner.pluginId
      || metadata.operationId !== owner.ref.operationId || !provider?.formats.includes(metadata.format)) {
      const reason = owner.ref.version === 1 ? "Legacy review unavailable; offline migration required." : "Review format unavailable.";
      if (selection.op !== "overview") throw new ReviewReadError(reason, 501);
      detach();
      return Response.json({ defaultView: "result", views: [{ view: "result", label: "Review unavailable", available: false, reason }],
        relation: "unknown", hasFiles: false, details: false } satisfies ReviewOverview, { headers });
    }
    const context: ReviewProviderContext = { metadata, signal: controller.signal,
      async assertAllowed(path) { await owner.revalidate?.(); assertReviewPathAllowed(path); },
      resolveLinked(ref) {
        if (ref.operationId !== metadata.operationId) return null;
        const linked = readOperationReview(owner.resolveLinked?.(ref));
        return linked && linked.id === ref.id && linked.operationId === ref.operationId && linked.pluginId === metadata.pluginId
          && linked.format === metadata.format ? linked : null;
      } };
    const resource = await provider.read(context, selection);
    await owner.revalidate?.();
    if (resource.filename) {
      const source = resource.body as AsyncIterable<Uint8Array>;
      async function* admitted() { await owner.revalidate?.(); yield* source; await owner.revalidate?.(); }
      return new Response(stream(admitted(), controller, detach), { headers: { ...headers,
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${resource.filename}"` } });
    }
    detach();
    return Response.json(resource.body, { headers });
  } catch (error) {
    detach();
    return Response.json({ error: error instanceof Error ? error.message : "Review read failed." }, {
      status: error instanceof ReviewReadError ? error.status : 409, headers });
  }
}
