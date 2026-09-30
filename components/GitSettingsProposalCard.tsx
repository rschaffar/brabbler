"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitWorkflowField, GitWorkflowOverrides, GitWorkflowSettings, WorkflowScope } from "@/lib/git-workflow-settings";

type Proposal = { id: string; scope: WorkflowScope; projectRoot?: string; projectPath?: string;
  changes: { field: GitWorkflowField; inherit: boolean; value?: unknown }[];
  before: GitWorkflowOverrides; after: GitWorkflowOverrides;
  effectiveBefore: GitWorkflowSettings; effectiveAfter: GitWorkflowSettings; state: "pending" | "applied" | "dismissed" | "stale";
  expires: number; idleRequired: boolean; canApply: boolean; inFlight: boolean };
function display(value: unknown): string {
  if (value === undefined) return "Inherit (remove override)";
  if (Array.isArray(value)) return value.length ? value.map((check) => JSON.stringify(check)).join("\n") : "[] (no checks)";
  return JSON.stringify(value);
}
export function GitSettingsProposalCard({ proposalId, sessionId }: { proposalId: string; sessionId?: string }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadSeq = useRef(0);
  const url = `/api/git/workflow/proposals/${encodeURIComponent(proposalId)}`;
  const load = useCallback(async () => {
    if (!sessionId || busyRef.current) return;
    const seq = ++loadSeq.current;
    try {
      const response = await fetch(`${url}?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const body = await response.json();
      if (seq !== loadSeq.current || busyRef.current) return;
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setProposal(body);
    } catch (cause) {
      if (seq === loadSeq.current && !busyRef.current) setError(cause instanceof Error ? cause.message : "Proposal unavailable");
    }
  }, [url, sessionId]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  async function decide(decision: "apply" | "dismiss") {
    if (busyRef.current || !sessionId) return;
    busyRef.current = true;
    loadSeq.current++; // Invalidate GETs started before the decision.
    setBusy(true); setError("");
    let failure = "";
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, decision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "Proposal unavailable";
    } finally {
      busyRef.current = false;
      setBusy(false);
      await load();
      if (failure) setError(failure);
    }
  }
  return <section role="group" aria-label="Workflow settings proposal" className="m-2 min-w-0 rounded-lg border border-border bg-bg-panel p-3 text-sm text-text">
    <strong>Workflow settings proposal · {proposal?.scope ?? "Loading"}</strong>
    {proposal && <>
      <p className="break-all text-xs text-text-muted">{proposal.scope === "global" ? "Global defaults · all projects" : proposal.scope === "session" ? `Chat: ${sessionId}` : `Project: ${proposal.projectRoot}`}{proposal.projectPath && ` · project checkout: ${proposal.projectPath}`} </p>
      <p className="text-xs text-text-muted">Review each saved override → proposed override. Inherit removes only that field. No Git action, task Apply, or automatic Save is included.</p>
      <dl className="mt-2 max-h-64 overflow-auto border-y border-border text-xs">{proposal.changes.map(({ field }) => <div key={field} className="grid grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)] gap-2 border-b border-border py-2 last:border-0">
        <dt className="font-semibold">{field}</dt><dd className="min-w-0 whitespace-pre-wrap break-all"><span className="text-text-muted">Saved override: {display(proposal.before[field])}</span><br />Proposed override: {display(proposal.after[field])}<br /><span className="text-text-muted">Effective here: {display(proposal.effectiveBefore[field])} → {display(proposal.effectiveAfter[field])}</span></dd>
      </div>)}</dl>
      {proposal.idleRequired && proposal.state === "pending" && !proposal.canApply && <p className="text-xs text-text-muted">Session Apply is available after this chat becomes idle and its checkout is free. No blocking question is waiting for you; you can return after the run settles.</p>}
      {proposal.state === "pending" ? <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || proposal.inFlight || !proposal.canApply} onClick={() => void decide("apply")} className="rounded border border-accent px-3 py-1 text-accent">Apply settings</button>
        <button type="button" disabled={busy || proposal.inFlight} onClick={() => void decide("dismiss")} className="rounded border border-border px-3 py-1">Dismiss</button></div>
        : <p role="status" className="mt-2 text-xs">{proposal.state === "applied" ? "Settings saved. Current task was not applied or started." : proposal.state === "dismissed" ? "Dismissed; nothing changed." : "Stale, expired or unavailable. Inspect saved Workflow settings before requesting a new proposal; this candidate cannot be applied."}</p>}
    </>}
    {error && <p role="alert" className="mt-2 text-xs text-[var(--error)]">{error} <button type="button" onClick={() => void load()} className="underline">Reload proposal</button></p>}
    {!proposal && !error && <p role="status" className="text-xs">Loading review…</p>}
  </section>;
}
