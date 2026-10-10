import type { PluginOperationReceipt } from "./plugins/types";
import { isOperationId, validatePluginCard } from "./plugins/ui";
import type { AgentMessage, CustomMessage, SessionEntry } from "./types";

export type { PluginOperationReceipt } from "./plugins/types";
export const OPERATION_RECEIPT_TYPE = "pi-web:operation-receipt";
/** Host-owned ordering metadata, not plugin execution authority. */
export interface OperationReceiptSnapshot extends PluginOperationReceipt {
  pluginId: string;
  sequence: number;
}
const phases = ["prepared", "authorized", "checking", "executing", "succeeded", "failed", "cancelled"];
const decisions = ["pending", "user-approved", "policy-authorized", "not-approved"];
const checkStatuses = ["pending", "running", "passed", "failed"];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !!value.trim();
}

/** Validate both plugin submissions and untrusted historical data. No partial snapshots. */
export function validateOperationReceipt(value: unknown): asserts value is PluginOperationReceipt {
  if (!record(value) || value.version !== 1 || !isOperationId(value.operationId)
    || value.toolCallId !== undefined && !text(value.toolCallId, 256)
    || !record(value.card) || !phases.includes(value.phase as string)
    || !record(value.authorization) || !["ask", "allow"].includes(value.authorization.mode as string)
    || !text(value.authorization.source, 256) || !text(value.authorization.revision, 1024)
    || !decisions.includes(value.authorization.decision as string)
    || value.authorization.mode === "allow" && value.authorization.decision === "user-approved"
    || value.authorization.mode === "ask" && value.authorization.decision === "policy-authorized"
    || !Array.isArray(value.checks)
    || value.checks.some((check) => !record(check) || !text(check.name, 256) || !checkStatuses.includes(check.status as string))
    || typeof value.effectStarted !== "boolean"
    || value.completedEffects !== undefined && (!Array.isArray(value.completedEffects) || value.completedEffects.some((step) => typeof step !== "string"))
    || value.attemptedEffect !== undefined && typeof value.attemptedEffect !== "string"
    || value.summary !== undefined && (typeof value.summary !== "string" || value.summary.length > 16384)) {
    throw new Error("Invalid operation receipt");
  }
  // Receipt metadata is read-only evidence, never a session approval transport.
  validatePluginCard(value.card as unknown as PluginOperationReceipt["card"], { allowRequiredAcknowledgment: true });
  if (value.card.operationId !== undefined && value.card.operationId !== value.operationId) {
    throw new Error("Operation receipt card correlation mismatch");
  }
}

/** Continue ordering even when a fork copied entries with gaps in their original sequence. */
export function nextOperationReceiptSequence(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): number {
  return entries.reduce((latest, entry) => {
    const data = entry.data;
    return entry.type === "custom" && entry.customType === OPERATION_RECEIPT_TYPE && record(data)
      && typeof data.sequence === "number" && Number.isSafeInteger(data.sequence)
      ? Math.max(latest, data.sequence) : latest;
  }, 0) + 1;
}

/** Detach caller-owned nested data and remove all historical action controls. */
export function snapshotOperationReceipt(pluginId: string, receipt: PluginOperationReceipt, sequence: number): OperationReceiptSnapshot {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Invalid operation receipt metadata");
  }
  validateOperationReceipt(receipt);
  const { version, operationId, toolCallId, card, phase, authorization, checks, effectStarted, completedEffects, attemptedEffect, summary } = receipt;
  return JSON.parse(JSON.stringify({
    version, pluginId, sequence, operationId, toolCallId,
    card: { ...card, operationId, actions: [] }, phase,
    authorization: { mode: authorization.mode, source: authorization.source, revision: authorization.revision, decision: authorization.decision },
    checks: checks.map(({ name, status }) => ({ name, status })), effectStarted, completedEffects, attemptedEffect, summary,
  })) as OperationReceiptSnapshot;
}

/** Unsupported versions and malformed entries stay hidden. */
export function readOperationReceipt(value: unknown): OperationReceiptSnapshot | null {
  if (!record(value) || typeof value.pluginId !== "string" || typeof value.sequence !== "number") return null;
  try {
    return snapshotOperationReceipt(value.pluginId, value as unknown as PluginOperationReceipt, value.sequence);
  } catch { return null; }
}

export function operationReceiptMessage(entry: SessionEntry): CustomMessage | null {
  if (entry.type !== "custom" || entry.customType !== OPERATION_RECEIPT_TYPE) return null;
  const receipt = readOperationReceipt(entry.data);
  const timestamp = Date.parse(entry.timestamp);
  if (!receipt || !Number.isFinite(timestamp)) return null;
  return { role: "custom", customType: OPERATION_RECEIPT_TYPE, display: true,
    content: receipt.card.title, details: receipt, timestamp };
}
function receiptOf(message: AgentMessage): OperationReceiptSnapshot | null {
  return message.role === "custom" && message.customType === OPERATION_RECEIPT_TYPE ? readOperationReceipt(message.details) : null;
}
function key(receipt: OperationReceiptSnapshot): string { return `${receipt.pluginId}:${receipt.operationId}`; }
type Transcript = { messages: AgentMessage[]; entryIds: string[] };

/** Keep the newest snapshot at its own entry position/identity, including across older pages. */
export function collapseOperationReceipts<T extends Transcript>(transcript: T): T {
  const winners = new Map<string, { index: number; sequence: number }>();
  const receiptIndexes = new Set<number>();
  transcript.messages.forEach((message, index) => {
    if (message.role !== "custom" || message.customType !== OPERATION_RECEIPT_TYPE) return;
    receiptIndexes.add(index);
    const receipt = receiptOf(message);
    if (!receipt) return;
    const previous = winners.get(key(receipt));
    if (!previous || receipt.sequence > previous.sequence) winners.set(key(receipt), { index, sequence: receipt.sequence });
  });
  const keep = new Set([...winners.values()].map(({ index }) => index));
  const indexes = transcript.messages.map((_, index) => index).filter((index) => !receiptIndexes.has(index) || keep.has(index));
  if (indexes.length === transcript.messages.length) return transcript;
  return { ...transcript, messages: indexes.map((index) => transcript.messages[index]), entryIds: indexes.map((index) => transcript.entryIds[index] ?? "") };
}

/** Caller must verify branch ancestry before merging. Sequence beats arrival order and timestamps. */
export function mergeOperationReceiptHistory<T extends Transcript>(transcript: T, history: Transcript,
  minimumTimestamp = transcript.messages.find((message) => Number.isFinite(message.timestamp))?.timestamp ?? -Infinity,
): T {
  let next = transcript;
  for (let index = 0; index < history.messages.length; index++) {
    const message = history.messages[index];
    const receipt = receiptOf(message);
    const id = history.entryIds[index];
    if (!receipt || !id || !Number.isFinite(message.timestamp) || next.entryIds.includes(id)) continue;
    const existingIndex = next.messages.findIndex((candidate) => {
      const existing = receiptOf(candidate);
      return existing && key(existing) === key(receipt);
    });
    if (existingIndex >= 0) {
      if (receiptOf(next.messages[existingIndex])!.sequence >= receipt.sequence) continue;
      next = { ...next, messages: next.messages.filter((_, i) => i !== existingIndex), entryIds: next.entryIds.filter((_, i) => i !== existingIndex) };
    } else if (message.timestamp! < minimumTimestamp) continue;
    const following = history.entryIds.slice(index + 1).find((entryId) => entryId && next.entryIds.includes(entryId));
    let position = following ? next.entryIds.indexOf(following) : next.messages.findIndex((candidate) =>
      Number.isFinite(candidate.timestamp) && candidate.timestamp! > message.timestamp!);
    if (position < 0) position = next.messages.length;
    next = { ...next, messages: [...next.messages.slice(0, position), message, ...next.messages.slice(position)],
      entryIds: [...next.entryIds.slice(0, position), id, ...next.entryIds.slice(position)] };
  }
  return next;
}
export function appendOperationReceipt<T extends Transcript>(transcript: T, entry: SessionEntry): T {
  const message = operationReceiptMessage(entry);
  return message ? mergeOperationReceiptHistory(transcript, { messages: [message], entryIds: [entry.id] }, -Infinity) : transcript;
}

export function operationAuthorizationLabel(receipt: PluginOperationReceipt): string {
  switch (receipt.authorization.decision) {
    case "policy-authorized": return "Policy authorized";
    case "user-approved": return "User approved";
    case "pending": return "Authorization pending";
    case "not-approved": return "Not approved";
  }
}
export function operationOutcomeLabel(receipt: PluginOperationReceipt): string {
  switch (receipt.phase) {
    case "succeeded": return "Succeeded";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return `No terminal outcome recorded · outcome unknown (${receipt.phase})`;
  }
}
