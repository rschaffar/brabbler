"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { EMPTY_NATIVE_PREFERENCES, nativeCodeModeChoice, nativeDefaultChoice, nativeServerNamespace,
  validateNativePreferences, resolveNativeDefaults, NativeResourceDefaultsLimitError, type NativeDefaultChange } from "@/lib/native-resource-defaults";
import { validateNativeResourceSelection, type NativeResourceSelection } from "@/lib/session-native-resources";
import type { GlobalNativeResources, ProjectNativeResources } from "@/lib/project-native-resources";
import type { ConfiguredMcpServer, McpConfigurationListing } from "@/lib/native-mcp-configuration";
import { ConfigButton, ConfigSwitch, useSettingsWork } from "./SettingsUi";

interface Metadata {
  configuration: McpConfigurationListing;
  globalDefault: GlobalNativeResources;
  projectDefault?: ProjectNativeResources;
  defaultSelection?: NativeResourceSelection;
  defaultError?: string;
}

/** Defaults only: no session ID, connection or wrapper mutation. Each write owns
 * its complete acknowledgement; uncertain writes require an explicit refresh. */
export function McpSettings({ cwd, codeModeOnly = false }: { cwd: string | null; codeModeOnly?: boolean }) {
  const { t } = useI18n(), observe = useSettingsWork();
  const work = useRef(observe); work.current = observe;
  const [scope, setScope] = useState<"global" | "project">("global");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false), [read, setRead] = useState(0);
  const mounted = useRef(true), epoch = useRef(0);
  const context = `${scope}\0${cwd ?? ""}`, lastContext = useRef(context);
  if (lastContext.current !== context) { lastContext.current = context; epoch.current++; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setMetadata(null); setError(null); setSaved(false);
    const params = new URLSearchParams(scope === "global" ? { scope: "global" } : { cwd: cwd ?? "" });
    void work.current("native.defaults.read", (async () => {
      try {
        const response = await fetch(`/api/native-tools?${params}`, { cache: "no-store", signal: abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? t("nativeTools.unavailable"));
        if (abort.signal.aborted) return;
        setMetadata(result); setUncertain(false);
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t("nativeTools.unavailable")); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })());
    return () => abort.abort();
  }, [cwd, scope, read, t]);

  const global = metadata?.globalDefault;
  const target = scope === "global" ? global : metadata?.projectDefault;
  const preferences = target?.preferences ?? EMPTY_NATIVE_PREFERENCES;
  const disabled = loading || saving || uncertain || !target?.revision || scope === "project" && !metadata?.projectDefault?.supported;
  const save = (requested: NativeDefaultChange) => work.current("native.defaults.save", (async () => {
    if (disabled || !target?.revision) return;
    const captured = epoch.current;
    setSaving(true); setSaved(false); setError(null);
    try {
      const response = await fetch("/api/native-tools", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, ...(scope === "project" ? { cwd } : {}), revision: target.revision, change: requested }) });
      const result = await response.json();
      const returned = (scope === "global" ? result.globalDefault : result.projectDefault) as typeof target;
      if (!response.ok || !returned || !/^[a-f0-9]{64}$/.test(returned.revision ?? "")
        || scope === "project" && (!("projectRoot" in returned) || !returned.supported || returned.projectRoot !== metadata?.projectDefault?.projectRoot)) throw new Error(result.error ?? t("nativeTools.defaultUnavailable"));
      const actual = validateNativePreferences(returned.preferences, scope === "global");
      if ("codeMode" in requested ? actual.codeMode !== requested.codeMode : !actual.servers.some(row =>
        row.scope === requested.server.scope && row.name === requested.server.name && row.value === requested.value)) throw new Error(t("nativeTools.defaultUnavailable"));
      const globalState = scope === "global" ? { ...returned, preferences: actual } : metadata!.globalDefault;
      const projectState = scope === "project" ? { ...returned, preferences: actual } : metadata?.projectDefault;
      let defaultSelection: NativeResourceSelection | undefined, defaultError: string | undefined;
      if (typeof result.defaultError === "string") defaultError = result.defaultError;
      else if (Object.hasOwn(result, "defaultSelection")) defaultSelection = validateNativeResourceSelection(result.defaultSelection);
      else {
        try { defaultSelection = resolveNativeDefaults(globalState.selection, globalState.preferences,
          projectState?.selection ?? null, projectState?.preferences ?? EMPTY_NATIVE_PREFERENCES); }
        catch (cause) { if (cause instanceof NativeResourceDefaultsLimitError) defaultError = cause.message; else throw cause; }
      }
      if (!mounted.current || captured !== epoch.current) return;
      setMetadata(value => value ? { ...value, defaultSelection, defaultError,
        [scope === "global" ? "globalDefault" : "projectDefault"]: { ...returned, preferences: actual } } : value);
      setSaved(true);
    } catch (cause) {
      if (mounted.current && captured === epoch.current) { setError(cause instanceof Error ? cause.message : t("nativeTools.defaultUnavailable")); setUncertain(true); }
    } finally { if (mounted.current) setSaving(false); }
  })());

  const rowKey = (server: { scope: string; name: string }) => `${server.scope}:${server.name}`;
  const rows = new Map<string, ConfiguredMcpServer>((metadata?.configuration.servers ?? []).map(server => [rowKey(server), server]));
  for (const server of [...(global?.selection?.mcpServers ?? []), ...(global?.preferences?.servers ?? []),
    ...(target?.selection?.mcpServers ?? []), ...preferences.servers]) {
    if (!rows.has(rowKey(server))) rows.set(rowKey(server), { scope: server.scope, name: server.name,
      transport: "stdio", enabled: false, projectOverride: false, eligible: false });
  }
  const projectLabel = metadata?.projectDefault?.projectRoot ?? cwd;
  const selector = (label: string, choice: boolean | null, inherited: boolean, unavailable: boolean, onChange: (value: boolean | null) => void) => scope === "global"
    ? <ConfigSwitch label={label} checked={choice === true} disabled={disabled || unavailable && choice !== true} loading={saving} onChange={onChange} />
    : <select aria-label={label} value={choice === null ? "inherit" : choice ? "on" : "off"} disabled={disabled}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm" onChange={event => onChange(event.target.value === "inherit" ? null : event.target.value === "on")}>
        <option value="inherit">{t(inherited ? "mcpSettings.inheritOn" : "mcpSettings.inheritOff")}</option>
        <option value="on" disabled={unavailable}>{t("mcpSettings.on")}</option><option value="off">{t("mcpSettings.off")}</option>
      </select>;
  return <section className={codeModeOnly ? "settings-general-section" : "p-5"} aria-label={t(codeModeOnly ? "nativeTools.codeMode" : "mcpSettings.title")}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {!codeModeOnly && <h3 className="text-sm font-semibold">{t("mcpSettings.title")}</h3>}
      <div className="flex gap-1" role="group" aria-label={t("mcpSettings.scope")}>
        <ConfigButton size="small" variant={scope === "global" ? "primary" : "secondary"} aria-pressed={scope === "global"} disabled={saving} onClick={() => setScope("global")}>{t("nativeTools.scope_global")}</ConfigButton>
        <ConfigButton size="small" variant={scope === "project" ? "primary" : "secondary"} className="max-w-64 truncate" title={projectLabel ?? undefined} aria-pressed={scope === "project"} disabled={!cwd || saving}
          onClick={() => setScope("project")}>{t("mcpSettings.project", { project: projectLabel?.split(/[\\/]/).filter(Boolean).at(-1) ?? "—" })}</ConfigButton>
      </div>
    </div>
    {loading ? <p role="status" className="text-sm text-text-muted">{t("nativeTools.loading")}</p>
      : scope === "project" && !metadata?.projectDefault?.supported ? <p className="text-sm text-text-muted">{t("nativeTools.defaultUnsupported")}</p>
      : codeModeOnly ? <div className="flex items-center justify-between gap-4 py-2">
        <span className="text-sm">{t("mcpSettings.codeModeDefault")}</span>
        {selector(t("mcpSettings.codeModeDefault"), nativeCodeModeChoice(target?.selection ?? null, preferences),
          nativeCodeModeChoice(global?.selection ?? null, global?.preferences ?? EMPTY_NATIVE_PREFERENCES) === true, false, value => void save({ codeMode: value }))}
      </div> : <>
        {metadata && !metadata.configuration.ok && <p role="alert" className="mb-2 text-sm text-red-500">{t("nativeTools.invalidConfiguration")}</p>}
        {!rows.size && <p className="text-sm text-text-muted">{t("nativeTools.empty")}</p>}
        {metadata?.defaultError && <p role="alert" className="mb-2 text-sm text-red-500">{metadata.defaultError}</p>}
        {[...rows.values()].sort((a, b) => a.name.localeCompare(b.name)).map(server => {
          const ambiguous = [...rows.values()].filter(other => nativeServerNamespace(other) === nativeServerNamespace(server)).length > 1;
          const label = ambiguous ? `${server.name} (${t(`nativeTools.scope_${server.scope}`)})` : server.name;
          return <div key={rowKey(server)} className="flex items-start justify-between gap-4 border-b border-border py-3">
          <details className="min-w-0 text-sm"><summary className="cursor-pointer break-words">{server.name}
            {(ambiguous || !server.eligible) && <span className="ml-2 text-xs text-text-muted">{t(`nativeTools.scope_${server.scope}`)}{!server.eligible && ` · ${t("nativeTools.state_unavailable")}`}</span>}
          </summary>
            <p className="mt-2 text-xs text-text-muted">{t(`nativeTools.scope_${server.scope}`)} · {server.transport}</p>
            {!server.eligible && <p className="mt-1 text-xs text-text-muted">{t(server.limitation ? `nativeTools.limitation_${server.limitation}` : "nativeTools.missing")}</p>}
          </details>
          {selector(label, nativeDefaultChoice(target?.selection ?? null, preferences, server),
            nativeDefaultChoice(global?.selection ?? null, global?.preferences ?? EMPTY_NATIVE_PREFERENCES, server) === true, !server.eligible,
            value => void save({ server: { scope: server.scope, name: server.name }, value }))}
        </div>; })}
      </>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
      <span>{t("mcpSettings.newChats")}</span>
      {saving ? <span role="status">{t("mcpSettings.saving")}</span> : saved ? <span role="status">{t("mcpSettings.saved")}</span> : null}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    {(error || uncertain || metadata?.defaultError) && <button type="button" className="config-button mt-2" disabled={saving || loading} onClick={() => setRead(value => value + 1)}>{t("nativeTools.refresh")}</button>}
  </section>;
}

/** Keep the less common Code-mode default outside the MCP server list. */
export function CodeModeDefaults({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <section className="settings-general-section">
    <button type="button" className="settings-general-heading" aria-expanded={open} onClick={() => setOpen(value => !value)}><span aria-hidden="true">{open ? "▾ " : "▸ "}</span>{t("nativeTools.codeMode")}</button>
    {open && <McpSettings key={cwd ?? "global"} cwd={cwd} codeModeOnly />}
  </section>;
}
