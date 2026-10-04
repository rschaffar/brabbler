"use client";

import { useEffect, useState } from "react";
import type { ProjectAuthorizationAction, ProjectAuthorizationDecision, ProjectAuthorizationScope,
  ProjectAuthorizationStatus } from "@/lib/git-project-authorization";

const ACTIONS: { id: ProjectAuthorizationAction; label: string }[] = [
  { id: "workspace", label: "Worktree creation" }, { id: "commit", label: "Selected commits" },
  { id: "checks", label: "Verification checks" }, { id: "prepare", label: "Feature preparation onto project main" },
  { id: "integration", label: "Local integration" }, { id: "cleanup", label: "Feature resource cleanup" },
];
type Props = { visible: boolean; scope: ProjectAuthorizationScope; projectRoot?: string;
  sessionId?: string; settingsRevision: string };
type Snapshot = { key: string; settingsRevision: string; value: ProjectAuthorizationStatus };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** Separate human Save: editing normal preferences or applying an agent proposal cannot mint authorization. */
export function GitProjectAuthorizations({ visible, scope, projectRoot, sessionId, settingsRevision }: Props) {
  const available = scope === "global" || !!projectRoot && (scope !== "session" || !!sessionId);
  const key = JSON.stringify([scope, scope === "global" ? null : projectRoot, scope === "session" ? sessionId : null]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<ProjectAuthorizationAction, ProjectAuthorizationDecision>>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ProjectAuthorizationAction | null>(null);
  const [reload, setReload] = useState(0);
  const current = snapshot?.key === key && snapshot.settingsRevision === settingsRevision ? snapshot.value : null;
  const selections = drafts[key] ?? {};
  const identity = {
    scope, ...(scope !== "global" ? { repositoryPath: projectRoot } : {}),
    ...(scope === "session" ? { sessionId } : {}),
  };
  useEffect(() => {
    if (!visible || !available) return;
    const abort = new AbortController();
    const params = new URLSearchParams({ scope, ...(scope !== "global" ? { repositoryPath: projectRoot! } : {}),
      ...(scope === "session" ? { sessionId: sessionId! } : {}) });
    setError(null);
    void fetch(`/api/git/authorizations?${params}`, { signal: abort.signal }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Authorization read unavailable");
      if (!abort.signal.aborted) setSnapshot({ key, settingsRevision, value });
    }).catch((cause) => { if (!abort.signal.aborted) setError(message(cause)); });
    return () => abort.abort();
  }, [visible, available, key, projectRoot, scope, sessionId, settingsRevision, reload]);

  async function save(action: ProjectAuthorizationAction, replacement?: ProjectAuthorizationDecision) {
    if (!current || saving) return;
    const decision = replacement ?? selections[action];
    if (!decision || decision === current.actions[action][scope]) return;
    setSaving(action); setError(null);
    try {
      const response = await fetch("/api/git/authorizations", { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, action, decision, revision: current.revision, policyRevision: current.policyRevision }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Authorization save unavailable; reload before trying again");
      setSnapshot({ key, settingsRevision, value });
      setDrafts((previous) => ({ ...previous, [key]: { ...previous[key], [action]: undefined } }));
    } catch (cause) { setError(message(cause)); }
    finally { setSaving(null); }
  }
  return <section className="workflow-stage" aria-label="Saved action authorization">
    <div className="workflow-section-label"><h3>Saved action authorization</h3><span>{scope === "session" ? "This chat × project" : scope}</span></div>
    <p className="workflow-muted">This is separate from workflow preferences. Allow is a saved authorization for eligible explicit requests for this action, not approval of a candidate or permission to bypass project rules. Deny restricts this managed action; Inherit uses the parent scope. Each action has an independent decision and confirmation preference. {scope === "global" && "Global Allow applies to eligible projects broadly."} This is not a shell sandbox.</p>
    <p className="workflow-banner">All six saved-action selectors are configurable here; saving a decision starts no operation. Fresh eligible agent commits support an explicit confirmation:none request with separately saved commitConfirmation:none, fresh persisted ordinary-chat provenance, saved Allow and live guards. Manual human commit routes remain exact Ask. Selected public workspace/check/preparation/integration/cleanup paths are supported on eligible Linux hosts; a saved decision is not proof that a particular request is executable. On a supported Linux path, omitting confirmation still requires the action-specific saved Allow, its separately saved confirmation:none, an explicit request, live caller/resource/recovery guards, required native evidence and compliance with stricter instructions. Ask remains the default even with Allow. Preparation uses the saved Project main branch; cleanup Retain blocks deletion and resource eligibility is not a grant. No Automatic mode, scheduling, chained approvals or remote permission is enabled. Unknown session/terminal usage or native evidence fails closed. Unsupported platforms, branches or native states fail closed.</p>
    {!available ? <p className="workflow-muted">Select a canonical project{scope === "session" ? " and a saved ordinary chat" : ""} first.</p>
      : !current ? <p className="workflow-muted">{error ?? "Loading authorization decisions…"}</p>
        : <div className="workflow-editor">{ACTIONS.map(({ id, label }) => {
          const item = current.actions[id];
          const saved = item[scope];
          const choice = selections[id] ?? (saved === "stale" ? "inherit" : saved);
          const changed = choice !== saved;
          return <div className="workflow-field" key={id}>
            <label htmlFor={`workflow-auth-${id}`}>{label}<small>Effective: {item.effective} · {item.source === "none" ? "no saved scope" : item.source}</small></label>
            <select id={`workflow-auth-${id}`} value={choice} disabled={!!saving || saved === "stale"}
              onChange={(event) => setDrafts((previous) => ({ ...previous, [key]: { ...previous[key], [id]: event.target.value as ProjectAuthorizationDecision } }))}>
              <option value="inherit">Inherit / no decision here</option><option value="deny">Deny managed action</option>
              <option value="allow">Allow eligible explicit action · confirmation remains separate</option>
            </select>
            {saved === "stale" && <p className="workflow-muted">This saved identity is stale. Inspect the chat or checkout before removing its decision. An inherited broader Allow may then apply.
              <button type="button" disabled={!!saving} onClick={() => void save(id, "inherit")}>Remove stale {label} decision</button></p>}
            {changed && saved !== "stale" && <div className="workflow-actions"><button type="button" className="workflow-primary"
              disabled={!!saving} onClick={() => void save(id)}>
              {saving === id ? "Saving…" : `Save ${label} ${choice} for ${scope === "session" ? "this chat × project" : scope}`}
            </button><button type="button" disabled={!!saving} onClick={() => setDrafts((previous) => ({ ...previous, [key]: { ...previous[key], [id]: undefined } }))}>Discard</button></div>}
          </div>;
        })}</div>}
    {error && current && <p className="workflow-banner" role="alert">{error} <button type="button" onClick={() => setReload((count) => count + 1)}>Reload saved decisions</button></p>}
  </section>;
}
