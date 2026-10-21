"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { activityProjectName, activitySessionName, getActivitySections, hiddenActivitySessionIds, type ActivityItem, type ActivityStatus } from "@/lib/activity";
import type { SessionAttention, SessionInfo } from "@/lib/types";
import type { SessionPauseSnapshot } from "@/lib/session-pause";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { SubagentIcon } from "./SubagentIcon";
import { SessionWorktreeBadge } from "./SessionWorktreeBadge";
import { PrivacyEyeIcon } from "./PrivacyEyeIcon";
import type { ProjectPrivacy } from "@/hooks/useHiddenProjects";
import { getShowHiddenProjects, saveShowHiddenProjects } from "@/lib/show-hidden-projects-preference";

interface Props {
  sessions: SessionInfo[];
  runningIds: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  attention: SessionAttention[];
  pauses?: SessionPauseSnapshot[];
  reviewIds: ReadonlySet<string>;
  laterIds: ReadonlySet<string>;
  laterAttentionIds: ReadonlySet<string>;
  available: boolean;
  selectedId: string | null;
  onSelect: (session: SessionInfo, status?: ActivityStatus) => void;
  onMarkRead: (id: string) => void;
  onMarkLater: (id: string, requestId?: string) => void;
  onClose: () => void;
  hidden?: boolean;
  recoveryRefreshKey?: number;
  privacy: ProjectPrivacy;
}

const STATUS_ORDER: ActivityStatus[] = ["needs-you", "working", "pausing", "paused", "queued", "interrupted", "ready", "later"];
const NO_PAUSES: SessionPauseSnapshot[] = [];

export function ActivityOverview({ sessions, runningIds, queuedIds, attention, pauses = NO_PAUSES, reviewIds, laterIds, laterAttentionIds, available, selectedId, onSelect, onMarkRead, onMarkLater, onClose, hidden = false, recoveryRefreshKey = 0, privacy }: Props) {
  const { t, locale } = useI18n();
  const [projectFilter, setProjectFilter] = useState("");
  const [pausePending, setPausePending] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const sessionById = useMemo(() => new Map(sessions.map((row) => [row.id, row])), [sessions]);
  const [controlError, setControlError] = useState("");
  const pauseById = useMemo(() => new Map(pauses.map((row) => [row.sessionId, row])), [pauses]);
  const control = async (action: "pause" | "resume" | "pause-all" | "resume-all", item?: ActivityItem) => {
    const pausing = action === "pause" || action === "pause-all";
    if (pausing ? pausePending : resumePending) return;
    const setPending = pausing ? setPausePending : setResumePending;
    setPending(true); setControlError("");
    try {
      const response = await fetch("/api/activity/pause", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(item ? { sessionId: item.session.id, pauseId: item.pause?.id } : {}) }) });
      const result = await response.json() as { error?: string; errors?: string[] };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      if (result.errors?.length) setControlError(t("activity.pausePartial", { count: result.errors.length }));
    } catch (error) { setControlError(`${t("activity.pauseFailed")} ${String(error)}`); }
    finally { setPending(false); window.dispatchEvent(new Event("pi-web:activity-refresh")); }
  };
  const [showHidden, setShowHidden] = useState(false);
  // Restore after hydration; server rendering always starts concealed.
  useEffect(() => { setShowHidden(getShowHiddenProjects()); }, []);
  const revealing = showHidden && !hidden && privacy.keys !== null;
  const privacyReady = privacy.keys !== null;
  const hiddenIds = useMemo(() => hiddenActivitySessionIds(sessions, privacy.keys ?? new Set()), [sessions, privacy.keys]);
  const filterConcealed = Boolean(privacy.keys?.has(projectFilter)) || (sessions.some((item) => workspaceKeyOf(item) === projectFilter)
    && !sessions.some((item) => workspaceKeyOf(item) === projectFilter && !hiddenIds.has(item.id)));
  const effectiveProjectFilter = privacyReady && (revealing || !filterConcealed) ? projectFilter : "";
  useEffect(() => {
    if (privacyReady && !showHidden && filterConcealed) setProjectFilter("");
  }, [showHidden, filterConcealed, privacyReady]);
  const [interruptedIds, setInterruptedIds] = useState<Set<string>>(() => new Set());
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  const [recoveryLoading, setRecoveryLoading] = useState(true);

  // Do not add journal scans to the sidebar's frequent running-state poll.
  // Only an open, visible Activity panel needs this read-only snapshot.
  useEffect(() => {
    if (hidden) return;
    let controller: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void fetch("/api/sessions/interrupted", { cache: "no-store", signal: request.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<{ interruptedSessionIds: string[] }>;
        })
        .then(({ interruptedSessionIds }) => {
          if (!request.signal.aborted) {
            setInterruptedIds(new Set(interruptedSessionIds));
            setRecoveryAvailable(true);
            setRecoveryLoading(false);
          }
        })
        .catch(() => {
          if (!request.signal.aborted) {
            setInterruptedIds(new Set());
            setRecoveryAvailable(false);
            setRecoveryLoading(false);
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [hidden, recoveryRefreshKey]);

  const concealed = useMemo(() => getActivitySections(privacyReady ? sessions : [], runningIds, attention, reviewIds, null, queuedIds, interruptedIds, privacy.keys ?? new Set(), laterIds, laterAttentionIds, pauseById),
    [privacyReady, privacy.keys, sessions, runningIds, queuedIds, attention, reviewIds, interruptedIds, laterIds, laterAttentionIds, pauseById]);
  const all = useMemo(() => revealing
    ? getActivitySections(sessions, runningIds, attention, reviewIds, null, queuedIds, interruptedIds, new Set(), laterIds, laterAttentionIds, pauseById) : concealed,
    [revealing, sessions, runningIds, queuedIds, attention, reviewIds, interruptedIds, laterIds, laterAttentionIds, pauseById, concealed]);
  const projects = useMemo(() => {
    const keys = new Map<string, string>();
    for (const item of Object.values(all).flat()) keys.set(item.projectKey, activityProjectName(item.session));
    // Keep an emptied selection visible, rather than showing "All projects"
    // while silently retaining a filter with no matches.
    if (effectiveProjectFilter && !keys.has(effectiveProjectFilter)) {
      const session = sessions.find((item) => workspaceKeyOf(item) === effectiveProjectFilter);
      keys.set(effectiveProjectFilter, session ? activityProjectName(session) : effectiveProjectFilter);
    }
    return [...keys].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, effectiveProjectFilter, sessions]);
  const sections = useMemo(() => effectiveProjectFilter
    ? getActivitySections(privacyReady ? sessions : [], runningIds, attention, reviewIds, effectiveProjectFilter, queuedIds, interruptedIds, revealing ? new Set() : privacy.keys ?? new Set(), laterIds, laterAttentionIds, pauseById) : all,
  [effectiveProjectFilter, privacyReady, sessions, runningIds, attention, reviewIds, queuedIds, interruptedIds, laterIds, laterAttentionIds, pauseById, revealing, privacy.keys, all]);
  const readySubagents = sections.ready.filter((item) => item.session.relation?.kind === "subagent");
  const total = Object.values(sections).reduce((count, items) => count + items.length, 0);
  const sectionTitle: Record<ActivityStatus, string> = {
    "needs-you": t("activity.needsYou"), working: t("activity.working"), queued: t("activity.queued"),
    interrupted: t("activity.interrupted"), ready: t("activity.ready"), later: t("activity.later"),
    pausing: t("activity.pausing"), paused: t("activity.paused"),
  };
  const methodLabel = (item: ActivityItem): string => {
    switch (item.attention?.method) {
      case "ask_user": return t("activity.question");
      case "confirm": return t("activity.approval");
      case "custom": return t("activity.customRequest");
      default: return t("activity.inputRequested");
    }
  };
  return (
    <section aria-label={t("activity.title")} className="activity-overview" style={{ display: hidden ? "none" : undefined }}>
      <div className="activity-header">
        <div>
          <h1>{t("activity.title")}</h1>
          <small>{t("activity.scope")}</small>
        </div>
        <button type="button" className="activity-close" onClick={onClose} aria-label={t("activity.close")} title={t("activity.close")}>×</button>
      </div>
      <div className="activity-filter">
        <label htmlFor="activity-project">{t("activity.project")}</label>
        <select id="activity-project" disabled={!privacyReady} value={effectiveProjectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">{t("activity.allProjects")}</option>
          {projects.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <button type="button" className="activity-privacy-toggle" disabled={!privacyReady} aria-pressed={revealing}
          aria-label={t(revealing ? "privacy.conceal" : "privacy.reveal")} title={t(revealing ? "privacy.conceal" : "privacy.reveal")}
          onClick={() => {
            if (revealing && filterConcealed) setProjectFilter("");
            setShowHidden(!revealing);
            saveShowHiddenProjects(!revealing);
          }}>
          <PrivacyEyeIcon concealed={!revealing} />
        </button>
      </div>
      <div className="activity-pause-controls">
        <button type="button" className="activity-mark-read" disabled={!available || pausePending || runningIds.size + queuedIds.size === 0 && !pauses.some((row) => row.state === "resuming")}
          onClick={() => void control("pause-all")}>{t("activity.pauseAll")}</button>
        <button type="button" className="activity-mark-read" disabled={!available || pausePending || resumePending || !pauses.some((row) => !row.parentSessionId && (row.state === "paused" || row.interrupted))}
          onClick={() => void control("resume-all")}>{t("activity.resumeAll")}</button>
        <small>{t("activity.pauseAllScope")}</small>
      </div>
      {controlError && <p role="alert" className="activity-unavailable">{controlError}</p>}
      {privacy.error && <p role="alert" className="activity-unavailable">{t("privacy.unavailable")} <button type="button" onClick={privacy.refresh}>{t("privacy.retry")}</button></p>}
      {!privacyReady && !privacy.error && <p role="status" className="activity-unavailable">{t("privacy.loading")}</p>}
      {!available && <p role="status" className="activity-unavailable">{t("activity.unavailable")}</p>}
      {!recoveryAvailable && <p role="status" className="activity-unavailable">{t("activity.recoveryUnavailable")}</p>}
      {privacyReady && total === 0 && !recoveryLoading && available && recoveryAvailable && <p className="activity-empty">{t("activity.empty")}</p>}
      <div className="activity-sections">
        {STATUS_ORDER.map((status) => sections[status].length > 0 && (
          <section key={status} aria-label={sectionTitle[status]} className="activity-section">
            <div className="activity-section-header">
              <h2>{sectionTitle[status]} <span>{sections[status].length}</span></h2>
              {status === "ready" && <button type="button" className="activity-mark-read activity-mark-all-subagents-read"
                disabled={readySubagents.length === 0}
                title={t("activity.markAllSubagentsReadHint")}
                onClick={() => readySubagents.forEach((item) => onMarkRead(item.session.id))}>
                {t("activity.markAllSubagentsRead")}
              </button>}
            </div>
            <div role="list" className="activity-items">
              {sections[status].map((item) => {
                const { session } = item;
                const label = activitySessionName(session);
                let mainSession = session;
                const visited = new Set<string>();
                while (mainSession.relation?.kind === "subagent" && !visited.has(mainSession.id)) {
                  visited.add(mainSession.id);
                  const parent = sessionById.get(mainSession.relation.parentSessionId);
                  if (!parent) break;
                  mainSession = parent;
                }
                const action = item.attention ? t("activity.openAndAnswer")
                  : status === "ready" || status === "later" ? t("activity.review") : t("activity.open");
                return (
                  <div role="listitem" key={session.id} className="activity-review-item">
                    <button
                      type="button"
                      className={`activity-item activity-item-${status}${item.nested ? " activity-nested" : ""}${selectedId === session.id ? " activity-selected" : ""}${status === "later" && item.attention ? " activity-deferred-attention" : ""}`}
                      onClick={() => onSelect(session, item.attention ? "needs-you" : status)}
                      aria-label={`${label} · ${activityProjectName(session)}${session.isWorktree && session.branch ? ` · ${session.branch}` : ""}${item.parentName ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}${session.relation?.kind === "subagent" ? ` · ${t("activity.subagent")}` : ""} · ${sectionTitle[status]}${item.attention ? ` · ${status === "later" ? `${t("activity.needsYou")} · ` : ""}${methodLabel(item)}${item.attention?.summary ? ` · ${item.attention.summary}` : ""}` : ""} · ${action}`}
                    >
                      <span className="activity-item-top">
                        <span className="activity-dot" aria-hidden="true" />
                        {session.relation?.kind === "subagent" && (
                          <span className="activity-subagent-icon" title={t("activity.subagent")}><SubagentIcon /></span>
                        )}
                        {revealing && hiddenIds.has(session.id) && <span className="activity-private-marker" title={t("privacy.hiddenProject")} aria-label={t("privacy.hiddenProject")}><PrivacyEyeIcon concealed /></span>}
                        <span className="activity-item-title" title={label}>{label}</span>
                      </span>
                      <span className="activity-item-meta" title={session.projectRoot ?? session.cwd}>
                        {activityProjectName(session)}
                        {item.parentName && !item.nested ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}
                      </span>
                      <SessionWorktreeBadge session={session} className="activity-item-meta" />
                      {item.attention && <span className="activity-item-reason">
                        {methodLabel(item)}{item.attention?.summary ? ` · ${item.attention.summary}` : ""}
                        {item.attention?.since ? ` · ${new Date(item.attention.since).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}` : ""}
                      </span>}
                      {status === "interrupted" && <span className="activity-item-reason">{t("activity.interruptedHint")}</span>}
                      {status === "pausing" && <span className="activity-item-reason">{t("activity.pausingHint")}</span>}
                      {item.pause?.error && <span role="alert" className="activity-item-reason">{t("activity.pauseError", { error: item.pause.error })}</span>}
                      {status === "paused" && <span className="activity-item-reason">{t(item.pause?.interrupted ? "activity.pauseInterruptedHint" : session.relation?.kind === "subagent" ? "activity.pausedChildHint" : "activity.pausedHint")}</span>}
                    </button>
                    <div className="activity-item-actions">
                      {(status === "working" || status === "queued" || status === "needs-you" || status === "later" && item.attention) && (!item.pause || item.pause.state === "resuming") && <button type="button" className="activity-mark-read"
                        disabled={!available || pausePending} aria-label={t("activity.pauseSession", { name: label })}
                        onClick={() => void control("pause", item)}>{t("activity.pause")}</button>}
                      {status === "pausing" && <button type="button" className="activity-mark-read" disabled>{t("activity.pausing")}</button>}
                      {status === "pausing" && item.pause?.error && session.relation?.kind !== "subagent" && <button type="button" className="activity-mark-read"
                        disabled={!available || pausePending} onClick={() => void control("pause", item)}>{t("activity.retryPause")}</button>}
                      {status === "paused" && item.pause && session.relation?.kind !== "subagent" && !item.pause.parentSessionId && <button type="button" className="activity-mark-read"
                        disabled={!available || pausePending || resumePending} aria-label={t("activity.resumeSession", { name: label })}
                        onClick={() => void control("resume", item)}>{t("activity.resume")}</button>}
                      {status === "paused" && mainSession.id !== session.id && <button type="button" className="activity-mark-read"
                        onClick={() => onSelect(mainSession)}>{t("activity.openMainSession")}</button>}
                      {(status === "ready" || status === "needs-you") && <button type="button" className="activity-mark-read"
                        aria-label={t("activity.markLaterSession", { name: label })}
                        onClick={() => onMarkLater(session.id, item.attention?.requestId)}>{t("activity.later")}</button>}
                      {(status === "ready" || status === "later" && !item.attention) && <button type="button" className="activity-mark-read"
                        aria-label={t("activity.markReadSession", { name: label })}
                        onClick={() => onMarkRead(session.id)}>{t("activity.markRead")}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
