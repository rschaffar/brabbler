import { createHash } from "node:crypto";
import { isOperationId, validatePluginCard } from "./ui";
import type { PluginCard } from "./types";
import type { ProjectAcknowledgment, ProjectAcknowledgmentAnswer, ProjectActionDecision, ProjectOperation } from "./project-operation-types";

const DIGEST = /^[a-f0-9]{64}$/;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function digest(value: unknown): value is string { return typeof value === "string" && DIGEST.test(value); }
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** The nonce belongs to the host's live card, not the client or plugin. Replacement
 * cards get fresh identities even when their presentation is byte-for-byte equal.
 * Hash the complete card before historical actions are stripped. */
export function projectCardDigest(operationId: string, nonce: string, card: PluginCard): string {
  if (!isOperationId(operationId) || !isOperationId(nonce)) throw new Error("Invalid project card identity");
  validatePluginCard(card, { allowRequiredAcknowledgment: true });
  return createHash("sha256").update(JSON.stringify(canonical([operationId, nonce, card]))).digest("hex");
}

/** Strict, detached API envelope; no coercion or mutable caller-owned answer. */
export function parseProjectActionDecision(value: unknown): ProjectActionDecision {
  if (!object(value) || Object.keys(value).some((key) => !["cwd", "decision", "acknowledgment"].includes(key))
    || !Object.hasOwn(value, "cwd") || typeof value.cwd !== "string" || !value.cwd
    || !Object.hasOwn(value, "decision") || !["approve", "reject", "stop"].includes(value.decision as string)) throw new Error("Invalid decision payload");
  let acknowledgment: ProjectAcknowledgmentAnswer | undefined;
  if (Object.hasOwn(value, "acknowledgment")) {
    const answer = value.acknowledgment;
    if (value.decision !== "approve" || !object(answer) || Object.keys(answer).length !== 2
      || !Object.hasOwn(answer, "cardDigest") || !Object.hasOwn(answer, "accepted")
      || !digest(answer.cardDigest) || answer.accepted !== true) throw new Error("Invalid acknowledgment payload");
    acknowledgment = { cardDigest: answer.cardDigest, accepted: true };
  }
  return { cwd: value.cwd, decision: value.decision as ProjectActionDecision["decision"], ...(acknowledgment ? { acknowledgment } : {}) };
}

/** Matching approval retries must repeat the exact envelope, not just "approve". */
export function assertProjectAcknowledgment(required: ProjectAcknowledgment | undefined, answer: ProjectAcknowledgmentAnswer | undefined, duplicate = false): void {
  if (!required) {
    if (answer !== undefined) throw new Error("This review does not accept an acknowledgment");
    return;
  }
  if (!answer || answer.accepted !== true || answer.cardDigest !== required.cardDigest || duplicate && required.accepted !== true)
    throw new Error("Explicit acknowledgment of the current exact card is required");
}

/** Saved metadata is evidence only. A prepared receipt can be written BEFORE the
 * live-card descriptor exists, so its requirement alone must not demand one.
 * Stop can follow approval: preserve the original acceptedAt, not Stop's time. */
export function validateSavedProjectAcknowledgment(record: Pick<ProjectOperation, "acknowledgment" | "decision" | "decisionAt" | "receipt">): void {
  const value: unknown = record.acknowledgment;
  if (value === undefined) {
    if (record.decision === "approve" && record.receipt?.card.requiredAcknowledgment !== undefined)
      throw new Error("Invalid operation record: missing approved acknowledgment");
    return;
  }
  if (!object(value) || Object.keys(value).some((key) => !["cardDigest", "label", "accepted", "acceptedAt"].includes(key))
    || !Object.hasOwn(value, "cardDigest") || !digest(value.cardDigest)
    || !Object.hasOwn(value, "label") || typeof value.label !== "string" || !value.label.trim() || value.label.length > 4096
    || value.accepted !== undefined && value.accepted !== true
    || (value.accepted === true ? !timestamp(value.acceptedAt) || !["approve", "stop"].includes(record.decision ?? "") || !timestamp(record.decisionAt)
      || record.decision === "approve" && value.acceptedAt !== record.decisionAt : value.acceptedAt !== undefined || record.decision === "approve"))
    throw new Error("Invalid operation record: acknowledgment metadata");
}
