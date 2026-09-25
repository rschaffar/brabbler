"use client";

import { useEffect, useMemo, useState } from "react";
import { useStarredSessions } from "@/hooks/useStarredSessions";
import { useI18n } from "@/hooks/useI18n";
import { activityProjectName, activitySessionName, getActivitySections, type ActivityItem, type ActivityStatus } from "@/lib/activity";
import type { SessionAttention, SessionInfo } from "@/lib/types";
import { workspaceKeyOf } from "@/lib/workspace-memory";

interface Props {
  sessions: SessionInfo[];
  runningIds: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  attention: SessionAttention[];
  reviewIds: ReadonlySet<string>;
  available: boolean;
  selectedId: string | null;
  onSelect: (session: SessionInfo, status?: ActivityStatus) => void;
  onClose: () => void;
  hidden?: boolean;
  recoveryRefreshKey?: number;
}

const STATUS_ORDER: ActivityStatus[] = ["needs-you", "working", "queued", "interrupted", "ready"];

export function ActivityOverview({ sessions, runningIds, queuedIds, attention, reviewIds, available, selectedId, onSelect, onClose, hidden = false, recoveryRefreshKey = 0 }: Props) {
  const { t, locale } = useI18n();
  const { starredIds, toggleStarred } = useStarredSessions();
  const [projectFilter, setProjectFilter] = useState("");
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

  const all = useMemo(() => getActivitySections(sessions, runningIds, attention, reviewIds, null, queuedIds, interruptedIds),
    [sessions, runningIds, queuedIds, attention, reviewIds, interruptedIds]);
  const projects = useMemo(() => {
    const keys = new Map<string, string>();
    for (const item of Object.values(all).flat()) keys.set(item.projectKey, activityProjectName(item.session));
    for (const session of sessions) {
      if (starredIds.has(session.id)) keys.set(workspaceKeyOf(session), activityProjectName(session));
    }
    // Keep an emptied selection visible, rather than showing "All projects"
    // while silently retaining a filter with no matches.
    if (projectFilter && !keys.has(projectFilter)) {
      const session = sessions.find((item) => workspaceKeyOf(item) === projectFilter);
      keys.set(projectFilter, session ? activityProjectName(session) : projectFilter);
    }
    return [...keys].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, projectFilter, sessions, starredIds]);
  const starredSessions = useMemo(() => sessions
    .filter((session) => starredIds.has(session.id) && (!projectFilter || workspaceKeyOf(session) === projectFilter))
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)), [sessions, starredIds, projectFilter]);
  const sections = useMemo(() => projectFilter
    ? getActivitySections(sessions, runningIds, attention, reviewIds, projectFilter, queuedIds, interruptedIds) : all,
  [projectFilter, sessions, runningIds, queuedIds, attention, reviewIds, interruptedIds, all]);
  const total = starredSessions.length + Object.values(sections).reduce((count, items) => count + items.length, 0);
  const sectionTitle: Record<ActivityStatus, string> = {
    "needs-you": t("activity.needsYou"), working: t("activity.working"), queued: t("activity.queued"),
    interrupted: t("activity.interrupted"), ready: t("activity.ready"),
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
        <select id="activity-project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">{t("activity.allProjects")}</option>
          {projects.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </div>
      {!available && <p role="status" className="activity-unavailable">{t("activity.unavailable")}</p>}
      {!recoveryAvailable && <p role="status" className="activity-unavailable">{t("activity.recoveryUnavailable")}</p>}
      {total === 0 && !recoveryLoading && available && recoveryAvailable && <p className="activity-empty">{t("activity.empty")}</p>}
      <div className="activity-sections">
        {starredSessions.length > 0 && (
          <section aria-label={t("activity.starred")} className="activity-section">
            <h2>{t("activity.starred")} <span>{starredSessions.length}</span></h2>
            <div role="list" className="activity-items">
              {starredSessions.map((session) => {
                const label = activitySessionName(session);
                return <div role="listitem" key={session.id} className="activity-starred-item">
                  <button type="button" className={`activity-item${selectedId === session.id ? " activity-selected" : ""}`} onClick={() => onSelect(session)} aria-label={`${label} · ${activityProjectName(session)} · ${t("activity.open")}`}>
                    <span className="activity-item-top">
                      <span className="activity-star" aria-hidden="true">★</span>
                      <span className="activity-item-title" title={label}>{label}</span>
                      <span className="activity-item-action">{t("activity.open")}</span>
                    </span>
                    <span className="activity-item-meta" title={session.projectRoot ?? session.cwd}>{activityProjectName(session)}</span>
                  </button>
                  <button type="button" className="activity-unstar" onClick={() => toggleStarred(session.id)} aria-label={t("sidebar.unstarSession")} title={t("sidebar.unstarSession")}>×</button>
                </div>;
              })}
            </div>
          </section>
        )}
        {STATUS_ORDER.map((status) => sections[status].length > 0 && (
          <section key={status} aria-label={sectionTitle[status]} className="activity-section">
            <h2>{sectionTitle[status]} <span>{sections[status].length}</span></h2>
            <div role="list" className="activity-items">
              {sections[status].map((item) => {
                const { session } = item;
                const label = activitySessionName(session);
                const action = status === "needs-you" ? t("activity.openAndAnswer")
                  : status === "ready" ? t("activity.review") : t("activity.open");
                return (
                  <div role="listitem" key={session.id}>
                    <button
                      type="button"
                      className={`activity-item activity-item-${status}${item.nested ? " activity-nested" : ""}${selectedId === session.id ? " activity-selected" : ""}`}
                      onClick={() => onSelect(session, status)}
                      aria-label={`${label} · ${activityProjectName(session)}${item.parentName ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}${session.relation?.kind === "subagent" ? ` · ${t("activity.subagent")}` : ""} · ${sectionTitle[status]}${status === "needs-you" ? ` · ${methodLabel(item)}${item.attention?.summary ? ` · ${item.attention.summary}` : ""}` : ""} · ${action}`}
                    >
                      <span className="activity-item-top">
                        <span className="activity-dot" aria-hidden="true" />
                        <span className="activity-item-title" title={label}>{label}</span>
                        <span className="activity-item-action">{action}</span>
                      </span>
                      <span className="activity-item-meta" title={session.projectRoot ?? session.cwd}>
                        {session.relation?.kind === "subagent" ? `${t("activity.subagent")} · ` : ""}
                        {activityProjectName(session)}
                        {item.parentName && !item.nested ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}
                      </span>
                      {status === "needs-you" && <span className="activity-item-reason">
                        {methodLabel(item)}{item.attention?.summary ? ` · ${item.attention.summary}` : ""}
                        {item.attention?.since ? ` · ${new Date(item.attention.since).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}` : ""}
                      </span>}
                      {status === "interrupted" && <span className="activity-item-reason">{t("activity.interruptedHint")}</span>}
                    </button>
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
