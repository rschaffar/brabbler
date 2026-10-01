"use client";

import { useEffect, useRef, useState } from "react";

type Resource = { path: string; branch: string; head: string; status: string[] };
export type CheckRecoveryPreview = {
  eligible: true;
  actionId: string;
  revision: string;
  unit: string;
  mode: "unchanged" | "moved";
  original: { featureHead: string; targetHead: string; featureHeadDigest: string; targetHeadDigest: string; refsDigest: string };
  feature: Resource;
  target: Resource;
  containment: { emptyEvidence: string; payload: string };
  expiresAt: number;
};
type RecoveryStatus = CheckRecoveryPreview | { eligible: false; reason: string };
type Props = { sessionId: string; disabled?: boolean; onRecoveringChange?: (busy: boolean) => void; onRecovered: () => void };

function isResource(value: unknown): value is Resource {
  if (!value || typeof value !== "object") return false;
  const resource = value as Partial<Resource>;
  return typeof resource.path === "string" && typeof resource.branch === "string" && typeof resource.head === "string" &&
    Array.isArray(resource.status) && resource.status.every((line) => typeof line === "string");
}

/** A malformed or expired response is never an approval capability. The server rechecks all identities on POST. */
export function isCheckRecoveryPreview(value: unknown): value is CheckRecoveryPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as Partial<CheckRecoveryPreview>;
  const original = preview.original;
  const hash = /^[a-f0-9]{64}$/;
  const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
  return preview.eligible === true && typeof preview.actionId === "string" && !!preview.actionId &&
    typeof preview.revision === "string" && !!preview.revision && typeof preview.unit === "string" && !!preview.unit &&
    (preview.mode === "unchanged" || preview.mode === "moved") && !!original &&
    oid.test(original.featureHead) && oid.test(original.targetHead) &&
    hash.test(original.featureHeadDigest) && hash.test(original.targetHeadDigest) && hash.test(original.refsDigest) &&
    isResource(preview.feature) && isResource(preview.target) &&
    !!preview.containment && typeof preview.containment.emptyEvidence === "string" &&
    typeof preview.containment.payload === "string" && Number.isFinite(preview.expiresAt);
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

function ResourceDetails({ name, resource }: { name: string; resource: Resource }) {
  return <div className="min-w-0 rounded border border-border p-2" aria-label={`${name} recovery resource`}>
    <strong>{name} checkout</strong>
    <dl className="break-all font-mono text-xs">
      <dt>Exact path</dt><dd>{resource.path}</dd>
      <dt>Branch</dt><dd>{resource.branch}</dd>
      <dt>HEAD commit OID</dt><dd>{resource.head}</dd>
      <dt>Git status entries</dt><dd>{resource.status.length ? <ul>{resource.status.map((line, index) => <li key={index}>{line}</li>)}</ul> : "No status entries in this snapshot"}</dd>
    </dl>
  </div>;
}

/** Human disposition of a quarantined check, not a check rerun or a merge approval. */
export function GitCheckRecoveryPanel({ sessionId, disabled = false, onRecoveringChange, onRecovered }: Props) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [reviewedMovement, setReviewedMovement] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const preview = status?.eligible === true ? status : null;
  const expired = !!preview && (clock >= preview.expiresAt || Date.now() >= preview.expiresAt);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!preview || expired) return;
    const remaining = preview.expiresAt - Date.now();
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [preview, expired, clock]);

  async function load() {
    if (inFlight.current || disabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus(null); // A previous preview cannot authorize a new attempt while reloading.
    setReviewedMovement(false);
    setRecovered(false);
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/git/check-recovery?${new URLSearchParams({ sessionId })}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, `Recovery review unavailable (HTTP ${response.status})`));
      if (controller.signal.aborted || !mounted.current) return;
      if (isCheckRecoveryPreview(body)) setStatus(body);
      else if (body && typeof body === "object" && "eligible" in body && body.eligible === false &&
        "reason" in body && typeof body.reason === "string") setStatus({ eligible: false, reason: body.reason });
      else throw new Error("Recovery review is incomplete; investigate the quarantined check manually.");
      setClock(Date.now());
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(cause instanceof Error ? cause.message : "Recovery review unavailable; investigate manually.");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }

  async function approve() {
    if (!preview || expired || Date.now() >= preview.expiresAt || disabled || inFlight.current || loading ||
      (preview.mode === "moved" && !reviewedMovement)) return;
    inFlight.current = true;
    setApproving(true);
    setError(null);
    onRecoveringChange?.(true);
    try {
      const response = await fetch("/api/git/check-recovery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, actionId: preview.actionId, revision: preview.revision, acknowledged: true,
          ...(preview.mode === "moved" ? { reviewedMovement: true } : {}) }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, `Recovery not approved (HTTP ${response.status})`));
      if (!body || typeof body !== "object" || !("recovered" in body) || body.recovered !== true)
        throw new Error("Recovery result is unconfirmed. Inspect both worktrees and refresh manually.");
      if (!mounted.current) return;
      setStatus(null); // Single-use: no repeated approval, even if refreshing the review fails.
      setReviewedMovement(false);
      setRecovered(true);
      window.dispatchEvent(new CustomEvent("pi-web:git-actions-changed", { detail: { sessionId } }));
      onRecovered();
    } catch (cause) {
      if (!mounted.current) return;
      setStatus(null); // 409/stale, transport errors and ambiguous results must not retain approval authority.
      setReviewedMovement(false);
      setError(`${cause instanceof Error ? cause.message : "Recovery unavailable"}. Inspect both worktrees and refs; load a new review only after manual investigation. Do not retry the check or merge automatically.`);
    } finally {
      inFlight.current = false;
      onRecoveringChange?.(false);
      if (mounted.current) setApproving(false);
    }
  }

  return <section className="min-w-0 space-y-2 rounded border border-amber-500/50 p-3" aria-label="Check quarantine recovery review">
    <strong>Check quarantine recovery</strong>
    <p className="text-xs text-amber-500">A failed or uncertain check may leave changes or processes behind. Recovery only releases the recorded check quarantine after server validation; it does not rerun checks, create passing receipts, approve integration or undo file changes. Inspect both worktrees and refs first.</p>
    <p className="text-xs text-amber-500">Git status and process-containment evidence cannot account for non-Git side effects, ignored files, writes outside these checkouts, or escaped processes. Investigate those effects manually before approving.</p>
    <button type="button" disabled={loading || approving || disabled} onClick={() => void load()}
      className="min-h-8 rounded border border-border px-3 text-accent disabled:opacity-50">{loading ? "Loading recovery review…" : "Load recovery review"}</button>
    {error && <p role="alert" className="break-words text-red-400">{error}</p>}
    {recovered && <p role="status">Recovery accepted. Review and receipts are being refreshed; no verification check has been rerun or receipt created.</p>}
    {status?.eligible === false && <p role="status" className="break-words text-amber-500">Recovery unavailable: {status.reason}. Investigate the quarantined check, processes, both worktrees and refs manually. No approval is available.</p>}
    {preview && <div className="min-w-0 space-y-2" aria-label="Exact check recovery preview">
      <p className="text-xs text-amber-500">This preview is time-limited and bound to the exact resources and containment evidence below. Approval does not certify that the check passed or that ignored or non-Git changes are safe.</p>
      <dl className="break-all font-mono text-xs">
        <dt>Recovery action ID</dt><dd>{preview.actionId}</dd>
        <dt>Recovery revision</dt><dd>{preview.revision}</dd>
        <dt>Exact check service unit</dt><dd>{preview.unit}</dd>
        <dt>Original cgroup empty evidence</dt><dd>{preview.containment.emptyEvidence}</dd>
        <dt>Check payload disposition</dt><dd>{preview.containment.payload}</dd>
        <dt>Expires</dt><dd>{new Date(preview.expiresAt).toLocaleString()}</dd>
      </dl>
      {preview.mode === "moved" && <div className="rounded border border-amber-500 p-2 text-xs text-amber-500">
        <strong>Repository changed since the failed check</strong>
        <p>The original pre/post check snapshots matched. The current branches or Git state no longer match that snapshot; this is not a review of today&apos;s merge. Original commits were found by matching their recorded fingerprints to reachable Git objects. This does not prove who moved the branches:</p>
        <dl className="break-all font-mono"><dt>Original feature commit</dt><dd>{preview.original.featureHead}</dd>
          <dt>Original target commit</dt><dd>{preview.original.targetHead}</dd>
          <dt>Original feature HEAD SHA-256</dt><dd>{preview.original.featureHeadDigest}</dd>
          <dt>Original target HEAD SHA-256</dt><dd>{preview.original.targetHeadDigest}</dd>
          <dt>Original refs SHA-256</dt><dd>{preview.original.refsDigest}</dd></dl>
      </div>}
      <ResourceDetails name="Feature" resource={preview.feature} />
      <ResourceDetails name="Target" resource={preview.target} />
      {preview.mode === "moved" && <label className="flex items-start gap-2 text-xs text-amber-500">
        <input type="checkbox" checked={reviewedMovement} onChange={(event) => setReviewedMovement(event.target.checked)} />
        I inspected the later branch movement, both current clean checkouts, and possible ignored or non-Git effects. This only releases the failed-check quarantine.
      </label>}
      {expired && <p role="alert" className="text-amber-500">Recovery preview expired. Load a new review after inspecting the resources; do not reuse this approval.</p>}
      <button type="button" disabled={expired || loading || approving || disabled || (preview.mode === "moved" && !reviewedMovement)} onClick={() => void approve()}
        className="min-h-8 rounded border border-amber-500 px-3 font-medium text-text disabled:opacity-50">{approving ? "Approving recovery…" : "Approve recovery"}</button>
    </div>}
  </section>;
}
