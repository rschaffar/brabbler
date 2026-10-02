"use client";

import { useEffect, useId, useLayoutEffect, useState, type ComponentProps } from "react";
import type { GitActionCandidateSnapshot, GitActionHistoryResponse, GitActionRecord, GitActionState } from "@/lib/git-action-types";
import { newestGitActionHistory, readGitActionHistory, watchGitActionHistory } from "@/hooks/git-action-history";
import { GitActionDialog } from "./GitActionDialog";
import { matchingLiveGitRequest, useGitActionContext } from "./GitActionContext";
import { MultiFileGitDiff } from "./MultiFileGitDiff";

const stateLabels: Record<GitActionState, string> = {
  proposed: "Proposed", "awaiting-decision": "Awaiting decision", executing: "Executing", succeeded: "Succeeded",
  declined: "Declined", cancelled: "Cancelled", expired: "Expired / interrupted", blocked: "Blocked", failed: "Failed", "recovery-required": "Recovery required",
};
const kindLabels = { commit: "Commit", review: "Git review", checks: "Checks", integration: "Local integration" };
function actionStateLabel(record: GitActionRecord): string {
  // A captured comparison is not a human assessment of its patch. Preserve
  // the meaning of older read-only review acknowledgements in history.
  if (record.kind === "review" && record.state === "succeeded") {
    if (record.decision === undefined) return "Comparison captured";
    if (record.decision === "reviewed") return "Comparison acknowledged by human";
  }
  return stateLabels[record.state];
}

export function GitActionCard({ actionId, timestamp, sessionId }: { actionId: string; timestamp?: number; sessionId?: string }) {
  const context = useGitActionContext();
  const currentSessionId = context?.sessionId ?? sessionId;
  return <MountedGitActionCard key={`${currentSessionId}:${actionId}`} actionId={actionId} timestamp={timestamp} sessionId={currentSessionId} />;
}

function MountedGitActionCard({ actionId, timestamp, sessionId }: { actionId: string; timestamp?: number; sessionId?: string | null }) {
  const context = useGitActionContext();
  const registerAnchor = context?.registerAnchor;
  const [history, setHistory] = useState<GitActionHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [artifact, setArtifact] = useState<GitActionHistoryResponse | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const liveRequest = history?.record === null ? null : matchingLiveGitRequest(context?.liveRequest, actionId, history?.record?.state);
  useLayoutEffect(() => registerAnchor?.(actionId), [registerAnchor, actionId]);
  useEffect(() => {
    if (!sessionId) return;
    return watchGitActionHistory(sessionId, actionId, (next) => {
      setHistory((previous) => newestGitActionHistory(previous, next));
      setError(null);
    }, setError);
  }, [sessionId, actionId]);
  useEffect(() => {
    if (!expanded || !sessionId || liveRequest) return;
    const controller = new AbortController();
    setArtifactError(null);
    void readGitActionHistory(sessionId, actionId, true, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      // Metadata polling owns state. A slower artifact read must not restore
      // an older pending record (including equal-revision restart projections).
      setArtifact(next);
    }, (failure: unknown) => {
      if (!controller.signal.aborted) setArtifactError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => controller.abort();
  }, [expanded, sessionId, actionId, liveRequest]);

  return <div ref={liveRequest && context?.questionCardRef ? (node) => { context.questionCardRef!.current = node; } : undefined} className="min-w-0 scroll-mt-4">
    <GitActionCardView actionId={actionId} timestamp={timestamp} history={history} error={sessionId ? error : "No session is available to read this action."}
      expanded={expanded} onToggle={() => setExpanded((value) => !value)} artifact={artifact} artifactError={artifactError}
      liveRequest={liveRequest} onRespond={context?.onRespond} interactionBlocked={context?.interactionBlocked} />
  </div>;
}

/** Display records never synthesize a request, response token or approval button. */
export function GitActionCardView({ actionId, timestamp, history, error, expanded, onToggle, artifact, artifactError, liveRequest, onRespond, interactionBlocked }: {
  actionId: string; timestamp?: number; history: GitActionHistoryResponse | null; error?: string | null;
  expanded: boolean; onToggle: () => void; artifact: GitActionHistoryResponse | null; artifactError?: string | null;
  liveRequest?: ComponentProps<typeof GitActionDialog>["request"] | null;
  onRespond?: ComponentProps<typeof GitActionDialog>["onRespond"]; interactionBlocked?: boolean;
}) {
  const titleId = useId();
  const detailId = useId();
  const record = history?.record;
  const request = record === null ? null : matchingLiveGitRequest(liveRequest, actionId, record?.state);
  const live = request && onRespond;
  const summary = record?.summary;
  const time = record?.updatedAt ?? timestamp;
  const warning = record && ["recovery-required", "failed", "blocked", "expired"].includes(record.state);
  return <section role="group" aria-labelledby={titleId} data-git-action-id={actionId} className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-bg-panel text-sm text-text">
    <header className="space-y-1 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="font-semibold">{record ? kindLabels[record.kind] : "Git action"}{record && <span className={warning ? "ml-2 text-[var(--error)]" : "ml-2 font-normal text-text-muted"}>{actionStateLabel(record)}</span>}</h3>
        {time !== undefined && <time dateTime={new Date(time).toISOString()} title={new Date(time).toLocaleString()} className="text-xs text-text-muted">{new Date(time).toLocaleTimeString()}</time>}
      </div>
      {summary && <div className="break-all text-xs text-text-muted">
        {summary.projectRoot ? <p>Captured project: {summary.projectRoot}</p> : <p>Captured project: not recorded (legacy action)</p>}
        <p>Source checkout: {summary.sourceCheckoutRoot ?? `${summary.repositoryRoot} (legacy repositoryRoot)`}{summary.featureBranch && ` · ${summary.featureBranch}`}</p>
        {summary.targetCheckoutRoot && <p>Target checkout: {summary.targetCheckoutRoot}{summary.targetBranch && ` · ${summary.targetBranch}`}</p>}
        {summary.targetBranch && !summary.targetCheckoutRoot && <p>Target branch: {summary.targetBranch} (checkout not recorded)</p>}
      </div>}
      {summary?.message && <p className="line-clamp-2 whitespace-pre-wrap break-words">{summary.message}</p>}
      {record?.intended && <PreparedOutcome intended={record.intended} />}
      {record && <ActionOutcome record={record} />}
      {record?.reason && <p className="break-words text-xs">{record.reason}</p>}
      {record?.state === "recovery-required" && <p className="text-xs">Execution may have changed Git state. Inspect before any new action; this card cannot retry it.</p>}
      {!live && record && ["proposed", "awaiting-decision"].includes(record.state) && <p className="text-xs text-text-muted">Historical status only. No live approval request is attached.</p>}
      {error && <p role="status" className="break-words text-xs">{error}</p>}
      {!record && <p role="status" className="text-xs text-text-muted">{history ? history.unavailable || "Action record unavailable. Captured history has not been replaced with current Git data." : error ? "Action record unavailable." : "Loading action history…"}</p>}
    </header>
    {live ? <div inert={interactionBlocked} className="px-3"><GitActionDialog key={request.id} request={request} onRespond={onRespond} /></div> : record && <>
      <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle} className="w-full border-t border-border px-4 py-2 text-left text-xs text-accent hover:bg-bg-hover">
        {expanded ? "Hide captured candidate" : `Captured candidate${summary?.paths ? ` · ${summary.paths.length} file${summary.paths.length === 1 ? "" : "s"}` : ""}`}
      </button>
      {expanded && <div id={detailId} className="min-w-0 space-y-3 border-t border-border px-4 py-3">
        <CandidateDetails candidate={summary!} />
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all text-xs text-text-muted">
          <dt>Action</dt><dd className="font-mono">{actionId}</dd>
          <dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString()}</dd>
          <dt>Updated</dt><dd>{new Date(record.updatedAt).toLocaleString()}</dd>
          <dt>Origin</dt><dd>{record.source}{record.decision && ` · decision: ${record.decision}`}</dd>
        </dl>
        {artifactError || artifact?.unavailable || artifact?.candidate?.diffUnavailable
          ? <p role="status" className="text-xs">Captured artifact unavailable: {artifactError || artifact?.unavailable || artifact?.candidate?.diffUnavailable}. No current worktree data is substituted.</p>
          : !artifact ? <p role="status" className="text-xs text-text-muted">Loading captured artifact…</p>
          : artifact.candidate?.diff ? <MultiFileGitDiff patch={artifact.candidate.diff.patch} hasBinaryChanges={artifact.candidate.diff.hasBinaryChanges} before={artifact.candidate.diff.fromTreeOid} after={artifact.candidate.diff.toTreeOid} />
          : <p className="text-xs text-text-muted">{record.kind === "checks" && artifact.candidate ? "This captured check request has no file diff." : "Captured diff unavailable. No current worktree data is substituted."}</p>}
        <p className="text-xs text-text-dim">Captured hunks only, not full-file history. Private action artifacts are not included in the standard session HTML export.</p>
      </div>}
    </>}
  </section>;
}

function PreparedOutcome({ intended }: { intended: NonNullable<GitActionRecord["intended"]> }) {
  return <div className="space-y-1 break-all text-xs text-text-muted" aria-label="Prepared Git intent">
    <p>Prepared OIDs only — not confirmation of a ref or index update.</p>
    {intended.commit && <p>Prepared commit: <span className="font-mono">{intended.commit}</span></p>}
    {intended.mergeOid && <p>Prepared merge: <span className="font-mono">{intended.mergeOid}</span></p>}
    {intended.tree && <p>Prepared tree: <span className="font-mono">{intended.tree}</span></p>}
    {intended.parents?.length ? <p>Prepared parents: <span className="font-mono">{intended.parents.join(", ")}</span></p> : null}
    {intended.featureOid && <p>Prepared feature: <span className="font-mono">{intended.featureOid}</span></p>}
    {intended.targetOid && <p>Prepared target: <span className="font-mono">{intended.targetOid}</span></p>}
    {intended.authorEmail && <p>Prepared author: {intended.authorEmail}</p>}
  </div>;
}

function ActionOutcome({ record }: { record: GitActionRecord }) {
  const outcome = record.outcome;
  if (!outcome) return null;
  // Native partial-state may mean only checkout files changed; mergeOid is
  // the prepared object's identity, not proof that update-ref was reached.
  const unconfirmed = outcome.status === "partial-state" || (record.kind === "integration" && outcome.status !== "integrated");
  return <div className="space-y-1 break-all text-xs">
    {outcome.status && <p>Outcome: {outcome.status}</p>}
    {unconfirmed && <p>Ref/index completion is unconfirmed; files may have changed.</p>}
    {outcome.commit && <p>{unconfirmed ? "Proposed/recovery commit" : "Commit"}: <span className="font-mono">{outcome.commit}</span></p>}
    {outcome.mergeOid && <p>{unconfirmed ? "Proposed/recovery merge" : "Merged commit"}: <span className="font-mono">{outcome.mergeOid}</span></p>}
    {outcome.tree && <p>{unconfirmed ? "Proposed/recovery tree" : "Result tree"}: <span className="font-mono">{outcome.tree}</span></p>}
    {outcome.parents?.length ? <p>{unconfirmed ? "Proposed/recovery parents" : "Parents"}: <span className="font-mono">{outcome.parents.join(", ")}</span></p> : null}
    {outcome.authorEmail && <p>{unconfirmed ? "Prepared author" : "Author"}: {outcome.authorEmail}</p>}
  </div>;
}

function CandidateDetails({ candidate }: { candidate: Omit<GitActionCandidateSnapshot, "diff"> }) {
  return <div className="space-y-2 text-xs">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all">
      <dt>Legacy repositoryRoot (source)</dt><dd>{candidate.repositoryRoot}</dd>
      <dt>Captured project</dt><dd>{candidate.projectRoot ?? "Not recorded in this legacy action"}</dd>
      <dt>Source checkout</dt><dd>{candidate.sourceCheckoutRoot ?? `${candidate.repositoryRoot} (legacy repositoryRoot)`}</dd>
      {candidate.targetCheckoutRoot && <><dt>Target checkout</dt><dd>{candidate.targetCheckoutRoot}</dd></>}
      {candidate.parentOid && <><dt>Parent</dt><dd className="font-mono">{candidate.parentOid}</dd></>}
      {candidate.candidateTreeOid && <><dt>Candidate tree</dt><dd className="font-mono">{candidate.candidateTreeOid}</dd></>}
      {candidate.featureOid && <><dt>Feature</dt><dd className="font-mono">{candidate.featureOid}</dd></>}
      {candidate.targetOid && <><dt>Target</dt><dd className="font-mono">{candidate.targetOid}</dd></>}
      {candidate.integrationMethod && <><dt>Integration method</dt><dd>{candidate.integrationMethod === "ff" ? "Fast-forward to existing feature tip (no new merge commit)" : "Unsigned non-fast-forward merge"}</dd></>}
      {candidate.mergeOid && <><dt>Proposed merge</dt><dd className="font-mono">{candidate.mergeOid}</dd></>}
      {candidate.message && <><dt>Message</dt><dd className="whitespace-pre-wrap break-words">{candidate.message}</dd></>}
    </dl>
    {candidate.paths && <div>{candidate.commitMode === "staged" ? "Selected staged index paths" : candidate.commitMode === "whole-file" ? "Selected whole-file paths" : "Selected paths (legacy mode not recorded)"}<ul className="max-h-48 overflow-auto font-mono">{candidate.paths.map((path) => <li key={path} className="break-all">{path}</li>)}</ul></div>}
    {candidate.selection && <p className="break-all">Comparison: {candidate.selection.kind === "merge" ? "Target tree → proposed merge-result tree" : `Consecutive commits: ${candidate.selection.commitOids.join(", ")}`}</p>}
    {candidate.checks && <ol className="list-inside list-decimal">{candidate.checks.map((check, index) => <li key={index} className="break-all">{check.label} · <code>{JSON.stringify(check.argv)}</code></li>)}</ol>}
  </div>;
}
