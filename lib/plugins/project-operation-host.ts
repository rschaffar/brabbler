import { createHash, randomUUID } from "node:crypto";
import { samePath } from "../paths";
import { validateOperationReceipt } from "../operation-receipts";
import { isOperationId, validatePluginCard } from "./ui";
import { assertProjectAcknowledgment, parseProjectActionDecision, projectCardDigest } from "./project-acknowledgment";
import type { ProjectAcknowledgmentAnswer, ProjectActionPrepare, ProjectOperation } from "./project-operation-types";
import type { BundledPlugin, PluginUiContext } from "./types";
import type { ProjectOperationStore, StoredProjectOperation as Stored } from "./project-operation-store";

type Capability = { plugin: BundledPlugin; adapter: NonNullable<BundledPlugin["projectActions"]> };
export interface ProjectOperationScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout> | undefined): void;
}
export const projectOperationScheduler: ProjectOperationScheduler = {
  now: () => Date.now(), setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timer) => clearTimeout(timer),
};
/** Trusted construction-time ports only; requests cannot select capabilities. */
export interface ProjectOperationPorts {
  store: ProjectOperationStore;
  capability(pluginId: string): Capability;
  enabled(plugin: BundledPlugin, cwd: string): boolean;
  admission: { allowed(cwd: string): Promise<void>; assertInvocation(cwd: string): void; admitRelated(paths: string[]): void };
  observers(): Promise<(path: string) => boolean>;
  reserveDirectory(path: string, inUse: (path: string) => boolean): () => void;
  prepareReview: PluginUiContext["prepareReview"];
  scheduler: ProjectOperationScheduler;
}
interface Completion {
  reviewReady: Promise<void>; fullySettled?: Promise<void>;
  publishReview(): void; settled: boolean;
}
export interface LiveProjectOperation {
  record: Stored; controller: AbortController; answer?: (answer: string | null) => void;
  card?: ProjectOperation["card"]; cardNonce?: string; timer?: ReturnType<typeof setTimeout>; claimed: boolean;
  // Older HMR entries retain their original executor/authority. We cannot invent
  // retrospective completion for a run started before tracking existed.
  completion?: Completion;
}
function completion(): Completion {
  let publishReview!: () => void;
  const reviewReady = new Promise<void>((resolve) => { publishReview = resolve; });
  return { reviewReady, publishReview, settled: false };
}
const terminal = (state: string) => ["succeeded", "failed", "cancelled", "outcome-unknown"].includes(state);

/** Instances own their executions. Only the default service supplies the existing
 * process-wide HMR map. No lifecycle action touches sessions or Acceptance jobs. */
export function createProjectOperationHost(ports: ProjectOperationPorts, live = new Map<string, LiveProjectOperation>()) {
  const { store, capability, admission, scheduler } = ports;
  const { allowed } = admission;
  const persist = (record: Stored) => store.save(record);
  const read = (id: string) => store.read(id);
  const timestamp = () => new Date(scheduler.now()).toISOString();
  function update(operation: LiveProjectOperation, changes: Partial<Stored>) {
    const next = { ...operation.record, ...changes, updatedAt: timestamp() };
    persist(next); operation.record = next;
  }
  function publicRecord(record: Stored): ProjectOperation {
    const active = live.get(record.id);
    // Ownership reads await admission; the live card/descriptor may have changed meanwhile.
    const { inputDigest: _digest, ...value } = structuredClone(active?.record ?? record);
    void _digest;
    if (!active && !terminal(value.state)) { value.state = "outcome-unknown"; value.error = "Server restarted; saved intent is not an observed outcome. Inspect actual resources. This operation cannot be replayed."; }
    if (value.receipt) value.receipt.card.actions = [];
    const review = value.receipt?.card.review;
    if (review) value.reviewBaseUrl = `/api/plugins/bundled/${encodeURIComponent(value.pluginId)}/project-actions/${value.id}/reviews/${review.id}`;
    value.card = active?.card && active.answer && !active.claimed && !active.controller.signal.aborted && value.state === "review"
      && (active.card.requiredAcknowledgment === undefined || active.cardNonce && value.acknowledgment
        && value.acknowledgment.label === active.card.requiredAcknowledgment && value.acknowledgment.accepted !== true)
      ? structuredClone(active.card) : undefined;
    return value;
  }
  /** Saved project ownership authorizes history through a surviving anchor, not the removed worktree. */
  async function owned(pluginId: string, id: string): Promise<Stored> {
    const record = live.get(id)?.record ?? read(id);
    if (!record || record.pluginId !== pluginId) throw new Error("Operation not found");
    await allowed(record.anchor);
    const { adapter } = capability(pluginId);
    if ((await adapter.resolveProject(record.anchor)).identity !== record.project) throw new Error("Project identity changed");
    return record;
  }
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  }
  /** Idempotent preparation: an existing UUID is lookup-only, including after restart. */
  async function prepareProjectAction(pluginId: string, input: ProjectActionPrepare): Promise<ProjectOperation> {
    if (!input || !isOperationId(input.requestId) || typeof input.cwd !== "string" || typeof input.action !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(input.action)
      || JSON.stringify(input).length > 65536 || Object.keys(input).some((field) => !["cwd", "requestId", "action", "payload"].includes(field))) throw new Error("Invalid project action request");
    await allowed(input.cwd);
    const { plugin, adapter } = capability(pluginId);
    const project = await adapter.resolveProject(input.cwd);
    const inputDigest = createHash("sha256").update(JSON.stringify(canonical([pluginId, input, project.identity]))).digest("hex");
    // Synchronous lookup/claim after asynchronous admission, no duplicate work starts.
    const previous = live.get(input.requestId)?.record ?? read(input.requestId);
    if (previous) {
      if (previous.inputDigest !== inputDigest) throw new Error("Request ID already belongs to a different preparation");
      return publicRecord(previous);
    }
    if (!ports.enabled(plugin, input.cwd)) throw new Error("Plugin is disabled");
    const now = timestamp();
    const operation: LiveProjectOperation = { record: { version: 1, id: input.requestId, requestId: input.requestId, pluginId, action: input.action,
      project: project.identity, anchor: project.anchor, cwd: input.cwd, createdAt: now, updatedAt: now, state: "preparing", inputDigest }, controller: new AbortController(), claimed: false, completion: completion() };
    persist(operation.record); live.set(operation.record.id, operation);
    try {
      // Preserve preparation rejection after claim; only registered related roots
      // from the resolver are admitted, never arbitrary payload paths.
      admission.admitRelated(project.relatedDirectories);
    } catch (error) {
      // This UUID stays claimed. Own only failure reporting, not an executor that
      // never started, and preserve the original error for the HTTP boundary.
      operation.completion!.fullySettled = settleAdmissionFailure(operation, error);
      throw error;
    }
    // Retain the entire run, including failure reporting, before returning to callers.
    operation.completion!.fullySettled = executeOwned(operation, plugin, adapter, input.payload);
    return publicRecord(operation.record);
  }
  function finishOwned(operation: LiveProjectOperation) {
    const done = operation.completion!;
    done.settled = true;
    // Never evict an executor merely because it published a terminal receipt.
    const settled = [...live].filter(([, item]) => item.completion?.settled);
    for (const [id] of settled.slice(0, Math.max(0, settled.length - 64))) live.delete(id);
    done.publishReview(); // No review was possible on early failure/abort.
  }
  async function settleAdmissionFailure(operation: LiveProjectOperation, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      update(operation, { state: "failed", error: message });
    } catch (persistenceError) {
      operation.record = { ...operation.record, state: "outcome-unknown", error: message, persistenceError: String(persistenceError) };
    } finally {
      finishOwned(operation);
    }
  }
  async function executeOwned(operation: LiveProjectOperation, plugin: BundledPlugin, adapter: NonNullable<BundledPlugin["projectActions"]>, payload: unknown) {
    try {
      await run(operation, plugin, adapter, payload);
    } catch (error) {
      // A failed failure-report write must not fabricate a durable settlement.
      operation.record = { ...operation.record, state: "outcome-unknown", persistenceError: String(error), expiresAt: undefined };
    } finally {
      finishOwned(operation);
    }
  }
  async function run(operation: LiveProjectOperation, plugin: BundledPlugin, adapter: NonNullable<BundledPlugin["projectActions"]>, payload: unknown) {
    const { controller } = operation;
    let isInUse: (path: string) => boolean;
    const assertAdmission = () => admission.assertInvocation(operation.record.cwd);
    try {
      isInUse = await ports.observers();
      controller.signal.throwIfAborted();
      const ui: PluginUiContext = {
        isDirectoryInUse: isInUse,
        reserveDirectory: (path) => { assertAdmission(); return ports.reserveDirectory(path, isInUse); },
        prepareReview: (id, operationId, build) => { if (id !== plugin.manifest.id) throw new Error("Review owner mismatch"); return ports.prepareReview(id, operationId, build); },
        operationReceipt: (id, receipt) => {
          if (id !== plugin.manifest.id) throw new Error("Receipt owner mismatch");
          assertAdmission(); validateOperationReceipt(receipt);
          if (operation.record.receipt && operation.record.receipt.operationId !== receipt.operationId) throw new Error("Receipt operation changed");
          update(operation, { receipt: structuredClone(receipt), ...(receipt.phase === "executing" ? { state: "dispatched" as const } : {}) });
        },
        pluginCard: async (id, card, signal) => {
          if (id !== plugin.manifest.id) throw new Error("Card owner mismatch");
          validatePluginCard(card, { allowRequiredAcknowledgment: true });
          if (controller.signal.aborted || signal?.aborted) return null;
          if (operation.claimed) throw new Error("Operation decision already claimed; prepare a new operation");
          // An unclaimed replacement revokes the old wait and gets a fresh host nonce.
          operation.answer?.(null);
          const snapshot = structuredClone(card), nonce = randomUUID();
          const acknowledgment = snapshot.requiredAcknowledgment === undefined ? undefined : {
            cardDigest: projectCardDigest(operation.record.id, nonce, snapshot), label: snapshot.requiredAcknowledgment,
          };
          const expiresAt = new Date(scheduler.now() + 15 * 60_000).toISOString();
          update(operation, { state: "review", expiresAt, acknowledgment });
          operation.card = snapshot; operation.cardNonce = nonce;
          return new Promise<string | null>((resolve) => {
            let settled = false;
            const finish = (answer: string | null) => {
              if (settled) return; settled = true;
              signal?.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", cancel);
              scheduler.clearTimeout(operation.timer); operation.timer = undefined; operation.answer = undefined; operation.card = undefined; operation.cardNonce = undefined;
              resolve(answer);
            };
            const cancel = () => finish(null);
            operation.answer = finish;
            signal?.addEventListener("abort", cancel, { once: true }); controller.signal.addEventListener("abort", cancel, { once: true });
            operation.timer = scheduler.setTimeout(() => controller.abort(new Error("Review expired")), 15 * 60_000); operation.timer.unref?.();
            operation.completion?.publishReview();
          });
        },
      };
      const result = await adapter.execute(operation.record.cwd, operation.record.action, payload, ui, controller.signal,
        (progress) => { operation.record.progress = progress.slice(0, 2000); });
      const receipt = operation.record.receipt;
      update(operation, { result, state: receipt?.phase === "succeeded" ? "succeeded" : receipt?.phase === "cancelled" || controller.signal.aborted && !receipt?.effectStarted ? "cancelled" : "failed", expiresAt: undefined });
    } catch (error) {
      update(operation, { state: controller.signal.aborted && !operation.record.receipt?.effectStarted ? "cancelled" : "failed", error: error instanceof Error ? error.message : String(error), expiresAt: undefined });
    } finally {
      operation.answer?.(null);
      scheduler.clearTimeout(operation.timer); operation.card = undefined; operation.cardNonce = undefined; operation.answer = undefined;
      operation.timer = undefined;
    }
  }
  async function getProjectOperation(pluginId: string, id: string): Promise<ProjectOperation> { return publicRecord(await owned(pluginId, id)); }
  async function decideProjectOperation(pluginId: string, id: string, cwd: string, decision: "approve" | "reject" | "stop", acknowledgment?: ProjectAcknowledgmentAnswer): Promise<ProjectOperation> {
    const input = parseProjectActionDecision({ cwd, decision, ...(acknowledgment !== undefined ? { acknowledgment } : {}) });
    const record = await owned(pluginId, id);
    if (!samePath(cwd, record.cwd)) throw new Error("Selected invocation checkout changed; discard review");
    await allowed(cwd);
    const operation = live.get(id);
    if (!operation) throw new Error("Historical operation cannot execute; prepare a new review");
    if (operation.claimed && decision !== "stop") {
      if (operation.record.decision !== decision) throw new Error("Decision already claimed");
      if (decision === "approve") assertProjectAcknowledgment(operation.record.acknowledgment, input.acknowledgment, true);
      return publicRecord(operation.record);
    }
    if (terminal(operation.record.state)) {
      if (decision === "approve") assertProjectAcknowledgment(operation.record.acknowledgment, input.acknowledgment, true);
      return publicRecord(operation.record);
    }
    if (decision !== "stop" && (operation.record.state !== "review" || !operation.card || !operation.answer || !operation.card.actions.some((a) => a.id === decision))) throw new Error("No live review accepts this decision");
    if (decision === "approve") {
      const card = operation.card!, required = operation.record.acknowledgment;
      if (card.requiredAcknowledgment !== undefined && (!required || !operation.cardNonce || required.label !== card.requiredAcknowledgment
        || required.cardDigest !== projectCardDigest(operation.record.id, operation.cardNonce, card))) throw new Error("No current exact-card acknowledgment descriptor");
      if (card.requiredAcknowledgment === undefined && required) throw new Error("Acknowledgment descriptor does not belong to the live card");
      assertProjectAcknowledgment(required, input.acknowledgment);
      if (!ports.enabled(capability(pluginId).plugin, cwd)) throw new Error("Plugin disabled; review no longer executable");
    }
    const decisionAt = timestamp();
    const changes: Partial<Stored> = { decision, decisionAt, expiresAt: undefined,
      ...(decision === "approve" && operation.record.acknowledgment ? {
        acknowledgment: { ...operation.record.acknowledgment, accepted: true, acceptedAt: decisionAt },
      } : {}),
    };
    if (decision === "approve") {
      // Granting authority always requires a durable claim before confirmation.
      update(operation, changes); operation.claimed = true;
      operation.answer!(decision);
    } else {
      // Revocation must not depend on disk health. No await occurs between claim,
      // removing the live controls and rejecting/aborting the executable promise.
      operation.claimed = true;
      operation.record = { ...operation.record, ...changes, expiresAt: undefined,
        progress: "Authority revoked; awaiting execution settlement. Dispatched effects are not undone." };
      if (decision === "stop") controllerStop(operation); else operation.answer!(decision);
      operation.card = undefined;
      try { update(operation, {}); }
      catch (error) { operation.record = { ...operation.record, persistenceError: `Authority revoked, but decision persistence failed: ${String(error)}` }; }
    }
    return publicRecord(operation.record);
  }
  function controllerStop(operation: LiveProjectOperation) { operation.controller.abort(new Error("Stopped by browser; dispatched effects may already have occurred")); }
  async function listProjectOperations(pluginId: string, cwd: string): Promise<ProjectOperation[]> {
    await allowed(cwd);
    const project = await capability(pluginId).adapter.resolveProject(cwd);
    const records: Stored[] = [];
    for (const id of store.ids()) {
      const saved = live.get(id)?.record ?? read(id);
      if (saved?.pluginId === pluginId && saved.project === project.identity) records.push(saved);
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(publicRecord);
  }
  async function projectOperationReview(pluginId: string, id: string, reviewId: string) {
    const record = await owned(pluginId, id);
    const ref = record.receipt?.card.review;
    if (!ref || ref.id !== reviewId) throw new Error("Review is not owned by this operation");
    return ref;
  }

  return {
    prepareProjectAction, getProjectOperation, decideProjectOperation, listProjectOperations, projectOperationReview,
    /** Internal ownership handles, not HTTP capabilities. reviewReady means live
     * controls installed OR fully settled without review; read status afterward.
     * A terminal status alone is never a substitute for fullySettled. */
    completion(id: string): { reviewReady: Promise<void>; fullySettled: Promise<void> } {
      const item = live.get(id)?.completion;
      if (!item?.fullySettled) throw new Error("Operation has no owned completion (historical or older HMR generation)");
      return { reviewReady: item.reviewReady, fullySettled: item.fullySettled };
    },
    abort(id: string) { const item = live.get(id); if (item) controllerStop(item); },
  };
}
