/** The fixed interface formatting locale. */
export type Locale = "en";

/** Simple interpolation parameters for UI messages. */
export type TranslationParams = Record<string, string | number>;

/** Shared message catalog definition. */
export interface LocalePlugin {
  id: Locale;
  label: string;
  messages: Record<string, string>;
}
