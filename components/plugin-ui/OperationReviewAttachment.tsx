"use client";

import type { PluginReviewReference } from "@/lib/plugins/types";
/** P2 deliberately does not materialize either format. P3 must reconnect the
 * retained shared file viewer, not infer archive .bytes/.entries from a v2 ref. */
export function ReviewAttachment({ review }: { review: PluginReviewReference; sessionId?: string; before?: string; after?: string;
  contextHandle?: string; pluginId?: string; reviewBaseUrl?: string; onReadWork?: (work: Promise<void>) => void }) {
  return <section aria-label="Exact operation review" className="min-w-0 space-y-2 text-xs">
    <h3 className="blocking-card-section-title">Exact operation review</h3>
    <p role="status">{review.version === 1 ? "Legacy review unavailable; offline migration required."
      : "Git-backed review viewer pending. Saved operation metadata and outcomes are retained."}</p>
  </section>;
}
