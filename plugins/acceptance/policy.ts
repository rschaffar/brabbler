import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { onPluginSettingsChange, pluginSettingsPath, readPluginSettings } from "../../lib/plugins/settings";
import { acceptanceManifest } from "./manifest";

/** One global switch; project/session overrides never supply execution authority. */
export function acceptanceEnabled(agentDir = getAgentDir()): boolean {
  try { return readPluginSettings(acceptanceManifest, undefined, pluginSettingsPath(acceptanceManifest, agentDir)).enabled; }
  catch { return false; } // Missing defaults off; malformed state fails closed.
}
export function assertAcceptanceEnabled(agentDir?: string): void {
  if (!acceptanceEnabled(agentDir)) throw new Error("Acceptance plugin is disabled or its settings are unavailable. Enable it globally in Settings → Plugins → Acceptance; agents must not change their own permissions.");
}
/** Cancellation is scoped to preparation/approval, never to an independently accepted job. */
export async function withAcceptanceAdmission<T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const agentDir = getAgentDir();
  assertAcceptanceEnabled(agentDir);
  const cancellation = new AbortController();
  const unsubscribe = onPluginSettingsChange((id) => {
    if (id === acceptanceManifest.id && !acceptanceEnabled(agentDir)) cancellation.abort(new Error("Acceptance disabled during admission; request a new run after explicitly enabling it"));
  });
  const combined = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
  try { combined.throwIfAborted(); return await action(combined); }
  finally { unsubscribe(); }
}
