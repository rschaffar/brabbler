"use client";

import { useEffect, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";

type Worktree = { path: string; branch: string | null; isMain: boolean };
type WorktreesResponse = { isGit: boolean; isTopLevel: boolean; currentWorktreePath: string | null; worktrees: Worktree[] };
type Props = {
  sessionId: string; cwd: string; busy: boolean; transient?: boolean; assistantLeafId?: string | null;
  onSessionMoved?: (sessionId: string, cwd: string) => Promise<void>;
  onSessionForkedToWorktree?: (sessionId: string, cwd: string) => void;
};

/** The existing confirmed move/clone+move flow, without the old policy editor. */
export function GitWorkspaceContinuation({ sessionId, cwd, busy, transient, assistantLeafId, onSessionMoved, onSessionForkedToWorktree }: Props) {
  const [actualCwd, setActualCwd] = useState<string | null>(null);
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
    setWorktrees(null); setChangedCount(null); setActualCwd(null);
    setMoveTarget(null); setDestination(""); setMoveError(null); setForkTarget(null);
    // A failed cloned session remains visible for inspection, even after a refresh.
    if (transient) return;
    const controller = new AbortController();
    const get = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const body = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      return body;
    };
    void (async () => {
      const { info } = await get<{ info: { cwd: string } }>(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (info.cwd !== cwd) throw new Error("This chat’s checkout changed. Reopen the chat before continuing it elsewhere.");
      const actualCwd = info.cwd; // Persisted header, never the sidebar's selected checkout.
      const [list, status] = await Promise.all([
        get<WorktreesResponse>(`/api/worktrees?cwd=${encodeURIComponent(actualCwd)}`),
        get<{ files: unknown[] }>(`/api/git/status?cwd=${encodeURIComponent(actualCwd)}`),
      ]);
      if (controller.signal.aborted) return;
      setActualCwd(actualCwd); setWorktrees(list); setChangedCount(status.files.length);
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setMoveError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [sessionId, cwd, transient, moveRevision]);

  const moveDisabled = busy || moving || forking || Boolean(transient) || changedCount === null;
  const forkDisabled = moveDisabled || !assistantLeafId;
  const availableTargets = worktrees?.isGit && worktrees.isTopLevel && worktrees.currentWorktreePath
    && actualCwd && worktrees.worktrees.some((item) => item.path === worktrees.currentWorktreePath)
    ? worktrees.worktrees.filter((item) => item.path !== worktrees.currentWorktreePath) : [];
  async function confirmMove() {
    if (!moveTarget || !availableTargets.some((item) => item.path === moveTarget) || moveDisabled || moveInFlightRef.current) return;
    moveInFlightRef.current = true; setMoving(true); setMoveError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/move`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: moveTarget }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      await onSessionMoved?.(sessionId, moveTarget);
      setMoveTarget(null);
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : String(cause));
      // Only a read is retried. A failed move is never replayed.
    } finally { moveInFlightRef.current = false; setMoving(false); }
  }
  async function confirmFork() {
    if (!assistantLeafId || !forkTarget || !availableTargets.some((item) => item.path === forkTarget) || forkDisabled || moveInFlightRef.current) return;
    moveInFlightRef.current = true; setForking(true); setForkError(null);
    let newSessionId: string | null = null;
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sessionId, { type: "clone", leafId: assistantLeafId });
      if (result?.cancelled || !result?.newSessionId) throw new Error("Cannot clone an empty or unsaved session with an assistant leaf.");
      newSessionId = result.newSessionId;
      const response = await fetch(`/api/sessions/${encodeURIComponent(newSessionId)}/move`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: forkTarget }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      onSessionForkedToWorktree?.(newSessionId, forkTarget);
      setForkTarget(null);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      setForkError(newSessionId
        ? `Fork ${newSessionId} was retained (not deleted). Move to ${forkTarget} failed: ${error}. Open the fork by ID to retry.` : error);
    } finally { moveInFlightRef.current = false; setForking(false); }
  }
  const inputClass = "min-w-0 w-full rounded border border-border bg-bg px-2 py-1 text-text disabled:opacity-50";
  const labelClass = "flex min-w-0 flex-col gap-1 text-xs text-text-muted";
  return <section className="git-panel-content min-w-0 space-y-3 text-sm text-text" aria-label="Continue session in another worktree">
    <p className="font-semibold">Continue this session in another registered worktree</p>
    <p className="break-all text-xs text-text-muted">Actual chat checkout: <code>{actualCwd ?? cwd}</code></p>
    {transient ? <p>Wait for this session to be persisted before moving it.</p> : !worktrees && !moveError ? <p role="status">Checking worktrees and changed files…</p> : null}
    {worktrees && changedCount !== null && <>
      <p className="text-xs text-text-muted">{changedCount > 0 ? `Dirty source checkout: ${changedCount} changed file${changedCount === 1 ? "" : "s"}. ` : "No changed files detected. "}Uncommitted files stay in the source checkout; they do not follow the session.</p>
      {!worktrees.isTopLevel || !worktrees.currentWorktreePath ? <p>The session must be at a registered checkout root to continue into another worktree.</p>
        : availableTargets.length === 0 ? <p>No other registered worktrees are available.</p> : <>
          <label className={labelClass}>Destination worktree
            <select className={inputClass} value={availableTargets.some((item) => item.path === destination) ? destination : ""} disabled={moving || forking}
              onChange={(event) => { setDestination(event.target.value); setMoveTarget(null); setForkTarget(null); setMoveError(null); }}>
              <option value="">Choose a worktree…</option>
              {worktrees.worktrees.map((item) => <option key={item.path} value={item.path} disabled={item.path === worktrees.currentWorktreePath}>
                {item.branch ?? "detached HEAD"}{item.isMain ? " · main checkout" : ""}{item.path === worktrees.currentWorktreePath ? " · actual chat checkout" : ""} · {item.path}
              </option>)}
            </select>
          </label>
          <div className="workflow-actions"><button type="button" disabled={moveDisabled || !availableTargets.some((item) => item.path === destination)} onClick={() => { setMoveTarget(destination); setForkTarget(null); setMoveError(null); }}>Continue here…</button>
            <button type="button" disabled={forkDisabled || !availableTargets.some((item) => item.path === destination)} onClick={() => { setForkTarget(destination); setMoveTarget(null); }}>Fork chat here…</button></div>
        </>}
      {forkTarget && availableTargets.some((item) => item.path === forkTarget) && <div className="space-y-2 rounded border border-border p-3">
        <p className="break-all text-xs">Fork this chat into <code>{forkTarget}</code>? The original chat stays in <code>{actualCwd}</code>. Uncommitted source files stay there and are not copied. No worktree is created or source checkout files moved.</p>
        <div className="workflow-actions"><button type="button" disabled={forkDisabled} onClick={() => void confirmFork()} className="workflow-primary">{forking ? "Forking…" : "Confirm fork"}</button><button type="button" disabled={forking} onClick={() => setForkTarget(null)}>Cancel</button></div>
      </div>}
      {!assistantLeafId && <p className="text-xs text-text-muted">Forking requires an idle persisted chat with an assistant leaf.</p>}
      {moveTarget && availableTargets.some((item) => item.path === moveTarget) && <div className="space-y-2 rounded border border-border p-3">
        <p className="break-all text-xs">Continue this same session in <code>{moveTarget}</code>? Uncommitted files stay in the source checkout <code>{actualCwd}</code> and will not be copied. This does not create a worktree or move any files.</p>
        <div className="workflow-actions"><button type="button" disabled={moveDisabled} onClick={() => void confirmMove()} className="workflow-primary">{moving ? "Moving…" : "Confirm continuation"}</button><button type="button" disabled={moving} onClick={() => setMoveTarget(null)}>Cancel</button></div>
      </div>}
    </>}
    {busy && <p role="status">Stop the running session before continuing it elsewhere.</p>}
    {forkError && <p role="alert" className="break-all text-xs">{forkError}</p>}
    {moveError && <p role="alert" className="text-xs">{moveError} <button type="button" disabled={moving || forking} onClick={() => setMoveRevision((current) => current + 1)}>Retry checkout check</button></p>}
  </section>;
}
