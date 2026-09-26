"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useStarredSessions } from "@/hooks/useStarredSessions";
import { activityProjectName, activitySessionName, liveSessionActivityStatus } from "@/lib/activity";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import type { SessionAttention, SessionInfo } from "@/lib/types";

interface Props {
  sessions: SessionInfo[];
  runningIds: ReadonlySet<string>;
  attention: readonly SessionAttention[];
  selectedId: string | null;
  onSelect: (session: SessionInfo) => void;
  onClose: () => void;
  hidden?: boolean;
}

export function StarredOverview({ sessions, runningIds, attention, selectedId, onSelect, onClose, hidden = false }: Props) {
  const { t } = useI18n();
  const { starredIds, toggleStarred } = useStarredSessions();
  const [projectFilter, setProjectFilter] = useState("");
  const attentionById = useMemo(() => new Map(attention.map((request) => [request.sessionId, request])), [attention]);
  const projects = useMemo(() => {
    const keys = new Map<string, string>();
    for (const session of sessions) {
      if (starredIds.has(session.id)) keys.set(workspaceKeyOf(session), activityProjectName(session));
    }
    // Keep an emptied selection visible when its last session is unstarred.
    if (projectFilter && !keys.has(projectFilter)) {
      const session = sessions.find((item) => workspaceKeyOf(item) === projectFilter);
      keys.set(projectFilter, session ? activityProjectName(session) : projectFilter);
    }
    return [...keys].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions, starredIds, projectFilter]);
  const starredSessions = useMemo(() => sessions
    .filter((session) => starredIds.has(session.id) && (!projectFilter || workspaceKeyOf(session) === projectFilter))
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)), [sessions, starredIds, projectFilter]);

  return (
    <section aria-label={t("activity.starred")} className="activity-overview" style={{ display: hidden ? "none" : undefined }}>
      <div className="activity-header">
        <div>
          <h1>{t("activity.starred")}</h1>
          <small>{t("activity.scope")}</small>
        </div>
        <button type="button" className="activity-close" onClick={onClose} aria-label={t("starred.close")} title={t("starred.close")}>×</button>
      </div>
      <div className="activity-filter">
        <label htmlFor="starred-project">{t("activity.project")}</label>
        <select id="starred-project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">{t("activity.allProjects")}</option>
          {projects.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </div>
      {starredSessions.length === 0 && <p className="activity-empty">{t("starred.empty")}</p>}
      <div className="activity-sections">
        {starredSessions.length > 0 && (
          <div className="activity-section">
            <h2>{t("activity.starred")} <span>{starredSessions.length}</span></h2>
            <div role="list" className="activity-items">
              {starredSessions.map((session) => {
                const label = activitySessionName(session);
                const status = liveSessionActivityStatus(session.id, runningIds, attentionById);
                const statusLabel = status === "needs-you" ? t("activity.needsYou") : status === "working" ? t("activity.working") : null;
                return <div role="listitem" key={session.id} className="activity-starred-item">
                  <button type="button" className={`activity-item${selectedId === session.id ? " activity-selected" : ""}`} onClick={() => onSelect(session)} aria-label={`${label} · ${activityProjectName(session)}${statusLabel ? ` · ${statusLabel}` : ""} · ${t("activity.open")}`}>
                    <span className="activity-item-top">
                      <span className="activity-star" aria-hidden="true">★</span>
                      <span className="activity-item-title" title={label}>{label}</span>
                      <span className="activity-item-action">{t("activity.open")}</span>
                    </span>
                    <span className="activity-item-meta" title={session.projectRoot ?? session.cwd}>{activityProjectName(session)}</span>
                    {status && <span className={`activity-starred-status activity-item-${status}`}>
                      <span className="activity-dot" aria-hidden="true" />{statusLabel}
                    </span>}
                  </button>
                  <button type="button" className="activity-unstar" onClick={() => toggleStarred(session.id)} aria-label={t("sidebar.unstarSession")} title={t("sidebar.unstarSession")}>×</button>
                </div>;
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
