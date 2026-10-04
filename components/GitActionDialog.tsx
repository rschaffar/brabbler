"use client";

import { useId, useState } from "react";
import type { AgentGitPreferenceChoice } from "@/lib/agent-git-preferences";
import type { ExtensionUiRequest, GitNativeActionCandidate } from "@/lib/types";
import { MultiFileGitDiff } from "./MultiFileGitDiff";

type Request = Extract<ExtensionUiRequest, { method: "git_action" }>;

/** Pure rendering of an ACTUAL transient Ask packet, not a history record or
 * native engine handle. The original request/responder owns settlement. */
function NativeGitActionDialog({ titleId, request, candidate, onRespond }: {
  titleId: string; request: Request; candidate: GitNativeActionCandidate;
  onRespond: (request: Request, response: { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const workspace = candidate.kind === "workspace" ? candidate.workspace : null;
  const preparation = candidate.kind === "preparation" ? candidate.preparation : null;
  const operation = workspace ? workspace.mode === "create" ? "worktree creation" : "worktree attachment" : "history preparation";
  return <section role="group" aria-labelledby={titleId} className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-bg text-sm text-text">
    <header className="border-b border-border px-4 py-3">
      <h3 id={titleId} className="font-semibold">Approve exact {operation}</h3>
      <p className="mt-1 text-xs text-text-muted">{workspace
        ? "Only the explicit destination and local branch below are approved. This does not move or fork the chat, change its cwd, run checks, integrate, clean up or publish remotely."
        : "Only the captured source history may be prepared onto this exact target-main tip. The target checkout/branch is not changed. No checks, integration, cleanup or remote publication are approved."}</p>
      {workspace?.parentCreation && <p className="mt-1 text-xs">Approval additionally creates exactly one expected-absent conventional parent: {workspace.parentCreation.path} (mode 0700). No missing ancestor chain is created.</p>}
      <p className="mt-1 text-xs text-text-muted">{request.expiresAt === undefined
        ? "Waits for your response or Stop; no automatic response timeout."
        : `Respond by ${new Date(request.expiresAt).toLocaleString()}.`}</p>
    </header>
    <div className="max-h-[min(65vh,680px)] space-y-3 overflow-y-auto px-4 py-3 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 break-all">
        <dt>Captured project</dt><dd>{candidate.projectRoot}</dd>
        <dt>Source checkout</dt><dd>{candidate.sourceCheckoutRoot}</dd>
        <dt>Common Git directory</dt><dd>{candidate.resourceAttribution.commonDir}</dd>
        {workspace && <>
          <dt>Request</dt><dd>{workspace.mode}</dd>
          <dt>Explicit destination</dt><dd>{workspace.destinationPath}</dd>
          <dt>Chosen local base</dt><dd>{workspace.baseBranch} · {workspace.baseOid}</dd>
          <dt>Intended branch/tip</dt><dd>{workspace.branch} · {workspace.tipOid}</dd>
          <dt>Expected tracked tree</dt><dd>{workspace.treeOid}</dd>
          {workspace.parentCreation && <>
            <dt>Additional parent creation</dt><dd>{workspace.parentCreation.path} · expected absent · mode 0700</dd>
            <dt>Existing physical ancestor</dt><dd>{workspace.parentCreation.ancestorPath} · {JSON.stringify(workspace.parentCreation.ancestorIdentity)}</dd>
          </>}
        </>}
        {candidate.kind === "preparation" && <>
          <dt>Source branch</dt><dd>{candidate.featureBranch}</dd>
          <dt>Target checkout/branch</dt><dd>{candidate.targetCheckoutRoot} · {candidate.targetBranch}</dd>
          <dt>Old source</dt><dd>{candidate.preparation.oldSourceOid}</dd>
          <dt>Intended new source</dt><dd>{candidate.preparation.newSourceOid}</dd>
          <dt>Target main</dt><dd>{candidate.preparation.targetMainOid}</dd>
          <dt>Expected result tree</dt><dd>{candidate.preparation.resultTreeOid}</dd>
          <dt>Empty retention</dt><dd>Keep empty replayed commits</dd>
          <dt>Source physical identity</dt><dd>{JSON.stringify(candidate.preparation.source)}</dd>
          <dt>Target physical identity</dt><dd>{JSON.stringify(candidate.preparation.target)}</dd>
        </>}
      </dl>
      {preparation && <>
        {preparation.commitCount === 0 ? <p>No rewrite proposed; source is already prepared.</p> : <>
          <p>Exact commit mapping (oldest first): {preparation.commitCount} commits</p>
          <ol className="space-y-2 break-all font-mono">{preparation.commitMapping.map((row) => <li key={row.oldOid}>
            {row.oldOid} → {row.newOid}<br />Trees: {row.oldTreeOid} → {row.newTreeOid}{row.emptyAfterReplay && " · empty commit retained"}
          </li>)}</ol>
        </>}
      </>}
      <p className="text-text-muted">No patch is included in this live request. Any captured immutable patch is available only on demand in history; current checkout content is not substituted.</p>
      <p className="text-text-muted">Approval is exact and single-use. Stale resources or changed OIDs must be refused; partial effects require manual recovery, not automatic retry.</p>
    </div>
    <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={() => onRespond(request, { cancelled: true })} className="rounded border border-border px-3 py-2">Decline {operation}</button>
      <button type="button" onClick={() => onRespond(request, { confirmed: true })} className="rounded bg-accent px-3 py-2 text-[var(--accent-contrast)]">Approve exact {operation}</button>
    </footer>
  </section>;
}

function VerificationAndCleanupAsk({ titleId, request, candidate, onRespond }: {
  titleId: string; request: Request; candidate: Extract<GitNativeActionCandidate, { kind: "checkout-verification" | "cleanup" }>;
  onRespond: (request: Request, response: { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const checks = candidate.kind === "checkout-verification" ? candidate.checkoutVerification : null;
  const cleanup = candidate.kind === "cleanup" ? candidate.cleanup : null;
  const approve = checks ? "Run these saved checks" : cleanup!.ignoredCount ? "Approve cleanup and delete ALL named ignored data" : "Approve exact local cleanup";
  return <section role="group" aria-labelledby={titleId} className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-bg text-sm text-text">
    <header className="border-b border-border px-4 py-3">
      <h3 id={titleId} className="font-semibold">{checks ? "Authorize saved checkout checks" : "Approve exact local cleanup"}</h3>
      <p className="mt-1 text-xs text-text-muted">{checks
        ? checks.evidenceScope === "clean-checkout"
          ? "Commands may execute project code and change files. Approval is only for these saved recipes in this selected physical clean checkout (native v2), not dirty working-workspace evidence, paired checks, a commit candidate tree, integration, cleanup or remote operation. No passing receipt is claimed."
          : "Commands may execute project code and change files. Approval is only for these saved recipes in this physical working workspace, not a commit candidate tree, integration, cleanup or remote operation. No passing receipt is claimed."
        : "Only this exact worktree and local branch may be removed. The named target/main checkouts survive. Generic Allow is not approval to delete ignored data; every named ignored entry below requires this exact approval."}</p>
      <p className="mt-1 text-xs text-text-muted">{request.expiresAt === undefined ? "Waits for your response or Stop; no automatic response timeout." : `Respond by ${new Date(request.expiresAt).toLocaleString()}.`}</p>
    </header>
    <div className="max-h-[min(65vh,680px)] space-y-3 overflow-y-auto px-4 py-3 text-xs">
      <p className="break-all">Captured project: {candidate.projectRoot}<br />Source checkout: {candidate.sourceCheckoutRoot}<br />Source branch: {candidate.featureBranch}</p>
      {checks && <>
        <p className="break-all">Source OID: {checks.sourceOid}<br />Source tree: {checks.sourceTreeOid}<br />Stage: {checks.stage}<br />Required saved indexes: {checks.requiredSavedIndexes.join(", ") || "none"}</p>
        <p>Evidence scope: {checks.evidenceScope} · candidateTreeVerified: false · repositoryChecksWaived: false</p>
        {checks.stage === "none" && <p>Manual-only optional checks. Any receipts are not integration prerequisites.</p>}
        <ol className="space-y-3">{checks.checks.map((row) => <li key={row.checkIndex} className="break-all">
          Saved index {row.checkIndex}: {row.recipe.label}<br />Recipe: <code>{JSON.stringify(row.recipe.argv)}</code><br />
          Checkout-relative cwd: {row.recipe.cwd ?? "."}<br />Execution cwd: {row.executionCwd}<br />
          Saved literal environment overrides: <code>{JSON.stringify(row.recipe.env ?? {})}</code><br />
          Recipe stage: {row.recipe.requiredStage ?? "integration"}<br />Recipe digest: {row.recipeDigest}
        </li>)}</ol>
        <p>No task or target checkout is assumed. Full process environment and logs are private, not included here.</p>
      </>}
      {cleanup && <>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 break-all">
          <dt>Remove source worktree</dt><dd>{cleanup.sourcePath} · {JSON.stringify(cleanup.source.checkoutIdentity)}</dd>
          <dt>Delete local branch</dt><dd>{cleanup.branchRef} · {cleanup.featureOid}</dd>
          <dt>Surviving target</dt><dd>{cleanup.targetPath} · {cleanup.targetOid}</dd>
          <dt>Surviving project main</dt><dd>{cleanup.mainPath} · {cleanup.mainOid}</dd>
          <dt>Completed safe integration</dt><dd>{cleanup.integration.delivery} · {cleanup.integration.method} · result {cleanup.integration.resultOid} · tree {cleanup.integration.resultTree}</dd>
          <dt>Workspace provenance</dt><dd>{cleanup.provenance.mode} · original source {cleanup.provenance.originalSourcePath} · {cleanup.provenance.branchRef}</dd>
        </dl>
        <p>ALL named ignored data ({cleanup.ignoredCount} entries):</p>
        {cleanup.ignoredCount ? <ul className="space-y-2 break-all">{cleanup.ignored.map((entry) => <li key={entry.path}>
          <code>{entry.path}</code> · {entry.kind} · {entry.size} bytes · instance {entry.device}:{entry.inode}:{entry.birthtime} · mode {entry.mode} · changed {entry.changed} · modified {entry.modified}
        </li>)}</ul> : <p>No ignored data was captured for deletion.</p>}
        <p>No deletion has happened yet. Each actual removal/ref deletion must be independently measured and recorded; partial effects require manual recovery, not retry.</p>
      </>}
      <p>No patch bytes or log contents are included in this live request.</p>
    </div>
    <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={() => onRespond(request, { cancelled: true })} className="rounded border border-border px-3 py-2">{checks ? "Decline checks" : "Decline cleanup"}</button>
      <button type="button" onClick={() => onRespond(request, { confirmed: true })} className="rounded bg-accent px-3 py-2 text-[var(--accent-contrast)]">{approve}</button>
    </footer>
  </section>;
}

/** Only live requests reach this card. New reviews do not request UI, but a pending
 * review from an older live wrapper must remain answerable across hot reload/reconnect. */
export function GitActionDialog({ request, onRespond }: {
  request: Request;
  onRespond: (request: Request, response: { confirmed: boolean } | { approvePlanId: string } | { preferences: AgentGitPreferenceChoice } | { cancelled: true }) => void;
}) {
  const titleId = useId();
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
  if (candidate.kind === "checkout-verification" || candidate.kind === "cleanup") {
    return <VerificationAndCleanupAsk titleId={titleId} request={request} candidate={candidate} onRespond={onRespond} />;
  }
  if (candidate.kind === "workspace" || candidate.kind === "preparation") {
    return <NativeGitActionDialog titleId={titleId} request={request} candidate={candidate} onRespond={onRespond} />;
  }
  return <section role="group" aria-labelledby={titleId} className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-bg text-sm text-text">
    <header className="border-b border-border px-4 py-3">
      <h3 id={titleId} className="font-semibold">{choosing ? "Choose Git workflow preferences" : committing ? "Review exact commit" : checking ? "Authorize ordered checks" : merging ? "method" in candidate.plan ? "Approve exact local fast-forward" : "Approve exact local merge" : "Review local Git comparison"}</h3>
      <p className="mt-1 text-xs text-text-muted">{choosing ? "These choices are saved for this chat only. No checks run and no commit, merge, cleanup or remote action is approved. Later actions require separate review and approval."
        : committing
        ? candidate.preview.mode === "staged"
          ? "Only the selected staged index entries and this exact message will be committed after your approval. Other staged and unstaged changes remain. No merge, cleanup or remote action."
          : "Only the selected complete working-tree files and this exact message will be committed after your approval. No merge, cleanup or remote action."
        : checking ? "These commands can execute project code and modify files. Approval here runs checks only, NOT the merge. No shell, cleanup or remote action."
        : merging ? "method" in candidate.plan
          ? "A separate approval of this exact plan fast-forwards the local target to the existing feature tip. No merge commit, cleanup or remote action."
          : "A separate approval of this exact plan updates the local target with an unsigned non-fast-forward merge. No cleanup or remote action."
        : "Earlier read-only comparison still waiting for a response. Continue or dismiss this pending request; neither authorizes a commit, merge, cleanup or remote action."}</p>
      <p className="mt-1 text-xs text-text-muted">{request.expiresAt === undefined
        ? "Waits for your response or Stop; no automatic response timeout."
        : `Respond by ${new Date(request.expiresAt).toLocaleString()}.`}</p>
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
        <p>Feature: {candidate.featureBranch} ({candidate.featureCwd}) → target: {candidate.targetBranch} ({candidate.targetCwd})</p>
        <p>Checks run in this order from the feature checkout:</p>
        <ol className="list-inside list-decimal space-y-2">{candidate.checks.map((check, i) => <li key={i} className="break-all">{check.label}<pre className="ml-4 whitespace-pre-wrap break-all font-mono">{JSON.stringify(check.argv)}</pre></li>)}</ol>
      </div> : merging ? <div className="space-y-3 text-xs">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 break-all">
          <dt>Feature</dt><dd>{candidate.plan.review.featureBranch} · {candidate.plan.review.featureOid} · {candidate.featureCwd}</dd>
          <dt>Target</dt><dd>{candidate.plan.review.targetBranch} · {candidate.plan.review.targetOid} · {candidate.targetCwd}</dd>
          <dt>Result tree</dt><dd>{candidate.plan.review.mergeTreeOid}</dd>
          {"method" in candidate.plan ? <>
            <dt>Fast-forward target to</dt><dd>{candidate.plan.featureOid}</dd>
            <dt>Existing tip parents</dt><dd>{candidate.plan.parents.join(", ")}</dd>
          </> : <>
            <dt>Merge commit</dt><dd>{candidate.plan.mergeOid}</dd>
            <dt>Message</dt><dd>{candidate.plan.message}</dd>
          </>}
          <dt>Plan ID</dt><dd className="font-mono">{candidate.plan.planId}</dd>
          <dt>Verification plan expires</dt><dd>{new Date(candidate.plan.expiresAt).toLocaleString()}</dd>
        </dl>
        <p>Waiting does not renew verification. If this plan or its check receipts expire, approval requires fresh checks and a new plan.</p>
        <p>Verified checks and process-local receipts (ordered):</p>
        <ol className="list-inside list-decimal space-y-2">{candidate.receipts.map((receipt) => <li key={receipt.id} className="break-all">
          <span className="font-mono">{JSON.stringify(receipt.argv)}</span> · receipt {receipt.id} · log SHA-256 {receipt.logDigest} · passed {new Date(receipt.finishedAt).toLocaleString()}
        </li>)}</ol>
      </div> : committing ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt>Checkout</dt><dd className="break-all">{candidate.preview.repositoryRoot}</dd>
        <dt>Commit source</dt><dd>{candidate.preview.mode === "staged" ? "Selected staged index entries" : "Complete working-tree files"}</dd>
        <dt>Branch</dt><dd className="break-all">{candidate.preview.branch}</dd>
        <dt>Parent</dt><dd className="break-all font-mono">{candidate.preview.head}</dd>
        <dt>Candidate tree</dt><dd className="break-all font-mono">{candidate.preview.tree}</dd>
        <dt>Selected {candidate.preview.mode === "staged" ? "staged index" : "whole-file"} paths</dt><dd className="break-all">{candidate.preview.paths.join(", ")}</dd>
        <dt>Message</dt><dd className="whitespace-pre-wrap break-words">{candidate.message}</dd>
      </dl> : <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt>Feature</dt><dd className="break-all">{candidate.review.featureBranch} · <span className="font-mono">{candidate.review.featureOid}</span> · {candidate.featureCwd}</dd>
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
        <MultiFileGitDiff {...(merging ? candidate.plan.diff : candidate.diff)} before={(merging ? candidate.plan.diff : candidate.diff).fromTreeOid} after={(merging ? candidate.plan.diff : candidate.diff).toTreeOid} />
      </details>}
    </div>
    {candidate.kind === "review" ? <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={() => onRespond(request, { cancelled: true })} className="rounded border border-border px-3 py-2">Dismiss pending comparison</button>
      <button type="button" onClick={() => onRespond(request, { confirmed: true })} className="rounded bg-accent px-3 py-2 text-[var(--accent-contrast)]">Continue read-only comparison</button>
    </footer> : <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
      <button type="button" onClick={() => onRespond(request, { cancelled: true })} className="rounded border border-border px-3 py-2">{choosing ? "Cancel" : committing ? "Decline commit" : checking ? "Decline checks" : merging ? "method" in candidate.plan ? "Decline fast-forward" : "Decline merge" : "Decline merge"}</button>
      <button type="button" disabled={choosing && !target} onClick={() => onRespond(request, choosing ? { preferences: { targetBranch: target, method: "merge", checkIndexes: selected, mode, cleanup } } : merging ? { approvePlanId: candidate.plan.planId } : { confirmed: true })}
        className="rounded bg-accent px-3 py-2 text-[var(--accent-contrast)] disabled:opacity-50">{choosing ? "Save chat preferences" : committing ? "Approve exact commit" : checking ? "Run these checks" : merging ? "method" in candidate.plan ? "Approve exact local fast-forward" : "Approve exact local merge" : "Approve exact local merge"}</button>
    </footer>}
  </section>;
}
