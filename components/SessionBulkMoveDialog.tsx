"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionMovePlan } from "@/lib/session-worktrees-types";
import { SessionMoveDestinationPicker } from "./SessionMoveDestinationPicker";
import { DirectoryPickerPortalContext } from "./DirectoryPicker";

export interface BulkMoveRequest { project: string; ids?: string[]; missingOnly: boolean }
export function SessionBulkMoveDialog({ request, projects, onClose, onSettled }: {
  request: BulkMoveRequest;
  projects: readonly { root: string; key: string }[];
  onClose: () => void;
  onSettled: (movedIds: string[], failedIds: string[] | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [destination, setDestination] = useState("");
  const [plan, setPlan] = useState<SessionMovePlan | null>(null);
  const [alreadyThere, setAlreadyThere] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ succeeded: string[]; failed: { id: string; error: string }[]; skipped: string[]; movedIds: string[] } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const operation = useRef(false);
  const proposeDestination = useCallback((value: string) => {
    setDestination(value); setPlan(null); setError(null);
  }, []);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    // React's autoFocus runs while the dialog is still closed. Focus explicitly
    // after showModal so the first combobox does not open over the Browse button.
    closeButton.current?.focus();
    return () => element.close();
  }, []);
  // Only preview is cancellable. Dispatch remains owned until its response settles;
  // closing a modal never claims a server-side move was cancelled.
  useEffect(() => {
    if (!request.missingOnly && !destination) return;
    const controller = new AbortController();
    setPlan(null); setError(null); setAlreadyThere(0);
    void (async () => {
      try {
        const response = await fetch("/api/sessions/move", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", ...request,
            ...(!request.missingOnly ? { cwd: destination } : {}) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) { setPlan(data.plan); setAlreadyThere(data.skippedAlreadyThere?.length ?? 0); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      }
    })();
    return () => controller.abort();
  }, [request, destination, attempt]);
  const execute = async () => {
    if (!plan || operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    let movedIds: string[] = plan.roots.flatMap(root => root.memberIds);
    let failedIds: string[] | null = null;
    try {
      const response = await fetch("/api/sessions/move", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "execute", plan }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      movedIds = data.movedIds; failedIds = data.failed.map((item: { id: string }) => item.id); setResult(data); setPlan(null);
    } catch (cause) {
      setPlan(null);
      setError(`${String(cause)} ${t("sessionWorktrees.unknownOutcome")}`);
    } finally {
      // Refresh also after lost responses: a network failure is not an unchanged batch.
      try { await onSettled(movedIds, failedIds); }
      catch { setError(t("sessionWorktrees.refreshFailed")); }
      operation.current = false; setBusy(false);
    }
  };
  return <dialog ref={dialog} aria-labelledby="bulk-move-title" className="w-[min(560px,calc(100vw-24px))] rounded-xl border border-border bg-bg p-0 text-text shadow-xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); if (!operation.current) onClose(); }}
    onKeyDown={event => event.stopPropagation()}>
    <DirectoryPickerPortalContext.Provider value={dialog}>
    <div className="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto p-5">
      <h2 id="bulk-move-title" className="text-base font-semibold">{t(request.missingOnly ? "sessionWorktrees.recoverTitle" : "sessionWorktrees.moveTitle")}</h2>
      <p className="text-xs break-all text-text-muted">{request.project}</p>
      {!request.missingOnly && !result && <SessionMoveDestinationPicker projects={projects} currentProject={request.project}
        currentCwd="" destination={destination} onChange={proposeDestination} disabled={busy} />}
      {request.missingOnly && <p className="text-sm text-text-muted">{t("sessionWorktrees.recoverExplanation")}</p>}
      {plan && <div className="space-y-2 rounded-md border border-border p-3 text-sm" role="status">
        <div>{t("sessionWorktrees.confirmCounts", { count: plan.sessionCount, roots: plan.roots.length, archived: plan.archivedCount })}</div>
        <div className="break-all">{t("sessionWorktrees.destination", { path: plan.cwd })}</div>
        {alreadyThere > 0 && <div>{t("sessionWorktrees.alreadyThere", { count: alreadyThere })}</div>}
        <p className="text-xs text-text-muted">{t("sessionWorktrees.descendantsWarning")}</p>
        <p className="text-xs text-text-muted">{t("sessionWorktrees.partialWarning")}</p>
      </div>}
      {busy && <p role="status">{t("sessionWorktrees.moving")}</p>}
      {!plan && !result && !error && (request.missingOnly || destination) && <p role="status">{t("sessionWorktrees.preparing")}</p>}
      {error && <div role="alert" className="text-sm text-red-500">{error}</div>}
      {result && <div className="space-y-2 text-sm" role="status">
        <p>{t("sessionWorktrees.results", { moved: result.movedIds.length, skipped: result.skipped.length + alreadyThere, failed: result.failed.length })}</p>
        {result.failed.length > 0 && <ul className="max-h-40 overflow-y-auto text-red-500">{result.failed.map(item => <li key={item.id} className="break-all">{item.id}: {item.error}</li>)}</ul>}
      </div>}
      <div className="flex justify-end gap-3">
        <button ref={closeButton} type="button" disabled={busy} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">{t(result ? "sessionWorktrees.close" : "sidebar.cancel")}</button>
        {!result && <button type="button" disabled={busy || (!request.missingOnly && !destination)} onClick={() => { setPlan(null); setError(null); setAttempt(value => value + 1); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">{t("sessionWorktrees.reviewAgain")}</button>}
        {!result && <button type="button" disabled={busy || !plan || plan.roots.length === 0} onClick={() => void execute()} className="rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">{t("sidebar.move")}</button>}
      </div>
    </div>
    </DirectoryPickerPortalContext.Provider>
  </dialog>;
}
