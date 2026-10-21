/** Shared wire contract. A serialized plan is a proposal, never move authority. */
export const SESSION_MOVE_BATCH_ROOT_LIMIT = 5;
export const SESSION_MOVE_BATCH_BUDGET_MS = 10_000;
export interface SessionWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
  state: "present" | "missing" | "unavailable";
  sessionCount: number;
  archivedCount: number;
}
export interface SessionWorktreeInventory {
  projectRoot: string;
  mainCwd: string | null;
  worktrees: SessionWorktree[];
}
export interface SessionMovePlanRoot {
  id: string;
  sourceCwd: string;
  memberIds: string[];
  bindings: { id: string; cwd: string; path: string }[];
}
export interface SessionMovePlan {
  project: string;
  cwd: string;
  missingOnly: boolean;
  roots: SessionMovePlanRoot[];
  sessionCount: number;
  archivedCount: number;
  /** Entire reviewed write footprint, including incoming fork/subagent references. */
  affectedIds: string[];
}
export interface SessionMovePreviewRequest {
  mode: "preview";
  project: string;
  ids?: string[];
  cwd?: string;
  missingOnly?: boolean;
}
export interface SessionMoveExecuteRequest {
  mode: "execute";
  plan: SessionMovePlan;
  rootIds?: string[];
}
export interface SessionMoveReconcileRequest {
  mode: "reconcile";
  plan: SessionMovePlan;
  rootIds: string[];
}
export type SessionMoveRequest = SessionMovePreviewRequest | SessionMoveExecuteRequest | SessionMoveReconcileRequest;
export interface SessionMovePreviewResponse {
  plan: SessionMovePlan;
  skippedAlreadyThere?: string[];
}
export interface SessionMoveExecuteResponse {
  succeeded: string[];
  failed: { id: string; error: string }[];
  skipped: string[];
  movedIds: string[];
  /** Reviewed roots not attempted in this request; never failures. */
  pending: string[];
}
export type SessionMoveObservedState = "destination" | "source" | "changed" | "unknown";
export interface SessionMoveReconcileResponse {
  roots: { id: string; state: SessionMoveObservedState; memberIds: string[] }[];
}
