import type { SettingsManager } from "@earendil-works/pi-coding-agent";

/** Preserve Brabbler's pre-1.5.1 default without writing operator settings.
 * Read global state on every call so explicit saved changes still take effect;
 * project settings cannot opt the operator into paid cache warming. */
export function withStreamingCacheWarmingDefault<T extends SettingsManager>(settings: T): T {
  settings.getCacheWarmingMode = () => {
    const configured = settings.getGlobalSettings().cacheWarming;
    return configured === "off" || configured === "idle" ? configured : "streaming";
  };
  return settings;
}
