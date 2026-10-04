import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { selectGitProjectResources, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { getGitTreeDiff, reviewGitBranches, type GitReview, type GitReviewDiff } from "./git-review";
import { lookupGitVerificationReceipt, assertGitVerificationReceiptSourceCurrentSync } from "./git-verification";
import { assertGitCheckReceiptBatchCurrent } from "./git-check-runner";
import { validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath, toNativePath } from "./paths";
import { lookupGitCheckoutVerificationReceipt, validateGitCheckoutVerificationReceipt, selectGitCheckoutVerificationChecks } from "./git-checkout-verification";
import { validateGitWorkflowSettings, validateGitWorkflowOverrides, projectPolicyBranches } from "./git-workflow-settings";
import { captureGitMutationAuthority, type GitMutationInvocation, type GitMutationInvocationAuthority } from "./git-mutation-invocation";
import { captureNativeCheckoutTransaction, applyNativeCheckoutTransaction, applyNativeCheckoutTransactionForTest,
  readNativeCheckoutCompletion, getNativeCheckoutOutcome, type NativeCheckoutCandidate, type NativeCheckoutOutcome } from "./git-native-checkout-transaction";
import type { SelectedIntegrationOptions, SelectedIntegrationPlanContext, SelectedIntegrationPlan,
  SelectedIntegrationNativeCompletion, SelectedIntegrationNativeOutcome, SelectedIntegrationResult,
  SelectedIntegrationAuthorizationPostguard, SelectedIntegrationNativeTargetMove } from "./git-selected-integration";

const exec = promisify(execFile), OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, TTL = 15 * 60_000;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function fail(reason: string): never { throw new Error(`Git integration unavailable: ${reason}`); }
let hooksDirectory: Promise<string> | undefined;
const disabledHooks = () => hooksDirectory ??= fs.mkdtemp(path.join(tmpdir(), "pi-web-integration-hooks-"));
async function git(cwd: string, args: string[]): Promise<string> {
  const hooks = await disabledHooks();
  try {
    return (await exec("git", ["--no-optional-locks", "-C", cwd, "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${hooks}`, ...args], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" },
    })).stdout;
  } catch { fail("Git command failed; inspect checkout manually"); }
}
async function root(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd) || !samePath(cwd, await fs.realpath(cwd)) ||
      !samePath(toNativePath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()), cwd)) fail("physical checkout root required");
  return cwd;
}
async function registered(cwd: string, feature: string, target: string): Promise<string> {
  let location = "", targetPath = "", found = false;
  for (const row of (await git(cwd, ["worktree", "list", "--porcelain", "-z"])).split("\0")) {
    if (row.startsWith("worktree ")) location = toNativePath(row.slice(9));
    if (row === `branch refs/heads/${feature}` && samePath(location, cwd)) found = true;
    if (row === `branch refs/heads/${target}`) { if (targetPath) fail("ambiguous target"); targetPath = location; }
  }
  if (!found || !targetPath || samePath(cwd, targetPath)) fail("distinct registered source and target required");
  return root(targetPath);
}
async function policySafety(cwd: string): Promise<void> {
  const hooks = await disabledHooks();
  for (const row of (await git(cwd, ["config", "--list", "--null"])).split("\0")) {
    if (!row) continue;
    const split = row.indexOf("\n"), name = row.slice(0, split).toLowerCase(), value = row.slice(split + 1);
    if (split < 0) fail("unsupported Git configuration");
    if (name === "core.fsmonitor" && value === "false" || name === "core.hookspath" && value === hooks) continue;
    if (/^(filter\.|merge\.|core\.(hookspath|fsmonitor|splitindex|sparsecheckout|attributesfile|worktree|ignorecase|protecthfs|protectntfs)|index\.|extensions\.)/.test(name) ||
        name === "commit.gpgsign" && value !== "false" || name === "core.autocrlf" && value !== "false" ||
        name === "core.eol" || name === "core.symlinks" && value === "false") fail("unsupported Git configuration");
  }
}
function assertNoHooksOrAttributesSync(selection: GitProjectResources): void {
  for (const dir of new Set([selection.gitDir, selection.commonDir])) {
    try { lstatSync(path.join(dir, "info", "attributes")); fail("attributes unsupported"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const hooks = path.join(dir, "hooks");
    let names: string[];
    try {
      const info = lstatSync(hooks);
      if (!info.isDirectory() || info.isSymbolicLink()) fail("physical empty hooks directory required");
      names = readdirSync(hooks);
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
    if (names.length > 1000 || names.some((name) => !name.endsWith(".sample"))) fail("hooks unsupported");
  }
}
async function checkout(selection: GitProjectResources, oid: string): Promise<string> {
  await revalidateGitProjectResources(selection); await root(selection.cwd); await policySafety(selection.cwd);
  assertNoHooksOrAttributesSync(selection);
  // Markers are local to THIS worktree, never the unrelated primary checkout.
  for (const name of ["index.lock", "HEAD.lock", "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START"]) {
    try { await fs.lstat(path.join(selection.gitDir, name)); fail("unfinished Git operation or native lock"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  if ((await git(selection.cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== `refs/heads/${selection.branch}` ||
      (await git(selection.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${selection.branch}`])).trim() !== oid ||
      (await git(selection.cwd, ["rev-parse", "HEAD^{commit}"])).trim() !== oid ||
      await git(selection.cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) !== "" ||
      (await git(selection.cwd, ["ls-files", "-v", "-z"])).split("\0").some((r) => r && !r.startsWith("H ")) ||
      await git(selection.cwd, ["ls-files", "-u", "-z"]) !== "") fail("checkout changed or unsupported index");
  return hash(await fs.readFile(path.join(selection.gitDir, "index")));
}
export interface IntegrationOptions {
  sessionId: string; cwd: string; agentDir: string; featureBranch: string; receiptIds: readonly string[];
  getPolicy: () => GitWorkflowPolicy | null | undefined | Promise<GitWorkflowPolicy | null | undefined>;
  /** Trusted internal owner; omitted legacy callers fail closed. Never a payload field. */
  nativeAuthority?: GitMutationInvocationAuthority;
  /** node:test only, never a production request callback. */
  afterCheckout?: () => void | Promise<void>;
}
export interface IntegrationPlan {
  planId: string; sessionId: string; review: GitReview; diff: GitReviewDiff; receiptIds: string[];
  mergeOid: string; message: string; expiresAt: number; selectedContext?: SelectedIntegrationPlanContext;
}
export type IntegrationResult = { status: "integrated"; mergeOid: string; targetBranch: string } |
  { status: "partial-state"; mergeOid: string; targetBranch: string; recoveryPath: string; reason: string };
export interface FastForwardIntegrationPlan {
  method: "ff"; planId: string; sessionId: string; review: GitReview; diff: GitReviewDiff; receiptIds: string[];
  featureOid: string; treeOid: string; parents: string[]; expiresAt: number; selectedContext?: SelectedIntegrationPlanContext;
}
export type FastForwardIntegrationResult =
  | { status: "integrated"; method: "ff"; featureOid: string; treeOid: string; parents: string[]; targetBranch: string }
  | { status: "partial-state"; method: "ff"; featureOid: string; treeOid: string; parents: string[]; targetBranch: string; recoveryPath: string; reason: string };
export type LocalIntegrationPlan = IntegrationPlan | FastForwardIntegrationPlan;
export type LocalIntegrationResult = IntegrationResult | FastForwardIntegrationResult;
/** Compatibility error type only. A moved target never grants a retry or fresh approval. */
export class GitIntegrationTargetMovedError extends Error {
  readonly code = "target_moved" as const;
  constructor() { super("Approved target moved; a separately authorized fresh candidate is required"); }
}
/** Legacy foreign-winner classification was removed. No history can mint this proof. */
export function readSelectedIntegrationNativeTargetMove(value: unknown): SelectedIntegrationNativeTargetMove | undefined { void value; return undefined; }

type Options = Omit<IntegrationOptions, "getPolicy"> & { getPolicy?: IntegrationOptions["getPolicy"]; selected?: SelectedIntegrationOptions };
type Snapshot = { review: GitReview; policyDigest: string; source: GitProjectResources; target: GitProjectResources;
  sourceIndex: string; targetIndex: string; sourceConfig: string; targetConfig: string;
  requiredCheckIndexes: readonly number[]; context?: SelectedIntegrationPlanContext };
type Saved = { options: Options; plan: LocalIntegrationPlan; snapshot: Snapshot; invocation: GitMutationInvocation;
  native: NativeCheckoutCandidate; postguard?: SelectedIntegrationAuthorizationPostguard };
const pending = new Map<string, Saved>();
const originalPlans = new WeakMap<object, Saved>();
/** Retire only the original returned plan's unused capability. Copies/IDs are
 * inert. Already consumed/retired originals return true without changing facts. */
export function retireGitIntegrationPlan(value: unknown): boolean {
  const saved = value && typeof value === "object" ? originalPlans.get(value) : undefined;
  if (!saved) return false;
  if (pending.get(saved.plan.planId) === saved) {
    pending.delete(saved.plan.planId);
    saved.invocation.retire();
  }
  return true;
}
export function retireSelectedIntegrationPlan(value: unknown): boolean {
  const saved = value && typeof value === "object" ? originalPlans.get(value) : undefined;
  return !!saved?.options.selected && retireGitIntegrationPlan(value);
}
/** Obsolete recovery callback is diagnostic only; foreign history cannot revoke other invocations. */
export function invalidateGitIntegrationPlansForResource(commonDir: string): void { void commonDir; /* no cross-invocation invalidation */ }
async function selectedPolicy(options: SelectedIntegrationOptions) {
  const input = await options.getPolicy(options.source);
  if (!input || typeof input.policyRevision !== "string" || !input.policyRevision || input.policyRevision.length > 512) fail("saved selected policy required");
  const settings = validateGitWorkflowSettings(input.settings), project = validateGitWorkflowOverrides(input.savedProjectSettings);
  if (!settings.enabled || settings.delivery !== "local" || project.delivery !== undefined && project.delivery !== "local" ||
      settings.integrateConfirmation === "disabled" || !["ff", "merge"].includes(settings.method) || project.method !== settings.method ||
      project.targetBranch == null || project.targetBranch !== settings.targetBranch ||
      project.targetBranch === ":project-main" && project.mainBranch !== settings.mainBranch) fail("explicit saved Project local target/method required");
  const targetBranch = projectPolicyBranches(settings).target;
  if (targetBranch !== options.target.branch || options.source.branch === targetBranch ||
      !samePath(options.source.projectRoot, options.target.projectRoot) || !samePath(options.source.commonDir, options.target.commonDir) ||
      samePath(options.source.cwd, options.target.cwd)) fail("saved selected target/resources differ");
  return { settings, policyRevision: input.policyRevision, policyDigest: hash(JSON.stringify(settings)), savedProjectDigest: hash(JSON.stringify(project)) };
}
async function selectedContext(options: SelectedIntegrationOptions): Promise<SelectedIntegrationPlanContext> {
  const p = await selectedPolicy(options), checks = selectGitCheckoutVerificationChecks(p.settings.checks, "integration");
  return { kind: "selected-local", version: 1, source: structuredClone(options.source), target: structuredClone(options.target),
    policyRevision: p.policyRevision, policyDigest: p.policyDigest, savedProjectDigest: p.savedProjectDigest,
    method: p.settings.method as "ff" | "merge", targetRef: `refs/heads/${options.target.branch}`, sourceRef: `refs/heads/${options.source.branch}`,
    checkStatus: checks.status, checkIndexes: [...checks.checkIndexes], receiptIds: [...options.receiptIds], repositoryChecksWaived: false };
}
function assertVoid(callback: SelectedIntegrationAuthorizationPostguard | undefined): void {
  if (typeof callback !== "function") fail("original synchronous authorization required");
  const value: unknown = callback();
  if (value !== undefined) {
    if (value && typeof (value as PromiseLike<unknown>).then === "function") void Promise.resolve(value).catch(() => {});
    fail("authorization must return void synchronously");
  }
}
async function selectedAuthorize(options: SelectedIntegrationOptions, plan: LocalIntegrationPlan,
  phase: "prepare" | "before-checkout" | "before-ref-cas") {
  const guard = await options.authorize(phase, { context: structuredClone(plan.selectedContext!), planId: plan.planId,
    expiresAt: plan.expiresAt, sourceOid: plan.review.featureOid, targetOid: plan.review.targetOid,
    treeOid: plan.review.featureTreeOid, resultOid: "method" in plan ? plan.featureOid : plan.mergeOid,
    parents: "method" in plan ? [...plan.parents] : [plan.review.targetOid, plan.review.featureOid] });
  assertVoid(guard); return guard;
}
/** The exact ordered required indexes come from saved policy discovery, never
 * public batch metadata. Zero is legitimate only for the selected modern path;
 * do not invent an empty cohort or reinterpret legacy recipe evidence. */
function assertRequiredBatch(options: Options, snapshot: Snapshot): void {
  if (!snapshot.requiredCheckIndexes.length) {
    if (!options.selected || options.receiptIds.length) fail("all required integration receipts required");
    return;
  }
  assertGitCheckReceiptBatchCurrent(options.receiptIds, snapshot.requiredCheckIndexes);
}
async function requiredReceipts(options: Options, snapshot: Snapshot): Promise<number> {
  const { review, policyDigest, target } = snapshot;
  if (new Set(options.receiptIds).size !== options.receiptIds.length) fail("duplicate receipts");
  if (options.selected) {
    const selected = options.selected, context = snapshot.context!;
    if (options.receiptIds.length !== context.checkIndexes.length) fail("all required integration receipts required");
    assertRequiredBatch(options, snapshot);
    let expiry = Date.now() + TTL;
    for (const [i, id] of options.receiptIds.entries()) {
      const r = lookupGitCheckoutVerificationReceipt(id);
      if (!r || r.version !== 2 || r.stage !== "integration" || r.sessionId !== options.sessionId ||
          r.checkIndex !== context.checkIndexes[i] || r.policyDigest !== context.policyDigest || r.policyRevision !== context.policyRevision ||
          JSON.stringify(r.selection) !== JSON.stringify(selected.source) || r.exitStatus !== 0 || Date.now() >= r.expiresAt ||
          r.snapshot.dependencyVersion !== 2 || JSON.stringify(r.snapshot.relevantRefs) !== JSON.stringify([`refs/heads/${selected.source.branch}`])) fail("original current narrowed integration receipt required");
      await validateGitCheckoutVerificationReceipt(id, { sessionId: options.sessionId, agentDir: options.agentDir,
        selector: { repositoryPath: selected.source.projectRoot, checkoutPath: selected.source.cwd, workspaceBranch: selected.source.branch },
        checkIndex: r.checkIndex, stage: "integration", getPolicy: async () => {
          const p = await selectedPolicy(selected); return { settings: p.settings, policyRevision: p.policyRevision };
        }, isTrusted: selected.isTrusted, isSelectionAuthorized: selected.isSelectionAuthorized, isActorAuthorized: selected.isCheckAuthorized,
        readAuthorityRevisionSync: selected.readAuthorityRevisionSync });
      expiry = Math.min(expiry, r.expiresAt);
    }
    assertRequiredBatch(options, snapshot); // callbacks/awaits cannot complete or restore a retired batch
    return expiry;
  }
  if (!options.receiptIds.length) fail("all configured paired receipts required");
  assertRequiredBatch(options, snapshot);
  let expiry = Date.now() + TTL;
  for (const [i, id] of options.receiptIds.entries()) {
    const r = lookupGitVerificationReceipt(id);
    if (!r || r.checkIndex !== i || r.sessionId !== options.sessionId || !samePath(r.cwd, options.cwd) || !samePath(r.targetCwd, target.cwd) ||
        r.featureBranch !== review.featureBranch || r.targetBranch !== review.targetBranch || r.featureOid !== review.featureOid ||
        r.targetOid !== review.targetOid || r.featureTreeOid !== review.featureTreeOid || r.targetTreeOid !== review.targetTreeOid ||
        r.mergeTreeOid !== review.mergeTreeOid || r.policyDigest !== policyDigest || r.exitStatus !== 0 ||
        r.finishedAt > Date.now() || Date.now() - r.finishedAt >= TTL ||
        r.dependencyVersion !== 2 || JSON.stringify(r.relevantRefs) !== JSON.stringify([`refs/heads/${review.featureBranch}`, `refs/heads/${review.targetBranch}`])) fail("original current narrowed paired receipt required");
    // Authenticate the ORIGINAL checked physical/index/source state, not a fresh
    // clean baseline inferred from receipt fields. Called before any native locks;
    // final owned-lock guards intentionally retain lookup-only authority checks.
    assertGitVerificationReceiptSourceCurrentSync(id);
    expiry = Math.min(expiry, r.finishedAt + TTL);
  }
  assertRequiredBatch(options, snapshot);
  return expiry;
}
async function snapshot(options: Options, method: "ff" | "merge"): Promise<Snapshot> {
  const source = options.selected?.source ?? freeze(await selectGitProjectResources(options.cwd));
  let targetBranch: string, policyDigest: string, context: SelectedIntegrationPlanContext | undefined;
  let requiredCheckIndexes: readonly number[];
  if (options.selected) {
    context = await selectedContext(options.selected);
    requiredCheckIndexes = [...context.checkIndexes];
    if (context.method !== method) fail("requested method changed");
    targetBranch = options.selected.target.branch; policyDigest = hash(JSON.stringify(context));
    for (const resource of [source, options.selected.target]) {
      if (!await options.selected.isSelectionAuthorized(resource) || !await options.selected.isTrusted(resource.projectRoot)) fail("selected access denied");
    }
  } else {
    const input = await options.getPolicy?.(); if (!input) fail("saved policy required");
    const policy = validateGitWorkflowPolicy(input);
    if (policy.integration?.method !== method || policy.mode === "current" && policy.branch && policy.branch !== options.featureBranch ||
        !policy.checks?.length || policy.checks.length !== options.receiptIds.length) fail("explicit requested policy and every required receipt required");
    requiredCheckIndexes = policy.checks.map((_, checkIndex) => checkIndex);
    targetBranch = policy.integration.targetBranch; policyDigest = hash(JSON.stringify(policy));
  }
  const review = await reviewGitBranches(options.cwd, options.featureBranch, targetBranch);
  if (!review.commits.length || review.mergeTreeOid !== review.featureTreeOid) fail("unsupported nontrivial merge tree");
  const targetCwd = await registered(options.cwd, options.featureBranch, targetBranch);
  const target = options.selected?.target ?? freeze(await selectGitProjectResources(targetCwd));
  if (!samePath(source.cwd, options.cwd) || source.branch !== options.featureBranch || !samePath(target.cwd, targetCwd) ||
      target.branch !== targetBranch || !samePath(source.commonDir, target.commonDir)) fail("physical selection changed");
  const result = { review, policyDigest, requiredCheckIndexes, source, target, sourceIndex: await checkout(source, review.featureOid),
    targetIndex: await checkout(target, review.targetOid), sourceConfig: hash(await git(source.cwd, ["config", "--list", "--null"])),
    targetConfig: hash(await git(target.cwd, ["config", "--list", "--null"])), ...(context ? { context } : {}) };
  await requiredReceipts(options, result); return result;
}
function identity(raw: string): string {
  const match = /^(.* <[^\n<>]+>) \d+ [+-]\d{4}$/.exec(raw.trim()); if (!match) fail("invalid Git identity"); return match[1];
}
async function verifyMerge(cwd: string, oid: string, review: GitReview, message: string): Promise<void> {
  if (!OID.test(oid)) fail("invalid merge object");
  const author = identity(await git(cwd, ["var", "GIT_AUTHOR_IDENT"])), committer = identity(await git(cwd, ["var", "GIT_COMMITTER_IDENT"]));
  const raw = await git(cwd, ["cat-file", "-p", oid]), split = raw.indexOf("\n\n"), lines = raw.slice(0, split).split("\n");
  if (split < 0 || lines.length !== 5 || lines[0] !== `tree ${review.featureTreeOid}` ||
      lines[1] !== `parent ${review.targetOid}` || lines[2] !== `parent ${review.featureOid}` ||
      !lines[3].startsWith(`author ${author} `) || !lines[4].startsWith(`committer ${committer} `) ||
      !/^\d+ [+-]\d{4}$/.test(lines[3].slice(`author ${author} `.length)) || !/^\d+ [+-]\d{4}$/.test(lines[4].slice(`committer ${committer} `.length)) ||
      raw.slice(split + 2) !== `${message}\n`) fail("merge object differs from exact unsigned candidate");
}
async function ffParents(cwd: string, review: GitReview): Promise<string[]> {
  const rows = (await git(cwd, ["log", "--first-parent", "--reverse", "--format=%H%x00%P%x00%T", `${review.targetOid}..${review.featureOid}`])).trim().split("\n");
  if (rows.length !== review.commits.length) fail("feature history changed");
  for (const [i, row] of rows.entries()) {
    const [oid, parents, tree, extra] = row.split("\0"), commit = review.commits[i];
    if (extra !== undefined || oid !== commit.oid || parents !== commit.parentOid || tree !== commit.treeOid) fail("nonlinear FF history unsupported");
  }
  const tip = review.commits.at(-1)!;
  if (tip.oid !== review.featureOid || tip.treeOid !== review.featureTreeOid) fail("feature tip changed");
  return [tip.parentOid];
}
async function verifyPlan(options: Options, plan: LocalIntegrationPlan): Promise<void> {
  if ("method" in plan) {
    if (JSON.stringify(await ffParents(options.cwd, plan.review)) !== JSON.stringify(plan.parents)) fail("FF parents changed");
  } else await verifyMerge(options.cwd, plan.mergeOid, plan.review, plan.message);
}
async function prepare(options: Options, method: "ff" | "merge", authority: ReturnType<typeof captureGitMutationAuthority>): Promise<LocalIntegrationPlan> {
  if (!options.sessionId || authority.owner.sessionId !== options.sessionId || !Array.isArray(options.receiptIds) ||
      options.afterCheckout && !process.env.NODE_TEST_CONTEXT) fail("invalid trusted invocation owner/request");
  const s = await snapshot(options, method);
  const diff = await getGitTreeDiff(options.cwd, s.review.targetTreeOid, s.review.featureTreeOid);
  const base = { planId: randomUUID(), sessionId: options.sessionId, review: s.review, diff, receiptIds: [...options.receiptIds],
    expiresAt: await requiredReceipts(options, s), ...(s.context ? { selectedContext: s.context } : {}) };
  let plan: LocalIntegrationPlan;
  if (method === "ff") plan = { ...base, method, featureOid: s.review.featureOid, treeOid: s.review.featureTreeOid, parents: await ffParents(options.cwd, s.review) };
  else {
    const message = `Merge branch '${s.review.featureBranch}' into ${s.review.targetBranch}`;
    authority.assertOriginalSync();
    const mergeOid = (await git(options.cwd, ["-c", "commit.gpgsign=false", "commit-tree", s.review.featureTreeOid,
      "-p", s.review.targetOid, "-p", s.review.featureOid, "--no-gpg-sign", "-m", message])).trim();
    plan = { ...base, mergeOid, message };
  }
  freeze(plan); freeze(s);
  await verifyPlan(options, plan);
  const postguard = options.selected ? await selectedAuthorize(options.selected, plan, "prepare") : undefined;
  authority.assertOriginalSync();
  const invocation = authority.bind({ kind: "integrate", source: s.source, target: s.target, candidateSha256: hash(JSON.stringify({ plan, snapshot: s })) });
  const hooks = await disabledHooks();
  const guard = () => {
    invocation.assertCurrentSync();
    for (const [resource, config] of [[s.source, s.sourceConfig], [s.target, s.targetConfig]] as const) {
      assertNoHooksOrAttributesSync(resource);
      const current = execFileSync("git", ["--no-optional-locks", "-C", resource.cwd, "-c", "core.fsmonitor=false",
        "-c", `core.hooksPath=${hooks}`, "config", "--list", "--null"], { encoding: "utf8", timeout: 1500, maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"], env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" } });
      if (hash(current) !== config) fail("original relevant Git configuration changed");
    }
    invocation.assertCurrentSync();
    if (Date.now() >= plan.expiresAt) fail("plan expired");
    if (options.selected) assertVoid(postguard);
    // Receipt lookup authenticates the ORIGINAL process-local receipt, never journal data.
    for (const id of options.receiptIds) if (!(options.selected ? lookupGitCheckoutVerificationReceipt(id) : lookupGitVerificationReceipt(id))) fail("required receipt retired");
    // Genuine private cohort membership remains required at every native boundary.
    // This safe in-memory lookup NEVER recaptures raw source under owned locks.
    assertRequiredBatch(options, s);
    if (Date.now() >= plan.expiresAt) fail("plan expired");
  };
  try {
    if (JSON.stringify(await snapshot(options, method)) !== JSON.stringify(s)) fail("candidate changed during prepare");
    const native = await captureNativeCheckoutTransaction({
      source: { resources: s.source, expectedOid: s.review.featureOid, treeOid: s.review.featureTreeOid, indexDigest: s.sourceIndex },
      target: { resources: s.target, expectedOid: s.review.targetOid, treeOid: s.review.targetTreeOid, indexDigest: s.targetIndex },
      resultOid: "method" in plan ? plan.featureOid : plan.mergeOid, resultTreeOid: plan.review.featureTreeOid, assertAuthoritySync: guard });
    guard();
    const saved = { options, plan, snapshot: s, invocation, native, postguard };
    const published = structuredClone(plan);
    pending.set(plan.planId, saved); originalPlans.set(published, saved);
    return published;
  } catch (e) { invocation.retire(); throw e; }
}
export async function prepareIntegration(input: IntegrationOptions): Promise<IntegrationPlan> {
  const authority = captureGitMutationAuthority(input?.nativeAuthority);
  if (!input || "selected" in input || typeof input.getPolicy !== "function") fail("invalid request");
  return prepare({ ...input, receiptIds: [...input.receiptIds] }, "merge", authority) as Promise<IntegrationPlan>;
}
export async function prepareFastForwardIntegration(input: IntegrationOptions): Promise<FastForwardIntegrationPlan> {
  const authority = captureGitMutationAuthority(input?.nativeAuthority);
  if (!input || "selected" in input || typeof input.getPolicy !== "function") fail("invalid request");
  return prepare({ ...input, receiptIds: [...input.receiptIds] }, "ff", authority) as Promise<FastForwardIntegrationPlan>;
}
export async function prepareSelectedIntegrationNative(input: SelectedIntegrationOptions): Promise<SelectedIntegrationPlan> {
  const authority = captureGitMutationAuthority(input?.nativeAuthority);
  if (!input || [input.getPolicy, input.isTrusted, input.isSelectionAuthorized, input.isCheckAuthorized, input.readAuthorityRevisionSync, input.authorize].some((f) => typeof f !== "function") ||
      input.nativeAuthority?.readAuthorityRevisionSync !== input.readAuthorityRevisionSync ||
      (input.afterCheckout || input.afterRefUpdate) && !process.env.NODE_TEST_CONTEXT) fail("invalid selected request");
  const selected = { ...input, source: freeze(structuredClone(input.source)), target: freeze(structuredClone(input.target)), receiptIds: [...input.receiptIds] };
  const p = await selectedPolicy(selected);
  return prepare({ sessionId: input.sessionId, cwd: selected.source.cwd, agentDir: input.agentDir, featureBranch: selected.source.branch,
    receiptIds: selected.receiptIds, nativeAuthority: input.nativeAuthority, selected, afterCheckout: input.afterCheckout },
  p.settings.method as "ff" | "merge", authority) as Promise<SelectedIntegrationPlan>;
}
const completions = new WeakMap<object, { proof: SelectedIntegrationNativeCompletion; native: object; invocation: GitMutationInvocation }>();
const measured = new WeakMap<object, NativeCheckoutOutcome>();
const noNativeCheckoutEffect: NativeCheckoutOutcome = Object.freeze({ status: "no-checkout-effect", checkoutAttempted: false,
  refPrepared: false, refCommitSent: false, refAcknowledged: false, indexInstalled: false, indexSynced: false,
  directorySyncFailed: false, childReaped: true });
/** This boundary knows ONLY that this invocation never entered native apply.
 * Earlier reads/unreachable object preparation are not declared effect-free.
 * Never overwrite an existing native error's measurements, even if a callback
 * rethrows one. Primitive throws cannot authenticate an original object identity. */
function recordPreApplyFailure(error: unknown): void {
  if (error && typeof error === "object" && !getNativeCheckoutOutcome(error) && !measured.has(error)) {
    measured.set(error, noNativeCheckoutEffect);
  }
}
function failBeforeApply(reason: string): never {
  const error = new Error(`Git integration unavailable: ${reason}`);
  recordPreApplyFailure(error); throw error;
}
export function readSelectedIntegrationNativeCompletion(handle: object): SelectedIntegrationNativeCompletion | undefined {
  const saved = handle && completions.get(handle);
  return saved && readNativeCheckoutCompletion(saved.native) ? structuredClone(saved.proof) : undefined;
}
/** Original result/error identity only, readable after invocation retirement. Not replay permission. */
export function readGitIntegrationNativeOutcome(value: unknown): NativeCheckoutOutcome | undefined {
  return value && typeof value === "object" ? measured.get(value) ?? getNativeCheckoutOutcome(value) : undefined;
}
function summary(outcome: NativeCheckoutOutcome): SelectedIntegrationNativeOutcome {
  return { checkoutAttempted: outcome.checkoutAttempted, refUpdateCompleted: outcome.refAcknowledged,
    indexInstalled: outcome.indexInstalled, completionVerified: outcome.status === "complete", native: outcome };
}
async function confirm(planId: string, approvePlanId: string, sessionId: string): Promise<SelectedIntegrationResult> {
  const saved = pending.get(planId);
  if (!saved || !planId || planId !== approvePlanId || saved.plan.sessionId !== sessionId) failBeforeApply("exact original plan approval required");
  pending.delete(planId); // single-use, including every failed validation
  const { options, plan, snapshot: s, invocation } = saved;
  let nativeApplyEntered = false;
  try {
    invocation.assertCurrentSync();
    if (Date.now() >= plan.expiresAt) fail("expired plan");
    const method = "method" in plan ? "ff" : "merge";
    if (JSON.stringify(await snapshot(options, method)) !== JSON.stringify(s)) fail("approved candidate stale; no rebaseline");
    await verifyPlan(options, plan);
    if (options.selected) {
      const before = await selectedAuthorize(options.selected, plan, "before-checkout");
      const final = await selectedAuthorize(options.selected, plan, "before-ref-cas");
      // These additional checks do NOT replace the ORIGINAL native guard.
      assertVoid(before); assertVoid(final); assertVoid(saved.postguard);
      if (JSON.stringify(await snapshot(options, method)) !== JSON.stringify(s)) fail("approved candidate changed during authorization");
    }
    invocation.consumeSync();
    // Shared helper holds BOTH prepared ref locks and the original real target index lock before checkout.
    nativeApplyEntered = true; // no catch after this boundary may invent no-effect facts
    const native = options.afterCheckout || options.selected?.afterRefUpdate
      ? await applyNativeCheckoutTransactionForTest(saved.native, { afterCheckout: options.afterCheckout, afterRef: options.selected?.afterRefUpdate })
      : await applyNativeCheckoutTransaction(saved.native);
    const evidence = readNativeCheckoutCompletion(native);
    if (!evidence) fail("original native completion missing");
    const resultOid = "method" in plan ? plan.featureOid : plan.mergeOid;
    const parents = "method" in plan ? [...plan.parents] : [plan.review.targetOid, plan.review.featureOid];
    // Exact native identity, not a structural outcome or a post-release HEAD reread.
    if (evidence.resultOid !== resultOid || evidence.resultTreeOid !== plan.review.featureTreeOid ||
        JSON.stringify(evidence.source.resources) !== JSON.stringify(s.source) || JSON.stringify(evidence.target.resources) !== JSON.stringify(s.target)) fail("native completion mismatch");
    const result: LocalIntegrationResult = "method" in plan ? { status: "integrated", method: "ff", featureOid: resultOid,
      treeOid: plan.treeOid, parents, targetBranch: plan.review.targetBranch } : { status: "integrated", mergeOid: resultOid, targetBranch: plan.review.targetBranch };
    measured.set(result, evidence.outcome);
    const nativeHandle = Object.freeze(Object.create(null)) as object;
    if (options.selected) completions.set(nativeHandle, { native, invocation, proof: { completedAt: Date.now(), delivery: "selected-local", method,
      actualFF: method === "ff", feature: structuredClone(s.source), target: structuredClone(s.target), featureOid: plan.review.featureOid,
      previousTargetOid: plan.review.targetOid, resultOid, resultTree: plan.review.featureTreeOid, parents,
      targetIndexDigest: evidence.targetContents.indexDigest, sourceIndexDigest: evidence.sourceContents.indexDigest,
      planId: plan.planId, invocationOwner: structuredClone(invocation.binding.owner), selectedContext: structuredClone(plan.selectedContext!) } });
    return { result, nativeOutcome: summary(evidence.outcome), ...(options.selected ? { nativeHandle } : {}) };
  } catch (error) {
    if (!nativeApplyEntered) recordPreApplyFailure(error);
    // After entry preserve original helper measurements, including unknown/partial.
    throw error;
  } finally { invocation.retire(); }
}
export async function confirmIntegration(planId: string, approvePlanId: string, sessionId: string,
  legacyIntent?: unknown): Promise<IntegrationResult> {
  if (legacyIntent !== undefined) failBeforeApply("legacy durable intent callback unsupported; migrate native caller");
  const saved = pending.get(planId); if (!saved || saved.options.selected || "method" in saved.plan) failBeforeApply("merge plan required");
  return (await confirm(planId, approvePlanId, sessionId)).result as IntegrationResult;
}
export async function confirmFastForwardIntegration(planId: string, approvePlanId: string, sessionId: string,
  legacyIntent?: unknown): Promise<FastForwardIntegrationResult> {
  if (legacyIntent !== undefined) failBeforeApply("legacy durable intent callback unsupported; migrate native caller");
  const saved = pending.get(planId); if (!saved || saved.options.selected || !("method" in saved.plan)) failBeforeApply("FF plan required");
  return (await confirm(planId, approvePlanId, sessionId)).result as FastForwardIntegrationResult;
}
export async function confirmSelectedIntegrationNative(planId: string, approvePlanId: string, sessionId: string,
  legacyIntent?: unknown): Promise<SelectedIntegrationResult> {
  if (legacyIntent !== undefined) failBeforeApply("legacy durable intent callback unsupported; migrate native caller");
  if (!pending.get(planId)?.options.selected) failBeforeApply("selected plan required");
  return confirm(planId, approvePlanId, sessionId);
}
