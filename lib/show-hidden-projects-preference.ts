const STORAGE_KEY = "pi-show-hidden-projects";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reveal is a browser-local display preference, never a server privacy setting. */
export function getShowHiddenProjects(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveShowHiddenProjects(show: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, String(show));
  } catch {
    // Keep the current UI choice usable even when browser storage is blocked.
  }
}
