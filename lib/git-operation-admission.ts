import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { GIT_ACTION_ID_PATTERN } from "./git-action-types";

/** Historical snapshot DTOs ONLY. Their original versions and field meanings
 * remain available to history readers and git-check-evidence's explicit scoped
 * types. No decoder, receipt issuer, recovery/clear operation or ledger gate
 * lives here. Old private files are never read, migrated, rewritten or pruned. */
export type GitPairedCheckSnapshot = { version: 1; featurePath: string; targetPath: string;
  featureIdentity: string; targetIdentity: string; resourceIdentity: string;
  featureBranch: string; targetBranch: string; featureOid: string; targetOid: string;
  reviewDigest: string; policyDigest: string; checkDigest: string;
  featureIndex: string; targetIndex: string; featureStatus: string; targetStatus: string; refs: string };
export type GitSelectedCheckSnapshot = { version: 2; checkoutPath: string; checkoutIdentity: string;
  resourceIdentity: string; branch: string; head: string; tree: string; index: string; status: string; refs: string;
  policyDigest: string; policyRevision: string; recipeDigest: string; checkDigest: string;
  cwdIdentity: string; environmentDigest: string; stageDigest: string };
export type GitWorkingWorkspaceCheckSnapshot = Omit<GitSelectedCheckSnapshot, "version"> & {
  version: 3; evidenceScope: "working-workspace"; candidateTreeVerified: false; repositoryChecksWaived: false;
  workspaceManifestVersion: 2; workspaceContentDigest: string; workspaceIndexDigest: string;
  workspaceCoverage: "tracked-index-head-union-and-nonignored-physical-workspace";
  ignoredCachesCovered: false; externalInputsCovered: false;
  workspaceSummary: Readonly<{ paths: number; tracked: number; untracked: number; regularFiles: number; symlinks: number;
    absent: number; directories: number; totalBytes: number; indexBytes: number }>;
};

/** Non-authorizing, nonexclusive native commit lifecycle identity. Permission
 * comes from the separate original git-invocation handle, not an action ID or
 * this descriptive owner. Native completion comes only from the native leaf. */
export interface GitOperationInvocation {
  readonly actionId: string;
  readonly id: string;
  assertOwned(): void;
  retire(): void;
}
export type GitOperationInvocationOwner = Readonly<{
  id: string;
  actionId: string;
  kind: "commit";
  /** Diagnostic context/binding only; its existence or contents never gate work. */
  agentDir: string;
  selection: Readonly<GitProjectResources>;
}>;
const mutationOwners = new WeakMap<object, { owner: GitOperationInvocationOwner; active: boolean }>();
function freezeOwner<T>(value: T): T {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freezeOwner(item); Object.freeze(value); }
  return value;
}
function assertPhysicalMutationOwner(owner: GitOperationInvocationOwner): void {
  const r = owner.selection;
  for (const [dir, expected] of [[r.projectRoot, r.identities.project], [r.cwd, r.identities.checkout],
    [r.commonDir, r.identities.common], [r.gitDir, r.identities.git]] as const) {
    const s = fs.lstatSync(dir, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || fs.realpathSync(dir) !== dir ||
      s.dev.toString() !== expected.device || s.ino.toString() !== expected.inode || s.birthtimeNs.toString() !== expected.birthtime)
      throw new Error("Git invocation physical resource changed");
  }
  const marker = fs.lstatSync(path.join(r.cwd, ".git"), { bigint: true }), expected = r.identities.marker;
  if (marker.isSymbolicLink() || (!marker.isDirectory() && !marker.isFile()) ||
    marker.dev.toString() !== expected.device || marker.ino.toString() !== expected.inode || marker.birthtimeNs.toString() !== expected.birthtime ||
    marker.isFile() && (marker.ctimeNs.toString() !== expected.changed || marker.size.toString() !== expected.size))
    throw new Error("Git invocation physical marker changed");
}
/** Authenticate the ORIGINAL active object and its physical bindings. Never
 * consult another invocation, action history, a disk slot or session inventory.
 * Physical failure retires this owner; restoring paths cannot resurrect it. */
export function readGitOperationInvocationOwner(handle: unknown): GitOperationInvocationOwner | undefined {
  if (!handle || typeof handle !== "object") return;
  const saved = mutationOwners.get(handle);
  if (!saved?.active) return;
  try { assertPhysicalMutationOwner(saved.owner); return saved.owner; }
  catch { saved.active = false; return; }
}

/** Retained internal name for the connected commit consumer. This establishes
 * lifecycle identity ONLY, never permission, a journal or a success proof.
 * Other native operations own their independent invocation protocols. */
export async function beginSupervisedGitOperationIntent(selection: GitProjectResources, actionId: string,
  kind: "commit", agentDir = getAgentDir()): Promise<GitOperationInvocation> {
  if (kind !== "commit") throw new Error("Only commit lifecycle ownership is supported here");
  if (typeof actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(actionId)) throw new Error("Invalid Git action identity");
  // Pin the caller's original descriptive selection before any await. Neither
  // later mutation of that object nor a matching JSON copy authenticates owner.
  const owner: GitOperationInvocationOwner = freezeOwner({ id: randomUUID(), actionId, kind, agentDir,
    selection: structuredClone(selection) });
  await revalidateGitProjectResources(owner.selection);
  assertPhysicalMutationOwner(owner);
  const state = { owner, active: true };
  const operation: GitOperationInvocation = Object.freeze({ id: owner.id, actionId,
    assertOwned(this: GitOperationInvocation) {
      if (this !== operation || !readGitOperationInvocationOwner(this)) throw new Error("Git invocation owner is not active");
    },
    retire(this: GitOperationInvocation) {
      if (this !== operation || mutationOwners.get(this) !== state) throw new Error("Unknown Git invocation owner");
      state.active = false;
    },
  });
  mutationOwners.set(operation, state);
  return operation;
}

/** Physical selection revalidation, NOT historical admission or authorization.
 * Native invocation/approval/evidence guards remain mandatory at effects. */
export async function revalidateGitCommitAdmission(selection: GitProjectResources): Promise<void> {
  await revalidateGitProjectResources(selection);
}
