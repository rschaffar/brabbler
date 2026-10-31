import type { PluginCard, RequiredCheck } from "../../lib/plugins/types";
import type { OperationReviewReference } from "../../lib/plugins/review-metadata";
import type { ReviewedGitOperation } from "./server";
import type { PostflightBaseline, PostflightReport } from "./postflight";
import { captureGitReview, gitReviewRelation } from "./review-reader";
import { gitReviewResult, readGitReviewPayload, resolveGitReviewSettlement, type GitReviewComparison, type GitReviewProposal, type GitReviewResources, type GitReviewSettlement } from "./review-data";

/** Internal generated structures use undefined for absent optional fields. Omit
 * those explicitly; refuse every other non-JSON value rather than coercing it.
 * The host independently snapshots/validates the resulting payload before saving. */
function metadata(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (Array.isArray(value)) return value.map(metadata);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, metadata(item)]));
  }
  throw new Error("Invalid generated Git review metadata");
}
export async function gitReviewProposal(operation: ReviewedGitOperation, snapshot: {
  fingerprint: string; cwd: string; args: string[]; checks: RequiredCheck[]; comparison?: GitReviewComparison;
  postflight?: PostflightBaseline; resources?: GitReviewResources;
}, signal?: AbortSignal): Promise<GitReviewProposal> {
  signal?.throwIfAborted();
  const payload = metadata({ version: 1, kind: "proposal", operation, fingerprint: snapshot.fingerprint, cwd: snapshot.cwd,
    nativeArgs: snapshot.args, checks: snapshot.checks, baseline: snapshot.postflight,
    source: snapshot.comparison ? { kind: "git", captured: await captureGitReview(snapshot.cwd, snapshot.comparison, signal) }
      : { kind: "resources", resources: snapshot.resources } });
  const validated = readGitReviewPayload(payload);
  if (validated?.kind !== "proposal") throw new Error("Invalid Git proposal metadata");
  signal?.throwIfAborted();
  return validated;
}
export async function gitReviewSettlement(proposal: GitReviewProposal, reference: OperationReviewReference,
  outcome: GitReviewSettlement["outcome"], postflight?: PostflightReport, resourceResult?: GitReviewSettlement["resourceResult"]): Promise<GitReviewSettlement> {
  let result: GitReviewSettlement["result"], unavailableResult: GitReviewSettlement["unavailableResult"], relation: GitReviewSettlement["relation"] = "unknown";
  const mapped = proposal.baseline && postflight && gitReviewResult(proposal.baseline, postflight);
  if (mapped && proposal.source.kind === "git" && outcome.completed && outcome.effectStarted && outcome.phase === "succeeded") {
    try {
      const captured = await captureGitReview(proposal.cwd, mapped.comparison);
      if (captured.repository.identity !== proposal.source.captured.repository.identity
        || captured.repository.commonDirectory !== proposal.source.captured.repository.commonDirectory) throw new Error("Result repository identity changed");
      result = { captured, commit: mapped.commit, label: mapped.label };
      // Informational only: missing objects/relation failure cannot reclassify or
      // repeat a known completed native effect.
      relation = await gitReviewRelation(proposal.source.captured, captured, { assertAllowed: async () => {} });
    } catch {
      // Preserve verified endpoint facts even if the repository/objects vanished
      // between postflight and capture. Do not invent a captured result binding.
      result = undefined; relation = "unknown";
      unavailableResult = { reason: "objects-unavailable", comparison: mapped.comparison, repository: proposal.source.captured.repository,
        detail: "Verified result endpoints were recorded, but result capture was unavailable at settlement." };
    }
  }
  const payload = readGitReviewPayload(metadata({ version: 1, kind: "settlement", proposal: reference, outcome, postflight, result, resourceResult, unavailableResult, relation }));
  if (payload?.kind !== "settlement" || !resolveGitReviewSettlement(proposal, payload)) throw new Error("Invalid Git settlement metadata");
  return payload;
}
const excerpt = (value: string, length: number) => value.length > length ? value.slice(0, length) + "… [full value in exact review]" : value;
/** Application presentation configuration, never operation JSON or Git policy. */
export interface GitCardPresentation { readonly sectionFieldLimit: number }
export const DEFAULT_GIT_CARD_PRESENTATION: GitCardPresentation = Object.freeze({ sectionFieldLimit: 24 });
/** Limits apply only to presentation. Complete structured metadata is saved first. */
export function compactGitCard(card: PluginCard, presentation: GitCardPresentation = DEFAULT_GIT_CARD_PRESENTATION): PluginCard {
  const sectionLimit = presentation.sectionFieldLimit;
  if (!Number.isSafeInteger(sectionLimit) || sectionLimit < 1 || sectionLimit > DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit) throw new Error("Git section preview limit must be an integer from 1 to 24");
  const fields = (values: NonNullable<PluginCard["fields"]>, limit: number) => values.slice(0, limit).map((field) => ({ ...field, label: excerpt(field.label, 90), value: excerpt(field.value, 2048) }));
  return { ...card, fields: card.fields && fields(card.fields, 24),
    sections: card.sections?.map((section) => ({ ...section, title: excerpt(section.title, 90),
      ...(section.fields ? { fields: fields(section.fields, sectionLimit) } : {}), text: [section.text ? excerpt(section.text, 8192) : "",
        section.fields && section.fields.length > sectionLimit ? `Showing ${sectionLimit} of ${section.fields.length} items. The exact review contains every item.` : ""].filter(Boolean).join("\n") })),
  };
}
