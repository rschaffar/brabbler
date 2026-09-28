"use client";

import { useEffect, useRef, useState } from "react";
import type { GitReview, GitReviewDiff, GitReviewSelection } from "@/lib/git-review";
import type { IntegrationPlan, IntegrationResult } from "@/lib/git-integration";

type ReceiptMetadata = { id: string; checkIndex: number; startedAt: number; finishedAt: number; logDigest: string };
type IntegrationStatus = {
  review: GitReview;
  checks: { checkIndex: number; label: string }[];
  receipts: ReceiptMetadata[];
};
type Proposal = { actionId: string; plan: IntegrationPlan; viewed: boolean };
type IntegrationResponse = IntegrationResult & { actionId: string; recoveryWarning?: string };

export function proposalMatches(plan: IntegrationPlan, review: GitReview, sessionId: string, receipts: ReceiptMetadata[]): boolean {
  return !!plan && !!plan.planId && plan.sessionId === sessionId && plan.expiresAt > Date.now() &&
    sameReview(plan.review, review) && Array.isArray(plan.receiptIds) &&
    plan.receiptIds.length === receipts.length && plan.receiptIds.every((id, index) => id === receipts[index].id) &&
    plan.diff?.fromTreeOid === review.targetTreeOid && plan.diff.toTreeOid === review.featureTreeOid &&
    typeof plan.diff.patch === "string" && new TextEncoder().encode(plan.diff.patch).byteLength <= MAX_PATCH_BYTES;
}

function sameReview(left: GitReview, right: GitReview): boolean {
  return left.featureBranch === right.featureBranch && left.targetBranch === right.targetBranch &&
    left.featureOid === right.featureOid && left.targetOid === right.targetOid &&
    left.featureTreeOid === right.featureTreeOid && left.targetTreeOid === right.targetTreeOid &&
    left.mergeTreeOid === right.mergeTreeOid;
}

export function matchingReceipts(status: IntegrationStatus, review: GitReview): ReceiptMetadata[] | null {
  if (!status.checks.length || !sameReview(status.review, review)) return null;
  const matches = status.checks.map((check, index) => status.receipts.findLast((receipt) =>
    check.checkIndex === index && receipt.checkIndex === index && receipt.finishedAt <= Date.now() &&
    Date.now() - receipt.finishedAt < 15 * 60_000));
  return matches.every((receipt) => receipt !== undefined) ? matches as ReceiptMetadata[] : null;
}

type Props = { sessionId: string; cwd: string };
type Choice = { kind: "merge" } | { kind: "commits"; start: number; end: number };
const MAX_PATCH_BYTES = 1024 * 1024;
const oversizedPatchMessage = "Patch exceeds 1 MB; no partial patch is shown. Select a smaller consecutive range.";

/** Ranges are inclusive, ordered oldest → newest, and never skip a commit. */
export function reviewSelection(review: GitReview, choice: Choice): GitReviewSelection | null {
  if (choice.kind === "merge") return { kind: "merge" };
  const { start, end } = choice;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= review.commits.length) return null;
  return { kind: "commits", commitOids: review.commits.slice(start, end + 1).map((commit) => commit.oid) };
}

function expectedTrees(review: GitReview, choice: Choice): { from: string; to: string } | null {
  if (choice.kind === "merge") return { from: review.targetTreeOid, to: review.mergeTreeOid };
  if (!reviewSelection(review, choice)) return null;
  return {
    from: choice.start === 0 ? review.targetTreeOid : review.commits[choice.start - 1].treeOid,
    to: review.commits[choice.end].treeOid,
  };
}

async function bodyOrError<T>(response: Response, sessionId?: string): Promise<T> {
  const body = await response.json() as T & { error?: string; recoveryRequired?: boolean; recoveryWarning?: string };
  if (sessionId) window.dispatchEvent(new CustomEvent("pi-web:git-actions-changed", { detail: { sessionId } }));
  if (!response.ok) throw Object.assign(new Error(body.recoveryWarning ?? body.error ?? `HTTP ${response.status}`),
    { status: response.status, recoveryRequired: body.recoveryRequired });
  return body;
}

/** Session-scoped read-only comparisons and separately approved local integration. */
export function GitMergeReviewPanel({ sessionId, cwd }: Props) {
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState<GitReview | null>(null);
  const [choice, setChoice] = useState<Choice>({ kind: "merge" });
  const [anchor, setAnchor] = useState<number | null>(null);
  const [diff, setDiff] = useState<GitReviewDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [result, setResult] = useState<IntegrationResponse | null>(null);
  const [operation, setOperation] = useState<"verify" | "plan" | "confirm" | null>(null);
  const [blocked, setBlocked] = useState(false);
  const operationRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const integrationGeneration = useRef(0);

  function invalidateIntegration() {
    integrationGeneration.current++;
    setProposal(null);
    setIntegration(null);
  }

  function invalidateDiff() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setDiff(null);
    setDiffLoading(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/git/review?${new URLSearchParams({ sessionId })}`, { cache: "no-store", signal: controller.signal })
      .then(bodyOrError<{ review: GitReview }>)
      .then((body) => {
        if (controller.signal.aborted) return;
        setReview(body.review);
        setChoice({ kind: "merge" });
        setAnchor(null);
        setError(null);
      }).catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setReview(null);
        setError(cause instanceof Error ? cause.message : "Review unavailable");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    const version = integrationGeneration.current;
    void fetch(`/api/git/integration?${new URLSearchParams({ sessionId })}`, { cache: "no-store", signal: controller.signal })
      .then(bodyOrError<IntegrationStatus>)
      .then((body) => {
        if (controller.signal.aborted || version !== integrationGeneration.current) return;
        setIntegration(body);
        setIntegrationError(null);
      }).catch((cause: unknown) => {
        if (controller.signal.aborted || version !== integrationGeneration.current) return;
        setIntegration(null);
        setIntegrationError(cause instanceof Error ? cause.message : "Integration unavailable");
      });
    return () => controller.abort();
  }, [revision, sessionId]);

  const selection = review && reviewSelection(review, choice);
  const trees = review && expectedTrees(review, choice);

  function refresh() {
    if (operationRef.current) return;
    invalidateDiff();
    invalidateIntegration();
    setBlocked(false);
    setIntegrationError(null);
    setReview(null);
    setChoice({ kind: "merge" });
    setAnchor(null);
    setError(null);
    setRevision((value) => value + 1);
  }

  function choose(next: Choice, nextAnchor: number | null = null) {
    invalidateDiff();
    setChoice(next);
    setAnchor(nextAnchor);
    setError(null);
  }

  async function integrationAction(action: "verify" | "plan" | "confirm", checkIndex?: number) {
    if (operationRef.current || blocked || result || !review || !integration || !sameReview(integration.review, review)) return;
    const receipts = matchingReceipts(integration, review);
    if (action === "plan" && !receipts) return;
    if (action === "confirm" && (!proposal?.viewed || !proposal.actionId || !receipts || !proposalMatches(proposal.plan, review, sessionId, receipts))) return;
    if (action === "verify" && (checkIndex === undefined || !integration.checks[checkIndex])) return;
    operationRef.current = true;
    const version = ++integrationGeneration.current;
    setOperation(action);
    setIntegrationError(null);
    if (action !== "confirm") setProposal(null);
    try {
      const payload = action === "verify" ? { sessionId, operation: "verify", checkIndex }
        : action === "plan" ? { sessionId, operation: "plan", receiptIds: receipts!.map((receipt) => receipt.id) }
          : { sessionId, operation: "confirm", planId: proposal!.plan.planId, approvePlanId: proposal!.plan.planId, actionId: proposal!.actionId };
      const response = await fetch("/api/git/integration", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (action === "verify") {
        const body = await bodyOrError<{ receipt: ReceiptMetadata; recoveryWarning?: string }>(response, sessionId);
        if (version !== integrationGeneration.current) return;
        if (body.recoveryWarning) { setIntegrationError(body.recoveryWarning); setBlocked(true); return; }
        // Reload the server's matching receipts rather than trusting a locally cached result.
        const latest = await bodyOrError<IntegrationStatus>(await fetch(`/api/git/integration?${new URLSearchParams({ sessionId })}`, { cache: "no-store" }));
        if (version !== integrationGeneration.current) return;
        if (sameReview(latest.review, review) && body.receipt.id && latest.receipts.some((receipt) => receipt.id === body.receipt.id)) setIntegration(latest);
        else throw new Error("Verification receipt no longer matches this checkout. Refresh before continuing.");
      } else if (action === "plan") {
        const body = await bodyOrError<{ plan: IntegrationPlan; actionId: string }>(response, sessionId);
        if (version !== integrationGeneration.current) return;
        const plan = body.plan;
        if (!proposalMatches(plan, review, sessionId, receipts!)) {
          throw new Error("Proposal identities or candidate patch do not match the review. Refresh before continuing.");
        }
        setProposal({ plan, actionId: body.actionId, viewed: false });
      } else {
        const body = await bodyOrError<IntegrationResponse>(response, sessionId);
        // Never hide a reported partial-state, even if the panel was closed while applying.
        if (body.status !== "integrated" && body.status !== "partial-state") throw new Error("Unexpected integration result; inspect both worktrees");
        setResult(body);
        setProposal(null);
        setBlocked(true);
        setReview(null);
      }
    } catch (cause) {
      if (version === integrationGeneration.current) {
        setProposal(null);
        setBlocked(true);
        const failure = cause as Error & { status?: number; recoveryRequired?: boolean };
        setIntegrationError(`${cause instanceof Error ? cause.message : "Integration unavailable"}. ${failure.recoveryRequired || action === "confirm" && failure.status === undefined
          ? "Inspect both worktrees and refs before any further action; do not retry blindly."
          : action === "confirm" ? "Refresh review and prepare a new proposal."
            : "Checks can modify the checkout; inspect both worktrees, then refresh and verify again."}`);
      }
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  }

  async function showPatch() {
    if (!review || !selection || !trees || diffLoading || loading) return;
    invalidateDiff();
    const version = generation.current;
    const controller = new AbortController();
    request.current = controller;
    setDiffLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/git/review", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ sessionId, expectedFeatureOid: review.featureOid, expectedTargetOid: review.targetOid, selection }),
      });
      const body = await bodyOrError<{ diff: GitReviewDiff }>(response, sessionId);
      if (generation.current === version && !controller.signal.aborted) {
        if (body.diff.fromTreeOid !== trees.from || body.diff.toTreeOid !== trees.to) {
          setReview(null);
          invalidateIntegration();
          setError("Comparison identities changed. Refresh before reviewing again.");
        } else if (new TextEncoder().encode(body.diff.patch).byteLength > MAX_PATCH_BYTES) setError(oversizedPatchMessage);
        else setDiff(body.diff);
      }
    } catch (cause) {
      if (generation.current !== version || controller.signal.aborted) return;
      const failure = cause as Error & { status?: number };
      if (failure.status === 409) {
        // Never keep showing a patch or snapshot after a stale-ref response.
        setReview(null);
        invalidateIntegration();
        setError("Review is stale. Refresh to load the current branch tips before reviewing again.");
      } else {
        setError(failure.status === 413 ? oversizedPatchMessage : failure.message);
      }
    } finally {
      if (generation.current === version) { request.current = null; setDiffLoading(false); }
    }
  }

  return <section className="git-panel-content min-w-0 text-sm text-text" aria-label="Local integration review">
    <div className="min-w-0 space-y-2">
      <p className="text-xs text-text-muted">Session checkout: <span className="break-all font-mono">{cwd}</span>. Branches are read from this persisted session and its local integration policy, not chosen here.</p>
      <p className="text-xs text-amber-500">Patches below are read-only comparisons of committed trees, not uncommitted checkout files. Verification, proposal and integration are separate explicit actions.</p>
      <button type="button" disabled={operation !== null} onClick={refresh} className="min-h-8 text-xs text-accent hover:underline disabled:opacity-50">Refresh review</button>
      {loading && <p role="status">Loading local branches and commit identities…</p>}
      {error && <p role="alert" className="break-words text-red-400">{error}</p>}
      {!loading && review && <div className="min-w-0 space-y-2">
        <dl className="min-w-0 break-all rounded border border-border p-2 font-mono text-xs">
          <dt>Feature branch</dt><dd>{review.featureBranch}</dd>
          <dt>Expected feature commit OID</dt><dd>{review.featureOid}</dd>
          <dt>Feature tree OID</dt><dd>{review.featureTreeOid}</dd>
          <dt>Target branch</dt><dd>{review.targetBranch}</dd>
          <dt>Expected target commit OID</dt><dd>{review.targetOid}</dd>
          <dt>Target tree OID</dt><dd>{review.targetTreeOid}</dd>
          <dt>Whole merge result tree OID</dt><dd>{review.mergeTreeOid}</dd>
        </dl>
        <fieldset className="space-y-2 rounded border border-border p-2">
          <legend className="font-medium">Select a read-only patch</legend>
          <label className="flex items-center gap-2"><input type="radio" name={`review-${sessionId}`} checked={choice.kind === "merge"} onChange={() => choose({ kind: "merge" })} /> Whole merge (target tree → merge result tree)</label>
          <p className="text-xs text-text-muted">Commits are oldest → newest on the feature’s first-parent chain. A range is cumulative and consecutive: it compares the tree before the first selected commit with the last selected commit’s tree, not separate patches or a cherry-pick preview. Click one commit for an individual patch; Shift-click another for a contiguous range, or use Start / End.</p>
          {review.commits.length === 0 ? <p>No commits after target on the feature branch.</p> : <>
            <ol className="max-h-44 min-w-0 list-decimal space-y-1 overflow-y-auto pl-6">
              {review.commits.map((commit, index) => <li key={commit.oid} className="min-w-0">
                <button type="button" aria-pressed={choice.kind === "commits" && index >= choice.start && index <= choice.end}
                  onClick={(event) => {
                    const start = event.shiftKey && anchor !== null ? Math.min(anchor, index) : index;
                    const end = event.shiftKey && anchor !== null ? Math.max(anchor, index) : index;
                    choose({ kind: "commits", start, end }, event.shiftKey && anchor !== null ? anchor : index);
                  }} className="max-w-full min-w-0 break-all rounded px-1 text-left font-mono text-xs text-accent hover:underline aria-pressed:bg-bg-selected">
                  Commit {index + 1}: {commit.oid} (tree {commit.treeOid}; parent {commit.parentOid})
                </button>
              </li>)}
            </ol>
            <div className="flex flex-wrap gap-2 text-xs">
              {(["start", "end"] as const).map((edge) => <label key={edge} className="flex items-center gap-1">{edge === "start" ? "Start" : "End"}
                <select className="min-w-0 max-w-full rounded border border-border bg-bg p-1 text-text" value={choice.kind === "commits" ? choice[edge] : ""}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    const old = choice.kind === "commits" ? choice : { kind: "commits" as const, start: index, end: index };
                    choose({ kind: "commits", start: Math.min(index, old[edge === "start" ? "end" : "start"]), end: Math.max(index, old[edge === "start" ? "end" : "start"]) }, index);
                  }}>
                  <option value="" disabled>Choose commit</option>
                  {review.commits.map((commit, index) => <option key={commit.oid} value={index}>{index + 1}: {commit.oid.slice(0, 12)}</option>)}
                </select>
              </label>)}
            </div>
          </>}
        </fieldset>
        {trees && <p className="break-all font-mono text-xs">Expected comparison trees: {trees.from} → {trees.to}</p>}
        <button type="button" disabled={!selection || diffLoading} onClick={() => void showPatch()} className="min-h-8 rounded border border-border px-3 text-accent disabled:opacity-50">{diffLoading ? "Loading patch…" : "Show read-only patch"}</button>
        {diffLoading && <p role="status">Loading bounded patch…</p>}
        {diff && <div className="min-w-0 space-y-1" aria-label="Read-only patch">
          <p className="break-all font-mono text-xs">Actual comparison trees: {diff.fromTreeOid} → {diff.toTreeOid}</p>
          {diff.hasBinaryChanges && <p className="text-xs text-amber-500">Binary changes are summarized in the patch; their contents are not shown.</p>}
          {diff.patch ? <pre className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-bg p-2 font-mono text-xs text-text">{diff.patch}</pre> : <p>No text changes in this comparison.</p>}
        </div>}
      </div>}
      {integrationError && <p role="alert" className="break-words text-red-400">{integrationError}</p>}
      {integration && <div className="space-y-2 rounded border border-border p-2" aria-label="Local verification and integration">
        <strong>Local verification and integration</strong>
        {!review || !sameReview(integration.review, review) ? <p className="text-xs text-amber-500">Integration review identities differ or are unavailable. Refresh before verification.</p> : <>
          <p className="text-xs text-amber-500">Checks execute saved local commands and may change files. A passing check is not approval. Only an ordinary local merge is supported; no cleanup, fetch or push.</p>
          {integration.checks.length === 0 ? <p>No saved verification checks; proposal unavailable.</p> : <ol className="space-y-2">
            {integration.checks.map((check, index) => {
              const matching = integration.receipts.findLast((item) => item.checkIndex === index && item.finishedAt <= Date.now() && Date.now() - item.finishedAt < 15 * 60_000);
              return <li key={index} className="rounded border border-border p-2 text-xs">
                <p>Check {index + 1}: {check.label}</p>
                {matching ? <p className="break-all font-mono">Passed: receipt {matching.id}; check index {matching.checkIndex}; finished {new Date(matching.finishedAt).toLocaleString()}; log digest {matching.logDigest}</p> : <p>No matching passing receipt for the current review.</p>}
                <button type="button" disabled={!review || blocked || !!result || operation !== null} onClick={() => void integrationAction("verify", index)} className="min-h-8 rounded border border-border px-2 text-accent disabled:opacity-50">{operation === "verify" ? "Verifying…" : `Run check ${index + 1}`}</button>
              </li>;
            })}
          </ol>}
          <button type="button" disabled={!matchingReceipts(integration, review) || blocked || !!result || operation !== null}
            onClick={() => void integrationAction("plan")} className="min-h-8 rounded border border-border px-3 text-accent disabled:opacity-50">{operation === "plan" ? "Preparing…" : "Prepare exact integration proposal"}</button>
        </>}
      </div>}
      {proposal && <div className="min-w-0 space-y-2 rounded border border-amber-500/50 p-3" aria-label="Exact integration proposal">
        <strong>Review exact integration proposal — not yet applied</strong>
        <p className="text-xs text-amber-500">This is the authoritative candidate patch, not the selectable read-only patch above. Binary changes appear only as summaries. Check the complete proposal before explicitly confirming.</p>
        <dl className="break-all font-mono text-xs">
          <dt>Exact plan ID</dt><dd>{proposal.plan.planId}</dd>
          <dt>Expires</dt><dd>{new Date(proposal.plan.expiresAt).toLocaleString()}</dd>
          <dt>Feature branch and commit OID</dt><dd>{proposal.plan.review.featureBranch}: {proposal.plan.review.featureOid}</dd>
          <dt>Target branch and expected commit OID</dt><dd>{proposal.plan.review.targetBranch}: {proposal.plan.review.targetOid}</dd>
          <dt>Feature tree OID</dt><dd>{proposal.plan.review.featureTreeOid}</dd>
          <dt>Target tree OID</dt><dd>{proposal.plan.review.targetTreeOid}</dd>
          <dt>Merge result tree OID</dt><dd>{proposal.plan.review.mergeTreeOid}</dd>
          <dt>Exact merge commit OID</dt><dd>{proposal.plan.mergeOid}</dd>
          <dt>Merge message</dt><dd>{proposal.plan.message}</dd>
          <dt>Verification receipt IDs (saved check order)</dt><dd><ol>{proposal.plan.receiptIds.map((id, index) => <li key={id}>{index + 1}: {id}</li>)}</ol></dd>
          <dt>Candidate comparison trees</dt><dd>{proposal.plan.diff.fromTreeOid} → {proposal.plan.diff.toTreeOid}</dd>
        </dl>
        <div className="text-xs" aria-label="Authoritative integration candidate diff">
          {proposal.plan.diff.hasBinaryChanges && <p className="text-amber-500">Binary changes are included but contents are not displayed.</p>}
          {proposal.plan.diff.patch ? <pre className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-bg p-2 font-mono text-text">{proposal.plan.diff.patch}</pre> : <p>No text changes in the candidate.</p>}
        </div>
        {!proposal.viewed ? <button type="button" disabled={operation !== null} onClick={() => setProposal((current) => current ? { ...current, viewed: true } : null)} className="min-h-8 rounded border border-border px-3 text-accent disabled:opacity-50">I have reviewed this exact proposal</button>
          : <button type="button" disabled={operation !== null || blocked || !review || !integration || !matchingReceipts(integration, review) || Date.now() >= proposal.plan.expiresAt} onClick={() => void integrationAction("confirm")}
            className="min-h-8 rounded border border-amber-500 px-3 font-medium text-text disabled:opacity-50">{operation === "confirm" ? "Integrating…" : `Confirm exact plan ${proposal.plan.planId}`}</button>}
      </div>}
      {result && <div role="status" className="space-y-1 rounded border border-amber-500 p-2 text-xs">
        <strong>{result.status === "integrated" ? "Local integration completed" : "Partial state — inspect manually; do not retry"}</strong>
        <p className="break-all font-mono">Target: {result.targetBranch}; {result.status === "integrated" ? "merge commit" : "intended merge commit (ref update unproven)"}: {result.mergeOid}</p>
        {result.status === "partial-state" && <p className="break-all text-amber-500">{result.reason} Recovery record: {result.recoveryPath}. Inspect both worktrees, refs and index before any further action. Do not retry blindly.</p>}
        {result.recoveryWarning && <p role="alert" className="text-amber-500">{result.recoveryWarning}</p>}
      </div>}
    </div>
  </section>;
}
