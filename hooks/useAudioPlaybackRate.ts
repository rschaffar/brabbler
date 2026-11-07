"use client";

import { useSyncExternalStore } from "react";

export const AUDIO_PLAYBACK_RATE_KEY = "brabbler-audio-playback-rate";
export const AUDIO_PLAYBACK_RATE_MIN = 0.5;
export const AUDIO_PLAYBACK_RATE_MAX = 3;
export const AUDIO_PLAYBACK_RATE_STEP = 0.05;
const listeners = new Set<() => void>();
let unsaved: number | undefined;

export function validAudioPlaybackRate(value: number): boolean {
  return Number.isFinite(value) && value >= AUDIO_PLAYBACK_RATE_MIN && value <= AUDIO_PLAYBACK_RATE_MAX;
}

function getRate(): number {
  if (typeof window === "undefined") return 1;
  if (unsaved !== undefined) return unsaved;
  try {
    const value = Number(window.localStorage.getItem(AUDIO_PLAYBACK_RATE_KEY));
    return validAudioPlaybackRate(value) ? Math.round(value * 100) / 100 : 1;
  } catch { return 1; }
}
function emit() { listeners.forEach(listener => listener()); }
function changed(event: StorageEvent) {
  if (event.key !== AUDIO_PLAYBACK_RATE_KEY && event.key !== null) return;
  try { if (event.storageArea && event.storageArea !== window.localStorage) return; }
  catch { return; }
  unsaved = undefined;
  emit();
  if (!listeners.size) window.removeEventListener("storage", changed);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    // An unpersisted preference still needs peer observation between tracks.
    // Drop this retained observer when a peer change clears the fallback.
    if (!listeners.size && unsaved === undefined) window.removeEventListener("storage", changed);
  };
}
function setRate(value: number) {
  if (!validAudioPlaybackRate(value)) return;
  const rate = Math.round(value * 100) / 100;
  if (rate === getRate()) return;
  unsaved = rate;
  try {
    window.localStorage.setItem(AUDIO_PLAYBACK_RATE_KEY, String(rate));
    unsaved = undefined;
  } catch { /* Keep the explicit in-tab preference when persistence is unavailable. */ }
  emit();
}

/** Shared by loaded chat audio and Files; never loads or starts media. */
export function useAudioPlaybackRate() {
  const rate = useSyncExternalStore(subscribe, getRate, () => 1);
  return { rate, setRate };
}
