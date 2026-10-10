import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { acquireDirectoryReservation } from "../directory-reservations";
import { allowFileRoot, getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../file-access";
import { samePath } from "../paths";
import { validateOperationReceipt } from "../operation-receipts";
import { bundledPlugin } from "./registry";
import { readPluginSettings } from "./settings";
import { preparePluginReview } from "./review-store";
import { isOperationId, validatePluginCard } from "./ui";
import { assertProjectAcknowledgment, parseProjectActionDecision, projectCardDigest, validateSavedProjectAcknowledgment } from "./project-acknowledgment";
import type { ProjectAcknowledgmentAnswer, ProjectActionPrepare, ProjectOperation } from "./project-operation-types";
import type { BundledPlugin, PluginUiContext } from "./types";

interface Stored extends ProjectOperation { inputDigest: string }
interface Live { record: Stored; controller: AbortController; answer?: (answer: string | null) => void; card?: ProjectOperation["card"]; cardNonce?: string; timer?: ReturnType<typeof setTimeout>; claimed: boolean }
const key = Symbol.for("pi-web:project-operations/v1");
const host = globalThis as typeof globalThis & { [key]?: Map<string, Live> };
const live = host[key] ??= new Map<string, Live>();
const root = () => join(getAgentDir(), "pi-web", "project-operations");
const terminal = (state: string) => ["succeeded", "failed", "cancelled", "outcome-unknown"].includes(state);
function file(id: string) { if (!isOperationId(id)) throw new Error("Invalid operation ID"); return join(root(), `${id}.json`); }
function persist(record: Stored) {
  mkdirSync(root(), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(file(record.id), JSON.stringify(record));
  if (process.platform !== "win32") { const fd = openSync(root(), "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
}
function read(id: string): Stored | undefined {
  if (!existsSync(file(id))) return;
  const fd = openSync(file(id), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Invalid operation record");
    const value = JSON.parse(readFileSync(fd, "utf8")) as Stored;
    if (value.version !== 1 || value.id !== id || value.requestId !== id || !/^[a-f0-9]{64}$/.test(value.inputDigest)
      || typeof value.project !== "string" || typeof value.anchor !== "string" || typeof value.cwd !== "string") throw new Error("Invalid operation record");
    if (value.receipt) validateOperationReceipt(value.receipt);
    validateSavedProjectAcknowledgment(value);
    return value;
  } finally { closeSync(fd); }
}
function update(operation: Live, changes: Partial<Stored>) {
  const next = { ...operation.record, ...changes, updatedAt: new Date().toISOString() };
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
async function allowed(cwd: string) {
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots) || !samePath(realpathSync(cwd), cwd)) throw new Error("Access denied: select an allowed physical directory");
}
function capability(pluginId: string): { plugin: BundledPlugin; adapter: NonNullable<BundledPlugin["projectActions"]> } {
  const plugin = bundledPlugin(pluginId);
  if (!plugin.projectActions) throw new Error("Plugin does not support project actions");
  return { plugin, adapter: plugin.projectActions };
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
async function observers() {
  const [{ hasBusyRpcSessionWithin }, { hasActiveTerminalWithin }] = await Promise.all([import("../rpc-manager"), import("../terminal-manager")]);
  return (path: string) => hasBusyRpcSessionWithin(path) || hasActiveTerminalWithin(path);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Idempotent preparation: an existing UUID is lookup-only, including after restart. */
export async function prepareProjectAction(pluginId: string, input: ProjectActionPrepare): Promise<ProjectOperation> {
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
  if (!readPluginSettings(plugin.manifest, input.cwd).enabled) throw new Error("Plugin is disabled");
  const now = new Date().toISOString();
  const operation: Live = { record: { version: 1, id: input.requestId, requestId: input.requestId, pluginId, action: input.action,
    project: project.identity, anchor: project.anchor, cwd: input.cwd, createdAt: now, updatedAt: now, state: "preparing", inputDigest }, controller: new AbortController(), claimed: false };
  persist(operation.record); live.set(operation.record.id, operation);
  // Deliberate admission of physical registered related roots, never arbitrary payload paths.
  for (const path of project.relatedDirectories) if (existsSync(path) && samePath(path, realpathSync(path))) allowFileRoot(path);
  void run(operation, plugin, adapter, input.payload).catch((error) => {
    // A storage failure after effects must not fabricate a durable settlement.
    operation.record = { ...operation.record, state: "outcome-unknown", persistenceError: String(error), card: undefined };
    operation.card = undefined;
  });
  return publicRecord(operation.record);
}
async function run(operation: Live, plugin: BundledPlugin, adapter: NonNullable<BundledPlugin["projectActions"]>, payload: unknown) {
  const { controller } = operation;
  let isInUse: (path: string) => boolean;
  const assertAdmission = () => {
    const roots = getKnownAllowedFileRoots();
    if (!isFilePathAllowed(operation.record.cwd, roots) || !isExistingFilePathAllowed(operation.record.cwd, roots)) throw new Error("Invocation directory access changed");
  };
  try {
    isInUse = await observers();
    controller.signal.throwIfAborted();
    const ui: PluginUiContext = {
      isDirectoryInUse: isInUse,
      reserveDirectory: (path) => { assertAdmission(); return acquireDirectoryReservation(path, isInUse); },
      prepareReview: (id, operationId, build) => { if (id !== plugin.manifest.id) throw new Error("Review owner mismatch"); return preparePluginReview(id, operationId, build); },
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
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        update(operation, { state: "review", expiresAt, acknowledgment });
        operation.card = snapshot; operation.cardNonce = nonce;
        return new Promise<string | null>((resolve) => {
          let settled = false;
          const finish = (answer: string | null) => {
            if (settled) return; settled = true;
            signal?.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", cancel);
            clearTimeout(operation.timer); operation.timer = undefined; operation.answer = undefined; operation.card = undefined; operation.cardNonce = undefined;
            resolve(answer);
          };
          const cancel = () => finish(null);
          operation.answer = finish;
          signal?.addEventListener("abort", cancel, { once: true }); controller.signal.addEventListener("abort", cancel, { once: true });
          operation.timer = setTimeout(() => controller.abort(new Error("Review expired")), 15 * 60_000); operation.timer.unref?.();
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
    clearTimeout(operation.timer); operation.card = undefined; operation.cardNonce = undefined; operation.answer = undefined;
    // Retain only bounded live results. Saved records never reconstruct authority.
    const settled = [...live].filter(([, item]) => terminal(item.record.state));
    for (const [id] of settled.slice(0, Math.max(0, settled.length - 64))) live.delete(id);
  }
}
export async function getProjectOperation(pluginId: string, id: string): Promise<ProjectOperation> { return publicRecord(await owned(pluginId, id)); }
export async function decideProjectOperation(pluginId: string, id: string, cwd: string, decision: "approve" | "reject" | "stop", acknowledgment?: ProjectAcknowledgmentAnswer): Promise<ProjectOperation> {
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
    if (!readPluginSettings(capability(pluginId).plugin.manifest, cwd).enabled) throw new Error("Plugin disabled; review no longer executable");
  }
  const decisionAt = new Date().toISOString();
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
function controllerStop(operation: Live) { operation.controller.abort(new Error("Stopped by browser; dispatched effects may already have occurred")); }
export async function listProjectOperations(pluginId: string, cwd: string): Promise<ProjectOperation[]> {
  await allowed(cwd);
  const project = await capability(pluginId).adapter.resolveProject(cwd);
  const records: Stored[] = [];
  if (existsSync(root())) for (const name of readdirSync(root())) {
    if (!name.endsWith(".json") || !isOperationId(name.slice(0, -5))) continue;
    const saved = live.get(name.slice(0, -5))?.record ?? read(name.slice(0, -5));
    if (saved?.pluginId === pluginId && saved.project === project.identity) records.push(saved);
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(publicRecord);
}
export async function projectOperationReview(pluginId: string, id: string, reviewId: string) {
  const record = await owned(pluginId, id);
  const ref = record.receipt?.card.review;
  if (!ref || ref.id !== reviewId) throw new Error("Review is not owned by this operation");
  return ref;
}
