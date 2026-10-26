"use client";

import { useNavigationWork } from "@/lib/navigation-work";
import { useCallback, useEffect, useRef, useState } from "react";
import { validHiddenProjectsData } from "@/lib/hidden-projects";

export interface ProjectPrivacy {
  keys: ReadonlySet<string> | null;
  error: boolean;
  pendingKey: string | null;
  refresh: () => void;
  setHidden: (key: string, hidden: boolean) => void;
}

async function request(body?: { key: string; hidden: boolean }): Promise<Set<string>> {
  const response = await fetch("/api/hidden-projects", body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  if (!response.ok) throw new Error("Project privacy settings unavailable");
  const data: unknown = await response.json();
  if (!validHiddenProjectsData(data)) throw new Error("Invalid project privacy response");
  return new Set(data.keys);
}

/** One AppShell owner shares state between Settings and Activity; reveal is never stored here. */
export function useHiddenProjects(): ProjectPrivacy {
  const work = useNavigationWork();
  const [state, setState] = useState<{ keys: Set<string> | null; error: boolean; pendingKey: string | null }>({ keys: null, error: false, pendingKey: null });
  const generation = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(false);
  const reload = useCallback((background = false) => work.observe((async () => {
    if (busy.current) return;
    const token = ++generation.current;
    if (!background) setState((previous) => ({ ...previous, keys: null, error: false }));
    try {
      const keys = await request();
      if (mounted.current && generation.current === token) setState({ keys, error: false, pendingKey: null });
    } catch {
      if (mounted.current && generation.current === token) setState({ keys: null, error: true, pendingKey: null });
    }
  })()), [work]);
  const refresh = useCallback(() => { void reload(); }, [reload]);
  const setHidden = useCallback((key: string, hidden: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    // Conceal immediately, but never optimistically reveal a private project.
    setState((previous) => ({
      keys: hidden && previous.keys ? new Set([...previous.keys, key]) : previous.keys,
      error: false, pendingKey: key,
    }));
    work.observe(request({ key, hidden }).then((keys) => {
      if (mounted.current && generation.current === token) setState({ keys, error: false, pendingKey: null });
    }).catch(() => {
      if (mounted.current && generation.current === token) setState({ keys: null, error: true, pendingKey: null });
    }).finally(() => { busy.current = false; }));
  }, [work]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload(true);
    }, 15_000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(poll);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, reload]);
  return { ...state, refresh, setHidden };
}
