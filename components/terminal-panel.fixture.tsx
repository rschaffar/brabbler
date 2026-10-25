import { useLayoutEffect } from "react";
import { useChatAppearance } from "../hooks/useChatAppearance";
export { TerminalPanel } from "./TerminalPanel";
export { GeneralSettings } from "./SettingsPanel";
export { SettingsWorkContext } from "./SettingsUi";
export { I18nProvider } from "../hooks/useI18n";
export { setFontPreference, setFontWeight } from "../hooks/useFontPreferences";
export { setTerminalTheme } from "../hooks/useTerminalTheme";
export { createClientCompletion } from "../lib/client-completion";

/** Observe the real store's public setter in the same physical React graph. */
export function TerminalAppearanceProbe({ observe }: { observe: (value: ReturnType<typeof useChatAppearance>) => void }) {
  const value = useChatAppearance();
  useLayoutEffect(() => { observe(value); });
  return null;
}
