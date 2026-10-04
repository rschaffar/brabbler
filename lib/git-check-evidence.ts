// Dependency semantics for NEW live evidence only. Historical admission rows
// retain their original meanings; these intersections do not upgrade old JSON.
import type { GitPairedCheckSnapshot as LegacyPaired, GitSelectedCheckSnapshot as LegacySelected,
  GitWorkingWorkspaceCheckSnapshot as LegacyWorking } from "./git-operation-admission";
/** Fresh (not deployed legacy history) dep2 contract: clean v2 `status` and
 * paired v1 `featureStatus`/`targetStatus` also digest physical manifest2 content,
 * not merely porcelain/config/flags. Actual bytes, modes and readlink bytes of
 * tracked HEAD/index union + nonignored physical workspace are recaptured at
 * execution and fresh use. Ignored contents, external inputs and symlink target
 * bytes remain uncovered; bounded scanner/observed-race limitations apply.
 * No resulting candidate/merge tree is claimed verified. Working v3 retains its
 * existing explicit manifest fields and limitations unchanged. */
export interface GitCheckDependencies {
  readonly dependencyVersion: 2;
  readonly relevantRefs: readonly string[];
}
export type GitPairedCheckSnapshot = LegacyPaired & GitCheckDependencies;
export type GitSelectedCheckSnapshot = LegacySelected & GitCheckDependencies;
export type GitWorkingWorkspaceCheckSnapshot = LegacyWorking & GitCheckDependencies;
export type GitCheckSnapshot = GitPairedCheckSnapshot | GitSelectedCheckSnapshot | GitWorkingWorkspaceCheckSnapshot;
export type GitCheckRecoveryCurrentState = Omit<GitPairedCheckSnapshot, "reviewDigest">;
