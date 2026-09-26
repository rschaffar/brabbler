"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { safeAuthorizationUrl } from "@/lib/oauth-url";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import { remainingRateLimits } from "@/lib/provider-usage-limits";
import type { ProviderUsageResult } from "@/lib/provider-usage";
import { DeviceAuthorization } from "./DeviceAuthorization";

type Account = { id: string; provider: string; label: string; type: "oauth" | "api_key"; authorized: boolean };
type Selection = Record<string, string>;
type ManualRequest = { provider: string; token: string; message: string; placeholder?: string; options?: { id: string; label: string }[] };
const field = "min-w-0 rounded border border-border bg-bg-panel px-2 py-1 text-xs text-text";

async function jsonRequest(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
  return result;
}

/** A compact account indicator beside the model; the controls live in its popover. */
export function ProviderAccounts({ cwd, sessionId, provider: currentProvider, busy, onSessionChange, onAccountsChanged }: {
  cwd: string; sessionId: string | null; provider: string; busy: boolean;
  onSessionChange: (provider: string, id: string | null, selection: Selection) => Promise<void>;
  onAccountsChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<EventSource | null>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ position: "fixed", zIndex: 10000, left: 12, bottom: 50, width: "calc(100vw - 24px)" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [manualProvider, setManualProvider] = useState("");
  const [providerChoices, setProviderChoices] = useState<string[]>([]);
  const [oauthChoices, setOauthChoices] = useState<string[]>([]);
  const [apiKeyChoices, setApiKeyChoices] = useState<string[]>([]);
  const [editingDefaultKey, setEditingDefaultKey] = useState(false);
  const [defaultApiKey, setDefaultApiKey] = useState("");
  const [usage, setUsage] = useState<Record<string, ProviderUsageResult>>({});
  const usageRequestsRef = useRef(new Map<string, symbol>());
  const usageFetchedRef = useRef(new Map<string, number>());
  const provider = manualProvider || currentProvider;
  const [project, setProject] = useState<Selection>({});
  const [session, setSession] = useState<Selection | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const selectionIdentity = JSON.stringify([cwd, sessionId]);
  const selectionReady = loadedFor === selectionIdentity;
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [type, setType] = useState<"oauth" | "api_key">("oauth");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [message, setMessage] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [device, setDevice] = useState<{ url: string; code: string; expiresInSeconds?: number | null } | null>(null);
  const [manualRequest, setManualRequest] = useState<ManualRequest | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const response = await fetch(`/api/auth/accounts/selection?${new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) })}`);
    if (!response.ok) throw new Error("Could not load provider accounts");
    const result = await response.json() as { accounts: Account[]; project: Selection; session: Selection | null };
    setAccounts(result.accounts);
    setProject(result.project);
    setSession(result.session);
    setLoadedFor(JSON.stringify([cwd, sessionId]));
  }, [cwd, sessionId]);
  useEffect(() => { void reload().catch((cause) => setError(String(cause))); }, [reload]);
  const reloadProviders = useCallback(async () => {
    const response = await fetch("/api/auth/providers");
    if (!response.ok) return;
    const result = await response.json() as { oauthProviders?: { id: string }[]; apiKeyProviders?: { id: string }[] };
    setOauthChoices((result.oauthProviders ?? []).map((item) => item.id));
    setApiKeyChoices((result.apiKeyProviders ?? []).map((item) => item.id));
    setProviderChoices([...new Set([...(result.oauthProviders ?? []), ...(result.apiKeyProviders ?? [])].map((item) => item.id))].sort());
  }, []);
  useEffect(() => { void reloadProviders().catch(() => {}); }, [reloadProviders]);
  const usageKey = (providerId: string, accountId: string | null) => JSON.stringify([providerId, accountId]);
  const clearUsage = (providerId: string, accountId: string | null) => {
    const key = usageKey(providerId, accountId);
    usageFetchedRef.current.delete(key);
    usageRequestsRef.current.delete(key);
    setUsage((previous) => { const next = { ...previous }; delete next[key]; return next; });
  };
  const queryUsage = useCallback(async (providerId: string, accountId: string | null, force = false) => {
    if (!isProviderUsageId(providerId)) return;
    const key = JSON.stringify([providerId, accountId]);
    if (usageRequestsRef.current.has(key) || (!force && Date.now() - (usageFetchedRef.current.get(key) ?? 0) < 60_000)) return;
    const requestId = Symbol(key);
    usageRequestsRef.current.set(key, requestId);
    try {
      const response = await fetch("/api/provider-usage/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, accountId }),
      });
      if (!response.ok) throw new Error("Usage unavailable");
      const result = await response.json() as ProviderUsageResult;
      if (usageRequestsRef.current.get(key) !== requestId) return;
      usageFetchedRef.current.set(key, Date.now());
      setUsage((previous) => ({ ...previous, [key]: result }));
    } catch {
      if (usageRequestsRef.current.get(key) !== requestId) return;
      usageFetchedRef.current.set(key, Date.now() - 45_000);
      setUsage((previous) => ({ ...previous, [key]: { providerId, status: "query-failed", message: "Usage unavailable" } as ProviderUsageResult }));
    } finally { if (usageRequestsRef.current.get(key) === requestId) usageRequestsRef.current.delete(key); }
  }, []);
  useEffect(() => () => { eventsRef.current?.close(); eventsRef.current = null; }, []);
  useEffect(() => {
    if (open) return;
    setAdding(false);
    setLabel("");
    setApiKey("");
  }, [open]);
  useEffect(() => {
    setAdding(false);
    setLabel("");
    setApiKey("");
  }, [provider]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const width = Math.min(380, (viewport?.width ?? window.innerWidth) - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const maxHeight = Math.max(100, Math.min(480, rect.top - 16));
      setPanelStyle({ position: "fixed", zIndex: 10000, left, bottom: window.innerHeight - rect.top + 8, width, maxHeight });
    };
    let frame = 0;
    let layoutFrame = 0;
    const placeAfterLayout = () => {
      place();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layoutFrame);
      // The mobile composer moves in an animation frame after the keyboard
      // changes visualViewport height. Measure again after that movement.
      frame = requestAnimationFrame(() => { layoutFrame = requestAnimationFrame(place); });
    };
    placeAfterLayout();
    panelRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    window.addEventListener("resize", placeAfterLayout);
    window.addEventListener("scroll", placeAfterLayout);
    window.visualViewport?.addEventListener("resize", placeAfterLayout);
    window.visualViewport?.addEventListener("scroll", placeAfterLayout);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layoutFrame);
      window.removeEventListener("resize", placeAfterLayout);
      window.removeEventListener("scroll", placeAfterLayout);
      window.visualViewport?.removeEventListener("resize", placeAfterLayout);
      window.visualViewport?.removeEventListener("scroll", placeAfterLayout);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node) || panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  const available = accounts.filter((account) => account.provider === provider && account.authorized);
  // An existing session never silently follows a later change to the project default.
  const selected = selectionReady ? (session ?? project)[provider] ?? "" : "";
  const currentId = selectionReady ? (session ?? project)[currentProvider] ?? "" : "";
  const currentAccount = !selectionReady ? "Loading account…" : currentId
    ? accounts.find((account) => account.id === currentId && account.provider === currentProvider && account.authorized)?.label ?? "Unavailable account"
    : "Pi default";
  useEffect(() => {
    if (!selectionReady || !currentProvider || currentAccount === "Unavailable account") return;
    void queryUsage(currentProvider, currentId || null);
  }, [selectionReady, currentProvider, currentId, currentAccount, queryUsage]);
  useEffect(() => {
    if (!selectionReady || !currentProvider || currentAccount === "Unavailable account") return;
    const refreshOnReturn = () => { if (document.visibilityState === "visible") void queryUsage(currentProvider, currentId || null); };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => { window.removeEventListener("focus", refreshOnReturn); document.removeEventListener("visibilitychange", refreshOnReturn); };
  }, [selectionReady, currentProvider, currentId, currentAccount, queryUsage]);
  useEffect(() => {
    if (!open || !provider) return;
    void queryUsage(provider, null);
    for (const account of accounts) {
      if (account.provider === provider && account.authorized) void queryUsage(provider, account.id);
    }
  }, [open, provider, accounts, queryUsage]);
  const usageText = (providerId: string, accountId: string | null) => {
    if (!isProviderUsageId(providerId)) return "Usage not supported";
    const snapshot = usage[usageKey(providerId, accountId)];
    if (!snapshot) return "Loading usage…";
    if (snapshot.status !== "ready") return snapshot.message;
    return remainingRateLimits(snapshot.report).join(" · ") || "No weekly or 5h limit reported";
  };
  const currentLimits = selectionReady && isProviderUsageId(currentProvider) && currentAccount !== "Unavailable account"
    ? usage[usageKey(currentProvider, currentId || null)] : undefined;
  const currentUsage = currentLimits?.status === "ready" ? remainingRateLimits(currentLimits.report).join(" · ") : "";
  const compactUsage = currentUsage.replaceAll("Weekly ", "W ").replaceAll(" remaining", "");

  const changeSession = async (value: string) => {
    setPending(true); setError("");
    const next = { ...(session ?? project) };
    if (value) next[provider] = value;
    else delete next[provider];
    try {
      await onSessionChange(provider, value || null, next);
      setSession(next);
      await onAccountsChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not switch account"); }
    finally { setPending(false); }
  };
  const changeProject = async (value: string) => {
    setPending(true); setError("");
    try {
      const result = await jsonRequest("/api/auth/accounts/selection", "PUT", {
        scope: "project", cwd, provider, accountId: value || null,
      });
      setProject(result.project as Selection);
      await onAccountsChanged();
      // New composers without an override follow this default; existing sessions do not.
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not set project default"); }
    finally { setPending(false); }
  };
  const cancelOAuth = () => {
    eventsRef.current?.close(); eventsRef.current = null;
    setPending(false); setOauthPending(false); setDevice(null); setOauthUrl(""); setManualRequest(null);
    setMessage(""); setError("");
  };
  const startOAuth = (id: string | null) => {
    eventsRef.current?.close();
    const loginProvider = provider;
    const events = new EventSource(`/api/auth/login/${encodeURIComponent(loginProvider)}${id ? `?accountId=${encodeURIComponent(id)}` : ""}`);
    eventsRef.current = events;
    setPending(true); setOauthPending(true); setError(""); setDevice(null); setOauthUrl(""); setManualRequest(null);
    setMessage("Waiting for authorization…");
    events.onmessage = (event) => {
      if (eventsRef.current !== events) return;
      let data: { type: string; url?: string; instructions?: string; token?: string; message?: string;
        placeholder?: string; options?: { id: string; label: string }[]; userCode?: string; verificationUri?: string; expiresInSeconds?: number | null };
      try { data = JSON.parse(event.data); }
      catch { events.close(); eventsRef.current = null; setPending(false); setOauthPending(false); setError("Invalid authorization response"); return; }
      if (data.type === "auth" || data.type === "device_code") {
        const url = safeAuthorizationUrl(data.type === "auth" ? data.url : data.verificationUri);
        if (!url) {
          events.close(); eventsRef.current = null; setPending(false); setOauthPending(false); setError(t("auth.invalidUrl"));
          return;
        }
        if (data.type === "auth") {
          setOauthUrl(url);
          setMessage(data.instructions || "Open the authorization page and complete sign-in");
          // The popup can be blocked; the link below remains available.
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          setDevice({ url, code: data.userCode ?? "", expiresInSeconds: data.expiresInSeconds });
          setMessage("Waiting for device authorization…");
        }
      } else if ((data.type === "prompt_request" || data.type === "select_request") && data.token) {
        setManualRequest({ provider: loginProvider, token: data.token, message: data.message || "Enter authorization code", placeholder: data.placeholder,
          ...(data.type === "select_request" ? { options: data.options ?? [] } : {}) });
        setManualValue("");
      } else if (data.type === "success") {
        events.close(); eventsRef.current = null;
        setPending(false); setOauthPending(false); setAdding(false); setOauthUrl(""); setDevice(null); setManualRequest(null);
        setMessage("Account authorized");
        clearUsage(loginProvider, id);
        void Promise.all([reload(), reloadProviders(), onAccountsChanged()]).then(() => {
          void queryUsage(loginProvider, id, true);
        }).catch((cause) => setError(String(cause)));
      } else if (data.type === "error" || data.type === "cancelled") {
        events.close(); eventsRef.current = null;
        setPending(false); setOauthPending(false); setOauthUrl(""); setDevice(null); setManualRequest(null);
        setError(data.message ?? "Authorization cancelled");
      } else if (data.message) setMessage(data.message);
    };
    events.onerror = () => {
      if (eventsRef.current !== events) return;
      events.close(); eventsRef.current = null;
      setPending(false); setOauthPending(false); setError("Authorization connection closed");
    };
  };
  const submitManual = async (value: string) => {
    if (!manualRequest || !value.trim()) return;
    try {
      await jsonRequest(`/api/auth/login/${encodeURIComponent(manualRequest.provider)}`, "POST", { token: manualRequest.token, code: value.trim() });
      setManualRequest(null);
      setMessage("Verifying…");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit authorization code"); }
  };
  const addAccount = async () => {
    setPending(true); setError(""); setMessage(""); setOauthUrl(""); setDevice(null);
    try {
      const result = await jsonRequest("/api/auth/accounts", "POST", { provider, label, type });
      const created = result.account as Account;
      if (type === "api_key") {
        await jsonRequest(`/api/auth/accounts/${encodeURIComponent(created.id)}/api-key`, "POST", { apiKey });
        setPending(false); setAdding(false); setApiKey(""); setLabel("");
        await Promise.all([reload(), onAccountsChanged()]);
      } else startOAuth(created.id);
    } catch (cause) { setPending(false); setError(cause instanceof Error ? cause.message : "Could not add account"); }
  };

  return <div className="min-w-0 shrink-0">
    <button ref={triggerRef} type="button" className="flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-xs text-text-muted hover:bg-bg-hover" style={{ maxWidth: "min(58vw, 280px)" }}
      title={`${t("auth.accountFor", { provider: currentProvider || t("auth.account"), account: currentAccount })}${currentUsage ? ` · ${currentUsage}` : ""}`}
      aria-label={`${t("auth.accountFor", { provider: currentProvider || t("auth.account"), account: currentAccount })}${currentUsage ? ` · ${currentUsage}` : ""}`}
      aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen((value) => !value)}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" />
      </svg><span className="min-w-0 truncate">{currentAccount}</span>{compactUsage && <span className="truncate whitespace-nowrap text-[10px] text-text-dim">{compactUsage}</span>}
    </button>
    {open && createPortal(<div ref={panelRef} id={panelId} role="region" aria-label="Provider accounts"
      className="overflow-y-auto overscroll-contain rounded-lg border border-border bg-bg-panel p-3 text-xs text-text-muted shadow-xl"
      style={panelStyle}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-text">Provider accounts</strong>
        <button type="button" aria-label={t("i18n.close")} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>×</button>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">Account provider
          <select className={field} aria-label="Account provider" value={provider} disabled={oauthPending} onChange={(event) => { setManualProvider(event.target.value); setEditingDefaultKey(false); setDefaultApiKey(""); }}>
            <option value="">Choose a provider…</option>
            {currentProvider && !providerChoices.includes(currentProvider) && <option value={currentProvider}>{currentProvider}</option>}
            {providerChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </label>
        {provider && <>
          <label className="flex flex-col gap-1">{provider} account
            <select className={field} aria-label="Session account" value={selected} disabled={!selectionReady || busy || pending}
              onChange={(event) => void changeSession(event.target.value)}>
              <option value="">Pi default</option>
              {available.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
              {selected && !available.some((account) => account.id === selected) && <option value={selected}>Unavailable account</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1" title="Default for new sessions in this project (including worktrees)">New sessions in project
            <select className={field} aria-label="Project account default" value={project[provider] ?? ""} disabled={!selectionReady || pending}
              onChange={(event) => void changeProject(event.target.value)}>
              <option value="">Pi default</option>
              {available.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
          <button className={`${field} self-start`} type="button" disabled={oauthPending} onClick={() => { setAdding(!adding); setLabel(""); setApiKey(""); }} aria-expanded={adding}>{adding ? "Close add form" : "Add account"}</button>
        </>}
      </div>
      {adding && provider && <div className="mt-2 flex flex-col gap-2 rounded border border-border bg-bg-panel p-2">
        <input className={field} aria-label="Account label" placeholder="Account label" value={label} onChange={(event) => setLabel(event.target.value)} />
        <select className={field} aria-label="Account type" value={type} onChange={(event) => setType(event.target.value as "oauth" | "api_key")}>
          <option value="oauth">Sign in (OAuth)</option><option value="api_key">API key</option>
        </select>
        {type === "api_key" && <input className={field} aria-label="API key for new account" type="password" autoComplete="off" placeholder="API key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />}
        <button className={`${field} self-start`} type="button" disabled={pending || !label.trim() || (type === "api_key" && !apiKey.trim())} onClick={() => void addAccount()}>Authorize account</button>
      </div>}
      {provider && <div className="mt-2 flex flex-col gap-2 rounded border border-border bg-bg-panel p-2" aria-label={`${provider} accounts`}>
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          <strong className="text-text">Pi default</strong>
          {oauthChoices.includes(provider) && <button className={field} type="button" disabled={pending} onClick={() => startOAuth(null)}>Change login</button>}
          {apiKeyChoices.includes(provider) && <button className={field} type="button" disabled={pending} onClick={() => setEditingDefaultKey((value) => !value)}>Change API key</button>}
          {editingDefaultKey && apiKeyChoices.includes(provider) && <form className="flex w-full gap-1" onSubmit={(event) => { event.preventDefault(); if (!defaultApiKey.trim()) return;
            setPending(true); setError("");
            void jsonRequest(`/api/auth/api-key/${encodeURIComponent(provider)}`, "POST", { apiKey: defaultApiKey })
              .then(async () => { clearUsage(provider, null); setDefaultApiKey(""); setEditingDefaultKey(false); await onAccountsChanged(); await queryUsage(provider, null, true); })
              .catch((cause) => setError(String(cause))).finally(() => setPending(false));
          }}><input className={`${field} flex-1`} type="password" autoComplete="off" aria-label="Pi default API key" value={defaultApiKey} onChange={(event) => setDefaultApiKey(event.target.value)} />
            <button type="submit" className={field} disabled={pending || !defaultApiKey.trim()}>Save</button></form>}
          <span className="w-full text-text-dim">{usageText(provider, null)}</span>
          {isProviderUsageId(provider) && <button type="button" className={field} onClick={() => void queryUsage(provider, null, true)}>Refresh usage</button>}
        </div>
        {accounts.filter((account) => account.provider === provider).map((account) => <div key={account.id} className="flex flex-wrap items-center gap-1">
          <span>{account.label}{!account.authorized ? " (not authorized)" : ""}</span>
          <button className={field} type="button" disabled={pending} onClick={() => {
            const next = window.prompt("Rename account", account.label);
            if (next) void jsonRequest("/api/auth/accounts", "PATCH", { id: account.id, label: next }).then(reload).catch((cause) => setError(String(cause)));
          }}>Rename</button>
          <button className={field} type="button" disabled={pending} onClick={() => {
            if (window.confirm(`Remove ${account.label}? Sessions using it will become unavailable until switched.`)) {
              void jsonRequest("/api/auth/accounts", "DELETE", { id: account.id }).then(reload).catch((cause) => setError(String(cause)));
            }
          }}>Remove</button>
          {account.type === "oauth" && <button className={field} type="button" disabled={pending} onClick={() => startOAuth(account.id)}>{account.authorized ? "Change login" : "Retry login"}</button>}
          <span className="w-full text-text-dim">{account.authorized ? usageText(provider, account.id) : "Sign in to see usage"}</span>
          {account.authorized && isProviderUsageId(provider) && <button type="button" className={field} onClick={() => void queryUsage(provider, account.id, true)}>Refresh usage</button>}
        </div>)}
      </div>}
      {message && <p role="status" className="mt-2 break-words">{message}</p>}
      {oauthUrl && <a href={oauthUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-accent underline">Open authorization page · {oauthUrl}</a>}
      {device && <div className="mt-2"><DeviceAuthorization verificationUri={device.url} userCode={device.code} expiresInSeconds={device.expiresInSeconds} /></div>}
      {manualRequest && <div className="mt-2 flex flex-col gap-2">
        <span>{manualRequest.message}</span>
        {manualRequest.options ? manualRequest.options.map((option) =>
          <button key={option.id} type="button" className={`${field} text-left`} onClick={() => void submitManual(option.id)}>{option.label}</button>) :
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void submitManual(manualValue); }}>
            <input className={`${field} flex-1`} aria-label="Authorization code" placeholder={manualRequest.placeholder ?? "Enter authorization code"} value={manualValue} onChange={(event) => setManualValue(event.target.value)} />
            <button className={field} type="submit" disabled={!manualValue.trim()}>Submit</button>
          </form>}
      </div>}
      {oauthPending && <button className={`${field} mt-2`} type="button" onClick={cancelOAuth}>{t("i18n.cancel")}</button>}
      {error && <p role="alert" className="mt-2 break-words text-red-400">{error}</p>}
    </div>, document.body)}
  </div>;
}
