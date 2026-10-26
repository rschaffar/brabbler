"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSettingsWork } from "./SettingsUi";
import { NO_NATIVE_RESOURCES, validateNativeResourceSelection, type NativeResourceSelection } from "@/lib/session-native-resources";
import type { McpConfigurationListing } from "@/lib/native-mcp-configuration";
import type { NativeMcpStatus } from "@/lib/native-session-tools";
import type { ProjectNativeResources } from "@/lib/project-native-resources";

interface Metadata {
  configuration: McpConfigurationListing;
  projectDefault?: ProjectNativeResources;
  live?: { nativeResources: NativeResourceSelection; effectiveNativeResources: NativeResourceSelection; mcpServers: NativeMcpStatus[] };
}
interface Props {
  cwd: string; sessionId: string | null; selection?: NativeResourceSelection; busy: boolean; chatOnly: boolean;
  onApply(selection: NativeResourceSelection): Promise<NativeResourceSelection>;
}
const key = (server: { scope: string; name: string }) => `${server.scope}:${server.name}`;
const checked = (value: unknown) => { try { return validateNativeResourceSelection(value); } catch { return NO_NATIVE_RESOURCES; } };

/** Native modal owns focus/viewport placement. Opening it reads metadata only;
 * only Apply may initialize/recreate this selected ordinary session. */
export function SessionToolsControl({ cwd, sessionId, selection, busy, chatOnly, onApply }: Props) {
  const { t } = useI18n();
  const observe = useSettingsWork();
  const work = useRef(observe);
  work.current = observe;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [metadata, setMetadata] = useState<Metadata | null>(null);
  const [draft, setDraft] = useState<NativeResourceSelection>(NO_NATIVE_RESOURCES);
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false), [defaultUncertain, setDefaultUncertain] = useState(false);
  const [defaultNotice, setDefaultNotice] = useState<string | null>(null);
  const [read, setRead] = useState(0);
  const context = `${cwd}\0${sessionId ?? ""}`, currentContext = useRef(context);
  currentContext.current = context;
  const reconcile = useRef(true), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) });
    void work.current("native.metadata", fetch(`/api/native-tools?${params}`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("nativeTools.unavailable"));
      if (abort.signal.aborted) return;
      setMetadata(result as Metadata);
      if (reconcile.current) {
        if (result.live) setDraft(checked(result.live.nativeResources));
        else if (!sessionId) setDraft(checked(result.projectDefault?.selection ?? NO_NATIVE_RESOURCES));
        reconcile.current = false; setError(null); setUncertain(false); setDefaultUncertain(false);
      }
    }).catch(reason => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : t("nativeTools.unavailable"));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); }));
    return () => abort.abort();
  }, [open, cwd, sessionId, read, t]);

  const rows = [...(metadata?.configuration.servers ?? [])];
  for (const server of draft.mcpServers) if (!rows.some(row => key(row) === key(server))) rows.push({ ...server,
    enabled: false, projectOverride: false, eligible: false, transport: "stdio", limitation: "disabled" });
  const apply = () => work.current("native.apply", (async () => {
    if (pending || savingDefault || busy || loading || uncertain) return;
    reconcile.current = false;
    setPending(true); setError(null);
    try {
      const actual = await onApply(validateNativeResourceSelection(draft));
      if (!mounted.current) return;
      setDraft(actual); dialog.current?.close();
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof Error ? reason.message : t("nativeTools.unavailable")); setUncertain(true);
    } finally { if (mounted.current) setPending(false); }
  })());
  const saveDefault = (selection: NativeResourceSelection | null) => work.current("native.default", (async () => {
    const project = metadata?.projectDefault;
    if (!project?.supported || !project.revision || pending || savingDefault || loading || defaultUncertain) return;
    const capturedContext = context;
    setSavingDefault(true); setDefaultNotice(null); setError(null);
    try {
      const response = await fetch("/api/native-tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, revision: project.revision, nativeResources: selection }),
      });
      const result = await response.json();
      const returned = result.projectDefault as ProjectNativeResources | undefined;
      if (!response.ok || !returned?.supported || returned.projectRoot !== project.projectRoot
        || typeof returned.revision !== "string" || !/^[a-f0-9]{64}$/.test(returned.revision)) {
        throw new Error(result.error ?? t("nativeTools.defaultUnavailable"));
      }
      const actual = { ...returned, selection: returned.selection === null ? null : validateNativeResourceSelection(returned.selection) };
      if (JSON.stringify(actual.selection) !== JSON.stringify(selection)) throw new Error(result.error ?? t("nativeTools.defaultUnavailable"));
      if (!mounted.current || currentContext.current !== capturedContext) return;
      setMetadata(value => value ? { ...value, projectDefault: actual } : value);
      setDefaultNotice(t(selection === null ? "nativeTools.defaultCleared" : "nativeTools.defaultSaved"));
    } catch (failure) {
      if (mounted.current && currentContext.current === capturedContext) {
        setError(failure instanceof Error ? failure.message : t("nativeTools.defaultUnavailable"));
        setDefaultUncertain(true);
      }
    } finally {
      if (mounted.current) setSavingDefault(false);
    }
  })());
  return <>
    <button type="button" aria-haspopup="dialog" onClick={() => {
      reconcile.current = true; setMetadata(null); setError(null); setUncertain(false); setDefaultUncertain(false); setDefaultNotice(null);
      setDraft(checked(selection)); dialog.current?.showModal(); setOpen(true);
    }} style={{ height: 32, border: 0, borderRadius: 9, padding: "0 8px", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
      {t("nativeTools.title")}
    </button>
    <dialog ref={dialog} aria-label={t("nativeTools.title")} onClose={() => setOpen(false)}
      className="backdrop:bg-black/40" style={{ width: "min(420px, calc(100vw - 32px))", maxHeight: "80vh", overflowY: "auto", margin: "auto", padding: 20,
        border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", color: "var(--text)" }}>
      <h2 className="mb-2 text-base font-semibold">{t("nativeTools.title")}</h2>
      <p className="mb-3 text-xs text-text-muted">{t("nativeTools.scope")}</p>
      {chatOnly && <p className="mb-3 text-xs text-text-muted">{t("nativeTools.chatOnly")}</p>}
      {busy && <p role="status" className="mb-3 text-xs text-text-muted">{t("nativeTools.busy")}</p>}
      {loading && <p role="status" className="mb-3 text-xs">{t("nativeTools.loading")}</p>}
      <fieldset disabled={pending || savingDefault || loading || busy}>
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" checked={draft.codeMode} onChange={event => setDraft({ ...draft, codeMode: event.target.checked })} />
          {t("nativeTools.codeMode")}
        </label>
        <p className="mb-3 text-xs text-text-muted">{t("nativeTools.toolsOnly")}</p>
        <h3 className="mb-1 text-sm font-medium">{t("nativeTools.servers")}</h3>
        {metadata && !metadata.configuration.ok && <p role="alert" className="mb-2 text-xs text-red-500">{t("nativeTools.invalidConfiguration")}</p>}
        {metadata && rows.length === 0 && <p className="py-2 text-xs text-text-muted">{t("nativeTools.empty")}</p>}
        {rows.map(row => {
          const selected = draft.mcpServers.some(server => key(server) === key(row));
          const status = metadata?.live?.mcpServers.find(server => key(server) === key(row));
          return <label key={key(row)} className="flex items-start gap-2 py-2 text-sm">
            <input className="mt-1" type="checkbox" checked={selected} disabled={!row.eligible && !selected} onChange={event => {
              const servers = draft.mcpServers.filter(server => server.name.replace(/-/g, "_") !== row.name.replace(/-/g, "_"));
              setDraft({ ...draft, mcpServers: event.target.checked ? [...servers, { scope: row.scope, name: row.name }] : servers });
            }} />
            <span><span className="font-medium">{row.name}</span>
              <span className="block text-xs text-text-muted">{t(`nativeTools.scope_${row.scope}`)} · {row.transport}
                {status ? ` · ${t(`nativeTools.state_${status.state}`)}` : ` · ${t("nativeTools.configured")}`}
                {status?.tools !== undefined && ` · ${t("nativeTools.toolCount", { count: status.tools })}`}
              </span>
              {!metadata?.configuration.servers.some(server => key(server) === key(row))
                ? <span className="block text-xs text-text-muted">{t("nativeTools.missing")}</span>
                : row.limitation && <span className="block text-xs text-text-muted">{t(`nativeTools.limitation_${row.limitation}`)}</span>}
            </span>
          </label>;
        })}
      </fieldset>
      <section className="mt-3 border-t border-border pt-3" aria-label={t("nativeTools.projectDefault")}>
        <h3 className="text-sm font-medium">{t("nativeTools.projectDefault")}</h3>
        {metadata?.projectDefault?.supported ? <>
          <p className="mt-1 break-words text-xs text-text-muted">{t("nativeTools.defaultScope", { project: metadata.projectDefault.projectRoot ?? cwd })}</p>
          <p className="mt-2 break-words text-xs text-text-muted">{metadata.projectDefault.selection
            ? t("nativeTools.defaultSummary", {
              servers: metadata.projectDefault.selection.mcpServers.map(server => `${server.scope}:${server.name}`).join(", ") || t("nativeTools.noServers"),
              codeMode: t(metadata.projectDefault.selection.codeMode ? "nativeTools.on" : "nativeTools.off"),
            }) : t("nativeTools.noDefault")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <button type="button" disabled={pending || savingDefault || loading || defaultUncertain} onClick={() => void saveDefault(validateNativeResourceSelection(draft))}>
              {t(savingDefault ? "nativeTools.savingDefault" : "nativeTools.saveDefault")}
            </button>
            <button type="button" disabled={pending || savingDefault || loading || defaultUncertain || !metadata.projectDefault.selection} onClick={() => void saveDefault(null)}>
              {t("nativeTools.clearDefault")}
            </button>
          </div>
        </> : metadata && <p className="mt-1 text-xs text-text-muted">{t("nativeTools.defaultUnsupported")}</p>}
        {defaultNotice && <p role="status" className="mt-2 text-xs text-text-muted">{defaultNotice}</p>}
        {defaultUncertain && <p className="mt-2 text-xs text-text-muted">{t("nativeTools.defaultReconcile")}</p>}
      </section>
      <p className="mt-3 text-xs text-text-muted">{t("nativeTools.configurationHelp")}</p>
      {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}
      {uncertain && <p className="mt-2 text-xs text-text-muted">{t("nativeTools.reconcile")}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-3 text-sm">
        <button type="button" disabled={pending || savingDefault || loading} onClick={() => { if (uncertain || defaultUncertain) { reconcile.current = true; setDraft(checked(selection)); } setError(null); setRead(value => value + 1); }}>{t("nativeTools.refresh")}</button>
        <button type="button" disabled={pending || savingDefault} onClick={() => dialog.current?.close()}>{t("nativeTools.cancel")}</button>
        <button type="button" disabled={pending || savingDefault || loading || busy || uncertain || !metadata} onClick={() => { void apply(); }}>{t(pending ? "nativeTools.applying" : "nativeTools.apply")}</button>
      </div>
    </dialog>
  </>;
}
