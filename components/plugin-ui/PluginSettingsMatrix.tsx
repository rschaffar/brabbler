"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Overrides, PluginField, PluginManifest, PluginSettingScope, PluginSettings, SettingValue } from "@/lib/plugins/types";
import { inheritedSettingValue, parseSettingDraft, PLUGIN_SETTING_SCOPES, previewPluginSettings, settingCell,
  settingHasUnansweredChoice, settingOverrides, settingScopeAvailable, settingValueAtScope, settingValuesEqual } from "@/lib/plugins/settings-view";
// Scoped classes live with the existing settings stylesheet, not a transitive
// CSS import in every real settings/manager component graph.
const styles = Object.fromEntries([
  "root", "heading", "context", "globalControl", "globalLabel", "notice", "description", "legend", "toolbar", "search", "savedFilter",
  "table", "row", "columnHeadings", "fieldHeading", "scopeHeading", "groupHeading", "fieldName", "cell", "cellButton", "unavailable",
  "cellDetail", "inherited", "winning", "saved", "pin", "winner", "secondary", "primary", "textButton", "error", "dialog", "dialogContent",
  "dialogHeader", "dialogBody", "dialogFooter", "modes", "valueEditor", "nullChoice", "pinNotice", "preview", "previewFacts", "selectLabel", "presetPreview",
].map((name) => [name, `plugin-matrix-${name}`]));

export type PluginSettingsSaveResult = { ok: true } | { ok: false; error: string };
type Save = (set: Overrides, reset: string[], scope: PluginSettingScope) => Promise<PluginSettingsSaveResult>;
type Translate = ReturnType<typeof useI18n>["t"];
interface Props {
  manifest: PluginManifest; settings: PluginSettings; busy: boolean; error: string; onSave: Save;
  initialScope: PluginSettingScope; initialField?: string;
}
interface FieldTarget { kind: "field"; key: string; scope: PluginSettingScope; origin: HTMLButtonElement; cleanupOnly?: boolean }
interface PresetTarget { kind: "preset"; origin: HTMLButtonElement }

function fieldLabel(field: PluginField, t: Translate) {
  return field.presentation?.labelKey ? t(field.presentation.labelKey) : field.label;
}
function fieldDescription(field: PluginField, t: Translate) {
  return field.presentation?.descriptionKey ? t(field.presentation.descriptionKey) : field.description;
}
function valueLabel(field: PluginField, value: SettingValue, t: Translate): string {
  if (value === null) return t(field.presentation?.nullLabelKey ?? "pluginMatrix.noValue");
  if (Array.isArray(value)) return value.length ? t("pluginMatrix.checkCount", { count: value.length }) : t("pluginMatrix.noChecks");
  if (typeof value === "boolean") return t(value ? "pluginMatrix.on" : "pluginMatrix.off");
  if (value === "") return t(field.presentation?.emptyLabelKey ?? "pluginMatrix.emptyText");
  const key = field.presentation?.optionLabelKeys?.[value];
  return key ? t(key) : value;
}
function repositoryName(settings: PluginSettings, t: Translate) {
  const segments = settings.project?.split(/[\\/]/).filter(Boolean) ?? [];
  if (segments.at(-1) === ".git") segments.pop();
  return segments.at(-1) || t("pluginMatrix.repository");
}
function scopeNames(settings: PluginSettings, t: Translate) {
  return { builtin: t("pluginMatrix.builtin"), global: t("pluginMatrix.global"), project: repositoryName(settings, t), session: t("pluginMatrix.session") };
}
function useAlive() {
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

export function PluginSettingsMatrix({ manifest, settings, busy, error, onSave, initialScope, initialField }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [target, setTarget] = useState<FieldTarget | PresetTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);
  const root = useRef<HTMLElement>(null);
  const focused = useRef("");
  const names = scopeNames(settings, t);
  const hasSession = Boolean(settings.sessionId && settings.sessionApplicable);
  const groups = new Map<string, { label: string; fields: [string, PluginField][] }>();
  for (const [key, field] of Object.entries(manifest.fields)) {
    if (field.globalOnly) continue;
    if (query && !`${fieldLabel(field, t)} ${key}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
    if (savedOnly && !PLUGIN_SETTING_SCOPES.some((scope) => settingCell(settings, key, field, scope).saved)
      && !(hasSession && Object.hasOwn(settings.sessionOverrides ?? {}, key))) continue;
    const group = field.group ?? "";
    if (!groups.has(group)) groups.set(group, { label: field.presentation?.groupKey ? t(field.presentation.groupKey) : group || t("pluginMatrix.other"), fields: [] });
    groups.get(group)!.fields.push([key, field]);
  }
  useEffect(() => {
    if (!initialField || !manifest.fields[initialField]) return;
    const field = manifest.fields[initialField];
    const desired = field.globalOnly ? "global" : settingScopeAvailable(settings, field, initialScope) ? initialScope
      : settingScopeAvailable(settings, field, "project") ? "project" : "global";
    const token = `${initialField}:${desired}`;
    if (focused.current === token) return;
    const element = root.current?.querySelector<HTMLElement>(`#plugin-${initialField}${field.globalOnly ? "" : `-${desired}`}`);
    if (!element) { setQuery(""); setSavedOnly(false); return; }
    focused.current = token;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center" });
  }, [initialField, initialScope, manifest, settings, query, savedOnly]);

  return <section ref={root} data-plugin-settings-matrix aria-label={t("pluginMatrix.settings", { name: manifest.name })} className={styles.root} aria-busy={busy}>
    <header className={styles.heading}>
      <div><h2>{manifest.name}</h2><p>{t("pluginMatrix.intro")}</p></div>
      {manifest.presets && <button type="button" className={styles.secondary} disabled={busy}
        onClick={(event) => setTarget({ kind: "preset", origin: event.currentTarget })}>{t("pluginMatrix.presets")}</button>}
    </header>
    <p className={styles.context}>{settings.project ? t("pluginMatrix.repositoryContext", { name: names.project }) : t("pluginMatrix.noRepository")}
      {hasSession && <> · {t("pluginMatrix.sessionContext", { id: settings.sessionId!.slice(0, 8) })}</>}</p>
    {Object.entries(manifest.fields).filter(([, field]) => field.globalOnly).map(([key, field]) => {
      const value = settingValueAtScope(settings, key, field, "global");
      return <div key={key} className={styles.globalControl}>
        <div><label htmlFor={`plugin-${key}`} className={styles.globalLabel}>{fieldLabel(field, t)}</label>
          <p>{t("pluginMatrix.globalOnly")} · {Object.hasOwn(settings.global, key) ? t("pluginMatrix.saved") : t("pluginMatrix.builtin")}</p></div>
        {field.kind === "boolean" ? <input id={`plugin-${key}`} type="checkbox" checked={value.value === true} disabled={busy}
          onChange={(event) => void onSave({ [key]: event.target.checked }, [], "global")} />
          : <button type="button" id={`plugin-${key}`} className={styles.secondary} disabled={busy}
            onClick={(event) => setTarget({ kind: "field", key, scope: "global", origin: event.currentTarget })}>{valueLabel(field, value.value, t)}</button>}
        {Object.hasOwn(settings.global, key) && <button type="button" className={styles.textButton} disabled={busy}
          onClick={() => void onSave({}, [key], "global")}>{t("pluginMatrix.resetBuiltin")}</button>}
      </div>;
    })}
    <p className={styles.notice}>{t("pluginMatrix.liveSave")}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!hasSession && <p className={styles.notice}>{t(!settings.sessionId ? "pluginMatrix.noSession"
      : settings.project && settings.sessionProject ? "pluginMatrix.foreignSession" : "pluginMatrix.unresolvedSession")}</p>}
    <div className={styles.toolbar}>
      <label className={styles.search}><span>{t("pluginMatrix.find")}</span><input type="search" value={query} placeholder={t("pluginMatrix.findPlaceholder")}
        onChange={(event) => setQuery(event.target.value)} /></label>
      <label className={styles.savedFilter}><input type="checkbox" checked={savedOnly} onChange={(event) => setSavedOnly(event.target.checked)} />{t("pluginMatrix.savedOnly")}</label>
    </div>
    <div role="table" aria-label={t("pluginMatrix.table")} className={styles.table}>
      <div role="row" className={`${styles.row} ${styles.columnHeadings}`}>
        <span role="columnheader" className={styles.fieldHeading}>{t("pluginMatrix.setting")}</span>
        {PLUGIN_SETTING_SCOPES.map((scope) => <div key={scope} role="columnheader" data-scope-heading={scope} className={styles.scopeHeading}
          title={scope === "project" ? settings.project ?? undefined : scope === "session" ? settings.sessionId ?? undefined : undefined}>
          <strong>{names[scope]}</strong><span>{t(`pluginMatrix.scope_${scope}`)}</span>
        </div>)}
      </div>
      {[...groups].map(([group, { label, fields }]) => <div key={group} role="rowgroup">
        <div role="row" className={styles.groupHeading}><div role="cell" aria-colspan={4}><h3>{label}</h3></div></div>
        {fields.map(([key, field]) => <div key={key} role="row" className={styles.row} data-setting-row={key}>
          <div role="rowheader" className={styles.fieldName}>{fieldLabel(field, t)}
            {settingHasUnansweredChoice(manifest, settings, field) && <span>{t("pluginMatrix.choicePending")}</span>}</div>
          {PLUGIN_SETTING_SCOPES.map((scope) => {
            const cell = settingCell(settings, key, field, scope);
            const ignored = scope === "session" && hasSession && !cell.supported && Object.hasOwn(settings.sessionOverrides ?? {}, key);
            return <div key={scope} role="cell" className={styles.cell}>
              {cell.available ? <button type="button" id={`plugin-${key}-${scope}`} data-setting-cell={`${key}:${scope}`}
                data-saved={cell.saved} data-winning={cell.winning} aria-haspopup="dialog"
                aria-label={t("pluginMatrix.editCell", { field: fieldLabel(field, t), scope: names[scope] })}
                aria-describedby={`plugin-${key}-${scope}-detail`} disabled={busy}
                className={`${styles.cellButton} ${cell.winning ? styles.winning : ""} ${cell.saved ? styles.saved : styles.inherited}`}
                onClick={(event) => setTarget({ kind: "field", key, scope, origin: event.currentTarget })}>
                <span id={`plugin-${key}-${scope}-detail`} className={styles.cellDetail}>
                  <strong>{cell.saved || scope === "global" ? valueLabel(field, cell.value, t) : `↳ ${names[cell.source]}`}</strong>
                  <span>{cell.saved ? t("pluginMatrix.saved") : scope === "global" ? t("pluginMatrix.builtin") : valueLabel(field, cell.value, t)}</span>
                  {cell.sameAsParent && <span className={styles.pin}>{t("pluginMatrix.pinned")}</span>}
                  {cell.winning && <span className={styles.winner}>{t("pluginMatrix.usedHere")}</span>}
                </span>
              </button> : <div className={styles.unavailable} data-setting-cell={`${key}:${scope}`}>
                <strong>{t(cell.supported ? "pluginMatrix.unavailable" : "pluginMatrix.notApplicable")}</strong>
                <span>{t(!cell.supported ? "pluginMatrix.noScopeOverride" : scope === "project" ? "pluginMatrix.noRepositoryShort" : "pluginMatrix.ownSessionOnly")}</span>
                {ignored && <><span>{t("pluginMatrix.legacyIgnored")}</span><button type="button" className={styles.textButton} disabled={busy}
                  onClick={(event) => setTarget({ kind: "field", key, scope, origin: event.currentTarget, cleanupOnly: true })}>{t("pluginMatrix.clearIgnored")}</button></>}
              </div>}
            </div>;
          })}
        </div>)}
      </div>)}
    </div>
    {!groups.size && <p className={styles.notice}>{t("pluginMatrix.noMatches")}</p>}
    <p className={styles.legend}>{t("pluginMatrix.legend")}</p>
    {target?.kind === "field" && <FieldEditor key={`${target.key}:${target.scope}`} {...{ manifest, settings, busy, onSave }} target={target} onClose={close} />}
    {target?.kind === "preset" && <PresetEditor {...{ manifest, settings, busy, onSave, initialScope }} origin={target.origin} onClose={close} />}
  </section>;
}

function EditorDialog({ title, subtitle, origin, busy, onClose, onSubmit, children, action }: {
  title: string; subtitle: string; origin: HTMLButtonElement; busy: boolean; onClose: () => void;
  onSubmit: () => void; children: ReactNode; action: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const matrix = origin.closest<HTMLElement>("[data-plugin-settings-matrix]");
    const identity = origin.closest<HTMLElement>("[data-setting-cell]")?.dataset.settingCell;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (!matrix?.isConnected) return;
      const cell = identity && [...matrix.querySelectorAll<HTMLElement>("[data-setting-cell]")].find((node) => node.dataset.settingCell === identity);
      const replacement = cell ? cell.tagName === "BUTTON" && !cell.hasAttribute("disabled") ? cell : cell.querySelector<HTMLElement>("button:not(:disabled)") : null;
      const focus = origin.isConnected && !origin.disabled ? origin : replacement ?? matrix.querySelector<HTMLElement>('input[type="search"]');
      focus?.focus({ preventScroll: true });
    };
  }, [origin]);
  // Capture before document/window Escape listeners, while retaining the UA's
  // native close-watcher priority (for example an open select popup).
  return <dialog ref={ref} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-subtitle`} className={styles.dialog}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
    onKeyDownCapture={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (busy) event.preventDefault(); } }}>
    <form className={styles.dialogContent} onSubmit={(event: FormEvent) => { event.preventDefault(); if (!busy) onSubmit(); }}>
      <header className={styles.dialogHeader}><div><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-subtitle`}>{subtitle}</p></div>
        <button type="button" aria-label={t("pluginMatrix.closeEditor")} disabled={busy} onClick={onClose}>×</button></header>
      <div className={styles.dialogBody}>{children}</div>
      <footer className={styles.dialogFooter}><button type="button" className={styles.secondary} disabled={busy} onClick={onClose}>{t("pluginMatrix.cancel")}</button>{action}</footer>
    </form>
  </dialog>;
}

function EffectPreview({ manifest, before, after, fieldKey, scope }: {
  manifest: PluginManifest; before: PluginSettings; after: PluginSettings; fieldKey: string; scope: PluginSettingScope;
}) {
  const { t } = useI18n();
  const field = manifest.fields[fieldKey];
  const names = scopeNames(before, t);
  const destination = settingCell(after, fieldKey, field, scope);
  const result = settingValueAtScope(after, fieldKey, field);
  const previous = settingValueAtScope(before, fieldKey, field);
  const ownSession = Boolean(before.sessionId && before.sessionApplicable && field.sessionOverridable !== false);
  const masked = PLUGIN_SETTING_SCOPES.indexOf(result.source as PluginSettingScope) > PLUGIN_SETTING_SCOPES.indexOf(scope);
  const dependency = field.presentation?.relatedChoice;
  const unanswered = settingHasUnansweredChoice(manifest, after, field);
  return <section className={styles.preview} aria-label={t("pluginMatrix.effectPreview")}>
    <h3>{t("pluginMatrix.effectPreview")}</h3>
    <dl className={styles.previewFacts}>
      <div><dt>{t("pluginMatrix.destination", { scope: names[scope] })}</dt><dd>{destination.saved
        ? <>{valueLabel(field, destination.value, t)} <small>{t("pluginMatrix.savedExplicitly")}</small></>
        : <>↳ {names[destination.source]} <small>{valueLabel(field, destination.value, t)}</small></>}</dd></div>
      <div><dt>{t(ownSession ? "pluginMatrix.sessionResult" : "pluginMatrix.repositoryResult")}</dt><dd>{valueLabel(field, result.value, t)}
        <small>{t("pluginMatrix.from", { source: names[result.source] })}</small></dd></div>
    </dl>
    {before.sessionId && !before.sessionApplicable && <p>{t("pluginMatrix.sessionPreviewUnavailable")}</p>}
    {masked && <p>{t("pluginMatrix.masked", { source: names[result.source] })}</p>}
    {unanswered && dependency && <p>{t("pluginMatrix.unansweredChoice", { field: fieldLabel(manifest.fields[dependency.field], t),
      value: valueLabel(manifest.fields[dependency.field], settingValueAtScope(after, dependency.field, manifest.fields[dependency.field]).value, t) })}</p>}
    {!masked && !unanswered && result.source === previous.source && settingValuesEqual(result.value, previous.value) && <p>{t("pluginMatrix.sameResult")}</p>}
  </section>;
}

function FieldEditor({ manifest, settings, busy, target, onSave, onClose }: {
  manifest: PluginManifest; settings: PluginSettings; busy: boolean; target: FieldTarget; onSave: Save; onClose: () => void;
}) {
  const { t } = useI18n();
  const alive = useAlive();
  const submitting = useRef(false);
  const field = manifest.fields[target.key];
  const current = settingCell(settings, target.key, field, target.scope);
  const [mode, setMode] = useState<"follow" | "custom">(current.saved && !target.cleanupOnly ? "custom" : "follow");
  const [draft, setDraft] = useState(() => field.kind === "checks" ? JSON.stringify(current.value, null, 2) : current.value === null ? "" : String(current.value));
  const [explicitNull, setExplicitNull] = useState(current.value === null);
  const [ignoredValue] = useState(() => target.cleanupOnly ? settingOverrides(settings, target.scope)[target.key] : null);
  const [error, setError] = useState("");
  const names = scopeNames(settings, t);
  const inherited = inheritedSettingValue(settings, target.key, field, target.scope);
  const parsed = parseSettingDraft(field, draft, explicitNull);
  const changed = target.cleanupOnly || (mode === "follow" ? current.saved
    : parsed.ok && (!current.saved || !settingValuesEqual(current.value, parsed.value)));
  const valid = mode === "follow" || parsed.ok;
  const set = mode === "custom" && parsed.ok ? { [target.key]: parsed.value } : {};
  const reset = mode === "follow" ? [target.key] : [];
  const next = previewPluginSettings(manifest, settings, target.scope, set, reset);
  const apply = async () => {
    if (busy || submitting.current || !changed || !valid) return;
    submitting.current = true; setError("");
    try {
      const result = await onSave(set, reset, target.scope);
      if (alive.current) { if (result.ok) onClose(); else setError(result.error); }
    } catch (error) { if (alive.current) setError(String(error)); }
    finally { submitting.current = false; }
  };
  return <EditorDialog title={fieldLabel(field, t)} subtitle={t("pluginMatrix.editing", { scope: names[target.scope] })} origin={target.origin}
    busy={busy} onClose={onClose} onSubmit={() => void apply()} action={<button type="submit" className={styles.primary} disabled={busy || !changed || !valid}>
      {t(busy ? "pluginMatrix.saving" : target.cleanupOnly ? "pluginMatrix.clearIgnored" : "pluginMatrix.save")}</button>}>
    {fieldDescription(field, t) && <p className={styles.description}>{fieldDescription(field, t)}</p>}
    {target.cleanupOnly ? <><p className={styles.notice}>{t("pluginMatrix.legacyExplanation")}</p>
      <p>{t("pluginMatrix.ignoredValue", { value: valueLabel(field, ignoredValue, t) })}</p></> : <>
      <fieldset className={styles.modes} disabled={busy}><legend>{t("pluginMatrix.valueMode")}</legend>
        <label><input type="radio" name="setting-mode" value="follow" checked={mode === "follow"} data-initial-focus={mode === "follow" ? "true" : undefined}
          onChange={() => setMode("follow")} /><span><strong>{t(target.scope === "global" ? "pluginMatrix.followBuiltin" : "pluginMatrix.followParent")}</strong>
          <small>↳ {names[inherited.source]} · {valueLabel(field, inherited.value, t)}</small></span></label>
        <label><input type="radio" name="setting-mode" value="custom" checked={mode === "custom"} data-initial-focus={mode === "custom" ? "true" : undefined}
          onChange={() => setMode("custom")} /><span><strong>{t("pluginMatrix.custom")}</strong><small>{t("pluginMatrix.customHint", { scope: names[target.scope] })}</small></span></label>
      </fieldset>
      <fieldset className={styles.valueEditor} disabled={busy || mode !== "custom"}><legend>{t("pluginMatrix.value")}</legend>
        {field.kind === "enum" || field.kind === "boolean" ? <select aria-label={t("pluginMatrix.value")} value={draft} onChange={(event) => setDraft(event.target.value)}>
          {(field.kind === "boolean" ? ["false", "true"] : field.options ?? []).map((value) => <option key={value} value={value}>
            {valueLabel(field, field.kind === "boolean" ? value === "true" : value, t)}</option>)}
        </select> : field.kind === "checks" ? <>
          <p className={styles.notice}>{t("pluginMatrix.checksHint")}</p>
          <textarea aria-label={t("pluginMatrix.checksJson")} rows={6} value={draft} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
          <button type="button" className={styles.secondary} onClick={() => setDraft("[]")}>{t("pluginMatrix.setNoChecks")}</button>
        </> : <>
          {field.nullable && <label className={styles.nullChoice}><input type="checkbox" checked={explicitNull} onChange={(event) => setExplicitNull(event.target.checked)} />
            {t("pluginMatrix.explicitNull", { value: valueLabel(field, null, t) })}</label>}
          <input aria-label={t("pluginMatrix.value")} value={draft} disabled={busy || mode !== "custom" || explicitNull}
            onChange={(event) => setDraft(event.target.value)} />
        </>}
      </fieldset>
      {mode === "custom" && parsed.ok && settingValuesEqual(parsed.value, inherited.value) && <p className={styles.pinNotice}>{t("pluginMatrix.pinNotice")}</p>}
      {mode === "custom" && !parsed.ok && <p role="alert" className={styles.error}>{t(`pluginMatrix.invalid_${parsed.error}`)}</p>}
    </>}
    {valid && <EffectPreview manifest={manifest} before={settings} after={next} fieldKey={target.key} scope={target.scope} />}
    {error && <p role="alert" className={styles.error}>{error} <span>{t("pluginMatrix.draftRetained")}</span></p>}
  </EditorDialog>;
}

function PresetEditor({ manifest, settings, busy, onSave, initialScope, origin, onClose }: {
  manifest: PluginManifest; settings: PluginSettings; busy: boolean; onSave: Save; initialScope: PluginSettingScope;
  origin: HTMLButtonElement; onClose: () => void;
}) {
  const { t } = useI18n();
  const alive = useAlive();
  const submitting = useRef(false);
  const [scope, setScope] = useState<PluginSettingScope>(() => initialScope === "global" ? "global"
    : initialScope === "session" && settings.sessionId && settings.sessionApplicable ? "session" : settings.project ? "project" : "global");
  const [preset, setPreset] = useState("");
  const [error, setError] = useState("");
  const names = scopeNames(settings, t);
  const recipe = preset ? manifest.presets?.[preset] : undefined;
  const available = (candidate: PluginSettingScope) => Boolean(recipe
    ? Object.keys(recipe.values).every((key) => settingScopeAvailable(settings, manifest.fields[key], candidate))
    : candidate === "global" || (candidate === "project" ? settings.project : settings.sessionId && settings.sessionApplicable));
  const next = recipe ? previewPluginSettings(manifest, settings, scope, recipe.values) : settings;
  const apply = async () => {
    if (busy || submitting.current || !recipe || !available(scope)) return;
    submitting.current = true; setError("");
    try {
      const result = await onSave(recipe.values, [], scope);
      if (alive.current) { if (result.ok) onClose(); else setError(result.error); }
    } catch (error) { if (alive.current) setError(String(error)); }
    finally { submitting.current = false; }
  };
  return <EditorDialog title={t("pluginMatrix.presets")} subtitle={t("pluginMatrix.presetHint")} {...{ origin, busy, onClose }} onSubmit={() => void apply()}
    action={<button type="submit" className={styles.primary} disabled={busy || !recipe || !available(scope)}>{t(busy ? "pluginMatrix.saving" : "pluginMatrix.applyPreset")}</button>}>
    <label className={styles.selectLabel}>{t("pluginMatrix.presetDestination")}<select aria-label={t("pluginMatrix.presetDestination")} data-initial-focus="true" value={scope} disabled={busy}
      onChange={(event) => setScope(event.target.value as PluginSettingScope)}>
      {PLUGIN_SETTING_SCOPES.map((candidate) => <option key={candidate} value={candidate} disabled={!available(candidate)}>{names[candidate]}</option>)}
    </select></label>
    <label className={styles.selectLabel}>{t("pluginMatrix.choosePreset")}<select aria-label={t("pluginMatrix.choosePreset")} value={preset} disabled={busy} onChange={(event) => setPreset(event.target.value)}>
      <option value="">{t("pluginMatrix.choosePresetPlaceholder")}</option>{Object.entries(manifest.presets ?? {}).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
    </select></label>
    <p className={styles.notice}>{t("pluginMatrix.presetBoundary")}</p>
    {recipe && <><p className={styles.pinNotice}>{t("pluginMatrix.presetExplicit", { scope: names[scope] })}</p>
      <div className={styles.presetPreview} aria-label={t("pluginMatrix.effectPreview")}>
        {Object.keys(recipe.values).map((key) => <div key={key}><h3>{fieldLabel(manifest.fields[key], t)}</h3>
          <EffectPreview manifest={manifest} before={settings} after={next} fieldKey={key} scope={scope} /></div>)}
      </div></>}
    {error && <p role="alert" className={styles.error}>{error} <span>{t("pluginMatrix.draftRetained")}</span></p>}
  </EditorDialog>;
}
