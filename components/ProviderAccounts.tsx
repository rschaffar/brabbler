"use client";

import { useCallback, useEffect, useState } from "react";

type Account = { id: string; provider: string; label: string; type: "oauth" | "api_key"; authorized: boolean };
type Selection = Record<string, string>;
const field = "rounded border border-border bg-panel px-2 py-1 text-xs text-text";

async function jsonRequest(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
  return result;
}

/** Per-model-provider account controls. No secrets are returned by the metadata API. */
export function ProviderAccounts({ cwd, sessionId, provider: currentProvider, busy, onSessionChange, onAccountsChanged }: {
  cwd: string; sessionId: string | null; provider: string; busy: boolean;
  onSessionChange: (provider: string, id: string | null, selection: Selection) => Promise<void>;
  onAccountsChanged: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [manualProvider, setManualProvider] = useState("");
  const [providerChoices, setProviderChoices] = useState<string[]>([]);
  const provider = manualProvider || currentProvider;
  const [project, setProject] = useState<Selection>({});
  const [session, setSession] = useState<Selection | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [type, setType] = useState<"oauth" | "api_key">("oauth");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const response = await fetch(`/api/auth/accounts/selection?${new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) })}`);
    if (!response.ok) throw new Error("Could not load provider accounts");
    const result = await response.json() as { accounts: Account[]; project: Selection; session: Selection | null };
    setAccounts(result.accounts);
    setProject(result.project);
    setSession(result.session);
  }, [cwd, sessionId]);
  useEffect(() => { void reload().catch((cause) => setError(String(cause))); }, [reload]);
  useEffect(() => {
    void fetch("/api/auth/providers").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { oauthProviders?: { id: string }[]; apiKeyProviders?: { id: string }[] };
      setProviderChoices([...new Set([...(result.oauthProviders ?? []), ...(result.apiKeyProviders ?? [])].map((item) => item.id))].sort());
    }).catch(() => {});
  }, []);

  const available = accounts.filter((account) => account.provider === provider && account.authorized);
  // A new composer can have a local override before the first session exists.
  const selected = (session ?? project)[provider] ?? "";
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
      // An open composer without an override follows the newly chosen default
      // until its session is created. Existing sessions never follow it.
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not set project default"); }
    finally { setPending(false); }
  };
  const startOAuth = (id: string) => {
    const events = new EventSource(`/api/auth/login/${encodeURIComponent(provider)}?accountId=${encodeURIComponent(id)}`);
    setMessage("Waiting for authorization…");
    events.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string; url?: string; token?: string; message?: string; options?: { id: string; label: string }[]; userCode?: string; verificationUri?: string };
      if (data.type === "auth" && data.url) {
        let safeUrl: URL;
        try { safeUrl = new URL(data.url); }
        catch { setError("Invalid authorization URL"); return; }
        if (safeUrl.protocol !== "https:" && safeUrl.protocol !== "http:") {
          setError("Invalid authorization URL"); return;
        }
        setOauthUrl(safeUrl.toString());
        setMessage("Open the authorization page and complete sign-in");
        // Browsers may block automatic popups; keep a clickable link visible.
        window.open(safeUrl.toString(), "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setMessage(`Visit ${data.verificationUri} and enter ${data.userCode}`);
      } else if ((data.type === "prompt_request" || data.type === "select_request") && data.token) {
        const input = window.prompt(data.type === "select_request"
          ? `${data.message ?? "Choose an option"}\n${data.options?.map((option) => `${option.id}: ${option.label}`).join("\n") ?? ""}`
          : data.message ?? "Enter authorization code");
        if (input) void jsonRequest(`/api/auth/login/${encodeURIComponent(provider)}`, "POST", { token: data.token, code: input })
          .catch((cause) => setError(String(cause)));
      } else if (data.type === "success") {
        events.close(); setPending(false); setAdding(false); setOauthUrl(""); setMessage("Account authorized");
        void Promise.all([reload(), onAccountsChanged()]).catch((cause) => setError(String(cause)));
      } else if (data.type === "error" || data.type === "cancelled") {
        events.close(); setPending(false); setOauthUrl(""); setError(data.message ?? "Authorization cancelled");
      } else if (data.message) setMessage(data.message);
    };
    events.onerror = () => { events.close(); setPending(false); setError("Authorization connection closed"); };
  };
  const addAccount = async () => {
    setPending(true); setError(""); setMessage(""); setOauthUrl("");
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

  return (
    <div className="mx-auto mb-1 max-w-[820px] px-4 text-xs text-text-muted" aria-label="Provider accounts">
      <div className="flex flex-wrap items-center gap-2">
        <select className={field} aria-label="Account provider" value={provider} onChange={(event) => setManualProvider(event.target.value)}>
          <option value="">Choose a provider…</option>
          {currentProvider && !providerChoices.includes(currentProvider) && <option value={currentProvider}>{currentProvider}</option>}
          {providerChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>
        {provider && <><span title="Account used by this session">{provider} account</span>
        <select className={field} aria-label="Session account" value={selected} disabled={busy || pending}
          onChange={(event) => void changeSession(event.target.value)}>
          <option value="">Pi default</option>
          {available.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          {selected && !available.some((account) => account.id === selected) && <option value={selected}>Unavailable account</option>}
        </select>
        <span title="Default for new sessions in this project (including worktrees)">New sessions in project</span>
        <select className={field} aria-label="Project account default" value={project[provider] ?? ""} disabled={pending}
          onChange={(event) => void changeProject(event.target.value)}>
          <option value="">Pi default</option>
          {available.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
        <button className={field} type="button" onClick={() => setAdding(!adding)} aria-expanded={adding}>Accounts…</button></>}
      </div>
      {adding && <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-border bg-panel p-2">
        <input className={field} aria-label="Account label" placeholder="Account label" value={label} onChange={(event) => setLabel(event.target.value)} />
        <select className={field} aria-label="Account type" value={type} onChange={(event) => setType(event.target.value as "oauth" | "api_key")}>
          <option value="oauth">Sign in (OAuth)</option><option value="api_key">API key</option>
        </select>
        {type === "api_key" && <input className={field} aria-label="API key for new account" type="password" autoComplete="off" placeholder="API key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />}
        <button className={field} type="button" disabled={pending || !label.trim() || (type === "api_key" && !apiKey.trim())} onClick={() => void addAccount()}>Authorize account</button>
        {accounts.filter((account) => account.provider === provider).map((account) => <div key={account.id} className="flex items-center gap-1">
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
          {!account.authorized && account.type === "oauth" && <button className={field} type="button" disabled={pending} onClick={() => { setPending(true); startOAuth(account.id); }}>Retry login</button>}
        </div>)}
      </div>}
      {message && <div role="status" className="break-all">{message}{oauthUrl && <>{" — "}<a href={oauthUrl} target="_blank" rel="noopener noreferrer" className="underline">Open authorization page</a></>}</div>}
      {error && <div role="alert" className="text-red-400">{error}</div>}
    </div>
  );
}
