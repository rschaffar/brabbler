"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { activityProjectName, activitySessionName, getActivitySections, hiddenActivitySessionIds, type ActivityItem, type ActivityStatus } from "@/lib/activity";
import type { SessionAttention, SessionInfo } from "@/lib/types";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { SubagentIcon } from "./SubagentIcon";
import { PrivacyEyeIcon } from "./PrivacyEyeIcon";
import type { ProjectPrivacy } from "@/hooks/useHiddenProjects";

interface Props {
  sessions: SessionInfo[];
  runningIds: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  attention: SessionAttention[];
  reviewIds: ReadonlySet<string>;
  available: boolean;
  selectedId: string | null;
  onSelect: (session: SessionInfo, status?: ActivityStatus) => void;
  onMarkRead: (id: string) => void;
  onClose: () => void;
  hidden?: boolean;
  recoveryRefreshKey?: number;
  privacy: ProjectPrivacy;
}

const STATUS_ORDER: ActivityStatus[] = ["needs-you", "working", "queued", "interrupted", "ready"];

export function ActivityOverview({ sessions, runningIds, queuedIds, attention, reviewIds, available, selectedId, onSelect, onMarkRead, onClose, hidden = false, recoveryRefreshKey = 0, privacy }: Props) {
  const { t, locale } = useI18n();
  const [projectFilter, setProjectFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const revealing = showHidden && !hidden && privacy.keys !== null;
  const privacyReady = privacy.keys !== null;
  const hiddenIds = useMemo(() => hiddenActivitySessionIds(sessions, privacy.keys ?? new Set()), [sessions, privacy.keys]);
  const filterConcealed = Boolean(privacy.keys?.has(projectFilter)) || (sessions.some((item) => workspaceKeyOf(item) === projectFilter)
    && !sessions.some((item) => workspaceKeyOf(item) === projectFilter && !hiddenIds.has(item.id)));
  const effectiveProjectFilter = privacyReady && (revealing || !filterConcealed) ? projectFilter : "";
  useEffect(() => {
    if (hidden || !privacyReady) setShowHidden(false);
    if (!revealing && filterConcealed) setProjectFilter("");
  }, [hidden, revealing, filterConcealed, privacyReady]);
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

  const concealed = useMemo(() => getActivitySections(privacyReady ? sessions : [], runningIds, attention, reviewIds, null, queuedIds, interruptedIds, privacy.keys ?? new Set()),
    [privacyReady, privacy.keys, sessions, runningIds, queuedIds, attention, reviewIds, interruptedIds]);
  const all = useMemo(() => revealing
    ? getActivitySections(sessions, runningIds, attention, reviewIds, null, queuedIds, interruptedIds) : concealed,
    [revealing, sessions, runningIds, queuedIds, attention, reviewIds, interruptedIds, concealed]);
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
    ? getActivitySections(privacyReady ? sessions : [], runningIds, attention, reviewIds, effectiveProjectFilter, queuedIds, interruptedIds, revealing ? new Set() : privacy.keys ?? new Set()) : all,
  [effectiveProjectFilter, privacyReady, sessions, runningIds, attention, reviewIds, queuedIds, interruptedIds, revealing, privacy.keys, all]);
  const total = Object.values(sections).reduce((count, items) => count + items.length, 0);
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
        <select id="activity-project" disabled={!privacyReady} value={effectiveProjectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">{t("activity.allProjects")}</option>
          {projects.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <button type="button" className="activity-privacy-toggle" disabled={!privacyReady} aria-pressed={revealing}
          aria-label={t(revealing ? "privacy.conceal" : "privacy.reveal")} title={t(revealing ? "privacy.conceal" : "privacy.reveal")}
          onClick={() => {
            if (revealing && filterConcealed) setProjectFilter("");
            setShowHidden(!revealing);
          }}>
          <PrivacyEyeIcon concealed={!revealing} />
        </button>
      </div>
      {privacy.error && <p role="alert" className="activity-unavailable">{t("privacy.unavailable")} <button type="button" onClick={privacy.refresh}>{t("privacy.retry")}</button></p>}
      {!privacyReady && !privacy.error && <p role="status" className="activity-unavailable">{t("privacy.loading")}</p>}
      {!available && <p role="status" className="activity-unavailable">{t("activity.unavailable")}</p>}
      {!recoveryAvailable && <p role="status" className="activity-unavailable">{t("activity.recoveryUnavailable")}</p>}
      {privacyReady && total === 0 && !recoveryLoading && available && recoveryAvailable && <p className="activity-empty">{t("activity.empty")}</p>}
      <div className="activity-sections">
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
                  <div role="listitem" key={session.id} className={status === "ready" ? "activity-review-item" : undefined}>
                    <button
                      type="button"
                      className={`activity-item activity-item-${status}${item.nested ? " activity-nested" : ""}${selectedId === session.id ? " activity-selected" : ""}`}
                      onClick={() => onSelect(session, status)}
                      aria-label={`${label} · ${activityProjectName(session)}${item.parentName ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}${session.relation?.kind === "subagent" ? ` · ${t("activity.subagent")}` : ""} · ${sectionTitle[status]}${status === "needs-you" ? ` · ${methodLabel(item)}${item.attention?.summary ? ` · ${item.attention.summary}` : ""}` : ""} · ${action}`}
                    >
                      <span className="activity-item-top">
                        <span className="activity-dot" aria-hidden="true" />
                        {session.relation?.kind === "subagent" && (
                          <span className="activity-subagent-icon" title={t("activity.subagent")}><SubagentIcon /></span>
                        )}
                        {revealing && hiddenIds.has(session.id) && <span className="activity-private-marker" title={t("privacy.hiddenProject")} aria-label={t("privacy.hiddenProject")}><PrivacyEyeIcon concealed /></span>}
                        <span className="activity-item-title" title={label}>{label}</span>
                        <span className="activity-item-action">{action}</span>
                      </span>
                      <span className="activity-item-meta" title={session.projectRoot ?? session.cwd}>
                        {activityProjectName(session)}
                        {item.parentName && !item.nested ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}
                      </span>
                      {status === "needs-you" && <span className="activity-item-reason">
                        {methodLabel(item)}{item.attention?.summary ? ` · ${item.attention.summary}` : ""}
                        {item.attention?.since ? ` · ${new Date(item.attention.since).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}` : ""}
                      </span>}
                      {status === "interrupted" && <span className="activity-item-reason">{t("activity.interruptedHint")}</span>}
                    </button>
                    {status === "ready" && <button type="button" className="activity-mark-read"
                      aria-label={t("activity.markReadSession", { name: label })}
                      onClick={() => onMarkRead(session.id)}>{t("activity.markRead")}</button>}
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
