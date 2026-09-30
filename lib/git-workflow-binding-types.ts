import type { GitWorkflowSettings } from "./git-workflow-settings";

/** Evidence/setup only. None of these types represents an execution grant or a writer lease. */
export interface GitBindingFileIdentity { dev: string; ino: string; birthtime: string }
export interface GitBindingOwner {
  sessionId: string;
  sessionFile: string;
  sessionIdentity: GitBindingFileIdentity;
  headerDigest: string;
  cwd: string;
}
export interface GitBindingWorkspace {
  root: string;
  projectRoot: string;
  branch: string;
  gitDir: string;
  commonDir: string;
  rootIdentity: GitBindingFileIdentity;
  gitIdentity: GitBindingFileIdentity;
  commonIdentity: GitBindingFileIdentity;
}
export interface GitRuleSource {
  path: string;
  realPath: string;
  role: "context" | "dependency";
  identity: GitBindingFileIdentity;
  digest: string;
  bytes: number;
  content: string;
}
export interface GitRuleSourceSet {
  version: 1;
  discovery: "pi-0.99.1-context-v1";
  coverage: "primary-and-explicit-dependencies";
  cwd: string;
  agentDir: string;
  directories: { path: string; realPath: string; identity: GitBindingFileIdentity }[];
  /** Missing higher-priority candidates matter too: adding one changes discovery. */
  absent: string[];
  shadowed: string[];
  /** Readable candidates needed to establish shadow selection, not loaded context. */
  selectionSources: GitRuleSource[];
  sources: GitRuleSource[];
  digest: string;
}
export interface GitTaskBindingSnapshot {
  version: 1;
  owner: GitBindingOwner;
  workspace: GitBindingWorkspace;
  request: { entryId: string; digest: string; goal: string };
  settings: GitWorkflowSettings;
  /** Pins the actual capture entry, not just replayable equal settings. */
  settingsEntryId: string;
  sources: GitRuleSourceSet;
}
export interface GitTaskBindingRecord {
  version: 1;
  id: string;
  generation: number;
  sessionId: string;
  state: "adopted" | "released" | "invalidated";
  processEpoch: string;
  reviewOrigin: "workflow-home";
  invalidatedBy: "session-move" | "settings-capture" | null;
  adoptedAt: string;
  updatedAt: string;
  snapshot: GitTaskBindingSnapshot;
}
export interface GitTaskBindingSummary {
  id: string;
  generation: number;
  state: GitTaskBindingRecord["state"];
  goal: string;
  requestEntryId: string;
  workspace: string;
  branch: string;
  adoptedAt: string;
  sources: { path: string; digest: string; role: GitRuleSource["role"] }[];
}
export interface GitTaskBindingStatus {
  status: "none" | "current" | "stale" | "released" | "unavailable" | "reconciliation-required";
  revision: string;
  reason: string;
  binding?: GitTaskBindingSummary;
}
export interface GitTaskBindingResponse {
  status: GitTaskBindingStatus;
  editable: boolean;
  reason?: string;
  requests: { entryId: string; label: string }[];
  workspaces: { branch: string; path: string }[];
}
export interface GitTaskBindingPreview {
  previewId: string;
  snapshot: GitTaskBindingSnapshot;
}
/** Explicit permission to read one exact symlink destination, not an allowed-root expansion. */
export interface GitRuleSourceTarget { path: string; realPath: string }
export const GIT_BINDING_LIMITS = { sources: 64, dependencies: 24, fileBytes: 256 * 1024, totalBytes: 1024 * 1024, goal: 2000 } as const;
export const GIT_BINDING_COVERAGE_NOTICE = "Reviews primary instruction files and the dependencies you explicitly name. It does not prove all prose rules or references are covered, normalize repository policy, reload agent instructions, grant permission or reserve a checkout. Adoption does not retarget existing Git tools or action views. Automatic execution remains unavailable.";
