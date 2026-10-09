import { getSessionEntries, readSessionHeader, resolveSessionPath } from "../session-reader";
import { OPERATION_RECEIPT_TYPE, readOperationReceipt } from "../operation-receipts";
import { INTERACTION_RECEIPT_TYPE, readInteractionReceipt } from "../interaction-receipts";
import { isOperationId } from "./ui";
import { isPluginSessionId } from "./settings";
import type { PluginReviewReference } from "./types";

/** Raw persisted entries, not the active branch/page or live wrapper. Copied
 * references authorize review in forks; cwd and creator lifetime are irrelevant. */
export async function resolveSessionReview(sessionId: string, reviewId: string): Promise<{ ref: PluginReviewReference; pluginId: string } | null> {
  if (!isPluginSessionId(sessionId) || !isOperationId(reviewId)) return null;
  const path = await resolveSessionPath(sessionId);
  try { if (!path || readSessionHeader(path)?.id !== sessionId) return null; }
  catch { return null; }
  if (!path) return null;
  for (const entry of getSessionEntries(path)) {
    if (entry.type !== "custom") continue;
    if (entry.customType === OPERATION_RECEIPT_TYPE) {
      const receipt = readOperationReceipt(entry.data);
      if (receipt?.card.review?.id === reviewId) return { ref: receipt.card.review, pluginId: receipt.pluginId };
    } else if (entry.customType === INTERACTION_RECEIPT_TYPE) {
      const receipt = readInteractionReceipt(entry.data);
      if (receipt?.request.method === "plugin_card" && receipt.request.review?.id === reviewId) {
        return { ref: receipt.request.review, pluginId: receipt.request.pluginId };
      }
    }
  }
  return null;
}
