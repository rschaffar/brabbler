import type { BrowserSshAssertion, BrowserSshCredential } from "./browser-ssh-protocol";
import type { SshEnrollmentBegin, SshWireRegistration } from "./ssh-agent-types";

/** Generic originals are read-only forever: older tabs need not cooperate with migration. */
export const BROWSER_SSH_STORAGE_KEY = "brabbler:browser-ssh-credential:v1";
export const BROWSER_SSH_STAGED_KEY = "brabbler:browser-ssh-staged:v1";
export type SshPublicRecovery = BrowserSshCredential & { origin: string };

export class BrowserSshHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export class BrowserSshClientError extends Error {
  constructor(public readonly code: "credentialUnsupported" | "noCredential" | "invalidRp" | "invalidCredential" | "recoveryPending") { super(code); }
}
export function encodeBrowserBytes(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeBrowserBytes(value: string): Uint8Array<ArrayBuffer> {
  if (value.length > 32768 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new BrowserSshClientError("invalidCredential");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
}

/** Direct JSON, no envelope. Only discovery gets a longer budget; mutations are never retried. */
export async function browserSshApi<T>(body: Record<string, unknown>, signal?: AbortSignal, options?: { keepalive?: boolean }): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), body.action === "discover" ? 10_000 : 5000);
  try {
    const response = await fetch("/api/ssh-agent", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: controller.signal, cache: "no-store", credentials: "same-origin", keepalive: options?.keepalive,
    });
    const data: unknown = response.ok ? await response.json() : await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new BrowserSshHttpError(response.status, message);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function browserSshOriginSupported(origin: string): boolean {
  try {
    const url = new URL(origin), host = url.hostname;
    return url.origin === origin && Boolean(host) && !host.endsWith(".") && !host.includes(":") && !/^\d+(?:\.\d+){3}$/.test(host)
      && (url.protocol === "https:" || (url.protocol === "http:" && host === "localhost"));
  } catch { return false; }
}
function checkRp(rpId: string) {
  // Do not silently replace an unexpected server RP with a different credential scope.
  if (!browserSshOriginSupported(location.origin) || rpId !== location.hostname) throw new BrowserSshClientError("invalidRp");
}

type ProtectionExtensions = AuthenticationExtensionsClientInputs & {
  credentialProtectionPolicy: "userVerificationRequired" | "userVerificationOptionalWithCredentialIDList";
  enforceCredentialProtectionPolicy: boolean;
};

/** Creation only. Caller must stage public metadata, prepare, then prove possession with fresh UV. */
export async function enrollBrowserSshCredential(
  begin: SshEnrollmentBegin,
  applicationOnly: boolean,
  signal: AbortSignal,
  onCreated: (credential: BrowserSshCredential) => void,
): Promise<SshWireRegistration> {
  checkRp(begin.rpId);
  const extensions: ProtectionExtensions = {
    credProps: true,
    credentialProtectionPolicy: begin.policy === "strict" ? "userVerificationRequired" : "userVerificationOptionalWithCredentialIDList",
    enforceCredentialProtectionPolicy: !applicationOnly,
  };
  const result = await navigator.credentials.create({ signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), publicKey: {
    challenge: decodeBrowserBytes(begin.challenge),
    rp: { id: begin.rpId, name: "Brabbler SSH" },
    user: { id: crypto.getRandomValues(new Uint8Array(32)), name: "brabbler-ssh", displayName: "Brabbler SSH" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "discouraged", userVerification: "required" },
    extensions, attestation: "none", timeout: 60_000,
  } }) as PublicKeyCredential | null;
  const response = result?.response as AuthenticatorAttestationResponse | undefined;
  const spki = response?.getPublicKey?.();
  if (!result || !response || !spki || response.getPublicKeyAlgorithm?.() !== -7) throw new BrowserSshClientError("credentialUnsupported");
  const credential = { id: encodeBrowserBytes(result.rawId), spki: encodeBrowserBytes(spki) };
  // Preserve recovery metadata even if response extraction, server validation or proof later fails.
  onCreated(credential);
  if (!response.getAuthenticatorData) throw new BrowserSshClientError("credentialUnsupported");
  const rk = result.getClientExtensionResults().credProps?.rk;
  return {
    ...credential, algorithm: -7,
    clientDataJSON: encodeBrowserBytes(response.clientDataJSON),
    authenticatorData: encodeBrowserBytes(response.getAuthenticatorData()),
    ...(typeof rk === "boolean" ? { discoverable: rk } : {}),
  };
}

/** UV policy comes only from a server proof or admitted signing request, never a UI preference. */
export async function requestBrowserSshAssertion(
  credential: BrowserSshCredential,
  challenge: string,
  signal: AbortSignal,
  options: { rpId: string; userVerification: "required" | "discouraged" } = { rpId: location.hostname, userVerification: "required" },
): Promise<BrowserSshAssertion> {
  checkRp(options.rpId);
  const result = await navigator.credentials.get({ signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), publicKey: {
    rpId: options.rpId, challenge: decodeBrowserBytes(challenge),
    allowCredentials: [{ type: "public-key", id: decodeBrowserBytes(credential.id) }],
    userVerification: options.userVerification, timeout: 60_000,
  } }) as PublicKeyCredential | null;
  if (!result) throw new BrowserSshClientError("noCredential");
  const response = result.response as AuthenticatorAssertionResponse;
  return {
    id: encodeBrowserBytes(result.rawId), clientData: encodeBrowserBytes(response.clientDataJSON),
    authenticatorData: encodeBrowserBytes(response.authenticatorData), signature: encodeBrowserBytes(response.signature),
  };
}

/** New writes have identity-bound keys, never a shared mutable slot or manifest. */
export const BROWSER_SSH_STAGED_PREFIX = "brabbler:browser-ssh-staged:v2:";
export const BROWSER_SSH_ACK_PREFIX = "brabbler:browser-ssh-ack:v1:";
export const SSH_RECOVERY_MAX_RECORDS = 8;
// Storage has no prefix iterator. Inspect at most this many key names, but read values
// only for the two exact legacy slots, eight matching staged keys and exact hint keys.
export const SSH_RECOVERY_MAX_KEY_SCAN = 512;
export type SshRecoveryStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type SshPublicRecoveryItem = { source: "legacy" | "staged"; storageKey: string; credential: SshPublicRecovery; persistent: boolean };
export type SshRecoveryIssue = "recoveryStorageUnavailable" | "recoveryMalformed" | "recoveryLimit" | "ackMissing";
export type SshRecoveryHint = { recordId: string; spki: string; origin: string };
export type SshRecoveryRegistry = { revision: string | null; keys: readonly { id: string; origin: string; credential: BrowserSshCredential }[]; error?: string };
export type SshRecoveryAcknowledgement = {
  record: { id: string; origin: string; credential: BrowserSshCredential };
  snapshot: { revision: string; keys: { id: string; origin: string; credential: BrowserSshCredential }[] };
};

function recoveryStorage(storage?: SshRecoveryStorage | null): SshRecoveryStorage | null {
  if (storage !== undefined) return storage;
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function publicRecovery(value: unknown): SshPublicRecovery | null {
  if (!value || typeof value !== "object" || !("origin" in value) || !("id" in value) || !("spki" in value)) return null;
  if (typeof value.origin !== "string" || value.origin.length > 2048 || typeof value.id !== "string" || typeof value.spki !== "string") return null;
  if (!/^[A-Za-z0-9_-]{1,1400}$/.test(value.id) || !/^[A-Za-z0-9_-]{1,400}$/.test(value.spki)) return null;
  try {
    const url = new URL(value.origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value.origin) return null;
  } catch { return null; }
  return { origin: value.origin, id: value.id, spki: value.spki };
}
function parseRecovery(raw: string): SshPublicRecovery | null {
  try { return raw.length <= 8192 ? publicRecovery(JSON.parse(raw)) : null; } catch { return null; }
}
function sameRecovery(a: SshPublicRecovery, b: SshPublicRecovery): boolean {
  return a.id === b.id && a.spki === b.spki && a.origin === b.origin;
}
function publicIdentity(credential: SshPublicRecovery): string {
  if (!publicRecovery(credential)) throw new BrowserSshClientError("invalidCredential");
  // Base64url fields cannot contain ':', and encodeURIComponent escapes origin separators.
  // Including both original id and SPKI makes distinct identities collision-free without async hashing.
  return `${encodeURIComponent(credential.origin)}:${credential.id}:${credential.spki}`;
}
export function sshRecoveryStagedKey(credential: SshPublicRecovery): string { return BROWSER_SSH_STAGED_PREFIX + publicIdentity(credential); }
export function sshRecoveryHintKey(credential: SshPublicRecovery): string { return BROWSER_SSH_ACK_PREFIX + publicIdentity(credential); }
function uniqueIssues(issues: SshRecoveryIssue[]): SshRecoveryIssue[] { return [...new Set(issues)]; }
function stagedKeys(storage: SshRecoveryStorage): { keys: string[]; limited: boolean } {
  const length = storage.length;
  const keys = new Set<string>();
  let limited = length > SSH_RECOVERY_MAX_KEY_SCAN;
  for (let index = 0; index < Math.min(length, SSH_RECOVERY_MAX_KEY_SCAN); index++) {
    const key = storage.key(index);
    if (!key?.startsWith(BROWSER_SSH_STAGED_PREFIX)) continue;
    if (keys.size === SSH_RECOVERY_MAX_RECORDS && !keys.has(key)) { limited = true; continue; }
    keys.add(key);
  }
  return { keys: [...keys], limited };
}

/** Inert public recovery data only; never creates a connection, assertion or unlock grant. */
export function loadSshPublicRecovery(storage?: SshRecoveryStorage | null): { items: SshPublicRecoveryItem[]; issues: SshRecoveryIssue[] } {
  const target = recoveryStorage(storage);
  const items: SshPublicRecoveryItem[] = [], issues: SshRecoveryIssue[] = [];
  if (!target) return { items, issues: ["recoveryStorageUnavailable"] };
  const read = (storageKey: string, source: SshPublicRecoveryItem["source"], identityBound: boolean) => {
    try {
      const raw = target.getItem(storageKey);
      if (raw === null) return;
      const credential = parseRecovery(raw);
      if (!credential || (identityBound && sshRecoveryStagedKey(credential) !== storageKey)) { issues.push("recoveryMalformed"); return; }
      items.push({ storageKey, source, credential, persistent: true });
    } catch { issues.push("recoveryStorageUnavailable"); }
  };
  // Invalid originals are reported, never erased, normalized or quoted in the UI.
  read(BROWSER_SSH_STORAGE_KEY, "legacy", false);
  read(BROWSER_SSH_STAGED_KEY, "staged", false);
  try {
    const scanned = stagedKeys(target);
    if (scanned.limited) issues.push("recoveryLimit");
    for (const key of scanned.keys) read(key, "staged", true);
  } catch { issues.push("recoveryStorageUnavailable"); }
  return { items, issues: uniqueIssues(issues) };
}

/** Even a failed/over-budget write returns the complete in-page public item. No generic writes. */
export function stageSshPublicRecovery(credential: SshPublicRecovery, storage?: SshRecoveryStorage | null): { item: SshPublicRecoveryItem; issues: SshRecoveryIssue[] } {
  const normalized = publicRecovery(credential);
  if (!normalized) throw new BrowserSshClientError("invalidCredential");
  const item: SshPublicRecoveryItem = { source: "staged", storageKey: sshRecoveryStagedKey(normalized), credential: normalized, persistent: false };
  const target = recoveryStorage(storage);
  if (!target) return { item, issues: ["recoveryStorageUnavailable"] };
  try {
    const existing = target.getItem(item.storageKey);
    if (existing !== null) {
      const parsed = parseRecovery(existing);
      if (!parsed || !sameRecovery(parsed, normalized)) return { item, issues: ["recoveryMalformed"] };
      item.persistent = true; return { item, issues: [] };
    }
    const scanned = stagedKeys(target);
    if (scanned.limited || scanned.keys.length >= SSH_RECOVERY_MAX_RECORDS) return { item, issues: ["recoveryLimit"] };
    // Different tabs/credentials never share this key. There is no shared slot to lose a race on.
    target.setItem(item.storageKey, JSON.stringify(normalized)); item.persistent = true;
    return { item, issues: [] };
  } catch { return { item, issues: ["recoveryStorageUnavailable"] }; }
}

function publicHint(value: unknown): SshRecoveryHint | null {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 3 || !("recordId" in value) || !("spki" in value) || !("origin" in value)) return null;
  if (typeof value.recordId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.recordId) || typeof value.spki !== "string" || typeof value.origin !== "string") return null;
  return { recordId: value.recordId, spki: value.spki, origin: value.origin };
}

function publicAcknowledgementRecord(value: unknown): { id: string; credential: SshPublicRecovery } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("id" in value) || !("origin" in value) || !("credential" in value)) return null;
  const candidate = value.credential;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !("id" in candidate) || !("spki" in candidate)) return null;
  const credential = publicRecovery({ id: candidate.id, spki: candidate.spki, origin: value.origin });
  if (!credential) return null;
  const hint = publicHint({ recordId: value.id, spki: credential.spki, origin: credential.origin });
  return hint ? { id: hint.recordId, credential } : null;
}

/** Durable matching ack permits deleting ONLY its new identity-bound staged slot.
 * Validate original credential ID/SPKI/origin in BOTH record and its snapshot row
 * before touching any storage. HTTP success or an ID/revision alone is insufficient.
 * Both generic originals survive forever, even if an older tab replaces them during this call.
 */
export function acknowledgeSshPublicRecovery(item: SshPublicRecoveryItem, ack: unknown, storage?: SshRecoveryStorage | null): { hint: SshRecoveryHint | null; issues: SshRecoveryIssue[] } {
  if (!ack || typeof ack !== "object" || Array.isArray(ack) || !("record" in ack) || !("snapshot" in ack)) return { hint: null, issues: ["ackMissing"] };
  const record = publicAcknowledgementRecord(ack.record);
  const snapshot = ack.snapshot;
  if (!record || !sameRecovery(record.credential, item.credential) || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("revision" in snapshot) || typeof snapshot.revision !== "string" || !snapshot.revision || !("keys" in snapshot) || !Array.isArray(snapshot.keys)) return { hint: null, issues: ["ackMissing"] };
  const matchingRow = snapshot.keys.some(value => {
    const row = publicAcknowledgementRecord(value);
    return row && row.id === record.id && sameRecovery(row.credential, item.credential);
  });
  if (!matchingRow) return { hint: null, issues: ["ackMissing"] };
  const acknowledged = record.credential;
  const hint: SshRecoveryHint = { recordId: record.id, spki: acknowledged.spki, origin: acknowledged.origin };
  const target = recoveryStorage(storage);
  if (!target) return { hint, issues: ["recoveryStorageUnavailable"] };
  try {
    target.setItem(sshRecoveryHintKey(acknowledged), JSON.stringify(hint));
    const uniqueKey = sshRecoveryStagedKey(acknowledged);
    if (item.storageKey === uniqueKey) {
      const raw = target.getItem(uniqueKey);
      if (raw !== null) {
        const current = parseRecovery(raw);
        // Corrupt/mis-keyed values are evidence to preserve, not cleanup targets.
        if (!current || !sameRecovery(current, acknowledged)) return { hint, issues: ["recoveryMalformed"] };
        target.removeItem(uniqueKey);
      }
    }
    return { hint, issues: [] };
  } catch { return { hint, issues: ["recoveryStorageUnavailable"] }; }
}

/** Hints suppress recovery chrome ONLY while the latest successful registry contains
 * their exact record ID/origin/public credential. No connection, credential use, grant or authority is restored.
 * In-page hints permit the same narrow UI behavior when localStorage is blocked.
 */
export function visibleSshPublicRecovery(
  items: readonly SshPublicRecoveryItem[], registry: SshRecoveryRegistry | null,
  storage?: SshRecoveryStorage | null, inPageHints: ReadonlyMap<string, SshRecoveryHint> = new Map(),
): { items: SshPublicRecoveryItem[]; issues: SshRecoveryIssue[] } {
  const target = recoveryStorage(storage);
  const issues: SshRecoveryIssue[] = [];
  const visible = items.filter(item => {
    const key = sshRecoveryHintKey(item.credential);
    let hint = publicHint(inPageHints.get(key));
    if (!hint) {
      try {
        if (!target) issues.push("recoveryStorageUnavailable");
        const raw = target?.getItem(key);
        if (raw != null) {
          try { hint = raw.length <= 8192 ? publicHint(JSON.parse(raw)) : null; } catch { /* Report without quoting the raw contents. */ }
          if (!hint) issues.push("recoveryMalformed");
        }
      } catch { issues.push("recoveryStorageUnavailable"); }
    }
    const acceptedHint = hint;
    const confirmed = acceptedHint && acceptedHint.spki === item.credential.spki && acceptedHint.origin === item.credential.origin && registry?.revision && !registry.error && registry.keys.some(record => record.id === acceptedHint.recordId && record.origin === acceptedHint.origin && record.credential?.id === item.credential.id && record.credential.spki === item.credential.spki);
    return !confirmed;
  });
  return { items: visible, issues: uniqueIssues(issues) };
}
