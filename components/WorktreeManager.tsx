"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { WorktreeManagementInventory, WorktreeManagementRow, WorktreeManagementDetails, MergeDate } from "@/lib/worktree-management-types";
import type { ProjectOperation } from "@/lib/plugins/project-operation-types";
import { managementRows, managementPendingOrder, managementPage, managementDatesComplete, type ManagementFilter, type ManagementCheckoutFilter, type ManagementSort } from "@/lib/worktree-management-view";
import { BundledPluginSettings } from "./plugin-ui/BundledPluginSettings";
import { PluginCardContent } from "./plugin-ui/PluginCard";
import styles from "./WorktreeManager.module.css";

const ACTIONS = "/api/plugins/bundled/git-workflow/project-actions";
const pending = (op: ProjectOperation) => ["preparing", "review", "dispatched"].includes(op.state);
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}
function post<T>(url: string, body: unknown) {
  return json<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
type Preparation = { context: number; body: { cwd: string; requestId: string; action: string; payload: unknown } };

export function WorktreeManager({ cwd, onClose, onChanged, onSelectCheckout, onReturnFocus }: {
  cwd: string; onClose: () => void; onChanged: () => void; onSelectCheckout: (path: string) => void; onReturnFocus: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), body = useRef<HTMLDivElement>(null), operationSurface = useRef<HTMLElement>(null);
  const returnFocus = useRef(onReturnFocus); returnFocus.current = onReturnFocus;
  const scrollBookmark = useRef(0), focusRow = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const restoreInteractionFocus = () => requestAnimationFrame(() => {
    const row = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button[data-manager-row]") ?? [])].find((button) => button.dataset.managerRow === focusRow.current);
    const element = row ?? (searchInput.current?.disabled ? closeButton.current : searchInput.current) ?? closeButton.current;
    element?.focus({ preventScroll: true });
  });
  const [inventory, setInventory] = useState<WorktreeManagementInventory | null>(null);
  const [target, setTarget] = useState<string | undefined>();
  const contextKey = JSON.stringify([cwd, target]);
  const contextIdentity = useRef(contextKey), currentContext = useRef(0);
  if (contextIdentity.current !== contextKey) { contextIdentity.current = contextKey; currentContext.current++; }
  const preparation = useRef<Preparation | null>(null);
  const [uncertainPreparation, setUncertainPreparation] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const [operationsReady, setOperationsReady] = useState(false), [selectingOperation, setSelectingOperation] = useState(false);
  const selectionRead = useRef<AbortController | null>(null), selectionSequence = useRef(0);
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [filter, setFilter] = useState<ManagementFilter>("all");
  const [checkoutFilter, setCheckoutFilter] = useState<ManagementCheckoutFilter>("all");
  const [sort, setSort] = useState<ManagementSort>("integrated-first"), [sortIntent, setSortIntent] = useState<ManagementSort>("integrated-first"), [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, WorktreeManagementDetails["rows"][number]>>({});
  const [settings, setSettings] = useState<"targetBranch" | "enabled" | null>(null);
  const [dateLoading, setDateLoading] = useState(false), [dateProgress, setDateProgress] = useState(0);
  const [dateAttempt, setDateAttempt] = useState(0);
  const dateAbort = useRef<AbortController | null>(null);
  const [operations, setOperations] = useState<ProjectOperation[]>([]), [operation, setOperation] = useState<ProjectOperation | null>(null);
  const operationRef = useRef(operation); operationRef.current = operation;
  const operationReads = useRef<AbortController | null>(null), operationLoadSequence = useRef(0);
  const [sending, setSending] = useState(false);
  const [resource, setResource] = useState<"both" | "worktree" | "branch">("both"), [worktreePath, setWorktreePath] = useState("");
  const outcomeHandled = useRef(new Set<string>()), mounted = useRef(true);
  const cancelOperation = useCallback(() => {
    const op = operationRef.current, request = preparation.current?.body;
    if (op && pending(op)) void post(`${ACTIONS}/${op.id}`, { cwd: op.cwd, decision: "stop" }).catch(() => {});
    else if (request) void post(`${ACTIONS}/${request.requestId}`, { cwd: request.cwd, decision: "stop" }).catch(() => {});
  }, []);
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current!, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; element.showModal();
    return () => {
      mounted.current = false; dateAbort.current?.abort(); operationReads.current?.abort(); selectionRead.current?.abort(); cancelOperation();
      element.close(); document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true }); else returnFocus.current();
    };
  }, [cancelOperation]);
  useEffect(() => {
    cancelOperation(); setOperation(null); operationRef.current = null;
    preparation.current = null; setUncertainPreparation(false); setSending(false); setOperationsReady(false);
    selectionRead.current?.abort(); selectionRead.current = null; selectionSequence.current++; setSelectingOperation(false);
  }, [contextKey, cancelOperation]);
  const close = () => { cancelOperation(); onClose(); };
  const reloadOperations = useCallback(() => {
    setOperationsReady(false);
    const sequence = ++operationLoadSequence.current, context = currentContext.current;
    operationReads.current?.abort();
    const controller = new AbortController(); operationReads.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && sequence === operationLoadSequence.current && context === currentContext.current;
    void json<{ operations: ProjectOperation[] }>(`${ACTIONS}?${new URLSearchParams({ cwd })}`, { signal: controller.signal })
      .then(async (data) => {
        if (!current()) return;
        setOperations(data.operations);
        const active = data.operations.find((op) => pending(op));
        if (active && !operationRef.current && !preparation.current) {
          const live = await json<ProjectOperation>(`${ACTIONS}/${active.id}`, { signal: controller.signal });
          if (current() && !operationRef.current && !preparation.current) { operationRef.current = live; setOperation(live); }
        }
        if (current()) setOperationsReady(true);
      }).catch((cause) => { if (current()) setError(String(cause)); });
  }, [cwd]);
  const selectHistoricalOperation = async (op: ProjectOperation) => {
    selectionRead.current?.abort(); const controller = new AbortController(); selectionRead.current = controller;
    const sequence = ++selectionSequence.current, expectedContext = currentContext.current;
    const current = () => mounted.current && !controller.signal.aborted && sequence === selectionSequence.current && expectedContext === currentContext.current;
    setSelectingOperation(true);
    try {
      const latest = await json<ProjectOperation>(`${ACTIONS}/${op.id}`, { signal: controller.signal });
      if (!current()) return;
      if (!pending(latest)) outcomeHandled.current.add(latest.id);
      setOperation(latest);
    } catch (cause) { if (current()) setError(String(cause)); }
    finally { if (current()) { selectionRead.current = null; setSelectingOperation(false); } }
  };
  useEffect(() => {
    const changed = () => {
      cancelOperation(); currentContext.current++;
      preparation.current = null; setUncertainPreparation(false); setSending(false);
      selectionRead.current?.abort(); selectionRead.current = null; selectionSequence.current++; setSelectingOperation(false);
      setOperation((op) => op?.state === "dispatched" ? op : null);
      setRefresh((v) => v + 1);
    };
    window.addEventListener("pi-web:bundled-plugin-settings", changed);
    return () => window.removeEventListener("pi-web:bundled-plugin-settings", changed);
  }, [cancelOperation]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setCaptureReady(false); setError(""); setDetails({}); dateAbort.current?.abort(); setDateLoading(false);
    const query = new URLSearchParams({ cwd }); if (target) query.set("target", target);
    void json<WorktreeManagementInventory>(`/api/worktrees/manage?${query}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setInventory(data); setCaptureReady(true); setLoading(false); } })
      .catch((cause) => { if (!controller.signal.aborted) { setError(String(cause)); setLoading(false); } });
    reloadOperations();
    return () => controller.abort();
  }, [cwd, target, refresh, reloadOperations]);
  const rows = useMemo(() => inventory?.rows.map((row) => details[row.id] ? { ...row, mergeDate: details[row.id].mergeDate } : row) ?? [], [inventory, details]);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const matching = managementRows(rows, { search, integration: filter, checkout: checkoutFilter, sort: "name", descending: false });
  const matchingIds = JSON.stringify(matching.map((row) => row.id));
  const completeDates = managementDatesComplete(matching);
  const effectiveSort = sort === "merge" && !completeDates ? "integrated-first" : sort;
  const lastCompleteOrder = useRef<string[]>([]);
  const datePreparationPending = sortIntent === "merge" && !completeDates;
  const ordered = managementRows(rows, { search, integration: filter, checkout: checkoutFilter, sort: effectiveSort, descending });
  const filtered = datePreparationPending ? managementPendingOrder(ordered, lastCompleteOrder.current) : ordered;
  const orderedIds = JSON.stringify(filtered.map((row) => row.id));
  useEffect(() => { if (!datePreparationPending && !loading) lastCompleteOrder.current = JSON.parse(orderedIds); }, [orderedIds, datePreparationPending, loading]);
  const currentPage = managementPage(page, filtered.length), visible = filtered.slice(currentPage * 50, currentPage * 50 + 50);
  const visibleIds = JSON.stringify(visible.map((row) => row.id)), captureId = inventory?.captureId;
  const loadDetails = useCallback(async (ids: string[], signal: AbortSignal, datesOnly = false) => {
    if (!captureId) return;
    const query = new URLSearchParams({ cwd, captureId, details: "1", rows: JSON.stringify(ids) });
    if (datesOnly) query.set("datesOnly", "1");
    const data = await json<WorktreeManagementDetails>(`/api/worktrees/manage?${query}`, { signal });
    if (!signal.aborted) setDetails((old) => {
      const next = { ...old };
      for (const row of data.rows) next[row.id] = datesOnly && next[row.id] ? { ...row, statuses: next[row.id].statuses } : row;
      return next;
    });
  }, [cwd, captureId]);
  useEffect(() => {
    if (loading || !captureReady || settings || dateLoading || !captureId) return;
    const ids: string[] = JSON.parse(visibleIds); if (!ids.length) return;
    const controller = new AbortController();
    void loadDetails(ids, controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [captureId, visibleIds, loadDetails, loading, captureReady, settings, dateLoading]);
  useEffect(() => {
    if (loading || !captureReady || !captureId) return;
    dateAbort.current?.abort();
    if (sortIntent !== "merge") { setDateLoading(false); setSort(sortIntent); return; }
    const matchingSet = new Set<string>(JSON.parse(matchingIds));
    const ids = rowsRef.current.filter((row) => matchingSet.has(row.id) && row.mergeDate.state === "not-loaded").map((row) => row.id);
    if (!ids.length) { setSort("merge"); setDateLoading(false); return; }
    const controller = new AbortController(); dateAbort.current = controller;
    setDateLoading(true); setDateProgress(0); setError("");
    void (async () => {
      try {
        for (let i = 0; i < ids.length; i += 50) {
          await loadDetails(ids.slice(i, i + 50), controller.signal, true);
          if (controller.signal.aborted) return;
          setDateProgress(Math.min(i + 50, ids.length));
        }
        if (!controller.signal.aborted) { setSort("merge"); setDateLoading(false); }
      } catch (cause) { if (!controller.signal.aborted) { setError(String(cause)); setDateLoading(false); setSortIntent("integrated-first"); } }
    })();
    return () => controller.abort();
  }, [captureId, matchingIds, sortIntent, loadDetails, loading, captureReady, dateAttempt]);
  const operationId = operation?.id, operationState = operation?.state;
  useEffect(() => {
    if (!operationId || !["preparing", "review", "dispatched"].includes(operationState ?? "")) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await json<ProjectOperation>(`${ACTIONS}/${operationId}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setOperation(next); timer = setTimeout(poll, 600); }
      } catch (cause) { if (!controller.signal.aborted) { setError(String(cause)); timer = setTimeout(poll, 1500); } }
    };
    timer = setTimeout(poll, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [operationId, operationState]);
  useEffect(() => {
    if (sending || operationState === "review" || operationState === "preparing") {
      operationSurface.current?.focus({ preventScroll: true }); operationSurface.current?.scrollIntoView({ block: "nearest" });
    }
  }, [operationId, operationState, sending]);
  useEffect(() => {
    if (!operation || pending(operation) || outcomeHandled.current.has(operation.id)) return;
    outcomeHandled.current.add(operation.id); reloadOperations();
    if (["succeeded", "failed", "outcome-unknown"].includes(operation.state)) { setRefresh((v) => v + 1); onChanged(); }
  }, [operation, reloadOperations, onChanged]);
  const expandedRow = rows.find((row) => row.id === expanded);
  const expandedPaths = JSON.stringify(expandedRow?.worktrees.map((w) => w.path) ?? []);
  useEffect(() => {
    const paths: string[] = JSON.parse(expandedPaths);
    if (!paths.length) { setResource("branch"); setWorktreePath(""); }
    else { setWorktreePath((path) => paths.includes(path) ? path : paths[0]); setResource((value) => value === "branch" ? "both" : value); }
  }, [expandedPaths]);
  const submitPreparation = async () => {
    const request = preparation.current; if (!request || sending) return;
    setSending(true); setError("");
    try {
      const next = await post<ProjectOperation>(ACTIONS, request.body);
      if (!mounted.current || request.context !== currentContext.current) {
        void post(`${ACTIONS}/${next.id}`, { cwd: next.cwd, decision: "stop" }).catch(() => {}); return;
      }
      preparation.current = null; setUncertainPreparation(false); operationRef.current = next; setOperation(next);
    } catch (cause) { if (mounted.current && request.context === currentContext.current) { setError(String(cause)); setUncertainPreparation(true); } }
    finally { if (mounted.current && request.context === currentContext.current) setSending(false); }
  };
  const prepare = (row: WorktreeManagementRow) => {
    if (!captureReady || !operationsReady || selectingOperation || !inventory?.target.tip || !row.branch || !row.tip || sending || preparation.current || operation && pending(operation)) return;
    if (resource !== "branch" && !row.worktrees.some((w) => w.path === worktreePath)) return;
    selectionRead.current?.abort(); selectionRead.current = null; selectionSequence.current++;
    focusRow.current = row.id;
    setOperation(null);
    preparation.current = { context: currentContext.current, body: { cwd, requestId: crypto.randomUUID(), action: "cleanup", payload: {
      featureBranch: row.branch, featureTip: row.tip, integrationCommit: inventory.target.tip, targetBranch: inventory.target.branch,
      ...(resource !== "branch" ? { worktreePath } : {}), removeWorktree: resource !== "branch", deleteBranch: resource !== "worktree",
    } } };
    void submitPreparation();
  };
  const decide = async (decision: "approve" | "reject" | "stop") => {
    if (!operation || sending) return;
    const expectedContext = currentContext.current;
    setSending(true); setError("");
    try {
      const next = await post<ProjectOperation>(`${ACTIONS}/${operation.id}`, { cwd: operation.cwd, decision });
      if (mounted.current && expectedContext === currentContext.current) setOperation(next);
    } catch (cause) { if (mounted.current && expectedContext === currentContext.current) setError(String(cause)); }
    finally { if (mounted.current && expectedContext === currentContext.current) setSending(false); }
  };
  const openSettings = (field: "targetBranch" | "enabled") => { scrollBookmark.current = body.current?.scrollTop ?? 0; setSettings(field); };
  const backFromSettings = () => { setSettings(null); setRefresh((v) => v + 1); requestAnimationFrame(() => { if (body.current) body.current.scrollTop = scrollBookmark.current; }); restoreInteractionFocus(); };
  const dateText = (value: string | null) => value ? new Date(value).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : t("manager.unavailable");
  const fullDate = (value: string | null) => value ? new Date(value).toLocaleString(locale, { timeZoneName: "short" }) : t("manager.unavailable");
  const mergeText = (value: MergeDate) => value.state === "available" ? dateText(value.date) : t(`manager.date.${value.state}`);
  const targetMismatch = Boolean(inventory?.target.temporary && inventory.target.configured && inventory.cleanup?.targetSelection === "configured");
  const busy = sending || selectingOperation || uncertainPreparation || Boolean(operation && pending(operation));
  const canReview = (row: WorktreeManagementRow) => captureReady && operationsReady && !loading && !busy && inventory?.checkout === cwd && row.integration === "integrated" && !row.blockers.length && inventory?.cleanup?.enabled && inventory.cleanup.permission !== "deny" && !targetMismatch;
  const resetFilters = () => { setSearch(""); setFilter("all"); setCheckoutFilter("all"); setPage(0); };
  return <dialog ref={dialog} aria-labelledby="worktree-manager-title" className={styles.dialog} onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className={styles.header}>
      <div><h2 id="worktree-manager-title">{t("manager.title")}</h2><p className={styles.path}>{inventory?.mainCheckout ?? cwd}</p></div>
      <button ref={closeButton} type="button" onClick={close}>{t("manager.close")}</button>
    </header>
    <div ref={body} className={styles.body}>
      {error && <p role="alert" className={styles.error}>{error} <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>{t("manager.refresh")}</button></p>}
      {settings ? <section>
        <button type="button" onClick={backFromSettings}>{t("manager.back")}</button>
        <BundledPluginSettings cwd={cwd} id="git-workflow" initialScope="project" initialField={settings} />
      </section> : <>
        <div className={styles.controls}>
          <label>{t("manager.target")} <select aria-label={t("manager.target")} disabled={loading || busy} value={inventory?.target.branch ?? ""} onChange={(event) => { cancelOperation(); setOperation(null); setTarget(event.target.value || undefined); setPage(0); }}>
            <option value="">{t("manager.chooseTarget")}</option>{inventory?.targets.map((branch) => <option key={branch.branch}>{branch.branch}</option>)}
          </select></label>
          <button type="button" disabled={loading || busy} onClick={() => setRefresh((v) => v + 1)}>{t("manager.refresh")}</button>
          <button type="button" disabled={busy} onClick={() => openSettings("targetBranch")}>{t("manager.targetSettings")}</button>
        </div>
        {inventory && <p className={styles.note}>{inventory.target.temporary ? t("manager.temporary") : t("manager.targetSource", { source: t(`manager.source.${inventory.target.source}`) })}</p>}
        {!inventory?.target.branch && !loading && <p role="status">{t("manager.targetNeeded")}</p>}
        {inventory?.target.missingConfigured && <p className={styles.note}>{t("manager.missingTarget", { branch: inventory.target.configured ?? "" })}</p>}
        {targetMismatch && <p role="status" className={styles.notice}>{t("manager.targetMismatch")} <button type="button" disabled={busy} onClick={() => setTarget(undefined)}>{t("manager.useDesignated")}</button></p>}
        {inventory?.cleanup && !inventory.cleanup.enabled && <p className={styles.notice}>{t("manager.pluginRequired")} <button type="button" onClick={() => openSettings("enabled")}>{t("manager.pluginSettings")}</button> {t("manager.globalEnablement")}</p>}
        {inventory?.cleanup?.permission === "deny" && inventory.cleanup.enabled && <p className={styles.notice}>{t("manager.denied")}</p>}
        <p className={styles.note}>{t("manager.dateNote")}</p>
        {inventory && <p className={styles.note}>{t("manager.counts", inventory.counts)}</p>}
        <div className={styles.controls}>
          <input ref={searchInput} aria-label={t("manager.search")} placeholder={t("manager.search")} value={search} disabled={dateLoading} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
          <label>{t("manager.integration")} <select aria-label={t("manager.integration")} value={filter} disabled={dateLoading} onChange={(event) => { setFilter(event.target.value as ManagementFilter); setPage(0); }}>
            {["all", "integrated", "not-integrated", "unknown"].map((value) => <option key={value} value={value}>{t(`manager.integration.${value}`)}</option>)}
          </select></label>
          <label>{t("manager.worktrees")} <select aria-label={t("manager.worktrees")} value={checkoutFilter} disabled={dateLoading} onChange={(event) => { setCheckoutFilter(event.target.value as ManagementCheckoutFilter); setPage(0); }}>
            {["all", "has", "none", "diagnostic"].map((value) => <option key={value} value={value}>{t(`manager.checkout.${value}`)}</option>)}
          </select></label>
          <label>{t("manager.sort")} <select aria-label={t("manager.sort")} value={sortIntent} disabled={loading || dateLoading} onChange={(event) => { setSortIntent(event.target.value as ManagementSort); setDateAttempt((v) => v + 1); }}>
            {["integrated-first", "name", "tip", "merge"].map((value) => <option key={value} value={value}>{t(`manager.sort.${value}`)}</option>)}
          </select></label>
          <button type="button" aria-pressed={descending} onClick={() => setDescending((value) => !value)}>{t(descending ? "manager.descending" : "manager.ascending")}</button>
          <button type="button" disabled={dateLoading} onClick={resetFilters}>{t("manager.clearFilters")}</button>
        </div>
        {dateLoading && <p role="status">{t("manager.loadingDates", { count: dateProgress })} <button type="button" onClick={() => { dateAbort.current?.abort(); setDateLoading(false); setSortIntent(effectiveSort === "merge" ? "integrated-first" : effectiveSort); }}>{t("manager.cancel")}</button></p>}
        {(operation || sending || uncertainPreparation) && <section ref={operationSurface} tabIndex={-1} className={styles.operation} aria-label={t("manager.operation")}>
          <h3>{t("manager.operation")}</h3>
          {!operation && <><p role="status">{t(uncertainPreparation ? "manager.preparationUncertain" : "manager.operation.preparing")}</p>{uncertainPreparation && <button type="button" disabled={sending} onClick={() => void submitPreparation()}>{t("manager.reconcilePreparation")}</button>}</>}
          {operation && <>
            <p role="status">{t(`manager.operation.${operation.state}`)}</p>
            {operation.progress && <p>{operation.progress}</p>}{operation.error && <p role="alert" className={styles.error}>{operation.error}</p>}{operation.persistenceError && <p role="alert">{operation.persistenceError}</p>}
            {(operation.card ?? operation.receipt?.card) && <PluginCardContent reviewBaseUrl={operation.reviewBaseUrl} request={{ ...(operation.card ?? operation.receipt!.card), id: operation.id, type: "extension_ui_request", method: "plugin_card", pluginId: operation.pluginId }} />}
            {operation.result !== undefined && <pre className={styles.result}>{JSON.stringify(operation.result, null, 2)}</pre>}
            {operation.state === "review" && operation.card && operation.cwd === cwd && <div className={styles.controls}>
              <button type="button" disabled={sending} onClick={() => void decide("reject")}>{t("manager.keepResources")}</button>
              <button type="button" disabled={sending} className={styles.danger} onClick={() => void decide("approve")}>{operation.card.actions.find((action) => action.primary)?.label ?? t("manager.confirmCleanup")}</button>
            </div>}
            {pending(operation) && (operation.state !== "review" || operation.cwd !== cwd) && <><p>{t("manager.stopNote")}</p><button type="button" disabled={sending} onClick={() => void decide("stop")}>{t("manager.stop")}</button></>}
            {!pending(operation) && <button type="button" onClick={() => { setOperation(null); setRefresh((v) => v + 1); restoreInteractionFocus(); }}>{t("manager.refreshActual")}</button>}
          </>}
        </section>}
        {loading && <p role="status">{t("manager.loading")}</p>}
        {inventory && <>
          <p className={styles.note}>{t("manager.range", { start: filtered.length ? currentPage * 50 + 1 : 0, end: Math.min((currentPage + 1) * 50, filtered.length), total: filtered.length })}</p>
          <table className={styles.table} aria-busy={loading}>
            <thead><tr><th aria-sort={effectiveSort === "name" ? descending ? "descending" : "ascending" : undefined}>{t("manager.branch")}</th><th>{t("manager.integration")}</th><th aria-sort={effectiveSort === "tip" ? descending ? "descending" : "ascending" : undefined}>{t("manager.tipDate")}</th><th aria-sort={effectiveSort === "merge" ? descending ? "descending" : "ascending" : undefined}>{t("manager.mergeDate")}</th><th>{t("manager.cleanup")}</th></tr></thead>
            <tbody>{visible.map((row) => <Fragment key={row.id}>
              <tr data-branch={row.branch ?? ""}>
                <td data-label={t("manager.branch")}><button data-manager-row={row.id} type="button" aria-expanded={expanded === row.id} onClick={() => { setExpanded(expanded === row.id ? null : row.id); setResource(row.worktrees.length ? "both" : "branch"); setWorktreePath(row.worktrees[0]?.path ?? ""); }}>{row.branch ?? t("manager.detached")}</button>
                  <small>{row.worktrees.length ? t("manager.worktreeCount", { count: row.worktrees.length }) : t("manager.noWorktree")}</small>
                  {row.worktrees.some((w) => w.main) && <small> · {t("manager.main")}</small>}{row.worktrees.some((w) => w.selected) && <small> · {t("manager.selected")}</small>}
                </td>
                <td data-label={t("manager.integration")}>{t(`manager.integration.${row.integration}`)}</td>
                <td data-label={t("manager.tipDate")}><time dateTime={row.tipDate ?? undefined} title={fullDate(row.tipDate)}>{dateText(row.tipDate)}</time></td>
                <td data-label={t("manager.mergeDate")}>{mergeText(row.mergeDate)}</td>
                <td data-label={t("manager.cleanup")}><span>{row.blockers.length ? row.blockers.map((v) => t(`manager.blocker.${v}`)).join(" · ") : t("manager.reviewNeeded")}</span></td>
              </tr>
              {expanded === row.id && <tr><td colSpan={5} className={styles.details}>
                <section><h3>{t("manager.evidence")}</h3><p className={styles.path}>HEAD: {row.tip ?? t("manager.unavailable")}</p><p>{row.subject}</p><p>{t("manager.tipDate")}: {fullDate(row.tipDate)} · {t("manager.authorDate")}: {fullDate(row.authorDate)}</p>
                  <p className={styles.path}>{t("manager.target")}: {inventory.target.branch ?? "—"} · {inventory.target.tip ?? "—"}</p>
                  {row.integrationReason && <p>{t(`manager.reason.${row.integrationReason}`)}</p>}
                  <p>{t("manager.mergeDate")}: {mergeText(row.mergeDate)}</p>
                  {row.mergeDate.state === "available" && <><p>{fullDate(row.mergeDate.date)}</p><p className={styles.path}>{row.mergeDate.commit}</p><p>{t("manager.mergeEvidence")}</p></>}
                  {row.mergeDate.state === "unavailable" && <p>{t(`manager.reason.${row.mergeDate.reason}`)}</p>}
                </section>
                <section><h3>{t("manager.checkoutState")}</h3>
                  {!row.worktrees.length && <p>{t("manager.noWorktree")}</p>}
                  {row.worktrees.map((w) => { const status = details[row.id]?.statuses.find((v) => v.path === w.path); return <div key={w.path} className={styles.checkout}>
                    <p className={styles.path}>{w.path}</p><p>{[w.detached && t("manager.detached"), w.locked !== null && t("manager.locked"), w.missing && t("manager.missing"), w.prunable !== null && t("manager.prunable")].filter(Boolean).join(" · ")}</p>
                    {status ? <><p>{t(`manager.status.${status.state}`)}{status.ignored.length ? ` · ${t("manager.ignored")}` : ""}</p><p>{t("manager.submodules")}</p>{status.reason && <p>{status.reason}</p>}
                      {status.untracked.length > 0 && <><p>{t("manager.untrackedBlocker")}</p><pre>{status.untracked.join("\n")}</pre></>}
                      {status.ignored.length > 0 && <details><summary>{t("manager.ignored")}</summary><pre>{status.ignored.join("\n")}</pre></details>}
                    </> : <p>{t("manager.loading")}</p>}
                    {w.selected && inventory.mainCheckout !== w.path && <button type="button" disabled={busy} onClick={() => { cancelOperation(); onSelectCheckout(inventory.mainCheckout); }}>{t("manager.selectMain")}</button>}
                  </div>; })}
                </section>
                <section><h3>{t("manager.cleanupOptions")}</h3><p>{t("manager.idleWarning")}</p>
                  <label>{t("manager.resources")} <select aria-label={t("manager.resources")} value={resource} disabled={busy} onChange={(event) => setResource(event.target.value as typeof resource)}>
                    {row.worktrees.length > 0 && <><option value="both">{t("manager.removeBoth")}</option><option value="worktree">{t("manager.removeWorktree")}</option></>}
                    <option value="branch" disabled={row.worktrees.length > 0}>{t("manager.deleteBranch")}</option>
                  </select></label>
                  {row.worktrees.length > 1 && resource !== "branch" && <label>{t("manager.worktreePath")} <select aria-label={t("manager.worktreePath")} value={worktreePath} disabled={busy} onChange={(event) => setWorktreePath(event.target.value)}>{row.worktrees.map((w) => <option key={w.path}>{w.path}</option>)}</select></label>}
                  <button type="button" disabled={!canReview(row) || row.worktrees.length > 0 && (details[row.id]?.statuses.length !== row.worktrees.length || details[row.id]?.statuses.some((status) => status.state !== "clean"))} onClick={() => prepare(row)}>{t("manager.reviewCleanup")}</button>
                  {row.blockers.length > 0 && <p>{row.blockers.map((v) => t(`manager.blocker.${v}`)).join(" · ")}</p>}
                </section>
              </td></tr>}
            </Fragment>)}</tbody>
          </table>
          {!filtered.length && <p role="status">{t(rows.length ? "manager.noMatches" : "manager.noResources")}</p>}
          <div className={styles.controls}><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("manager.previous")}</button><button type="button" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>{t("manager.next")}</button></div>
        </>}
        {operations.length > 0 && <details className={styles.history}><summary>{t("manager.recentOperations")}</summary>{operations.map((op) => <div key={op.id}><button type="button" disabled={busy || !operationsReady} onClick={() => void selectHistoricalOperation(op)}>{dateText(op.createdAt)} · {t(`manager.operation.${op.state}`)}</button></div>)}</details>}
      </>}
    </div>
  </dialog>;
}
