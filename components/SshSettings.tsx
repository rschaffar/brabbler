"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { SshAgentController, SshDisplayConnection, SshRecoveryItem } from "@/hooks/useSshAgent";
import type { SshBackend, SshKeyPolicy, SshKeyView } from "@/lib/ssh-agent-types";
import { ConfigButton, ConfigDetail, ConfigDetailStack, ConfigSectionTitle } from "./SettingsUi";

const actions = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } as const;
const box = { border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 10 } as const;
const muted = { color: "var(--text-muted)", fontSize: 12 } as const;
const field = { display: "grid", gap: 4 } as const;
function backendId(backend: SshBackend) { return backend.type === "socket" ? `socket:${backend.path}:${backend.label}` : backend.type; }

/** Dedicated embedded Settings content only. Its controller must outlive this component. */
export function SshSettings({ controller: c, active = true }: { controller: SshAgentController; active?: boolean }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SshBackend | null>(null);
  const [path, setPath] = useState("");
  const [socketLabel, setSocketLabel] = useState("");
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState<SshKeyPolicy>("strict");
  const [applicationOnly, setApplicationOnly] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [device, setDevice] = useState("");
  const [unlockOnConnect, setUnlockOnConnect] = useState(false);
  const [localError, setLocalError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const { refresh, cancelDiscovery } = c;
  // Settings owns discovery, never the signer's connection or signing prompt.
  useEffect(() => { if (active) void refresh(); return cancelDiscovery; }, [active, refresh, cancelDiscovery]);

  const status = c.status;
  const disabled = c.busy || c.discovering || c.auth !== "ready" || !status?.supported;
  const chosen = draft ?? status?.runtime.selected ?? { type: "none" as const };
  const ownKeys = status?.registry.keys.filter(key => key.origin === c.origin) ?? [];
  const selectedKey = ownKeys.find(key => key.id === keyId);
  const options: { backend: SshBackend; label: string }[] = [
    { backend: { type: "none" }, label: t("sshAgent.backend.none") },
    { backend: { type: "browser" }, label: t("sshAgent.backend.browser") },
    { backend: { type: "inherited" }, label: t("sshAgent.backend.inherited") },
    ...(status?.runtime.custom ?? []).map(item => ({ backend: { type: "socket" as const, ...item }, label: item.label })),
    ...c.candidates.filter(item => item.source !== "inherited").map(item => ({
      backend: { type: "socket" as const, path: item.path, label: item.label },
      label: `${item.label} · ${t(item.available ? "sshAgent.probedAvailable" : "sshAgent.probedUnavailable")}${item.dynamic ? ` · ${t("sshAgent.dynamic")}` : ""}`,
    })),
  ];
  if (!options.some(option => backendId(option.backend) === backendId(chosen))) options.push({ backend: chosen, label: chosen.type === "socket" ? chosen.label : c.effectiveLabel });
  const uniqueOptions = options.filter((item, index) => options.findIndex(other => backendId(other.backend) === backendId(item.backend)) === index);
  const connections = [...(status?.connections ?? [])].sort((a, b) => Number(b.role === "active") - Number(a.role === "active"));
  const hasStaged = c.recovery.some(item => item.source === "staged");

  if (!active) return null;
  return <ConfigDetail>
    <ConfigDetailStack>
      <ConfigSectionTitle>{t("sshAgent.title")}</ConfigSectionTitle>
      <p>{t("sshAgent.routingHelp")}</p>
      {c.auth !== "ready" && <p role="status">{t(`sshAgent.auth.${c.auth}`)}</p>}
      {c.auth === "login-required" && <a href="/login">{t("sshAgent.signIn")}</a>}
      {!c.supported && <p role="status">{t("sshAgent.unsupportedBrowser")}</p>}
      {status && !status.supported && <p role="status">{t("sshAgent.unsupportedRuntime")}</p>}
      {(c.error || localError) && <p role="alert" style={{ color: "#cf4a5d" }}>{localError || c.error}</p>}
      {c.notice && <p role="status">{c.notice}</p>}
      {c.recoveryWarnings.map(warning => <p role="alert" key={warning}>{warning}</p>)}
      {status?.error && <p role="status">{status.error}</p>}
      {status?.runtime.settingsError && <p role="alert">{status.runtime.settingsError}</p>}
      {status?.registry.error && <p role="alert">{status.registry.error}</p>}
      {c.busy && <div style={actions}><span role="status">{t("sshAgent.verifying")}</span><ConfigButton onClick={c.cancel}>{t("sshAgent.cancel")}</ConfigButton></div>}

      <section style={box} aria-label={t("sshAgent.routing")}>
        <strong>{t("sshAgent.current", { agent: c.effectiveLabel })}</strong>
        {status?.runtime.setupNeeded && <p>{t("sshAgent.firstSetup")}</p>}
        {status?.runtime.selected.type === "browser" && <p>{c.active ? t("sshAgent.activeSummary", { device: c.active.device, state: t(`sshAgent.state.${c.active.state}`) }) : t("sshAgent.browserDisconnected")}</p>}
        {status && ["socket", "inherited"].includes(status.runtime.selected.type) && <p style={muted}>{t("sshAgent.externalStatus")}</p>}
        <label style={field}>{t("sshAgent.chooseAgent")}
          <select aria-label={t("sshAgent.chooseAgent")} disabled={disabled} value={backendId(chosen)} onChange={event => {
            const option = uniqueOptions.find(item => backendId(item.backend) === event.target.value);
            if (option) setDraft(option.backend);
          }}>
            {uniqueOptions.map(option => <option key={backendId(option.backend)} value={backendId(option.backend)}>{option.label}</option>)}
          </select>
        </label>
        <div style={actions}>
          <ConfigButton variant="primary" disabled={disabled} onClick={() => void c.useAgent(chosen).then(ok => { if (ok) setDraft(null); })}>{t("sshAgent.useAgent")}</ConfigButton>
          <ConfigButton disabled={c.busy || c.discovering} onClick={() => void c.refresh()}>{t(c.discovering ? "sshAgent.refreshing" : "sshAgent.refresh")}</ConfigButton>
        </div>
        <p style={muted}>{t("sshAgent.discoveryHelp")}</p>
        <p style={muted}>{t("sshAgent.switchHelp")}</p>
        <details><summary>{t("sshAgent.addSocket")}</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <label style={field}>{t("sshAgent.socketLabel")}<input maxLength={80} value={socketLabel} disabled={disabled} onChange={event => setSocketLabel(event.target.value)} /></label>
            <label style={field}>{t("sshAgent.socketPath")}<input value={path} disabled={disabled} onChange={event => setPath(event.target.value)} placeholder={t("sshAgent.socketPlaceholder")} /></label>
            <ConfigButton disabled={disabled || !socketLabel.trim() || !path.startsWith("/")} onClick={() => void c.addSocket(path, socketLabel.trim()).then(ok => { if (ok) { setPath(""); setSocketLabel(""); } })}>{t("sshAgent.saveSocket")}</ConfigButton>
            <p style={muted}>{t("sshAgent.socketHelp")}</p>
          </div>
        </details>
      </section>

      <section style={box} aria-label={t("sshAgent.browserSigning")}>
        <ConfigSectionTitle>{t("sshAgent.browserSigning")}</ConfigSectionTitle>
        <p>{t("sshAgent.thisBrowser", { device: c.connection?.device ?? t("sshAgent.notConnected") })}</p>
        {connections.length === 0 && <p>{t("sshAgent.browserDisconnected")}</p>}
        {connections.map(connection => <ConnectionRow key={connection.id} connection={connection} controller={c} disabled={disabled} />)}
        {!c.connection ? <>
          <label style={field}>{t("sshAgent.key")}<select aria-label={t("sshAgent.key")} value={keyId} disabled={disabled || !c.supported} onChange={event => { setKeyId(event.target.value); setUnlockOnConnect(false); }}>
            <option value="">{t("sshAgent.chooseKey")}</option>
            {ownKeys.map(key => <option key={key.id} value={key.id}>{key.name}</option>)}
          </select></label>
          <label style={field}>{t("sshAgent.deviceName")}<input value={device} maxLength={80} disabled={disabled} onChange={event => setDevice(event.target.value)} placeholder={t("sshAgent.devicePlaceholder")} /></label>
          {selectedKey?.policy === "session" && <label><input type="checkbox" checked={unlockOnConnect} disabled={disabled} onChange={event => setUnlockOnConnect(event.target.checked)} /> {t("sshAgent.unlockOnConnect")}</label>}
          <ConfigButton disabled={disabled || !c.supported || !selectedKey || !device.trim()} onClick={() => void c.connect(keyId, device.trim(), selectedKey?.policy === "session" && unlockOnConnect)}>{t("sshAgent.connectActive")}</ConfigButton>
          <p style={muted}>{t("sshAgent.connectHelp")}</p>
        </> : <div style={actions}>
          {c.connection.role === "standby" && <ConfigButton disabled={disabled} onClick={() => void c.makeActive()}>{t("sshAgent.makeActive")}</ConfigButton>}
          {c.connection.state === "locked" && <ConfigButton disabled={disabled || !c.supported} onClick={() => void c.unlock()}>{t("sshAgent.unlock")}</ConfigButton>}
          <ConfigButton variant="danger" onClick={c.disconnect}>{t("sshAgent.disconnect")}</ConfigButton>
        </div>}
        <p style={muted}>{t("sshAgent.sessionWarning")}</p>
        <p style={muted}>{t("sshAgent.detectionWarning")}</p>
      </section>

      <section style={box} aria-label={t("sshAgent.keys")}>
        <ConfigSectionTitle>{t("sshAgent.keys")}</ConfigSectionTitle>
        {!status?.registry.keys.length && <p>{t("sshAgent.noKeys")}</p>}
        {status?.registry.keys.map(key => <KeyRow key={key.id} item={key} controller={c} disabled={disabled} copied={copiedId === key.id} onCopy={() => {
          setLocalError(""); setCopiedId("");
          void copyText(key.publicKey).then(() => setCopiedId(key.id)).catch(() => setLocalError(t("sshAgent.copyFailed")));
        }} />)}
        <p style={muted}>{t("sshAgent.publicKeyHelp")}</p>
        <details><summary>{t("sshAgent.enroll")}</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <label style={field}>{t("sshAgent.keyName")}<input value={name} maxLength={80} disabled={disabled} onChange={event => setName(event.target.value)} /></label>
            <label style={field}>{t("sshAgent.policy")}<select aria-label={t("sshAgent.policy")} value={policy} disabled={disabled} onChange={event => setPolicy(event.target.value as SshKeyPolicy)}>
              <option value="strict">{t("sshAgent.policy.strict")}</option><option value="session">{t("sshAgent.policy.session")}</option>
            </select></label>
            {policy === "session" && <p>{t("sshAgent.sessionWarning")}</p>}
            <label><input type="checkbox" checked={applicationOnly} disabled={disabled} onChange={event => setApplicationOnly(event.target.checked)} /> {t("sshAgent.applicationOnly")}</label>
            <p style={muted}>{t("sshAgent.protectionHelp")}</p>
            <p style={muted}>{t("sshAgent.enrollmentHelp")}</p>
            {hasStaged && <p role="status">{t("sshAgent.resolveStaged")}</p>}
            <ConfigButton disabled={disabled || !c.supported || !status?.registry.revision || !name.trim() || hasStaged} onClick={() => void c.enroll(name.trim(), policy, applicationOnly).then(ok => { if (ok) { setName(""); setPolicy("strict"); setApplicationOnly(false); } })}>{t("sshAgent.enroll")}</ConfigButton>
          </div>
        </details>
      </section>

      {c.recovery.map(item => <RecoveryRow key={item.storageKey} item={item} controller={c} disabled={disabled} />)}

      <section style={box} aria-label={t("sshAgent.notifications")}>
        <label><input type="checkbox" checked={c.notificationsEnabled} disabled={c.notificationBusy} onChange={event => void c.toggleNotifications(event.target.checked)} /> {t("sshAgent.notifications")}</label>
        <p style={muted}>{t("sshAgent.notificationHelp")}</p>
        {c.notificationStatus && <p role="status">{c.notificationStatus}</p>}
      </section>

      <details><summary>{t("sshAgent.advanced")}</summary>
        <div style={{ display: "grid", gap: 8, overflowWrap: "anywhere", marginTop: 8 }}>
          <p>{t("sshAgent.endpointPassive", { present: t(status?.runtime.endpointPresent ? "sshAgent.yes" : "sshAgent.no") })}</p>
          <label style={field}>{t("sshAgent.managedSocket")}<code>{status?.runtime.socketPath}</code></label>
          <label style={field}>{t("sshAgent.inheritedSocket")}<code>{status?.runtime.inheritedSocket ?? t("sshAgent.notAvailable")}</code></label>
          {c.candidates.map((candidate, index) => <div key={`${candidate.path}:${index}`} style={box}>
            <strong>{candidate.label}</strong><code>{candidate.path}</code>
            <span>{t(candidate.available ? "sshAgent.probedAvailable" : "sshAgent.probedUnavailable")}{candidate.dynamic ? ` · ${t("sshAgent.dynamic")}` : ""}</span>
            {candidate.error && <p>{candidate.error}</p>}
            {candidate.fingerprints.map(fingerprint => <code key={fingerprint}>{fingerprint}</code>)}
          </div>)}
          <p style={muted}>{t("sshAgent.compatibility")}</p>
        </div>
      </details>
    </ConfigDetailStack>
  </ConfigDetail>;
}

function ConnectionRow({ connection, controller: c, disabled }: { connection: SshDisplayConnection; controller: SshAgentController; disabled: boolean }) {
  const { t } = useI18n();
  const key = c.status?.registry.keys.find(item => item.id === connection.keyId);
  const localOrigin = connection.origin === c.origin;
  return <div style={box}>
    <strong>{t("sshAgent.connectionSummary", { device: connection.device, key: key?.name ?? t("sshAgent.unknown"), role: t(`sshAgent.role.${connection.role}`) })}</strong>
    <span>{t(`sshAgent.state.${connection.state}`)}{connection.state === "unlocked" && connection.unlockDeadline !== null && <> · <RemainingUnlock deadline={connection.unlockDeadline} /></>}</span>
    {key && <span style={muted}>{t(`sshAgent.policy.${key.policy}`)}</span>}
    <span style={muted}>{t("sshAgent.pendingCount", { count: connection.pendingCount })}</span>
    {c.connection?.id === connection.id && <span>{t("sshAgent.thisDevice")}</span>}
    {!localOrigin && <p>{t("sshAgent.originMismatch")}</p>}
    {localOrigin && <div style={actions}>
      {(connection.state === "locked" || connection.state === "unlocked") && <ConfigButton disabled={disabled} onClick={() => void c.lock(connection.id)}>{t("sshAgent.lock")}</ConfigButton>}
      {c.connection?.id !== connection.id && <ConfigButton variant="danger" disabled={disabled} onClick={() => void c.revoke(connection.id)}>{t("sshAgent.revokeConnection")}</ConfigButton>}
    </div>}
  </div>;
}

function RemainingUnlock({ deadline }: { deadline: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span>{t("sshAgent.remaining", { minutes: Math.ceil(Math.max(0, deadline - now) / 60_000) })}</span>;
}

function KeyRow({ item, controller: c, disabled, copied, onCopy }: { item: SshKeyView; controller: SshAgentController; disabled: boolean; copied: boolean; onCopy: () => void }) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.name);
  const [removing, setRemoving] = useState(false);
  const readOnly = item.origin !== c.origin;
  return <div style={box}>
    <strong>{item.name}</strong><span style={muted}>{t(`sshAgent.policy.${item.policy}`)}</span>
    {readOnly && <p>{t("sshAgent.originMismatch")}</p>}
    <div style={actions}>
      <ConfigButton onClick={onCopy}>{t(copied ? "sshAgent.copied" : "sshAgent.copyKey")}</ConfigButton>
      {!readOnly && <>
        <ConfigButton disabled={disabled} onClick={() => { setRenaming(!renaming); setName(item.name); setRemoving(false); }}>{t("sshAgent.rename")}</ConfigButton>
        <ConfigButton variant="danger" disabled={disabled} onClick={() => { setRemoving(true); setRenaming(false); }}>{t("sshAgent.remove")}</ConfigButton>
      </>}
    </div>
    {renaming && <div style={actions}>
      <label style={field}>{t("sshAgent.keyName")}<input maxLength={80} disabled={disabled} value={name} onChange={event => setName(event.target.value)} /></label>
      <ConfigButton disabled={disabled || !name.trim()} onClick={() => void c.renameKey(item.id, name.trim()).then(ok => { if (ok) setRenaming(false); })}>{t("sshAgent.saveName")}</ConfigButton>
      <ConfigButton disabled={disabled} onClick={() => setRenaming(false)}>{t("sshAgent.cancel")}</ConfigButton>
    </div>}
    {removing && <div style={box}>
      <p>{t("sshAgent.removeWarning", { name: item.name })}</p>
      <div style={actions}>
        <ConfigButton variant="danger" disabled={disabled} onClick={() => void c.removeKey(item.id).then(ok => { if (ok) setRemoving(false); })}>{t("sshAgent.confirmRemove")}</ConfigButton>
        <ConfigButton disabled={disabled} onClick={() => setRemoving(false)}>{t("sshAgent.cancel")}</ConfigButton>
      </div>
    </div>}
    <details><summary>{t("sshAgent.keyDetails")}</summary>
      <div style={{ display: "grid", gap: 8, overflowWrap: "anywhere", marginTop: 8 }}>
        <span>{t("sshAgent.origin", { origin: item.origin })}</span>
        <span>{t("sshAgent.protection", { protection: item.protection === null ? t("sshAgent.unknown") : String(item.protection) })}</span>
        <span>{t("sshAgent.discoverability", { value: t(`sshAgent.discoverability.${item.discoverability}`) })}</span>
        {item.applicationOnly && <span>{t("sshAgent.applicationOnlyRecord")}</span>}
        <code>{item.fingerprint}</code>
        <label style={field}>{t("sshAgent.publicKey")}<textarea aria-label={t("sshAgent.publicKey")} readOnly value={item.publicKey} rows={3} style={{ width: "100%", fontFamily: "monospace" }} /></label>
        <p style={muted}>{t("sshAgent.protectionHelp")}</p>
      </div>
    </details>
  </div>;
}

function RecoveryRow({ item, controller: c, disabled }: { item: SshRecoveryItem; controller: SshAgentController; disabled: boolean }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const existing = c.status?.registry.keys.find(key => key.origin === item.credential.origin && key.credential.id === item.credential.id && key.credential.spki === item.credential.spki);
  return <section style={box} aria-label={t("sshAgent.recovery")}>
    <strong>{t(item.source === "legacy" ? "sshAgent.legacyFound" : "sshAgent.stagedFound")}</strong>
    <p>{t("sshAgent.importHelp")}</p>
    {item.persistent === false && <p role="alert">{t("sshAgent.storageFailed")}</p>}
    {item.credential.origin !== c.origin ? <p>{t("sshAgent.originMismatch")}</p> : <>
      {existing ? <strong>{existing.name}</strong> : <label style={field}>{t("sshAgent.keyName")}<input value={name} maxLength={80} disabled={disabled} onChange={event => setName(event.target.value)} /></label>}
      <label><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={event => setAcknowledged(event.target.checked)} /> {t(existing ? "sshAgent.verifyExistingAcknowledge" : "sshAgent.importAcknowledge")}</label>
      <ConfigButton disabled={disabled || !c.supported || !c.status?.registry.revision || !acknowledged || (!existing && !name.trim())} onClick={() => void c.importKey(item, existing?.name ?? name.trim())}>{t(existing ? "sshAgent.verifyExisting" : "sshAgent.importStrict")}</ConfigButton>
    </>}
  </section>;
}
