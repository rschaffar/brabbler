import { createHash, randomUUID } from "node:crypto";
import { promises as fs, constants, lstatSync, realpathSync, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gitExecEnv } from "./git-exec";
import path from "node:path";
import { samePath } from "./paths";
import { runContainedGitCheck, pinGitCheckCwd, linuxSystemdBackend, consumeLiveContainedGitCheckSuccess,
  type ContainedCheckResult, type ContainmentBackend } from "./git-check-containment";
import { beginSupervisedGitOperationIntent, assertGitCheckRecoverySnapshotCapacity, readGitCheckAttemptState,
  gitCheckSnapshotCohortDigest, readUnresolvedGitCheckRecovery, readGitCheckRecoveryEvidence,
  type GitOperationReservation, type GitCheckAttemptState, type GitCheckSnapshot } from "./git-operation-admission";
import type { GitProjectResources } from "./git-project-resources";

const runningKey = Symbol.for("pi-web:git-check-runner:running");
/** Shared with the paired API. Preserve an existing legacy hot-reload set too. */
export function gitCheckRunningCheckouts(): Set<string> {
  const state = globalThis as unknown as Record<symbol, unknown>;
  const legacy = state[Symbol.for("pi-web:git-verification:successful-receipts")] as { running?: Set<string> } | undefined;
  return (state[runningKey] ??= legacy?.running ?? new Set<string>()) as Set<string>;
}
export const gitCheckDigest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const receiptEpochKey = Symbol.for("pi-web:git-check-runner:receipt-epochs");
type AttemptBoundary = { resourceInstance: string; attempts: GitCheckAttemptState["attempts"] };
type ReceiptEpoch = { agentDir: string; commonDir: string; cohort: string; snapshotCohort: string; state: AttemptBoundary };
function resourceInstance(commonDir: string): string {
  const s = lstatSync(commonDir, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || !samePath(commonDir, realpathSync(commonDir))) throw new Error("physical check resource required");
  return gitCheckDigest(JSON.stringify({ commonDir, device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }));
}
/** Capture the attempt epoch under the live owner BEFORE startup/payload. Even
 * a foreign attempt during a long run must not enter a late completion baseline. */
export interface GitCheckAttemptBoundary { readonly kind: "live-check-attempt" }
const attemptBoundaries = new WeakMap<GitCheckAttemptBoundary, { agentDir: string; commonDir: string; attemptId: string;
  unit: string; snapshotCohort: string; state: AttemptBoundary }>();
export function captureLiveGitCheckAttemptBoundary(reservation: GitOperationReservation, agentDir: string,
  commonDir: string, before: GitCheckSnapshot): GitCheckAttemptBoundary {
  reservation.assertOwned();
  const evidence = readUnresolvedGitCheckRecovery(agentDir, commonDir), state = readGitCheckAttemptState(agentDir, commonDir);
  if (evidence.id !== reservation.id || evidence.actionId !== reservation.actionId || JSON.stringify(evidence.before) !== JSON.stringify(before) ||
    !state.attempts.find((item) => item.id === reservation.id)?.pending) throw new Error("live pending check boundary required");
  const token: GitCheckAttemptBoundary = Object.freeze({ kind: "live-check-attempt" });
  attemptBoundaries.set(token, { agentDir, commonDir, attemptId: reservation.id, unit: evidence.unit,
    snapshotCohort: gitCheckSnapshotCohortDigest(before), state: { resourceInstance: resourceInstance(commonDir), attempts: state.attempts } });
  return token;
}
/** Opaque process capability, minted only from the live result under its owner.
 * Boundary includes prior history BEFORE the attempt, never later foreign attempts. */
export interface GitCheckSettlementAttestation { readonly kind: "live-check-settlement" }
const settlements = new WeakMap<GitCheckSettlementAttestation, { agentDir: string; commonDir: string; attemptId: string;
  snapshotCohort: string; state: AttemptBoundary }>();
export function settleLiveGitCheck(options: { reservation: GitOperationReservation; result: ContainedCheckResult;
  agentDir: string; commonDir: string; before: GitCheckSnapshot; after: GitCheckSnapshot;
  attempt: GitCheckAttemptBoundary }): GitCheckSettlementAttestation {
  const { reservation, result, agentDir, commonDir, before, after } = options;
  reservation.assertOwned();
  if (!consumeLiveContainedGitCheckSuccess(result) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("live equal-snapshot success required");
  const evidence = readUnresolvedGitCheckRecovery(agentDir, commonDir), snapshotCohort = gitCheckSnapshotCohortDigest(before);
  if (evidence.id !== reservation.id || evidence.actionId !== reservation.actionId || evidence.unit !== result.unit ||
    JSON.stringify(evidence.before) !== JSON.stringify(before)) throw new Error("live original owner required");
  const boundary = attemptBoundaries.get(options.attempt);
  attemptBoundaries.delete(options.attempt);
  if (!boundary || boundary.attemptId !== reservation.id || boundary.unit !== result.unit || boundary.snapshotCohort !== snapshotCohort ||
    !samePath(boundary.agentDir, agentDir) || !samePath(boundary.commonDir, commonDir) ||
    boundary.state.resourceInstance !== resourceInstance(commonDir)) throw new Error("original live attempt boundary required");
  const instance = boundary.state.resourceInstance;
  reservation.resolve();
  // OS suspension can occur inside resolve too. Normalize ONLY this owner's
  // positively closed record; NEVER absorb foreign records observed afterwards.
  const closed = readGitCheckAttemptState(agentDir, commonDir).attempts.find((item) => item.id === reservation.id);
  if (!closed?.successful || closed.cohortDigest !== snapshotCohort || instance !== resourceInstance(commonDir)) throw new Error("positive closed owner required");
  const token: GitCheckSettlementAttestation = Object.freeze({ kind: "live-check-settlement" });
  settlements.set(token, { agentDir, commonDir, attemptId: reservation.id, snapshotCohort,
    state: { resourceInstance: instance, attempts: Object.freeze(boundary.state.attempts.map((item) => item.id === reservation.id ? closed : item)) } });
  return token;
}
function receiptEpochs(): Map<string, ReceiptEpoch> {
  const global = globalThis as unknown as Record<symbol, Map<string, ReceiptEpoch> | undefined>;
  return global[receiptEpochKey] ??= new Map();
}
function laterAttempts(receipt: ReceiptEpoch, current: GitCheckAttemptState): GitCheckAttemptState["attempts"] | undefined {
  const previous = new Map(receipt.state.attempts.map((item) => [item.id, item.digest]));
  const now = new Map(current.attempts.map((item) => [item.id, item.digest]));
  if (receipt.state.resourceInstance !== resourceInstance(receipt.commonDir) || [...previous].some(([id, digest]) => now.get(id) !== digest)) return;
  return current.attempts.filter((item) => !previous.has(item.id));
}
/** Permanently fence existing process capabilities on failure/uncertainty.
 * Durable failed/recovered attempts independently prevent later resurrection,
 * even when no lookup happened while quarantined or a module was reloaded. */
export function fenceGitCheckReceiptCohort(agentDir: string, commonDir: string): void {
  for (const [id, item] of receiptEpochs()) if (samePath(item.agentDir, agentDir) && samePath(item.commonDir, commonDir)) receiptEpochs().delete(id);
}
/** Only a positively settled live owner may advance a successful sibling cohort.
 * Preserve original receipt IDs, outputs and finish/expiry times; never mint a
 * pass from release/recovery. Different source/policy/session/engine/environment
 * or any intervening failed/unknown/recovered attempt fences the old cohort. */
export function registerGitCheckReceiptEpoch(id: string, agentDir: string, commonDir: string,
  binding: { cohort: string; settlement: GitCheckSettlementAttestation; snapshot: GitCheckSnapshot }): void {
  const attested = settlements.get(binding.settlement);
  settlements.delete(binding.settlement); // one registration, never a reusable historical pass
  const current = readGitCheckAttemptState(agentDir, commonDir), snapshotCohort = gitCheckSnapshotCohortDigest(binding.snapshot);
  if (!attested || !samePath(attested.agentDir, agentDir) || !samePath(attested.commonDir, commonDir) ||
    attested.snapshotCohort !== snapshotCohort) throw new Error("live owned settlement attestation required");
  const candidate: ReceiptEpoch = { agentDir, commonDir, cohort: binding.cohort, snapshotCohort, state: attested.state };
  const changes = laterAttempts(candidate, current);
  if (!changes || changes.some((item) => !item.pending && (!item.successful || item.cohortDigest !== snapshotCohort)))
    throw new Error("foreign failed, recovered or unknown attempt after settlement boundary");
  for (const item of changes.filter((item) => item.pending)) {
    const evidence = readGitCheckRecoveryEvidence(agentDir, commonDir, item.id);
    if (evidence.outcome && (evidence.outcome.status !== 0 || evidence.outcome.timedOut || evidence.outcome.overflow ||
      !evidence.outcome.containmentComplete)) throw new Error("foreign unsuccessful attempt after settlement boundary");
  }
  // Pending foreign attempts HIDE the capability without becoming its baseline.
  // Only positively completed same-source siblings may advance it.
  const state: AttemptBoundary = changes.some((item) => item.pending) ? attested.state :
    { resourceInstance: attested.state.resourceInstance, attempts: current.attempts };
  for (const [oldId, prior] of receiptEpochs()) {
    if (!samePath(prior.agentDir, agentDir) || !samePath(prior.commonDir, commonDir)) continue;
    const later = laterAttempts(prior, { epoch: current.epoch, attempts: state.attempts });
    if (prior.cohort === binding.cohort && prior.snapshotCohort === snapshotCohort && later &&
      later.every((item) => item.successful && item.cohortDigest === snapshotCohort)) prior.state = state;
    else receiptEpochs().delete(oldId);
  }
  receiptEpochs().set(id, { agentDir, commonDir, cohort: binding.cohort, snapshotCohort, state });
}
export function gitCheckReceiptEpochStatus(id: string): "current" | "pending" | "stale" {
  const receipt = receiptEpochs().get(id);
  if (!receipt) return "stale";
  try {
    const current = readGitCheckAttemptState(receipt.agentDir, receipt.commonDir);
    const later = laterAttempts(receipt, current);
    if (later && !later.length) return "current";
    // Hidden while a sibling runs; only its positive live registration above
    // can reopen the original receipts. Inspection itself never advances them.
    if (later?.length && later.every((item) => item.pending || item.successful && item.cohortDigest === receipt.snapshotCohort)) return "pending";
  } catch { /* unknown/corrupt evidence permanently fences this capability */ }
  receiptEpochs().delete(id);
  return "stale";
}
export function isGitCheckReceiptEpochCurrent(id: string): boolean { return gitCheckReceiptEpochStatus(id) === "current"; }

/** Reject thenables: an async authority callback is NOT a synchronous fence.
 * Async callers must supply the trusted revision adapter documented by each engine. */
export function gitCheckSyncValue<T>(value: T | Promise<T>): T {
  if (value && typeof (value as Promise<T>).then === "function") {
    void Promise.resolve(value).catch(() => {});
    throw new Error("synchronous authority revision adapter required");
  }
  return value as T;
}
export function readGitCheckAuthorityStamp(read: () => string): string {
  const stamp = gitCheckSyncValue(read());
  if (typeof stamp !== "string" || !stamp || stamp.length > 4096) throw new Error("known synchronous authority revision required");
  return gitCheckDigest(stamp);
}
/** Bounded read-only source capture with NO awaits. Physical selection/marker
 * identity is checked before and after Git reads; mutable paths are never trusted. */
export function assertGitCheckSelectionSync(selection: GitProjectResources): void {
  for (const [dir, expected] of [[selection.cwd, selection.identities.checkout], [selection.projectRoot, selection.identities.project],
    [selection.commonDir, selection.identities.common], [selection.gitDir, selection.identities.git]] as const) {
    const s = lstatSync(dir, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || !samePath(dir, realpathSync(dir)) ||
      JSON.stringify({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }) !== JSON.stringify(expected))
      throw new Error("physical check selection changed");
  }
  const marker = lstatSync(path.join(selection.cwd, ".git"), { bigint: true });
  if (marker.isSymbolicLink() || !marker.isFile() && !marker.isDirectory() || JSON.stringify({
    device: String(marker.dev), inode: String(marker.ino), birthtime: String(marker.birthtimeNs),
    ...(marker.isFile() ? { changed: String(marker.ctimeNs), size: String(marker.size) } : {}) }) !== JSON.stringify(selection.identities.marker))
    throw new Error("physical Git marker changed");
}
export function gitCheckSourceReadSync(selection: GitProjectResources, args: string[]): string {
  return execFileSync("git", ["--no-optional-locks", "-C", selection.cwd, `--git-dir=${selection.gitDir}`, `--work-tree=${selection.cwd}`,
    "-c", "core.fsmonitor=false", ...args], { encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env: { ...gitExecEnv(), GIT_COMMON_DIR: selection.commonDir,
      GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", GIT_ALLOW_PROTOCOL: "" } });
}
export function gitCheckIndexBytesSync(file: string): Buffer {
  try { lstatSync(`${file}.lock`); throw new Error("index locked"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > 16 * 1024 * 1024) throw new Error("ordinary bounded index required");
    const bytes = readFileSync(fd), after = fstatSync(fd), named = lstatSync(file);
    if (before.dev !== named.dev || before.ino !== named.ino || before.size !== bytes.length || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("index changed");
    return bytes;
  } finally { closeSync(fd); }
}

/** Private bounded output only; never include output or OS errors in public results. */
export async function saveGitCheckPrivateLog(agentDir: string, id: string, output: Buffer): Promise<void> {
  if (!path.isAbsolute(agentDir)) throw new Error("absolute agent directory required");
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  if (!samePath(agentDir, await fs.realpath(agentDir))) throw new Error("physical agent directory required");
  const parent = path.join(agentDir, "pi-web");
  await fs.mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (!(await fs.lstat(parent)).isDirectory() || !samePath(parent, await fs.realpath(parent))) throw new Error("physical log parent required");
  const logs = path.join(parent, "git-verification-logs");
  await fs.mkdir(logs, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await fs.lstat(logs);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("private log directory required");
  await fs.writeFile(path.join(logs, `${id}.log`), output, { flag: "wx", mode: 0o600 });
}

/** Small snapshot-agnostic supervisor; no GitReview, grant, target or receipt.
 * Failed/aborted/uncertain attempts NEVER resolve their durable original-unit intent.
 * Caller probes availability/admission and captures a baseline before calling.
 * No automatic recovery, unit substitution, reset or retry. */
export async function superviseGitCheck(options: {
  selection: GitProjectResources; agentDir: string; actionId: string; unit: string;
  before: GitCheckSnapshot; cwd: string; argv: readonly string[]; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; backend: ContainmentBackend; testRecoveryEvidence?: boolean;
  /** Revalidate live authority/selection and return the current exact snapshot. */
  revalidate: () => Promise<GitCheckSnapshot>;
  /** Final source + authority fence, synchronous and mandatory at write/settle. */
  assertCurrentSync: () => void;
  /** Capture even a dirty post-state without requiring live authorization. */
  captureAfter: () => Promise<GitCheckSnapshot>;
  /** Drain live-revocation probes before the synchronous successful settlement. */
  beforeResolve?: () => Promise<void>;
}): Promise<{ id: string; settlement: GitCheckSettlementAttestation; startedAt: number; finishedAt: number; logDigest: string }> {
  const { before, selection, backend } = options;
  const same = (snapshot: GitCheckSnapshot) => JSON.stringify(before) === JSON.stringify(snapshot);
  assertGitCheckRecoverySnapshotCapacity(selection.commonDir, options.actionId, options.unit, before);
  if (!same(await options.revalidate()) || options.signal?.aborted) throw new Error("check changed before intent");
  const reservation = await beginSupervisedGitOperationIntent(selection, options.actionId, "checks", options.agentDir, options.unit);
  let settled = false;
  try {
  // Persist the baseline BEFORE any further asynchronous validation; if that
  // validation fails, restart can still inspect the original intended state.
  reservation.recordCheckBefore(before);
  const attempt = captureLiveGitCheckAttemptBoundary(reservation, options.agentDir, selection.commonDir, before);
  if (!same(await options.revalidate()) || options.signal?.aborted) throw new Error("check changed before launch; recovery required");
  reservation.assertOwned();
  const startedAt = Date.now();
  const cwdPin = await pinGitCheckCwd(options.cwd);
  let result: Awaited<ReturnType<typeof runContainedGitCheck>>;
  try {
    if (before.version === 2 ? cwdPin.identityDigest !== before.cwdIdentity :
      JSON.stringify(cwdPin.instance) !== JSON.stringify(selection.identities.checkout)) throw new Error("physical check cwd changed");
    result = await runContainedGitCheck({ cwd: options.cwd, argv: options.argv, env: options.env,
      timeoutMs: options.timeoutMs, unit: options.unit, signal: options.signal }, backend, { cwdPin,
      beforeRelease: async () => {
        if (!same(await options.revalidate()) || options.signal?.aborted) throw new Error("check changed at payload release");
        reservation.assertOwned();
      }, assertBeforeReleaseSync: () => {
        reservation.assertOwned();
        if (typeof options.assertCurrentSync !== "function" || gitCheckSyncValue(options.assertCurrentSync()) !== undefined)
          throw new Error("synchronous source/authority fence required");
      } });
  } finally { await cwdPin.close(); }
  const finishedAt = Date.now();
  let post: GitCheckSnapshot | undefined;
  try { post = await options.captureAfter(); } catch { /* retain intent */ }
  if (post && result.cleanupProof && (backend === linuxSystemdBackend || options.testRecoveryEvidence)) {
    reservation.recordCheckAfter(post, result.cleanupProof, { status: result.status, timedOut: result.timedOut,
      overflow: result.overflow, containmentComplete: result.containmentComplete,
      logDigest: gitCheckDigest(result.log), finishedAt }, backend === linuxSystemdBackend ? "linux-systemd" : "node-test-simulated");
  }
  const id = randomUUID();
  await saveGitCheckPrivateLog(options.agentDir, id, result.log);
  if (options.signal?.aborted || result.status !== 0 || result.timedOut || result.overflow || !result.containmentComplete ||
    !post || !same(post) || (backend === linuxSystemdBackend && !result.cleanupProof)) {
    throw new Error("check failed or changed; recovery required");
  }
  await options.beforeResolve?.();
  const fresh = await options.revalidate();
  // Recheck cancellation AFTER asynchronous validation, immediately before the
  // owner's synchronous settlement. Late revocation cannot release quarantine.
  if (options.signal?.aborted || !same(fresh)) throw new Error("check changed; recovery required");
  if (typeof options.assertCurrentSync !== "function" || gitCheckSyncValue(options.assertCurrentSync()) !== undefined)
    throw new Error("synchronous settlement fence required");
  const settlement = settleLiveGitCheck({ reservation, result, agentDir: options.agentDir, commonDir: selection.commonDir, before, after: fresh, attempt });
  settled = true;
  return { id, settlement, startedAt, finishedAt, logDigest: gitCheckDigest(result.log) };
  } finally { if (!settled) fenceGitCheckReceiptCohort(options.agentDir, selection.commonDir); }
}
