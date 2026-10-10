"use client";

import { createContext, useContext } from "react";
import { enLocale } from "@/lib/i18n/messages/en";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, TranslationParams } from "@/lib/i18n/types";

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const messages = { en: enLocale.messages };
const value: I18nContextValue = {
  locale: "en",
  t: (key, params) => translateMessage("en", key, messages, params),
};

/** Provide the shared English UI catalog without browser or stored preferences. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Read English UI messages and the fixed formatting locale. */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
