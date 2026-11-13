"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSettingsWork } from "./SettingsUi";
import { NO_NATIVE_RESOURCES, validateNativeResourceSelection, type NativeResourceSelection } from "@/lib/session-native-resources";
import type { McpConfigurationListing } from "@/lib/native-mcp-configuration";
import type { NativeMcpStatus } from "@/lib/native-session-tools";

interface Metadata {
  configuration: McpConfigurationListing;
  defaultSelection?: NativeResourceSelection;
  defaultError?: string;
  live?: { nativeResources: NativeResourceSelection; effectiveNativeResources: NativeResourceSelection; mcpServers: NativeMcpStatus[] };
}
interface Props {
  cwd: string; sessionId: string | null; selection?: NativeResourceSelection; busy: boolean; chatOnly: boolean;
  onApply(selection: NativeResourceSelection): Promise<NativeResourceSelection>;
  onManageDefaults?: () => void;
}
const key = (server: { scope: string; name: string }) => `${server.scope}:${server.name}`;
const checked = (value: unknown) => { try { return validateNativeResourceSelection(value); } catch { return NO_NATIVE_RESOURCES; } };

/** Current-chat intent only. Default editing belongs in Settings. */
export function SessionToolsControl({ cwd, sessionId, selection, busy, chatOnly, onApply, onManageDefaults }: Props) {
  const { t } = useI18n();
  const observe = useSettingsWork(), work = useRef(observe); work.current = observe;
  const dialog = useRef<HTMLDialogElement>(null), selectionRef = useRef(selection); selectionRef.current = selection;
  const [open, setOpen] = useState(false), [metadata, setMetadata] = useState<Metadata | null>(null);
  const [draft, setDraft] = useState<NativeResourceSelection>(NO_NATIVE_RESOURCES);
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false), [read, setRead] = useState(0);
  const reconcile = useRef(true), mounted = useRef(true), epoch = useRef(0), creating = useRef(false);
  const context = `${cwd}\0${sessionId ?? ""}`, currentContext = useRef(context);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  if (currentContext.current !== context) {
    // The current Apply may create this draft's first session. Its assigned ID
    // is an acknowledgement, not navigation. Any directory change or later ID
    // change still retires the old completion; the hook owns creation identity.
    const adopted = creating.current && currentContext.current === `${cwd}\0` && sessionId !== null;
    currentContext.current = context;
    if (!adopted) { epoch.current++; reconcile.current = true; }
  }
  const ready = loadedContext === context;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(); setLoading(true); setLoadedContext(null); setMetadata(null);
    const params = new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) });
    void work.current("native.metadata", fetch(`/api/native-tools?${params}`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("nativeTools.unavailable"));
      if (abort.signal.aborted) return;
      setMetadata(result); setLoadedContext(context);
      if (reconcile.current) {
        if (result.live) setDraft(checked(result.live.nativeResources));
        else setDraft(checked(selectionRef.current ?? (!sessionId ? result.defaultSelection : undefined)));
        reconcile.current = false; setError(result.defaultError ?? null); setUncertain(false);
      }
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : t("nativeTools.unavailable")); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); }));
    return () => abort.abort();
  }, [open, cwd, sessionId, read, t, context]);
  const rows = [...(metadata?.configuration.servers ?? [])];
  for (const server of draft.mcpServers) if (!rows.some(row => key(row) === key(server))) rows.push({ ...server,
    enabled: false, projectOverride: false, eligible: false, transport: "stdio" });
  const apply = () => work.current("native.apply", (async () => {
    if (pending || busy || loading || uncertain || !ready) return;
    const captured = epoch.current;
    creating.current = sessionId === null;
    reconcile.current = false; setPending(true); setError(null);
    try {
      const actual = await onApply(validateNativeResourceSelection(draft));
      if (!mounted.current || captured !== epoch.current) return;
      setDraft(actual); dialog.current?.close();
    } catch (reason) {
      if (mounted.current && captured === epoch.current) { setError(reason instanceof Error ? reason.message : t("nativeTools.unavailable")); setUncertain(true); }
    } finally { creating.current = false; if (mounted.current) setPending(false); }
  })());
  return <>
    <button type="button" aria-haspopup="dialog" onClick={() => {
      reconcile.current = true; setMetadata(null); setError(null); setUncertain(false);
      setDraft(checked(selection)); dialog.current?.showModal(); setOpen(true);
    }} style={{ height: 32, border: 0, borderRadius: 9, padding: "0 8px", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>{t("nativeTools.title")}</button>
    <dialog ref={dialog} aria-label={t("nativeTools.title")} onClose={() => setOpen(false)} className="backdrop:bg-black/40"
      style={{ width: "min(380px, calc(100vw - 32px))", maxHeight: "80vh", overflowY: "auto", margin: "auto", padding: 20,
        border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", color: "var(--text)" }}>
      <h2 className="text-base font-semibold">{t("nativeTools.title")}</h2>
      <p className="mb-3 text-xs text-text-muted">{t("nativeTools.thisChat")}</p>
      {chatOnly && <p className="mb-3 text-xs text-text-muted">{t("nativeTools.chatOnly")}</p>}
      {busy && <p role="status" className="mb-3 text-xs text-text-muted">{t("nativeTools.busy")}</p>}
      {loading && <p role="status" className="mb-3 text-xs">{t("nativeTools.loading")}</p>}
      {metadata && !metadata.configuration.ok && <p role="alert" className="mb-2 text-xs text-red-500">{t("nativeTools.invalidConfiguration")}</p>}
      <fieldset disabled={pending || loading || busy || !ready}>
        {metadata && rows.length === 0 && <p className="py-2 text-xs text-text-muted">{t("nativeTools.empty")}</p>}
        {rows.map(row => {
          const selected = draft.mcpServers.some(server => key(server) === key(row));
          const status = metadata?.live?.mcpServers.find(server => key(server) === key(row));
          const ambiguous = rows.filter(other => other.name.replace(/-/g, "_") === row.name.replace(/-/g, "_")).length > 1;
          return <div key={key(row)} className="py-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="break-words font-medium">{row.name}
                {ambiguous && <span className="ml-2 text-xs font-normal text-text-muted">{t(`nativeTools.scope_${row.scope}`)}</span>}
              </span>
              <input type="checkbox" checked={selected} disabled={!row.eligible && !selected} onChange={event => {
                const servers = draft.mcpServers.filter(server => server.name.replace(/-/g, "_") !== row.name.replace(/-/g, "_"));
                setDraft({ ...draft, mcpServers: event.target.checked ? [...servers, { scope: row.scope, name: row.name }] : servers });
              }} />
            </label>
            {(status || !row.eligible) && <span className="text-xs text-text-muted">{status ? t(`nativeTools.state_${status.state}`)
              : t(row.limitation ? `nativeTools.limitation_${row.limitation}` : "nativeTools.missing")}</span>}
          </div>;
        })}
        <label className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
          {t("nativeTools.codeMode")}<input type="checkbox" checked={draft.codeMode} onChange={event => setDraft({ ...draft, codeMode: event.target.checked })} />
        </label>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        {onManageDefaults && <button type="button" disabled={pending} onClick={() => { dialog.current?.close(); onManageDefaults(); }}>{t("nativeTools.manageDefaults")}</button>}
        <div className="ml-auto flex gap-3">
          <button type="button" disabled={pending || loading} onClick={() => { reconcile.current = true; setRead(value => value + 1); }}>{t("nativeTools.refresh")}</button>
          <button type="button" disabled={pending} onClick={() => dialog.current?.close()}>{t("nativeTools.cancel")}</button>
          <button type="button" disabled={pending || loading || busy || uncertain || !metadata || !ready} onClick={() => void apply()}>{t(pending ? "nativeTools.applying" : "nativeTools.apply")}</button>
        </div>
      </div>
    </dialog>
  </>;
}
