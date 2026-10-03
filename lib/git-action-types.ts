import type { GitWorkflowCheck } from "./git-workflow-policy";
import type { GitCheckRecipe, GitCheckStage } from "./git-check-recipe";
import type { GitSelectedCheckSnapshot } from "./git-operation-admission";

/** Plain SDK custom metadata, never a custom_message or provider message. */
export const GIT_ACTION_ANCHOR_TYPE = "pi-web:git-action";
export const GIT_ACTION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type GitActionKind = "commit" | "review" | "checks" | "integration" | "workspace" | "preparation" | "checkout-verification" | "cleanup";
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

export interface GitActionParentCreation {
  path: string; expectedAbsent: true; ancestorPath: string;
  ancestorIdentity: GitActionResourceAttribution["commonIdentity"]; mode: 448;
}
export interface GitActionKnownParentCreation {
  path: string; identity: GitActionResourceAttribution["commonIdentity"]; mode: number; ownerUid: number;
  ancestorPath: string; ancestorIdentity: GitActionResourceAttribution["commonIdentity"];
}
export interface GitActionWorkspaceSnapshot {
  mode: "create" | "attach";
  destinationPath: string;
  baseBranch: string;
  baseOid: string;
  branch: string;
  /** Intended full tip, including the base tip for create. */
  tipOid: string;
  /** Exact tracked tree captured by the native workspace candidate. */
  treeOid: string;
  /** Optional additional native effect, never silently inferred from a path. */
  parentCreation?: GitActionParentCreation;
}
export interface GitActionCheckoutSnapshot {
  gitDir: string;
  checkoutIdentity: GitActionResourceAttribution["commonIdentity"];
  gitIdentity: GitActionResourceAttribution["commonIdentity"];
  markerIdentity: GitActionResourceAttribution["commonIdentity"] & { changed?: string; size?: string };
}
export interface GitActionPreparationSnapshot {
  oldSourceOid: string;
  newSourceOid: string;
  targetMainOid: string;
  resultTreeOid: string;
  emptyRetention: "keep";
  commitCount: number;
  /** Required in the artifact, omitted from the concise record summary. Oldest first. */
  commitMapping?: { oldOid: string; newOid: string; oldTreeOid: string; newTreeOid: string; emptyAfterReplay: boolean }[];
  source: GitActionCheckoutSnapshot;
  target: GitActionCheckoutSnapshot;
}

export interface GitActionWorkingWorkspaceFlags {
  evidenceScope: "working-workspace"; candidateTreeVerified: false; repositoryChecksWaived: false;
}
export interface GitActionCheckExecution {
  actionId: string; sessionId: string; checkIndex: number; stage: GitCheckStage;
  recipeDigest: string; policyDigest: string; snapshotDigest: string; environmentDigest: string;
  executionCwd: string; startedAt: number; finishedAt: number;
  unit: string;
  /** Native dev:ino:InvocationID:ControlGroup verbatim. Old dev:ino history
   * remains readable, but is inert and never upgraded to native authority. */
  cgroupIdentity?: string; invocation?: string;
  /** Original pid:proc-device:proc-inode:start-time, never PID alone. */
  launcherIdentity?: string;
  payload?: "release-attempted" | "prevented-before-write";
  exitStatus: number | null; containmentComplete: boolean; timedOut: boolean; overflow: boolean;
  logDigest: string; logBytes: number;
  /** Inert metadata, possibly proposed before native settlement/registration.
   * An executing outcome never claims a published or usable passing receipt. */
  receipt?: { id: string; sha256: string; expiresAt: number };
}
export interface GitActionWorkingWorkspaceEvidence extends GitActionWorkingWorkspaceFlags {
  requiredSavedIndexes: number[];
  /** Individual actual v3 runs/receipts, never a paired/integration receipt adapter. */
  runs: GitActionCheckExecution[];
}
/** Native v2 clean-source evidence, never working-workspace v3 or paired v1.
 * Stage/scope compatibility is strictly checked on capture and history reads. */
export interface GitActionCleanCheckoutFlags {
  evidenceScope: "clean-checkout"; candidateTreeVerified: false; repositoryChecksWaived: false;
}
export interface GitActionCheckoutVerificationBinding {
  evidenceScope: "working-workspace" | "clean-checkout";
  candidateTreeVerified: false; repositoryChecksWaived: false;
  sourceOid: string; sourceTreeOid: string; snapshotDigest: string;
  policyDigest: string; policyRevision: string; stage: GitCheckStage; requiredSavedIndexes: number[];
}
export interface GitActionCheckoutVerificationSnapshot extends GitActionCheckoutVerificationBinding {
  source: GitActionCheckoutSnapshot;
  /** v2 scope REQUIRES each original digest-only manifest, copied exactly.
   * v3 commit scope rejects these v2 manifests; no history reconstructs proof. */
  checks: { checkIndex: number; recipe: GitCheckRecipe; recipeDigest: string; environmentDigest: string; executionCwd: string;
    snapshot?: GitSelectedCheckSnapshot }[];
}
export interface GitActionCleanupIgnoredEntry {
  path: string; kind: "file" | "directory"; device: string; inode: string; birthtime: string;
  size: string; mode: string; changed: string; modified: string;
}
export interface GitActionCleanupBinding {
  featureOid: string; targetOid: string; mainOid: string;
  sourcePath: string; branchRef: string; targetPath: string; mainPath: string;
}
export interface GitActionCleanupSnapshot extends GitActionCleanupBinding {
  source: GitActionCheckoutSnapshot; target: GitActionCheckoutSnapshot; main: GitActionCheckoutSnapshot;
  integration: { completedAt: number; delivery: "selected-local"; method: "ff" | "merge"; actualFF: boolean;
    featureOid: string; previousTargetOid: string; resultOid: string; resultTree: string; parents: string[] };
  provenance: { mode: "create"; originalSourcePath: string; originalSource: GitActionCheckoutSnapshot; branchRef: string };
  ignoredCount: number; ignoredDeletion: "none" | "exact-approval-required";
  /** Complete measured inventory in the artifact/live Ask, omitted from compact summary. */
  ignored?: GitActionCleanupIgnoredEntry[];
}
export type GitActionCleanupEffect =
  | { kind: "worktree-removed"; sourcePath: string; sourceIdentity: GitActionResourceAttribution["commonIdentity"];
      adminPath: string; featureOid: string; exit: 0; sourceAbsent: true; adminAbsent: true;
      beforeInventoryDigest: string; afterInventoryDigest: string }
  | { kind: "branch-deleted"; branchRef: string; deletedOid: string; transactionExit: 0; finalInventoryDigest: string };
export interface GitActionCleanupRecovery {
  phase: "capture" | "preflight" | "intent" | "remove" | "verify-removal" | "record-removal" | "usage-removal-transition" | "before-delete" | "delete-ref" | "verify-delete" | "completed-record";
  removeAttempted: boolean; branchDeleteAttempted: boolean; childTerminationConfirmed: boolean;
  sourceAbsent: boolean | null; adminAbsent: boolean | null; featureRefAbsent: boolean | null;
  removeExit: 0 | null; transactionExit: 0 | null;
  usageRemovalAcknowledged?: boolean; completedRecorded?: boolean; leaseReleaseUncertain?: boolean; checkoutGateRetained?: boolean;
}
export interface GitActionCleanupOutcome extends GitActionCleanupBinding {
  effects: GitActionCleanupEffect[];
  ignoredDataDeletionApproved?: true;
  observedFeatureOid?: string | null;
  nativeHeadReflogMayHaveChanged?: true;
  recovery?: GitActionCleanupRecovery;
}

/** Allowlisted display data only: no review tokens, plan IDs, jobs or approval capabilities.
 * Receipt IDs are inert captured evidence, never restored executable receipts. */
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
  workspace?: GitActionWorkspaceSnapshot;
  preparation?: GitActionPreparationSnapshot;
  checkoutVerification?: GitActionCheckoutVerificationSnapshot;
  cleanup?: GitActionCleanupSnapshot;
  workingWorkspaceVerification?: GitActionWorkingWorkspaceEvidence;
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
  /** New native results are kind-tagged; these facts are never execution authority. */
  kind?: "workspace" | "preparation" | "checkout-verification" | "cleanup";
  workspace?: { mode: "create" | "attach"; destinationPath: string; branch: string; tipOid: string; treeOid: string;
    parentCreated?: boolean; knownParentCreation?: GitActionKnownParentCreation; parentCreationAttempted?: boolean;
    phase?: "intent" | "before-add" | "create-parent" | "after-parent" | "add" | "verify" | "completed-record";
    addAttempted?: boolean; observedBranchOid?: string | null; destinationPresent?: boolean | null };
  preparation?: { oldSourceOid: string; newSourceOid: string; targetMainOid: string; resultTreeOid: string };
  /** Executing records may capture append-only measured unit facts before
   * settlement. Only verified native completion can attest terminal success. */
  checkoutVerification?: GitActionCheckoutVerificationBinding & { runs: GitActionCheckExecution[] };
  cleanup?: GitActionCleanupOutcome;
  workingWorkspaceVerification?: GitActionWorkingWorkspaceEvidence;
  commit?: string;
  tree?: string;
  parents?: string[];
  authorEmail?: string;
  targetBranch?: string;
  featureOid?: string;
  targetOid?: string;
  mergeOid?: string;
}
/** Stable strict completion union for trusted runtime/native-reader adapters.
 * Intent uses GitActionOutcome without claiming completion; legacy v1 remains unchanged. */
export type GitActionNativeOutcome =
  | { kind: "workspace"; status: "created" | "attached" | "partial-state"; workspace: NonNullable<GitActionOutcome["workspace"]> }
  | { kind: "preparation"; status: "prepared" | "already-prepared" | "partial-state"; preparation: NonNullable<GitActionOutcome["preparation"]> }
  | { kind: "checkout-verification"; status: "passed" | "failed" | "cancelled" | "partial-state"; checkoutVerification: NonNullable<GitActionOutcome["checkoutVerification"]> }
  | { kind: "cleanup"; status: "worktree-removed" | "cleaned-up" | "partial-state"; cleanup: GitActionCleanupOutcome };

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
