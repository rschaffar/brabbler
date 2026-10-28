"use client";

import { useSyncExternalStore } from "react";

export const REMOTE_IMAGES_STORAGE_KEY = "brabbler-load-remote-images";
const listeners = new Set<() => void>();
// Keep an explicit in-tab choice if storage refuses the write. In particular,
// an unsuccessful disable must not re-enable images from an old stored value.
let unsaved: boolean | undefined;

export function getRemoteImagesEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (unsaved !== undefined) return unsaved;
  try { return window.localStorage.getItem(REMOTE_IMAGES_STORAGE_KEY) === "true"; }
  catch { return false; }
}
function emit() { listeners.forEach(listener => listener()); }
function changed(event: StorageEvent) {
  if (event.key !== REMOTE_IMAGES_STORAGE_KEY && event.key !== null) return;
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    // A peer disable/clear wins over an unsaved enable, but never over an
    // unsaved disable. Missing/malformed storage is always the safe default.
    if (unsaved === true && window.localStorage.getItem(REMOTE_IMAGES_STORAGE_KEY) !== "true") unsaved = undefined;
  } catch { if (unsaved === true) unsaved = undefined; }
  emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener("storage", changed);
      // We cannot observe a peer disable while nobody subscribes. Never carry
      // an unpersisted opt-in across that gap; retain unpersisted disables.
      if (unsaved === true) unsaved = undefined;
    }
  };
}
export function setRemoteImagesEnabled(enabled: boolean): void {
  unsaved = enabled;
  try {
    window.localStorage.setItem(REMOTE_IMAGES_STORAGE_KEY, String(enabled));
    unsaved = undefined;
  } catch { /* Best-effort persistence; retain the explicit in-tab choice. */ }
  emit();
}
export function useRemoteImages() {
  const enabled = useSyncExternalStore(subscribe, getRemoteImagesEnabled, () => false);
  return { enabled, setEnabled: setRemoteImagesEnabled };
}
