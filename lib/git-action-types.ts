import type { GitWorkflowCheck } from "./git-workflow-policy";

/** Plain SDK custom metadata, never a custom_message or provider message. */
export const GIT_ACTION_ANCHOR_TYPE = "pi-web:git-action";
export const GIT_ACTION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type GitActionKind = "commit" | "review" | "checks" | "integration";
export type GitActionState = "proposed" | "awaiting-decision" | "executing" | "succeeded" | "declined" | "cancelled" | "expired" | "blocked" | "failed" | "recovery-required";
export type GitActionSource = "agent" | "human" | "legacy-agent";
/** Optional v2 server-captured directory instances. Absence retains the original path-only v1 meaning. */
export interface GitActionResourceAttribution {
  version: 2;
  commonDir: string;
  commonIdentity: { device: string; inode: string; birthtime: string };
  projectIdentity: { device: string; inode: string; birthtime: string };
}
export interface GitActionAnchor { version: 1; actionId: string }

/** Allowlisted display data only: no review tokens, plan IDs, receipt IDs, jobs or approval capabilities. */
export interface GitActionCandidateSnapshot {
  kind: GitActionKind;
  /** Legacy source path; retain its original meaning for v1 records. */
  repositoryRoot: string;
  /** Captured canonical project and physical checkouts; display evidence, never authority. */
  projectRoot?: string;
  sourceCheckoutRoot?: string;
  targetCheckoutRoot?: string;
  /** Complete only with the v1 project/source paths; never inferred when reading history. */
  resourceAttribution?: GitActionResourceAttribution;
  featureBranch?: string;
  targetBranch?: string;
  message?: string;
  /** New commit snapshots record whether the candidate came from selected index entries. */
  commitMode?: "whole-file" | "staged";
  paths?: string[];
  parentOid?: string;
  candidateTreeOid?: string;
  featureOid?: string;
  targetOid?: string;
  mergeOid?: string;
  /** Method-specific integration evidence; older merge snapshots omit it. */
  integrationMethod?: "merge" | "ff";
  checks?: GitWorkflowCheck[];
  selection?: { kind: "merge" } | { kind: "commits"; commitOids: string[] };
  diff?: { fromTreeOid: string; toTreeOid: string; patch: string; hasBinaryChanges: boolean };
  diffUnavailable?: string;
}
export interface GitActionOutcome {
  status?: string;
  commit?: string;
  tree?: string;
  parents?: string[];
  authorEmail?: string;
  targetBranch?: string;
  featureOid?: string;
  targetOid?: string;
  mergeOid?: string;
}
export interface GitActionRecord {
  version: 1;
  id: string;
  sessionId: string;
  source: GitActionSource;
  kind: GitActionKind;
  state: GitActionState;
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** Process ownership is evidence, not persisted executable authority. */
  processId: string;
  summary: Omit<GitActionCandidateSnapshot, "diff">;
  artifact: { sha256: string; bytes: number };
  decision?: "approved" | "declined" | "cancelled" | "reviewed" | "dismissed";
  reason?: string;
  /** Prepared OIDs are not evidence that the ref/index update happened. */
  intended?: GitActionOutcome;
  outcome?: GitActionOutcome;
}
export interface GitActionHistoryResponse {
  record: GitActionRecord | null;
  candidate?: GitActionCandidateSnapshot;
  unavailable?: string;
}
export interface GitActionUpdateEvent {
  type: "git_action_update";
  actionId: string;
  revision: number;
  /** Present when an anchor was just appended; enough to project a small UI-only message. */
  entryId?: string;
  timestamp?: number;
}
export function isGitActionAnchor(value: unknown): value is GitActionAnchor {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (value as GitActionAnchor).version === 1 && typeof (value as GitActionAnchor).actionId === "string"
    && GIT_ACTION_ID_PATTERN.test((value as GitActionAnchor).actionId)
    && Object.keys(value).length === 2;
}
export function isTerminalGitAction(state: GitActionState): boolean {
  return !["proposed", "awaiting-decision", "executing"].includes(state);
}
