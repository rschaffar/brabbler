"use client";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { NavigationUi } from "./useSessionNavigation";
import { useNavigationWork } from "@/lib/navigation-work";
export type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function useSessionAutoName({ selectedSession, setSelectedSession, setSessionStats, setRefreshKey, setActiveTopPanel }: {
  selectedSession: SessionInfo | null;
  setSelectedSession: Dispatch<SetStateAction<SessionInfo | null>>;
  setSessionStats: Dispatch<SetStateAction<SessionStatsInfo | null>>;
  setRefreshKey: Dispatch<SetStateAction<number>>;
  setActiveTopPanel: NavigationUi["setActiveTopPanel"];
}) {
  const work = useNavigationWork();
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  useEffect(() => () => { if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current); }, []);
  const handleAutoName = useCallback(() => work.observe((async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  })()), [autoNameStatus.kind, selectedSession?.id, setActiveTopPanel, setRefreshKey, setSelectedSession, setSessionStats, work]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  return { autoNameStatus, handleAutoName };
}
