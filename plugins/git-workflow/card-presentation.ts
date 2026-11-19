import type { PluginCardField, PluginCardSection, RequiredCheck } from "../../lib/plugins/types";

/** Application presentation configuration, never operation JSON or Git policy. */
export interface GitCardPresentation { readonly sectionFieldLimit: number }
export const DEFAULT_GIT_CARD_PRESENTATION: GitCardPresentation = Object.freeze({ sectionFieldLimit: 24 });

export function gitCardExcerpt(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) + "… [full value in exact review]" : value;
}
export function gitCardField({ label, value, ...flags }: PluginCardField): PluginCardField {
  return { label: gitCardExcerpt(label, 90), value: gitCardExcerpt(value, 2048), ...flags };
}

export function gitCardSectionLimit(presentation: GitCardPresentation = DEFAULT_GIT_CARD_PRESENTATION): number {
  const limit = presentation.sectionFieldLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit) throw new Error("Git section preview limit must be an integer from 1 to 24");
  return limit;
}

/** Only the displayed prefix is formatted. The capture owns the complete input. */
export function gitCardSection<T>(title: string, items: readonly T[], field: (item: T) => PluginCardField,
  presentation?: GitCardPresentation): PluginCardSection {
  const limit = gitCardSectionLimit(presentation);
  return { title, fields: items.slice(0, limit).map(item => gitCardField(field(item))),
    ...(items.length > limit ? { text: `Showing ${limit} of ${items.length} items. The exact review contains every item.` } : {}) };
}

export function requiredChecksSection(checks: readonly RequiredCheck[], presentation?: GitCardPresentation): PluginCardSection {
  return gitCardSection("Required checks", checks, check => ({ label: check.name, value: check.command, code: true }), presentation);
}
