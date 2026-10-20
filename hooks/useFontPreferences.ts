"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_FONT_PREFERENCES, FONT_STORAGE_KEYS, FONT_WEIGHT_DEFAULT,
  fontFamilyOverride, readFontPreference, readFontWeight,
  type FontKind, type FontPreferences,
} from "@/lib/font-preferences";

const FONT_KINDS: FontKind[] = ["ui", "mono"];
const KEYS = Object.keys(FONT_STORAGE_KEYS) as (keyof FontPreferences)[];
let preferences: FontPreferences | null = null;
const listeners = new Set<() => void>();
// A failed write must not be undone by rereading an older persisted value on
// another preference's storage event (or a later mount). Local edits retry it.
const unsaved = new Set<keyof FontPreferences>();

function readStored(): FontPreferences {
  const next = { ...(preferences ?? DEFAULT_FONT_PREFERENCES) };
  for (const key of KEYS) {
    if (unsaved.has(key)) continue;
    try {
      const value = window.localStorage.getItem(FONT_STORAGE_KEYS[key]);
      if (key === "ui" || key === "mono") next[key] = readFontPreference(value);
      else next[key] = readFontWeight(value);
    } catch { /* Keep the current value when reads are blocked. */ }
  }
  return next;
}

function apply(next: FontPreferences): void {
  for (const kind of FONT_KINDS) {
    const property = `--font-${kind}`;
    const family = fontFamilyOverride(kind, next[kind]);
    if (family) document.documentElement.style.setProperty(property, family);
    else document.documentElement.style.removeProperty(property);
    const weight = next[`${kind}Weight`];
    if (weight === FONT_WEIGHT_DEFAULT) document.documentElement.style.removeProperty(`${property}-weight`);
    else document.documentElement.style.setProperty(`${property}-weight`, String(weight));
  }
}

function getSnapshot(): FontPreferences {
  if (typeof window === "undefined") return DEFAULT_FONT_PREFERENCES;
  if (!preferences) { preferences = readStored(); apply(preferences); }
  return preferences;
}
function publish(next: FontPreferences): void {
  const current = getSnapshot();
  if (KEYS.every((key) => current[key] === next[key])) return;
  preferences = next;
  apply(next);
  listeners.forEach((listener) => listener());
}
function onStorage(event: StorageEvent): void {
  if (event.key !== null && !Object.values(FONT_STORAGE_KEYS).includes(event.key)) return;
  try { if (event.storageArea && event.storageArea !== window.localStorage) return; }
  catch { return; } // A blocked storage getter must not break the page.
  publish(readStored());
}

/** Appearance subscribers never own terminal transport or PTY lifetime. */
export function subscribeFontPreferences(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    getSnapshot();
    publish(readStored());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
function setPreference<K extends keyof FontPreferences>(key: K, value: FontPreferences[K]): void {
  const current = getSnapshot();
  if (current[key] === value && !unsaved.has(key)) return;
  try {
    if (value === DEFAULT_FONT_PREFERENCES[key]) window.localStorage.removeItem(FONT_STORAGE_KEYS[key]);
    else window.localStorage.setItem(FONT_STORAGE_KEYS[key], String(value));
    unsaved.delete(key);
  } catch { unsaved.add(key); }
  publish({ ...current, [key]: value });
}
export function setFontPreference(kind: FontKind, value: string): void {
  setPreference(kind, readFontPreference(value));
}
export function setFontWeight(kind: FontKind, value: number): void {
  setPreference(`${kind}Weight`, readFontWeight(value));
}
// Family and weight resets are intentionally independent.
export function resetFontPreference(kind: FontKind): void { setFontPreference(kind, ""); }
export function resetFontWeight(kind: FontKind): void { setFontWeight(kind, FONT_WEIGHT_DEFAULT); }
export function useFontPreferences() {
  const snapshot = useSyncExternalStore(subscribeFontPreferences, getSnapshot, () => DEFAULT_FONT_PREFERENCES);
  return { ...snapshot, setFontPreference, setFontWeight, resetFontPreference, resetFontWeight };
}
