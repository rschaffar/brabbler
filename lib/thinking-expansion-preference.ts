const STORAGE_KEY = "brabbler-thinking-expanded";
let fallback = false;
let unsaved = false;

// Broadcast so already-mounted ThinkingBlock instances update when the
// preference changes in the settings panel.
export const THINKING_EXPANDED_EVENT = "brabbler-thinking-expanded-changed";

export function isThinkingExpandedByDefault(): boolean {
  if (typeof window === "undefined") return false;
  if (unsaved) return fallback;
  try { fallback = window.localStorage.getItem(STORAGE_KEY) === "true"; } catch { /* Keep this tab's preference. */ }
  return fallback;
}

export function setThinkingExpandedByDefault(expanded: boolean): void {
  if (typeof window === "undefined") return;
  fallback = expanded;
  unsaved = true;
  try { window.localStorage.setItem(STORAGE_KEY, String(expanded)); unsaved = false; } catch { /* Best-effort persistence. */ }
  window.dispatchEvent(new Event(THINKING_EXPANDED_EVENT));
}
