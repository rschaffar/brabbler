"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BROWSER_SSH_STORAGE_KEY, browserSshApi, enrollBrowserSshCredential, requestBrowserSshAssertion } from "@/lib/browser-ssh-client";
import type { BrowserSshCredential } from "@/lib/browser-ssh-protocol";
import type { BrowserSshRequest } from "@/lib/browser-ssh-agent";
import { ConfigButton, ConfigPanelShell } from "./SettingsUi";

type Snapshot = { socketPath: string; publicKey: string; requests: BrowserSshRequest[]; sessions: string[] };
type Connection = Snapshot & { token: string; credential: BrowserSshCredential };

export function BrowserSshAgent({ open, onClose, onRequest, sessionId }: { open: boolean; onClose: () => void; onRequest: () => void; sessionId: string | null }) {
  const { t } = useI18n();
  const [credential, setCredential] = useState<BrowserSshCredential | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);
  const [bound, setBound] = useState(false);
  const active = useRef<Connection | null>(null);
  const operation = useRef<AbortController | null>(null);
  const approvingRequest = useRef<string | null>(null);
  const onRequestRef = useRef(onRequest);
  useEffect(() => { onRequestRef.current = onRequest; }, [onRequest]);

  useEffect(() => {
    setSupported(window.isSecureContext && window.top === window.self && typeof PublicKeyCredential !== "undefined");
    try {
      const saved = JSON.parse(localStorage.getItem(BROWSER_SSH_STORAGE_KEY) ?? "null");
      if (saved?.origin === location.origin && typeof saved.id === "string" && saved.id.length < 1400 && typeof saved.spki === "string" && saved.spki.length < 400) setCredential({ id: saved.id, spki: saved.spki });
    } catch { /* Public metadata persistence is best effort, never authority. */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void browserSshApi<{ supported: boolean; bound: boolean }>({ action: "status", sessionId }, controller.signal)
      .then((status) => { setBound(status.bound); if (!status.supported) setSupported(false); })
      .catch((failure) => { if (!controller.signal.aborted) setError(String(failure.message)); });
    return () => controller.abort();
  }, [open, sessionId]);

  const disconnect = useCallback(() => {
    operation.current?.abort();
    const current = active.current;
    active.current = null; setConnection(null);
    if (current) void browserSshApi({ action: "disconnect", token: current.token }).catch(() => {});
  }, []);

  useEffect(() => {
    const leave = () => {
      operation.current?.abort();
      const current = active.current; active.current = null; setConnection(null);
      if (current) void fetch("/api/ssh-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect", token: current.token }), keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, []);

  const token = connection?.token;
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snapshot = await browserSshApi<Snapshot>({ action: "poll", token }, controller.signal);
        if (controller.signal.aborted || active.current?.token !== token) return;
        if (approvingRequest.current && !snapshot.requests.some((request) => request.id === approvingRequest.current)) operation.current?.abort("request-settled");
        const next = { ...active.current, ...snapshot };
        active.current = next; setConnection(next);
        if (snapshot.requests.length) onRequestRef.current();
        timer = setTimeout(() => void poll(), 1000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        operation.current?.abort(); active.current = null; setConnection(null);
        setError(failure instanceof Error ? failure.message : t("browserSsh.disconnected"));
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, t]);

  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError("");
    try { await work(controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (operation.current === controller) operation.current = null; setBusy(false); }
  };
  const enroll = () => run(async (signal) => {
    const next = await enrollBrowserSshCredential(signal);
    setCredential(next);
    try { localStorage.setItem(BROWSER_SSH_STORAGE_KEY, JSON.stringify({ ...next, origin: location.origin })); }
    catch { setError(t("browserSsh.storageFailed")); }
  });
  const connect = () => run(async (signal) => {
    if (!credential) return;
    const created = await browserSshApi<{ token: string; challenge: string }>({ action: "create", credential }, signal);
    try {
      const assertion = await requestBrowserSshAssertion(credential, created.challenge, signal);
      const snapshot = await browserSshApi<Snapshot>({ action: "activate", token: created.token, assertion }, signal);
      if (signal.aborted) throw new Error("Connection cancelled");
      const next = { ...snapshot, token: created.token, credential };
      active.current = next; setConnection(next);
    } catch (failure) {
      void browserSshApi({ action: "disconnect", token: created.token }).catch(() => {});
      throw failure;
    }
  });
  const respond = (request: BrowserSshRequest, approve: boolean) => run(async (signal) => {
    const current = active.current;
    if (!current) return;
    approvingRequest.current = request.id;
    try {
      const assertion = approve ? await requestBrowserSshAssertion(current.credential, request.challenge, signal) : undefined;
      if (active.current?.token !== current.token || signal.aborted) return;
      await browserSshApi({ action: "respond", token: current.token, requestId: request.id, ...(assertion ? { assertion } : {}) }, signal);
    } catch (failure) {
      // Cancellation and authenticator failure deny this exact request; never retry signing.
      if (active.current?.token === current.token && signal.reason !== "request-settled") void browserSshApi({ action: "respond", token: current.token, requestId: request.id }).catch(() => {});
      throw failure;
    } finally { approvingRequest.current = null; }
    if (active.current?.token === current.token) {
      const next = { ...active.current, requests: active.current.requests.filter((item) => item.id !== request.id) };
      active.current = next; setConnection(next);
    }
  });

  if (!open) return null;
  return <ConfigPanelShell embedded={false} title={t("browserSsh.title")} closeLabel={t("browserSsh.close")} onClose={() => { operation.current?.abort(); onClose(); }} width={700} height="auto">
    <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <p>{t("browserSsh.description")}</p>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("browserSsh.compatibility")}</p>
      {!supported && <p role="status">{t("browserSsh.unsupported")}</p>}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {!credential && <ConfigButton disabled={busy || !supported} onClick={() => void enroll()}>{t("browserSsh.enroll")}</ConfigButton>}
        {credential && !connection && <>
          <ConfigButton disabled={busy || !supported} onClick={() => void connect()}>{t("browserSsh.connect")}</ConfigButton>
          <ConfigButton disabled={busy} onClick={() => { setCredential(null); try { localStorage.removeItem(BROWSER_SSH_STORAGE_KEY); } catch {} }}>{t("browserSsh.forget")}</ConfigButton>
        </>}
        {(connection || busy) && <ConfigButton variant="danger" onClick={disconnect}>{t("browserSsh.disconnect")}</ConfigButton>}
      </div>
      {connection && <>
        <label>{t("browserSsh.publicKey")}<textarea aria-label={t("browserSsh.publicKey")} readOnly value={connection.publicKey} rows={3} style={{ width: "100%", fontFamily: "monospace", overflowWrap: "anywhere" }} /></label>
        <label>{t("browserSsh.export")}<textarea aria-label={t("browserSsh.export")} readOnly value={`export SSH_AUTH_SOCK='${connection.socketPath.replace(/'/g, "'\\''")}'`} rows={2} style={{ width: "100%", fontFamily: "monospace" }} /></label>
        {sessionId && <ConfigButton disabled={busy || connection.sessions.includes(sessionId)} onClick={() => void run(async (signal) => {
          await browserSshApi({ action: "bind", token: connection.token, sessionId }, signal); setBound(true);
        })}>{t("browserSsh.bind")}</ConfigButton>}
      </>}
      {sessionId && bound && <ConfigButton disabled={busy} onClick={() => void run(async (signal) => {
        await browserSshApi({ action: "unbind", token: connection?.token, sessionId }, signal); setBound(false);
      })}>{t("browserSsh.unbind")}</ConfigButton>}
      {credential && <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("browserSsh.forgetWarning")}</p>}
      {connection?.requests.map((request) => <section key={request.id} aria-label={t("browserSsh.request")} style={{ border: "1px solid var(--border)", padding: 12, borderRadius: 8 }}>
        <strong>{request.description}</strong>
        <p><code style={{ overflowWrap: "anywhere" }}>{request.fingerprint}</code></p>
        <p>{t("browserSsh.untrusted")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <ConfigButton variant="primary" disabled={busy} onClick={() => void respond(request, true)}>{t("browserSsh.approve")}</ConfigButton>
          <ConfigButton disabled={busy} onClick={() => void respond(request, false)}>{t("browserSsh.deny")}</ConfigButton>
        </div>
      </section>)}
    </div>
  </ConfigPanelShell>;
}
