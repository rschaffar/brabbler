"use client";

import { useEffect, useId, useLayoutEffect, useState, type ComponentProps } from "react";
import type { GitActionCandidateSnapshot, GitActionCheckExecution, GitActionHistoryResponse, GitActionRecord, GitActionState } from "@/lib/git-action-types";
import { newestGitActionHistory, readGitActionHistory, watchGitActionHistory } from "@/hooks/git-action-history";
import { GitActionDialog } from "./GitActionDialog";
import { matchingLiveGitRequest, useGitActionContext } from "./GitActionContext";
import { MultiFileGitDiff } from "./MultiFileGitDiff";

const stateLabels: Record<GitActionState, string> = {
  proposed: "Proposed", "awaiting-decision": "Awaiting decision", executing: "Executing", succeeded: "Succeeded",
  declined: "Declined", cancelled: "Cancelled", expired: "Expired / interrupted", blocked: "Blocked", failed: "Failed", "recovery-required": "Recovery required",
};
const kindLabels = { commit: "Commit", review: "Git review", checks: "Checks", integration: "Local integration", workspace: "Workspace", preparation: "History preparation", "checkout-verification": "Checkout verification", cleanup: "Local cleanup" };
function actionStateLabel(record: GitActionRecord): string {
  // A captured comparison is not a human assessment of its patch. Preserve
  // the meaning of older read-only review acknowledgements in history.
  if (record.kind === "review" && record.state === "succeeded") {
    if (record.decision === undefined) return "Comparison captured";
    if (record.decision === "reviewed") return "Comparison acknowledged by human";
  }
  if (record.state === "succeeded" && record.kind === "workspace") {
    if (record.outcome?.kind !== "workspace") return "Outcome unconfirmed";
    return record.outcome.status === "created" ? "Created worktree" : record.outcome.status === "attached" ? "Attached worktree" : "Outcome unconfirmed";
  }
  if (record.state === "succeeded" && record.kind === "preparation") {
    if (record.outcome?.kind !== "preparation") return "Outcome unconfirmed";
    return record.outcome.status === "prepared" ? "Prepared history" : record.outcome.status === "already-prepared" ? "Already prepared (no rewrite)" : "Outcome unconfirmed";
  }
  if (record.state === "succeeded" && record.kind === "checkout-verification") return record.outcome?.kind === "checkout-verification" && record.outcome.status === "passed" && record.outcome.checkoutVerification?.runs.length
    ? record.outcome.checkoutVerification.evidenceScope === "clean-checkout" ? "Checks passed in selected clean checkout"
      : record.outcome.checkoutVerification.evidenceScope === "working-workspace" ? "Checks passed in working workspace" : "Outcome unconfirmed"
    : "Outcome unconfirmed";
  if (record.state === "succeeded" && record.kind === "cleanup") return record.outcome?.kind === "cleanup" && record.outcome.status === "cleaned-up" && record.outcome.cleanup?.effects.length === 2
    ? "Cleaned up local workspace" : "Outcome unconfirmed";
  return stateLabels[record.state];
}

export function GitActionCard({ actionId, timestamp, sessionId }: { actionId: string; timestamp?: number; sessionId?: string }) {
  const context = useGitActionContext();
  const currentSessionId = context?.sessionId ?? sessionId;
  const requestId = matchingLiveGitRequest(context?.liveRequest, actionId)?.id ?? "history";
  return <MountedGitActionCard key={`${currentSessionId}:${actionId}:${requestId}`} actionId={actionId} timestamp={timestamp} sessionId={currentSessionId} />;
}

function MountedGitActionCard({ actionId, timestamp, sessionId }: { actionId: string; timestamp?: number; sessionId?: string | null }) {
  const context = useGitActionContext();
  const registerAnchor = context?.registerAnchor;
  const [history, setHistory] = useState<GitActionHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [artifact, setArtifact] = useState<GitActionHistoryResponse | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  // Current server pending request owns its exact question. Optional/corrupt or
  // terminal history cannot create OR suppress that live request.
  const liveRequest = matchingLiveGitRequest(context?.liveRequest, actionId);
  useLayoutEffect(() => registerAnchor?.(actionId), [registerAnchor, actionId]);
  useEffect(() => {
    if (!sessionId) return;
    return watchGitActionHistory(sessionId, actionId, (next) => {
      setHistory((previous) => newestGitActionHistory(previous, next));
      setError(null);
    }, setError);
  }, [sessionId, actionId]);
  useEffect(() => {
    if (!expanded || !sessionId) return;
    const controller = new AbortController();
    setArtifactError(null);
    setArtifact(null);
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
  const request = matchingLiveGitRequest(liveRequest, actionId);
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
      {summary?.workingWorkspaceVerification && <p className="text-xs">Commit check evidence: working-workspace · candidateTreeVerified: false · repositoryChecksWaived: false · required saved indexes: {summary.workingWorkspaceVerification.requiredSavedIndexes.join(", ") || "none"}</p>}
      {record?.intended && <PreparedOutcome intended={record.intended} />}
      {record && <ActionOutcome record={record} />}
      {(record?.diagnostics?.status === "unavailable" || record?.outcome?.diagnostics?.status === "unavailable") && <p role="status" className="text-xs text-amber-500">Some history or check output is unavailable. This does not change the recorded Git outcome.</p>}
      {record?.reason && <p className="break-words text-xs">{record.reason}</p>}
      {record?.state === "recovery-required" && <p className="text-xs">Execution may have changed Git state. Inspect before any new action; this card cannot retry it.</p>}
      {!live && record && ["proposed", "awaiting-decision"].includes(record.state) && <p className="text-xs text-text-muted">Historical status only. No live approval request is attached.</p>}
      {error && <p role="status" className="break-words text-xs">{error}</p>}
      {!record && <p role="status" className="text-xs text-text-muted">{history ? history.unavailable || "Action record unavailable. Captured history has not been replaced with current Git data." : error ? "Action record unavailable." : "Loading action history…"}</p>}
    </header>
    {live && (request.candidate.kind === "workspace" || request.candidate.kind === "preparation") && <div className="border-t border-border px-4 py-2">
      <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle} className="text-xs text-accent">{expanded ? "Hide captured patch" : "Show captured patch"}</button>
      {expanded && <div id={detailId} className="mt-2">
        {artifactError || artifact?.unavailable ? <p role="status">Captured patch unavailable: {artifactError || artifact?.unavailable}. No current checkout data is substituted.</p>
          : !artifact ? <p role="status">Loading captured patch…</p>
          : artifact.record?.id === actionId && artifact.record.kind === request.candidate.kind && ["proposed", "awaiting-decision"].includes(artifact.record.state) && artifact.candidate?.diff
            ? <MultiFileGitDiff patch={artifact.candidate.diff.patch} hasBinaryChanges={artifact.candidate.diff.hasBinaryChanges} before={artifact.candidate.diff.fromTreeOid} after={artifact.candidate.diff.toTreeOid} />
            : <p role="status">No current captured patch is available. Historical data cannot replace the live candidate.</p>}
      </div>}
    </div>}
    {live ? <div inert={interactionBlocked} className="px-3"><GitActionDialog key={request.id} request={request} onRespond={onRespond} /></div> : record && <>
      <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle} className="w-full border-t border-border px-4 py-2 text-left text-xs text-accent hover:bg-bg-hover">
        {expanded ? "Hide captured candidate" : `Captured candidate${summary?.paths ? ` · ${summary.paths.length} file${summary.paths.length === 1 ? "" : "s"}` : ""}`}
      </button>
      {expanded && <div id={detailId} className="min-w-0 space-y-3 border-t border-border px-4 py-3">
        <CandidateDetails candidate={summary!} />
        {summary?.workingWorkspaceVerification && <CapturedCheckRuns runs={summary.workingWorkspaceVerification.runs} />}
        {artifact?.candidate?.cleanup?.ignored && <div className="text-xs">
          ALL captured ignored entries ({artifact.candidate.cleanup.ignoredCount})<ul className="max-h-48 overflow-auto break-all">{artifact.candidate.cleanup.ignored.map((entry) =>
            <li key={entry.path}>{entry.path} · {entry.kind} · {entry.size} bytes · {entry.device}:{entry.inode}:{entry.birthtime}</li>)}</ul>
        </div>}
        {artifact?.candidate?.preparation?.commitMapping && <details className="text-xs">
          <summary>Captured commit mapping · {artifact.candidate.preparation.commitCount} commits</summary>
          <ol className="max-h-48 overflow-auto break-all font-mono">{artifact.candidate.preparation.commitMapping.map((row) =>
            <li key={row.oldOid}>{row.oldOid} → {row.newOid}{row.emptyAfterReplay && " · empty commit retained"}</li>)}</ol>
        </details>}
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
          : <p className="text-xs text-text-muted">{(record.kind === "checks" || record.kind === "workspace" || record.kind === "preparation" || record.kind === "checkout-verification" || record.kind === "cleanup") && artifact.candidate ? "No immutable patch was captured for this action." : "Captured diff unavailable. No current worktree data is substituted."}</p>}
        <p className="text-xs text-text-dim">Captured hunks only, not full-file history. Private action artifacts are not included in the standard session HTML export.</p>
      </div>}
    </>}
  </section>;
}

function PreparedOutcome({ intended }: { intended: NonNullable<GitActionRecord["intended"]> }) {
  return <div className="space-y-1 break-all text-xs text-text-muted" aria-label="Prepared Git intent">
    <p>Prepared OIDs only — not confirmation of a ref or index update.</p>
    {intended.workspace && <><p>Intended destination: {intended.workspace.destinationPath}</p><p>Intended branch: {intended.workspace.branch} · {intended.workspace.tipOid}</p><p>Intended tracked tree: {intended.workspace.treeOid}</p></>}
    {intended.checkoutVerification && <p>Intended checks only — no run or passing receipt is claimed. Stage: {intended.checkoutVerification.stage} · source: {intended.checkoutVerification.sourceOid}</p>}
    {intended.cleanup && <p>Intended cleanup only — no deletion is claimed: {intended.cleanup.sourcePath} · {intended.cleanup.branchRef} · expected tip {intended.cleanup.featureOid}</p>}
    {intended.preparation && <><p>Intended source: {intended.preparation.oldSourceOid} → {intended.preparation.newSourceOid}</p><p>Intended target main: {intended.preparation.targetMainOid}</p><p>Intended result tree: {intended.preparation.resultTreeOid}</p></>}
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
  if (record.kind === "checkout-verification" && (outcome.kind !== record.kind || !outcome.checkoutVerification)) return <p className="text-xs">Outcome unconfirmed; no measured checkout-verification facts recorded.</p>;
  if (record.kind === "cleanup" && (outcome.kind !== record.kind || !outcome.cleanup)) return <p className="text-xs">Outcome unconfirmed; no measured cleanup facts recorded.</p>;
  if (record.kind === "checkout-verification") return <div className="space-y-1 break-all text-xs">
    <p>{record.state === "executing" ? "Measured check result (settlement pending)" : "Outcome"}: {outcome.status}</p>
    {record.state === "executing" && <p>Native settlement pending; proposed receipt metadata is not a published passing receipt.</p>}
    {record.state === "recovery-required" && <p>Native settlement unconfirmed; receipt metadata is not proof of publication.</p>}
    <p>Evidence scope: {outcome.checkoutVerification!.evidenceScope} · candidateTreeVerified: false · repositoryChecksWaived: false</p>
    {outcome.checkoutVerification!.evidenceScope === "clean-checkout" && <p>Independent native v2 clean-source checks only; not dirty working-workspace, paired checks or integration approval.</p>}
    <p>Required saved indexes: {outcome.checkoutVerification?.requiredSavedIndexes.join(", ") || "none"}</p>
    {outcome.checkoutVerification?.stage === "none" && <p>Manual-only optional receipts, not integration prerequisites.</p>}
    {outcome.checkoutVerification && <CapturedCheckRuns runs={outcome.checkoutVerification.runs} />}
  </div>;
  if (record.kind === "cleanup") return <div className="space-y-1 break-all text-xs">
    <p>Outcome: {outcome.status}</p>
    {outcome.cleanup?.effects.map((effect) => effect.kind === "worktree-removed" ? <p key={effect.kind}>Measured worktree/admin removal: {effect.sourcePath} · known source tip {effect.featureOid}</p>
      : <p key={effect.kind}>Measured local branch deletion: {effect.branchRef} · deleted tip {effect.deletedOid}</p>)}
    {outcome.cleanup?.observedFeatureOid !== undefined && <p>Observed recovery branch tip: {outcome.cleanup.observedFeatureOid ?? "absent"}</p>}
    {outcome.cleanup?.recovery && <p>Recovery phase: {outcome.cleanup.recovery.phase} · remove attempted {String(outcome.cleanup.recovery.removeAttempted)} · branch delete attempted {String(outcome.cleanup.recovery.branchDeleteAttempted)} · child termination confirmed {String(outcome.cleanup.recovery.childTerminationConfirmed)} · observed source absent {String(outcome.cleanup.recovery.sourceAbsent ?? "unknown")} · admin absent {String(outcome.cleanup.recovery.adminAbsent ?? "unknown")} · local ref absent {String(outcome.cleanup.recovery.featureRefAbsent ?? "unknown")}</p>}
    {outcome.status === "partial-state" && <p>Partial cleanup requires manual recovery; this card cannot retry it.</p>}
  </div>;
  if (record.kind === "workspace" || record.kind === "preparation") {
    const completed = record.state === "succeeded" && outcome.kind === record.kind
      && (record.kind === "workspace" ? ["created", "attached"] : ["prepared", "already-prepared"]).includes(outcome.status ?? "");
    return <div className="space-y-1 break-all text-xs">
      {outcome.status && <p>Outcome: {outcome.status}</p>}
      {!completed && <p>Completion is unconfirmed. Partial changes require manual recovery; do not retry this operation.</p>}
      {outcome.workspace?.addAttempted !== undefined && <p>Worktree add attempted: {String(outcome.workspace.addAttempted)}</p>}
      {outcome.workspace && Object.hasOwn(outcome.workspace, "observedBranchOid") && <p>Observed local branch: {outcome.workspace.observedBranchOid ?? "absent"}</p>}
      {outcome.workspace && Object.hasOwn(outcome.workspace, "destinationPresent") && <p>Destination present: {String(outcome.workspace.destinationPresent ?? "unknown")}</p>}
      {outcome.workspace?.parentCreationAttempted !== undefined && <p>Parent creation attempted: {String(outcome.workspace.parentCreationAttempted)} · phase {outcome.workspace.phase ?? "not recorded"}</p>}
      {outcome.workspace?.parentCreated !== undefined && <p>{outcome.workspace.knownParentCreation ? "Measured parent created" : "Native parent-created fact (physical identity unconfirmed)"}: {String(outcome.workspace.parentCreated)}{outcome.workspace.knownParentCreation && ` · ${outcome.workspace.knownParentCreation.path} · mode ${outcome.workspace.knownParentCreation.mode} · owner UID ${outcome.workspace.knownParentCreation.ownerUid} · instance ${JSON.stringify(outcome.workspace.knownParentCreation.identity)}`}</p>}
      {outcome.workspace && <><p>{completed ? "Worktree" : "Intended/recovery destination"}: {outcome.workspace.destinationPath}</p>
        <p>{completed ? "Branch" : "Bound expected branch"}: {outcome.workspace.branch} · <span className="font-mono">{outcome.workspace.tipOid}</span></p>
        <p>{completed ? "Result tree" : "Bound expected tree (not a verified destination tree)"}: {outcome.workspace.treeOid}</p></>}
      {outcome.preparation && <><p>Old source: <span className="font-mono">{outcome.preparation.oldSourceOid}</span></p>
        <p>{completed ? "New source" : "Observed/recovery source"}: <span className="font-mono">{outcome.preparation.newSourceOid}</span></p>
        <p>Target main: <span className="font-mono">{outcome.preparation.targetMainOid}</span></p>
        <p>{completed ? "Result tree" : "Observed/recovery tree"}: <span className="font-mono">{outcome.preparation.resultTreeOid}</span></p></>}
    </div>;
  }
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

function CapturedCheckRuns({ runs }: { runs: GitActionCheckExecution[] }) {
  return <div className="space-y-1 break-all text-xs">
    {runs.map((run) => <p key={run.checkIndex}>Actual saved index {run.checkIndex} · unit {run.unit} · exit {run.exitStatus ?? "unknown"} · containment complete {String(run.containmentComplete)}
      {run.cgroupIdentity && ` · cgroup ${run.cgroupIdentity}`}{run.launcherIdentity && ` · original launcher instance ${run.launcherIdentity}`}{run.invocation && ` · invocation ${run.invocation}`}{run.payload && ` · payload ${run.payload}`}
      {` · started ${run.startedAt} · finished ${run.finishedAt} · log ${run.logDigest} (${run.logBytes} bytes)`}
      {run.receipt && ` · captured receipt ${run.receipt.id} · digest ${run.receipt.sha256} · expires ${run.receipt.expiresAt}`}
      {run.diagnostics?.status === "unavailable" && <span className="text-amber-500"> · some diagnostics unavailable</span>}</p>)}
    <p>Captured process/log/receipt metadata only. No log contents, live receipt, integration approval or human acknowledgement is restored.</p>
  </div>;
}

function CandidateDetails({ candidate }: { candidate: Omit<GitActionCandidateSnapshot, "diff"> }) {
  return <div className="space-y-2 text-xs">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all">
      <dt>Legacy repositoryRoot (source)</dt><dd>{candidate.repositoryRoot}</dd>
      <dt>Captured project</dt><dd>{candidate.projectRoot ?? "Not recorded in this legacy action"}</dd>
      <dt>Source checkout</dt><dd>{candidate.sourceCheckoutRoot ?? `${candidate.repositoryRoot} (legacy repositoryRoot)`}</dd>
      {candidate.targetCheckoutRoot && <><dt>Target checkout</dt><dd>{candidate.targetCheckoutRoot}</dd></>}
      {candidate.workspace && <>
        <dt>Workspace request</dt><dd>{candidate.workspace.mode}</dd>
        <dt>Explicit destination</dt><dd>{candidate.workspace.destinationPath}</dd>
        <dt>Chosen local base</dt><dd>{candidate.workspace.baseBranch} · {candidate.workspace.baseOid}</dd>
        <dt>Intended branch/tip</dt><dd>{candidate.workspace.branch} · {candidate.workspace.tipOid}</dd>
        <dt>Expected tracked tree</dt><dd>{candidate.workspace.treeOid}</dd>
        {candidate.workspace.parentCreation && <><dt>Additional expected-absent parent</dt><dd>{candidate.workspace.parentCreation.path} · mode 0700 · ancestor {candidate.workspace.parentCreation.ancestorPath}</dd></>}
      </>}
      {candidate.preparation && <>
        <dt>Old source</dt><dd>{candidate.preparation.oldSourceOid}</dd>
        <dt>Intended new source</dt><dd>{candidate.preparation.newSourceOid}</dd>
        <dt>Target main</dt><dd>{candidate.preparation.targetMainOid}</dd>
        <dt>Intended result tree</dt><dd>{candidate.preparation.resultTreeOid}</dd>
        <dt>Replay</dt><dd>{candidate.preparation.commitCount} commits · retain empty commits</dd>
        <dt>Source Git directory</dt><dd>{candidate.preparation.source.gitDir}</dd>
        <dt>Target Git directory</dt><dd>{candidate.preparation.target.gitDir}</dd>
        <dt>Source physical instance</dt><dd>{JSON.stringify(candidate.preparation.source.checkoutIdentity)}</dd>
        <dt>Target physical instance</dt><dd>{JSON.stringify(candidate.preparation.target.checkoutIdentity)}</dd>
      </>}
      {candidate.parentOid && <><dt>Parent</dt><dd className="font-mono">{candidate.parentOid}</dd></>}
      {candidate.candidateTreeOid && <><dt>Candidate tree</dt><dd className="font-mono">{candidate.candidateTreeOid}</dd></>}
      {candidate.featureOid && <><dt>Feature</dt><dd className="font-mono">{candidate.featureOid}</dd></>}
      {candidate.targetOid && <><dt>Target</dt><dd className="font-mono">{candidate.targetOid}</dd></>}
      {candidate.integrationMethod && <><dt>Integration method</dt><dd>{candidate.integrationMethod === "ff" ? "Fast-forward to existing feature tip (no new merge commit)" : "Unsigned non-fast-forward merge"}</dd></>}
      {candidate.mergeOid && <><dt>Proposed merge</dt><dd className="font-mono">{candidate.mergeOid}</dd></>}
      {candidate.message && <><dt>Message</dt><dd className="whitespace-pre-wrap break-words">{candidate.message}</dd></>}
    </dl>
    {candidate.checkoutVerification && <div className="space-y-1 break-all">
      <p>Target-free {candidate.checkoutVerification.evidenceScope === "clean-checkout" ? "selected clean checkout (native v2)" : "working-workspace"} check capture · stage {candidate.checkoutVerification.stage}</p>
      <p>candidateTreeVerified: false · repositoryChecksWaived: false</p>
      <p>Source: {candidate.checkoutVerification.sourceOid} · tree {candidate.checkoutVerification.sourceTreeOid}</p>
      <p>Required saved indexes: {candidate.checkoutVerification.requiredSavedIndexes.join(", ") || "none"}</p>
      {candidate.checkoutVerification.stage === "none" && <p>Manual-only optional recipes, not integration prerequisites.</p>}
      <ol>{candidate.checkoutVerification.checks.map((row) => <li key={row.checkIndex}>Saved index {row.checkIndex} · {row.recipe.label} · {JSON.stringify(row.recipe.argv)} · cwd {row.executionCwd} · recipe {row.recipeDigest}{row.snapshot && ` · captured native manifest v2 · snapshot ${row.snapshot.head} · physical identity ${row.snapshot.checkoutIdentity}`}</li>)}</ol>
    </div>}
    {candidate.cleanup && <div className="space-y-1 break-all">
      <p>Captured source to remove: {candidate.cleanup.sourcePath} · {candidate.cleanup.branchRef} · {candidate.cleanup.featureOid}</p>
      <p>Surviving target: {candidate.cleanup.targetPath} · {candidate.cleanup.targetOid}</p>
      <p>Surviving main: {candidate.cleanup.mainPath} · {candidate.cleanup.mainOid}</p>
      <p>Completed integration evidence: {candidate.cleanup.integration.method} · result {candidate.cleanup.integration.resultOid} · tree {candidate.cleanup.integration.resultTree}</p>
      <p>Workspace provenance: {candidate.cleanup.provenance.mode} · {candidate.cleanup.provenance.originalSourcePath}</p>
      <p>Ignored entries: {candidate.cleanup.ignoredCount} · {candidate.cleanup.ignoredDeletion}. History never authorizes deletion.</p>
    </div>}
    {candidate.paths && <div>{candidate.commitMode === "staged" ? "Selected staged index paths" : candidate.commitMode === "whole-file" ? "Selected whole-file paths" : "Selected paths (legacy mode not recorded)"}<ul className="max-h-48 overflow-auto font-mono">{candidate.paths.map((path) => <li key={path} className="break-all">{path}</li>)}</ul></div>}
    {candidate.selection && <p className="break-all">Comparison: {candidate.selection.kind === "merge" ? "Target tree → proposed merge-result tree" : `Consecutive commits: ${candidate.selection.commitOids.join(", ")}`}</p>}
    {candidate.checks && <ol className="list-inside list-decimal">{candidate.checks.map((check, index) => <li key={index} className="break-all">{check.label} · <code>{JSON.stringify(check.argv)}</code></li>)}</ol>}
  </div>;
}
