// Internal server engine only. No route/tool enablement, saved grant or paired receipt adapter.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import { normalizeGitCheckRecipe, selectGitCheckRecipesForStage, validateGitCheckRecipes,
  type GitCheckRecipe, type GitCheckStage } from "./git-check-recipe";
import { validateGitWorkflowSettings, type GitWorkflowSettings } from "./git-workflow-settings";
import { selectCanonicalGitResources, revalidateGitProjectResources,
  type GitProjectResources, type GitResourceSelector } from "./git-project-resources";
import { assertGitOperationAdmission, type GitSelectedCheckSnapshot } from "./git-operation-admission";
import { newGitCheckUnit, linuxSystemdBackend, type ContainmentBackend } from "./git-check-containment";
import { gitCheckDigest as hash, gitCheckRunningCheckouts, superviseGitCheck,
  registerGitCheckReceiptEpoch, gitCheckReceiptEpochStatus, gitCheckSyncValue, readGitCheckAuthorityStamp,
  assertGitCheckSelectionSync, gitCheckSourceReadSync, gitCheckIndexBytesSync } from "./git-check-runner";
import { GIT_ACTION_ID_PATTERN } from "./git-action-types";
import { samePath } from "./paths";

const exec = promisify(execFile);
const MAX_TIME = 5 * 60_000;
const RECEIPT_MS = 15 * 60_000;
const receiptKey = Symbol.for("pi-web:git-checkout-verification:receipts");
function receipts(): Map<string, GitCheckoutVerificationReceipt> {
  const state = globalThis as unknown as Record<symbol, Map<string, GitCheckoutVerificationReceipt> | undefined>;
  return state[receiptKey] ??= new Map();
}
export class GitCheckoutVerificationError extends Error {
  constructor(readonly code: "invalid-request" | "unavailable" | "denied" | "stale" | "running" | "recovery-required") {
    super(`Selected checkout verification ${code}; inspect the selected checkout and private evidence. Repository-required checks are not waived.`);
  }
}
function refuse(code: GitCheckoutVerificationError["code"] = "unavailable"): never { throw new GitCheckoutVerificationError(code); }
export interface GitCheckoutVerificationPolicy { policyRevision: string; settings: GitWorkflowSettings }
export interface GitCheckoutVerificationCandidate {
  readonly selection: Readonly<GitProjectResources>;
  readonly checkIndex: number; readonly stage: GitCheckStage;
  readonly policyDigest: string; readonly policyRevision: string; readonly recipeDigest: string;
  readonly snapshot: Readonly<GitSelectedCheckSnapshot>;
}
/** One process-only success, not all-checks proof, integration authority or a persisted approval. */
export interface GitCheckoutVerificationReceipt extends GitCheckoutVerificationCandidate {
  readonly kind: "selected-checkout-verification"; readonly version: 2;
  readonly id: string; readonly sessionId: string; readonly executionCwd: string;
  readonly snapshotDigest: string; readonly environmentDigest: string;
  readonly startedAt: number; readonly finishedAt: number; readonly expiresAt: number;
  readonly exitStatus: 0; readonly logDigest: string;
}
export interface GitCheckoutVerificationOptions {
  sessionId: string; selector: GitResourceSelector; agentDir: string; checkIndex: number; stage: GitCheckStage;
  /** Saved selected-project policy, never model-provided recipe values or another chat's task. */
  getPolicy: (selection: Readonly<GitProjectResources>) => GitCheckoutVerificationPolicy | Promise<GitCheckoutVerificationPolicy>;
  /** Independent live callbacks. Selection/browsing is not actor authorization or trust. */
  isSelectionAuthorized: (selection: Readonly<GitProjectResources>) => boolean | Promise<boolean>;
  isTrusted: (projectRoot: string) => boolean | Promise<boolean>;
  isActorAuthorized: (candidate: GitCheckoutVerificationCandidate) => boolean | Promise<boolean>;
  /** Trusted bootstrap only. REQUIRED when any authority callback is async.
   * Synchronously read a monotonic revision covering policy/pause, grants, trust,
   * actor/tool/opt-out and selection. Every mutation/revocation increments it,
   * including change-and-restore. Never a request value or captured/static stamp.
   * Source/physical selection and sanitized environment are additionally checked
   * synchronously by this engine. Missing/unknown/thenable stamps fail closed. */
  readAuthorityRevisionSync?: () => string;
  actionId?: string; signal?: AbortSignal; timeoutMs?: number;
  /** Only direct node:test fixtures. Never expose these fields to routes/tools. */
  testContainmentBackend?: ContainmentBackend; testRecoveryEvidence?: boolean;
  testBeforeReceiptRegistration?: () => Promise<void>;
}

/** Exact-stage discovery only. Empty lists create NO receipts or execution effects. */
export function selectGitCheckoutVerificationChecks(checks: unknown, stage: Exclude<GitCheckStage, "none">):
  { status: "no-defined" | "no-required" | "required"; checkIndexes: readonly number[]; repositoryChecksWaived: false } {
  const defined = validateGitCheckRecipes(checks);
  const selected = selectGitCheckRecipesForStage(defined, stage);
  return { status: !defined.length ? "no-defined" : !selected.length ? "no-required" : "required",
    checkIndexes: selected.map(({ checkIndex }) => checkIndex), repositoryChecksWaived: false };
}
export function lookupGitCheckoutVerificationReceipt(id: string): GitCheckoutVerificationReceipt | undefined {
  const receipt = receipts().get(id);
  if (receipt) {
    if (Date.now() < receipt.finishedAt || Date.now() >= receipt.expiresAt) { receipts().delete(id); return; }
    const status = gitCheckReceiptEpochStatus(id);
    if (status === "stale") receipts().delete(id);
    if (status !== "current") return;
  }
  return receipt;
}
export function invalidateGitCheckoutVerificationReceiptsForCheckout(cwd: string): void {
  for (const [id, receipt] of receipts()) if (samePath(receipt.selection.cwd, cwd)) receipts().delete(id);
}

async function git(selection: GitProjectResources, args: string[]): Promise<string> {
  return (await exec("git", ["--no-optional-locks", "-C", selection.cwd, `--git-dir=${selection.gitDir}`,
    `--work-tree=${selection.cwd}`, "-c", "core.fsmonitor=false", ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...gitExecEnv(), GIT_COMMON_DIR: selection.commonDir, GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", GIT_ALLOW_PROTOCOL: "" },
  })).stdout;
}
async function physicalCwd(checkout: string, relative: string): Promise<{ cwd: string; identity: string }> {
  let cwd = checkout;
  for (const part of relative === "." ? [] : relative.split("/")) {
    cwd = path.join(cwd, part);
    const s = await fs.lstat(cwd);
    if (!s.isDirectory() || s.isSymbolicLink() || !samePath(cwd, await fs.realpath(cwd))) refuse();
  }
  const rel = path.relative(checkout, cwd);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) refuse();
  const s = await fs.lstat(cwd, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || !samePath(cwd, await fs.realpath(cwd))) refuse();
  return { cwd, identity: hash(JSON.stringify({ cwd, device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) })) };
}
function environment(recipe: Required<GitCheckRecipe>): NodeJS.ProcessEnv {
  return sanitizeProjectCommandEnvironment({ ...gitExecEnv(), ...recipe.env });
}
function environmentDigest(env: NodeJS.ProcessEnv): string {
  return hash(JSON.stringify(Object.entries(env).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
}
async function indexBytes(file: string): Promise<Buffer> {
  const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 16 * 1024 * 1024) refuse();
    const bytes = await fd.readFile(), after = await fd.stat(), named = await fs.lstat(file);
    if (before.dev !== named.dev || before.ino !== named.ino || before.size !== bytes.length ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) refuse("stale");
    return bytes;
  } finally { await fd.close(); }
}
const markers = ["index.lock", "HEAD.lock", "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START"];
async function markerState(selection: GitProjectResources): Promise<string[]> {
  const present: string[] = [];
  for (const dir of new Set([selection.gitDir, selection.commonDir])) for (const marker of markers) {
    try { const s = await fs.lstat(path.join(dir, marker)); present.push(`${dir}\0${marker}\0${s.dev}:${s.ino}:${s.ctimeMs}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return present;
}
export interface GitCheckoutCheckBinding {
  recipe: GitCheckRecipe; checkIndex: number; stage: GitCheckStage;
  policyDigest: string; policyRevision: string; environmentDigest: string;
}
/** Raw post-state capture for recovery, including dirty/changed refs. No release,
 * approval, trust bypass or receipt. Original selection and binding are supplied
 * by the live server owner, not reconstructed from a historical action ID. */
export async function captureGitCheckoutCheckRecoverySnapshot(selection: GitProjectResources, binding: GitCheckoutCheckBinding,
  requireClean = false): Promise<GitSelectedCheckSnapshot> {
  const current = await selectCanonicalGitResources({ repositoryPath: selection.projectRoot, checkoutPath: selection.cwd });
  const recipe = normalizeGitCheckRecipe(binding.recipe);
  const cwd = await physicalCwd(current.cwd, recipe.cwd);
  // Status can otherwise execute configured clean filters outside supervision.
  const config = await git(current, ["config", "--list", "--null"]);
  if (config.split("\0").some((row) => /^(?:filter\.|remote\..*\.promisor\n|(?:core\.(?:sparsecheckout|splitindex)|index\.sparse)\n(?:true|1|yes|on))/i.test(row))) refuse();
  const marker = await markerState(current);
  if (requireClean && marker.length) refuse();
  const indexPath = path.join(current.gitDir, "index");
  const [bytes, status, flags, head, tree, branch, refs] = await Promise.all([
    indexBytes(indexPath), git(current, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(current, ["ls-files", "-v", "-z"]), git(current, ["rev-parse", "--verify", "HEAD^{commit}"]),
    git(current, ["rev-parse", "--verify", "HEAD^{tree}"]), git(current, ["symbolic-ref", "--quiet", "HEAD"]),
    git(current, ["show-ref", "--head"]),
  ]);
  if (requireClean && (status !== "" || flags.split("\0").some((entry) => entry && !entry.startsWith("H ")))) refuse();
  await revalidateGitProjectResources(current);
  return { version: 2, checkoutPath: hash(current.cwd), checkoutIdentity: hash(JSON.stringify(current.identities)),
    resourceIdentity: hash(current.commonDir + "\0" + JSON.stringify(current.identities.common)),
    branch: hash(branch.trim()), head: hash(head.trim()), tree: hash(tree.trim()),
    index: hash(indexPath + "\0" + hash(bytes)), status: hash(JSON.stringify({ status, flags, config: hash(config), marker })), refs: hash(refs),
    policyDigest: binding.policyDigest, policyRevision: hash(binding.policyRevision), recipeDigest: hash(JSON.stringify(binding.recipe)),
    checkDigest: hash(JSON.stringify({ checkIndex: binding.checkIndex, recipe: binding.recipe })),
    cwdIdentity: cwd.identity, environmentDigest: binding.environmentDigest, stageDigest: hash(binding.stage) };
}
function policyValue(input: GitCheckoutVerificationPolicy): GitCheckoutVerificationPolicy {
  if (!input || typeof input.policyRevision !== "string" || !input.policyRevision || input.policyRevision.length > 512 ||
    /[\x00-\x1f\x7f]/.test(input.policyRevision)) refuse("invalid-request");
  const settings = validateGitWorkflowSettings(input.settings);
  if (!settings.enabled || settings.checkConfirmation === "disabled") refuse("denied");
  return { policyRevision: input.policyRevision, settings };
}
async function savedPolicy(options: GitCheckoutVerificationOptions, selection: GitProjectResources): Promise<GitCheckoutVerificationPolicy> {
  return policyValue(await options.getPolicy(selection));
}
/** Final post-await source, not an earlier async capture returned optimistically. */
function captureSnapshotSync(selection: GitProjectResources, binding: GitCheckoutCheckBinding): GitSelectedCheckSnapshot {
  assertGitCheckSelectionSync(selection);
  const recipe = normalizeGitCheckRecipe(binding.recipe);
  let cwd = selection.cwd;
  for (const part of recipe.cwd === "." ? [] : recipe.cwd.split("/")) {
    cwd = path.join(cwd, part);
    const s = lstatSync(cwd);
    if (!s.isDirectory() || s.isSymbolicLink() || !samePath(cwd, realpathSync(cwd))) refuse("stale");
  }
  const s = lstatSync(cwd, { bigint: true });
  const cwdIdentity = hash(JSON.stringify({ cwd, device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }));
  const read = (args: string[]) => gitCheckSourceReadSync(selection, args);
  const config = read(["config", "--list", "--null"]);
  if (config.split("\0").some((row) => /^(?:filter\.|remote\..*\.promisor\n|(?:core\.(?:sparsecheckout|splitindex)|index\.sparse)\n(?:true|1|yes|on))/i.test(row))) refuse();
  for (const dir of new Set([selection.gitDir, selection.commonDir])) for (const marker of markers) {
    try { lstatSync(path.join(dir, marker)); refuse("stale"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const indexPath = path.join(selection.gitDir, "index"), bytes = gitCheckIndexBytesSync(indexPath);
  const status = read(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), flags = read(["ls-files", "-v", "-z"]);
  if (status !== "" || flags.split("\0").some((entry) => entry && !entry.startsWith("H "))) refuse("stale");
  const head = read(["rev-parse", "--verify", "HEAD^{commit}"]), tree = read(["rev-parse", "--verify", "HEAD^{tree}"]),
    branch = read(["symbolic-ref", "--quiet", "HEAD"]), refs = read(["show-ref", "--head"]);
  assertGitCheckSelectionSync(selection);
  return { version: 2, checkoutPath: hash(selection.cwd), checkoutIdentity: hash(JSON.stringify(selection.identities)),
    resourceIdentity: hash(selection.commonDir + "\0" + JSON.stringify(selection.identities.common)),
    branch: hash(branch.trim()), head: hash(head.trim()), tree: hash(tree.trim()), index: hash(indexPath + "\0" + hash(bytes)),
    status: hash(JSON.stringify({ status, flags, config: hash(config), marker: [] })), refs: hash(refs),
    policyDigest: binding.policyDigest, policyRevision: hash(binding.policyRevision), recipeDigest: hash(JSON.stringify(binding.recipe)),
    checkDigest: hash(JSON.stringify({ checkIndex: binding.checkIndex, recipe: binding.recipe })), cwdIdentity,
    environmentDigest: binding.environmentDigest, stageDigest: hash(binding.stage) };
}
function freezeSelection(selection: GitProjectResources): GitProjectResources {
  for (const value of Object.values(selection.identities)) Object.freeze(value);
  Object.freeze(selection.identities);
  return Object.freeze(selection);
}

/** Execute ONE explicit saved index. `none` stage supports manual-only recipes.
 * Policy does not imply trust, actor authority, local integration or remote capability. */
export async function runGitCheckoutVerification(options: GitCheckoutVerificationOptions): Promise<GitCheckoutVerificationReceipt> {
  let cwd: string | undefined;
  let launched = false;
  let supervising = false;
  try {
    if (!options || typeof options.sessionId !== "string" || !options.sessionId || options.sessionId.length > 512 ||
      !Number.isInteger(options.checkIndex) || options.checkIndex < 0 || !["commit", "integration", "handoff", "none"].includes(options.stage) ||
      typeof options.getPolicy !== "function" || typeof options.isTrusted !== "function" ||
      typeof options.isSelectionAuthorized !== "function" || typeof options.isActorAuthorized !== "function" ||
      !path.isAbsolute(options.agentDir) || options.actionId !== undefined && !GIT_ACTION_ID_PATTERN.test(options.actionId)) refuse("invalid-request");
    // Caller/callback mutation must not retarget an in-flight request.
    options = { ...options, selector: { ...options.selector } };
    const timeout = options.timeoutMs ?? MAX_TIME;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIME ||
      (options.testContainmentBackend || options.testRecoveryEvidence || options.testBeforeReceiptRegistration) && !process.env.NODE_TEST_CONTEXT ||
      options.testRecoveryEvidence && !options.testContainmentBackend) refuse("invalid-request");
    const selection = freezeSelection(await selectCanonicalGitResources(options.selector));
    cwd = selection.cwd;
    if (gitCheckRunningCheckouts().has(cwd)) refuse("running");
    gitCheckRunningCheckouts().add(cwd);
    launched = true; // owns only the liveness set; supervisor owns durable quarantine
    const authorityStamp = options.readAuthorityRevisionSync ? readGitCheckAuthorityStamp(options.readAuthorityRevisionSync) : undefined;
    const liveAccess = async () => {
      if (options.signal?.aborted || !await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot)) refuse("denied");
      await revalidateGitProjectResources(selection);
    };
    await liveAccess();
    const policy = await savedPolicy(options, selection), recipe = policy.settings.checks[options.checkIndex];
    if (!recipe) refuse("invalid-request");
    const normalized = normalizeGitCheckRecipe(recipe);
    if (normalized.requiredStage !== options.stage) refuse("invalid-request");
    const policyDigest = hash(JSON.stringify(policy.settings));
    const env = environment(normalized), envDigest = environmentDigest(env);
    const baseEnvironmentDigest = environmentDigest(sanitizeProjectCommandEnvironment(gitExecEnv()));
    const cohort = hash(JSON.stringify({ kind: "selected-v2", sessionId: options.sessionId, policyDigest,
      policyRevision: policy.policyRevision, stage: options.stage, baseEnvironmentDigest }));
    const execution = await physicalCwd(cwd, normalized.cwd);
    const binding: GitCheckoutCheckBinding = { recipe, checkIndex: options.checkIndex, stage: options.stage,
      policyDigest, policyRevision: policy.policyRevision, environmentDigest: envDigest };
    const snapshot = Object.freeze(await captureGitCheckoutCheckRecoverySnapshot(selection, binding, true));
    const candidate = Object.freeze({ selection, checkIndex: options.checkIndex, stage: options.stage,
      policyDigest, policyRevision: policy.policyRevision, recipeDigest: snapshot.recipeDigest, snapshot });
    const validateAuthority = async () => {
      await liveAccess();
      const current = await savedPolicy(options, selection);
      if (current.policyRevision !== policy.policyRevision || hash(JSON.stringify(current.settings)) !== policyDigest ||
        environmentDigest(environment(normalized)) !== envDigest || !await options.isActorAuthorized(candidate) ||
        !await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot) || options.signal?.aborted) refuse("stale");
    };
    const assertAuthoritySync = () => {
      if (options.readAuthorityRevisionSync) {
        if (readGitCheckAuthorityStamp(options.readAuthorityRevisionSync) !== authorityStamp) refuse("stale");
      } else {
        // Compatibility ONLY for genuinely synchronous live callbacks. Never
        // treat resolved async answers as a final revision/authorization fence.
        if (gitCheckSyncValue(options.isActorAuthorized(candidate)) !== true ||
          gitCheckSyncValue(options.isSelectionAuthorized(selection)) !== true ||
          gitCheckSyncValue(options.isTrusted(selection.projectRoot)) !== true) refuse("stale");
        const current = policyValue(gitCheckSyncValue(options.getPolicy(selection)));
        if (current.policyRevision !== policy.policyRevision || hash(JSON.stringify(current.settings)) !== policyDigest) refuse("stale");
      }
      if (options.signal?.aborted || environmentDigest(environment(normalized)) !== envDigest) refuse("stale");
    };
    const assertCurrentSync = () => {
      if (JSON.stringify(captureSnapshotSync(selection, binding)) !== JSON.stringify(snapshot)) refuse("stale");
      assertAuthoritySync();
    };
    const revalidate = async () => {
      await validateAuthority();
      await captureGitCheckoutCheckRecoverySnapshot(selection, binding, true);
      await validateAuthority();
      // All awaited authority reads precede the authoritative source capture.
      const current = captureSnapshotSync(selection, binding);
      assertAuthoritySync();
      return current;
    };
    // Authorization is independent of preferences and availability, including
    // when checkConfirmation:none is selected. No callback defaults to Allow.
    await revalidate();
    const backend = options.testContainmentBackend ?? linuxSystemdBackend, unit = newGitCheckUnit();
    if (process.platform !== "linux" || !await backend.absent(unit, 2_000)) refuse();
    await fs.mkdir(options.agentDir, { recursive: true, mode: 0o700 });
    const agent = await fs.lstat(options.agentDir);
    if (!agent.isDirectory() || agent.isSymbolicLink() || (agent.mode & 0o077) !== 0 ||
      !samePath(options.agentDir, await fs.realpath(options.agentDir))) refuse();
    await assertGitOperationAdmission(selection, options.agentDir, options.actionId);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    // Live pause/revocation must stop a long check, not merely reject its eventual
    // receipt. Callbacks still do not grant anything or weaken containment.
    let polling = false;
    let pendingPoll: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      pendingPoll = (async () => {
        try {
          const current = await savedPolicy(options, selection);
          if (current.policyRevision !== policy.policyRevision || hash(JSON.stringify(current.settings)) !== policyDigest ||
            !await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot) ||
            !await options.isActorAuthorized(candidate) || environmentDigest(environment(normalized)) !== envDigest) abort();
        } catch { abort(); }
        finally { polling = false; }
      })();
    }, 100);
    let result: Awaited<ReturnType<typeof superviseGitCheck>>;
    try {
      supervising = true;
      result = await superviseGitCheck({ selection, agentDir: options.agentDir, actionId: options.actionId ?? randomUUID(),
        unit, before: snapshot, cwd: execution.cwd, argv: normalized.argv, env, timeoutMs: timeout, signal: controller.signal,
        backend, testRecoveryEvidence: options.testRecoveryEvidence, revalidate, assertCurrentSync,
        captureAfter: () => captureGitCheckoutCheckRecoverySnapshot(selection, binding),
        beforeResolve: async () => { clearInterval(timer); await pendingPoll; } });
    } finally {
      clearInterval(timer);
      options.signal?.removeEventListener("abort", abort);
      await pendingPoll;
    }
    if (controller.signal.aborted) refuse("stale");
    await options.testBeforeReceiptRegistration?.();
    assertCurrentSync();
    const { settlement, ...receiptResult } = result;
    const receipt: GitCheckoutVerificationReceipt = Object.freeze({ ...candidate, kind: "selected-checkout-verification", version: 2,
      ...receiptResult, sessionId: options.sessionId, executionCwd: execution.cwd, snapshotDigest: hash(JSON.stringify(snapshot)),
      environmentDigest: envDigest, expiresAt: result.finishedAt + RECEIPT_MS, exitStatus: 0 });
    registerGitCheckReceiptEpoch(receipt.id, options.agentDir, selection.commonDir, { cohort, settlement, snapshot });
    receipts().set(receipt.id, receipt);
    return receipt;
  } catch (error) {
    if (error instanceof GitCheckoutVerificationError && !supervising) throw error;
    // Never expose callback/OS stderr, environment values, argv or check logs.
    return refuse(supervising ? "recovery-required" : "unavailable");
  } finally { if (launched && cwd) gitCheckRunningCheckouts().delete(cwd); }
}

/** Fresh-use validation is mandatory. Lookup alone is not admission or authority.
 * The receipt cannot be consumed through legacy paired integration lookup. */
export async function validateGitCheckoutVerificationReceipt(id: string, options: GitCheckoutVerificationOptions): Promise<GitCheckoutVerificationReceipt> {
  const receipt = lookupGitCheckoutVerificationReceipt(id);
  if (!receipt || receipt.sessionId !== options.sessionId || receipt.checkIndex !== options.checkIndex || receipt.stage !== options.stage) refuse("stale");
  try {
    const authorityStamp = options.readAuthorityRevisionSync ? readGitCheckAuthorityStamp(options.readAuthorityRevisionSync) : undefined;
    const selection = await selectCanonicalGitResources(options.selector);
    if (JSON.stringify(selection) !== JSON.stringify(receipt.selection) || options.signal?.aborted ||
      !await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot) ||
      !await options.isActorAuthorized(receipt)) refuse("stale");
    const policy = await savedPolicy(options, selection), recipe = policy.settings.checks[options.checkIndex];
    if (!recipe || policy.policyRevision !== receipt.policyRevision || hash(JSON.stringify(policy.settings)) !== receipt.policyDigest) refuse("stale");
    await assertGitOperationAdmission(selection, options.agentDir, options.actionId);
    const snapshot = await captureGitCheckoutCheckRecoverySnapshot(selection, { recipe, checkIndex: options.checkIndex, stage: options.stage,
      policyDigest: receipt.policyDigest, policyRevision: receipt.policyRevision,
      environmentDigest: environmentDigest(environment(normalizeGitCheckRecipe(recipe))) }, true);
    const finalPolicy = await savedPolicy(options, selection);
    if (hash(JSON.stringify(snapshot)) !== receipt.snapshotDigest || finalPolicy.policyRevision !== receipt.policyRevision ||
      hash(JSON.stringify(finalPolicy.settings)) !== receipt.policyDigest || options.signal?.aborted ||
      !await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot) ||
      !await options.isActorAuthorized(receipt) ||
      environmentDigest(environment(normalizeGitCheckRecipe(recipe))) !== receipt.environmentDigest ||
      !lookupGitCheckoutVerificationReceipt(id)) refuse("stale");
    const synchronous = captureSnapshotSync(selection, { recipe, checkIndex: options.checkIndex, stage: options.stage,
      policyDigest: receipt.policyDigest, policyRevision: receipt.policyRevision, environmentDigest: receipt.environmentDigest });
    if (hash(JSON.stringify(synchronous)) !== receipt.snapshotDigest) refuse("stale");
    if (!options.readAuthorityRevisionSync) {
      if (gitCheckSyncValue(options.isActorAuthorized(receipt)) !== true || gitCheckSyncValue(options.isSelectionAuthorized(selection)) !== true ||
        gitCheckSyncValue(options.isTrusted(selection.projectRoot)) !== true) refuse("stale");
      const current = policyValue(gitCheckSyncValue(options.getPolicy(selection)));
      if (current.policyRevision !== receipt.policyRevision || hash(JSON.stringify(current.settings)) !== receipt.policyDigest) refuse("stale");
    } else if (readGitCheckAuthorityStamp(options.readAuthorityRevisionSync) !== authorityStamp) refuse("stale");
    if (options.signal?.aborted || environmentDigest(environment(normalizeGitCheckRecipe(recipe))) !== receipt.environmentDigest || !lookupGitCheckoutVerificationReceipt(id)) refuse("stale");
    return receipt;
  } catch { refuse("stale"); }
}
