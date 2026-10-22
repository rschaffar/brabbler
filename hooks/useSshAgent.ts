"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  BROWSER_SSH_STORAGE_KEY, BROWSER_SSH_STAGED_KEY, BROWSER_SSH_STAGED_PREFIX, BROWSER_SSH_ACK_PREFIX,
  BrowserSshClientError, BrowserSshHttpError, browserSshApi, browserSshOriginSupported, enrollBrowserSshCredential,
  loadSshPublicRecovery, stageSshPublicRecovery, acknowledgeSshPublicRecovery, visibleSshPublicRecovery,
  sshRecoveryHintKey, sshRecoveryStagedKey, requestBrowserSshAssertion,
  type SshPublicRecoveryItem, type SshRecoveryAcknowledgement, type SshRecoveryHint, type SshRecoveryIssue, type SshRecoveryRegistry,
} from "@/lib/browser-ssh-client";
import { shouldShowBrowserNotification, showBrowserNotification } from "@/lib/browser-notifications";
import type {
  SshAgentStatus, SshBackend, SshCandidate, SshConnectionProof, SshConnectionView,
  SshEnrollmentBegin, SshEnrollmentProof, SshKeyPolicy, SshPoll, SshSigningRequest,
} from "@/lib/ssh-agent-types";

export type SshAuthState = "checking" | "ready" | "password-required" | "login-required" | "error";
export type SshApprovalStage = "unlock" | "sign";
export type SshRecoveryItem = SshPublicRecoveryItem;
export type SshPendingRequest = SshSigningRequest & { deadline: number };
export type SshDisplayConnection = SshConnectionView & { unlockDeadline: number | null };
type DisplayStatus = Omit<SshAgentStatus, "connections"> & { connections: SshDisplayConnection[] };
type OwnedConnection = SshConnectionProof & { view: SshDisplayConnection };
type Operation = { controller: AbortController; requestId?: string; submitted?: boolean; authorizingUnlock?: SshSigningRequest };
type RequestUnlockBegin =
  | { alreadyUnlocked: true; status: SshAgentStatus; request: SshSigningRequest }
  | (Omit<SshEnrollmentProof, "token"> & { alreadyUnlocked: false; requestId: string });
type RequestUnlockFinish = { status: SshAgentStatus; request: SshSigningRequest; newGrant: boolean };
type EnrollmentAck = SshRecoveryAcknowledgement;
const NOTIFY_KEY = "pi-web:ssh-local-notifications:v1";

function sameSigningPayload(a: SshSigningRequest, b: SshSigningRequest): boolean {
  return a.id === b.id && a.challenge === b.challenge && a.fingerprint === b.fingerprint && a.description === b.description;
}
function isRequestUnlockTransition(before: SshSigningRequest, after: SshSigningRequest): boolean {
  return sameSigningPayload(before, after) && before.userVerification === "required" && before.unlock === true && after.userVerification === "discouraged" && after.unlock === false;
}

/** Mount exactly once above Settings visibility. No automatic enrollment, connect, takeover or discovery. */
export function useSshAgent() {
  const { t } = useI18n();
  const [status, setStatus] = useState<DisplayStatus | null>(null);
  const [auth, setAuth] = useState<SshAuthState>("checking");
  const [supported, setSupported] = useState(false);
  const [origin, setOrigin] = useState("");
  const [connection, setConnection] = useState<OwnedConnection | null>(null);
  const [requests, setRequests] = useState<SshPendingRequest[]>([]);
  const [reviewedId, setReviewedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalStage, setApprovalStage] = useState<SshApprovalStage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState<SshCandidate[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [recovery, setRecovery] = useState<SshRecoveryItem[]>([]);
  const [recoveryIssues, setRecoveryIssues] = useState<SshRecoveryIssue[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationBusy, setNotificationBusy] = useState(false);
  const alive = useRef(false);
  const owned = useRef<OwnedConnection | null>(null);
  const currentStatus = useRef<SshAgentStatus | null>(null);
  const recoveryItems = useRef<SshRecoveryItem[]>([]);
  const inPageRecovery = useRef(new Map<string, SshRecoveryItem>());
  const recoveryHints = useRef(new Map<string, SshRecoveryHint>());
  const currentRequests = useRef<SshPendingRequest[]>([]);
  const requestDeadlines = useRef(new Map<string, number>());
  const grantDeadlines = useRef(new Map<string, number>());
  const review = useRef<string | null>(null);
  const operation = useRef<Operation | null>(null);
  const authState = useRef<SshAuthState>("checking");
  const epoch = useRef(0);
  const statusRead = useRef(0);
  const discovery = useRef<AbortController | null>(null);
  const terminalRequests = useRef(new Set<string>());
  const notified = useRef(new Set<string>());
  const notifications = useRef(new Map<string, Notification>());

  const noteRecoveryIssues = useCallback((issues: SshRecoveryIssue[]) => {
    if (issues.length) setRecoveryIssues(current => [...new Set([...current, ...issues])]);
  }, []);
  const reconcileRecovery = useCallback((registry: SshRecoveryRegistry | null) => {
    // Hints are only recovery-UI de-duplication, always gated by the latest server registry.
    // They never touch owned connections, operations, grants or assertion policy.
    const result = visibleSshPublicRecovery(recoveryItems.current, registry, undefined, recoveryHints.current);
    setRecovery(result.items); noteRecoveryIssues(result.issues);
    return result.items;
  }, [noteRecoveryIssues]);
  const reloadRecovery = useCallback(() => {
    const loaded = loadSshPublicRecovery();
    const combined = new Map(loaded.items.map(item => [item.storageKey, item]));
    // Keep every new public identity created by this page, including quota/blocked-storage failures.
    for (const [key, item] of inPageRecovery.current) combined.set(key, item);
    recoveryItems.current = [...combined.values()]; noteRecoveryIssues(loaded.issues);
    return reconcileRecovery(currentStatus.current?.registry ?? null);
  }, [reconcileRecovery, noteRecoveryIssues]);
  const changeAuth = useCallback((next: SshAuthState) => { authState.current = next; setAuth(next); }, []);
  const chooseReview = useCallback((id: string | null) => { review.current = id; setReviewedId(id); }, []);
  const publishRequests = useCallback((next: SshPendingRequest[]) => {
    const visible = next.filter(item => item.deadline > performance.now() && !terminalRequests.current.has(item.id));
    const changed = (id: string) => {
      const before = currentRequests.current.find(item => item.id === id);
      const after = visible.find(item => item.id === id);
      if (!before || !after) return false;
      const op = operation.current;
      // A poll may observe the server's unlock before finish-request-unlock replies.
      // Only this explicitly authorizing request may retain review across this one
      // direction of policy change. Another request, changed payload or relock never qualifies.
      const authorizedTransition = op?.requestId === id && op.authorizingUnlock && sameSigningPayload(op.authorizingUnlock, before) && isRequestUnlockTransition(before, after);
      return !sameSigningPayload(before, after) || ((before.userVerification !== after.userVerification || before.unlock !== after.unlock) && !authorizedTransition);
    };
    if (review.current && changed(review.current)) chooseReview(null);
    if (operation.current?.requestId && changed(operation.current.requestId)) operation.current.controller.abort("request-changed");
    currentRequests.current = visible; setRequests(visible);
    if (review.current && !visible.some(item => item.id === review.current)) chooseReview(null);
    const prompting = operation.current?.requestId;
    if (prompting && !operation.current?.submitted && !visible.some(item => item.id === prompting)) operation.current?.controller.abort("request-settled");
    for (const [id, notification] of notifications.current) {
      if (!visible.some(item => item.id === id)) { notification.close(); notifications.current.delete(id); }
    }
  }, [chooseReview]);
  const receiveRequests = useCallback((next: SshSigningRequest[], sampledAt: number) => {
    const normalized = next.map(item => {
      const remaining = Number.isFinite(item.remainingMs) ? Math.max(0, item.remainingMs) : 0;
      // Anchor at request start: conservatively include network time, never add time on a later poll.
      const proposed = sampledAt + remaining;
      const deadline = Math.min(requestDeadlines.current.get(item.id) ?? proposed, proposed);
      requestDeadlines.current.set(item.id, deadline);
      return { ...item, deadline };
    });
    publishRequests(normalized);
  }, [publishRequests]);
  const loseConnection = useCallback(() => {
    operation.current?.controller.abort("connection-lost");
    owned.current = null; setConnection(null); publishRequests([]);
    terminalRequests.current.clear(); notified.current.clear(); requestDeadlines.current.clear();
  }, [publishRequests]);
  const applyStatus = useCallback((next: SshAgentStatus, sampledAt: number) => {
    const normalized: DisplayStatus = { ...next, connections: next.connections.map(item => {
      if (item.state !== "unlocked") { grantDeadlines.current.delete(item.id); return { ...item, unlockDeadline: null }; }
      const remaining = Number.isFinite(item.remainingMs) ? Math.max(0, item.remainingMs) : 0;
      const proposed = sampledAt + remaining;
      const unlockDeadline = Math.min(grantDeadlines.current.get(item.id) ?? proposed, proposed);
      grantDeadlines.current.set(item.id, unlockDeadline);
      return { ...item, unlockDeadline };
    }) };
    for (const id of grantDeadlines.current.keys()) if (!next.connections.some(item => item.id === id)) grantDeadlines.current.delete(id);
    statusRead.current++; currentStatus.current = next; setStatus(normalized);
    reconcileRecovery(next.registry);
    const own = owned.current;
    if (own) {
      const view = normalized.connections.find(item => item.id === own.id);
      if (!view) loseConnection();
      else { const updated = { ...own, view }; owned.current = updated; setConnection(updated); }
    }
  }, [loseConnection, reconcileRecovery]);
  const reportFailure = useCallback((failure: unknown) => {
    if (failure instanceof BrowserSshHttpError && (failure.status === 401 || failure.status === 403)) {
      changeAuth("login-required"); loseConnection(); discovery.current?.abort();
    }
    setError(failure instanceof BrowserSshClientError ? t(`sshAgent.${failure.code}`) : failure instanceof Error ? failure.message : t("sshAgent.failed"));
  }, [changeAuth, loseConnection, t]);
  const readStatus = useCallback(async (signal?: AbortSignal) => {
    const version = ++statusRead.current;
    const started = epoch.current;
    const sampledAt = performance.now();
    const next = await browserSshApi<SshAgentStatus>({ action: "status" }, signal);
    if (alive.current && !signal?.aborted && started === epoch.current && version === statusRead.current) applyStatus(next, sampledAt);
    return next;
  }, [applyStatus]);
  const probeAuth = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/web-auth", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new BrowserSshHttpError(response.status, `HTTP ${response.status}`);
    const result = await response.json() as { enabled?: boolean; authenticated?: boolean };
    if (signal.aborted || !alive.current) return false;
    if (result.enabled !== true) { changeAuth("password-required"); loseConnection(); return false; }
    if (result.authenticated !== true) { changeAuth("login-required"); loseConnection(); return false; }
    // GET accepts Basic too; a single SSH 403 below closes this gate until explicit Refresh.
    changeAuth("ready"); return true;
  }, [changeAuth, loseConnection]);

  const refresh = useCallback(async () => {
    if (operation.current || discovery.current || !alive.current) return;
    reloadRecovery();
    const controller = new AbortController();
    // Reserve the discovery slot to serialize user Refresh with initial/background status reads.
    discovery.current = controller; setDiscovering(true); setError("");
    try {
      if (!await probeAuth(controller.signal)) return;
      await readStatus(controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      const next = await browserSshApi<SshCandidate[]>({ action: "discover" }, controller.signal);
      if (!controller.signal.aborted && alive.current) setCandidates(next);
    } catch (failure) {
      if (!controller.signal.aborted && alive.current) reportFailure(failure);
    } finally {
      if (discovery.current === controller) discovery.current = null;
      if (alive.current) setDiscovering(false);
    }
  }, [probeAuth, readStatus, reportFailure, reloadRecovery]);

  const cancelDiscovery = useCallback(() => { discovery.current?.abort("settings-closed"); }, []);

  useEffect(() => {
    alive.current = true;
    setOrigin(location.origin);
    setSupported(window.isSecureContext && window.top === window.self && browserSshOriginSupported(location.origin) && typeof PublicKeyCredential !== "undefined");
    reloadRecovery();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === BROWSER_SSH_STORAGE_KEY || event.key === BROWSER_SSH_STAGED_KEY || event.key.startsWith(BROWSER_SSH_STAGED_PREFIX) || event.key.startsWith(BROWSER_SSH_ACK_PREFIX)) reloadRecovery();
    };
    window.addEventListener("storage", storageChanged);
    try {
      const enabled = localStorage.getItem(NOTIFY_KEY) === "true";
      const granted = "Notification" in window && Notification.permission === "granted";
      setNotificationsEnabled(enabled && granted);
      if (enabled && !granted) setNotificationStatus(t("sshAgent.notificationDenied"));
    } catch { /* In-memory opt-in still works. */ }
    const leave = () => {
      epoch.current++; operation.current?.controller.abort("page-leaving"); discovery.current?.abort();
      const own = owned.current; owned.current = null;
      if (own) void browserSshApi({ action: "disconnect", token: own.token }, undefined, { keepalive: true }).catch(() => {});
      for (const notification of notifications.current.values()) notification.close();
      notifications.current.clear();
      if (alive.current) { setConnection(null); publishRequests([]); }
    };
    window.addEventListener("pagehide", leave);
    return () => { alive.current = false; window.removeEventListener("storage", storageChanged); window.removeEventListener("pagehide", leave); leave(); };
  }, [publishRequests, reloadRecovery, t]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { if (await probeAuth(controller.signal)) await readStatus(controller.signal); }
      catch (failure) {
        if (!controller.signal.aborted && alive.current) { changeAuth("error"); reportFailure(failure); }
      }
    })();
    return () => controller.abort();
  }, [probeAuth, readStatus, changeAuth, reportFailure]);

  // Observers refresh status, not discovery and not anybody else's lease. Fail closed on auth errors.
  useEffect(() => {
    if (auth !== "ready" || connection) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || operation.current || discovery.current) return;
      void readStatus(controller.signal).catch(failure => { if (!controller.signal.aborted) reportFailure(failure); });
    }, 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [auth, connection, readStatus, reportFailure]);

  const token = connection?.token;
  useEffect(() => {
    if (!token || auth !== "ready") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const started = epoch.current;
      const sampledAt = performance.now();
      try {
        const snapshot = await browserSshApi<SshPoll>({ action: "poll", token }, controller.signal);
        if (controller.signal.aborted || owned.current?.token !== token) return;
        if (started === epoch.current) {
          applyStatus(snapshot.status, sampledAt);
          if (owned.current?.token === token) receiveRequests(snapshot.requests, sampledAt);
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch (failure) {
        if (controller.signal.aborted || owned.current?.token !== token) return;
        // A missing heartbeat/ambiguous response is not permission to reconnect or sign again.
        loseConnection(); reportFailure(failure);
        void browserSshApi({ action: "disconnect", token }).catch(() => {});
      }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [token, auth, applyStatus, receiveRequests, loseConnection, reportFailure]);

  // A stalled native prompt is cancelled locally at the exact request deadline as well as by poll.
  useEffect(() => {
    if (!requests.length) return;
    const timer = setTimeout(() => publishRequests(currentRequests.current), Math.max(0, Math.min(...requests.map(item => item.deadline)) - performance.now()) + 1);
    return () => clearTimeout(timer);
  }, [requests, publishRequests]);

  const run = useCallback(async (work: (signal: AbortSignal) => Promise<void>, requestId?: string): Promise<boolean> => {
    if (!alive.current || authState.current !== "ready" || operation.current || discovery.current) return false;
    const op: Operation = { controller: new AbortController(), requestId };
    operation.current = op; epoch.current++; setBusy(true); setApprovingId(requestId ?? null); setApprovalStage(null); setError(""); setNotice("");
    try {
      await work(op.controller.signal);
      return !op.controller.signal.aborted;
    } catch (failure) {
      if (alive.current && !op.controller.signal.aborted) reportFailure(failure);
      // Reconcile once, never reissue a write/assertion. Do not claim that the mutation did not apply.
      if (alive.current && authState.current === "ready") {
        setNotice(current => current ? `${current} ${t("sshAgent.reconciled")}` : t("sshAgent.reconciled"));
        try { await readStatus(); } catch (readFailure) { if (alive.current) reportFailure(readFailure); }
      }
      return false;
    } finally {
      if (operation.current === op) operation.current = null;
      epoch.current++;
      if (alive.current) { setBusy(false); setApprovingId(null); setApprovalStage(null); }
    }
  }, [readStatus, reportFailure, t]);

  const mutate = useCallback((body: Record<string, unknown>) => run(async signal => {
    const sampledAt = performance.now();
    const next = await browserSshApi<SshAgentStatus>(body, signal);
    if (!signal.aborted && alive.current) applyStatus(next, sampledAt);
  }), [run, applyStatus]);
  const useAgent = useCallback((backend: SshBackend) => {
    const current = currentStatus.current;
    return current ? mutate({ action: "use", revision: current.runtime.revision, backend }) : Promise.resolve(false);
  }, [mutate]);
  const addSocket = useCallback((path: string, label: string) => {
    const current = currentStatus.current;
    return current ? mutate({ action: "custom", revision: current.runtime.revision, path, label }) : Promise.resolve(false);
  }, [mutate]);
  const renameKey = useCallback((keyId: string, name: string) => {
    const revision = currentStatus.current?.registry.revision;
    return revision ? mutate({ action: "rename", keyId, name, revision }) : Promise.resolve(false);
  }, [mutate]);
  const removeKey = useCallback((keyId: string) => {
    const revision = currentStatus.current?.registry.revision;
    return revision ? mutate({ action: "remove", keyId, revision }) : Promise.resolve(false);
  }, [mutate]);

  const stage = useCallback((credential: { id: string; spki: string }): SshRecoveryItem => {
    const result = stageSshPublicRecovery({ ...credential, origin: location.origin });
    inPageRecovery.current.set(result.item.storageKey, result.item);
    noteRecoveryIssues(result.issues); reloadRecovery();
    return result.item;
  }, [noteRecoveryIssues, reloadRecovery]);
  const acknowledged = useCallback((ack: EnrollmentAck, item: SshRecoveryItem) => {
    const result = acknowledgeSshPublicRecovery(item, ack);
    noteRecoveryIssues(result.issues);
    if (!result.hint) throw new Error(t("sshAgent.ackMissing"));
    recoveryHints.current.set(sshRecoveryHintKey(item.credential), result.hint);
    if (item.storageKey === sshRecoveryStagedKey(item.credential)) {
      // The matching durable ack may remove the unique disk slot. Keep the original
      // in-page copy until a latest registry read confirms the hint; never hide solely on ack.
      inPageRecovery.current.set(item.storageKey, { ...item, persistent: false });
    }
    reloadRecovery();
  }, [noteRecoveryIssues, reloadRecovery, t]);
  const enroll = useCallback((name: string, policy: SshKeyPolicy, applicationOnly: boolean) => run(async signal => {
    if (reloadRecovery().some(item => item.source === "staged")) throw new BrowserSshClientError("recoveryPending");
    const begin = await browserSshApi<SshEnrollmentBegin>({ action: "begin-enroll", name, policy, applicationOnly, revision: currentStatus.current?.registry.revision }, signal);
    try {
      let created: SshRecoveryItem | undefined;
      const registration = await enrollBrowserSshCredential(begin, applicationOnly, signal, credential => {
        created = stage(credential);
      });
      const proof = await browserSshApi<SshEnrollmentProof>({ action: "prepare-enroll", token: begin.token, registration }, signal);
      const assertion = await requestBrowserSshAssertion(proof.credential, proof.challenge, signal, { rpId: proof.rpId, userVerification: "required" });
      const ack = await browserSshApi<EnrollmentAck>({ action: "finish-enroll", token: proof.token, assertion }, signal);
      if (!signal.aborted && alive.current && created) acknowledged(ack, created);
      await readStatus(signal);
    } catch (failure) {
      void browserSshApi({ action: "cancel-enroll", token: begin.token }).catch(() => {});
      throw failure;
    }
  }), [run, stage, acknowledged, readStatus, reloadRecovery]);
  const importKey = useCallback((item: SshRecoveryItem, name: string) => run(async signal => {
    if (item.credential.origin !== location.origin) return;
    const registry = currentStatus.current?.registry;
    const existing = registry?.keys.find(key => key.origin === item.credential.origin && key.credential.id === item.credential.id && key.credential.spki === item.credential.spki);
    const proof = await browserSshApi<SshEnrollmentProof>({ action: "begin-import", name, credential: { id: item.credential.id, spki: item.credential.spki }, applicationOnly: true, revision: registry?.revision, ...(existing ? { existingKeyId: existing.id } : {}) }, signal);
    try {
      const assertion = await requestBrowserSshAssertion(proof.credential, proof.challenge, signal, { rpId: proof.rpId, userVerification: "required" });
      const ack = await browserSshApi<EnrollmentAck>({ action: "finish-enroll", token: proof.token, assertion }, signal);
      if (!signal.aborted && alive.current) acknowledged(ack, item);
      await readStatus(signal);
    } catch (failure) {
      void browserSshApi({ action: "cancel-enroll", token: proof.token }).catch(() => {});
      throw failure;
    }
  }), [run, acknowledged, readStatus]);

  const connect = useCallback((keyId: string, device: string, unlock: boolean) => run(async signal => {
    if (owned.current) return;
    const proof = await browserSshApi<SshConnectionProof>({ action: "connect", keyId, device, makeActive: true, unlock }, signal);
    try {
      const assertion = await requestBrowserSshAssertion(proof.credential, proof.challenge, signal, { rpId: proof.rpId, userVerification: "required" });
      const sampledAt = performance.now();
      const result = await browserSshApi<{ status: SshAgentStatus; connection: SshConnectionView }>({ action: "activate", token: proof.token, assertion }, signal);
      if (signal.aborted || !alive.current) throw new DOMException("", "AbortError");
      terminalRequests.current.clear(); notified.current.clear();
      const next: OwnedConnection = { ...proof, view: { ...result.connection, unlockDeadline: null } };
      owned.current = next; setConnection(next); applyStatus(result.status, sampledAt);
    } catch (failure) {
      // Cleanup is revocation, not a replay of ambiguous activation or automatic reconnect.
      void browserSshApi({ action: "disconnect", token: proof.token }).catch(() => {});
      throw failure;
    }
  }), [run, applyStatus]);
  const makeActive = useCallback(() => owned.current ? mutate({ action: "select", token: owned.current.token }) : Promise.resolve(false), [mutate]);
  const disconnect = useCallback(() => {
    operation.current?.controller.abort("disconnect");
    const own = owned.current; loseConnection(); const started = ++epoch.current, sampledAt = performance.now();
    if (own) void browserSshApi<SshAgentStatus>({ action: "disconnect", token: own.token }).then(next => {
      if (alive.current && started === epoch.current && !owned.current) applyStatus(next, sampledAt);
    }).catch(async failure => {
      if (!alive.current) return;
      reportFailure(failure);
      if (authState.current === "ready") { try { await readStatus(); } catch (readFailure) { if (alive.current) reportFailure(readFailure); } }
    });
  }, [loseConnection, applyStatus, readStatus, reportFailure]);
  const lock = useCallback((connectionId: string) => mutate({ action: "lock", connectionId }), [mutate]);
  const revoke = useCallback((connectionId: string) => mutate({ action: "revoke", connectionId }), [mutate]);
  const unlock = useCallback(() => run(async signal => {
    const own = owned.current; if (!own) return;
    const proof = await browserSshApi<Omit<SshEnrollmentProof, "token">>({ action: "begin-unlock", token: own.token }, signal);
    const assertion = await requestBrowserSshAssertion(proof.credential, proof.challenge, signal, { rpId: proof.rpId, userVerification: "required" });
    const sampledAt = performance.now();
    const next = await browserSshApi<SshAgentStatus>({ action: "finish-unlock", token: own.token, assertion }, signal);
    if (signal.aborted || !alive.current || owned.current?.token !== own.token) return;
    // The standalone API returns status, not newGrant. Never discard an existing
    // grant sample just because another UV ceremony completed. Locked/missing
    // connections already retire their samples in applyStatus.
    epoch.current++; applyStatus(next, sampledAt);
    if (signal.aborted || owned.current?.token !== own.token) return;
    // A standalone unlock also reauthorizes pending locked requests server-side.
    // Read those actual modes immediately; do not infer them from the status label.
    const pollEpoch = epoch.current;
    const pollStarted = performance.now();
    const snapshot = await browserSshApi<SshPoll>({ action: "poll", token: own.token }, signal);
    if (!signal.aborted && alive.current && owned.current?.token === own.token && pollEpoch === epoch.current) {
      applyStatus(snapshot.status, pollStarted);
      if (owned.current?.token === own.token) receiveRequests(snapshot.requests, pollStarted);
    }
  }), [run, applyStatus, receiveRequests]);

  const reviewRequest = useCallback((id: string) => {
    if (currentRequests.current.some(item => item.id === id && item.deadline > performance.now())) chooseReview(id);
    else setNotice(t("sshAgent.staleRequest"));
  }, [chooseReview, t]);
  const finishLocal = useCallback((id: string) => {
    terminalRequests.current.add(id); publishRequests(currentRequests.current.filter(item => item.id !== id));
  }, [publishRequests]);
  const deny = useCallback((id: string) => {
    const own = owned.current;
    if (!own || !currentRequests.current.some(item => item.id === id) || terminalRequests.current.has(id)) return;
    if (operation.current?.requestId === id) operation.current.controller.abort("denied");
    finishLocal(id);
    void browserSshApi({ action: "respond", token: own.token, requestId: id }).catch(failure => { if (alive.current) reportFailure(failure); });
  }, [finishLocal, reportFailure]);
  const approve = useCallback((id: string) => run(async signal => {
    const own = owned.current;
    const original = currentRequests.current.find(item => item.id === id);
    if (!own || !original || review.current !== id || original.deadline <= performance.now()) return;
    let dispatched = false;
    const liveRequest = () => {
      const current = currentRequests.current.find(item => item.id === id);
      if (signal.aborted) throw new DOMException("", "AbortError");
      if (!alive.current || owned.current?.token !== own.token || review.current !== id || !current || terminalRequests.current.has(id) || current.deadline <= performance.now() || !sameSigningPayload(original, current)) throw new Error(t("sshAgent.requestChanged"));
      return current;
    };
    const acceptUnlock = (status: SshAgentStatus, request: SshSigningRequest, newGrant: boolean, sampledAt: number) => {
      // Response validation precedes every update or second native ceremony. A server
      // policy label is not permission to substitute a different reviewed payload.
      liveRequest();
      if (!request || !sameSigningPayload(original, request) || request.userVerification !== "discouraged" || request.unlock !== false || !Number.isFinite(request.remainingMs) || request.remainingMs <= 0) throw new Error(t("sshAgent.requestChanged"));
      // Fence polls issued before this authoritative acknowledgement; a delayed
      // pre-unlock snapshot is not a new revocation or permission to regress policy.
      epoch.current++;
      if (newGrant) grantDeadlines.current.delete(own.id);
      applyStatus(status, sampledAt);
      liveRequest(); // A missing/revoked connection in status aborts the sequence.
      receiveRequests(currentRequests.current.map(item => item.id === id ? request : item), sampledAt);
      const current = liveRequest();
      if (current.userVerification !== "discouraged" || current.unlock !== false) throw new Error(t("sshAgent.requestChanged"));
      if (operation.current?.requestId === id) operation.current.authorizingUnlock = undefined;
      return current;
    };
    try {
      let request = original;
      if (original.unlock) {
        if (original.userVerification !== "required") throw new Error(t("sshAgent.requestChanged"));
        if (operation.current?.requestId === id) operation.current.authorizingUnlock = original;
        setApprovalStage("unlock");
        const beginStarted = performance.now();
        const begin = await browserSshApi<RequestUnlockBegin>({ action: "begin-request-unlock", token: own.token, requestId: id }, signal);
        liveRequest();
        if (begin.alreadyUnlocked === true) {
          // Another verified operation already established this exact connection's
          // live grant. Reuse the server-authorized request, never renew its sample.
          request = acceptUnlock(begin.status, begin.request, false, beginStarted);
        } else if (begin.alreadyUnlocked === false) {
          if (begin.requestId !== id || begin.rpId !== own.rpId || begin.credential?.id !== own.credential.id || begin.credential?.spki !== own.credential.spki || begin.challenge === original.challenge) throw new Error(t("sshAgent.requestChanged"));
          // Ceremony 1: fresh server-random nonce, never raw SSH bytes. Only this
          // proof may establish an application grant, and only the server decides.
          const unlockAssertion = await requestBrowserSshAssertion(begin.credential, begin.challenge, signal, { rpId: begin.rpId, userVerification: "required" });
          liveRequest();
          const finishStarted = performance.now();
          const finished = await browserSshApi<RequestUnlockFinish>({ action: "finish-request-unlock", token: own.token, requestId: id, assertion: unlockAssertion }, signal);
          liveRequest();
          if (typeof finished.newGrant !== "boolean") throw new Error(t("sshAgent.requestChanged"));
          request = acceptUnlock(finished.status, finished.request, finished.newGrant, finishStarted);
        } else throw new Error(t("sshAgent.requestChanged"));
      }
      const current = liveRequest();
      if (request.unlock || current.unlock || current.userVerification !== request.userVerification) throw new Error(t("sshAgent.requestChanged"));
      setApprovalStage("sign");
      // Ceremony 2 for Unlock and approve; ordinary approvals use only this one.
      // The original raw payload assertion is signing only and never mints a grant.
      const assertion = await requestBrowserSshAssertion(own.credential, request.challenge, signal, { rpId: own.rpId, userVerification: request.userVerification });
      const ready = liveRequest();
      if (ready.userVerification !== request.userVerification || ready.unlock !== request.unlock) throw new Error(t("sshAgent.requestChanged"));
      dispatched = true;
      if (operation.current?.requestId === id) operation.current.submitted = true;
      // Once dispatched, even an ambiguous failure must not invite another signature attempt.
      finishLocal(id);
      await browserSshApi({ action: "respond", token: own.token, requestId: id, assertion }, signal);
    } catch (failure) {
      // Cancellation/failure in either ceremony denies exactly once. A completed
      // server unlock may remain live; denial never automatically renews/replays it.
      if (!dispatched && !terminalRequests.current.has(id) && owned.current?.token === own.token && signal.reason !== "request-settled" && signal.reason !== "connection-lost") {
        terminalRequests.current.add(id);
        void browserSshApi({ action: "respond", token: own.token, requestId: id }).catch(() => {});
      }
      throw failure;
    } finally {
      if (operation.current?.requestId === id) {
        operation.current.requestId = undefined;
        operation.current.authorizingUnlock = undefined;
      }
      if (alive.current) finishLocal(id);
    }
  }, id), [run, finishLocal, applyStatus, receiveRequests, t]);
  const cancel = useCallback(() => {
    const op = operation.current;
    if (op?.requestId && !op.submitted) deny(op.requestId);
    else op?.controller.abort("cancelled");
  }, [deny]);

  const toggleNotifications = useCallback(async (enabled: boolean) => {
    if (notificationBusy) return;
    setNotificationBusy(true); setNotificationStatus("");
    try {
      if (enabled && (!("Notification" in window) || (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted"))) {
        enabled = false; setNotificationStatus(t("sshAgent.notificationDenied"));
      }
      if (!alive.current) return;
      setNotificationsEnabled(enabled);
      try { localStorage.setItem(NOTIFY_KEY, String(enabled)); } catch { /* Local opt-in only. */ }
      if (!enabled) { for (const item of notifications.current.values()) item.close(); notifications.current.clear(); }
    } catch { if (alive.current) { setNotificationsEnabled(false); setNotificationStatus(t("sshAgent.notificationUnavailable")); } }
    finally { if (alive.current) setNotificationBusy(false); }
  }, [notificationBusy, t]);

  useEffect(() => {
    if (!notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted" || !shouldShowBrowserNotification()) return;
    for (const request of requests) {
      if (notified.current.has(request.id)) continue;
      notified.current.add(request.id);
      // Deliberately page-local: generic worker URL delivery cannot validate this page's live request.
      // On browsers requiring worker notifications this reports unavailable instead of persisting authority.
      void showBrowserNotification({
        title: t("sshAgent.notificationTitle"), body: t("sshAgent.notificationBody"), sessionUrl: "/",
        onClick: () => {
          if (!alive.current) return;
          if (!owned.current || !currentRequests.current.some(item => item.id === request.id && item.deadline > performance.now())) { setNotice(t("sshAgent.staleRequest")); return; }
          window.focus(); reviewRequest(request.id);
        },
      }, {
        getServiceWorkerRegistration: null,
        createWindowNotification: (title, options) => {
          const item = new Notification(title, options); notifications.current.set(request.id, item); return item;
        },
      }).then(delivery => { if (!delivery && alive.current) setNotificationStatus(t("sshAgent.notificationUnavailable")); });
    }
  }, [requests, notificationsEnabled, reviewRequest, t]);

  const clearMessages = useCallback(() => { setError(""); setNotice(""); }, []);
  const backend = status?.runtime.selected;
  const effectiveLabel = !status ? t("sshAgent.unknown") : status.runtime.setupNeeded ? t("sshAgent.setupNeeded") :
    backend?.type === "socket" ? backend.label : t(`sshAgent.backend.${backend?.type ?? "none"}`);
  const active = status?.connections.find(item => item.id === status.activeId) ?? null;
  return {
    status, auth, supported, origin, connection: connection?.view ?? null, requests, reviewedId,
    busy, approvingId, approvalStage, error, notice, candidates, discovering, recovery,
    recoveryWarnings: recoveryIssues.map(issue => t(`sshAgent.${issue}`)),
    notificationsEnabled, notificationStatus, notificationBusy, effectiveLabel, active,
    pendingCount: status?.pendingCount ?? 0,
    refresh, cancelDiscovery, useAgent, addSocket, renameKey, removeKey, enroll, importKey, connect, makeActive,
    disconnect, lock, revoke, unlock, reviewRequest, approve, deny, cancel, toggleNotifications, clearMessages,
  };
}

export type SshAgentController = ReturnType<typeof useSshAgent>;
