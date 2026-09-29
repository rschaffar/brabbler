import { isTerminalGitAction, type GitActionHistoryResponse } from "../lib/git-action-types";
import { GIT_ACTION_UPDATE_EVENT, type GitActionInvalidation } from "../lib/git-action-ui";

export const GIT_ACTION_RECONCILE_MS = 15_000;
export const GIT_ACTIONS_CHANGED_EVENT = "pi-web:git-actions-changed";

interface ReconcileTarget { sessionId: string | null; busy: boolean; revision: number }

/** Sidecar actions also work with closed SSE and no live AgentSession. Coalesce
 * notifications, defer during a run, and reject any GET overtaken by local
 * transcript/navigation changes. The next idle read retries the invalidation.
 */
export function watchGitActionsChanged(getTarget: () => ReconcileTarget, reload: (sessionId: string, shouldApply: () => boolean) => Promise<unknown>) {
  let disposed = false;
  let pendingSession: string | null = null;
  let generation = 0;
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reconcile = async () => {
    if (disposed || loading || !pendingSession) return;
    clearTimeout(timer);
    const target = getTarget();
    if (target.sessionId !== pendingSession) { pendingSession = null; return; }
    if (target.busy) { timer = setTimeout(() => void reconcile(), 500); return; }
    const requested = generation;
    const sid = pendingSession;
    loading = true;
    const shouldApply = () => {
      const current = getTarget();
      return !disposed && requested === generation && current.sessionId === sid && !current.busy && current.revision === target.revision;
    };
    try {
      const result = await reload(sid, shouldApply);
      if (requested === generation && result !== "superseded" && result !== "error") pendingSession = null;
    } catch {
      // A failed read never retries the Git operation, only this projection.
    } finally {
      loading = false;
      if (!disposed && pendingSession) timer = setTimeout(() => void reconcile(), 500);
    }
  };
  const onChanged = (event: Event) => {
    const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
    if (typeof sessionId !== "string" || sessionId !== getTarget().sessionId) return;
    pendingSession = sessionId;
    generation += 1;
    void reconcile();
  };
  window.addEventListener(GIT_ACTIONS_CHANGED_EVENT, onChanged);
  return () => { disposed = true; clearTimeout(timer); window.removeEventListener(GIT_ACTIONS_CHANGED_EVENT, onChanged); };
}

/** Always authorize via the current chat's anchor, not the record's original owner. */
export async function readGitActionHistory(sessionId: string, actionId: string, includeArtifact = false, signal?: AbortSignal): Promise<GitActionHistoryResponse> {
  const query = new URLSearchParams({ sessionId });
  if (includeArtifact) query.set("includeArtifact", "1");
  const response = await fetch(`/api/git/actions/${encodeURIComponent(actionId)}?${query}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Git action history unavailable (HTTP ${response.status}).`);
  const history = await response.json() as GitActionHistoryResponse;
  if (!history || !("record" in history) || (history.record && history.record.id !== actionId)) throw new Error("Invalid Git action history response.");
  return history;
}

export function newestGitActionHistory(previous: GitActionHistoryResponse | null, next: GitActionHistoryResponse): GitActionHistoryResponse {
  if (previous?.record && next.record) {
    if (previous.record.revision > next.record.revision) return previous;
    // Restart/artifact-loss projections can revoke liveness without incrementing
    // the stored revision. An equal-revision reply must not undo that revocation.
    if (previous.record.revision === next.record.revision && isTerminalGitAction(previous.record.state) && !isTerminalGitAction(next.record.state)) return previous;
  }
  return next;
}

/** Read-only reconciliation, independent of agent runs and never loading a wrapper. */
export function watchGitActionHistory(sessionId: string, actionId: string, onHistory: (history: GitActionHistoryResponse) => void, onError: (error: string) => void) {
  let disposed = false;
  let controller: AbortController | undefined;
  let current: GitActionHistoryResponse | null = null;
  const refresh = async () => {
    if (disposed || document.hidden) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    try {
      const history = await readGitActionHistory(sessionId, actionId, false, request.signal);
      if (disposed || request.signal.aborted) return;
      current = newestGitActionHistory(current, history);
      onHistory(current);
    } catch (error) {
      if (!disposed && !request.signal.aborted) onError(error instanceof Error ? error.message : String(error));
    }
  };
  const onUpdate = (event: Event) => {
    const update = (event as CustomEvent<GitActionInvalidation>).detail;
    if (update?.sessionId === sessionId && update.actionId === actionId && update.revision > (current?.record?.revision ?? 0)) void refresh();
  };
  const onVisible = () => { if (!document.hidden) void refresh(); };
  window.addEventListener(GIT_ACTION_UPDATE_EVENT, onUpdate);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  const interval = window.setInterval(() => {
    // Terminal evidence is immutable. Do not re-read every captured patch in a
    // long paged history on a timer; expansion/visibility still detect loss.
    if (!current?.record || !isTerminalGitAction(current.record.state)) onVisible();
  }, GIT_ACTION_RECONCILE_MS);
  void refresh();
  return () => {
    disposed = true;
    controller?.abort();
    window.clearInterval(interval);
    window.removeEventListener(GIT_ACTION_UPDATE_EVENT, onUpdate);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
  };
}
