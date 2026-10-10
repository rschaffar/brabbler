import type { PluginCard, PluginOperationReceipt } from "./types";
export type ProjectOperationState = "preparing" | "review" | "dispatched" | "succeeded" | "failed" | "cancelled" | "outcome-unknown";
/** Server-owned identity for one frozen card. Accepted evidence is never replayable authority. */
export interface ProjectAcknowledgment {
  cardDigest: string; label: string; accepted?: true; acceptedAt?: string;
}
export interface ProjectAcknowledgmentAnswer { cardDigest: string; accepted: true }
/** Client-safe status; saved records are observations, never replayable authority. */
export interface ProjectOperation {
  version: 1; id: string; requestId: string; pluginId: string; action: string;
  project: string; anchor: string; cwd: string; createdAt: string; updatedAt: string;
  state: ProjectOperationState; progress?: string; error?: string; result?: unknown;
  receipt?: PluginOperationReceipt;
  /** Only a live, unclaimed review has actionable controls. Historical cards have none. */
  card?: PluginCard; decision?: "approve" | "reject" | "stop"; decisionAt?: string;
  /** Stable during this review; retained read-only with the recorded decision/outcome. */
  acknowledgment?: ProjectAcknowledgment;
  reviewBaseUrl?: string; expiresAt?: string; persistenceError?: string;
}
export interface ProjectActionPrepare {
  cwd: string; requestId: string; action: string; payload: unknown;
}
export interface ProjectActionDecision {
  cwd: string; decision: "approve" | "reject" | "stop";
  /** Only approval may carry an acknowledgment; it must match the live server descriptor. */
  acknowledgment?: ProjectAcknowledgmentAnswer;
}
