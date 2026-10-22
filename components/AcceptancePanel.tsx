"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { acceptanceTerminal, nixAcceptanceProfile, type AcceptanceView } from "@/lib/acceptance/types";

export function AcceptancePanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<AcceptanceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configuration, setConfiguration] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const alive = useRef(true), mutation = useRef(false), keys = useRef(new Map<string, string>());
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++refreshGeneration.current;
    const response = await fetch(`/api/acceptance?cwd=${encodeURIComponent(cwd)}`, { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (alive.current && generation === refreshGeneration.current) {
      setView(data); setConfiguration((old) => old ?? JSON.stringify(data.profiles, null, 2));
    }
  }, [cwd]);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const surface = dialog.current;
    surface?.showModal();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { if (!document.hidden && !mutation.current) await refresh(controller.signal); }
      catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { alive.current = false; controller.abort(); clearTimeout(timer); surface?.close(); previous?.focus(); };
  }, [refresh]);
  useEffect(() => {
    setLog("");
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const response = await fetch(`/api/acceptance?cwd=${encodeURIComponent(cwd)}&runId=${encodeURIComponent(selected)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setLog(data.log);
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(read, 2000);
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [cwd, selected]);
  async function act(payload: Record<string, unknown>) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(null); refreshGeneration.current++;
    try {
      const response = await fetch("/api/acceptance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, ...payload }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!alive.current) return;
      if (payload.action === "run") {
        keys.current.delete(String(payload.profile) + ":" + String(payload.profileDigest));
        setSelected(data.run.id);
      }
      if (payload.action === "configure") setConfiguration(null);
      setRecovery(false); await refresh();
    } catch (cause) { if (alive.current) setError(String(cause)); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  }
  const buttonStyle = { minHeight: 36, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6 };
  return createPortal(<dialog ref={dialog} aria-labelledby="acceptance-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
    style={{ width: 850, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)", overflow: "auto", padding: 18, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", color: "var(--text)", boxSizing: "border-box" }}>
    <header style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
      <h2 id="acceptance-title" style={{ fontSize: 17 }}>{t("acceptance.title")}</h2>
      <button autoFocus type="button" style={buttonStyle} onClick={onClose} aria-label={t("acceptance.close")}>{t("acceptance.close")}</button>
    </header>
    <code style={{ display: "block", overflowWrap: "anywhere", fontSize: 12 }}>{cwd}</code>
    <p style={{ fontSize: 12 }}>{t("acceptance.description")}</p>
    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("acceptance.boundary")}</p>
    {error && <p role="alert" style={{ color: "#ef4444", overflowWrap: "anywhere" }}>{error}</p>}
    {view?.blocked && <section style={{ border: "1px solid var(--border)", padding: 10 }}>
      <p role="status">{view.blocked}</p>
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={recovery} onChange={(e) => setRecovery(e.target.checked)} />{t("acceptance.recoveryAcknowledgment")}</label>
      <button type="button" style={buttonStyle} disabled={busy || !recovery} onClick={() => void act({ action: "recover", resourcesStopped: true })}>{t("acceptance.recover")}</button>
    </section>}
    {view && !view.enabled && <p role="status">{t("acceptance.disabled")}</p>}
    <h3>{t("acceptance.profiles")}</h3>
    {!view && <p role="status">{t("acceptance.loading")}</p>}
    {view?.profiles.length === 0 && <p>{t("acceptance.empty")}</p>}
    {view?.profiles.map((profile) => <section key={profile.name} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <strong>{profile.label}</strong> <span>{t(`acceptance.coverage_${profile.coverage}`)}</span>
      <code style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{JSON.stringify(profile.argv)}</code>
      <small>{t("acceptance.budget", { cpus: profile.cpus, memory: profile.memoryMiB })}</small>
      <button type="button" style={{ ...buttonStyle, display: "block", marginTop: 8 }} disabled={busy || !view.enabled || !!view.blocked || profile.permission === "deny"} onClick={() => {
        const profileDigest = view.profileDigests[profile.name], key = profile.name + ":" + profileDigest;
        let requestId = keys.current.get(key);
        if (!requestId) { requestId = crypto.randomUUID(); keys.current.set(key, requestId); }
        void act({ action: "run", profile: profile.name, profileDigest, requestId });
      }}>{t("acceptance.run", { name: profile.name })}</button>
    </section>)}
    <details style={{ marginTop: 12 }}><summary>{t("acceptance.configure")}</summary>
      <p style={{ fontSize: 12 }}>{t("acceptance.configurationHelp")}</p>
      <label style={{ display: "block" }}>{t("acceptance.configurationJson")}<textarea aria-label={t("acceptance.configurationJson")} value={configuration ?? "[]"} disabled={busy || !view} onChange={(event) => setConfiguration(event.target.value)} spellCheck={false}
        style={{ display: "block", width: "100%", minHeight: 240, boxSizing: "border-box", fontFamily: "monospace", fontSize: 11, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)" }} /></label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" style={buttonStyle} disabled={busy || !view} onClick={() => setConfiguration(JSON.stringify([nixAcceptanceProfile], null, 2))}>{t("acceptance.nixTemplate")}</button>
        <button type="button" style={buttonStyle} disabled={busy || !view || configuration === null} onClick={() => { try { void act({ action: "configure", profiles: JSON.parse(configuration!) }); } catch (cause) { setError(String(cause)); } }}>{t("acceptance.save")}</button>
      </div>
    </details>
    <h3>{t("acceptance.runs")}</h3>
    {view?.runs.length === 0 && <p>{t("acceptance.noRuns")}</p>}
    {view?.runs.slice(0, 100).map((run) => <article key={run.id} data-acceptance-run={run.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, marginBottom: 8, overflowWrap: "anywhere" }}>
      <strong>{run.profile.label}</strong> · <span>{t(`acceptance.state_${run.state}`)}</span>
      <p style={{ margin: "6px 0", fontSize: 11 }}><code>{run.id}</code><br />{run.cwd}<br />{t("acceptance.snapshot")}: <code>{run.snapshot.digest}</code></p>
      <small>{t("acceptance.observers", { count: run.observers.length })} · {run.createdAt}<br />{t("acceptance.timings", { capture: (run.captureMs / 1000).toFixed(1), queue: run.queueMs === undefined ? "—" : (run.queueMs / 1000).toFixed(1), execution: run.executionMs === undefined ? "—" : (run.executionMs / 1000).toFixed(1) })}<br />{t(run.settled ? "acceptance.settled" : "acceptance.unsettled")}</small>
      {run.error && <p style={{ fontSize: 12 }}>{run.error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" style={buttonStyle} onClick={() => setSelected(run.id)}>{t("acceptance.logs")}</button>
        {!acceptanceTerminal(run.state) && <button type="button" style={buttonStyle} disabled={busy || run.state === "cancelling"} onClick={() => void act({ action: "cancel", runId: run.id })}>{t("acceptance.cancel")}</button>}
      </div>
    </article>)}
    {selected && <section aria-label={t("acceptance.logs")}><h3>{t("acceptance.logs")}</h3><code style={{ fontSize: 11, overflowWrap: "anywhere" }}>{selected}</code><pre style={{ maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{log || t("acceptance.noOutput")}</pre></section>}
  </dialog>, document.body);
}
