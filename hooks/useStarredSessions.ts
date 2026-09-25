import { useCallback, useEffect, useState } from "react";
import { parseStarredSessionIds, serializeStarredSessionIds, STARRED_SESSIONS_STORAGE_KEY } from "@/lib/starred-sessions";

const STARRED_SESSIONS_EVENT = "pi-web:starred-sessions-change";

function loadStarredIds(): Set<string> {
  try {
    return parseStarredSessionIds(window.localStorage.getItem(STARRED_SESSIONS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function useStarredSessions() {
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const reload = () => setStarredIds(loadStarredIds());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STARRED_SESSIONS_STORAGE_KEY || event.key === null) reload();
    };
    reload();
    window.addEventListener("storage", onStorage);
    window.addEventListener(STARRED_SESSIONS_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(STARRED_SESSIONS_EVENT, reload);
    };
  }, []);

  const toggleStarred = useCallback((id: string) => {
    const ids = loadStarredIds();
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    let persisted = false;
    try {
      window.localStorage.setItem(STARRED_SESSIONS_STORAGE_KEY, serializeStarredSessionIds(ids));
      persisted = true;
    } catch {
      // Keep the interaction responsive when browser storage is unavailable.
    }
    setStarredIds(ids);
    if (persisted) window.dispatchEvent(new Event(STARRED_SESSIONS_EVENT));
  }, []);

  return { starredIds, toggleStarred };
}
