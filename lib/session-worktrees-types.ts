/** Shared wire contract. A serialized plan is a proposal, never move authority. */
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
}
export type SessionMoveRequest = SessionMovePreviewRequest | SessionMoveExecuteRequest;
export interface SessionMovePreviewResponse {
  plan: SessionMovePlan;
  skippedAlreadyThere?: string[];
}
export interface SessionMoveExecuteResponse {
  succeeded: string[];
  failed: { id: string; error: string }[];
  skipped: string[];
  movedIds: string[];
}
