"use client";

import { useId, useState } from "react";
import type { AgentGitPreferenceChoice } from "@/lib/agent-git-preferences";
import type { ExtensionUiRequest } from "@/lib/types";

type Request = Extract<ExtensionUiRequest, { method: "git_action" }>;

/** A single-use candidate card: review acknowledgement never authorizes a merge. */
export function GitActionDialog({ request, onRespond }: {
  request: Request;
  onRespond: (request: Request, response: { confirmed: boolean } | { approvePlanId: string } | { preferences: AgentGitPreferenceChoice } | { cancelled: true }) => void;
}) {
  const titleId = useId();
  const [inspected, setInspected] = useState(false);
  const { candidate } = request;
  const choosing = candidate.kind === "preferences";
  const [target, setTarget] = useState(choosing ? candidate.current?.targetBranch ?? candidate.targets[0] ?? "" : "");
  const [selected, setSelected] = useState<number[]>(choosing ? candidate.checks.flatMap((check, index) =>
    candidate.current?.checks.some((saved) => JSON.stringify(saved) === JSON.stringify(check)) ? [index] : candidate.current ? [] : [index]) : []);
  const [mode, setMode] = useState<"current" | "worktree">(choosing ? candidate.current?.mode ?? "current" : "current");
  const [cleanup, setCleanup] = useState<"retain" | "offer">(choosing ? candidate.current?.cleanup ?? "retain" : "retain");
  const committing = candidate.kind === "commit";
  const checking = candidate.kind === "checks";
  const merging = candidate.kind === "integration";
  return <section role="group" aria-labelledby={titleId} className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-bg text-sm text-text">
    <header className="border-b border-border px-4 py-3">
      <h3 id={titleId} className="font-semibold">{choosing ? "Choose Git workflow preferences" : committing ? "Review exact commit" : checking ? "Authorize ordered checks" : merging ? "Approve exact local merge" : "Review local Git comparison"}</h3>
      <p className="mt-1 text-xs text-text-muted">{choosing ? "These choices are saved for this chat only. No checks run and no commit, merge, cleanup or remote action is approved. Later actions require separate review and approval."
        : committing
        ? "Only the selected complete files and this exact message will be committed after your approval. No merge, cleanup or remote action."
        : checking ? "These commands can execute project code and modify files. Approval here runs checks only, NOT the merge. No shell, cleanup or remote action."
        : merging ? "A separate approval of this exact plan updates the local target with an unsigned non-fast-forward merge. No cleanup or remote action."
        : "Read-only comparison. Acknowledging this card does not approve or perform a merge, cleanup or remote action."}</p>
    </header>
    <div className="max-h-[min(65vh,680px)] min-w-0 space-y-3 overflow-y-auto px-4 py-3">
      {choosing ? <div className="space-y-3 text-xs">
        <p>Feature: {candidate.featureBranch}. Targets are local branches in registered checkouts.</p>
        <label className="block">Target branch <select className="ml-2 rounded border border-border bg-bg" value={target} onChange={(event) => setTarget(event.target.value)}>
          {candidate.targets.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select></label>
        {!candidate.targets.length && <p>No distinct registered target checkout is available.</p>}
        <p>Integration method: ordinary unsigned non-fast-forward merge (only supported method).</p>
        <fieldset><legend>Verification checks to request later (not run now)</legend>
          {candidate.checks.map((check, index) => <label key={index} className="mt-2 flex items-start gap-2 break-all">
            <input type="checkbox" checked={selected.includes(index)} onChange={(event) => setSelected((prior) => event.target.checked ? [...prior, index].sort((a, b) => a - b) : prior.filter((i) => i !== index))} />
            {check.label}: {JSON.stringify(check.argv)}</label>)}
        </fieldset>
        <label className="block">Workspace intent <select className="ml-2 rounded border border-border bg-bg" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
          <option value="current">Current checkout</option><option value="worktree">Prefer a dedicated worktree (does not create one)</option>
        </select></label>
        <label className="block">After integration <select className="ml-2 rounded border border-border bg-bg" value={cleanup} onChange={(event) => setCleanup(event.target.value as typeof cleanup)}>
          <option value="retain">Retain worktree and branch</option><option value="offer">Offer separate cleanup review later</option>
        </select></label>
      </div> : checking ? <div className="space-y-2 text-xs">
        <p>Feature: {candidate.featureBranch} → target: {candidate.targetBranch}</p>
        <p>Checks run in this order from the feature checkout:</p>
        <ol className="list-inside list-decimal space-y-2">{candidate.checks.map((check, i) => <li key={i} className="break-all">{check.label}<pre className="ml-4 whitespace-pre-wrap break-all font-mono">{JSON.stringify(check.argv)}</pre></li>)}</ol>
      </div> : merging ? <div className="space-y-3 text-xs">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 break-all">
          <dt>Feature</dt><dd>{candidate.plan.review.featureBranch} · {candidate.plan.review.featureOid}</dd>
          <dt>Target</dt><dd>{candidate.plan.review.targetBranch} · {candidate.plan.review.targetOid}</dd>
          <dt>Result tree</dt><dd>{candidate.plan.review.mergeTreeOid}</dd>
          <dt>Merge commit</dt><dd>{candidate.plan.mergeOid}</dd>
          <dt>Message</dt><dd>{candidate.plan.message}</dd>
          <dt>Plan ID</dt><dd className="font-mono">{candidate.plan.planId}</dd>
          <dt>Expires</dt><dd>{new Date(candidate.plan.expiresAt).toLocaleString()}</dd>
        </dl>
        <p>Verified checks and process-local receipts (ordered):</p>
        <ol className="list-inside list-decimal space-y-2">{candidate.receipts.map((receipt) => <li key={receipt.id} className="break-all">
          <span className="font-mono">{JSON.stringify(receipt.argv)}</span> · receipt {receipt.id} · log SHA-256 {receipt.logDigest} · passed {new Date(receipt.finishedAt).toLocaleString()}
        </li>)}</ol>
      </div> : committing ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
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
      {!checking && !choosing && <div className="text-xs text-text-muted">Tree diff: <span className="break-all font-mono">{(merging ? candidate.plan.diff : candidate.diff).fromTreeOid} → {(merging ? candidate.plan.diff : candidate.diff).toTreeOid}</span>
        {(merging ? candidate.plan.diff : candidate.diff).hasBinaryChanges && <p>Binary contents are summarized, not shown.</p>}
      </div>}
      {!checking && !choosing && <details className="min-w-0 rounded border border-border bg-bg-panel p-2">
        <summary className="cursor-pointer font-medium">Candidate diff ({(merging ? candidate.plan.diff : candidate.diff).patch.length} characters)</summary>
        <pre className="mt-2 max-h-[44vh] min-w-0 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{(merging ? candidate.plan.diff : candidate.diff).patch || "No tree changes"}</pre>
      </details>}
      {(committing || checking || merging) && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={inspected} onChange={(event) => setInspected(event.target.checked)} />I reviewed {committing ? "this exact commit candidate and message" : checking ? "each ordered command and its arguments" : "this exact plan, diff, refs and check receipts"}.</label>}
    </div>
    <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={() => onRespond(request, { cancelled: true })} className="rounded border border-border px-3 py-2">{choosing ? "Cancel" : committing ? "Decline commit" : checking ? "Decline checks" : merging ? "Decline merge" : "Dismiss"}</button>
      <button type="button" disabled={(choosing && !target) || ((committing || checking || merging) && !inspected)} onClick={() => onRespond(request, choosing ? { preferences: { targetBranch: target, method: "merge", checkIndexes: selected, mode, cleanup } } : merging ? { approvePlanId: candidate.plan.planId } : { confirmed: true })}
        className="rounded bg-accent px-3 py-2 text-[var(--accent-contrast)] disabled:opacity-50">{choosing ? "Save chat preferences" : committing ? "Approve exact commit" : checking ? "Run these checks" : merging ? "Approve exact local merge" : "I reviewed this comparison"}</button>
    </footer>
  </section>;
}
