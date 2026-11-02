import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

/** Shared native defaults, not a conversation's effective/clamped selection. */
export interface StartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export function readStartupPreferences(settings: SettingsManager): StartupPreferences {
  const global = settings.getGlobalSettings();
  return {
    ...(global.defaultProvider && global.defaultModel
      ? { model: { provider: global.defaultProvider, modelId: global.defaultModel } } : {}),
    ...(global.defaultThinkingLevel ? { thinkingLevel: global.defaultThinkingLevel } : {}),
  };
}

/** Only the explicit Settings action calls this. Preserve all unedited fields. */
export async function saveStartupPreferences(settings: SettingsManager, changes: StartupPreferences): Promise<void> {
  const checkErrors = () => {
    const errors = settings.drainErrors();
    if (errors.length) throw new Error("Could not save shared model defaults");
  };
  checkErrors();
  if (changes.model) settings.setDefaultModelAndProvider(changes.model.provider, changes.model.modelId);
  if (changes.thinkingLevel) settings.setDefaultThinkingLevel(changes.thinkingLevel);
  await settings.flush();
  checkErrors();
}
