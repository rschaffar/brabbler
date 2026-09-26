export const TITLE_LANGUAGES = ["auto", "en", "de", "zh-CN", "zh-TW"] as const;
export type TitleLanguage = typeof TITLE_LANGUAGES[number];

const NAMES: Record<Exclude<TitleLanguage, "auto">, string> = {
  en: "English",
  de: "German",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
};

export function isTitleLanguage(value: unknown): value is TitleLanguage {
  return TITLE_LANGUAGES.some((language) => language === value);
}

export function titleLanguageInstruction(language: TitleLanguage): string {
  return language === "auto"
    ? "Match the primary language used by the user."
    : `Write the title in ${NAMES[language]}, regardless of the transcript's language.`;
}
