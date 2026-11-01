import { createHash, randomUUID } from "node:crypto";
import { isOperationId, isOperationReviewReference, OPERATION_REVIEW_TYPE, type OperationReviewReference } from "./review-reference";
export { isOperationReviewReference, OPERATION_REVIEW_TYPE, type OperationReviewReference } from "./review-reference";

export type ReviewMetadataValue = null | boolean | number | string | ReviewMetadataValue[] | { [key: string]: ReviewMetadataValue };
/** Hidden host-owned metadata, not a card, model message or execution capability.
 * Plugin format validators decide its content; raw source/patch bodies do not belong
 * in a Git review payload. Stage receipts repeat only the small reference. */
export interface OperationReviewRecord {
  version: 1; id: string; pluginId: string; operationId: string; format: string;
  payload: ReviewMetadataValue; sha256: string;
}
interface ReviewEntry { type: string; id: string; parentId: string | null; customType?: string; data?: unknown }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("Invalid operation review metadata");
/** JSON serialization must not silently drop/coerce data or execute custom toJSON
 * methods. No card-size ceiling: real SDK native tests own practical size limits. */
function detach(value: unknown, ancestors = new Set<object>()): ReviewMetadataValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (typeof value !== "object" || ancestors.has(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) throw invalid();
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) throw invalid();
        return detach(descriptor.value, ancestors);
      });
    }
    const result: { [key: string]: ReviewMetadataValue } = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw invalid();
      result[key] = detach(descriptor.value, ancestors);
    }
    return result;
  } finally { ancestors.delete(value); }
}
function digest(record: Omit<OperationReviewRecord, "sha256">) {
  return createHash("sha256").update(JSON.stringify([record.version, record.id, record.pluginId, record.operationId, record.format, record.payload])).digest("hex");
}
export function operationReviewReference(record: OperationReviewRecord): OperationReviewReference {
  return { version: 2, id: record.id, operationId: record.operationId };
}
/** Construct and detach before any SDK append. The persistence host must not
 * publish this reference until append, initial flush and its save barrier succeed. */
export function snapshotOperationReview(pluginId: string, operationId: string, format: string, payload: unknown, id: string = randomUUID()): OperationReviewRecord {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId) || !isOperationId(operationId) || !isOperationId(id)
    || !/^[a-z][a-z0-9-]{0,63}\/v[1-9][0-9]*$/.test(format)) throw invalid();
  const record = { version: 1 as const, id, pluginId, operationId, format, payload: detach(payload) };
  return { ...record, sha256: digest(record) };
}
export function readOperationReview(value: unknown): OperationReviewRecord | null {
  if (!object(value) || Object.keys(value).length !== 7 || value.version !== 1 || typeof value.pluginId !== "string"
    || typeof value.operationId !== "string" || typeof value.id !== "string" || typeof value.format !== "string"
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return null;
  try {
    const snapshot = snapshotOperationReview(value.pluginId, value.operationId, value.format, value.payload, value.id);
    return snapshot.sha256 === value.sha256 ? snapshot : null;
  } catch { return null; }
}
/** Resolve an exact record on the referencing entry's ancestry, never the newest
 * result sharing an operation UUID elsewhere in the file, parent or sibling fork.
 * Copies retain record IDs but acquire no new authority. Contradictory IDs refuse. */
export function findOperationReview(entries: readonly ReviewEntry[], pluginId: string, reference: OperationReviewReference, leafId: string): OperationReviewRecord | null {
  if (!isOperationReviewReference(reference)) return null;
  const byId = new Map<string, ReviewEntry>(), matches = new Map<string, OperationReviewRecord>();
  let identity: OperationReviewRecord | undefined;
  for (const entry of entries) {
    if (byId.has(entry.id)) return null;
    byId.set(entry.id, entry);
    if (entry.type === "custom" && entry.customType === OPERATION_REVIEW_TYPE && object(entry.data) && entry.data.id === reference.id) {
      const record = readOperationReview(entry.data);
      if (!record || record.pluginId !== pluginId || record.operationId !== reference.operationId || identity && identity.sha256 !== record.sha256) return null;
      identity = record; matches.set(entry.id, record);
    }
  }
  const visited = new Set<string>(); let id: string | null = leafId, found: OperationReviewRecord | null = null;
  while (id !== null) {
    if (visited.has(id)) return null;
    visited.add(id);
    const entry = byId.get(id); if (!entry) return null;
    if (matches.has(id)) found = matches.get(id)!;
    id = entry.parentId;
  }
  return found;
}
