import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { snapshotOperationReview, operationReviewReference, readOperationReview } = await jiti.import("../../lib/plugins/review-metadata.ts");
const { readGitReviewPayload } = await jiti.import("./review-data.ts");
const { gitReviewPage, gitReviewPatch } = await jiti.import("./review-reader.ts");
// External UI save capability for producer/native-rule tests only. Real session
// fsync/SDK publication is separately exercised by RPC and runtime suites; the
// standalone service suite uses its real existing JSON owner.
const saved = new Map();
export async function saveOperationReview(pluginId, operationId, format, payload) {
  const record = snapshotOperationReview(pluginId, operationId, format, payload);
  assert.ok(readGitReviewPayload(record.payload), "producer exports the documented payload schema");
  saved.set(record.id, record);
  return operationReviewReference(record);
}
export function reviewMetadata(ref) {
  assert.equal(ref.version, 2);
  const record = readOperationReview(saved.get(ref.id));
  assert.ok(record); assert.equal(record.operationId, ref.operationId); assert.equal(record.pluginId, "git-workflow");
  return structuredClone(record.payload);
}
export function reviewProposal(ref) {
  const payload = reviewMetadata(ref);
  return payload.kind === "proposal" ? payload : reviewMetadata(payload.proposal);
}
export function reviewFiles(ref) {
  const proposal = reviewProposal(ref);
  assert.equal(proposal.source.kind, "git");
  return gitReviewPage(proposal.source.captured, { assertAllowed: async () => {} }, 0);
}
export async function reviewPatch(ref, file) {
  const proposal = reviewProposal(ref);
  assert.equal(proposal.source.kind, "git");
  const chunks = [];
  for await (const chunk of gitReviewPatch(proposal.source.captured, { assertAllowed: async () => {} }, file)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
