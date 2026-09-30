import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { reviewGitBranches, type GitReview } from "./git-review";
import { validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { newGitCheckUnit, runContainedGitCheck, linuxSystemdBackend,
  type ContainmentBackend, type ContainedCheckResult } from "./git-check-containment";
import { revalidateGitProjectResources, selectGitProjectResources } from "./git-project-resources";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent, assertGitCheckRecoverySnapshotCapacity,
  type GitCheckSnapshot, type GitCheckCleanupProof } from "./git-operation-admission";
import { GIT_ACTION_ID_PATTERN } from "./git-action-types";
import { samePath, toNativePath } from "./paths";

const exec = promisify(execFile);
// A full `npm test` run can produce several hundred KiB of TAP output. Bound
// memory and private logs without rejecting ordinary project test suites.
const TIMEOUT_MS = 5 * 60_000;
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const storeKey = Symbol.for("pi-web:git-verification:successful-receipts");
type Store = { receipts: Map<string, VerificationReceipt>; running: Set<string> };
function store(): Store {
  const global = globalThis as unknown as Record<symbol, Store | undefined>;
  return (global[storeKey] ??= { receipts: new Map(), running: new Set() });
}
function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
class VerificationError extends Error {
  constructor(reason: string) { super(`Git verification unavailable: ${reason}`); }
}
function unavailable(reason: string): never { throw new VerificationError(reason); }

/** A receipt describes ONE saved check, not approval or proof that all checks ran. Never persist it to disk. */
export interface VerificationReceipt {
  readonly id: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly featureBranch: string;
  readonly featureOid: string;
  readonly featureTreeOid: string;
  readonly targetCwd: string;
  readonly targetBranch: string;
  readonly targetOid: string;
  readonly targetTreeOid: string;
  readonly mergeTreeOid: string;
  readonly policyDigest: string;
  readonly checkIndex: number;
  readonly argv: readonly string[];
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly exitStatus: 0;
  readonly logDigest: string;
}

/** Lookup only process-local successful receipts. Caller must still validate current policy/refs/checkout at use time. */
// Advisory same-process liveness only; false is never proof that children stopped.
export function isGitVerificationRunning(cwd: string): boolean {
  return store().running.has(cwd);
}
export function lookupGitVerificationReceipt(id: string): VerificationReceipt | undefined {
  return store().receipts.get(id);
}
export function inspectGitVerificationReceipts(sessionId: string): readonly VerificationReceipt[] {
  return [...store().receipts.values()].filter((receipt) => receipt.sessionId === sessionId);
}
/** A human recovery cannot revive an older success after releasing a later failed
 * check. Drop all receipts for the affected physical checkout before disposition;
 * new verification must create new receipts under the reopened resource gate. */
export function invalidateGitVerificationReceiptsForCheckout(cwd: string): void {
  for (const [id, receipt] of store().receipts) if (samePath(receipt.cwd, cwd)) store().receipts.delete(id);
}

export interface GitVerificationOptions {
  sessionId: string;
  /** Explicit physical feature checkout root, never an arbitrary repo subdirectory. */
  cwd: string;
  agentDir: string;
  /** Captured exact local review; not recomputed as an implicit approval. */
  review: GitReview;
  checkIndex: number;
  /** Re-read the saved session policy before and after execution. */
  getPolicy: () => GitWorkflowPolicy | null | undefined | Promise<GitWorkflowPolicy | null | undefined>;
  /** Application-owned authorization/trust decision. Must not default to true. */
  isTrusted: (cwd: string) => boolean | Promise<boolean>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** The already-journalled check action; one such action may run ordered checks. */
  actionId?: string;
  /** Only direct node:test fixtures may replace the OS backend. Never supplied by HTTP/model tools. */
  testContainmentBackend?: ContainmentBackend;
  /** Explicit node:test-only simulation of recovery recording; never production proof. */
  testRecoveryEvidence?: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "-c", "core.fsmonitor=false", ...args], {
    env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1", GIT_PAGER: "cat" },
    encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

interface Checkout { cwd: string; branch: string; head: string; indexPath: string; indexDigest: string; }
async function checkout(cwd: string, branch: string, head: string): Promise<Checkout> {
  if (!path.isAbsolute(cwd) || !samePath(cwd, await fs.realpath(cwd))) unavailable("physical checkout root required");
  const root = toNativePath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
  if (!samePath(root, cwd)) unavailable("checkout root required");
  const ref = (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim();
  if (ref !== `refs/heads/${branch}` || (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim() !== head) unavailable("checkout changed");
  const indexPath = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
  if (await fs.stat(`${indexPath}.lock`).then(() => true, () => false)) unavailable("index locked");
  const indexDigest = digest(await fs.readFile(indexPath));
  if ((await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) !== "") unavailable("dirty checkout (check commands can modify files; inspect manually)");
  if ((await git(cwd, ["ls-files", "-v", "-z"])).split("\0").some((entry) => entry && !entry.startsWith("H "))) unavailable("nonstandard index flags");
  return { cwd, branch, head, indexPath, indexDigest };
}

async function registered(cwd: string, feature: string, target: string): Promise<string> {
  const records = (await git(cwd, ["worktree", "list", "--porcelain", "-z"])).split("\0");
  let location = "";
  let targetPath = "";
  let featureFound = false;
  for (const record of records) {
    if (record.startsWith("worktree ")) location = toNativePath(record.slice(9));
    if (record === `branch refs/heads/${feature}` && samePath(location, cwd)) featureFound = true;
    if (record === `branch refs/heads/${target}`) {
      if (targetPath) unavailable("ambiguous target checkout");
      targetPath = location;
    }
  }
  if (!featureFound || !targetPath || samePath(cwd, targetPath)) unavailable("feature and target must be distinct registered worktrees");
  return targetPath;
}

function exact(a: GitReview, b: GitReview): boolean {
  return a.featureBranch === b.featureBranch && a.targetBranch === b.targetBranch &&
    a.featureOid === b.featureOid && a.featureTreeOid === b.featureTreeOid &&
    a.targetOid === b.targetOid && a.targetTreeOid === b.targetTreeOid && a.mergeTreeOid === b.mergeTreeOid;
}
export function gitCheckRecoveryDigest(checkIndex: number, argv: readonly string[]): string {
  return digest(JSON.stringify({ index: checkIndex, argv }));
}
function policyHash(policy: GitWorkflowPolicy): string { return digest(JSON.stringify(policy)); }
async function savedPolicy(options: GitVerificationOptions): Promise<GitWorkflowPolicy> {
  const input = await options.getPolicy();
  if (input === null || input === undefined) unavailable("no saved policy");
  return validateGitWorkflowPolicy(input);
}
async function privateLog(agentDir: string, id: string, output: Buffer): Promise<void> {
  if (!path.isAbsolute(agentDir)) unavailable("absolute agent directory required");
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  if (!samePath(agentDir, await fs.realpath(agentDir))) unavailable("physical agent directory required");
  const parent = path.join(agentDir, "pi-web");
  await fs.mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (!(await fs.lstat(parent)).isDirectory() || !samePath(parent, await fs.realpath(parent))) unavailable("physical log parent required");
  const logs = path.join(parent, "git-verification-logs");
  await fs.mkdir(logs, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await fs.lstat(logs);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) unavailable("private log directory required");
  await fs.writeFile(path.join(logs, `${id}.log`), output, { flag: "wx", mode: 0o600 });
}

// Capture raw status even when dirty: a human needs the changed state, not an
// optimistic clean-only receipt. Ref output and arbitrary checkout data are
// hashed before entering the bounded, private ledger.
export async function captureGitCheckRecoverySnapshot(feature: string, target: string, review: GitReview,
  policyDigest: string, checkDigest: string): Promise<GitCheckSnapshot> {
  const f = await selectGitProjectResources(feature);
  const t = await selectGitProjectResources(target);
  if (f.commonDir !== t.commonDir) unavailable("worktree resource changed");
  const state = async (cwd: string) => {
    const index = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
    if (await fs.stat(`${index}.lock`).then(() => true, () => false)) unavailable("index locked");
    const [bytes, status, flags, branch, head] = await Promise.all([
      fs.readFile(index), git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      git(cwd, ["ls-files", "-v", "-z"]), git(cwd, ["symbolic-ref", "--quiet", "HEAD"]),
      git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]),
    ]);
    return { index: digest(index + "\0" + digest(bytes)), status: digest(status + "\0" + flags),
      branch: digest(branch.trim()), head: digest(head.trim()) };
  };
  const [featureState, targetState, refs] = await Promise.all([
    state(feature), state(target), git(feature, ["show-ref", "--head"]),
  ]);
  return { version: 1, featurePath: digest(feature), targetPath: digest(target),
    featureIdentity: digest(JSON.stringify(f.identities)), targetIdentity: digest(JSON.stringify(t.identities)),
    resourceIdentity: digest(f.commonDir + "\0" + JSON.stringify(f.identities.common)),
    featureBranch: featureState.branch, targetBranch: targetState.branch,
    featureOid: featureState.head, targetOid: targetState.head,
    reviewDigest: digest(JSON.stringify(review)), policyDigest, checkDigest,
    featureIndex: featureState.index, targetIndex: targetState.index,
    featureStatus: featureState.status, targetStatus: targetState.status, refs: digest(refs) };
}

async function runCheck(cwd: string, argv: readonly string[], timeout: number, unit: string,
  backend: ContainmentBackend, signal?: AbortSignal): Promise<ContainedCheckResult> {
  return runContainedGitCheck({ cwd, argv, timeoutMs: timeout, unit, signal, env: gitExecEnv() }, backend);
}

/** Runs precisely one explicitly selected saved argv. A passing exit is not an integration approval. */
export async function runGitVerification(options: GitVerificationOptions): Promise<VerificationReceipt> {
  try { return await runVerification(options); }
  catch (error) {
    if (error instanceof VerificationError) throw error;
    // Git, OS and callback errors can contain stderr, paths, argv, or credentials.
    throw new VerificationError("could not verify checkout or save private log; inspect manually");
  }
}

async function runVerification(options: GitVerificationOptions): Promise<VerificationReceipt> {
  if (!options || typeof options.sessionId !== "string" || !options.sessionId || options.sessionId.length > 512 ||
      typeof options.isTrusted !== "function" || typeof options.getPolicy !== "function" ||
      !Number.isInteger(options.checkIndex) || typeof options.agentDir !== "string") unavailable("invalid request");
  const cwd = await fs.realpath(options.cwd);
  if (!samePath(cwd, options.cwd)) unavailable("physical checkout required");
  const running = store().running;
  if (running.has(cwd)) unavailable("verification already running for this checkout");
  running.add(cwd);
  try {
    if (!await options.isTrusted(cwd)) unavailable("project not trusted");
    const policy = await savedPolicy(options);
    const check = policy.checks?.[options.checkIndex];
    if (!check) unavailable("saved check index required");
    const policyDigest = policyHash(policy);
    const review = options.review;
    if (!review || !oid.test(review.featureOid) || !oid.test(review.targetOid) || !oid.test(review.featureTreeOid) ||
        !oid.test(review.targetTreeOid) || !oid.test(review.mergeTreeOid) ||
        policy.integration?.targetBranch !== review.targetBranch ||
        (policy.mode === "current" && policy.branch !== undefined && policy.branch !== review.featureBranch) ||
        review.featureBranch === review.targetBranch) unavailable("invalid review or policy target");
    const targetCwd = await registered(cwd, review.featureBranch, review.targetBranch);
    const before = await reviewGitBranches(cwd, review.featureBranch, review.targetBranch);
    if (!exact(review, before)) unavailable("stale review");
    const feature = await checkout(cwd, review.featureBranch, review.featureOid);
    const target = await checkout(targetCwd, review.targetBranch, review.targetOid);
    if (!await options.isTrusted(cwd) || policyHash(await savedPolicy(options)) !== policyDigest) unavailable("trust or policy changed");
    const startedAt = Date.now();
    const timeout = options.timeoutMs === undefined ? TIMEOUT_MS : options.timeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > TIMEOUT_MS) unavailable("invalid timeout");
    if (options.signal?.aborted) unavailable("check cancelled");
    if (options.actionId !== undefined && !GIT_ACTION_ID_PATTERN.test(options.actionId)) unavailable("invalid check action");
    if ((options.testContainmentBackend || options.testRecoveryEvidence) && !process.env.NODE_TEST_CONTEXT)
      unavailable("test containment backend unavailable");
    if (options.testRecoveryEvidence && !options.testContainmentBackend) unavailable("test recovery backend required");
    const backend = options.testContainmentBackend ?? linuxSystemdBackend;
    const unit = newGitCheckUnit();
    // This read-only probe runs before publishing an intent. Unsupported OS or
    // missing user-manager/cgroup support must not strand an avoidable orphan.
    if (process.platform !== "linux" || !await backend.absent(unit, 2_000)) unavailable("verified check containment unavailable");
    await fs.mkdir(options.agentDir, { recursive: true, mode: 0o700 });
    const agentDirStat = await fs.lstat(options.agentDir);
    if (!agentDirStat.isDirectory() || agentDirStat.isSymbolicLink() ||
        !samePath(options.agentDir, await fs.realpath(options.agentDir)) || (agentDirStat.mode & 0o077) !== 0) {
      unavailable("private agent directory required");
    }
    const selection = await selectGitProjectResources(cwd);
    await assertGitOperationAdmission(selection, options.agentDir, options.actionId);
    // Validate and bound the entire baseline before publishing the intent.
    // Repeat it under the reservation so no stale baseline can be launched.
    const checkDigest = gitCheckRecoveryDigest(options.checkIndex, check.argv);
    const pre = await captureGitCheckRecoverySnapshot(cwd, targetCwd, review, policyDigest, checkDigest);
    const actionId = options.actionId ?? randomUUID();
    assertGitCheckRecoverySnapshotCapacity(selection.commonDir, actionId, unit, pre);
    await revalidateGitProjectResources(selection);
    if (options.signal?.aborted) unavailable("check cancelled");
    const reservation = await beginSupervisedGitOperationIntent(selection, actionId,
      "checks", options.agentDir, unit);
    if (JSON.stringify(pre) !== JSON.stringify(await captureGitCheckRecoverySnapshot(cwd, targetCwd, review, policyDigest, checkDigest)))
      unavailable("checkout changed before check launch; recovery required");
    await revalidateGitProjectResources(selection);
    if (options.signal?.aborted || !await options.isTrusted(cwd) || policyHash(await savedPolicy(options)) !== policyDigest)
      unavailable("trust, policy or check cancelled; recovery required");
    reservation.recordCheckBefore(pre);
    if (options.signal?.aborted) unavailable("check cancelled; recovery required");
    const result = await runCheck(cwd, check.argv, timeout, unit, backend, options.signal);
    const finishedAt = Date.now();
    // A fake cannot manufacture production cleanup evidence. This explicit
    // seam exists solely for direct node:test fixtures, not routes or models.
    let post: GitCheckSnapshot | undefined;
    try { post = await captureGitCheckRecoverySnapshot(cwd, targetCwd, review, policyDigest, checkDigest); }
    catch { /* Cannot establish an unchanged result; preserve intent. */ }
    if ((backend === linuxSystemdBackend || options.testRecoveryEvidence) && result.cleanupProof) {
      if (!post) unavailable("check recovery evidence unavailable; inspect manually");
      try {
        reservation.recordCheckAfter(post, result.cleanupProof as GitCheckCleanupProof, {
          status: result.status, timedOut: result.timedOut, overflow: result.overflow,
          containmentComplete: result.containmentComplete, logDigest: digest(result.log), finishedAt,
        }, backend === linuxSystemdBackend ? "linux-systemd" : "node-test-simulated");
      } catch { unavailable("check recovery evidence unavailable; inspect manually"); }
    }
    // Check commands are arbitrary project code. They may modify files/refs; never undo their side effects.
    let unchanged = false;
    try {
      const after = await reviewGitBranches(cwd, review.featureBranch, review.targetBranch);
      const f = await checkout(cwd, review.featureBranch, review.featureOid);
      const t = await checkout(targetCwd, review.targetBranch, review.targetOid);
      unchanged = exact(before, after) && samePath(targetCwd, await registered(cwd, review.featureBranch, review.targetBranch)) &&
        f.indexPath === feature.indexPath && f.indexDigest === feature.indexDigest &&
        t.indexPath === target.indexPath && t.indexDigest === target.indexDigest &&
        policyHash(await savedPolicy(options)) === policyDigest && await options.isTrusted(cwd);
    } catch { /* fail closed; do not hide check side effects */ }
    const id = randomUUID();
    await privateLog(options.agentDir, id, result.log);
    // Log I/O is asynchronous: do not issue an already-stale receipt if another writer moved refs meanwhile.
    try {
      unchanged = unchanged && exact(before, await reviewGitBranches(cwd, review.featureBranch, review.targetBranch)) &&
        (await checkout(cwd, review.featureBranch, review.featureOid)).indexDigest === feature.indexDigest &&
        (await checkout(targetCwd, review.targetBranch, review.targetOid)).indexDigest === target.indexDigest &&
        samePath(targetCwd, await registered(cwd, review.featureBranch, review.targetBranch)) &&
        policyHash(await savedPolicy(options)) === policyDigest && await options.isTrusted(cwd);
      if (unchanged) await revalidateGitProjectResources(selection);
    } catch { unchanged = false; }
    const passed = !options.signal?.aborted && result.status === 0 && !result.timedOut && !result.overflow && unchanged &&
      post !== undefined && JSON.stringify(pre) === JSON.stringify(post) && result.containmentComplete &&
      (backend !== linuxSystemdBackend || !!result.cleanupProof);
    if (!passed) unavailable("check failed, timed out, or checkout/ref/policy/containment changed; inspect the worktrees manually (test commands can modify files)");
    // A failed, aborted or uncertain attempt NEVER clears admission, even when
    // its unit was seen empty: old receipts must not survive as a path around
    // a later unsuccessful check.
    // Preserve the existing successful-check settlement under the live owner.
    // There is no recovery/clear path for failed, aborted or uncertain checks.
    try { reservation.resolve(); }
    catch { unavailable("check process containment recovery required; inspect the worktrees manually"); }
    const receipt: VerificationReceipt = Object.freeze({ id, sessionId: options.sessionId, cwd,
      featureBranch: review.featureBranch, featureOid: review.featureOid, featureTreeOid: review.featureTreeOid,
      targetCwd, targetBranch: review.targetBranch, targetOid: review.targetOid, targetTreeOid: review.targetTreeOid,
      mergeTreeOid: review.mergeTreeOid, policyDigest, checkIndex: options.checkIndex,
      argv: Object.freeze([...check.argv]), startedAt, finishedAt, exitStatus: 0, logDigest: digest(result.log),
    });
    store().receipts.set(id, receipt);
    return receipt;
  } finally { running.delete(cwd); }
}
