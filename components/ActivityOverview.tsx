"use client";

import { useMemo, useState } from "react";
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
  onSelect: (session: SessionInfo) => void;
  onClose: () => void;
  hidden?: boolean;
}

const STATUS_ORDER: ActivityStatus[] = ["needs-you", "working", "queued", "ready"];

export function ActivityOverview({ sessions, runningIds, queuedIds, attention, reviewIds, available, selectedId, onSelect, onClose, hidden = false }: Props) {
  const { t, locale } = useI18n();
  const [projectFilter, setProjectFilter] = useState("");
  const all = useMemo(() => getActivitySections(sessions, runningIds, attention, reviewIds, null, queuedIds),
    [sessions, runningIds, queuedIds, attention, reviewIds]);
  const projects = useMemo(() => {
    const keys = new Map<string, string>();
    for (const item of Object.values(all).flat()) keys.set(item.projectKey, activityProjectName(item.session));
    // Keep an emptied selection visible, rather than showing "All projects"
    // while silently retaining a filter with no matches.
    if (projectFilter && !keys.has(projectFilter)) {
      const session = sessions.find((item) => workspaceKeyOf(item) === projectFilter);
      keys.set(projectFilter, session ? activityProjectName(session) : projectFilter);
    }
    return [...keys].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, projectFilter, sessions]);
  const sections = useMemo(() => projectFilter
    ? getActivitySections(sessions, runningIds, attention, reviewIds, projectFilter, queuedIds) : all,
  [projectFilter, sessions, runningIds, queuedIds, attention, reviewIds, all]);
  const total = Object.values(sections).reduce((count, items) => count + items.length, 0);
  const sectionTitle: Record<ActivityStatus, string> = {
    "needs-you": t("activity.needsYou"), working: t("activity.working"), queued: t("activity.queued"), ready: t("activity.ready"),
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
      {total === 0 && <p className="activity-empty">{t("activity.empty")}</p>}
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
                  <div role="listitem" key={session.id}>
                    <button
                      type="button"
                      className={`activity-item activity-item-${status}${item.nested ? " activity-nested" : ""}${selectedId === session.id ? " activity-selected" : ""}`}
                      onClick={() => onSelect(session)}
                      aria-label={`${label} · ${activityProjectName(session)}${item.parentName ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""} · ${sectionTitle[status]}${status === "needs-you" ? ` · ${methodLabel(item)}${item.attention?.summary ? ` · ${item.attention.summary}` : ""}` : ""} · ${action}`}
                    >
                      <span className="activity-item-top">
                        <span className="activity-dot" aria-hidden="true" />
                        <span className="activity-item-title" title={label}>{label}</span>
                        <span className="activity-item-action">{action}</span>
                      </span>
                      <span className="activity-item-meta" title={session.projectRoot ?? session.cwd}>
                        {activityProjectName(session)}
                        {item.parentName && !item.nested ? ` · ${t("activity.childOf", { name: item.parentName })}` : ""}
                        {item.nested ? ` · ${t("activity.subagent")}` : ""}
                      </span>
                      {status === "needs-you" && <span className="activity-item-reason">
                        {methodLabel(item)}{item.attention?.summary ? ` · ${item.attention.summary}` : ""}
                        {item.attention?.since ? ` · ${new Date(item.attention.since).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}` : ""}
                      </span>}
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
