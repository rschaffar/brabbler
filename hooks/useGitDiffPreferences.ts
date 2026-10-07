"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_DIFF_PREFERENCES, GIT_DIFF_PREFERENCE_KEY, readDiffPreferences, writeDiffPreferences,
  type DiffPreferenceStorage, type GitDiffPreferences } from "@/lib/git-diff-preferences";

const listeners = new Set<() => void>();
let current: GitDiffPreferences | null = null;
function storage(): DiffPreferenceStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
function snapshot() {
  if (typeof window === "undefined") return DEFAULT_DIFF_PREFERENCES;
  return current ??= readDiffPreferences(storage());
}
function emit() { listeners.forEach((listener) => listener()); }
function changed(event: StorageEvent) {
  if (event.key !== GIT_DIFF_PREFERENCE_KEY && event.key !== null) return;
  current = readDiffPreferences(storage());
  emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", changed);
  };
}
function update(value: Partial<GitDiffPreferences>) {
  current = { ...snapshot(), ...value };
  writeDiffPreferences(storage(), current);
  emit();
}
export function useGitDiffPreferences() {
  const preferences = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_DIFF_PREFERENCES);
  return { ...preferences, setPreferences: update };
}
