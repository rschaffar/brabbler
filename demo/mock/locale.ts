/** Demo tutorial content always matches the English interface. */
export type DemoLocale = "en" | "zh";

export function currentDemoLocale(): DemoLocale {
  return "en";
}

/** Tutorial fixture copy; only the English variant is selected at runtime. */
export type Localized = { en: string; zh: string };

export function pick(text: Localized | string, _locale: DemoLocale): string {
  return typeof text === "string" ? text : text.en;
}
