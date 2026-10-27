export type PatchView = "split" | "unified" | "raw";
export interface GitDiffPreferences { view: PatchView; wrap: boolean }
export interface DiffPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const GIT_DIFF_PREFERENCE_KEY = "brabbler:git-diff-preferences";
export const DEFAULT_DIFF_PREFERENCES: GitDiffPreferences = { view: "split", wrap: true };

export function readDiffPreferences(storage: DiffPreferenceStorage | null): GitDiffPreferences {
  try {
    const value = JSON.parse(storage?.getItem(GIT_DIFF_PREFERENCE_KEY) ?? "null");
    if (value && ["split", "unified", "raw"].includes(value.view) && typeof value.wrap === "boolean") {
      return { view: value.view, wrap: value.wrap };
    }
  } catch { /* Invalid or unavailable browser storage is not a review failure. */ }
  return DEFAULT_DIFF_PREFERENCES;
}

/** Store presentation preferences only, never file contents or context expansion. */
export function writeDiffPreferences(storage: DiffPreferenceStorage | null, value: GitDiffPreferences): void {
  try { storage?.setItem(GIT_DIFF_PREFERENCE_KEY, JSON.stringify({ view: value.view, wrap: value.wrap })); }
  catch { /* Browser storage is best-effort. */ }
}
