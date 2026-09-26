import { useCallback, useEffect, useState } from "react";
import { parseStarredSessionIds, STARRED_SESSIONS_STORAGE_KEY } from "@/lib/starred-sessions";

const URL = "/api/starred-sessions";
let ids = new Set<string>();
let loaded = false;
let loading: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<(ids: Set<string>) => void>();
const pendingDesired = new Map<string, boolean>();
let writes: Promise<void> = Promise.resolve();

function publish(next: string[]) {
  ids = new Set(next);
  for (const [id, starred] of pendingDesired) {
    if (starred) ids.add(id);
    else ids.delete(id);
  }
  revision++;
  for (const listener of listeners) listener(new Set(ids));
}

async function requestStars(body?: object): Promise<string[]> {
  const response = await fetch(URL, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  if (!response.ok) throw new Error(`Starred sessions request failed (${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !Array.isArray((result as { ids?: unknown }).ids)) {
    throw new Error("Invalid starred sessions response");
  }
  return (result as { ids: string[] }).ids;
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

async function toggle(id: string) {
  if (pendingDesired.has(id)) return;
  if (!loaded) await refresh();
  if (!loaded || pendingDesired.has(id)) return;
  const starred = !ids.has(id);
  pendingDesired.set(id, starred);
  publish([...ids]);
  // Server responses are full snapshots; serialize this tab's writes so an
  // older response cannot overwrite a newer operation on another ID.
  const previous = writes;
  let release!: () => void;
  writes = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const result = await requestStars({ op: "set", id, starred });
    pendingDesired.delete(id);
    publish(result);
  } catch (error) {
    pendingDesired.delete(id);
    console.error("Could not update starred session", error);
    await refresh();
  } finally {
    release();
  }
}

export function useStarredSessions() {
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(ids));

  useEffect(() => {
    listeners.add(setStarredIds);
    setStarredIds(new Set(ids));
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      listeners.delete(setStarredIds);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const toggleStarred = useCallback((id: string) => { void toggle(id); }, []);
  return { starredIds, toggleStarred };
}
