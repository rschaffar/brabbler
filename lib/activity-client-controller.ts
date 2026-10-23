import {
  activityRequestKey, deferredAttentionIds, isCurrentActivityRequest,
  loadReviewedRunTimes, mergeReviewedRunTimes, reconcileCompletedRuns,
  REVIEWED_RUN_TIMES_STORAGE_KEY,
} from "./activity-review";
import type { SessionAttention, SessionAttentionReceipt, SessionCompletion, SessionInfo } from "./types";
import type { SessionPauseSnapshot } from "./session-pause";

export interface ActivityClientSnapshot {
  readonly runningIds: ReadonlySet<string>;
  readonly queuedIds: ReadonlySet<string>;
  readonly rootReviewIds: ReadonlySet<string>;
  readonly subagentReviewIds: ReadonlySet<string>;
  readonly reviewIds: ReadonlySet<string>;
  readonly laterIds: ReadonlySet<string>;
  readonly laterAttentionIds: ReadonlySet<string>;
  readonly suppressedCompletionIds: ReadonlySet<string>;
  readonly completedRunTimes: ReadonlyMap<string, number>;
  // Mutable array types preserve existing view-prop compatibility. Treat these
  // owned copies as immutable, just like the ReadonlySet/Map projections.
  readonly attention: SessionAttention[];
  readonly pauses: SessionPauseSnapshot[];
  readonly available: boolean;
  readonly authoritative: boolean;
}

export interface ActivityCatalogueFallback {
  sessionListVersion: number;
  runningSessionIds?: readonly string[];
  completionNotificationSuppressedSessionIds?: readonly string[];
}

export interface ActivityClientPorts {
  request(path: string, init: RequestInit): Promise<Response>;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  visible(): boolean;
  listen(callback: () => void): () => void;
  legacy: { read(): SessionCompletion[]; clear(): void };
}

export interface ActivityClientController {
  getSnapshot(): ActivityClientSnapshot;
  subscribe(listener: () => void): () => void;
  retain(): () => void;
  dispose(): Promise<void>;
  disposeWhenUnobserved(): Promise<void>;
  whenIdle(): Promise<void>;
  refresh(): void;
  setSessions(sessions: readonly SessionInfo[], fallback?: ActivityCatalogueFallback): void;
  observeCatalogue(listener: (version: number) => Promise<unknown> | void): () => void;
  markRead(id: string, displayedCompletionAt: number | undefined): void;
  markLater(id: string, requestId?: string, displayedCompletionAt?: number): void;
  isUnreviewedCompletion(id: string): boolean;
}

type Poll = {
  sessionListVersion: number;
  runningSessionIds?: string[];
  queuedSessionIds?: string[];
  completionNotificationSuppressedSessionIds?: string[];
  completedRuns?: SessionCompletion[];
  reviewedRuns?: SessionCompletion[];
  laterRuns?: SessionCompletion[];
  laterRequests?: SessionAttentionReceipt[];
  attention?: SessionAttention[];
  pauses?: SessionPauseSnapshot[];
  activityReviewPersistenceFailed?: boolean;
};
type ReceiptReply = Pick<Poll, "reviewedRuns" | "laterRuns" | "laterRequests">;
const times = (rows: readonly SessionCompletion[] = []) => new Map(rows.map(({ sessionId, at }) => [sessionId, at]));
const entries = (map: ReadonlyMap<string, number>) => [...map].map(([sessionId, at]) => ({ sessionId, at }));

// These closures do not touch browser globals until activation.
const defaults: ActivityClientPorts = {
  request: (path, init) => fetch(path, init),
  schedule: (callback, ms) => setTimeout(callback, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  visible: () => typeof document !== "undefined" && document.visibilityState === "visible",
  listen(callback) {
    if (typeof document === "undefined" || typeof window === "undefined") return () => {};
    document.addEventListener("visibilitychange", callback);
    window.addEventListener("pi-web:activity-refresh", callback);
    return () => {
      document.removeEventListener("visibilitychange", callback);
      window.removeEventListener("pi-web:activity-refresh", callback);
    };
  },
  legacy: {
    read: () => entries(loadReviewedRunTimes()),
    clear() {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(REVIEWED_RUN_TIMES_STORAGE_KEY);
      window.localStorage.removeItem("pi-web:unread-session-ids");
      window.localStorage.removeItem("pi-web:subagent-review-ids");
    },
  },
};

/** One application-instance owner. Sets/maps published here are never mutated by us. */
export function createActivityClientController(overrides: Partial<ActivityClientPorts> = {}): ActivityClientController {
  const ports = { ...defaults, ...overrides };
  const subscribers = new Set<() => void>();
  const catalogue = new Set<(version: number) => Promise<unknown> | void>();
  const owned = new Set<Promise<void>>();
  let sessions: SessionInfo[] = [];
  let running = new Set<string>();
  let queued = new Set<string>();
  let suppressed = new Set<string>();
  let completed = new Map<string, number>();
  let reviewed = new Map<string, number>();
  let later = new Map<string, number>();
  let laterRequests = new Set<string>();
  const pendingAck = new Map<string, number>();
  const pendingLater = new Map<string, number>();
  const pendingRequests = new Map<string, SessionAttentionReceipt>();
  let attention: SessionAttention[] = [];
  let pauses: SessionPauseSnapshot[] = [];
  let authoritative = false;
  let available = true;
  let failedWrite = false;
  let awaitingValidation = false;
  let writing = false;
  let retainers = 0;
  let closed = false;
  let importStarted = false;
  let storageReady = false;
  let generation = 0;
  let read: AbortController | undefined;
  let timer: unknown;
  let hasTimer = false;
  let unlisten: (() => void) | undefined;
  let disposal: Promise<void> | undefined;

  function project(): ActivityClientSnapshot {
    const ready = reconcileCompletedRuns(entries(completed), reviewed, running, sessions);
    return Object.freeze({
      runningIds: new Set(running), queuedIds: new Set(queued),
      rootReviewIds: ready.rootReady, subagentReviewIds: ready.subagentReady,
      reviewIds: new Set([...ready.rootReady, ...ready.subagentReady]),
      laterIds: new Set([...later].filter(([id, at]) =>
        at === completed.get(id) && at > (reviewed.get(id) ?? 0)).map(([id]) => id)),
      laterAttentionIds: deferredAttentionIds(attention, laterRequests),
      suppressedCompletionIds: new Set(suppressed), completedRunTimes: new Map(completed),
      attention: attention.map((row) => ({ ...row })),
      pauses: pauses.map((row) => ({ ...row })),
      available, authoritative,
    });
  }
  let snapshot = project();
  function publish() {
    if (closed) return;
    snapshot = project();
    // Notification is not a transport effect. One consumer cannot stop the others.
    for (const listener of [...subscribers]) {
      try { listener(); }
      catch (error) { console.error("Activity subscriber failed", error); }
    }
  }
  function own(work: () => Promise<void>) {
    // Start admitted effects immediately, as the original async handlers did.
    // In particular A's POST captures A before a bulk event enqueues B.
    const result = (async () => { await work(); })();
    // Operational request failures are handled by their workflow. Programming/
    // port failures must still be visible, not silently converted into success.
    const observed = result.then(() => { owned.delete(observed); }, (error) => {
      try {
        available = false;
        publish();
        console.error("Activity observer failed", error);
      } finally { owned.delete(observed); }
    });
    owned.add(observed);
  }
  async function whenIdle() {
    // Child work (e.g. initial poll after import) may be admitted while joining.
    while (owned.size) await Promise.all([...owned]);
  }
  function clearTimer() {
    if (hasTimer) ports.cancel(timer);
    hasTimer = false;
    timer = undefined;
  }
  function invalidateRead() {
    generation++;
    const previous = read;
    read = undefined;
    previous?.abort();
  }
  function observing() { return !closed && retainers > 0; }
  function stop() {
    clearTimer();
    invalidateRead();
    const cleanup = unlisten;
    unlisten = undefined;
    cleanup?.();
  }
  function current(epoch: number) {
    return observing() && generation === epoch && ports.visible();
  }
  async function post(op: string, rows: readonly unknown[]): Promise<ReceiptReply> {
    const response = await ports.request("/api/activity/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, entries: rows }),
    });
    // Body completion is part of this owned operation, not a detached .then().
    const data = await response.json() as ReceiptReply;
    if (!response.ok) throw new Error(`Activity review failed: HTTP ${response.status}`);
    return data;
  }
  function hasPending() { return pendingAck.size + pendingLater.size + pendingRequests.size > 0; }

  function flush(validatedRetry = false) {
    if (closed || writing || !hasPending() || ((failedWrite || awaitingValidation) && !validatedRetry)) return;
    awaitingValidation = false;
    writing = true;
    own(async () => {
      // A successful response that does not confirm a receipt must not cause a
      // tight POST loop. Retry that same token only after another accepted poll.
      const attemptedAck = new Map<string, number>();
      const attemptedLater = new Map<string, number>();
      const attemptedRequests = new Set<string>();
      try {
        for (;;) {
          let attempted = false;
          for (const op of ["ack", "later"] as const) {
            const pending = op === "ack" ? pendingAck : pendingLater;
            const tried = op === "ack" ? attemptedAck : attemptedLater;
            const batch = entries(new Map([...pending].filter(([id, at]) => at > (tried.get(id) ?? 0))));
            if (!batch.length) continue;
            attempted = true;
            for (const { sessionId, at } of batch) tried.set(sessionId, at);
            const data = await post(op, batch);
            const confirmed = times(op === "ack" ? data.reviewedRuns : data.laterRuns);
            for (const { sessionId, at } of batch) {
              if ((confirmed.get(sessionId) ?? 0) >= at && (pending.get(sessionId) ?? 0) <= at) pending.delete(sessionId);
            }
            if (op === "ack") reviewed = mergeReviewedRunTimes(reviewed, confirmed);
            else later = mergeReviewedRunTimes(later, confirmed);
          }
          const batch = [...pendingRequests].filter(([key]) => !attemptedRequests.has(key)).map(([, receipt]) => receipt);
          if (batch.length) {
            attempted = true;
            for (const receipt of batch) attemptedRequests.add(activityRequestKey(receipt));
            const data = await post("later-request", batch);
            const confirmed = new Set((data.laterRequests ?? []).map(activityRequestKey));
            for (const receipt of batch) {
              const key = activityRequestKey(receipt);
              if (confirmed.has(key)) pendingRequests.delete(key);
            }
            for (const key of confirmed) laterRequests.add(key);
          }
          if (!attempted) break;
          // Drain commands admitted during the previous POST, including before
          // dispose(). No retries of already-attempted receipts are admitted here.
        }
        failedWrite = false;
        awaitingValidation = hasPending();
      } catch {
        failedWrite = true;
        available = false;
        publish();
      } finally {
        writing = false;
      }
    });
  }

  function accept(data: Poll) {
    authoritative = true;
    running = new Set(data.runningSessionIds ?? []);
    queued = new Set(data.queuedSessionIds ?? []);
    suppressed = new Set(data.completionNotificationSuppressedSessionIds ?? []);
    attention = (data.attention ?? []).map((row) => ({ ...row }));
    pauses = (data.pauses ?? []).map((row) => ({ ...row }));
    completed = times(data.completedRuns);
    const serverReviewed = times(data.reviewedRuns);
    for (const [id, at] of pendingAck) {
      if ((serverReviewed.get(id) ?? 0) >= at || !completed.has(id)) pendingAck.delete(id);
    }
    reviewed = mergeReviewedRunTimes(mergeReviewedRunTimes(
      new Map([...reviewed].filter(([id]) => completed.has(id))), serverReviewed), pendingAck);
    const serverLater = times(data.laterRuns);
    for (const [id, at] of pendingLater) {
      if ((serverLater.get(id) ?? 0) >= at || !completed.has(id)) pendingLater.delete(id);
    }
    later = mergeReviewedRunTimes(mergeReviewedRunTimes(
      new Map([...later].filter(([id]) => completed.has(id))), serverLater), pendingLater);
    const active = new Set(attention.flatMap((row) => row.requestId
      ? [activityRequestKey({ sessionId: row.sessionId, requestId: row.requestId })] : []));
    const serverRequests = new Set((data.laterRequests ?? []).map(activityRequestKey));
    for (const key of pendingRequests.keys()) {
      if (serverRequests.has(key) || !active.has(key)) pendingRequests.delete(key);
    }
    laterRequests = new Set([...laterRequests, ...serverRequests, ...pendingRequests.keys()].filter((key) => active.has(key)));
    if (!writing && !hasPending()) { failedWrite = false; awaitingValidation = false; }
    available = !data.activityReviewPersistenceFailed && !failedWrite;
    publish();
  }

  function refresh() {
    if (!observing()) return;
    clearTimer();
    invalidateRead();
    if (!storageReady || !ports.visible()) return;
    const epoch = generation;
    const controller = new AbortController();
    read = controller;
    own(async () => {
      try {
        if (!current(epoch)) return;
        const response = await ports.request("/api/agent/running", { cache: "no-store", signal: controller.signal });
        // Even transports ignoring abort must finish their actual JSON promise.
        const data = await response.json() as Poll;
        if (!current(epoch)) return;
        if (!response.ok) throw new Error(`Activity poll failed: HTTP ${response.status}`);
        accept(data);
        if (!current(epoch)) return; // A synchronous subscriber may release/dispose.
        flush(true); // Reconcile durable success before allowing a retry.
        const callbacks = [...catalogue].map(async (listener) => listener(data.sessionListVersion));
        // allSettled, not fail-fast: dispose must join every admitted callback.
        const results = await Promise.allSettled(callbacks);
        if (results.some((result) => result.status === "rejected")) throw new Error("Catalogue observation failed");
      } catch {
        if (current(epoch)) { available = false; publish(); }
      } finally {
        if (current(epoch)) {
          read = undefined;
          timer = ports.schedule(() => { hasTimer = false; timer = undefined; refresh(); }, 2500);
          hasTimer = true;
        }
      }
    });
  }

  function activate() {
    unlisten = ports.listen(refresh);
    if (!importStarted) {
      importStarted = true;
      own(async () => {
        try {
          if (closed) return;
          const legacy = ports.legacy.read().filter(({ sessionId, at }) => typeof sessionId === "string" && sessionId.length > 0
            && sessionId.length <= 256 && Number.isSafeInteger(at) && at > 0)
            .map(({ sessionId, at }) => ({ sessionId, at }));
          for (let offset = 0; offset < legacy.length || offset === 0; offset += 1000) {
            if (closed) return;
            await post("import", legacy.slice(offset, offset + 1000));
          }
          ports.legacy.clear();
        } catch {
          // Keep timestamped legacy data for another owner/reload; never publish
          // browser-only acknowledgements as backend authority.
        } finally {
          storageReady = true;
          if (observing()) refresh();
        }
      });
    } else if (storageReady) refresh();
  }

  function completionMatches(id: string, displayed: number | undefined) {
    return displayed !== undefined && Number.isFinite(displayed) && displayed > 0
      && completed.get(id) === displayed && displayed > (reviewed.get(id) ?? 0) && !running.has(id);
  }
  function dispose() {
    if (!disposal) {
      closed = true;
      stop();
      subscribers.clear();
      catalogue.clear();
      disposal = whenIdle();
    }
    return disposal;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (closed) return () => {};
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    retain() {
      if (closed) return () => {};
      retainers++;
      if (retainers === 1) activate();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retainers--;
        if (retainers === 0) stop();
      };
    },
    dispose,
    async disposeWhenUnobserved() {
      await Promise.resolve();
      if (closed || retainers === 0) await dispose();
    },
    whenIdle, refresh,
    setSessions(next, fallback) {
      if (closed) return;
      // Own inputs for the existing catalogue-sensitive projection. Loading and
      // version comparison remain with the external catalogue owner.
      sessions = next.map((session) => ({ ...session, relation: session.relation ? { ...session.relation } : undefined }));
      if (!authoritative && fallback) {
        running = new Set(fallback.runningSessionIds ?? []);
        suppressed = new Set(fallback.completionNotificationSuppressedSessionIds ?? []);
      }
      publish();
    },
    observeCatalogue(listener) {
      if (closed) return () => {};
      catalogue.add(listener);
      return () => { catalogue.delete(listener); };
    },
    markRead(id, displayedCompletionAt) {
      if (closed || !completionMatches(id, displayedCompletionAt)) return;
      const at = displayedCompletionAt!;
      reviewed.set(id, at);
      pendingAck.set(id, Math.max(at, pendingAck.get(id) ?? 0));
      flush();
      publish();
    },
    markLater(id, requestId, displayedCompletionAt) {
      if (closed) return;
      if (requestId) {
        const receipt = { sessionId: id, requestId };
        if (!isCurrentActivityRequest(attention, receipt)) return;
        const key = activityRequestKey(receipt);
        laterRequests.add(key);
        pendingRequests.set(key, receipt);
      } else {
        if (!completionMatches(id, displayedCompletionAt)) return;
        const at = displayedCompletionAt!;
        later.set(id, Math.max(at, later.get(id) ?? 0));
        pendingLater.set(id, Math.max(at, pendingLater.get(id) ?? 0));
      }
      flush();
      publish();
    },
    isUnreviewedCompletion(id) {
      const at = completed.get(id);
      return Boolean(at && at > (reviewed.get(id) ?? 0));
    },
  };
}
