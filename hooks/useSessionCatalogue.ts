"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityClientController } from "@/lib/activity-client-controller";
import { SessionCatalogueLoader, sessionListUrl, type CatalogueReply } from "@/lib/session-catalogue-loader";
import { useNavigationWork } from "@/lib/navigation-work";
import type { SessionInfo } from "@/lib/types";

/** The Sidebar's single catalogue lifecycle, separate from Activity receipt authority. */
export function useSessionCatalogue(activityController: ActivityClientController, refreshKey?: number) {
  const work = useNavigationWork();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestReply = useRef<CatalogueReply | undefined>(undefined);
  const current = useRef({ activityController, work });
  current.current = { activityController, work };
  const [loader] = useState(() => new SessionCatalogueLoader({
    async read(mode) {
      const response = await fetch(sessionListUrl(mode === "summary", mode === "force"), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as CatalogueReply;
    },
    publish(data) {
      latestReply.current = data;
      setSessions(data.sessions);
      current.current.activityController.setSessions(data.sessions, data);
    },
    loading: setLoading, error: setError,
    schedule: (callback, ms) => setTimeout(callback, ms),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    observe: promise => { current.current.work.observe(promise); },
  }));
  useEffect(() => loader.retain(), [loader]);
  useEffect(() => activityController.observeCatalogue(version => loader.observeVersion(version)), [activityController, loader]);
  useEffect(() => {
    if (latestReply.current) activityController.setSessions(latestReply.current.sessions, latestReply.current);
  }, [activityController]);
  const previousRefresh = useRef(refreshKey);
  useEffect(() => {
    if (previousRefresh.current === refreshKey) return;
    previousRefresh.current = refreshKey;
    void loader.refresh(true);
  }, [loader, refreshKey]);
  const loadSessions = useCallback((showLoading = false, force = false) =>
    work.observe(loader.refresh(force, showLoading)), [loader, work]);
  const refreshActivityCatalogue = useCallback(() => work.observe(loader.notify()), [loader, work]);
  const invalidate = useCallback(() => loader.invalidate(), [loader]);
  return { sessions, setSessions, loading, error, loadSessions, refreshActivityCatalogue, invalidate };
}
