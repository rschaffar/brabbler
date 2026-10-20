"use client";

import { useI18n } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_DEFAULT, FONT_WEIGHT_OPTIONS } from "@/lib/font-preferences";
import { ConfigButton } from "./SettingsUi";

const FIELDS = [
  { kind: "ui", label: "settings.uiFontFamily", placeholder: "settings.uiFontPlaceholder", reset: "settings.resetUiFont", weightLabel: "settings.uiFontWeight", resetWeight: "settings.resetUiFontWeight" },
  { kind: "mono", label: "settings.monoFontFamily", placeholder: "settings.monoFontPlaceholder", reset: "settings.resetMonoFont", weightLabel: "settings.monoFontWeight", resetWeight: "settings.resetMonoFontWeight" },
] as const;

function ResetIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
  </svg>;
}

/** Name inputs double as previews; resetting a family never changes its weight. */
export function FontSettings() {
  const { t } = useI18n();
  const fonts = useFontPreferences();
  return <div className="settings-font-rows">{FIELDS.map(({ kind, label, placeholder, reset, weightLabel, resetWeight }) => {
    const weight = fonts[`${kind}Weight`];
    const option = FONT_WEIGHT_OPTIONS.find((entry) => entry.value === weight)!;
    return <div key={kind} className="settings-chat-option settings-chat-range-option settings-font-row">
      <div className="settings-chat-range-header settings-font-header">
        <label htmlFor={`settings-font-${kind}`}>{t(label)}</label>
        <input id={`settings-font-${kind}`} className={`settings-font-input${kind === "mono" ? " is-mono" : ""}`}
          type="text" value={fonts[kind]} placeholder={t(placeholder)} maxLength={FONT_FAMILY_MAX_LENGTH}
          aria-describedby="settings-typography-description" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(event) => fonts.setFontPreference(kind, event.target.value)} />
        <ConfigButton variant="ghost" size="small" className="settings-chat-reset" title={t(reset)} aria-label={t(reset)}
          disabled={!fonts[kind]} onClick={() => fonts.resetFontPreference(kind)}><ResetIcon /></ConfigButton>
      </div>
      <div className="settings-chat-range-header">
        <label htmlFor={`settings-font-${kind}-weight`}>{t(weightLabel)}</label>
        <output htmlFor={`settings-font-${kind}-weight`}>{weight} {t(option.label)}</output>
        <ConfigButton variant="ghost" size="small" className="settings-chat-reset" title={t(resetWeight)} aria-label={t(resetWeight)}
          disabled={weight === FONT_WEIGHT_DEFAULT} onClick={() => fonts.resetFontWeight(kind)}><ResetIcon /></ConfigButton>
      </div>
      <input id={`settings-font-${kind}-weight`} type="range" min={100} max={600} step={100} value={weight}
        aria-valuetext={`${weight} ${t(option.label)}`} onChange={(event) => fonts.setFontWeight(kind, Number(event.target.value))} />
    </div>;
  })}</div>;
}
