import type { Overrides, PluginField, PluginManifest, PluginSettingScope, PluginSettings, SettingValue } from "./types";

export const PLUGIN_SETTING_SCOPES: readonly PluginSettingScope[] = ["global", "project", "session"];
export type SettingSource = PluginSettings["sources"][string];

export function supportsSettingScope(field: PluginField, scope: PluginSettingScope): boolean {
  return scope === "global" || (!field.globalOnly && (scope !== "session" || field.sessionOverridable !== false));
}

export function settingScopeAvailable(settings: PluginSettings, field: PluginField, scope: PluginSettingScope): boolean {
  return supportsSettingScope(field, scope) && (scope === "global" || (scope === "project"
    ? Boolean(settings.project) : Boolean(settings.sessionId && settings.sessionApplicable)));
}

export function settingOverrides(settings: PluginSettings, scope: PluginSettingScope): Overrides {
  return scope === "global" ? settings.global : scope === "project" ? settings.overrides : settings.sessionOverrides ?? {};
}

/** Compare stored values, not inheritance. Check-object property order is immaterial. */
export function settingValuesEqual(a: SettingValue, b: SettingValue): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  return a.length === b.length && a.every((check, index) => {
    const other = b[index];
    return check.name === other.name && check.command === other.command && check.timeoutMs === other.timeoutMs;
  });
}

export interface SettingResolution { value: SettingValue; source: SettingSource }

/** The same scope applicability and source order drive server reads and UI previews. */
export function settingValueAtScope(settings: PluginSettings, key: string, field: PluginField,
  scope: PluginSettingScope = "session"): SettingResolution {
  let result: SettingResolution = { value: field.default, source: "builtin" };
  for (const candidate of PLUGIN_SETTING_SCOPES) {
    if (settingScopeAvailable(settings, field, candidate)) {
      const values = settingOverrides(settings, candidate);
      if (Object.hasOwn(values, key)) result = { value: values[key], source: candidate };
    }
    if (candidate === scope) break;
  }
  return result;
}

export function inheritedSettingValue(settings: PluginSettings, key: string, field: PluginField,
  scope: PluginSettingScope): SettingResolution {
  return scope === "global" ? { value: field.default, source: "builtin" }
    : settingValueAtScope(settings, key, field, scope === "session" ? "project" : "global");
}

export function recomputePluginSettings(manifest: PluginManifest, settings: PluginSettings): PluginSettings {
  const effective: Overrides = {}, sources: PluginSettings["sources"] = {};
  for (const [key, field] of Object.entries(manifest.fields)) {
    const resolved = settingValueAtScope(settings, key, field);
    effective[key] = structuredClone(resolved.value);
    sources[key] = resolved.source;
  }
  return { ...settings, effective, sources, enabled: effective.enabled === true };
}

/** A prospective immutable edit; never writes settings or grants execution authority. */
export function previewPluginSettings(manifest: PluginManifest, settings: PluginSettings,
  scope: PluginSettingScope, set: Overrides, reset: readonly string[] = []): PluginSettings {
  const next = structuredClone(settings);
  const values = scope === "session" ? next.sessionOverrides ??= {} : settingOverrides(next, scope);
  for (const key of reset) delete values[key];
  Object.assign(values, set);
  return recomputePluginSettings(manifest, next);
}

/** Display-only: a saved default does not answer a related workflow question.
 * Other consumers may still use the default; this never declares it inactive. */
export function settingHasUnansweredChoice(manifest: PluginManifest, settings: PluginSettings, field: PluginField): boolean {
  const dependency = field.presentation?.relatedChoice;
  const controller = dependency && manifest.fields[dependency.field];
  return Boolean(dependency && controller
    && settingValuesEqual(settingValueAtScope(settings, dependency.field, controller).value, dependency.unresolvedValue));
}

export interface SettingCell extends SettingResolution {
  available: boolean;
  supported: boolean;
  saved: boolean;
  sameAsParent: boolean;
  winning: boolean;
}

export function settingCell(settings: PluginSettings, key: string, field: PluginField, scope: PluginSettingScope): SettingCell {
  const available = settingScopeAvailable(settings, field, scope);
  const saved = available && Object.hasOwn(settingOverrides(settings, scope), key);
  const effective = settingValueAtScope(settings, key, field);
  const result = settingValueAtScope(settings, key, field, scope);
  return { ...result, available, supported: supportsSettingScope(field, scope), saved,
    sameAsParent: saved && settingValuesEqual(result.value, inheritedSettingValue(settings, key, field, scope).value),
    winning: available && (effective.source === scope || (scope === "global" && effective.source === "builtin")) };
}

export type SettingDraft = { ok: true; value: SettingValue } | { ok: false; error: "text" | "checks" | "value" };

/** UI validation only; authenticated server validation remains mandatory. */
export function parseSettingDraft(field: PluginField, text: string, explicitNull = false): SettingDraft {
  if (explicitNull) return field.nullable ? { ok: true, value: null } : { ok: false, error: "value" };
  if (field.kind === "text") return /[\x00-\x1f]/.test(text) ? { ok: false, error: "text" } : { ok: true, value: text };
  if (field.kind === "boolean") return text === "true" || text === "false"
    ? { ok: true, value: text === "true" } : { ok: false, error: "value" };
  if (field.kind === "enum") return field.options?.includes(text)
    ? { ok: true, value: text } : { ok: false, error: "value" };
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return { ok: false, error: "checks" };
    const names = new Set<string>();
    for (const check of value) {
      if (!check || typeof check !== "object" || Array.isArray(check)
        || Object.keys(check).some((key) => !["name", "command", "timeoutMs"].includes(key))
        || typeof check.name !== "string" || !check.name.trim() || names.has(check.name)
        || typeof check.command !== "string" || !check.command.trim() || check.command.includes("\0")
        || (check.timeoutMs !== undefined && (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 0 || check.timeoutMs > 2_147_483_647))) {
        return { ok: false, error: "checks" };
      }
      names.add(check.name);
    }
    return { ok: true, value };
  } catch { return { ok: false, error: "checks" }; }
}
