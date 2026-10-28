"use client";

import { useSettingsWork } from "../SettingsUi";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationWork } from "@/lib/navigation-work";
import { useI18n } from "@/hooks/useI18n";
import { previewPluginSettings } from "@/lib/plugins/settings-view";
import { PluginSettingsMatrix, type PluginSettingsSaveResult } from "./PluginSettingsMatrix";
import type { Overrides, PluginManifest, PluginSettings, SettingValue } from "@/lib/plugins/types";
import { ConfigSidebarGroupLabel, ConfigSidebarItem, ConfigSidebarText, ConfigStatusDot } from "../SettingsUi";
interface Entry { manifest: PluginManifest; settings: PluginSettings }
type Scope = "global" | "project" | "session";
async function load(cwd: string, sessionId?: string | null): Promise<Entry[]> {
  const query = new URLSearchParams({ cwd });
  if (sessionId) query.set("sessionId", sessionId);
  const response = await fetch(`/api/plugins/bundled?${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.plugins;
}
export function BundledPluginSidebar({ cwd, sessionId, selected, onSelect }: { cwd: string; sessionId?: string | null; selected: string | null; onSelect: (key: string) => void }) {
  const observe = useSettingsWork();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true, generation = 0;
    const refresh = () => {
      const request = ++generation;
      void observe("plugins.bundledSidebar", load(cwd, sessionId).then((entries) => {
        if (active && request === generation) { setEntries(entries); setError(""); }
      }, (error) => { if (active && request === generation) setError(String(error)); }));
    };
    refresh();
    window.addEventListener("brabbler:bundled-plugin-settings", refresh);
    return () => { active = false; window.removeEventListener("brabbler:bundled-plugin-settings", refresh); };
  }, [cwd, sessionId, observe]);
  return <div className="config-sidebar-group">
    <ConfigSidebarGroupLabel>Bundled plugins</ConfigSidebarGroupLabel>
    {error && <p role="alert">{error}</p>}
    {entries.map(({ manifest, settings }) => <ConfigSidebarItem key={manifest.id} active={selected === `bundled:${manifest.id}`} onClick={() => onSelect(`bundled:${manifest.id}`)}>
      <ConfigStatusDot active={settings.enabled} /><ConfigSidebarText>{manifest.name}</ConfigSidebarText>
    </ConfigSidebarItem>)}
  </div>;
}
interface Props {
  cwd: string; id: string; sessionId?: string | null; initialScope?: Scope; initialField?: string;
  /** Passive observation of the original complete inner load/save promise. */
  onWork?: (work: Promise<unknown>) => void;
}
export function BundledPluginSettings(props: Props) {
  // A response or unsaved editor draft for one session must never enter another.
  return <Settings key={JSON.stringify([props.cwd, props.id, props.sessionId ?? null])} {...props} />;
}
function Settings({ cwd, id, sessionId, initialScope = "global", initialField, onWork }: Props) {
  const { t } = useI18n();
  const settingsWork = useSettingsWork();
  const navigationWork = useNavigationWork();
  const observers = useRef({ settingsWork, navigationWork, onWork });
  observers.current = { settingsWork, navigationWork, onWork };
  const observe = useCallback(<T,>(label: string, work: Promise<T>): Promise<T> => {
    const current = observers.current;
    current.settingsWork(label, work);
    // Explicit parent observation replaces the navigation fallback, not the
    // Settings observer. Both receive this same original complete promise.
    if (current.onWork) current.onWork(work);
    else current.navigationWork.observe(work);
    return work;
  }, []);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [preset, setPreset] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(false);
  const saving = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void observe("plugins.bundledSettings.load", load(cwd, sessionId).then((entries) => {
      const found = entries.find((entry) => entry.manifest.id === id);
      if (!found) throw new Error("Unknown plugin");
      if (active) setEntry(found);
    }).catch((error) => { if (active) setError(String(error)); }));
    return () => { active = false; };
  }, [cwd, id, sessionId, observe]);
  const focusedField = useRef<string | null>(null);
  useEffect(() => {
    if (!entry || entry.manifest.settingsLayout === "scope-matrix" || !initialField || focusedField.current === initialField) return;
    focusedField.current = initialField;
    const field = document.getElementById(`plugin-${initialField}`);
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "center" });
  }, [entry, initialField]);
  const save = (set: Overrides, reset: string[] = [], saveScope = scope): Promise<PluginSettingsSaveResult> => {
    // React state alone does not fence two events admitted before the next render.
    if (!entry || saving.current) return Promise.resolve({ ok: false, error: t("pluginMatrix.saveBusy") });
    saving.current = true;
    return observe("plugins.bundledSettings.save", (async (): Promise<PluginSettingsSaveResult> => {
      setBusy(true); setError("");
      setEntry({ ...entry, settings: previewPluginSettings(entry.manifest, entry.settings, saveScope, set, reset) });
      try {
        const response = await fetch("/api/plugins/bundled", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pluginId: id, cwd, sessionId, scope: saveScope, set, reset }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (live.current) setEntry({ ...entry, settings: data.settings });
        // A committed old-context write still deserves a fresh sidebar read;
        // its response and rollback must never enter a newly mounted context.
        window.dispatchEvent(new Event("brabbler:bundled-plugin-settings"));
        return { ok: true };
      } catch (error) {
        const message = String(error);
        if (live.current) { setEntry(entry); setError(message); }
        return { ok: false, error: message };
      } finally { saving.current = false; if (live.current) setBusy(false); }
    })());
  };
  if (!entry) return <p role={error ? "alert" : "status"}>{error || "Loading bundled plugin settings…"}</p>;
  const { manifest, settings } = entry;
  if (manifest.settingsLayout === "scope-matrix") return <PluginSettingsMatrix {...{ manifest, settings, busy, error, initialScope, initialField }} onSave={save} />;
  const ownProject = settings.sessionApplicable === true;
  const unavailable = (scope === "session" && !ownProject) || (scope === "project" && !settings.project);
  return <section aria-label={`${manifest.name} settings`} className="min-w-0 space-y-4 p-3 text-sm text-text">
    <h2 className="text-lg font-semibold">{manifest.name}</h2>
    <p className="text-xs text-text-muted">Saved changes affect subsequent invocations immediately. Disabling cancels pending approvals; native writes already started settle normally.</p>
    <label>Settings scope <select aria-label="Plugin settings scope" value={scope} disabled={busy} onChange={(event) => { setScope(event.target.value as Scope); setPreset(""); }} className="rounded border border-border bg-bg p-2">
      <option value="global">Global defaults</option><option value="project" disabled={!settings.project}>Selected project overrides</option>
      <option value="session" disabled={!ownProject}>This session</option>
    </select></label>
    {scope !== "global" && <p className="break-all text-xs text-text-muted">Repository identity: {settings.project}</p>}
    {sessionId && <p className="text-xs text-text-muted">Session overrides apply only to this session’s own project, including its linked worktrees. Operations in another project use that project’s settings instead.</p>}
    {manifest.presets && <div className="space-y-2 rounded border border-border p-3">
      <label className="block">Workflow preset <select aria-label="Workflow preset" value={preset} disabled={busy || unavailable} onChange={(event) => setPreset(event.target.value)} className="ml-2 rounded border border-border bg-bg p-2">
        <option value="">Choose a preset…</option>{Object.entries(manifest.presets).map(([key, recipe]) => <option key={key} value={key}>{recipe.label}</option>)}
      </select></label>
      <p className="text-xs text-text-muted">Presets replace workflow choices in the selected scope only. They do not grant commit/merge permissions or change checks. Ask always means ask_user for each applicable choice; answers are not remembered automatically.</p>
      {preset && <p className="text-xs text-text-muted">Values: {Object.entries(manifest.presets[preset].values).map(([key, value]) => `${manifest.fields[key].label}: ${String(value)}`).join(" · ")}</p>}
      <button type="button" disabled={!preset || busy || unavailable} className="rounded border border-border px-3 py-1" onClick={() => void save(manifest.presets![preset].values)}>Apply workflow preset</button>
    </div>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {Object.entries(manifest.fields).map(([key, field]) => {
      const fieldScope = field.globalOnly ? "global" : scope;
      const values = fieldScope === "global" ? settings.global : fieldScope === "session" ? settings.sessionOverrides ?? {} : settings.overrides;
      // The editor displays this layer, not a narrower session value masking it.
      const inherited = Object.hasOwn(settings.global, key) ? settings.global[key] : field.default;
      const projectValue = Object.hasOwn(settings.overrides, key) ? settings.overrides[key] : inherited;
      const value = Object.hasOwn(values, key) ? values[key] : fieldScope === "global" ? field.default : fieldScope === "project" ? inherited : projectValue;
      const disabled = busy || (!field.globalOnly && unavailable);
      const saveField = (value?: SettingValue) => void save(value === undefined ? {} : { [key]: value }, value === undefined ? [key] : [], fieldScope);
      return <div key={key} className="space-y-1 border-t border-border pt-3">
        {field.group && <p className="text-xs text-text-muted">{field.group}</p>}
        <label className="block font-medium" htmlFor={`plugin-${key}`}>{field.label}</label>
        {field.description && <p className="text-xs text-text-muted">{field.description}</p>}
        {field.kind === "boolean" ? <input id={`plugin-${key}`} type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => saveField(event.target.checked)} />
          : field.kind === "enum" ? <select id={`plugin-${key}`} value={String(value)} disabled={disabled} onChange={(event) => saveField(event.target.value)} className="rounded border border-border bg-bg p-2">{field.options?.map((option) => <option key={option} value={option}>{field.presentation?.optionLabelKeys?.[option] ? t(field.presentation.optionLabelKeys[option]) : option}</option>)}</select>
          : <SettingEditor key={`${id}:${scope}:${key}:${JSON.stringify(value)}`} id={`plugin-${key}`} checks={field.kind === "checks"} value={value} disabled={disabled}
            onSave={saveField} nullable={field.nullable} />}
        <p className="break-all text-xs text-text-muted">Effective: {JSON.stringify(settings.effective[key])} · Source: {settings.sources[key]}{field.globalOnly ? " · Global only" : ""}</p>
        {Object.hasOwn(values, key) && <button type="button" disabled={disabled} className="text-xs underline" onClick={() => saveField()}>{fieldScope === "session" ? "Use project default" : fieldScope === "project" ? "Use global default" : "Use built-in default"}</button>}
      </div>;
    })}
  </section>;
}
function SettingEditor({ id, checks, value, disabled, nullable, onSave }: {
  id: string; checks: boolean; value: SettingValue; disabled: boolean; nullable?: boolean; onSave: (value: SettingValue) => void;
}) {
  const initial = checks ? JSON.stringify(value, null, 2) : value === null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  return <div>
    {checks ? <><p className="text-xs text-text-muted">JSON array of named shell checks: {`[{"name":"Tests","command":"npm test"}]`}. Empty [] runs none. Commands execute locally and may have side effects.</p><textarea id={id} rows={5} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled} className="w-full rounded border border-border bg-bg p-2 font-mono text-xs" /></>
      : <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled} className="w-full rounded border border-border bg-bg p-2" />}
    <button type="button" disabled={disabled || draft === initial} className="mt-1 rounded border border-border px-3 py-1" onClick={() => {
      try { onSave(checks ? JSON.parse(draft) : nullable && draft === "" ? null : draft); setError(""); }
      catch { setError("Enter a valid JSON array of named checks"); }
    }}>Save field</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
