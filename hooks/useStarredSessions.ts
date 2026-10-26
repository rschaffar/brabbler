import { useCallback, useEffect, useState } from "react";
import { useNavigationWork } from "@/lib/navigation-work";
import { parseStarredSessionIds, STARRED_SESSIONS_STORAGE_KEY } from "@/lib/starred-sessions";

const URL = "/api/starred-sessions";
let ids = new Set<string>();
let projectKeys = new Set<string>();
let loaded = false;
let loading: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<(state: { ids: Set<string>; projectKeys: Set<string> }) => void>();
const pendingDesired = new Map<string, boolean>();
const pendingProjectDesired = new Map<string, boolean>();
let writes: Promise<void> = Promise.resolve();

function publish(next: { ids: string[]; projectKeys: string[] }) {
  ids = new Set(next.ids);
  projectKeys = new Set(next.projectKeys);
  for (const [id, starred] of pendingDesired) {
    if (starred) ids.add(id);
    else ids.delete(id);
  }
  for (const [key, starred] of pendingProjectDesired) {
    if (starred) projectKeys.add(key);
    else projectKeys.delete(key);
  }
  revision++;
  for (const listener of listeners) listener({ ids: new Set(ids), projectKeys: new Set(projectKeys) });
}

async function requestStars(body?: object): Promise<{ ids: string[]; projectKeys: string[] }> {
  const response = await fetch(URL, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  if (!response.ok) throw new Error(`Starred sessions request failed (${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !Array.isArray((result as { ids?: unknown }).ids)) {
    throw new Error("Invalid starred sessions response");
  }
  const state = result as { ids: string[]; projectKeys?: unknown };
  return { ids: state.ids, projectKeys: Array.isArray(state.projectKeys) ? state.projectKeys as string[] : [] };
}

async function refresh() {
  if (loading) return loading;
  const seenRevision = revision;
  loading = (async () => {
    const serverIds = await requestStars();
    let legacy: string | null = null;
    try { legacy = window.localStorage.getItem(STARRED_SESSIONS_STORAGE_KEY); } catch { /* Storage unavailable. */ }
    let next = serverIds;
    if (legacy !== null) {
      const oldIds = [...parseStarredSessionIds(legacy)].filter((id) => id.length <= 256).slice(0, 10_000);
      // An import is an atomic union, not a replacement of other browsers' stars.
      if (oldIds.length) next = await requestStars({ op: "import", ids: oldIds });
      try {
        if (window.localStorage.getItem(STARRED_SESSIONS_STORAGE_KEY) === legacy) {
          window.localStorage.removeItem(STARRED_SESSIONS_STORAGE_KEY);
        }
      } catch { /* The import succeeded even if storage is unavailable now. */ }
    }
    loaded = true;
    if (revision === seenRevision) publish(next);
  })().catch((error) => {
    console.error("Could not load starred sessions", error);
  }).finally(() => { loading = null; });
  return loading;
}

async function toggle(id: string, project = false) {
  const pending = project ? pendingProjectDesired : pendingDesired;
  if (pending.has(id)) return;
  if (!loaded) await refresh();
  if (!loaded || pending.has(id)) return;
  const current = project ? projectKeys : ids;
  const starred = !current.has(id);
  pending.set(id, starred);
  publish({ ids: [...ids], projectKeys: [...projectKeys] });
  // Server responses are full snapshots; serialize this tab's writes so an
  // older response cannot overwrite a newer operation on another ID.
  const previous = writes;
  let release!: () => void;
  writes = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const result = await requestStars(project
      ? { op: "set-project", key: id, starred }
      : { op: "set", id, starred });
    pending.delete(id);
    publish(result);
  } catch (error) {
    pending.delete(id);
    console.error("Could not update starred session", error);
    await refresh();
  } finally {
    release();
  }
}

export function useStarredSessions() {
  const work = useNavigationWork();
  const [starState, setStarState] = useState(() => ({ ids: new Set(ids), projectKeys: new Set(projectKeys) }));

  useEffect(() => {
    listeners.add(setStarState);
    setStarState({ ids: new Set(ids), projectKeys: new Set(projectKeys) });
    void work.observe(refresh());
    const onFocus = () => { void work.observe(refresh()); };
    const onVisibility = () => { if (document.visibilityState === "visible") void work.observe(refresh()); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      listeners.delete(setStarState);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [work]);

  const toggleStarred = useCallback((id: string) => { void work.observe(toggle(id)); }, [work]);
  const toggleStarredProject = useCallback((key: string) => { void work.observe(toggle(key, true)); }, [work]);
  return { starredIds: starState.ids, starredProjectKeys: starState.projectKeys, toggleStarred, toggleStarredProject };
}
