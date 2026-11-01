import type { OperationReviewProvider, ReviewProviderContext } from "../../lib/plugins/review-provider";
import { ReviewReadError, type ReviewAvailability, type ReviewOverview, type ReviewQuery, type ReviewView } from "../../lib/plugins/review-protocol";
import { GIT_REVIEW_FORMAT, readGitReviewPayload, resolveGitReviewSettlement, type CapturedGitReview } from "./review-data";
import { assertGitReviewAvailable, gitReviewContext, gitReviewPage, gitReviewPatch, gitReviewPreview, GitReviewReadError } from "./review-reader";

function sources(context: ReviewProviderContext) {
  const payload = readGitReviewPayload(context.metadata.payload);
  if (!payload) throw new ReviewReadError("Invalid saved Git review.");
  const linked = payload.kind === "settlement" ? context.resolveLinked(payload.proposal) : null;
  const proposal = payload.kind === "settlement" ? readGitReviewPayload(linked?.payload) : payload;
  if (!proposal || proposal.kind === "settlement") throw new ReviewReadError("Original proposal metadata is unavailable.");
  const settlement = payload.kind === "settlement" ? payload : undefined;
  const captured: Partial<Record<ReviewView, CapturedGitReview>> = {};
  if (proposal.kind === "proposal" && proposal.source.kind === "git") captured.proposal = proposal.source.captured;
  const trustworthy = settlement && resolveGitReviewSettlement(proposal, settlement);
  if (trustworthy && settlement.result) captured.result = settlement.result.captured;
  const resources = proposal.kind === "proposal" && proposal.source.kind === "resources";
  // A pre-effect failure/cancellation has no actual result. Anything that might
  // have executed defaults to an explicitly unavailable result, never proposal.
  const preEffect = settlement && settlement.outcome.effectStarted === false && settlement.outcome.completed === false;
  const defaultView: ReviewView = !settlement || preEffect ? "proposal" : "result";
  const relation = trustworthy ? settlement!.relation : "unknown";
  return { proposal, settlement, captured, resources, defaultView, relation };
}
function readError(error: unknown): ReviewReadError {
  return error instanceof GitReviewReadError ? new ReviewReadError(error.message, error.code === "ACCESS_DENIED" ? 403 : error.code === "INVALID" ? 400 : 409)
    : error instanceof ReviewReadError ? error : new ReviewReadError("The captured repository or Git objects are unavailable.");
}
export const gitReviewProvider: OperationReviewProvider = {
  formats: [GIT_REVIEW_FORMAT],
  async read(context, query: ReviewQuery) {
    const data = sources(context);
    const access = { async assertAllowed(path: string) {
      try { await context.assertAllowed(path); }
      catch (error) {
        if (error instanceof ReviewReadError && error.status === 409) throw new GitReviewReadError("UNAVAILABLE", error.message);
        throw error;
      }
    } };
    const { signal } = context;
    if (query.op === "details") {
      // Serialize once on explicit demand, never repeat full lists in overview,
      // cards or polling. Bounded visible preview; download preserves every fact.
      const bytes = Buffer.from(JSON.stringify({ proposal: data.proposal, ...(data.settlement ? { settlement: data.settlement } : {}) }, null, 2));
      if (query.download) return { filename: "operation-metadata.json", body: (async function* () {
        for (let offset = 0; offset < bytes.length; offset += 65536) { signal.throwIfAborted(); yield bytes.subarray(offset, offset + 65536); }
      })() };
      if (query.offset > bytes.length) throw new ReviewReadError("Invalid details page.", 400);
      const end = Math.min(bytes.length, query.offset + 256 * 1024);
      return { body: { text: bytes.subarray(query.offset, end).toString("utf8"), bytes: bytes.length, offset: query.offset,
        next: end < bytes.length ? end : null, complete: query.offset === 0 && end === bytes.length } };
    }
    const label = (view: ReviewView) => view === "proposal" ? "Original proposal" : data.settlement?.result?.label ?? "Actual result";
    if (query.op === "overview") {
      const views: ReviewAvailability[] = [];
      for (const view of data.settlement ? ["result", "proposal"] as const : ["proposal"] as const) {
        const captured = data.captured[view];
        const item: ReviewAvailability = { view, label: label(view), available: false };
        if (captured) {
          item.before = captured.comparison.before; item.after = captured.comparison.after;
          try { await assertGitReviewAvailable(captured, access, signal); item.available = true; }
          catch (error) { signal.throwIfAborted(); item.reason = readError(error).message; }
        } else item.reason = data.resources ? "This operation records resources, not a patch. Inspect operation metadata."
          : view === "result" ? "Actual result unavailable; no trustworthy comparison was recorded."
          : "Original proposal comparison unavailable. Inspect operation metadata.";
        views.push(item);
      }
      return { body: { defaultView: data.defaultView, views, relation: data.relation, hasFiles: !data.resources, details: true } satisfies ReviewOverview };
    }
    const captured = data.captured[query.view];
    if (!captured) throw new ReviewReadError(`${label(query.view)} unavailable.`);
    try {
      if (query.op === "page") return { body: await gitReviewPage(captured, access, query.start, signal) };
      if (query.op === "preview") return { body: await gitReviewPreview(captured, access, query.file, query.offset, signal) };
      if (query.op === "context") return { body: await gitReviewContext(captured, access, query.file, signal) };
      // Validate before sending headers as well as around/after the streaming read.
      await assertGitReviewAvailable(captured, access, signal, query.file);
      return { filename: `${query.view}${query.file === undefined ? "" : `-file-${query.file}`}.patch`, body: gitReviewPatch(captured, access, query.file, signal) };
    } catch (error) { signal.throwIfAborted(); throw readError(error); }
  },
};
