import { closeSync, constants, existsSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { validateOperationReceipt } from "../operation-receipts";
import { isOperationId } from "./ui";
import { validateSavedProjectAcknowledgment } from "./project-acknowledgment";
import type { ProjectOperation } from "./project-operation-types";
import { readOperationReview, type OperationReviewRecord } from "./review-metadata";

export interface StoredProjectOperation extends ProjectOperation { inputDigest: string; reviewMetadata?: OperationReviewRecord[] }
/** The existing operation JSON is the sole standalone metadata owner. */
export function validateProjectReviewMetadata(record: StoredProjectOperation): void {
  if (record.reviewMetadata === undefined) {
    if (record.receipt?.card.review?.version === 2) throw new Error("Missing operation review metadata");
    return;
  }
  if (!Array.isArray(record.reviewMetadata)) throw new Error("Invalid operation review metadata");
  const ids = new Set<string>();
  for (const value of record.reviewMetadata) {
    const review = readOperationReview(value);
    if (!review || ids.has(review.id) || review.pluginId !== record.pluginId
      || record.receipt && review.operationId !== record.receipt.operationId) throw new Error("Invalid operation review metadata owner");
    ids.add(review.id);
  }
  const ref = record.receipt?.card.review;
  if (ref?.version === 2 && !record.reviewMetadata.some(item => item.id === ref.id && item.operationId === ref.operationId)) throw new Error("Missing operation review metadata");
}
/** Saves are synchronous: successful return is the authority/dispatch durability boundary. */
export interface ProjectOperationStore {
  save(record: StoredProjectOperation): void;
  read(id: string): StoredProjectOperation | undefined;
  ids(): string[];
}

/** Resolve the root per access, preserving the application's agent-directory lifecycle. */
export function createFileProjectOperationStore(root: () => string): ProjectOperationStore {
  function file(id: string) { if (!isOperationId(id)) throw new Error("Invalid operation ID"); return join(root(), `${id}.json`); }
  function save(record: StoredProjectOperation) {
    mkdirSync(root(), { recursive: true, mode: 0o700 });
    writePrivateFileAtomicSync(file(record.id), JSON.stringify(record));
    if (process.platform !== "win32") { const fd = openSync(root(), "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
  }
  function read(id: string): StoredProjectOperation | undefined {
    if (!existsSync(file(id))) return;
    const fd = openSync(file(id), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!fstatSync(fd).isFile()) throw new Error("Invalid operation record");
      const value = JSON.parse(readFileSync(fd, "utf8")) as StoredProjectOperation;
      if (value.version !== 1 || value.id !== id || value.requestId !== id || !/^[a-f0-9]{64}$/.test(value.inputDigest)
        || typeof value.project !== "string" || typeof value.anchor !== "string" || typeof value.cwd !== "string") throw new Error("Invalid operation record");
      if (value.receipt) validateOperationReceipt(value.receipt);
      validateProjectReviewMetadata(value);
      validateSavedProjectAcknowledgment(value);
      return value;
    } finally { closeSync(fd); }
  }
  return { save, read, ids: () => existsSync(root()) ? readdirSync(root())
    .filter((name) => name.endsWith(".json") && isOperationId(name.slice(0, -5))).map((name) => name.slice(0, -5)) : [] };
}
