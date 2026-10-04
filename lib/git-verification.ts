import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import { gitExecEnv } from "./git-exec";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import { reviewGitBranches, type GitReview } from "./git-review";
import { validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { hasExtendedGitCheckRecipe } from "./git-check-recipe";
import { newGitCheckUnit, linuxSystemdBackend, type ContainmentBackend } from "./git-check-containment";
import { revalidateGitProjectResources, selectGitProjectResources, type GitProjectResources } from "./git-project-resources";
import type { GitPairedCheckSnapshot, GitCheckRecoveryCurrentState } from "./git-check-evidence";
import { GIT_ACTION_ID_PATTERN } from "./git-action-types";
import { samePath } from "./paths";
import { captureGitWorkingWorkspaceContentManifest } from "./git-working-workspace-snapshot";
import { registerGitCheckReceiptEpoch, gitCheckReceiptEpochStatus, gitCheckSyncValue, readGitCheckAuthorityStamp,
  assertGitCheckSelectionSync, gitCheckSourceReadSync, gitCheckIndexBytesSync, superviseGitCheck,
  createGitCheckCohort, beginGitCheckAttempt, retireGitCheckCohort, type GitCheckCohort, type GitCheckDiagnostics } from "./git-check-runner";

const TIMEOUT_MS = 5 * 60_000;
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const receipts = new Map<string, VerificationReceipt>();
const running = new Map<string, number>(); // information only, never proof of stopped children
const authorities = new WeakMap<VerificationReceipt, () => void>();
const receiptSources = new WeakMap<VerificationReceipt, () => void>();
function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
class VerificationError extends Error {
  constructor(reason: string) { super(`Git verification unavailable: ${reason}`); }
}
function unavailable(reason: string): never { throw new VerificationError(reason); }

/** One exact live paired recipe. Not integration approval or a historical pass. */
export interface VerificationReceipt {
  readonly dependencyVersion: 2; readonly relevantRefs: readonly string[];
  readonly id: string; readonly sessionId: string; readonly cwd: string; readonly commonDir: string;
  readonly featureBranch: string; readonly featureOid: string; readonly featureTreeOid: string;
  readonly targetCwd: string; readonly targetBranch: string; readonly targetOid: string; readonly targetTreeOid: string;
  readonly mergeTreeOid: string; readonly policyDigest: string; readonly checkIndex: number; readonly argv: readonly string[];
  readonly startedAt: number; readonly finishedAt: number; readonly exitStatus: 0; readonly logDigest: string;
  readonly diagnostics?: GitCheckDiagnostics;
  readonly outputDiagnosticId?: string;
}
export function isGitVerificationRunning(cwd: string): boolean { return (running.get(cwd) ?? 0) > 0; }
export function lookupGitVerificationReceipt(id: string): VerificationReceipt | undefined {
  const receipt = receipts.get(id);
  if (!receipt) return;
  try {
    const authority = authorities.get(receipt);
    if (!authority || gitCheckReceiptEpochStatus(id) !== "current" || Date.now() < receipt.finishedAt ||
      Date.now() - receipt.finishedAt >= 15 * 60_000) throw new Error("retired receipt");
    authority();
    return receipt;
  } catch { receipts.delete(id); return; }
}
/** Fresh pretransaction source validation, separate from informational lookup.
 * Native apply must then protect THAT captured state with its own real index/ref
 * transaction. This public boundary never ignores an unowned index.lock. */
export function assertGitVerificationReceiptSourceCurrentSync(id: string): void {
  const receipt = lookupGitVerificationReceipt(id), assertSource = receipt && receiptSources.get(receipt);
  if (!receipt || !assertSource) unavailable("original current paired receipt required");
  assertSource();
}
export function inspectGitVerificationReceipts(sessionId: string): readonly VerificationReceipt[] {
  return [...receipts.values()].filter((r) => r.sessionId === sessionId && !!lookupGitVerificationReceipt(r.id));
}
export interface GitVerificationOptions {
  sessionId: string; cwd: string; agentDir: string; review: GitReview; checkIndex: number;
  getPolicy: () => GitWorkflowPolicy | null | undefined | Promise<GitWorkflowPolicy | null | undefined>;
  isTrusted: (cwd: string) => boolean | Promise<boolean>;
  readAuthorityRevisionSync?: () => string;
  cohort?: GitCheckCohort;
  timeoutMs?: number; signal?: AbortSignal; actionId?: string;
  testContainmentBackend?: ContainmentBackend; testRecoveryEvidence?: boolean;
  testBeforeReceiptRegistration?: () => Promise<void>;
}
export function gitCheckRecoveryDigest(checkIndex: number, argv: readonly string[]): string {
  return digest(JSON.stringify({ index: checkIndex, argv }));
}
function policyHash(policy: GitWorkflowPolicy): string { return digest(JSON.stringify(policy)); }
function commandEnvironmentDigest(): string {
  return digest(JSON.stringify(Object.entries(sanitizeProjectCommandEnvironment(gitExecEnv()))
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
}
function policyValue(input: GitWorkflowPolicy | null | undefined, checkIndex: number): GitWorkflowPolicy {
  if (input === null || input === undefined) unavailable("no saved policy");
  const policy = validateGitWorkflowPolicy(input), check = policy.checks?.[checkIndex];
  if (check && hasExtendedGitCheckRecipe(check)) unavailable("extended check recipe execution unsupported");
  return policy;
}
async function savedPolicy(options: GitVerificationOptions): Promise<GitWorkflowPolicy> {
  return policyValue(await options.getPolicy(), options.checkIndex);
}
function exact(a: GitReview, b: GitReview): boolean {
  return a.featureBranch === b.featureBranch && a.targetBranch === b.targetBranch &&
    a.featureOid === b.featureOid && a.featureTreeOid === b.featureTreeOid &&
    a.targetOid === b.targetOid && a.targetTreeOid === b.targetTreeOid && a.mergeTreeOid === b.mergeTreeOid;
}
function registered(selection: GitProjectResources, feature: string, target: string): string {
  const records = gitCheckSourceReadSync(selection, ["worktree", "list", "--porcelain", "-z"]).split("\0");
  let location = "", targetPath = "", featureFound = false;
  for (const record of records) {
    if (record.startsWith("worktree ")) location = record.slice(9);
    if (record === `branch refs/heads/${feature}` && samePath(location, selection.cwd)) featureFound = true;
    if (record === `branch refs/heads/${target}`) {
      if (targetPath) unavailable("ambiguous target checkout");
      targetPath = location;
    }
  }
  if (!featureFound || !targetPath || samePath(selection.cwd, targetPath)) unavailable("distinct registered worktrees required");
  return targetPath;
}
const markers = ["index.lock", "HEAD.lock", "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START"];
function captureStateSync(f: GitProjectResources, t: GitProjectResources, policyDigest: string,
  checkDigest: string, requireClean: boolean): GitCheckRecoveryCurrentState {
  if (f.commonDir !== t.commonDir) unavailable("worktree resource changed");
  const state = (selection: GitProjectResources) => {
    assertGitCheckSelectionSync(selection);
    const read = (args: string[]) => gitCheckSourceReadSync(selection, args);
    for (const marker of markers) {
      try { lstatSync(path.join(selection.gitDir, marker)); unavailable("checkout operation marker"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const config = read(["config", "--list", "--null"]);
    if (config.split("\0").some((row) => /^(?:filter\.|remote\..*\.promisor\n|(?:core\.(?:sparsecheckout|splitindex)|index\.sparse)\n(?:true|1|yes|on))/i.test(row))) unavailable("unsupported Git configuration");
    const index = path.join(selection.gitDir, "index"), bytes = gitCheckIndexBytesSync(index);
    const status = read(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), flags = read(["ls-files", "-v", "-z"]);
    if (requireClean && (status !== "" || flags.split("\0").some((entry) => entry && !entry.startsWith("H ")))) unavailable("source changed");
    const branch = read(["symbolic-ref", "--quiet", "HEAD"]).trim(), head = read(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
    const physical = captureGitWorkingWorkspaceContentManifest(selection);
    if (physical.indexDigest !== digest(bytes)) unavailable("index changed during physical capture");
    assertGitCheckSelectionSync(selection);
    return { index: digest(index + "\0" + digest(bytes)),
      status: digest(JSON.stringify({ status, flags, config, workspaceManifestVersion: physical.version, workspaceContentDigest: physical.digest })),
      branch: digest(branch), head: digest(head) };
  };
  const feature = state(f), target = state(t), relevantRefs = Object.freeze([`refs/heads/${f.branch}`, `refs/heads/${t.branch}`]);
  const refs = relevantRefs.map((ref) => gitCheckSourceReadSync(f, ["rev-parse", "--verify", `${ref}^{commit}`]));
  assertGitCheckSelectionSync(f); assertGitCheckSelectionSync(t);
  return { version: 1, dependencyVersion: 2, relevantRefs, featurePath: digest(f.cwd), targetPath: digest(t.cwd),
    featureIdentity: digest(JSON.stringify(f.identities)), targetIdentity: digest(JSON.stringify(t.identities)),
    resourceIdentity: digest(f.commonDir + "\0" + JSON.stringify(f.identities.common)),
    featureBranch: feature.branch, targetBranch: target.branch, featureOid: feature.head, targetOid: target.head,
    policyDigest, checkDigest, featureIndex: feature.index, targetIndex: target.index,
    featureStatus: feature.status, targetStatus: target.status, refs: digest(JSON.stringify(refs)) };
}
/** Diagnostic capture only; JSON never reconstructs live cohort authority. */
export async function captureGitCheckRecoveryCurrentState(feature: string, target: string,
  policyDigest: string, checkDigest: string): Promise<GitCheckRecoveryCurrentState> {
  return captureStateSync(await selectGitProjectResources(feature), await selectGitProjectResources(target), policyDigest, checkDigest, false);
}
export async function captureGitCheckRecoverySnapshot(feature: string, target: string, review: GitReview,
  policyDigest: string, checkDigest: string): Promise<GitPairedCheckSnapshot> {
  return { ...await captureGitCheckRecoveryCurrentState(feature, target, policyDigest, checkDigest), reviewDigest: digest(JSON.stringify(review)) };
}

export async function runGitVerification(options: GitVerificationOptions): Promise<VerificationReceipt> {
  let cohort: GitCheckCohort | undefined, cwd: string | undefined, completed = false, counted = false;
  try {
    if (!options || typeof options.sessionId !== "string" || !options.sessionId || options.sessionId.length > 512 ||
      typeof options.isTrusted !== "function" || typeof options.getPolicy !== "function" ||
      !Number.isInteger(options.checkIndex) || options.checkIndex < 0 || !path.isAbsolute(options.agentDir) ||
      options.actionId !== undefined && !GIT_ACTION_ID_PATTERN.test(options.actionId)) unavailable("invalid request");
    options = { ...options, review: { ...options.review } };
    const original = options.cohort ?? createGitCheckCohort([options.checkIndex]);
    const attempt = beginGitCheckAttempt(original, options.checkIndex);
    cohort = original;
    const authorityStamp = options.readAuthorityRevisionSync ? readGitCheckAuthorityStamp(options.readAuthorityRevisionSync) : undefined;
    const selection = await selectGitProjectResources(options.cwd);
    cwd = selection.cwd;
    if (!samePath(cwd, options.cwd)) unavailable("physical checkout required");
    running.set(cwd, (running.get(cwd) ?? 0) + 1); counted = true;
    const policy = await savedPolicy(options), check = policy.checks?.[options.checkIndex], review = options.review;
    if (!check || !await options.isTrusted(cwd)) unavailable("saved check and trust required");
    if (!review || !oid.test(review.featureOid) || !oid.test(review.targetOid) || !oid.test(review.featureTreeOid) ||
      !oid.test(review.targetTreeOid) || !oid.test(review.mergeTreeOid) || policy.integration?.targetBranch !== review.targetBranch ||
      (policy.mode === "current" && policy.branch !== undefined && policy.branch !== review.featureBranch) ||
      review.featureBranch === review.targetBranch) unavailable("invalid review or policy target");
    const targetCwd = registered(selection, review.featureBranch, review.targetBranch);
    const targetSelection = await selectGitProjectResources(targetCwd);
    if (!exact(review, await reviewGitBranches(cwd, review.featureBranch, review.targetBranch))) unavailable("stale review");
    const policyDigest = policyHash(policy), environmentDigest = commandEnvironmentDigest();
    const checkDigest = gitCheckRecoveryDigest(options.checkIndex, check.argv);
    const capture = (clean: boolean): GitPairedCheckSnapshot => ({ ...captureStateSync(selection, targetSelection, policyDigest, checkDigest, clean),
      reviewDigest: digest(JSON.stringify(review)) });
    const pre = capture(true);
    if (pre.featureOid !== digest(review.featureOid) || pre.targetOid !== digest(review.targetOid) ||
      pre.featureBranch !== digest(`refs/heads/${review.featureBranch}`) || pre.targetBranch !== digest(`refs/heads/${review.targetBranch}`)) unavailable("stale review");
    const assertAuthority = () => {
      if (options.readAuthorityRevisionSync) {
        if (readGitCheckAuthorityStamp(options.readAuthorityRevisionSync) !== authorityStamp) unavailable("authority changed");
      } else if (gitCheckSyncValue(options.isTrusted(selection.cwd)) !== true ||
        policyHash(policyValue(gitCheckSyncValue(options.getPolicy()), options.checkIndex)) !== policyDigest) unavailable("authority changed");
      if (options.signal?.aborted || commandEnvironmentDigest() !== environmentDigest) unavailable("environment or cancellation changed");
    };
    const assertCurrentSync = () => {
      if (JSON.stringify(capture(true)) !== JSON.stringify(pre) || registered(selection, review.featureBranch, review.targetBranch) !== targetCwd)
        unavailable("source changed");
      assertAuthority();
    };
    const revalidate = async () => {
      await revalidateGitProjectResources(selection); await revalidateGitProjectResources(targetSelection);
      if (!await options.isTrusted(selection.cwd) || policyHash(await savedPolicy(options)) !== policyDigest) unavailable("authority changed");
      assertCurrentSync();
      return capture(true);
    };
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS ||
      (options.testContainmentBackend || options.testRecoveryEvidence || options.testBeforeReceiptRegistration) && !process.env.NODE_TEST_CONTEXT ||
      options.testRecoveryEvidence && !options.testContainmentBackend) unavailable("invalid execution options");
    const backend = options.testContainmentBackend ?? linuxSystemdBackend, unit = newGitCheckUnit();
    if (process.platform !== "linux" || !await backend.absent(unit, 2_000)) unavailable("verified containment unavailable");
    const result = await superviseGitCheck({ selection, agentDir: options.agentDir, actionId: options.actionId ?? randomUUID(), unit,
      attempt, cohortBinding: digest(JSON.stringify({ selection, targetSelection, review, policyDigest, environmentDigest, authorityStamp, sessionId: options.sessionId })),
      before: pre, cwd, argv: check.argv, env: sanitizeProjectCommandEnvironment(gitExecEnv()), timeoutMs, signal: options.signal,
      backend, revalidate, assertCurrentSync, captureAfter: async () => capture(false) });
    await options.testBeforeReceiptRegistration?.();
    assertCurrentSync();
    const { settlement, ...facts } = result;
    const receipt: VerificationReceipt = Object.freeze({ dependencyVersion: 2, relevantRefs: pre.relevantRefs, ...facts,
      sessionId: options.sessionId, cwd, commonDir: selection.commonDir, featureBranch: review.featureBranch,
      featureOid: review.featureOid, featureTreeOid: review.featureTreeOid, targetCwd, targetBranch: review.targetBranch,
      targetOid: review.targetOid, targetTreeOid: review.targetTreeOid, mergeTreeOid: review.mergeTreeOid,
      policyDigest, checkIndex: options.checkIndex, argv: Object.freeze([...check.argv]), exitStatus: 0 });
    registerGitCheckReceiptEpoch(receipt.id, options.agentDir, selection.commonDir, { cohort, settlement, snapshot: pre });
    authorities.set(receipt, assertAuthority);
    receiptSources.set(receipt, assertCurrentSync);
    receipts.set(receipt.id, receipt);
    completed = true;
    return receipt;
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError("check failed or source/authority/containment changed; inspect manually");
  } finally {
    if (cohort && !completed) retireGitCheckCohort(cohort);
    if (cwd && counted) { const count = (running.get(cwd) ?? 1) - 1; if (count) running.set(cwd, count); else running.delete(cwd); }
  }
}
