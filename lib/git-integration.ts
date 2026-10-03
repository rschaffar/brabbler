import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fsSync, { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { readGitAction } from "./git-action-journal";
import { assertGitOperationAdmission, inspectGitOperationAdmission, readGitOperationReservationOwner,
  type GitOperationReservation } from "./git-operation-admission";
import { selectGitProjectResources, revalidateGitProjectResources, withGitProjectReview, type GitProjectResources } from "./git-project-resources";
import { verifyGitPreparationTrackedContents, GIT_PREPARATION_TRACKED_CONTENT_LIMITS,
  type GitPreparationTrackedContents } from "./git-preparation";
import { getGitTreeDiff, reviewGitBranches, type GitReview, type GitReviewDiff } from "./git-review";
import { lookupGitVerificationReceipt } from "./git-verification";
import { validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath, toNativePath } from "./paths";
import { acquireGitCheckoutGate } from "./git-checkout-gate";
import { normalizeGitCheckRecipe } from "./git-check-recipe";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import { lookupGitCheckoutVerificationReceipt, validateGitCheckoutVerificationReceipt, selectGitCheckoutVerificationChecks,
  captureGitCheckoutCheckRecoverySnapshot, type GitCheckoutVerificationReceipt } from "./git-checkout-verification";
import { validateGitWorkflowSettings, validateGitWorkflowOverrides, projectPolicyBranches } from "./git-workflow-settings";
import type { SelectedIntegrationOptions, SelectedIntegrationPlanContext, SelectedIntegrationPlan,
  SelectedIntegrationNativeCompletion, SelectedIntegrationNativeOutcome, SelectedIntegrationResult, SelectedIntegrationAuthorizationPostguard,
  SelectedIntegrationNativeTargetMove } from "./git-selected-integration";

const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TTL = 15 * 60_000;
const key = Symbol.for("pi-web:git-integration:plans");
const hooksKey = Symbol.for("pi-web:git-integration:disabled-hooks");
async function disabledHooks(): Promise<string> {
  const global = globalThis as unknown as Record<symbol, Promise<string> | undefined>;
  // A private empty directory, not /dev/null (not portable to Windows). All commands,
  // including update-ref, must use it: a hook may appear after the safety snapshot.
  return global[hooksKey] ??= fs.mkdtemp(path.join(tmpdir(), "pi-web-integration-hooks-"));
}
type NativeOptions = IntegrationOptions | (Omit<IntegrationOptions, "getPolicy"> & { selected: SelectedIntegrationOptions });
type Saved = { options: NativeOptions; plan: IntegrationPlan; policyDigest: string; featureIndex: string; targetIndex: string; targetIndexPath: string; repo: string; selection: GitProjectResources; targetSelection: GitProjectResources; admissionEpoch: string; selectedRefsDigest?: string; selectedSourceConfigDigest?: string; sourceTracked?: SourceTracked; admissionHistory?: AdmissionHistory; authorityPostguard?: SelectedIntegrationAuthorizationPostguard; authorityRevision?: string };
type FFSaved = Omit<Saved, "plan"> & { plan: FastForwardIntegrationPlan };
type Plans = { pending: Map<string, Saved>; ffPending: Map<string, FFSaved>; busy: Set<string> };
function plans(): Plans {
  const global = globalThis as unknown as Record<symbol, Plans | undefined>;
  const state = global[key] ??= { pending: new Map(), ffPending: new Map(), busy: new Set() };
  // Hot reload may retain an older global store created before the FF variant.
  state.ffPending ??= new Map();
  return state;
}
/** Release of a failed check cannot leave an earlier process-local merge plan
 * executable. An active preparation/apply must finish before recovery starts. */
export function invalidateGitIntegrationPlansForResource(commonDir: string): void {
  if (plans().busy.has(commonDir)) throw new Error("Git integration is active; recovery unavailable");
  for (const [id, saved] of plans().pending) if (saved.repo === commonDir) plans().pending.delete(id);
  for (const [id, saved] of plans().ffPending) if (saved.repo === commonDir) plans().ffPending.delete(id);
}
function fail(reason: string): never { throw new Error(`Git integration unavailable: ${reason}`); }
function hash(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
async function git(cwd: string, args: string[], index?: string, input?: string, launchGuard?: () => void): Promise<string> {
  try {
    // Even a cached hooks Promise yields. Finish ALL launch preparation before
    // the last synchronous live-authority/owned-intent assertion and execFile.
    const hooks = await disabledHooks();
    const nativeArgs = ["--no-optional-locks", "-C", cwd, "-c", "core.fsmonitor=false",
      "-c", `core.hooksPath=${hooks}`, ...args];
    const nativeOptions = { encoding: "utf8" as const,
      env: { ...gitExecEnv(index), GIT_NO_REPLACE_OBJECTS: "1", GIT_PAGER: "cat" },
      timeout: 30_000, maxBuffer: 8 * 1024 * 1024 };
    launchGuard?.();
    // No await (or external callback) between the guard and actual child creation.
    const running = exec("git", nativeArgs, nativeOptions);
    running.child.stdin?.end(input);
    const { stdout } = await running;
    return stdout;
  } catch {
    // Git stderr may contain file contents, config values or local credentials.
    fail("Git command failed; inspect checkout manually");
  }
}
async function root(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd) || !samePath(cwd, await fs.realpath(cwd))) fail("physical checkout root required");
  if (!samePath(toNativePath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()), cwd)) fail("checkout root required");
  return cwd;
}
async function registered(cwd: string, feature: string, target: string): Promise<string> {
  let location = "";
  let found = false;
  let targetPath = "";
  for (const line of (await git(cwd, ["worktree", "list", "--porcelain", "-z"])).split("\0")) {
    if (line.startsWith("worktree ")) location = toNativePath(line.slice(9));
    if (line === `branch refs/heads/${feature}` && samePath(location, cwd)) found = true;
    if (line === `branch refs/heads/${target}`) {
      if (targetPath) fail("ambiguous target checkout");
      targetPath = location;
    }
  }
  if (!found || !targetPath || samePath(cwd, targetPath)) fail("distinct registered feature and target worktrees required");
  return root(targetPath);
}
async function repository(cwd: string): Promise<string> {
  const common = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  return await fs.realpath(common);
}
async function policySafety(cwd: string): Promise<void> {
  const config = await git(cwd, ["config", "--list", "--null"]);
  const effective = new Map<string, string>();
  const safeHooks = await disabledHooks();
  for (const record of config.split("\0")) {
    const [raw, value] = record.split("\n", 2);
    if (raw?.toLowerCase() === "core.hookspath" && value !== safeHooks) fail("unsupported Git configuration: core.hookspath");
    if (raw) effective.set(raw.toLowerCase(), value);
  }
  for (const [name, value] of effective) {
    if (name === "core.fsmonitor" && value === "false") continue;
    if (name === "core.hookspath" && value === safeHooks) continue;
    if (/^(filter\.|merge\.|core\.(hookspath|fsmonitor|splitindex|sparsecheckout|attributesfile|worktree|ignorecase|protecthfs|protectntfs)|index\.|extensions\.)/.test(name) ||
        (name === "commit.gpgsign" && value !== "false") || name === "core.autocrlf" && value !== "false" ||
        name === "core.eol" || name === "core.symlinks" && value === "false") fail(`unsupported Git configuration: ${name}`);
  }
  // --git-path hooks would resolve to our forced empty hooksPath, hiding
  // configured default hooks. Inspect the repository's common hooks as well.
  const hooks = path.join(await repository(cwd), "hooks");
  for (const name of await fs.readdir(hooks).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  })) {
    if (name.endsWith(".sample")) continue;
    const info = await fs.lstat(path.join(hooks, name));
    if (info.isFile() || info.isSymbolicLink()) fail("hooks unsupported");
  }
  // Attributes and custom conversion/merge behavior cannot be proven identical to the reviewed tree.
  if ((await git(cwd, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\n").some((p) => p === ".gitattributes" || p.endsWith("/.gitattributes"))) fail("attributes unsupported");
  const info = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "info/attributes"])).trim());
  if (await fs.stat(info).then(() => true, () => false)) fail("attributes unsupported");
}
interface Checkout { indexPath: string; digest: string }
const operationMarkers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START"] as const;
async function assertNoGitOperation(cwd: string): Promise<void> {
  // Worktree-local markers must be lstat'd relative to the Git directory: an
  // absolute --git-path for an individual marker can dereference a symlink.
  const metadata = toNativePath((await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim());
  if (!samePath(metadata, await fs.realpath(metadata))) fail("physical Git directory required");
  for (const marker of operationMarkers) {
    try { await fs.lstat(path.join(metadata, marker)); fail("unfinished Git operation state"); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
}
async function checkout(cwd: string, branch: string, oid: string, ownedIndex?: string): Promise<Checkout> {
  await root(cwd);
  await assertNoGitOperation(cwd);
  await policySafety(cwd);
  if ((await git(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${branch}` ||
      (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim() !== oid ||
      (await git(cwd, ["show-ref", "--verify", "--hash", `refs/heads/${branch}`])).trim() !== oid) fail("checkout or branch moved");
  const indexPath = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
  if (ownedIndex && !samePath(indexPath, ownedIndex)) fail("index path changed");
  if (!ownedIndex && await fs.stat(`${indexPath}.lock`).then(() => true, () => false)) fail("index locked");
  const digest = hash(await fs.readFile(indexPath));
  if ((await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) !== "" ||
      (await git(cwd, ["ls-files", "-v", "-z"])).split("\0").some((p) => p && !p.startsWith("H ")) ||
      (await git(cwd, ["ls-files", "-u", "-z"])) !== "") fail("dirty checkout or nonstandard index flags");
  return { indexPath, digest };
}
function equalReview(a: GitReview, b: GitReview): boolean {
  return a.featureBranch === b.featureBranch && a.targetBranch === b.targetBranch &&
    a.featureOid === b.featureOid && a.targetOid === b.targetOid && a.featureTreeOid === b.featureTreeOid &&
    a.targetTreeOid === b.targetTreeOid && a.mergeTreeOid === b.mergeTreeOid &&
    JSON.stringify(a.commits) === JSON.stringify(b.commits);
}
export interface IntegrationOptions {
  sessionId: string;
  cwd: string;
  agentDir: string;
  featureBranch: string;
  receiptIds: readonly string[];
  getPolicy: () => GitWorkflowPolicy | null | undefined | Promise<GitWorkflowPolicy | null | undefined>;
  /** Test seam: invoked after read-tree begins; failures are always partial-state. */
  afterCheckout?: () => void | Promise<void>;
}
export interface IntegrationPlan {
  planId: string;
  sessionId: string;
  review: GitReview;
  diff: GitReviewDiff;
  receiptIds: string[];
  mergeOid: string;
  message: string;
  expiresAt: number;
  selectedContext?: SelectedIntegrationPlanContext;
}
export type IntegrationResult = { status: "integrated"; mergeOid: string; targetBranch: string } |
  { status: "partial-state"; mergeOid: string; targetBranch: string; recoveryPath: string; reason: string };
/** FF has no synthetic commit, author or merge message. The destination becomes the existing feature tip. */
export interface FastForwardIntegrationPlan {
  method: "ff";
  planId: string;
  sessionId: string;
  review: GitReview;
  diff: GitReviewDiff;
  receiptIds: string[];
  featureOid: string;
  treeOid: string;
  parents: string[];
  expiresAt: number;
  selectedContext?: SelectedIntegrationPlanContext;
}
export type FastForwardIntegrationResult =
  | { status: "integrated"; method: "ff"; featureOid: string; treeOid: string; parents: string[]; targetBranch: string }
  | { status: "partial-state"; method: "ff"; featureOid: string; treeOid: string; parents: string[]; targetBranch: string; recoveryPath: string; reason: string };
export type LocalIntegrationPlan = IntegrationPlan | FastForwardIntegrationPlan;
export type LocalIntegrationResult = IntegrationResult | FastForwardIntegrationResult;
/** Only a proven pre-apply change to the exact approved target ref has this code. */
export class GitIntegrationTargetMovedError extends Error {
  readonly code = "target_moved" as const;
  constructor() { super("Approved target ref moved before apply; refresh review and obtain a new approval"); }
}
const targetMoveKind = Symbol("native-selected-target-move");
const nativeTargetMoves = new WeakMap<object, SelectedIntegrationNativeTargetMove>();
export function readSelectedIntegrationNativeTargetMove(value: unknown): SelectedIntegrationNativeTargetMove | undefined {
  const proof = value && typeof value === "object" ? nativeTargetMoves.get(value) : undefined;
  return proof ? structuredClone(proof) : undefined;
}
function targetMovedError(saved: Saved | FFSaved, observedTargetOid: string, otherState: string): GitIntegrationTargetMovedError {
  const error = new GitIntegrationTargetMovedError();
  if ("selected" in saved.options) {
    // Last actual-byte read, after the diagnostic Promise has returned. No await
    // or external callback between this immutable-baseline assertion and issuance.
    assertSourceTracked(saved.selection, saved.sourceTracked);
    Object.defineProperty(error, targetMoveKind, { value: true });
    nativeTargetMoves.set(error, { kind: "selected-integration-target-moved", code: "target_moved",
      planId: saved.plan.planId, sessionId: saved.options.sessionId, context: structuredClone(saved.plan.selectedContext!),
      featureOid: saved.plan.review.featureOid, previousTargetOid: saved.plan.review.targetOid, observedTargetOid,
      otherStateBefore: otherState, otherStateAfter: otherState, noEffect: true });
  }
  return error;
}
async function policyOf(options: IntegrationOptions, method: "merge" | "ff" = "merge"): Promise<{ policy: GitWorkflowPolicy; digest: string }> {
  const input = await options.getPolicy();
  if (!input) fail("saved policy required");
  const policy = validateGitWorkflowPolicy(input);
  if (policy.integration?.method !== method) {
    if (method === "merge") fail("only ordinary unsigned merge supported (ff/squash unsupported)");
    fail("ff-only requires an explicit saved ff policy (squash unsupported)");
  }
  if (policy.mode === "current" && policy.branch && policy.branch !== options.featureBranch) fail("feature branch differs from policy");
  return { policy, digest: hash(JSON.stringify(policy)) };
}
function receipts(options: IntegrationOptions, review: GitReview, digest: string, target: string): void {
  const expected = options.receiptIds;
  if (!Array.isArray(expected) || !expected.length || expected.length !== new Set(expected).size) fail("all configured verification receipts required");
  for (let i = 0; i < expected.length; i++) {
    const r = lookupGitVerificationReceipt(expected[i]);
    if (!r || r.checkIndex !== i || r.sessionId !== options.sessionId || !samePath(r.cwd, options.cwd) ||
        !samePath(r.targetCwd, target) || r.featureBranch !== review.featureBranch || r.targetBranch !== review.targetBranch ||
        r.featureOid !== review.featureOid || r.targetOid !== review.targetOid || r.featureTreeOid !== review.featureTreeOid ||
        r.targetTreeOid !== review.targetTreeOid || r.mergeTreeOid !== review.mergeTreeOid || r.policyDigest !== digest ||
        r.exitStatus !== 0 || !Number.isSafeInteger(r.finishedAt) || r.finishedAt > Date.now() ||
        Date.now() - r.finishedAt > TTL) fail("missing, failed, expired or stale verification receipt");
  }
}
async function selectedPolicy(options: SelectedIntegrationOptions) {
  const input = await options.getPolicy(options.source);
  if (!input || typeof input.policyRevision !== "string" || !input.policyRevision || input.policyRevision.length > 512 ||
      /[\x00-\x1f\x7f]/.test(input.policyRevision)) fail("saved selected policy revision required");
  const settings = validateGitWorkflowSettings(input.settings);
  const project = validateGitWorkflowOverrides(input.savedProjectSettings);
  if (!settings.enabled || settings.delivery !== "local" || project.delivery !== undefined && project.delivery !== "local" ||
      settings.integrateConfirmation === "disabled" || !["ff", "merge"].includes(settings.method) ||
      project.method !== settings.method || project.targetBranch === undefined || project.targetBranch === null ||
      project.targetBranch !== settings.targetBranch || project.targetBranch === ":project-main" && project.mainBranch !== settings.mainBranch) {
    fail("explicit saved Project local target and ff/merge method required");
  }
  const targetBranch = projectPolicyBranches(settings).target;
  if (!targetBranch || targetBranch !== options.target.branch || options.source.branch === targetBranch ||
      !samePath(options.source.projectRoot, options.target.projectRoot) ||
      !samePath(options.source.commonDir, options.target.commonDir) || samePath(options.source.cwd, options.target.cwd)) fail("selected resources differ from saved target");
  return { policyRevision: input.policyRevision, settings, targetBranch,
    policyDigest: hash(JSON.stringify(settings)), savedProjectDigest: hash(JSON.stringify(project)) };
}
async function selectedContext(options: SelectedIntegrationOptions): Promise<SelectedIntegrationPlanContext> {
  const p = await selectedPolicy(options);
  const checks = selectGitCheckoutVerificationChecks(p.settings.checks, "integration");
  return { kind: "selected-local", version: 1, source: structuredClone(options.source), target: structuredClone(options.target),
    policyRevision: p.policyRevision, policyDigest: p.policyDigest, savedProjectDigest: p.savedProjectDigest,
    method: p.settings.method as "ff" | "merge", targetRef: `refs/heads/${p.targetBranch}`, sourceRef: `refs/heads/${options.source.branch}`,
    checkStatus: checks.status, checkIndexes: [...checks.checkIndexes], receiptIds: [...options.receiptIds], repositoryChecksWaived: false };
}
async function selectedAuthorization(options: SelectedIntegrationOptions, phase: "prepare" | "before-checkout" | "before-ref-cas",
  context: SelectedIntegrationPlanContext, plan: LocalIntegrationPlan, epoch: string): Promise<SelectedIntegrationAuthorizationPostguard> {
  if (JSON.stringify(await selectedContext(options)) !== JSON.stringify(context)) fail("selected policy or context changed");
  for (const selection of [options.source, options.target]) {
    await revalidateGitProjectResources(selection);
    if (!await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot)) fail("selected access revoked");
  }
  if (Date.now() >= plan.expiresAt) fail("selected plan expired");
  const postguard = await options.authorize(phase, structuredClone({ context, planId: plan.planId, expiresAt: plan.expiresAt, admissionEpoch: epoch,
    sourceOid: plan.review.featureOid, targetOid: plan.review.targetOid, treeOid: plan.review.featureTreeOid,
    resultOid: "method" in plan ? plan.featureOid : plan.mergeOid,
    parents: "method" in plan ? plan.parents : [plan.review.targetOid, plan.review.featureOid] }));
  if (postguard !== undefined && (typeof postguard !== "function" || postguard.constructor.name === "AsyncFunction")) fail("synchronous authorization postguard required");
  if (JSON.stringify(await selectedContext(options)) !== JSON.stringify(context) || Date.now() >= plan.expiresAt) fail("selected policy changed or plan expired during authorization");
  // Missing guards from untyped adapters are rejected at capture/effect assertion.
  // They never acquire a void fallback, even when every async probe passed.
  return postguard;
}
function assertSelectedAuthorizationPostguard(postguard: SelectedIntegrationAuthorizationPostguard | undefined): void {
  if (typeof postguard !== "function" || postguard.constructor.name === "AsyncFunction") fail("live synchronous authorization postguard required");
  if (postguard() !== undefined) fail("authorization postguard must be synchronous and return void");
}
function selectedAuthorityRevision(options: SelectedIntegrationOptions): string {
  const revision = options.readAuthorityRevisionSync();
  if (typeof revision !== "string" || !revision || revision.length > 4096 || /[\x00-\x1f\x7f]/.test(revision)) fail("trusted synchronous authority revision required");
  return revision;
}
function assertSelectedAuthorityRevision(saved: Saved | FFSaved): void {
  if (!("selected" in saved.options) || !saved.authorityRevision || selectedAuthorityRevision(saved.options.selected) !== saved.authorityRevision) fail("captured live authority revision changed or unavailable");
}
function selectedLaunchGuard(saved: Saved | FFSaved, postguard: SelectedIntegrationAuthorizationPostguard,
  admission: GitOperationReservation): () => void {
  return () => {
    assertSelectedAuthorizationPostguard(postguard);
    assertSelectedAuthorizationPostguard(saved.authorityPostguard); // The plan's original authority version, not a fresh Allow.
    assertSelectedAuthorityRevision(saved);
    if (Date.now() >= saved.plan.expiresAt) fail("selected plan expired before launch");
    assertSourceTracked(saved.selection, saved.sourceTracked);
    assertIntegrationIntent(admission, saved.options.agentDir, saved.repo, saved.selection); // Synchronous owned assertion LAST.
  };
}
async function selectedPlanExpiry(options: SelectedIntegrationOptions): Promise<number> {
  const rows = await selectedReceiptRows(options, await selectedContext(options));
  return Math.min(Date.now() + TTL, ...rows.map((r) => r.expiresAt));
}
async function integrationPolicy(options: NativeOptions, method: "merge" | "ff") {
  if ("selected" in options) {
    const context = await selectedContext(options.selected);
    if (context.method !== method) fail("saved selected method changed");
    return { targetBranch: options.selected.target.branch, digest: hash(JSON.stringify(context)) };
  }
  const { policy, digest } = await policyOf(options, method);
  if (!policy.checks?.length || policy.checks.length !== options.receiptIds.length) fail("every configured check must have a receipt");
  return { targetBranch: policy.integration!.targetBranch, digest };
}
async function selectedReceiptRows(options: SelectedIntegrationOptions, context: SelectedIntegrationPlanContext,
  ownedReceipts?: readonly GitCheckoutVerificationReceipt[]) {
  if (!Array.isArray(options.receiptIds) || options.receiptIds.length !== new Set(options.receiptIds).size ||
      options.receiptIds.length !== context.checkIndexes.length) fail("all selected integration-stage receipts required");
  const rows = options.receiptIds.map((id) => ownedReceipts ? ownedReceipts.find((r) => r.id === id) : lookupGitCheckoutVerificationReceipt(id));
  const indexes = new Set<number>();
  for (const r of rows) {
    if (!r || r.kind !== "selected-checkout-verification" || r.version !== 2 || r.exitStatus !== 0 ||
        r.sessionId !== options.sessionId || r.stage !== "integration" || !context.checkIndexes.includes(r.checkIndex) ||
        indexes.has(r.checkIndex) || JSON.stringify(r.selection) !== JSON.stringify(options.source) ||
        r.policyDigest !== context.policyDigest || r.policyRevision !== context.policyRevision ||
        !Number.isSafeInteger(r.finishedAt) || r.finishedAt > Date.now() || Date.now() >= r.expiresAt) fail("foreign, stale or stage-mismatched selected receipt");
    indexes.add(r.checkIndex);
  }
  return rows as NonNullable<(typeof rows)[number]>[];
}
function selectedEnvironmentDigest(recipe: unknown): string {
  const env = sanitizeProjectCommandEnvironment({ ...gitExecEnv(), ...normalizeGitCheckRecipe(recipe).env });
  return hash(JSON.stringify(Object.entries(env).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
}
async function selectedReceipts(options: SelectedIntegrationOptions, ownedIndex?: string,
  targetMove?: { oldOid: string; currentOid: string; targetBranch: string },
  ownedReceipts?: readonly GitCheckoutVerificationReceipt[],
  postValidation?: { context: SelectedIntegrationPlanContext; checkActor: false }): Promise<void> {
  const context = await selectedContext(options), p = await selectedPolicy(options);
  if (postValidation && (JSON.stringify(context) !== JSON.stringify(postValidation.context) ||
      p.policyDigest !== context.policyDigest || p.policyRevision !== context.policyRevision || p.savedProjectDigest !== context.savedProjectDigest)) fail("selected policy changed after authorization");
  for (const r of await selectedReceiptRows(options, context, ownedReceipts)) {
    // Actor readers are external awaits too. Run them BEFORE the final snapshot,
    // or let the post-authorization pass check actors before access readers.
    if (!postValidation && !await options.isCheckAuthorized(r)) fail("selected check authority revoked");
    if (!ownedIndex && !targetMove) {
      await validateGitCheckoutVerificationReceipt(r.id, { sessionId: options.sessionId, agentDir: options.agentDir,
        selector: { repositoryPath: options.source.projectRoot, checkoutPath: options.source.cwd, workspaceBranch: options.source.branch },
        checkIndex: r.checkIndex, stage: "integration", getPolicy: async () => {
          const current = await selectedPolicy(options);
          return { settings: current.settings, policyRevision: current.policyRevision };
        }, isTrusted: options.isTrusted, isSelectionAuthorized: options.isSelectionAuthorized, isActorAuthorized: options.isCheckAuthorized,
        readAuthorityRevisionSync: options.readAuthorityRevisionSync });
    } else {
      // A target-primary index lock also appears in a linked source's common-dir marker scan.
      // Permit ONLY our owned lock, not a generic dirty/marker bypass. All other snapshot fields remain exact.
      const snapshot = await captureGitCheckoutCheckRecoverySnapshot(options.source, { recipe: p.settings.checks[r.checkIndex],
        checkIndex: r.checkIndex, stage: "integration", policyDigest: p.policyDigest, policyRevision: p.policyRevision,
        environmentDigest: selectedEnvironmentDigest(p.settings.checks[r.checkIndex]) });
      const markerNames = ["index.lock", "HEAD.lock", ...operationMarkers];
      for (const dir of new Set([options.source.gitDir, options.source.commonDir])) for (const name of markerNames) {
        const file = path.join(dir, name);
        if (ownedIndex && samePath(file, `${ownedIndex}.lock`)) continue;
        if (await fs.lstat(file).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e; })) fail("source operation marker changed");
      }
      const rawGit = async (args: string[]) => (await exec("git", ["--no-optional-locks", "-C", options.source.cwd,
        `--git-dir=${options.source.gitDir}`, `--work-tree=${options.source.cwd}`, "-c", "core.fsmonitor=false", ...args], {
        encoding: "utf8", env: { ...gitExecEnv(), GIT_COMMON_DIR: options.source.commonDir, GIT_NO_REPLACE_OBJECTS: "1",
          GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", GIT_ALLOW_PROTOCOL: "" }, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
      snapshot.status = hash(JSON.stringify({ status: await rawGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        flags: await rawGit(["ls-files", "-v", "-z"]), config: hash(await rawGit(["config", "--list", "--null"])), marker: [] }));
      if (targetMove) {
        const refs = await rawGit(["show-ref", "--head"]);
        const currentRow = `${targetMove.currentOid} refs/heads/${targetMove.targetBranch}\n`;
        if (!refs.includes(currentRow)) fail("target movement not positively observed");
        snapshot.refs = hash(refs.replace(currentRow, `${targetMove.oldOid} refs/heads/${targetMove.targetBranch}\n`));
      }
      if (hash(JSON.stringify(snapshot)) !== r.snapshotDigest ||
          (!ownedReceipts && !lookupGitCheckoutVerificationReceipt(r.id)) || Date.now() >= r.expiresAt) fail("selected receipt snapshot changed");
    }
  }
}
async function integrationReceipts(options: NativeOptions, review: GitReview, digest: string, targetCwd: string, ownedIndex?: string) {
  if ("selected" in options) await selectedReceipts(options.selected, ownedIndex);
  else receipts(options, review, digest, targetCwd);
}
type SourceTracked = { verified: GitPreparationTrackedContents; entries: { path: string; mode: string; blob: string; size: number }[] };
async function captureSourceTracked(selection: GitProjectResources, treeOid: string, indexDigest: string): Promise<SourceTracked> {
  return withGitProjectReview(selection, async (repo) => {
    if (typeof repo === "string") fail("pinned source required");
    const verified = await verifyGitPreparationTrackedContents(repo, treeOid);
    if (verified.indexDigest !== indexDigest) fail("physical source index changed");
    const { stdout } = await exec("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
      "ls-tree", "-r", "-l", "-z", treeOid], { encoding: "utf8", timeout: 15000, maxBuffer: GIT_PREPARATION_TRACKED_CONTENT_LIMITS.listingBytes,
      env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" } });
    if (stdout && !stdout.endsWith("\0")) fail("physical source inventory incomplete");
    const entries = stdout.split("\0").filter(Boolean).map((row) => {
      const match = /^(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64}) +(\d+)\t(.+)$/.exec(row);
      if (!match) fail("physical source inventory unsupported");
      const parts = match[4].split("/"), size = Number(match[3]);
      if (!Number.isSafeInteger(size) || size > (match[1] === "120000" ? GIT_PREPARATION_TRACKED_CONTENT_LIMITS.symlinkBytes : GIT_PREPARATION_TRACKED_CONTENT_LIMITS.fileBytes)) fail("physical source size unsupported");
      if (Buffer.byteLength(match[4]) > 4096 || parts.length > GIT_PREPARATION_TRACKED_CONTENT_LIMITS.depth ||
          /[\x00-\x1f\x7f]/.test(match[4]) || parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || part === ".gitattributes")) fail("physical source path unsupported");
      return { path: match[4], mode: match[1], blob: match[2], size };
    });
    // These are the ORIGINAL exact-tree records authenticated by the shared
    // pinned byte/index verifier, not a new baseline inferred from Git status.
    if (entries.length !== verified.fileCount || entries.length > GIT_PREPARATION_TRACKED_CONTENT_LIMITS.entries ||
        entries.reduce((sum, entry) => sum + entry.size, 0) !== verified.byteCount ||
        hash(JSON.stringify(entries.map((entry) => `${entry.path}\0${entry.mode}\0${entry.blob}`).sort())) !== verified.digest) fail("physical source inventory changed");
    const captured = { verified, entries };
    assertSourceTracked(selection, captured);
    return captured;
  });
}
/** Narrow synchronous reassertion of the previously verified tracked tree/index.
 * No Git stat cache, symlink traversal, ignored-cache scan or adaptive baseline.
 * Directory/index FDs remain held through the read; before/after stamps narrow
 * external-writer races, not a claim of universally atomic confinement. */
function assertSourceTracked(selection: GitProjectResources, captured?: SourceTracked): void {
  if (!captured || process.platform !== "linux") fail("original physical source proof required");
  const pins: { fd: number; name: string; before: fsSync.BigIntStats }[] = [];
  const identity = (s: fsSync.BigIntStats) => JSON.stringify({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) });
  const stamp = (s: fsSync.BigIntStats) => `${identity(s)}:${s.mode}:${s.nlink}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  const bytesFrom = (fd: number, before: fsSync.BigIntStats, limit: number): Buffer => {
    if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(limit)) fail("physical source file unsupported");
    const bytes = Buffer.alloc(Number(before.size) + 1); let count = 0;
    while (count < bytes.length) {
      const n = fsSync.readSync(fd, bytes, count, bytes.length - count, count);
      if (!n) break; count += n;
    }
    if (BigInt(count) !== before.size || stamp(fsSync.fstatSync(fd, { bigint: true })) !== stamp(before)) fail("physical source contents changed");
    return bytes.subarray(0, count);
  };
  const pin = (name: string, expected?: GitProjectResources["identities"]["checkout"]) => {
    const before = fsSync.lstatSync(name, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || expected && identity(before) !== JSON.stringify(expected)) fail("physical source directory changed");
    const fd = fsSync.openSync(name, fsSync.constants.O_RDONLY | fsSync.constants.O_DIRECTORY | fsSync.constants.O_NOFOLLOW);
    pins.push({ fd, name, before });
    if (identity(fsSync.fstatSync(fd, { bigint: true })) !== identity(before)) fail("physical source directory changed");
    return `/proc/${process.pid}/fd/${fd}`;
  };
  let index: number | undefined;
  try {
    for (const name of [selection.cwd, selection.gitDir, selection.commonDir]) if (fsSync.realpathSync(name) !== name) fail("physical source directory changed");
    const root = pin(selection.cwd, selection.identities.checkout), gitDir = pin(selection.gitDir, selection.identities.git);
    pin(selection.commonDir, selection.identities.common);
    const marker = fsSync.lstatSync(path.join(root, ".git"), { bigint: true });
    if (marker.isSymbolicLink() || JSON.stringify({ device: String(marker.dev), inode: String(marker.ino), birthtime: String(marker.birthtimeNs),
      ...(marker.isFile() ? { changed: String(marker.ctimeNs), size: String(marker.size) } : {}) }) !== JSON.stringify(selection.identities.marker)) fail("physical source marker changed");
    const indexName = path.join(gitDir, "index");
    index = fsSync.openSync(indexName, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW | fsSync.constants.O_NONBLOCK);
    const indexBefore = fsSync.fstatSync(index, { bigint: true });
    if (hash(bytesFrom(index, indexBefore, 8 * 1024 * 1024)) !== captured.verified.indexDigest) fail("physical source index changed");
    const directories = new Map<string, string>([["", root]]);
    for (const entry of captured.entries) {
      const parts = entry.path.split("/"); let parent = "";
      for (const part of parts.slice(0, -1)) {
        const next = parent ? `${parent}/${part}` : part;
        if (!directories.has(next)) directories.set(next, pin(path.join(directories.get(parent)!, part)));
        parent = next;
      }
      const name = path.join(directories.get(parent)!, parts.at(-1)!), before = fsSync.lstatSync(name, { bigint: true });
      if (before.nlink !== BigInt(1) || before.size !== BigInt(entry.size)) fail("physical source contents changed");
      let bytes: Buffer;
      if (entry.mode === "120000") {
        if (!before.isSymbolicLink()) fail("physical source symlink changed");
        bytes = fsSync.readlinkSync(name, { encoding: "buffer" }); // target BYTES only
      } else {
        if (!before.isFile() || before.isSymbolicLink() || Boolean(Number(before.mode) & 0o100) !== (entry.mode === "100755")) fail("physical source mode changed");
        const fd = fsSync.openSync(name, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW | fsSync.constants.O_NONBLOCK);
        try {
          if (stamp(fsSync.fstatSync(fd, { bigint: true })) !== stamp(before)) fail("physical source contents changed");
          bytes = bytesFrom(fd, before, GIT_PREPARATION_TRACKED_CONTENT_LIMITS.fileBytes);
        } finally { fsSync.closeSync(fd); }
      }
      if (stamp(fsSync.lstatSync(name, { bigint: true })) !== stamp(before) || bytes.length !== entry.size ||
          createHash(entry.blob.length === 64 ? "sha256" : "sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.blob) fail("physical source contents changed");
    }
    if (stamp(fsSync.fstatSync(index, { bigint: true })) !== stamp(indexBefore) ||
        stamp(fsSync.lstatSync(indexName, { bigint: true })) !== stamp(indexBefore)) fail("physical source index changed");
    for (const p of pins) if (identity(fsSync.lstatSync(p.name, { bigint: true })) !== identity(p.before) ||
        identity(fsSync.fstatSync(p.fd, { bigint: true })) !== identity(p.before)) fail("physical source directory changed");
  } finally {
    if (index !== undefined) fsSync.closeSync(index);
    for (const p of pins) fsSync.closeSync(p.fd);
  }
}
async function snapshot(options: NativeOptions, approved?: Saved | FFSaved, ownedIndex?: string, method: "merge" | "ff" = "merge"): Promise<{ review: GitReview; policyDigest: string; feature: Checkout; target: Checkout; targetCwd: string; repo: string; selection: GitProjectResources; targetSelection: GitProjectResources; selectedRefsDigest?: string; selectedSourceConfigDigest?: string; sourceTracked?: SourceTracked }> {
  const selection = approved?.selection ?? ("selected" in options ? options.selected.source : await selectGitProjectResources(options.cwd));
  await revalidateGitProjectResources(selection);
  const { targetBranch, digest } = await integrationPolicy(options, method);
  const review = await reviewGitBranches(options.cwd, options.featureBranch, targetBranch);
  if (!review.commits.length || review.mergeTreeOid !== review.featureTreeOid) fail("unsupported nontrivial merge tree");
  const targetCwd = await registered(options.cwd, options.featureBranch, review.targetBranch);
  const targetSelection = approved?.targetSelection ?? ("selected" in options ? options.selected.target : await selectGitProjectResources(targetCwd));
  await revalidateGitProjectResources(targetSelection);
  if (!samePath(targetSelection.cwd, targetCwd) || targetSelection.branch !== review.targetBranch) fail("target selection changed");
  const feature = await checkout(options.cwd, review.featureBranch, review.featureOid);
  const target = await checkout(targetCwd, review.targetBranch, review.targetOid, ownedIndex);
  const repo = await repository(options.cwd);
  if (!samePath(repo, await repository(targetCwd))) fail("worktrees belong to different repositories");
  // Preserve policy/checkout refusal precedence, but do not invalidate a receipt
  // merely by looking it up through an unrelated unresolved admission.
  await assertGitOperationAdmission(selection, options.agentDir);
  await integrationReceipts(options, review, digest, targetCwd, ownedIndex);
  const selectedRefsDigest = "selected" in options ? hash(await git(options.cwd, ["show-ref", "--head"])) : undefined;
  const selectedSourceConfigDigest = "selected" in options ? hash(await git(options.cwd, ["config", "--list", "--null"])) : undefined;
  const sourceTracked = "selected" in options ? await captureSourceTracked(selection, review.featureTreeOid, feature.digest) : undefined;
  if (approved && (JSON.stringify(approved.sourceTracked) !== JSON.stringify(sourceTracked) || approved.selectedSourceConfigDigest !== selectedSourceConfigDigest || approved.selectedRefsDigest !== selectedRefsDigest || approved.policyDigest !== digest || !equalReview(approved.plan.review, review) ||
      approved.featureIndex !== feature.digest || approved.targetIndex !== target.digest ||
      !samePath(approved.targetIndexPath, target.indexPath) || !samePath(approved.repo, repo))) fail("approved plan became stale");
  if (!samePath(selection.commonDir, repo) || !samePath(selection.cwd, options.cwd) || selection.branch !== review.featureBranch) fail("repository selection changed");
  return { review, policyDigest: digest, feature, target, targetCwd, repo, selection, targetSelection, selectedRefsDigest, selectedSourceConfigDigest, sourceTracked };
}
// A failed snapshot can mean much more than a moved ref. Do not turn policy,
// feature, selection, merge identity or admission changes into a safe refusal.
// This diagnostic is read-only and is used only before intent and read-tree.
async function classifyPreApplyTargetMove(saved: Saved | FFSaved, ownedIndex?: string,
  ownedLock?: { dev: number; ino: number }): Promise<{ observedTargetOid: string; otherState: string } | undefined> {
  const { options, plan, repo } = saved;
  if (Date.now() >= plan.expiresAt) return;
  if ("selected" in options) {
    assertDiagnosticMarkers(saved, ownedIndex, ownedLock);
    assertSourceTracked(saved.selection, saved.sourceTracked);
  }
  await revalidateGitProjectResources(saved.selection);
  const { digest } = await integrationPolicy(options, "method" in plan ? "ff" : "merge");
  if (digest !== saved.policyDigest || !samePath(saved.selection.cwd, options.cwd) ||
      saved.selection.branch !== plan.review.featureBranch || !samePath(saved.selection.commonDir, repo)) return;
  const targetCwd = await registered(options.cwd, plan.review.featureBranch, plan.review.targetBranch);
  await revalidateGitProjectResources(saved.targetSelection);
  if (!samePath(saved.targetSelection.cwd, targetCwd) || saved.targetSelection.branch !== plan.review.targetBranch) return;
  const feature = await checkout(options.cwd, plan.review.featureBranch, plan.review.featureOid);
  if (feature.digest !== saved.featureIndex || !samePath(await repository(options.cwd), repo) || !samePath(await repository(targetCwd), repo)) return;
  // A changed clean target may legitimately have a new index. This diagnostic
  // gives NO apply/retry permission, and never runs after intent or read-tree.
  const current = (await git(targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim();
  if (!OID.test(current) || current === plan.review.targetOid) return;
  const target = await checkout(targetCwd, plan.review.targetBranch, current, ownedIndex);
  if (!samePath(target.indexPath, saved.targetIndexPath)) return;
  if ("selected" in options && (hash(ledgerBytes(feature.indexPath).bytes) !== saved.featureIndex ||
      hash(ledgerBytes(target.indexPath).bytes) !== target.digest)) return;
  let context = plan.selectedContext;
  let sourceConfig = saved.selectedSourceConfigDigest, normalizedRefs = saved.selectedRefsDigest;
  if ("selected" in options) {
    context = await selectedContext(options.selected);
    if (JSON.stringify(context) !== JSON.stringify(plan.selectedContext)) return;
    for (const selection of [saved.selection, saved.targetSelection]) {
      if (!await options.selected.isSelectionAuthorized(selection) || !await options.selected.isTrusted(selection.projectRoot)) return;
    }
    await selectedReceipts(options.selected, ownedIndex,
      { oldOid: plan.review.targetOid, currentOid: current, targetBranch: plan.review.targetBranch });
    sourceConfig = hash(await git(options.cwd, ["config", "--list", "--null"]));
    normalizedRefs = hash((await git(options.cwd, ["show-ref", "--head"])).replace(`${current} refs/heads/${plan.review.targetBranch}\n`,
      `${plan.review.targetOid} refs/heads/${plan.review.targetBranch}\n`));
    if (sourceConfig !== saved.selectedSourceConfigDigest || normalizedRefs !== saved.selectedRefsDigest ||
        (await git(options.cwd, ["for-each-ref", "--format=%(symref)", `refs/heads/${plan.review.featureBranch}`, `refs/heads/${plan.review.targetBranch}`])).trim()) return;
    assertPhysicalRef(repo, plan.review.featureBranch); assertPhysicalRef(repo, plan.review.targetBranch);
  } else receipts(options, plan.review, digest, targetCwd);
  if (!("method" in plan)) await verifyObject(options.cwd, plan.mergeOid, plan.review, plan.message,
    identity(await git(options.cwd, ["var", "GIT_AUTHOR_IDENT"])), identity(await git(options.cwd, ["var", "GIT_COMMITTER_IDENT"])));
  await collisions(targetCwd, plan.review);
  await assertGitOperationAdmission(saved.selection, options.agentDir);
  const history = captureAdmissionHistory(options.agentDir, repo);
  if (history.epoch !== saved.admissionEpoch && (!("selected" in options) ||
      !await completedWinnerHistory(saved, history, current, target.digest))) return;
  await revalidateGitProjectResources(saved.selection);
  await revalidateGitProjectResources(saved.targetSelection);
  const finalSource = await checkout(options.cwd, plan.review.featureBranch, plan.review.featureOid);
  const finalTarget = await checkout(targetCwd, plan.review.targetBranch, current, ownedIndex);
  if (finalSource.digest !== saved.featureIndex || finalTarget.digest !== target.digest ||
      captureAdmissionHistory(options.agentDir, repo).epoch !== history.epoch) return;
  if ("selected" in options) {
    if (hash(await git(options.cwd, ["config", "--list", "--null"])) !== sourceConfig ||
        hash((await git(options.cwd, ["show-ref", "--head"])).replace(`${current} refs/heads/${plan.review.targetBranch}\n`,
          `${plan.review.targetOid} refs/heads/${plan.review.targetBranch}\n`)) !== normalizedRefs) return;
    assertPhysicalRef(repo, plan.review.featureBranch); assertPhysicalRef(repo, plan.review.targetBranch);
    if (hash(ledgerBytes(finalSource.indexPath).bytes) !== saved.featureIndex || hash(ledgerBytes(finalTarget.indexPath).bytes) !== target.digest ||
        captureAdmissionHistory(options.agentDir, repo).epoch !== history.epoch) return;
    assertDiagnosticMarkers(saved, ownedIndex, ownedLock);
    assertSelectedAuthorizationPostguard(saved.authorityPostguard);
    assertSelectedAuthorityRevision(saved);
    // Last synchronous byte/index read follows ALL diagnostic awaits/guards.
    assertSourceTracked(saved.selection, saved.sourceTracked);
  }
  if (Date.now() >= plan.expiresAt) return;
  // Only the authenticated winner publications/target ref are normalized. Every
  // other observed field above must still equal the ORIGINAL captured state.
  const before = hash(JSON.stringify([plan.selectedContext, saved.policyDigest, saved.featureIndex,
    saved.selectedSourceConfigDigest, saved.selectedRefsDigest, saved.authorityRevision, saved.admissionEpoch, saved.sourceTracked?.verified]));
  const after = hash(JSON.stringify([context, digest, finalSource.digest, sourceConfig, normalizedRefs,
    saved.authorityRevision, saved.admissionEpoch, saved.sourceTracked?.verified]));
  return before === after ? { observedTargetOid: current, otherState: before } : undefined;
}
async function preApplySnapshot(saved: Saved | FFSaved, ownedIndex?: string, ownedLock?: { dev: number; ino: number }): ReturnType<typeof snapshot> {
  try { return await snapshot(saved.options, saved, ownedIndex, "method" in saved.plan ? "ff" : "merge"); }
  catch (cause) {
    // A second failed diagnostic must not mask the original refusal.
    const movement = await classifyPreApplyTargetMove(saved, ownedIndex, ownedLock).catch(() => undefined);
    if (movement) throw targetMovedError(saved, movement.observedTargetOid, movement.otherState);
    throw cause;
  }
}
function identity(value: string): string {
  const match = /^(.* <[^\n<>]+>) \d+ [+-]\d{4}$/.exec(value.trim());
  if (!match) fail("invalid Git identity");
  return match[1];
}
async function verifyObject(cwd: string, oid: string, review: GitReview, message: string, author: string, committer: string): Promise<void> {
  if (!OID.test(oid)) fail("invalid merge object");
  const raw = await git(cwd, ["cat-file", "-p", oid]);
  const boundary = raw.indexOf("\n\n");
  if (boundary < 0) fail("invalid merge object");
  const lines = raw.slice(0, boundary).split("\n");
  if (lines.length !== 5 || lines[0] !== `tree ${review.featureTreeOid}` ||
      lines[1] !== `parent ${review.targetOid}` || lines[2] !== `parent ${review.featureOid}` ||
      !lines[3].startsWith(`author ${author} `) || !lines[4].startsWith(`committer ${committer} `) ||
      !/^\d+ [+-]\d{4}$/.test(lines[3].slice(`author ${author} `.length)) ||
      !/^\d+ [+-]\d{4}$/.test(lines[4].slice(`committer ${committer} `.length)) ||
      raw.slice(boundary + 2) !== `${message}\n`) fail("merge object differs from approved unsigned commit");
}
async function collisions(cwd: string, review: GitReview): Promise<void> {
  const changes = (await git(cwd, ["diff", "--no-renames", "--name-only", "-z", review.targetTreeOid, review.featureTreeOid, "--"])).split("\0").filter(Boolean);
  const ignored = (await git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (const changed of changes) {
    if (changed === ".gitattributes" || changed.endsWith("/.gitattributes") ||
        ignored.some((p) => p === changed || p.startsWith(`${changed}/`) || changed.startsWith(`${p}/`))) fail("ignored collision or attributes in candidate");
    let part = cwd;
    for (const component of changed.split("/").slice(0, -1)) {
      part = path.join(part, component);
      const stat = await fs.lstat(part).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (stat?.isSymbolicLink()) fail("symlink ancestor in candidate");
    }
  }
  const entries = await git(cwd, ["ls-tree", "-r", review.featureTreeOid]);
  if (entries.split("\n").some((e) => e.startsWith("160000 "))) fail("submodules unsupported");
}
async function privateDir(agentDir: string): Promise<string> {
  if (!path.isAbsolute(agentDir) || !samePath(agentDir, await fs.realpath(agentDir))) fail("physical agent directory required");
  const parent = path.join(agentDir, "pi-web");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const verify = async (name: string) => {
    const stat = await fs.lstat(name);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail("private recovery directory required");
  };
  await verify(parent);
  const dir = path.join(parent, "git-integration-recovery");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await verify(dir);
  return dir;
}
type AdmissionHistory = { directory?: string; files: Record<string, string>; epoch: string };
const admissionDirectory = (agentDir: string, repo: string) => path.join(agentDir, "pi-web", "git-operation-admission", "v1", hash(repo));
function ledgerBytes(file: string): { bytes: Buffer; fingerprint: string } {
  const fd = fsSync.openSync(file, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW | fsSync.constants.O_NONBLOCK);
  try {
    const start = fsSync.fstatSync(fd, { bigint: true });
    if (!start.isFile() || start.nlink !== BigInt(1) || start.size > BigInt(64 * 1024 * 1024)) fail("admission history changed");
    const bytes = fsSync.readFileSync(fd), end = fsSync.fstatSync(fd, { bigint: true }), named = fsSync.lstatSync(file, { bigint: true });
    if (named.isSymbolicLink() || named.dev !== start.dev || named.ino !== start.ino || end.ctimeNs !== start.ctimeNs ||
        end.size !== start.size || named.ctimeNs !== start.ctimeNs || named.size !== start.size || named.nlink !== start.nlink ||
        BigInt(bytes.length) !== start.size) fail("admission history changed");
    return { bytes, fingerprint: hash(JSON.stringify([String(start.dev), String(start.ino), String(start.birthtimeNs), String(start.ctimeNs), hash(bytes)])) };
  } finally { fsSync.closeSync(fd); }
}
function captureAdmissionHistory(agentDir: string, repo: string): AdmissionHistory {
  const dir = admissionDirectory(agentDir, repo), files: Record<string, string> = {};
  let stat;
  try { stat = fsSync.lstatSync(dir, { bigint: true }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  let directory: string | undefined;
  if (stat) {
    if (!stat.isDirectory() || stat.isSymbolicLink() || fsSync.realpathSync(dir) !== dir) fail("admission history changed");
    directory = JSON.stringify([String(stat.dev), String(stat.ino), String(stat.birthtimeNs)]);
    const names = fsSync.readdirSync(dir).sort();
    // Strict generated suffixes. The shared scan validates all kind/action/seal
    // links; filenames alone never waive proof, orphan evidence or quarantine.
    if (names.length > 10001 || names.some((name) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:json|pre|post|binding|removal|completed|failure)$/.test(name))) fail("admission history changed");
    for (const name of names) files[name] = ledgerBytes(path.join(dir, name)).fingerprint;
  }
  return { directory, files, epoch: hash(JSON.stringify([directory, files])) };
}
async function admissionEpoch(agentDir: string, repo: string): Promise<string> {
  return captureAdmissionHistory(agentDir, repo).epoch;
}
function assertPhysicalRef(repo: string, branch: string): void {
  let file = repo;
  for (const part of ["refs", "heads", ...branch.split("/")]) {
    file = path.join(file, part);
    try { if (fsSync.lstatSync(file).isSymbolicLink()) fail("physical branch ref required"); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") break; throw cause; }
  }
  for (const file of [path.join(repo, "packed-refs")]) {
    try { if (fsSync.lstatSync(file).isSymbolicLink()) fail("physical branch ref required"); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  }
}
function assertDiagnosticMarkers(saved: Saved | FFSaved, ownedIndex?: string, ownedLock?: { dev: number; ino: number }): void {
  for (const dir of new Set([saved.selection.gitDir, saved.selection.commonDir, saved.targetSelection.gitDir, saved.targetSelection.commonDir])) {
    for (const name of ["index.lock", "HEAD.lock", ...operationMarkers]) {
      const file = path.join(dir, name);
      let stat;
      try { stat = fsSync.lstatSync(file); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue; throw cause; }
      if (ownedIndex && file === `${ownedIndex}.lock` && ownedLock && stat.isFile() && !stat.isSymbolicLink() &&
          stat.nlink === 1 && stat.dev === ownedLock.dev && stat.ino === ownedLock.ino) continue;
      fail("operation state uncertain before target-move diagnostic");
    }
  }
}
type NativeWinner = { handle: object; agentDir: string; sessionId: string; ownerId: string; directory: string; intent: Record<string, unknown> };
// Bounded diagnostic retention of ACTUAL native identities, never a history/ID
// capability registry. Native facts alone cannot settle or mint cleanup authority.
const completedWinners = new Map<string, NativeWinner>();
async function completedWinnerHistory(saved: Saved | FFSaved, history: AdmissionHistory, current: string, targetIndex: string): Promise<boolean> {
  const before = saved.admissionHistory;
  if (!before || !history.directory || before.directory && before.directory !== history.directory ||
      Object.entries(before.files).some(([name, bytes]) => history.files[name] !== bytes)) return false;
  const added = Object.keys(history.files).filter((name) => !Object.hasOwn(before.files, name));
  if (!added.length || added.some((name) => !name.endsWith(".json"))) return false;
  const edges = new Map<string, string>();
  for (const name of added) {
    const file = path.join(admissionDirectory(saved.options.agentDir, saved.repo), name), winner = completedWinners.get(file);
    const proof = winner && nativeCompletions.get(winner.handle);
    if (!winner || !proof || winner.agentDir !== saved.options.agentDir || winner.directory !== history.directory ||
        Date.now() - proof.completedAt > TTL || JSON.stringify(proof.target) !== JSON.stringify(saved.targetSelection)) return false;
    const record = JSON.parse(ledgerBytes(file).bytes.toString()).record as Record<string, unknown>;
    if (record.id !== winner.ownerId || record.actionId !== proof.admissionActionId || record.kind !== "integration" || record.phase !== "resolved" ||
        record.resource !== saved.repo || !Number.isSafeInteger(record.resolvedAt) || (record.resolvedAt as number) < proof.completedAt) return false;
    const intent = { ...record, phase: "intent" }; delete (intent as Record<string, unknown>).resolvedAt;
    if (JSON.stringify(intent) !== JSON.stringify(winner.intent)) return false;
    // The original private native identity AND both durable barriers are required.
    // Arbitrary succeeded history or proof-free resolved intents cannot qualify.
    const durable = await readGitAction(proof.admissionActionId, { includeArtifact: true }, winner.agentDir);
    const action = durable.record, candidate = durable.candidate, outcome = action?.outcome;
    if (durable.unavailable || action?.kind !== "integration" || action.state !== "succeeded" || action.sessionId !== winner.sessionId ||
        candidate?.kind !== "integration" || candidate.repositoryRoot !== proof.feature.cwd || candidate.projectRoot !== proof.feature.projectRoot ||
        candidate.sourceCheckoutRoot !== proof.feature.cwd || candidate.targetCheckoutRoot !== proof.target.cwd ||
        candidate.featureBranch !== proof.feature.branch || candidate.targetBranch !== proof.target.branch ||
        candidate.featureOid !== proof.featureOid || candidate.targetOid !== proof.previousTargetOid || candidate.integrationMethod !== proof.method ||
        candidate.resourceAttribution?.commonDir !== saved.repo ||
        JSON.stringify(candidate.resourceAttribution.commonIdentity) !== JSON.stringify(proof.target.identities.common) ||
        JSON.stringify(candidate.resourceAttribution.projectIdentity) !== JSON.stringify(proof.target.identities.project) ||
        outcome?.status !== "integrated" || outcome.mergeOid !== proof.resultOid || outcome.tree !== proof.resultTree ||
        outcome.featureOid !== proof.featureOid || outcome.targetOid !== proof.previousTargetOid || outcome.targetBranch !== proof.target.branch ||
        JSON.stringify(outcome.parents) !== JSON.stringify(proof.parents) || edges.has(proof.previousTargetOid)) return false;
    if (proof.resultOid === current && (proof.targetIndexDigest !== targetIndex ||
        (await git(saved.targetSelection.cwd, ["rev-parse", `${current}^{tree}`])).trim() !== proof.resultTree)) return false;
    edges.set(proof.previousTargetOid, proof.resultOid);
  }
  let oid = saved.plan.review.targetOid;
  while (edges.has(oid)) { const next = edges.get(oid)!; edges.delete(oid); oid = next; }
  return oid === current && edges.size === 0;
}
class SelectedIntegrationAdmissionError extends Error {
  constructor(readonly code: "integration-admission-unavailable" | "integration-admission-mismatch") {
    super("Git integration unavailable: selected integration admission validation failed; checkout unchanged");
  }
}
function assertIntegrationIntent(admission: GitOperationReservation, agentDir: string, repo: string,
  selectedSource?: GitProjectResources): void {
  if (selectedSource) {
    // Only the SAME supervised reservation identity can assert this intent.
    // The reader invokes its captured synchronous assertion and verifies the
    // physical resources plus sole unresolved action. No raw ID, executing row,
    // copied assertOwned interface or historical completion is an own-intent waiver.
    const owner = readGitOperationReservationOwner(admission);
    if (!owner) throw new SelectedIntegrationAdmissionError("integration-admission-unavailable");
    if (owner.kind !== "integration" || owner.id !== admission.id || owner.actionId !== admission.actionId ||
        owner.agentDir !== agentDir || owner.selection.commonDir !== repo ||
        JSON.stringify(owner.selection) !== JSON.stringify(selectedSource)) {
      throw new SelectedIntegrationAdmissionError("integration-admission-mismatch");
    }
    return;
  }
  // Preserve the trusted legacy paired-receipt callback contract.
  if (!admission || typeof admission.assertOwned !== "function" || typeof admission.resolve !== "function") fail("durable integration intent required");
  const state = inspectGitOperationAdmission(agentDir, repo);
  if (state.reason !== "unresolved" || state.actionIds.length !== 1 || state.actionIds[0] !== admission.actionId) fail("integration intent not held for this repository");
  admission.assertOwned();
}
function record(plan: IntegrationPlan, targetCwd: string, index: string, tempIndex: string, phase: string): string {
  return JSON.stringify({ phase, targetCwd, index, tempIndex, targetRef: `refs/heads/${plan.review.targetBranch}`,
    oldTargetOid: plan.review.targetOid, featureOid: plan.review.featureOid, mergeOid: plan.mergeOid, treeOid: plan.review.featureTreeOid }) + "\n";
}
async function ffParents(cwd: string, review: GitReview): Promise<string[]> {
  if (!review.commits.length || review.mergeTreeOid !== review.featureTreeOid) fail("unsupported fast-forward candidate");
  // Unlike --first-parent --parents, %P contains every parent of each commit.
  const output = await git(cwd, ["log", "--first-parent", "--reverse", "--format=%H%x00%P%x00%T",
    `${review.targetOid}..${review.featureOid}`]);
  const rows = output.trim().split("\n");
  if (rows.length !== review.commits.length) fail("feature history changed");
  for (let i = 0; i < rows.length; i++) {
    const [oid, parents, tree, extra] = rows[i].split("\0");
    const commit = review.commits[i];
    if (extra !== undefined || oid !== commit.oid || parents !== commit.parentOid || tree !== commit.treeOid) {
      fail("nonlinear feature history unsupported for fast-forward");
    }
  }
  const tip = review.commits.at(-1)!;
  if (tip.oid !== review.featureOid || tip.treeOid !== review.featureTreeOid) fail("feature tip changed");
  return [tip.parentOid];
}
function ffRecord(plan: FastForwardIntegrationPlan, targetCwd: string, index: string, tempIndex: string, phase: string): string {
  return JSON.stringify({ phase, method: "ff", targetCwd, index, tempIndex, targetRef: `refs/heads/${plan.review.targetBranch}`,
    oldTargetOid: plan.review.targetOid, featureOid: plan.featureOid, newTargetOid: plan.featureOid,
    treeOid: plan.treeOid, parents: plan.parents }) + "\n";
}

const nativeCompletions = new WeakMap<object, SelectedIntegrationNativeCompletion>();
const nativeHandles = new Map<string, object>();
const nativeOutcomes = new Map<string, SelectedIntegrationNativeOutcome>();
function selectedCheckpoint(plan: LocalIntegrationPlan, checkpoint: keyof SelectedIntegrationNativeOutcome): void {
  const outcome = nativeOutcomes.get(plan.planId);
  if (outcome) outcome[checkpoint] = true;
}
async function updateIntegrationRef(options: NativeOptions, targetCwd: string, plan: LocalIntegrationPlan, resultOid: string,
  launchGuard?: () => void): Promise<void> {
  if (!("selected" in options)) {
    await git(targetCwd, ["update-ref", `refs/heads/${plan.review.targetBranch}`, resultOid, plan.review.targetOid]);
    return;
  }
  // Verify the unchanged source and CAS the target in ONE native ref transaction.
  // no-deref prevents branch symrefs from silently moving a third ref.
  const input = `start\noption no-deref\nverify refs/heads/${plan.review.featureBranch} ${plan.review.featureOid}\n` +
    `option no-deref\nupdate refs/heads/${plan.review.targetBranch} ${resultOid} ${plan.review.targetOid}\nprepare\ncommit\n`;
  if (typeof launchGuard !== "function") fail("selected ref launch guard required");
  await git(targetCwd, ["update-ref", "--stdin"], undefined, input, launchGuard);
}
async function selectedFinalFence(saved: Saved | FFSaved, targetCwd: string, lockPath: string,
  lockStat: { dev: number; ino: number }, appliedIndex?: string): Promise<void> {
  const { plan, options } = saved;
  if (Date.now() >= plan.expiresAt) fail("plan expired before effect");
  await revalidateGitProjectResources(saved.selection);
  await revalidateGitProjectResources(saved.targetSelection);
  for (const selection of [saved.selection, saved.targetSelection]) {
    for (const dir of new Set([selection.gitDir, selection.commonDir])) for (const name of ["index.lock", "HEAD.lock", ...operationMarkers]) {
      const file = path.join(dir, name);
      if (samePath(file, lockPath)) continue; // Ownership is proven below, never path-only.
      if (await fs.lstat(file).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e; })) fail("operation marker changed after authorization");
    }
  }
  const source = await checkout(options.cwd, plan.review.featureBranch, plan.review.featureOid);
  const stat = await fs.lstat(lockPath);
  if (source.digest !== saved.featureIndex || stat.dev !== lockStat.dev || stat.ino !== lockStat.ino ||
      hash(await fs.readFile(saved.targetIndexPath)) !== saved.targetIndex ||
      (await git(targetCwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${plan.review.targetBranch}` ||
      (await git(targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() !== plan.review.targetOid) fail("final effect binding changed");
  await policySafety(targetCwd);
  await assertNoGitOperation(targetCwd);
  if (appliedIndex && ((await git(targetCwd, ["write-tree"], appliedIndex)).trim() !== plan.review.featureTreeOid ||
      (await git(targetCwd, ["ls-files", "-v", "-z"], appliedIndex)).split("\0").some((p) => p && !p.startsWith("H ")) ||
      await git(targetCwd, ["ls-files", "-u", "-z"], appliedIndex) !== "" ||
      await git(targetCwd, ["diff-files", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"], appliedIndex) !== "" ||
      await git(targetCwd, ["ls-files", "--others", "--exclude-standard", "-z"], appliedIndex) !== "")) fail("applied index or target tree changed after authorization");
  if (hash(await git(options.cwd, ["show-ref", "--head"])) !== saved.selectedRefsDigest || Date.now() >= plan.expiresAt) fail("repository refs changed or plan expired after authorization");
  assertSourceTracked(saved.selection, saved.sourceTracked);
}
async function selectedEffectAuthorization(saved: Saved | FFSaved, phase: "before-checkout" | "before-ref-cas",
  targetCwd: string, lockPath: string, lockStat: { dev: number; ino: number },
  ownedReceipts: readonly GitCheckoutVerificationReceipt[], appliedIndex?: string): Promise<SelectedIntegrationAuthorizationPostguard> {
  if (!("selected" in saved.options)) fail("selected adapter required");
  const options = saved.options.selected, context = saved.plan.selectedContext!;
  const postguard = await selectedAuthorization(options, phase, context, saved.plan, saved.admissionEpoch);
  // One bounded post-callback pass, not another authorization call. All external
  // actor/access/policy readers precede the last native snapshots/fences. A live
  // reservation postguard can fence revocation during these async reads.
  for (const r of await selectedReceiptRows(options, context, ownedReceipts)) {
    if (!await options.isCheckAuthorized(r)) fail("selected check authority revoked after authorization");
  }
  for (const selection of [options.source, options.target]) {
    if (!await options.isSelectionAuthorized(selection) || !await options.isTrusted(selection.projectRoot)) fail("selected access revoked after authorization");
  }
  await selectedReceipts(options, saved.targetIndexPath, undefined, ownedReceipts, { context, checkActor: false });
  await selectedFinalFence(saved, targetCwd, lockPath, lockStat, appliedIndex);
  return postguard;
}
function issueSelectedCompletion(saved: Saved | FFSaved, admission: GitOperationReservation, proof: SelectedIntegrationNativeCompletion): void {
  const owner = readGitOperationReservationOwner(admission);
  if (!owner || owner.kind !== "integration" || owner.actionId !== proof.admissionActionId ||
      JSON.stringify(owner.selection) !== JSON.stringify(saved.selection)) fail("held native completion owner required");
  const dir = admissionDirectory(saved.options.agentDir, saved.repo), stat = fsSync.lstatSync(dir, { bigint: true });
  const file = path.join(dir, `${owner.id}.json`), intent = JSON.parse(ledgerBytes(file).bytes.toString()).record;
  assertIntegrationIntent(admission, saved.options.agentDir, saved.repo, saved.selection);
  const handle = Object.freeze(Object.create(null)) as object;
  nativeCompletions.set(handle, structuredClone(proof));
  nativeHandles.set(saved.plan.planId, handle);
  for (const [key, winner] of completedWinners) {
    if (Date.now() - nativeCompletions.get(winner.handle)!.completedAt > TTL) completedWinners.delete(key);
  }
  if (completedWinners.size >= 1024) completedWinners.delete(completedWinners.keys().next().value!);
  completedWinners.set(file, { handle, agentDir: saved.options.agentDir, sessionId: saved.options.sessionId, ownerId: owner.id,
    directory: JSON.stringify([String(stat.dev), String(stat.ino), String(stat.birthtimeNs)]), intent });
  const outcome = nativeOutcomes.get(saved.plan.planId);
  if (outcome) outcome.completionVerified = true;
}
export function readSelectedIntegrationNativeCompletion(handle: object): SelectedIntegrationNativeCompletion | undefined {
  const proof = handle && nativeCompletions.get(handle);
  return proof ? structuredClone(proof) : undefined;
}
async function verifySelectedCompletion(saved: Saved | FFSaved, admission: GitOperationReservation, resultOid: string,
  parents: string[]): Promise<SelectedIntegrationNativeCompletion | undefined> {
  if (!("selected" in saved.options)) return;
  const { options, plan } = saved;
  await revalidateGitProjectResources(saved.selection);
  await revalidateGitProjectResources(saved.targetSelection);
  const source = await checkout(options.cwd, plan.review.featureBranch, plan.review.featureOid);
  const target = await checkout(saved.targetSelection.cwd, plan.review.targetBranch, resultOid);
  if (source.digest !== saved.featureIndex || !samePath(target.indexPath, saved.targetIndexPath) ||
      (await git(saved.targetSelection.cwd, ["write-tree"])).trim() !== plan.review.featureTreeOid ||
      (await git(saved.targetSelection.cwd, ["rev-parse", `${resultOid}^{tree}`])).trim() !== plan.review.featureTreeOid ||
      (await git(saved.targetSelection.cwd, ["show", "-s", "--format=%P", resultOid])).trim() !== parents.join(" ")) fail("final ref/index/tree/parents verification failed");
  if (!("method" in plan)) await verifyObject(options.cwd, resultOid, plan.review, plan.message,
    identity(await git(options.cwd, ["var", "GIT_AUTHOR_IDENT"])), identity(await git(options.cwd, ["var", "GIT_COMMITTER_IDENT"])));
  assertIntegrationIntent(admission, options.agentDir, saved.repo, saved.selection);
  await revalidateGitProjectResources(saved.selection);
  await revalidateGitProjectResources(saved.targetSelection);
  if ((await git(options.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.featureBranch}`])).trim() !== plan.review.featureOid ||
      hash(await fs.readFile(source.indexPath)) !== saved.featureIndex ||
      (await git(saved.targetSelection.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() !== resultOid ||
      hash(await fs.readFile(target.indexPath)) !== target.digest ||
      hash((await git(options.cwd, ["show-ref", "--head"])).replace(`${resultOid} refs/heads/${plan.review.targetBranch}\n`,
        `${plan.review.targetOid} refs/heads/${plan.review.targetBranch}\n`)) !== saved.selectedRefsDigest) fail("checkout or repository refs changed after final verification");
  assertSourceTracked(saved.selection, saved.sourceTracked);
  return { completedAt: Date.now(), delivery: "selected-local", method: "method" in plan ? "ff" : "merge", actualFF: "method" in plan,
    feature: structuredClone(saved.selection), target: structuredClone(saved.targetSelection), featureOid: plan.review.featureOid,
    previousTargetOid: plan.review.targetOid, resultOid, resultTree: plan.review.featureTreeOid, parents: [...parents],
    targetIndexDigest: target.digest, sourceIndexDigest: source.digest, planId: plan.planId, admissionActionId: admission.actionId,
    selectedContext: structuredClone(plan.selectedContext!) };
}
function freezeResources(resources: GitProjectResources): GitProjectResources {
  const r = structuredClone(resources);
  for (const value of Object.values(r.identities)) Object.freeze(value);
  Object.freeze(r.identities);
  return Object.freeze(r);
}
/** Internal selected adapter entry points; no paired receipt/policy/task conversion. */
export async function prepareSelectedIntegrationNative(input: SelectedIntegrationOptions): Promise<SelectedIntegrationPlan> {
  if (!input || !input.sessionId || !Array.isArray(input.receiptIds) ||
      [input.getPolicy, input.isTrusted, input.isSelectionAuthorized, input.isCheckAuthorized, input.readAuthorityRevisionSync, input.authorize].some((f) => typeof f !== "function") ||
      (input.afterCheckout || input.afterRefUpdate) && !process.env.NODE_TEST_CONTEXT) fail("invalid selected request");
  const selected = { ...input, source: freezeResources(input.source), target: freezeResources(input.target), receiptIds: [...input.receiptIds] };
  const options: NativeOptions = { sessionId: selected.sessionId, agentDir: selected.agentDir, cwd: selected.source.cwd,
    featureBranch: selected.source.branch, receiptIds: [...selected.receiptIds], afterCheckout: selected.afterCheckout, selected };
  const p = await selectedPolicy(selected);
  for (const r of [selected.source, selected.target]) {
    await revalidateGitProjectResources(r);
    if (!await selected.isSelectionAuthorized(r) || !await selected.isTrusted(r.projectRoot)) fail("selected access denied");
  }
  const release = acquireGitCheckoutGate([...new Set([selected.source.projectRoot, selected.source.cwd, selected.target.cwd])]);
  try { return (p.settings.method === "ff" ? await prepareFFNative(options) : await prepareMergeNative(options)) as SelectedIntegrationPlan; }
  finally { release(); }
}
export async function confirmSelectedIntegrationNative(planId: string, approvePlanId: string, sessionId: string,
  beginIntent: () => Promise<GitOperationReservation>): Promise<SelectedIntegrationResult> {
  const saved = plans().pending.get(planId) ?? plans().ffPending.get(planId);
  if (!saved || !("selected" in saved.options) || !saved.plan.selectedContext) fail("unknown selected plan");
  const release = acquireGitCheckoutGate([...new Set([saved.selection.projectRoot, saved.selection.cwd, saved.targetSelection.cwd])]);
  nativeOutcomes.set(planId, { checkoutAttempted: false, refUpdateCompleted: false, indexInstalled: false, completionVerified: false });
  try {
    const result = "method" in saved.plan ? await confirmFFNative(planId, approvePlanId, sessionId, beginIntent)
      : await confirmMergeNative(planId, approvePlanId, sessionId, beginIntent);
    const nativeHandle = nativeHandles.get(planId);
    const nativeOutcome = { ...nativeOutcomes.get(planId)! };
    return nativeHandle ? { result, nativeOutcome, nativeHandle } : { result, nativeOutcome };
  } finally { nativeHandles.delete(planId); nativeOutcomes.delete(planId); release(); }
}

/** Prepare an exact, process-local approval. No checkout/index/ref mutation. */
export async function prepareIntegration(options: IntegrationOptions): Promise<IntegrationPlan> {
  if (!options || "selected" in options || typeof options.getPolicy !== "function") fail("invalid request");
  return prepareMergeNative(options);
}
async function prepareMergeNative(options: NativeOptions): Promise<IntegrationPlan> {
  if (!options || !options.sessionId || !options.featureBranch) fail("invalid request");
  await root(options.cwd);
  const repo = await repository(options.cwd);
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  try {
  const s = await snapshot(options);
  await assertGitOperationAdmission(s.selection, options.agentDir);
  const admissionHistory = captureAdmissionHistory(options.agentDir, repo), epoch = admissionHistory.epoch;
  await collisions(s.targetCwd, s.review);
  const diff = await getGitTreeDiff(options.cwd, s.review.targetTreeOid, s.review.featureTreeOid);
  const message = `Merge branch '${s.review.featureBranch}' into ${s.review.targetBranch}`;
  const author = identity(await git(options.cwd, ["var", "GIT_AUTHOR_IDENT"]));
  const committer = identity(await git(options.cwd, ["var", "GIT_COMMITTER_IDENT"]));
  const mergeOid = (await git(options.cwd, ["-c", "commit.gpgsign=false", "commit-tree", s.review.featureTreeOid,
    "-p", s.review.targetOid, "-p", s.review.featureOid, "--no-gpg-sign", "-m", message])).trim();
  await verifyObject(options.cwd, mergeOid, s.review, message, author, committer);
  const plan: IntegrationPlan = { planId: randomUUID(), sessionId: options.sessionId, review: s.review, diff,
    receiptIds: [...options.receiptIds], mergeOid, message,
    expiresAt: "selected" in options ? await selectedPlanExpiry(options.selected) : Date.now() + TTL,
    ...("selected" in options ? { selectedContext: await selectedContext(options.selected) } : {}) };
  const authorityRevision = "selected" in options ? selectedAuthorityRevision(options.selected) : undefined;
  const authorityPostguard = "selected" in options ? await selectedAuthorization(options.selected, "prepare", plan.selectedContext!, plan, epoch) : undefined;
  if ("selected" in options) assertSelectedAuthorizationPostguard(authorityPostguard);
  await snapshot(options, { options, plan, policyDigest: s.policyDigest, featureIndex: s.feature.digest,
    targetIndex: s.target.digest, targetIndexPath: s.target.indexPath, repo: s.repo, selection: s.selection,
    targetSelection: s.targetSelection, admissionEpoch: epoch, selectedRefsDigest: s.selectedRefsDigest, selectedSourceConfigDigest: s.selectedSourceConfigDigest, sourceTracked: s.sourceTracked });
  await assertGitOperationAdmission(s.selection, options.agentDir);
  if (await admissionEpoch(options.agentDir, repo) !== epoch) fail("admission changed while preparing plan");
  if ("selected" in options) {
    assertSelectedAuthorizationPostguard(authorityPostguard);
    if (selectedAuthorityRevision(options.selected) !== authorityRevision) fail("authority changed while capturing plan");
    assertSourceTracked(s.selection, s.sourceTracked);
  }
  plans().pending.set(plan.planId, { options: { ...options, receiptIds: [...options.receiptIds] }, plan,
    policyDigest: s.policyDigest, featureIndex: s.feature.digest, targetIndex: s.target.digest,
    targetIndexPath: s.target.indexPath, repo: s.repo, selection: s.selection, targetSelection: s.targetSelection, admissionEpoch: epoch, admissionHistory,
    selectedRefsDigest: s.selectedRefsDigest, selectedSourceConfigDigest: s.selectedSourceConfigDigest, sourceTracked: s.sourceTracked, authorityPostguard, authorityRevision });
  // Never expose the mutable object kept as the server-side approval snapshot.
  return structuredClone(plan);
  } finally { plans().busy.delete(repo); }
}

/** Typed FF-only entry point; legacy merge callers can never receive an FF plan. */
export async function prepareFastForwardIntegration(options: IntegrationOptions): Promise<FastForwardIntegrationPlan> {
  if (!options || "selected" in options || typeof options.getPolicy !== "function") fail("invalid request");
  return prepareFFNative(options);
}
async function prepareFFNative(options: NativeOptions): Promise<FastForwardIntegrationPlan> {
  if (!options || !options.sessionId || !options.featureBranch) fail("invalid request");
  await root(options.cwd);
  const repo = await repository(options.cwd);
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  try {
    const s = await snapshot(options, undefined, undefined, "ff");
    await assertGitOperationAdmission(s.selection, options.agentDir);
    const admissionHistory = captureAdmissionHistory(options.agentDir, repo), epoch = admissionHistory.epoch;
    const parents = await ffParents(options.cwd, s.review);
    await collisions(s.targetCwd, s.review);
    const diff = await getGitTreeDiff(options.cwd, s.review.targetTreeOid, s.review.featureTreeOid);
    const plan: FastForwardIntegrationPlan = { method: "ff", planId: randomUUID(), sessionId: options.sessionId,
      review: s.review, diff, receiptIds: [...options.receiptIds], featureOid: s.review.featureOid,
      treeOid: s.review.featureTreeOid, parents,
      expiresAt: "selected" in options ? await selectedPlanExpiry(options.selected) : Date.now() + TTL,
      ...("selected" in options ? { selectedContext: await selectedContext(options.selected) } : {}) };
    const authorityRevision = "selected" in options ? selectedAuthorityRevision(options.selected) : undefined;
    const authorityPostguard = "selected" in options ? await selectedAuthorization(options.selected, "prepare", plan.selectedContext!, plan, epoch) : undefined;
    if ("selected" in options) assertSelectedAuthorizationPostguard(authorityPostguard);
    const saved: FFSaved = { options: { ...options, receiptIds: [...options.receiptIds] }, plan,
      policyDigest: s.policyDigest, featureIndex: s.feature.digest, targetIndex: s.target.digest,
      targetIndexPath: s.target.indexPath, repo: s.repo, selection: s.selection, targetSelection: s.targetSelection, admissionEpoch: epoch, admissionHistory,
      selectedRefsDigest: s.selectedRefsDigest, selectedSourceConfigDigest: s.selectedSourceConfigDigest, sourceTracked: s.sourceTracked, authorityPostguard, authorityRevision };
    await snapshot(options, saved, undefined, "ff");
    if (JSON.stringify(await ffParents(options.cwd, s.review)) !== JSON.stringify(parents)) fail("feature history changed");
    await assertGitOperationAdmission(s.selection, options.agentDir);
    if (await admissionEpoch(options.agentDir, repo) !== epoch) fail("admission changed while preparing plan");
    if ("selected" in options) {
      assertSelectedAuthorizationPostguard(authorityPostguard);
      assertSelectedAuthorityRevision(saved);
      assertSourceTracked(s.selection, s.sourceTracked);
    }
    plans().ffPending.set(plan.planId, saved);
    return structuredClone(plan);
  } finally { plans().busy.delete(repo); }
}

/** Explicit exact plan ID approval only. A failed post-checkout transaction is never retried automatically. */
export async function confirmIntegration(planId: string, approvePlanId: string, sessionId: string,
  beforeApply: () => Promise<GitOperationReservation>,
): Promise<IntegrationResult> {
  if (plans().pending.get(planId)?.plan.selectedContext) fail("selected adapter required");
  return confirmMergeNative(planId, approvePlanId, sessionId, beforeApply);
}
async function confirmMergeNative(planId: string, approvePlanId: string, sessionId: string,
  beforeApply: () => Promise<GitOperationReservation>,
): Promise<IntegrationResult> {
  if (!planId || planId !== approvePlanId || typeof beforeApply !== "function") fail("exact plan approval and durable intent required");
  const saved = plans().pending.get(planId);
  if (!saved || Date.now() > saved.plan.expiresAt) fail("unknown or expired plan");
  if (!sessionId || saved.plan.sessionId !== sessionId) fail("plan belongs to another session");
  const { options, plan, repo } = saved;
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  plans().pending.delete(planId); // single use, even on error
  try {
    await assertGitOperationAdmission(saved.selection, options.agentDir);
    const before = await preApplySnapshot(saved);
    await assertGitOperationAdmission(saved.selection, options.agentDir);
    if (await admissionEpoch(options.agentDir, repo) !== saved.admissionEpoch) fail("approved plan predates another Git operation");
    await collisions(before.targetCwd, before.review);
    await verifyObject(options.cwd, plan.mergeOid, plan.review, plan.message,
      identity(await git(options.cwd, ["var", "GIT_AUTHOR_IDENT"])),
      identity(await git(options.cwd, ["var", "GIT_COMMITTER_IDENT"])));
    const lockPath = `${before.target.indexPath}.lock`;
    const lock = await fs.open(lockPath, "wx", 0o600).catch(() => fail("target index locked"));
    const lockStat = await lock.stat();
    let partial = false;
    let installed = false;
    let recoveryPath = "";
    let tempIndex = "";
    try {
      const latest = await preApplySnapshot(saved, before.target.indexPath, lockStat);
      await assertGitOperationAdmission(saved.selection, options.agentDir);
      if (await admissionEpoch(options.agentDir, repo) !== saved.admissionEpoch) fail("approved plan predates another Git operation");
      await collisions(latest.targetCwd, latest.review);
      if (Date.now() > plan.expiresAt) fail("plan expired");
      if (hash(await fs.readFile(latest.target.indexPath)) !== saved.targetIndex) fail("target index changed");
      const dir = await privateDir(options.agentDir);
      recoveryPath = path.join(dir, `${plan.planId}.json`);
      tempIndex = path.join(dir, `${plan.planId}.index`);
      await fs.writeFile(tempIndex, await fs.readFile(latest.target.indexPath), { flag: "wx", mode: 0o600 });
      const recovery = await fs.open(recoveryPath, "wx", 0o600);
      try {
        await recovery.writeFile(record(plan, latest.targetCwd, latest.target.indexPath, tempIndex, "prepared"));
        await recovery.sync();
      } finally { await recovery.close(); }
      // Retain ACTUAL fresh rows before publishing our owned integration intent.
      // Lookup may deny an unresolved ledger, including our own intent. Further
      // use requires that exact live reservation plus full snapshot/policy/recipe/
      // expiry validation. Never reconstruct historical rows or issue a receipt.
      const ownedReceipts = "selected" in options ? await selectedReceiptRows(options.selected, plan.selectedContext!) : undefined;
      const admission = await beforeApply();
      assertIntegrationIntent(admission, options.agentDir, repo, "selected" in options ? saved.selection : undefined);
      // No approval wait here: exact approval must already be owned by the controller.
      let checkoutLaunchGuard: (() => void) | undefined;
      if ("selected" in options) {
        checkoutLaunchGuard = selectedLaunchGuard(saved, await selectedEffectAuthorization(saved, "before-checkout", latest.targetCwd,
          lockPath, lockStat, ownedReceipts!), admission);
        checkoutLaunchGuard();
      }
      // The real index lock is held throughout. read-tree -u can modify the worktree even when it fails.
      partial = true;
      selectedCheckpoint(plan, "checkoutAttempted");
      await git(latest.targetCwd, ["read-tree", "-u", "-m", plan.review.targetOid, plan.review.featureOid], tempIndex, undefined, checkoutLaunchGuard);
      await options.afterCheckout?.();
      const tree = (await git(latest.targetCwd, ["write-tree"], tempIndex)).trim();
      if (tree !== plan.review.featureTreeOid || hash(await fs.readFile(latest.target.indexPath)) !== saved.targetIndex) fail("staged tree or real index changed");
      // status cannot compare against the old HEAD now; validate only the ref and physical checkout identity.
      if ((await git(latest.targetCwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${plan.review.targetBranch}` ||
          (await git(latest.targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() !== plan.review.targetOid ||
          (await git(options.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.featureBranch}`])).trim() !== plan.review.featureOid ||
          !samePath(await repository(latest.targetCwd), repo)) fail("branch or checkout moved during apply");
      const stat = await fs.lstat(lockPath);
      if (stat.dev !== lockStat.dev || stat.ino !== lockStat.ino) fail("index lock ownership lost");
      // write-tree only proves the temporary INDEX: an intervening writer may
      // have modified the applied working tree. Compare files to that index,
      // not to HEAD (which still points at the old target until update-ref).
      if (await git(latest.targetCwd, ["diff-files", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"], tempIndex) !== "" ||
          await git(latest.targetCwd, ["ls-files", "--others", "--exclude-standard", "-z"], tempIndex) !== "") {
        fail("target worktree changed after apply");
      }
      // Last checkpoint immediately before CAS, after all asynchronous work and
      // after the journal/intent callback. Neither a saved plan nor temp index
      // proves the operation markers, checkout identity or reservation still hold.
      await revalidateGitProjectResources(saved.selection);
      await revalidateGitProjectResources(saved.targetSelection);
      if (!samePath(await repository(latest.targetCwd), repo) ||
          (await git(latest.targetCwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${plan.review.targetBranch}` ||
          (await git(latest.targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() !== plan.review.targetOid ||
          (await git(options.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.featureBranch}`])).trim() !== plan.review.featureOid ||
          hash(await fs.readFile(latest.target.indexPath)) !== saved.targetIndex) fail("checkout changed before ref update");
      await assertNoGitOperation(options.cwd);
      await assertNoGitOperation(latest.targetCwd);
      const finalLock = await fs.lstat(lockPath);
      if (finalLock.dev !== lockStat.dev || finalLock.ino !== lockStat.ino) fail("index lock ownership lost");
      let refLaunchGuard: (() => void) | undefined;
      if ("selected" in options) {
        refLaunchGuard = selectedLaunchGuard(saved, await selectedEffectAuthorization(saved, "before-ref-cas", latest.targetCwd,
          lockPath, lockStat, ownedReceipts!, tempIndex), admission);
        refLaunchGuard();
      } else assertIntegrationIntent(admission, options.agentDir, repo);
      await updateIntegrationRef(options, latest.targetCwd, plan, plan.mergeOid, refLaunchGuard);
      selectedCheckpoint(plan, "refUpdateCompleted");
      if ("selected" in options) await options.selected.afterRefUpdate?.();
      const nextRecord = `${recoveryPath}.next`;
      const update = await fs.open(nextRecord, "wx", 0o600);
      try {
        await update.writeFile(record(plan, latest.targetCwd, latest.target.indexPath, tempIndex, "ref-updated"));
        await update.sync();
      } finally { await update.close(); }
      await fs.rename(nextRecord, recoveryPath);
      await lock.writeFile(await fs.readFile(tempIndex));
      await lock.sync();
      await lock.close();
      const current = await fs.lstat(lockPath);
      if (current.dev !== lockStat.dev || current.ino !== lockStat.ino) fail("index lock ownership lost");
      await fs.rename(lockPath, latest.target.indexPath);
      installed = true;
      selectedCheckpoint(plan, "indexInstalled");
      const proof = await verifySelectedCompletion(saved, admission, plan.mergeOid, [plan.review.targetOid, plan.review.featureOid]);
      await fs.unlink(tempIndex);
      await fs.unlink(recoveryPath);
      if (proof) issueSelectedCompletion(saved, admission, proof);
      return { status: "integrated", mergeOid: plan.mergeOid, targetBranch: plan.review.targetBranch };
    } catch (cause) {
      if (partial) return { status: "partial-state", mergeOid: plan.mergeOid, targetBranch: plan.review.targetBranch,
        recoveryPath, reason: "Checkout or ref finalization failed; inspect recovery record and target worktree manually; do not retry" };
      if (cause instanceof GitIntegrationTargetMovedError || cause instanceof SelectedIntegrationAdmissionError) throw cause;
      throw new Error("Git integration unavailable: pre-apply validation failed; checkout unchanged");
    } finally {
      await lock.close().catch(() => {});
      if (!installed) {
        const current = await fs.lstat(lockPath).catch(() => null);
        if (current && current.dev === lockStat.dev && current.ino === lockStat.ino) await fs.unlink(lockPath).catch(() => {});
        if (!partial) {
          if (tempIndex) await fs.unlink(tempIndex).catch(() => {});
          if (recoveryPath) await fs.unlink(recoveryPath).catch(() => {});
        }
      }
    }
  } finally { plans().busy.delete(repo); }
}

/** FF-only apply. Never substitutes a merge commit or updates the feature ref. */
export async function confirmFastForwardIntegration(planId: string, approvePlanId: string, sessionId: string,
  beforeApply: () => Promise<GitOperationReservation>,
): Promise<FastForwardIntegrationResult> {
  if (plans().ffPending.get(planId)?.plan.selectedContext) fail("selected adapter required");
  return confirmFFNative(planId, approvePlanId, sessionId, beforeApply);
}
async function confirmFFNative(planId: string, approvePlanId: string, sessionId: string,
  beforeApply: () => Promise<GitOperationReservation>,
): Promise<FastForwardIntegrationResult> {
  if (!planId || planId !== approvePlanId || typeof beforeApply !== "function") fail("exact plan approval and durable intent required");
  const saved = plans().ffPending.get(planId);
  if (!saved || Date.now() > saved.plan.expiresAt) fail("unknown or expired plan");
  if (!sessionId || saved.plan.sessionId !== sessionId) fail("plan belongs to another session");
  const { options, plan, repo } = saved;
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  plans().ffPending.delete(planId);
  try {
    await assertGitOperationAdmission(saved.selection, options.agentDir);
    const before = await preApplySnapshot(saved);
    await assertGitOperationAdmission(saved.selection, options.agentDir);
    if (await admissionEpoch(options.agentDir, repo) !== saved.admissionEpoch) fail("approved plan predates another Git operation");
    await collisions(before.targetCwd, before.review);
    if (JSON.stringify(await ffParents(options.cwd, before.review)) !== JSON.stringify(plan.parents)) fail("approved feature history changed");
    const lockPath = `${before.target.indexPath}.lock`;
    const lock = await fs.open(lockPath, "wx", 0o600).catch(() => fail("target index locked"));
    const lockStat = await lock.stat();
    let partial = false;
    let installed = false;
    let recoveryPath = "";
    let tempIndex = "";
    try {
      const latest = await preApplySnapshot(saved, before.target.indexPath, lockStat);
      await assertGitOperationAdmission(saved.selection, options.agentDir);
      if (await admissionEpoch(options.agentDir, repo) !== saved.admissionEpoch) fail("approved plan predates another Git operation");
      await collisions(latest.targetCwd, latest.review);
      if (JSON.stringify(await ffParents(options.cwd, latest.review)) !== JSON.stringify(plan.parents)) fail("approved feature history changed");
      if (Date.now() > plan.expiresAt) fail("plan expired");
      if (hash(await fs.readFile(latest.target.indexPath)) !== saved.targetIndex) fail("target index changed");
      const dir = await privateDir(options.agentDir);
      recoveryPath = path.join(dir, `${plan.planId}.json`);
      tempIndex = path.join(dir, `${plan.planId}.index`);
      await fs.writeFile(tempIndex, await fs.readFile(latest.target.indexPath), { flag: "wx", mode: 0o600 });
      const recovery = await fs.open(recoveryPath, "wx", 0o600);
      try {
        await recovery.writeFile(ffRecord(plan, latest.targetCwd, latest.target.indexPath, tempIndex, "prepared"));
        await recovery.sync();
      } finally { await recovery.close(); }
      const ownedReceipts = "selected" in options ? await selectedReceiptRows(options.selected, plan.selectedContext!) : undefined;
      const admission = await beforeApply();
      assertIntegrationIntent(admission, options.agentDir, repo, "selected" in options ? saved.selection : undefined);
      let checkoutLaunchGuard: (() => void) | undefined;
      if ("selected" in options) {
        checkoutLaunchGuard = selectedLaunchGuard(saved, await selectedEffectAuthorization(saved, "before-checkout", latest.targetCwd,
          lockPath, lockStat, ownedReceipts!), admission);
        checkoutLaunchGuard();
      }
      partial = true; // read-tree -u may modify the checkout even if Git exits unsuccessfully.
      selectedCheckpoint(plan, "checkoutAttempted");
      await git(latest.targetCwd, ["read-tree", "-u", "-m", plan.review.targetOid, plan.featureOid], tempIndex, undefined, checkoutLaunchGuard);
      await options.afterCheckout?.();
      const tree = (await git(latest.targetCwd, ["write-tree"], tempIndex)).trim();
      if (tree !== plan.treeOid || hash(await fs.readFile(latest.target.indexPath)) !== saved.targetIndex) fail("staged tree or real index changed");
      if ((await git(latest.targetCwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${plan.review.targetBranch}` ||
          (await git(latest.targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() !== plan.review.targetOid ||
          (await git(options.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.featureBranch}`])).trim() !== plan.featureOid ||
          !samePath(await repository(latest.targetCwd), repo)) fail("branch or checkout moved during apply");
      const stat = await fs.lstat(lockPath);
      if (stat.dev !== lockStat.dev || stat.ino !== lockStat.ino) fail("index lock ownership lost");
      if (await git(latest.targetCwd, ["diff-files", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"], tempIndex) !== "" ||
          await git(latest.targetCwd, ["ls-files", "--others", "--exclude-standard", "-z"], tempIndex) !== "") {
        fail("target worktree changed after apply");
      }
      await revalidateGitProjectResources(saved.selection);
      await revalidateGitProjectResources(saved.targetSelection);
      if (!samePath(await repository(latest.targetCwd), repo) ||
          (await git(latest.targetCwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${plan.review.targetBranch}` ||
          (await git(latest.targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() !== plan.review.targetOid ||
          (await git(options.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.featureBranch}`])).trim() !== plan.featureOid ||
          hash(await fs.readFile(latest.target.indexPath)) !== saved.targetIndex) fail("checkout changed before ref update");
      await assertNoGitOperation(options.cwd);
      await assertNoGitOperation(latest.targetCwd);
      const finalLock = await fs.lstat(lockPath);
      if (finalLock.dev !== lockStat.dev || finalLock.ino !== lockStat.ino) fail("index lock ownership lost");
      let refLaunchGuard: (() => void) | undefined;
      if ("selected" in options) {
        refLaunchGuard = selectedLaunchGuard(saved, await selectedEffectAuthorization(saved, "before-ref-cas", latest.targetCwd,
          lockPath, lockStat, ownedReceipts!, tempIndex), admission);
        refLaunchGuard();
      } else assertIntegrationIntent(admission, options.agentDir, repo);
      await updateIntegrationRef(options, latest.targetCwd, plan, plan.featureOid, refLaunchGuard);
      selectedCheckpoint(plan, "refUpdateCompleted");
      if ("selected" in options) await options.selected.afterRefUpdate?.();
      const nextRecord = `${recoveryPath}.next`;
      const update = await fs.open(nextRecord, "wx", 0o600);
      try {
        await update.writeFile(ffRecord(plan, latest.targetCwd, latest.target.indexPath, tempIndex, "ref-updated"));
        await update.sync();
      } finally { await update.close(); }
      await fs.rename(nextRecord, recoveryPath);
      await lock.writeFile(await fs.readFile(tempIndex));
      await lock.sync();
      await lock.close();
      const current = await fs.lstat(lockPath);
      if (current.dev !== lockStat.dev || current.ino !== lockStat.ino) fail("index lock ownership lost");
      await fs.rename(lockPath, latest.target.indexPath);
      installed = true;
      selectedCheckpoint(plan, "indexInstalled");
      const proof = await verifySelectedCompletion(saved, admission, plan.featureOid, plan.parents);
      await fs.unlink(tempIndex);
      await fs.unlink(recoveryPath);
      if (proof) issueSelectedCompletion(saved, admission, proof);
      return { status: "integrated", method: "ff", featureOid: plan.featureOid, treeOid: plan.treeOid,
        parents: [...plan.parents], targetBranch: plan.review.targetBranch };
    } catch (cause) {
      if (partial) return { status: "partial-state", method: "ff", featureOid: plan.featureOid, treeOid: plan.treeOid,
        parents: [...plan.parents], targetBranch: plan.review.targetBranch, recoveryPath,
        reason: "Checkout or ref finalization failed; inspect recovery record and target worktree manually; do not retry" };
      if (cause instanceof GitIntegrationTargetMovedError || cause instanceof SelectedIntegrationAdmissionError) throw cause;
      throw new Error("Git integration unavailable: pre-apply validation failed; checkout unchanged");
    } finally {
      await lock.close().catch(() => {});
      if (!installed) {
        const current = await fs.lstat(lockPath).catch(() => null);
        if (current && current.dev === lockStat.dev && current.ino === lockStat.ino) await fs.unlink(lockPath).catch(() => {});
        if (!partial) {
          if (tempIndex) await fs.unlink(tempIndex).catch(() => {});
          if (recoveryPath) await fs.unlink(recoveryPath).catch(() => {});
        }
      }
    }
  } finally { plans().busy.delete(repo); }
}
