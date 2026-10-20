"use client";

import { useEffect, useState } from "react";
import type { SessionWorktreeInventory } from "@/lib/session-worktrees-types";

/** History inventory only: does not select/admit a working directory. */
export function useSessionWorktrees(project: string | null, refreshKey: string) {
  const [state, setState] = useState<{ key: string; inventory?: SessionWorktreeInventory; error?: string }>({ key: "" });
  const [refresh, setRefresh] = useState(0);
  const key = `${project ?? ""}:${refreshKey}:${refresh}`;
  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/worktrees?project=${encodeURIComponent(project)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) setState({ key, inventory: data });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, error: String(error) });
      }
    })();
    return () => controller.abort();
  }, [project, key]);
  return { inventory: state.key === key ? state.inventory : undefined, error: state.key === key ? state.error : undefined,
    loading: Boolean(project && state.key !== key), refresh: () => setRefresh(value => value + 1) };
}
