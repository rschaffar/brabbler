"use client";

import { useCallback, useEffect, useState } from "react";
import type { PluginManifest, PluginSettings, SettingValue } from "@/lib/plugins/types";
import { ConfigSidebarGroupLabel, ConfigSidebarItem, ConfigSidebarText, ConfigStatusDot } from "../SettingsUi";
interface Entry { manifest: PluginManifest; settings: PluginSettings }
async function load(cwd: string): Promise<Entry[]> {
  const response = await fetch(`/api/plugins/bundled?cwd=${encodeURIComponent(cwd)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.plugins;
}
export function BundledPluginSidebar({ cwd, selected, onSelect }: { cwd: string; selected: string | null; onSelect: (key: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => { void load(cwd).then((entries) => { if (active) { setEntries(entries); setError(""); } }, (error) => { if (active) setError(String(error)); }); };
    refresh();
    window.addEventListener("pi-web:bundled-plugin-settings", refresh);
    return () => { active = false; window.removeEventListener("pi-web:bundled-plugin-settings", refresh); };
  }, [cwd]);
  return <div className="config-sidebar-group">
    <ConfigSidebarGroupLabel>Bundled plugins</ConfigSidebarGroupLabel>
    {error && <p role="alert">{error}</p>}
    {entries.map(({ manifest, settings }) => <ConfigSidebarItem key={manifest.id} active={selected === `bundled:${manifest.id}`} onClick={() => onSelect(`bundled:${manifest.id}`)}>
      <ConfigStatusDot active={settings.enabled} /><ConfigSidebarText>{manifest.name}</ConfigSidebarText>
    </ConfigSidebarItem>)}
  </div>;
}
export function BundledPluginSettings({ cwd, id }: { cwd: string; id: string }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [scope, setScope] = useState<"global" | "project">("global");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => load(cwd).then((entries) => {
    const entry = entries.find((entry) => entry.manifest.id === id);
    if (!entry) throw new Error("Unknown plugin");
    setEntry(entry);
  }), [cwd, id]);
  useEffect(() => { void refresh().catch((error) => setError(String(error))); }, [refresh]);
  const save = async (key: string, value?: SettingValue) => {
    if (!entry) return;
    setBusy(true); setError("");
    const optimistic = structuredClone(entry.settings);
    const globalField = entry.manifest.fields[key].globalOnly || scope === "global";
    const values = globalField ? optimistic.global : optimistic.overrides;
    if (value === undefined) delete values[key]; else values[key] = value;
    const source = Object.hasOwn(optimistic.overrides, key) ? "project" : Object.hasOwn(optimistic.global, key) ? "global" : "builtin";
    optimistic.sources[key] = source;
    optimistic.effective[key] = source === "project" ? optimistic.overrides[key] : source === "global" ? optimistic.global[key] : entry.manifest.fields[key].default;
    optimistic.enabled = optimistic.effective.enabled === true;
    setEntry({ ...entry, settings: optimistic });
    try {
      const response = await fetch("/api/plugins/bundled", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId: id, cwd, scope: entry.manifest.fields[key].globalOnly ? "global" : scope,
          set: value === undefined ? {} : { [key]: value }, reset: value === undefined ? [key] : [] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEntry({ ...entry, settings: data.settings });
      window.dispatchEvent(new Event("pi-web:bundled-plugin-settings"));
    } catch (error) { setEntry(entry); setError(String(error)); } finally { setBusy(false); }
  };
  if (!entry) return <p role={error ? "alert" : "status"}>{error || "Loading bundled plugin settings…"}</p>;
  const { manifest, settings } = entry;
  return <section aria-label={`${manifest.name} settings`} className="min-w-0 space-y-4 p-3 text-sm text-text">
    <h2 className="text-lg font-semibold">{manifest.name}</h2>
    <p className="text-xs text-text-muted">Schema {manifest.schemaVersion}. Saved changes affect subsequent invocations immediately. Disabling cancels pending approvals; native writes already started settle normally.</p>
    <label>Settings scope <select aria-label="Plugin settings scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="rounded border border-border bg-bg p-2">
      <option value="global">Global defaults</option><option value="project" disabled={!settings.project}>Selected project overrides</option>
    </select></label>
    {scope === "project" && <p className="break-all text-xs text-text-muted">Repository identity: {settings.project}</p>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {Object.entries(manifest.fields).map(([key, field]) => {
      const values = scope === "global" || field.globalOnly ? settings.global : settings.overrides;
      const value = Object.hasOwn(values, key) ? values[key] : scope === "global" || field.globalOnly ? field.default : settings.effective[key];
      const effective = settings.effective[key];
      return <div key={key} className="space-y-1 border-t border-border pt-3">
        <label className="block font-medium" htmlFor={`plugin-${key}`}>{field.label}</label>
        {field.kind === "boolean" ? <input id={`plugin-${key}`} type="checkbox" checked={value === true} disabled={busy} onChange={(event) => void save(key, event.target.checked)} />
          : field.kind === "enum" ? <select id={`plugin-${key}`} value={String(value)} disabled={busy} onChange={(event) => void save(key, event.target.value)} className="rounded border border-border bg-bg p-2">{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
          : <SettingEditor key={`${id}:${scope}:${key}:${JSON.stringify(value)}`} id={`plugin-${key}`} checks={field.kind === "checks"} value={value} disabled={busy}
            onSave={(value) => void save(key, value)} nullable={field.nullable} />}
        <p className="break-all text-xs text-text-muted">Effective: {JSON.stringify(effective)} · Source: {settings.sources[key]}{field.globalOnly ? " · Global only" : ""}</p>
        {Object.hasOwn(values, key) && <button type="button" disabled={busy} className="text-xs underline" onClick={() => void save(key)}>{scope === "project" && !field.globalOnly ? "Use global default" : "Use built-in default"}</button>}
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
