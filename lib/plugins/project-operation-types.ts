import type { PluginCard, PluginOperationReceipt } from "./types";
export type ProjectOperationState = "preparing" | "review" | "dispatched" | "succeeded" | "failed" | "cancelled" | "outcome-unknown";
/** Client-safe status; saved records are observations, never replayable authority. */
export interface ProjectOperation {
  version: 1; id: string; requestId: string; pluginId: string; action: string;
  project: string; anchor: string; cwd: string; createdAt: string; updatedAt: string;
  state: ProjectOperationState; progress?: string; error?: string; result?: unknown;
  receipt?: PluginOperationReceipt;
  /** Only a live, unclaimed review has actionable controls. Historical cards have none. */
  card?: PluginCard; decision?: "approve" | "reject" | "stop"; decisionAt?: string;
  reviewBaseUrl?: string; expiresAt?: string; persistenceError?: string;
}
export interface ProjectActionPrepare {
  cwd: string; requestId: string; action: string; payload: unknown;
}
export interface ProjectActionDecision { cwd: string; decision: "approve" | "reject" | "stop" }
