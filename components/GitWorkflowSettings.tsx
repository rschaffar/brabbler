"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_GIT_WORKFLOW_CHECKS, MAX_GIT_WORKFLOW_CHECK_ARGS, MAX_GIT_WORKFLOW_CHECK_LABEL,
  MAX_GIT_WORKFLOW_CHECK_EXECUTABLE, MAX_GIT_WORKFLOW_CHECK_ARG,
  validateGitWorkflowPolicy, type GitWorkflowPolicy, type GitWorkflowCheck,
} from "@/lib/git-workflow-policy";
import { sendAgentCommand } from "@/lib/agent-client";

type WorkflowResponse = {
  cwd: string;
  project: GitWorkflowPolicy | null;
  session: GitWorkflowPolicy | null;
  sessionSnapshotPresent?: boolean;
};
type Choice = "project" | "custom" | "off";
type Worktree = { path: string; branch: string | null; isMain: boolean };
type WorktreesResponse = {
  isGit: boolean; isTopLevel: boolean; currentWorktreePath: string | null;
  worktrees: Worktree[]; error?: string;
};
type CheckDraft = Omit<GitWorkflowCheck, "argv"> & { executable: string; argumentsText: string };
type Draft = {
  checks: CheckDraft[];
  /** Preserve an explicit empty list rather than converting it to absence on unrelated edits. */
  checksPresent?: boolean;
  mode: "worktree" | "current";
  baseBranch: string;
  branch: string;
  onCreate: "continue" | "fork" | "stay";
  commits: "agent" | "manual";
  targetBranch: string;
  method: "merge" | "ff" | "squash";
};
const emptyDraft: Draft = {
  mode: "current", baseBranch: "", branch: "", onCreate: "continue",
  commits: "manual", targetBranch: "", method: "merge", checks: [],
};
export function toDraft(policy: GitWorkflowPolicy | null): Draft {
  if (!policy) return { ...emptyDraft, checks: [] };
  return {
    mode: policy.mode, baseBranch: policy.mode === "worktree" ? policy.baseBranch : "",
    branch: policy.mode === "current" ? policy.branch ?? "" : "",
    onCreate: policy.onCreate, commits: policy.commits,
    targetBranch: policy.integration?.targetBranch ?? "", method: policy.integration?.method ?? "merge",
    ...(Object.hasOwn(policy, "checks") ? { checksPresent: true } : {}),
    checks: policy.checks?.map(({ argv, ...recipe }) => ({ ...recipe,
      ...(Object.hasOwn(recipe, "env") ? { env: { ...recipe.env } } : {}),
      executable: argv[0], argumentsText: argv.slice(1).join("\n") })) ?? [],
  };
}
export function toPolicy(draft: Draft): GitWorkflowPolicy {
  const common = {
    onCreate: draft.onCreate, commits: draft.commits,
    ...(draft.targetBranch.trim() ? { integration: { targetBranch: draft.targetBranch.trim(), method: draft.method } } : {}),
    ...(draft.checks.length || draft.checksPresent ? { checks: draft.checks.map(({ executable, argumentsText, ...recipe }) => ({
      ...recipe, argv: [executable, ...(argumentsText === "" ? [] : argumentsText.split("\n"))],
    })) } : {}),
  };
  return validateGitWorkflowPolicy(draft.mode === "worktree"
    ? { mode: "worktree", baseBranch: draft.baseBranch.trim(), ...common }
    : { mode: "current", ...(draft.branch.trim() ? { branch: draft.branch.trim() } : {}), ...common });
}

interface Props {
  cwd: string;
  sessionId?: string;
  /** A new chat can be initialized by model/tool/system-prompt inspection before a prompt is sent. */
  setNewChatOverride?: (policy: GitWorkflowPolicy | null | undefined) => boolean;
  busy: boolean;
  transient?: boolean;
  onSessionMoved?: (sessionId: string, cwd: string) => Promise<void>;
  onSessionForkedToWorktree?: (sessionId: string, cwd: string) => void;
  assistantLeafId?: string | null;
}

export function GitWorkflowSettings({ cwd, sessionId, setNewChatOverride, busy, transient, onSessionMoved, onSessionForkedToWorktree, assistantLeafId }: Props) {
  const [value, setValue] = useState<WorkflowResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });
  const [choice, setChoice] = useState<Choice>("project");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pendingOverride, setPendingOverride] = useState<Choice | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreesResponse | null>(null);
  const [changedCount, setChangedCount] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [moving, setMoving] = useState(false);
  const [forkTarget, setForkTarget] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const moveInFlightRef = useRef(false);
  const [moveRevision, setMoveRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(sessionId ? { sessionId } : { cwd });
    void fetch(`/api/git/workflow?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json() as WorkflowResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setValue(body);
        setChoice(sessionId ? (body.sessionSnapshotPresent && body.session === null ? "off" : "custom") : "project");
        setDraft(toDraft(sessionId ? body.session ?? body.project : body.project));
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(sessionId && /not persisted/i.test(message)
          ? "This chat is initialized but not persisted yet. Start a new chat to apply a workflow override."
          : message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [cwd, sessionId, revision]);

  // Always inspect the persisted session cwd, not the sidebar's manually selected checkout.
  const actualCwd = sessionId ? value?.cwd : null;
  useEffect(() => {
    setWorktrees(null);
    setChangedCount(null);
    setMoveTarget(null);
    setDestination("");
    setMoveError(null);
    setForkTarget(null);
    setForkError(null);
    if (!sessionId || !actualCwd || transient) return;
    const controller = new AbortController();
    const get = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const body = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      return body;
    };
    void Promise.all([
      get<WorktreesResponse>(`/api/worktrees?cwd=${encodeURIComponent(actualCwd)}`),
      get<{ files: unknown[] }>(`/api/git/status?cwd=${encodeURIComponent(actualCwd)}`),
    ]).then(([list, status]) => {
      if (controller.signal.aborted) return;
      setWorktrees(list);
      setChangedCount(status.files.length);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setMoveError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [sessionId, actualCwd, transient, moveRevision]);

  const disabled = loading || saving || busy || moving || forking;
  const moveDisabled = disabled || Boolean(transient) || changedCount === null;
  const forkDisabled = moveDisabled || !assistantLeafId;
  const availableTargets = worktrees?.isGit && worktrees.isTopLevel && worktrees.currentWorktreePath
    && actualCwd && worktrees.worktrees.some((item) => item.path === worktrees.currentWorktreePath)
    ? worktrees.worktrees.filter((item) => item.path !== worktrees.currentWorktreePath)
    : [];
  async function confirmMove() {
    if (!sessionId || !moveTarget || !availableTargets.some((item) => item.path === moveTarget) || moveDisabled || moveInFlightRef.current) return;
    moveInFlightRef.current = true;
    setMoving(true);
    setMoveError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/move`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: moveTarget }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      await onSessionMoved?.(sessionId, moveTarget);
      setMoveTarget(null);
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : String(cause));
      setMoveRevision((current) => current + 1);
    } finally { moveInFlightRef.current = false; setMoving(false); }
  }
  async function confirmFork() {
    if (!sessionId || !assistantLeafId || !forkTarget || !availableTargets.some((item) => item.path === forkTarget) || forkDisabled || moveInFlightRef.current) return;
    moveInFlightRef.current = true;
    setForking(true);
    setForkError(null);
    let newSessionId: string | null = null;
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sessionId, { type: "clone", leafId: assistantLeafId });
      if (result?.cancelled || !result?.newSessionId) throw new Error("Cannot clone an empty or unsaved session with an assistant leaf.");
      newSessionId = result.newSessionId;
      const response = await fetch(`/api/sessions/${encodeURIComponent(newSessionId)}/move`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: forkTarget }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      onSessionForkedToWorktree?.(newSessionId, forkTarget);
      setForkTarget(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setForkError(newSessionId
        ? `Fork ${newSessionId} was retained (not deleted). Move to ${forkTarget} failed: ${message}. Open the fork by ID to retry.`
        : message);
    } finally { moveInFlightRef.current = false; setForking(false); }
  }
  const update = <K extends keyof Draft>(key: K, next: Draft[K]) => setDraft((current) => ({ ...current, [key]: next }));
  const updateCheck = (index: number, key: "label" | "executable" | "argumentsText", next: string) => setDraft((current) => ({
    ...current, checks: current.checks.map((check, i) => i === index ? { ...check, [key]: next } : check),
  }));
  async function put(scope: "project" | "session", policy: GitWorkflowPolicy | null) {
    const res = await fetch("/api/git/workflow", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope === "project" ? { scope, cwd, policy } : { scope, sessionId, policy }),
    });
    const body = await res.json() as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || !value) return;
    setError(null);
    setFeedback(null);
    let policy: GitWorkflowPolicy | null;
    try { policy = choice === "off" ? null : toPolicy(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    setSaving(true);
    try {
      if (sessionId) {
        await put("session", policy);
        setValue({ ...value, session: policy, sessionSnapshotPresent: true });
        setFeedback("Saved for this session. No operation was approved or started.");
      } else if (choice === "project") {
        await put("project", policy);
        setValue({ ...value, project: policy });
        setFeedback(`Project default saved for future chats. Already initialized chats keep their earlier snapshot.${pendingOverride ? " This chat still has an explicit override queued." : ""}`);
      } else {
        if (!setNewChatOverride?.(policy)) {
          setError("This chat is already initializing or initialized. Start a new chat to apply an override.");
          return;
        }
        setPendingOverride(choice);
        setFeedback(choice === "off"
          ? "Opt-out queued for this chat when it initializes. No project default was changed."
          : "Override queued for this chat when it initializes. No project default was changed.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  async function clearDefault() {
    if (disabled) return;
    setSaving(true); setError(null); setFeedback(null);
    try {
      await put("project", null);
      setValue((current) => current && { ...current, project: null });
      setFeedback(`Project default cleared for future chats. Existing session snapshots are unchanged.${pendingOverride ? " This chat still has an explicit override queued." : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  function resetOverride() {
    setError(null); setFeedback(null);
    if (!setNewChatOverride?.(undefined)) {
      setError("This chat is already initializing or initialized. Start a new chat to change its workflow.");
      return;
    }
    setPendingOverride(null);
    setChoice("project");
    setDraft(toDraft(value?.project ?? null));
    setFeedback("This chat will use the project default when it initializes.");
  }
  function choose(next: Choice) {
    setChoice(next); setError(null); setFeedback(null);
    if (next === "project") setDraft(toDraft(value?.project ?? null));
    else if (next === "custom") setDraft(toDraft(sessionId ? value?.session ?? value?.project ?? null : value?.project ?? null));
  }
  const showFields = choice !== "off";
  const inputClass = "min-w-0 w-full rounded border border-border bg-bg px-2 py-1 text-text disabled:opacity-50";
  const labelClass = "flex min-w-0 flex-col gap-1 text-xs text-text-muted";
  return (
    <section className="git-panel-content min-w-0 text-xs text-text" aria-label="Workspace workflow settings">
      <div className="space-y-3">
        <p className="mb-2 break-all text-text-muted">
          {sessionId ? "Actual session cwd" : "New session cwd"}: <code>{value?.cwd ?? cwd}</code>
        </p>
        {loading ? <p role="status">Loading workflow…</p> : !value ? (
          <div role="alert">{error ?? "Could not load workflow."} <button type="button" className="text-accent underline" onClick={() => setRevision((v) => v + 1)}>Retry</button></div>
        ) : <>
          <p className="mb-2 text-text-muted">
            Policy source: {sessionId
              ? value.sessionSnapshotPresent ? value.session === null ? "Session opt-out" : "Saved session snapshot" : "No saved session policy (project defaults apply only to new chats)"
              : pendingOverride === "off" ? "Explicit opt-out queued for this new chat" : pendingOverride === "custom" ? "Explicit override queued for this new chat" : value.project ? "Project default (snapshotted on creation)" : "No project default"}
          </p>
          <p className="mb-3 text-text-muted">Saving preferences does not create a worktree, switch branches, commit, or integrate. Checkout actions require separate confirmation.</p>
          {sessionId && <div className="mb-3 rounded border border-border p-2" aria-label="Continue session in another worktree">
            <p className="font-semibold">Continue this session in another registered worktree</p>
            <p className="mt-1 break-all text-text-muted">Actual chat checkout: <code>{actualCwd}</code></p>
            {transient ? <p className="mt-1 text-text-muted">Wait for this session to be persisted before moving it.</p>
              : !worktrees && !moveError ? <p role="status" className="mt-1">Checking worktrees and changed files…</p>
              : null}
            {worktrees && changedCount !== null && <>
              <p className="mt-1 text-amber-500">{changedCount > 0
                ? `Dirty source checkout: ${changedCount} changed file${changedCount === 1 ? "" : "s"}. Uncommitted files stay in the source; they do not follow the session.`
                : "No changed files detected in the source checkout. Uncommitted files stay in the source; they do not follow the session."}</p>
              {!worktrees.isTopLevel || !worktrees.currentWorktreePath ? <p className="mt-1 text-text-muted">The session must be at a registered checkout root to continue into another worktree.</p>
                : availableTargets.length === 0 ? <p className="mt-1 text-text-muted">No other registered worktrees are available.</p>
                : <div className="mt-2 space-y-2">
                    <label className={labelClass}>Destination worktree
                      <select className={inputClass} value={availableTargets.some((item) => item.path === destination) ? destination : ""}
                        disabled={moving || forking} onChange={(event) => {
                          setDestination(event.target.value);
                          setMoveTarget(null); setForkTarget(null); setMoveError(null); setForkError(null);
                        }}>
                        <option value="">Choose a worktree…</option>
                        {worktrees.worktrees.map((item) => <option key={item.path} value={item.path} disabled={item.path === worktrees.currentWorktreePath}>
                          {item.branch ?? "detached HEAD"}{item.isMain ? " · main checkout" : ""}{item.path === worktrees.currentWorktreePath ? " · actual chat checkout" : ""} · {item.path}
                        </option>)}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={moveDisabled || !destination || !availableTargets.some((item) => item.path === destination)}
                        onClick={() => { setMoveTarget(destination); setForkTarget(null); setMoveError(null); }} className="rounded border border-border px-2 py-1 text-accent disabled:opacity-50">Continue here…</button>
                      <button type="button" disabled={forkDisabled || !destination || !availableTargets.some((item) => item.path === destination)}
                        onClick={() => { setForkTarget(destination); setMoveTarget(null); setForkError(null); }} className="rounded border border-border px-2 py-1 text-accent disabled:opacity-50">Fork chat here…</button>
                    </div>
                  </div>}
              {forkTarget && availableTargets.some((item) => item.path === forkTarget) && <div className="mt-2 rounded border border-amber-500/50 p-2">
                <p>Fork this chat into <code className="break-all">{forkTarget}</code>? The original chat stays in <code className="break-all">{actualCwd}</code>. Uncommitted source files stay there and are not copied. No worktree is created or source checkout files moved.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={forkDisabled} onClick={() => void confirmFork()} className="rounded bg-accent px-2 py-1 text-white disabled:opacity-50">{forking ? "Forking…" : "Confirm fork"}</button>
                  <button type="button" disabled={forking} onClick={() => setForkTarget(null)} className="rounded border border-border px-2 py-1 disabled:opacity-50">Cancel</button>
                </div>
              </div>}
              {!assistantLeafId && <p className="mt-1 text-text-muted">Forking requires an idle persisted chat with an assistant leaf.</p>}
              {moveTarget && availableTargets.some((item) => item.path === moveTarget) && <div className="mt-2 rounded border border-amber-500/50 p-2">
                <p>Continue this same session in <code className="break-all">{moveTarget}</code>? Uncommitted files stay in the source checkout <code className="break-all">{actualCwd}</code> and will not be copied. This does not create a worktree or move any files.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={moveDisabled} onClick={() => void confirmMove()} className="rounded bg-accent px-2 py-1 text-white disabled:opacity-50">{moving ? "Moving…" : "Confirm continuation"}</button>
                  <button type="button" disabled={moving} onClick={() => setMoveTarget(null)} className="rounded border border-border px-2 py-1 disabled:opacity-50">Cancel</button>
                </div>
              </div>}
            </>}
            {busy && <p role="status" className="mt-1 text-amber-500">Stop the running session before continuing it elsewhere.</p>}
            {forkError && <p role="alert" className="mt-2 break-all text-red-400">{forkError}</p>}
            {moveError && <p role="alert" className="mt-2 text-red-400">{moveError} <button type="button" disabled={moving} className="text-accent underline" onClick={() => setMoveRevision((current) => current + 1)}>Retry checkout check</button></p>}
          </div>}
          {busy && <p role="status" className="mb-2 text-amber-500">Stop the running session before editing its workflow.</p>}
          <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
            <fieldset disabled={disabled} className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="mb-1 font-semibold">Edit scope</legend>
              {(!sessionId ? [
                ["project", "Project default for new chats"], ["custom", "Override for this new chat"], ["off", "Opt out for this new chat"],
              ] : [["custom", "Save this session's policy"], ["off", "Opt out for this session"]]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1"><input type="radio" name="workflow-scope" checked={choice === key} onChange={() => choose(key as Choice)} />{label}</label>
              ))}
            </fieldset>
            {showFields && <div className="grid min-w-0 grid-cols-1 gap-3">
              <label className={labelClass}>Checkout mode
                <select className={inputClass} disabled={disabled} value={draft.mode} onChange={(e) => update("mode", e.target.value as Draft["mode"])}>
                  <option value="worktree">Worktree from local base branch</option><option value="current">Current branch / checkout</option>
                </select>
              </label>
              {draft.mode === "worktree" ? <label className={labelClass}>Local base branch (required)
                <input className={inputClass} disabled={disabled} required value={draft.baseBranch} onChange={(e) => update("baseBranch", e.target.value)} placeholder="main" />
              </label> : <label className={labelClass}>Require current branch (optional)
                <input className={inputClass} disabled={disabled} value={draft.branch} onChange={(e) => update("branch", e.target.value)} placeholder="Any current branch" />
              </label>}
              <label className={labelClass}>When a worktree is created
                <select className={inputClass} disabled={disabled} value={draft.onCreate} onChange={(e) => update("onCreate", e.target.value as Draft["onCreate"])}>
                  <option value="continue">Continue in worktree</option><option value="fork">Fork conversation</option><option value="stay">Stay in current checkout</option>
                </select>
              </label>
              <label className={labelClass}>Commits
                <select className={inputClass} disabled={disabled} value={draft.commits} onChange={(e) => update("commits", e.target.value as Draft["commits"])}>
                  <option value="manual">Manual</option><option value="agent">Agent may commit</option>
                </select>
              </label>
              <label className={labelClass}>Local integration target (optional)
                <input className={inputClass} disabled={disabled} value={draft.targetBranch} onChange={(e) => update("targetBranch", e.target.value)} placeholder="No target" />
              </label>
              <label className={labelClass}>Integration method (if target set)
                <select className={inputClass} disabled={disabled || !draft.targetBranch.trim()} value={draft.method} onChange={(e) => update("method", e.target.value as Draft["method"])}>
                  <option value="merge">Merge</option><option value="ff">Fast-forward</option><option value="squash">Squash</option>
                </select>
              </label>
            </div>}
            {showFields && <fieldset disabled={disabled} className="min-w-0 rounded border border-border p-2">
              <legend className="px-1 font-semibold">Verification checks (optional)</legend>
              <p className="mb-2 text-text-muted">No checks are configured by default. Saving does not run them. Checks run only after explicit selection in a separate workflow and can execute project code. Each line below is one literal argument; no shell quoting, expansion, or command string is parsed. Do not include URLs or credentials.</p>
              <p className="mb-2 text-text-muted">Extended recipe directory, environment and required-stage fields are retained on edits, but their execution is not supported yet.</p>
              <div className="space-y-2">{draft.checks.map((check, index) => (
                <div key={index} className="min-w-0 rounded border border-border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-semibold">Check {index + 1}</span>
                    <button type="button" className="text-accent underline disabled:opacity-50" onClick={() => setDraft((current) => ({ ...current, checksPresent: true, checks: current.checks.filter((_, i) => i !== index) }))}>Remove</button>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <label className={labelClass}>Label
                      <input className={inputClass} required maxLength={MAX_GIT_WORKFLOW_CHECK_LABEL} value={check.label} onChange={(e) => updateCheck(index, "label", e.target.value)} placeholder="Unit tests" />
                    </label>
                    <label className={labelClass}>Executable (one path or name)
                      <input className={inputClass} required maxLength={MAX_GIT_WORKFLOW_CHECK_EXECUTABLE} value={check.executable} onChange={(e) => updateCheck(index, "executable", e.target.value)} placeholder="npm" />
                    </label>
                  </div>
                  <label className={`${labelClass} mt-2`}>Arguments (one literal argument per line; max {MAX_GIT_WORKFLOW_CHECK_ARGS})
                    <textarea className={inputClass} rows={2} maxLength={MAX_GIT_WORKFLOW_CHECK_ARGS * (MAX_GIT_WORKFLOW_CHECK_ARG + 1)} value={check.argumentsText} onChange={(e) => updateCheck(index, "argumentsText", e.target.value)} placeholder={"run\ntest"} />
                  </label>
                </div>
              ))}</div>
              <button type="button" disabled={disabled || draft.checks.length >= MAX_GIT_WORKFLOW_CHECKS} className="mt-2 rounded border border-border px-2 py-1 text-accent disabled:opacity-50" onClick={() => setDraft((current) => ({ ...current, checksPresent: true, checks: [...current.checks, { label: "", executable: "", argumentsText: "" }] }))}>Add check ({draft.checks.length}/{MAX_GIT_WORKFLOW_CHECKS})</button>
            </fieldset>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={disabled} className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50">{saving ? "Saving…" : sessionId ? "Save session policy" : choice === "project" ? "Save project default" : "Set new-chat override"}</button>
              {!sessionId && value.project && <button type="button" disabled={disabled} onClick={() => void clearDefault()} className="rounded border border-border px-3 py-1.5 disabled:opacity-50">Clear project default</button>}
              {!sessionId && pendingOverride && <button type="button" disabled={disabled} onClick={resetOverride} className="rounded border border-border px-3 py-1.5 disabled:opacity-50">Use project default for this chat</button>}
            </div>
          </form>
          {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
          {feedback && <p role="status" className="mt-2 text-text-muted">{feedback}</p>}
        </>}
      </div>
    </section>
  );
}
