"use client";

import { useId, useState } from "react";
import type { ExtensionUiRequest } from "@/lib/types";

type Request = Extract<ExtensionUiRequest, { method: "git_action" }>;

/** A single-use candidate card: review acknowledgement never authorizes a merge. */
export function GitActionDialog({ request, onRespond }: {
  request: Request;
  onRespond: (request: Request, response: { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const titleId = useId();
  const [inspected, setInspected] = useState(false);
  const { candidate } = request;
  const committing = candidate.kind === "commit";
  return <section role="group" aria-labelledby={titleId} className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-bg text-sm text-text">
    <header className="border-b border-border px-4 py-3">
      <h3 id={titleId} className="font-semibold">{committing ? "Review exact commit" : "Review local Git comparison"}</h3>
      <p className="mt-1 text-xs text-text-muted">{committing
        ? "Only the selected complete files and this exact message will be committed after your approval. No merge, cleanup or remote action."
        : "Read-only comparison. Acknowledging this card does not approve or perform a merge, cleanup or remote action."}</p>
    </header>
    <div className="max-h-[min(65vh,680px)] min-w-0 space-y-3 overflow-y-auto px-4 py-3">
      {committing ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt>Checkout</dt><dd className="break-all">{candidate.preview.repositoryRoot}</dd>
        <dt>Branch</dt><dd className="break-all">{candidate.preview.branch}</dd>
        <dt>Parent</dt><dd className="break-all font-mono">{candidate.preview.head}</dd>
        <dt>Candidate tree</dt><dd className="break-all font-mono">{candidate.preview.tree}</dd>
        <dt>Complete paths</dt><dd className="break-all">{candidate.preview.paths.join(", ")}</dd>
        <dt>Message</dt><dd className="whitespace-pre-wrap break-words">{candidate.message}</dd>
      </dl> : <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt>Feature</dt><dd className="break-all">{candidate.review.featureBranch} · <span className="font-mono">{candidate.review.featureOid}</span></dd>
        <dt>Target</dt><dd className="break-all">{candidate.review.targetBranch} · <span className="font-mono">{candidate.review.targetOid}</span></dd>
        <dt>Merge tree</dt><dd className="break-all font-mono">{candidate.review.mergeTreeOid}</dd>
        <dt>Comparison</dt><dd className="break-all">{candidate.selection.kind === "merge"
          ? "Whole proposed merge (target tree → merge-result tree)"
          : `Consecutive commits: ${candidate.selection.commitOids.join(", ")}`}</dd>
      </dl>}
      <div className="text-xs text-text-muted">Tree diff: <span className="break-all font-mono">{candidate.diff.fromTreeOid} → {candidate.diff.toTreeOid}</span>
        {candidate.diff.hasBinaryChanges && <p>Binary contents are summarized, not shown.</p>}
      </div>
      <details className="min-w-0 rounded border border-border bg-bg-panel p-2">
        <summary className="cursor-pointer font-medium">Candidate diff ({candidate.diff.patch.length} characters)</summary>
        <pre className="mt-2 max-h-[44vh] min-w-0 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{candidate.diff.patch || "No tree changes"}</pre>
      </details>
      {committing && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={inspected} onChange={(event) => setInspected(event.target.checked)} />I reviewed this exact commit candidate and message.</label>}
    </div>
    <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={() => onRespond(request, { cancelled: true })} className="rounded border border-border px-3 py-2">{committing ? "Decline commit" : "Dismiss"}</button>
      <button type="button" disabled={committing && !inspected} onClick={() => onRespond(request, { confirmed: true })}
        className="rounded bg-accent px-3 py-2 text-[var(--accent-contrast)] disabled:opacity-50">{committing ? "Approve exact commit" : "I reviewed this comparison"}</button>
    </footer>
  </section>;
}
