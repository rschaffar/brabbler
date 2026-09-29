"use client";

import { useEffect, useRef, useState } from "react";
import { GIT_BINDING_COVERAGE_NOTICE, GIT_BINDING_LIMITS, type GitRuleSourceTarget, type GitTaskBindingPreview, type GitTaskBindingResponse } from "@/lib/git-workflow-binding-types";

type Props = { sessionId: string; cwd: string; settingsRevision: string; visible: boolean; busy: boolean };
const endpoint = "/api/git/workflow/task";
const labels = { none: "Not adopted", current: "Reviewed metadata · current", stale: "Needs a new review", released: "Released", unavailable: "Unavailable", "reconciliation-required": "Restart · review required" };
export function GitWorkflowTaskBinding({ sessionId, cwd, settingsRevision, visible, busy }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GitTaskBindingResponse | null>(null);
  const [goal, setGoal] = useState("");
  const [requestEntryId, setRequestEntryId] = useState("");
  const [workspaceBranch, setWorkspaceBranch] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [preview, setPreview] = useState<GitTaskBindingPreview | null>(null);
  const [targets, setTargets] = useState<GitRuleSourceTarget[]>([]);
  const [neededTargets, setNeededTargets] = useState<GitRuleSourceTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [reload, setReload] = useState(0);
  const running = useRef(false);
  const mounted = useRef(true);
  const read = useRef<AbortController | null>(null);
  const revision = useRef(settingsRevision);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; read.current?.abort(); }; }, []);
  useEffect(() => {
    if (revision.current !== settingsRevision) {
      revision.current = settingsRevision;
      setPreview(null); setTargets([]); setNeededTargets([]);
    }
    if (!open || !visible || running.current) return;
    const controller = new AbortController(); read.current?.abort(); read.current = controller;
    void fetch(`${endpoint}?${new URLSearchParams({ sessionId })}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Task binding could not be loaded.");
        if (controller.signal.aborted) return;
        const next = body as GitTaskBindingResponse;
        setData(next); setError(null);
        setWorkspaceBranch((value) => next.workspaces.some((item) => item.branch === value) ? value : next.workspaces.find((item) => item.path === cwd)?.branch ?? "");
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Task binding could not be loaded."); });
    return () => controller.abort();
  }, [open, visible, sessionId, cwd, settingsRevision, busy, reload]);
  useEffect(() => {
    if (!visible || !open) return;
    const refresh = () => { if (document.visibilityState === "visible" && !running.current) setReload((value) => value + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [visible, open]);

  async function action(operation: "preview" | "adopt" | "release" | "cancel", selectedTargets = targets) {
    if (running.current || !data) return;
    running.current = true; setWorking(true); setError(null); setNotice(null); read.current?.abort();
    const reviewedRevision = settingsRevision;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, sessionId,
        ...(operation === "preview" ? { revision: data.status.revision, settingsRevision, workspaceBranch, requestEntryId, goal,
          dependencies: dependencies.split("\n").map((path) => path.trim()).filter(Boolean), targets: selectedTargets }
          : operation === "release" ? { revision: data.status.revision } : { previewId: preview?.previewId }) }) });
      const body = await response.json();
      if (!mounted.current || revision.current !== reviewedRevision) return;
      if (!response.ok) {
        setNeededTargets(body.sourceTargets ?? []);
        if (operation === "preview" && body.sourceTargets) setTargets(selectedTargets);
        if (operation === "adopt") setPreview(null); // Single-use even when confirmation fails.
        throw new Error(body.error ?? "Task binding could not be recorded. Reload status before taking another action.");
      }
      setNeededTargets([]);
      if (operation === "preview") { setPreview(body); setTargets(selectedTargets); }
      else {
        setPreview(null);
        if (operation !== "cancel") setData(body);
        setNotice(operation === "adopt" ? "Reviewed task metadata adopted. No Git operation, command, grant or continuation was started."
          : operation === "release" ? "Task binding released. Existing Git approval rules are unchanged." : "Task review cancelled. No binding was adopted.");
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Request failed. Reload status before trying another action.");
    } finally { running.current = false; if (mounted.current) setWorking(false); }
  }
  const disabled = working || busy || !data?.editable;
  const snapshot = preview?.snapshot;
  function changedInput() { setTargets([]); setNeededTargets([]); }
  return <details className="workflow-binding" aria-label="Task binding and source review" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Task binding &amp; source review{data ? ` · ${labels[data.status.status]}` : ""}</summary>
    <p className="workflow-muted">{GIT_BINDING_COVERAGE_NOTICE}</p>
    {data && <p role="status">{data.status.reason}</p>}
    {data?.status.binding && <div className="workflow-binding-record">
      <p><strong>{data.status.binding.goal}</strong><br /><code>{data.status.binding.branch}</code> · generation {data.status.binding.generation}</p>
      <p><code>{data.status.binding.workspace}</code></p>
      <details><summary>Adopted source fingerprints</summary>{data.status.binding.sources.map((source) => <p key={source.path}><code>{source.path}</code><br /><code>{source.digest}</code></p>)}</details>
      {data.status.binding.state === "adopted" && <button type="button" disabled={working} onClick={() => void action("release")}>Release task binding</button>}
    </div>}
    {!snapshot ? <>
      {data?.reason && <p className="workflow-muted">{data.reason}</p>}
      <label>Task goal<textarea rows={2} maxLength={GIT_BINDING_LIMITS.goal} value={goal} disabled={disabled} onChange={(event) => { setGoal(event.target.value); changedInput(); }} /></label>
      <label>Originating user request<select value={requestEntryId} disabled={disabled} onChange={(event) => { setRequestEntryId(event.target.value); changedInput(); }}>
        <option value="">Choose the request for this task</option>{data?.requests.map((request) => <option key={request.entryId} value={request.entryId}>{request.label}</option>)}
      </select></label>
      <label>Existing task checkout<select value={workspaceBranch} disabled={disabled} onChange={(event) => { setWorkspaceBranch(event.target.value); changedInput(); }}>
        <option value="">Choose a registered local branch</option>{data?.workspaces.map((workspace) => <option key={workspace.branch} value={workspace.branch}>{workspace.branch} · {workspace.path}</option>)}
      </select></label>
      <label>Additional Markdown dependencies · one path per line<textarea rows={3} maxLength={32 * 1024} disabled={disabled} value={dependencies} onChange={(event) => { setDependencies(event.target.value); changedInput(); }} /></label>
      <p className="workflow-muted">Name delegated skills and documents explicitly. Relative paths use the selected checkout. Nothing follows document links or runs resources. Missing named files block review; an empty list does not mean there are no other rules.</p>
      <button type="button" disabled={disabled || !goal.trim() || !requestEntryId || !workspaceBranch} onClick={() => void action("preview")}>Preview task &amp; instruction sources</button>
      {neededTargets.length > 0 && <div className="workflow-binding-targets">
        <p>These paths resolve elsewhere. The following action permits reading only these exact Markdown destinations for this review, not general access to their directories.</p>
        {neededTargets.map((target) => <p key={target.path}><code>{target.path}</code> → <code>{target.realPath}</code></p>)}
        <button type="button" disabled={disabled} onClick={() => void action("preview", [...targets.filter((old) => !neededTargets.some((item) => item.path === old.path)), ...neededTargets])}>Read these exact source destinations</button>
      </div>}
    </> : <div className="workflow-binding-preview" aria-label="Exact task binding preview">
      <p><strong>{snapshot.request.goal}</strong></p>
      <p>Session: <code>{snapshot.owner.sessionId}</code><br />Transcript: <code>{snapshot.owner.sessionFile}</code><br />Request: <code>{snapshot.request.entryId}</code></p>
      <p>Bound checkout: <code>{snapshot.workspace.root}</code><br />Local branch: <code>{snapshot.workspace.branch}</code></p>
      <details><summary>Captured settings · not editor drafts</summary><pre>{JSON.stringify(snapshot.settings, null, 2)}</pre></details>
      <p>{snapshot.sources.sources.length} instruction/dependency sources and {snapshot.sources.selectionSources.length} shadow-selection probes. Open each document to inspect its complete captured text. These are disk snapshots, not a claim about the agent’s currently loaded instructions.</p>
      {[...snapshot.sources.sources, ...snapshot.sources.selectionSources].map((source) => <details key={source.path} className="workflow-binding-source"><summary>{snapshot.sources.selectionSources.includes(source) ? "Shadowed selection probe" : source.role === "dependency" ? "Dependency" : "Context"} · {source.path}</summary>
        <p><code>{source.realPath}</code><br />SHA-256: <code>{source.digest}</code> · {source.bytes} bytes</p><pre tabIndex={0} aria-label={`Captured instruction source ${source.path}`}>{source.content || "(Empty file)"}</pre>
      </details>)}
      {snapshot.sources.shadowed.length > 0 && <p>Excluded ancestor paths in nested-worktree discovery: {snapshot.sources.shadowed.map((path) => <code key={path}>{path}</code>)}</p>}
      <p className="workflow-muted">Waits for you; no response timeout. Changed sources, settings, session, checkout or server restart require a new preview. Adoption approves no Git actions.</p>
      <div className="workflow-actions"><button type="button" disabled={working} onClick={() => void action("cancel")}>Cancel task review</button>
        <button type="button" className="workflow-primary" disabled={working || busy} onClick={() => void action("adopt")}>Adopt reviewed task metadata</button></div>
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" disabled={working} onClick={() => setReload((value) => value + 1)}>Refresh binding status</button>
  </details>;
}
