"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse } from "@/lib/session-search";

export function SessionSearch({ open, query, projectKey, allProjects, status, children, selectedSessionId, onSelectSession }: {
  open: boolean;
  query: string;
  projectKey: string | null;
  allProjects: boolean;
  status: "active" | "archived" | "both";
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
}) {
  const { t, locale } = useI18n();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ key: string; response?: SessionSearchResponse; failed?: boolean }>({ key: "" });
  const search = query.trim();
  const params = new URLSearchParams({ q: search, status });
  if (allProjects) params.set("scope", "all");
  else if (projectKey) params.set("projectKey", projectKey);
  const searchKey = params.toString();
  const requestKey = `${searchKey}:${refresh}`;
  const canSearch = allProjects || Boolean(projectKey);
  const response = state.key === requestKey ? state.response : undefined;
  const failed = state.key === requestKey && state.failed;

  // Do not refetch on the session-list version: normal agent activity would
  // reorder results while they are being read. Scope changes and manual refresh
  // do cancel outstanding requests.
  useEffect(() => {
    if (!open || !search || !canSearch) return;
    const controller = new AbortController();
    setState({ key: requestKey });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/search?${searchKey}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as SessionSearchResponse;
        if (!controller.signal.aborted) setState({ key: requestKey, response: data });
      } catch {
        if (!controller.signal.aborted) setState({ key: requestKey, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, canSearch, searchKey, requestKey]);

  if (!open || !search) return children;
  const scopeLabel = `${allProjects ? t("sidebar.searchAllProjects") : t("sidebar.searchCurrentProject")} · ${status === "both" ? t("sidebar.searchBothStatuses") : status === "archived" ? t("sidebar.archivedSessions") : t("sidebar.activeSessions")}`;
  const kindLabels = { title: t("sidebar.searchMatchTitle"), preview: t("sidebar.searchMatchPreview"), id: t("sidebar.searchMatchId"), message: t("sidebar.searchMatchMessage") };
  return (
    <div className="min-h-20 flex-1 overflow-y-auto" aria-busy={canSearch && !response && !failed}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-text-muted">
        <span role="status">{!canSearch ? t("sidebar.searchSelectProject") : failed ? t("sidebar.sessionSearchFailed") : !response ? t("sidebar.sessionSearching")
          : response.results.length === 0 ? t(response.truncated ? "sidebar.sessionSearchIncompleteEmpty" : "sidebar.sessionSearchEmpty")
          : t("sidebar.sessionSearchCount", { count: response.results.length })}</span>
        {canSearch && <button type="button" onClick={() => setRefresh((value) => value + 1)} className="shrink-0 text-accent hover:underline">
          {t(failed ? "sidebar.searchRetry" : "sidebar.searchRefresh")}
        </button>}
      </div>
      <div className="px-3 pb-2 text-xs text-text-dim">{scopeLabel}</div>
      {response?.truncated && (
        <div role="status" className="px-3 pb-2 text-xs text-text-muted">{t("sidebar.sessionSearchPartial")}</div>
      )}
      {response?.results.map(({ session, kind, familyArchived, entryId, blockIndex, before, match, after }) => {
        const project = session.projectRoot || session.cwd;
        return <button
          key={session.id}
          type="button"
          onClick={() => onSelectSession(session, entryId, blockIndex)}
          aria-current={session.id === selectedSessionId ? "true" : undefined}
          className={`block w-full cursor-pointer border-b border-border px-3 py-2 text-left hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${session.id === selectedSessionId ? "bg-bg-selected" : ""}`}
        >
          <span className="flex items-center gap-2 text-xs font-medium text-text">
            <span className="min-w-0 truncate">{session.name || session.firstMessage}</span>
            {session.relation?.kind === "subagent" && <span className="shrink-0 text-[10px] text-text-dim">{t("sidebar.searchSubagent")}</span>}
            {familyArchived && <span className="shrink-0 text-[10px] font-normal text-text-dim">{t("sidebar.archivedSessions")}</span>}
          </span>
          <span className="mt-1 flex min-w-0 gap-2 text-[10px] text-text-dim">
            <span className={`min-w-0 flex-1 ${allProjects ? "break-all" : "truncate"}`} title={project}>{allProjects ? project : session.cwd}</span>
            <span className="shrink-0">{formatRelativeTime(session.modified, locale)}</span>
          </span>
          <span className="mt-1 block text-xs leading-relaxed wrap-anywhere text-text-muted">
            <span className="mr-1 text-text-dim">{kindLabels[kind]}: </span>
            {before}<mark className="rounded-sm bg-accent/20 text-text">{match}</mark>{after}
          </span>
        </button>;
      })}
    </div>
  );
}
