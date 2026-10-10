import { enLocale } from "./messages/en";
import type { LocalePlugin } from "./types";

/** The interface only ships English messages. */
export function getLocalePlugin(id: string): LocalePlugin | undefined {
  return id === "en" ? enLocale : undefined;
}

export function getSupportedLocales(): string[] {
  return ["en"];
}
