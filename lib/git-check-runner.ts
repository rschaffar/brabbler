import { createHash, randomUUID } from "node:crypto";
import { promises as fs, constants, lstatSync, realpathSync, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gitExecEnv } from "./git-exec";
import path from "node:path";
import { samePath } from "./paths";
import { runContainedGitCheck, pinGitCheckCwd, linuxSystemdBackend, consumeLiveContainedGitCheckSuccess,
  readContainedGitCheckExecutionFacts, type GitContainedCheckExecutionFacts, type ContainmentBackend } from "./git-check-containment";
import type { GitCheckSnapshot } from "./git-check-evidence";
import type { GitProjectResources } from "./git-project-resources";
import { appendFinalizedGitDiagnosticOutput } from "./git-diagnostic-retention";

export const gitCheckDigest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export type GitCheckDiagnostics = Readonly<{ status: "unavailable"; reason: "storage-unavailable" | "retention-limited" }>;
/** Original process-local batch handle, not a grant or result. Each declared
 * recipe enters once, in declaration order, after its predecessor is published.
 * Independent runs, even in one session, use new handles and may overlap. */
export interface GitCheckCohort { readonly kind: "git-check-cohort" }
export interface GitCheckReceiptCohortMetadata { readonly id: string; readonly checkIndexes: readonly number[] }
type Cohort = { metadata: Readonly<GitCheckReceiptCohortMetadata>; indexes: Set<number>; started: Set<number>;
  registered: Map<number, string>; retired: boolean; binding?: string };
const cohorts = new WeakMap<GitCheckCohort, Cohort>();
export function createGitCheckCohort(checkIndexes: readonly number[]): GitCheckCohort {
  if (!Array.isArray(checkIndexes) || !checkIndexes.length || checkIndexes.length > 64 ||
    new Set(checkIndexes).size !== checkIndexes.length || checkIndexes.some((i) => !Number.isSafeInteger(i) || i < 0)) throw new Error("exact batch indexes required");
  const handle: GitCheckCohort = Object.freeze({ kind: "git-check-cohort" });
  cohorts.set(handle, { metadata: Object.freeze({ id: randomUUID(), checkIndexes: Object.freeze([...checkIndexes]) }),
    indexes: new Set(checkIndexes), started: new Set(), registered: new Map(), retired: false });
  return handle;
}
export function retireGitCheckCohort(handle: GitCheckCohort): void {
  const state = cohorts.get(handle);
  if (!state) throw new Error("original check cohort required");
  state.retired = true;
}
export interface GitCheckAttempt { readonly kind: "git-check-attempt" }
const attempts = new WeakMap<GitCheckAttempt, { cohort: GitCheckCohort; checkIndex: number; phase: "ready" | "running" | "settled" }>();
/** Trusted leaf entry only, never a public request capability. */
export function beginGitCheckAttempt(cohort: GitCheckCohort, checkIndex: number): GitCheckAttempt {
  const state = cohorts.get(cohort);
  // registered is the private publication prefix, not an exit-status counter.
  // Refuse (never queue) a reverse/premature member without consuming its slot
  // or retiring a valid in-flight predecessor. No other cohort participates.
  if (!state || state.retired || !state.indexes.has(checkIndex) || state.started.has(checkIndex) ||
    state.started.size !== state.registered.size || [...state.indexes][state.registered.size] !== checkIndex)
    throw new Error("fresh original batch member required");
  state.started.add(checkIndex);
  const attempt: GitCheckAttempt = Object.freeze({ kind: "git-check-attempt" });
  attempts.set(attempt, { cohort, checkIndex, phase: "ready" });
  return attempt;
}
function assertAttempt(attempt: GitCheckAttempt): Cohort {
  const member = attempts.get(attempt), state = member && cohorts.get(member.cohort);
  if (!member || member.phase !== "running" || !state || state.retired) throw new Error("live original check member required");
  return state;
}
export interface GitCheckSettlementAttestation { readonly kind: "live-check-settlement" }
const settlements = new WeakMap<GitCheckSettlementAttestation, { id: string; cohort: GitCheckCohort; checkIndex: number;
  snapshot: string; agentDir: string; commonDir: string }>();
const receiptEpochs = new Map<string, { cohort: GitCheckCohort; checkIndex: number }>();
/** No foreign history, filesystem ledger or resource-wide epoch participates. */
export function registerGitCheckReceiptEpoch(id: string, agentDir: string, commonDir: string,
  binding: { cohort: GitCheckCohort; settlement: GitCheckSettlementAttestation; snapshot: GitCheckSnapshot }): void {
  const attested = settlements.get(binding.settlement);
  settlements.delete(binding.settlement);
  const state = cohorts.get(binding.cohort);
  if (!attested || attested.id !== id || attested.cohort !== binding.cohort || !state || state.retired ||
    !state.started.has(attested.checkIndex) || state.started.size !== state.registered.size + 1 ||
    [...state.indexes][state.registered.size] !== attested.checkIndex || state.registered.has(attested.checkIndex) ||
    attested.agentDir !== agentDir || attested.commonDir !== commonDir || attested.snapshot !== JSON.stringify(binding.snapshot) || receiptEpochs.has(id))
    throw new Error("original live successful settlement required");
  state.registered.set(attested.checkIndex, id);
  receiptEpochs.set(id, { cohort: binding.cohort, checkIndex: attested.checkIndex });
}
export function gitCheckReceiptEpochStatus(id: string): "current" | "stale" {
  const member = receiptEpochs.get(id);
  if (member && cohorts.get(member.cohort)?.retired === false) return "current";
  receiptEpochs.delete(id);
  return "stale";
}
export function isGitCheckReceiptEpochCurrent(id: string): boolean { return gitCheckReceiptEpochStatus(id) === "current"; }
/** Inert UI correlation from actual private receipt membership only. Does not
 * validate source, expiry, owner or authority: first use the leaf's authenticated
 * lookup in the caller's own session. No history/copy/cohort ID can join a batch,
 * restore a receipt, or authorize an operation through this reader. */
export function readGitCheckReceiptCohortMetadata(id: string): Readonly<GitCheckReceiptCohortMetadata> | undefined {
  const member = receiptEpochs.get(id), state = member && cohorts.get(member.cohort);
  return state && !state.retired ? state.metadata : undefined;
}
/** Necessary required-set proof, NOT authorization or fresh source/owner/expiry
 * validation. Exactly one original privately registered batch, in ascending saved
 * index order, with each predecessor published before the next member entered.
 * Every declared required member must be published. Optional supersets,
 * partial/reordered declarations, mixed independent runs and empty bypasses fail.
 * This reader neither retires batches nor reconstructs membership from metadata. */
export function assertGitCheckReceiptBatchCurrent(receiptIds: readonly string[], requiredIndexes: readonly number[]): void {
  const refuse = (): never => { throw new Error("original complete ordered check batch required"); };
  if (!Array.isArray(receiptIds) || !Array.isArray(requiredIndexes) || !requiredIndexes.length || requiredIndexes.length > 64 ||
    receiptIds.length !== requiredIndexes.length) return refuse();
  receiptIds = [...receiptIds]; requiredIndexes = [...requiredIndexes];
  if (new Set(receiptIds).size !== receiptIds.length || receiptIds.some(id => typeof id !== "string") ||
    requiredIndexes.some((index, i) => !Number.isSafeInteger(index) || index < 0 || i > 0 && index <= requiredIndexes[i - 1])) return refuse();
  const first = receiptEpochs.get(receiptIds[0]), state = first && cohorts.get(first.cohort);
  if (!first || !state || state.retired || state.indexes.size !== requiredIndexes.length ||
    state.registered.size !== requiredIndexes.length || [...state.indexes].some((index, i) => index !== requiredIndexes[i])) return refuse();
  for (let i = 0; i < requiredIndexes.length; i++) {
    const member = receiptEpochs.get(receiptIds[i]);
    if (!member || member.cohort !== first.cohort || member.checkIndex !== requiredIndexes[i] ||
      state.registered.get(requiredIndexes[i]) !== receiptIds[i]) refuse();
  }
}

/** Reject thenables: resolved async authorization is not a synchronous fence. */
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

/** No reservation/admission/history dependency. Each invocation owns exactly
 * one containment attempt; only its authentic one-shot measured result passes. */
export async function superviseGitCheck(options: {
  selection: GitProjectResources; agentDir: string; actionId: string; unit: string;
  attempt: GitCheckAttempt; cohortBinding: string;
  before: GitCheckSnapshot; cwd: string; argv: readonly string[]; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; backend: ContainmentBackend; testRecoveryEvidence?: boolean;
  revalidate: () => Promise<GitCheckSnapshot>;
  assertCurrentSync: () => void;
  captureAfter: () => Promise<GitCheckSnapshot>;
  beforeResolve?: () => Promise<void>;
  onExecution?: (facts: Readonly<GitContainedCheckExecutionFacts>, id: string, passing: boolean, diagnostics?: GitCheckDiagnostics,
    outputDiagnosticId?: string) => Promise<void>;
}): Promise<{ id: string; settlement: GitCheckSettlementAttestation; startedAt: number; finishedAt: number; logDigest: string;
  diagnostics?: GitCheckDiagnostics; outputDiagnosticId?: string }> {
  const { before, selection, backend, attempt } = options;
  const member = attempts.get(attempt);
  if (!member || member.phase !== "ready") throw new Error("fresh original invocation required");
  member.phase = "running"; // one entry, before ANY await; copied/reentrant attempts cannot launch twice
  const state = assertAttempt(attempt);
  const same = (snapshot: GitCheckSnapshot) => JSON.stringify(before) === JSON.stringify(snapshot);
  const retireOnAbort = () => { state.retired = true; };
  options.signal?.addEventListener("abort", retireOnAbort, { once: true });
  try {
    if (before.dependencyVersion !== 2 || !before.relevantRefs.length)
      throw new Error("exact original batch binding required");
    const source = Object.fromEntries(Object.entries(before).filter(([key]) =>
      !["recipeDigest", "checkDigest", "cwdIdentity", "environmentDigest"].includes(key)));
    const binding = JSON.stringify([options.cohortBinding, source]);
    if (state.binding !== undefined && state.binding !== binding) throw new Error("original batch source changed");
    state.binding = binding;
    const assertCurrent = () => {
      assertAttempt(attempt);
      if (options.signal?.aborted || gitCheckSyncValue(options.assertCurrentSync()) !== undefined) throw new Error("check changed");
    };
    if (!same(await options.revalidate())) throw new Error("check changed before launch");
    assertCurrent();
    const cwdPin = await pinGitCheckCwd(options.cwd);
    let result: Awaited<ReturnType<typeof runContainedGitCheck>>;
    try {
      if (before.version === 1 ? JSON.stringify(cwdPin.instance) !== JSON.stringify(selection.identities.checkout) :
        cwdPin.identityDigest !== before.cwdIdentity) throw new Error("physical check cwd changed");
      result = await runContainedGitCheck({ cwd: options.cwd, argv: options.argv, env: options.env,
        timeoutMs: options.timeoutMs, unit: options.unit, signal: options.signal }, backend, { cwdPin,
        beforeRelease: async () => {
          if (!same(await options.revalidate())) throw new Error("check changed at payload release");
          assertCurrent();
        }, assertBeforeReleaseSync: assertCurrent });
    } finally { await cwdPin.close(); }
    const facts = readContainedGitCheckExecutionFacts(result);
    if (!facts) throw new Error("actual protocol measurement required");
    // Consume actual one-shot native success BEFORE optional output/history I/O.
    // This private boolean is never supplied by a diagnostic callback. It alone
    // is insufficient for publication: original source/authority/cohort fences
    // still follow every await below.
    const nativeSuccess = consumeLiveContainedGitCheckSuccess(result);
    if (!nativeSuccess) state.retired = true; // terminal failure cannot await optional diagnostics before retirement
    const { startedAt, finishedAt, logDigest } = facts, id = randomUUID();
    // Only finalized, positively stopped output may enter completed retention.
    // Unknown cleanup keeps its existing raw evidence entirely outside retention.
    const completedOutput = facts.containmentComplete || result.cleanupProof?.terminal && result.cleanupProof.empty ? Buffer.from(result.log) : undefined;
    let diagnostics: GitCheckDiagnostics | undefined, outputDiagnosticId: string | undefined;
    const storageUnavailable = Object.freeze({ status: "unavailable" as const, reason: "storage-unavailable" as const });
    if (completedOutput) {
      try {
        // Creation failure is optional too. The retention adapter pins/checks
        // the explicit private agent root and one stable application namespace.
        await fs.mkdir(options.agentDir, { recursive: true, mode: 0o700 });
        const report = appendFinalizedGitDiagnosticOutput(options.agentDir, {
          kind: before.version === 1 ? "checks" : "checkout-verification",
          nativeOutcome: nativeSuccess ? "succeeded" : options.signal?.aborted ? "cancelled" :
            facts.payload === "prevented-before-write" ? "rejected" : "failed",
          completedAt: finishedAt, durationMs: Math.max(0, finishedAt - startedAt), exitCode: facts.exitStatus,
        }, completedOutput);
        diagnostics = report.diagnostics ? Object.freeze({ ...report.diagnostics }) : undefined;
        if (report.log === "stored") outputDiagnosticId = report.id;
      } catch { diagnostics = storageUnavailable; }
    } else diagnostics = storageUnavailable;
    let post: GitCheckSnapshot | undefined;
    try { post = await options.captureAfter(); } catch { /* not successful source evidence */ }
    const passing = nativeSuccess && !options.signal?.aborted && result.status === 0 && !result.timedOut && !result.overflow &&
      result.containmentComplete && !!post && same(post) && (backend !== linuxSystemdBackend || !!result.cleanupProof);
    if (!passing) state.retired = true;
    // Measurement is diagnostic, NOT a published receipt. Throwing storage alone
    // does not alter native success; any callback mutation still fails the fence.
    try { await options.onExecution?.(facts, id, passing, diagnostics, outputDiagnosticId); } catch { diagnostics = storageUnavailable; }
    if (!passing) throw new Error("check failed or source/containment changed");
    await options.beforeResolve?.();
    if (!same(await options.revalidate())) throw new Error("check changed after diagnostics");
    assertCurrent();
    member.phase = "settled";
    const settlement: GitCheckSettlementAttestation = Object.freeze({ kind: "live-check-settlement" });
    settlements.set(settlement, { id, cohort: member.cohort, checkIndex: member.checkIndex,
      snapshot: JSON.stringify(before), agentDir: options.agentDir, commonDir: selection.commonDir });
    return { id, settlement, startedAt, finishedAt, logDigest,
      ...(diagnostics ? { diagnostics } : {}), ...(outputDiagnosticId ? { outputDiagnosticId } : {}) };
  } catch (error) { state.retired = true; throw error; }
  finally { options.signal?.removeEventListener("abort", retireOnAbort); }
}
