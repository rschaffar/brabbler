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

export interface StartupPreferencesChanges extends StartupPreferences {
  /** null removes only this model's shared default; omitted leaves it untouched. */
  modelThinking?: { provider: string; modelId: string; level: ThinkingLevel | null };
}

/** Only explicit Settings actions call this. Preserve all unedited fields. */
export async function saveStartupPreferences(settings: SettingsManager, changes: StartupPreferencesChanges): Promise<void> {
  const checkErrors = () => {
    const errors = settings.drainErrors();
    if (errors.length) throw new Error("Could not save shared model defaults");
  };
  checkErrors();
  if (changes.model) settings.setDefaultModelAndProvider(changes.model.provider, changes.model.modelId);
  if (changes.thinkingLevel) settings.setDefaultThinkingLevel(changes.thinkingLevel);
  if (changes.modelThinking) {
    const { provider, modelId, level } = changes.modelThinking;
    if (level === null) settings.removeModelThinkingLevel(provider, modelId);
    else settings.setModelThinkingLevel(provider, modelId, level);
  }
  await settings.flush();
  checkErrors();
}
