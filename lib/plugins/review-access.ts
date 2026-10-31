import { getSessionEntries, readSessionHeader, resolveSessionPath } from "../session-reader";
import { OPERATION_RECEIPT_TYPE, readOperationReceipt } from "../operation-receipts";
import { INTERACTION_RECEIPT_TYPE, readInteractionReceipt } from "../interaction-receipts";
import { isOperationId } from "./ui";
import { isPluginSessionId } from "./settings";
import type { PluginReviewReference } from "./types";
import { findOperationReview, type OperationReviewRecord, type OperationReviewReference } from "./review-metadata";

/** Raw persisted entries, not the active branch/page or live wrapper. Copied
 * references authorize review in forks; cwd and creator lifetime are irrelevant. */
export async function resolveSessionReview(sessionId: string, reviewId: string): Promise<{ ref: PluginReviewReference; pluginId: string;
  metadata?: OperationReviewRecord; resolveLinked?: (reference: OperationReviewReference) => OperationReviewRecord | null } | null> {
  if (!isPluginSessionId(sessionId) || !isOperationId(reviewId)) return null;
  const path = await resolveSessionPath(sessionId);
  try { if (!path || readSessionHeader(path)?.id !== sessionId) return null; }
  catch { return null; }
  if (!path) return null;
  const entries = getSessionEntries(path);
  const owner = (ref: PluginReviewReference, pluginId: string, leafId: string) => {
    if (ref.version === 1) return { ref, pluginId }; // Unsupported legacy identity only.
    const metadata = findOperationReview(entries, pluginId, ref, leafId);
    if (!metadata) return null;
    return { ref, pluginId, metadata, resolveLinked: (reference: OperationReviewReference) =>
      reference.operationId === ref.operationId ? findOperationReview(entries, pluginId, reference, leafId) : null };
  };
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType === OPERATION_RECEIPT_TYPE) {
      const receipt = readOperationReceipt(entry.data);
      if (receipt?.card.review?.id === reviewId) return owner(receipt.card.review, receipt.pluginId, entry.id);
    } else if (entry.customType === INTERACTION_RECEIPT_TYPE) {
      const receipt = readInteractionReceipt(entry.data);
      if (receipt?.request.method === "plugin_card" && receipt.request.review?.id === reviewId) {
        return owner(receipt.request.review, receipt.request.pluginId, entry.id);
      }
    }
  }
  return null;
}
