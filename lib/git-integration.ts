import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { assertGitOperationAdmission, inspectGitOperationAdmission, type GitOperationReservation } from "./git-operation-admission";
import { selectGitProjectResources, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { getGitTreeDiff, reviewGitBranches, type GitReview, type GitReviewDiff } from "./git-review";
import { lookupGitVerificationReceipt } from "./git-verification";
import { validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { samePath, toNativePath } from "./paths";

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
type Saved = { options: IntegrationOptions; plan: IntegrationPlan; policyDigest: string; featureIndex: string; targetIndex: string; targetIndexPath: string; repo: string; selection: GitProjectResources; targetSelection: GitProjectResources; admissionEpoch: string };
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
async function git(cwd: string, args: string[], index?: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "-c", "core.fsmonitor=false",
      "-c", `core.hooksPath=${await disabledHooks()}`, ...args], {
      encoding: "utf8", env: { ...gitExecEnv(index), GIT_NO_REPLACE_OBJECTS: "1", GIT_PAGER: "cat" },
      timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
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
async function snapshot(options: IntegrationOptions, approved?: Saved | FFSaved, ownedIndex?: string, method: "merge" | "ff" = "merge"): Promise<{ review: GitReview; policyDigest: string; feature: Checkout; target: Checkout; targetCwd: string; repo: string; selection: GitProjectResources; targetSelection: GitProjectResources }> {
  const selection = approved?.selection ?? await selectGitProjectResources(options.cwd);
  await revalidateGitProjectResources(selection);
  const { policy, digest } = await policyOf(options, method);
  if (!policy.checks?.length || policy.checks.length !== options.receiptIds.length) fail("every configured check must have a receipt");
  const review = await reviewGitBranches(options.cwd, options.featureBranch, policy.integration!.targetBranch);
  if (!review.commits.length || review.mergeTreeOid !== review.featureTreeOid) fail("unsupported nontrivial merge tree");
  const targetCwd = await registered(options.cwd, options.featureBranch, review.targetBranch);
  const targetSelection = approved?.targetSelection ?? await selectGitProjectResources(targetCwd);
  await revalidateGitProjectResources(targetSelection);
  if (!samePath(targetSelection.cwd, targetCwd) || targetSelection.branch !== review.targetBranch) fail("target selection changed");
  const feature = await checkout(options.cwd, review.featureBranch, review.featureOid);
  const target = await checkout(targetCwd, review.targetBranch, review.targetOid, ownedIndex);
  const repo = await repository(options.cwd);
  if (!samePath(repo, await repository(targetCwd))) fail("worktrees belong to different repositories");
  receipts(options, review, digest, targetCwd);
  if (approved && (approved.policyDigest !== digest || !equalReview(approved.plan.review, review) ||
      approved.featureIndex !== feature.digest || approved.targetIndex !== target.digest ||
      !samePath(approved.targetIndexPath, target.indexPath) || !samePath(approved.repo, repo))) fail("approved plan became stale");
  if (!samePath(selection.commonDir, repo) || !samePath(selection.cwd, options.cwd) || selection.branch !== review.featureBranch) fail("repository selection changed");
  return { review, policyDigest: digest, feature, target, targetCwd, repo, selection, targetSelection };
}
// A failed snapshot can mean much more than a moved ref. Do not turn policy,
// feature, selection, merge identity or admission changes into a safe refusal.
// This diagnostic is read-only and is used only before intent and read-tree.
async function classifyPreApplyTargetMove(saved: Saved | FFSaved, ownedIndex?: string): Promise<boolean> {
  const { options, plan, repo } = saved;
  await revalidateGitProjectResources(saved.selection);
  const { policy, digest } = await policyOf(options, "method" in plan ? "ff" : "merge");
  if (digest !== saved.policyDigest || !policy.checks?.length || policy.checks.length !== options.receiptIds.length ||
      !samePath(saved.selection.cwd, options.cwd) || saved.selection.branch !== plan.review.featureBranch ||
      !samePath(saved.selection.commonDir, repo)) return false;
  const targetCwd = await registered(options.cwd, plan.review.featureBranch, plan.review.targetBranch);
  await revalidateGitProjectResources(saved.targetSelection);
  if (!samePath(saved.targetSelection.cwd, targetCwd) || saved.targetSelection.branch !== plan.review.targetBranch) return false;
  const feature = await checkout(options.cwd, plan.review.featureBranch, plan.review.featureOid);
  if (feature.digest !== saved.featureIndex || !samePath(await repository(options.cwd), repo) ||
      !samePath(await repository(targetCwd), repo)) return false;
  // Validate the captured physical target against its *current* ref. A normal
  // target commit may rewrite clean index bytes, so old-byte equality cannot
  // be required here. A clean index only describes the *new* HEAD, not the
  // approved index/tree. This refusal grants no apply authority: fresh review
  // and verification are mandatory.
  const current = (await git(targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim();
  if (!OID.test(current) || current === plan.review.targetOid) return false;
  const target = await checkout(targetCwd, plan.review.targetBranch, current, ownedIndex);
  if (!samePath(target.indexPath, saved.targetIndexPath)) return false;
  receipts(options, plan.review, digest, targetCwd);
  if (!("method" in plan)) await verifyObject(options.cwd, plan.mergeOid, plan.review, plan.message,
    identity(await git(options.cwd, ["var", "GIT_AUTHOR_IDENT"])),
    identity(await git(options.cwd, ["var", "GIT_COMMITTER_IDENT"])));
  await collisions(targetCwd, plan.review);
  await assertGitOperationAdmission(saved.selection, options.agentDir);
  if (await admissionEpoch(options.agentDir, repo) !== saved.admissionEpoch) return false;
  await revalidateGitProjectResources(saved.targetSelection);
  return (await git(targetCwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.targetBranch}`])).trim() === current &&
    (await git(options.cwd, ["show-ref", "--verify", "--hash", `refs/heads/${plan.review.featureBranch}`])).trim() === plan.review.featureOid;
}
async function preApplySnapshot(saved: Saved | FFSaved, ownedIndex?: string): ReturnType<typeof snapshot> {
  try { return await snapshot(saved.options, saved, ownedIndex, "method" in saved.plan ? "ff" : "merge"); }
  catch (cause) {
    // A second failed diagnostic must not mask the original refusal.
    if (await classifyPreApplyTargetMove(saved, ownedIndex).catch(() => false)) throw new GitIntegrationTargetMovedError();
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
async function admissionEpoch(agentDir: string, repo: string): Promise<string> {
  // A resolved operation can leave refs/index exactly unchanged. Its new durable
  // ledger entry still invalidates plans prepared before that operation. Read
  // only after the ledger's validating admission scan; never create or clear it.
  const dir = path.join(agentDir, "pi-web", "git-operation-admission", "v1", hash(repo));
  const files = await fs.readdir(dir).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return [];
    throw cause;
  });
  // The validating admission scan checks each immutable check snapshot/proof.
  // Their publication also changes the epoch, even when refs stayed identical.
  if (files.some((name) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:json|pre|post)$/.test(name))) fail("admission history changed");
  return hash(files.sort().join("\n"));
}
function assertIntegrationIntent(admission: GitOperationReservation, agentDir: string, repo: string): void {
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

/** Prepare an exact, process-local approval. No checkout/index/ref mutation. */
export async function prepareIntegration(options: IntegrationOptions): Promise<IntegrationPlan> {
  if (!options || !options.sessionId || !options.featureBranch || typeof options.getPolicy !== "function") fail("invalid request");
  await root(options.cwd);
  const repo = await repository(options.cwd);
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  try {
  const s = await snapshot(options);
  await assertGitOperationAdmission(s.selection, options.agentDir);
  const epoch = await admissionEpoch(options.agentDir, repo);
  await collisions(s.targetCwd, s.review);
  const diff = await getGitTreeDiff(options.cwd, s.review.targetTreeOid, s.review.featureTreeOid);
  const message = `Merge branch '${s.review.featureBranch}' into ${s.review.targetBranch}`;
  const author = identity(await git(options.cwd, ["var", "GIT_AUTHOR_IDENT"]));
  const committer = identity(await git(options.cwd, ["var", "GIT_COMMITTER_IDENT"]));
  const mergeOid = (await git(options.cwd, ["-c", "commit.gpgsign=false", "commit-tree", s.review.featureTreeOid,
    "-p", s.review.targetOid, "-p", s.review.featureOid, "--no-gpg-sign", "-m", message])).trim();
  await verifyObject(options.cwd, mergeOid, s.review, message, author, committer);
  const plan: IntegrationPlan = { planId: randomUUID(), sessionId: options.sessionId, review: s.review, diff,
    receiptIds: [...options.receiptIds], mergeOid, message, expiresAt: Date.now() + TTL };
  await snapshot(options, { options, plan, policyDigest: s.policyDigest, featureIndex: s.feature.digest,
    targetIndex: s.target.digest, targetIndexPath: s.target.indexPath, repo: s.repo, selection: s.selection,
    targetSelection: s.targetSelection, admissionEpoch: epoch });
  await assertGitOperationAdmission(s.selection, options.agentDir);
  if (await admissionEpoch(options.agentDir, repo) !== epoch) fail("admission changed while preparing plan");
  plans().pending.set(plan.planId, { options: { ...options, receiptIds: [...options.receiptIds] }, plan,
    policyDigest: s.policyDigest, featureIndex: s.feature.digest, targetIndex: s.target.digest,
    targetIndexPath: s.target.indexPath, repo: s.repo, selection: s.selection, targetSelection: s.targetSelection, admissionEpoch: epoch });
  // Never expose the mutable object kept as the server-side approval snapshot.
  return structuredClone(plan);
  } finally { plans().busy.delete(repo); }
}

/** Typed FF-only entry point; legacy merge callers can never receive an FF plan. */
export async function prepareFastForwardIntegration(options: IntegrationOptions): Promise<FastForwardIntegrationPlan> {
  if (!options || !options.sessionId || !options.featureBranch || typeof options.getPolicy !== "function") fail("invalid request");
  await root(options.cwd);
  const repo = await repository(options.cwd);
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  try {
    const s = await snapshot(options, undefined, undefined, "ff");
    await assertGitOperationAdmission(s.selection, options.agentDir);
    const epoch = await admissionEpoch(options.agentDir, repo);
    const parents = await ffParents(options.cwd, s.review);
    await collisions(s.targetCwd, s.review);
    const diff = await getGitTreeDiff(options.cwd, s.review.targetTreeOid, s.review.featureTreeOid);
    const plan: FastForwardIntegrationPlan = { method: "ff", planId: randomUUID(), sessionId: options.sessionId,
      review: s.review, diff, receiptIds: [...options.receiptIds], featureOid: s.review.featureOid,
      treeOid: s.review.featureTreeOid, parents, expiresAt: Date.now() + TTL };
    const saved: FFSaved = { options: { ...options, receiptIds: [...options.receiptIds] }, plan,
      policyDigest: s.policyDigest, featureIndex: s.feature.digest, targetIndex: s.target.digest,
      targetIndexPath: s.target.indexPath, repo: s.repo, selection: s.selection, targetSelection: s.targetSelection, admissionEpoch: epoch };
    await snapshot(options, saved, undefined, "ff");
    if (JSON.stringify(await ffParents(options.cwd, s.review)) !== JSON.stringify(parents)) fail("feature history changed");
    await assertGitOperationAdmission(s.selection, options.agentDir);
    if (await admissionEpoch(options.agentDir, repo) !== epoch) fail("admission changed while preparing plan");
    plans().ffPending.set(plan.planId, saved);
    return structuredClone(plan);
  } finally { plans().busy.delete(repo); }
}

/** Explicit exact plan ID approval only. A failed post-checkout transaction is never retried automatically. */
export async function confirmIntegration(planId: string, approvePlanId: string, sessionId: string,
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
      const latest = await preApplySnapshot(saved, before.target.indexPath);
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
      // Recording/revocation failures here remain pre-apply failures. Historical
      // records are never used to reconstruct this live plan or callback.
      const admission = await beforeApply();
      assertIntegrationIntent(admission, options.agentDir, repo);
      // The real index lock is held throughout. read-tree -u can modify the worktree even when it fails.
      partial = true;
      await git(latest.targetCwd, ["read-tree", "-u", "-m", plan.review.targetOid, plan.review.featureOid], tempIndex);
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
      assertIntegrationIntent(admission, options.agentDir, repo);
      await git(latest.targetCwd, ["update-ref", `refs/heads/${plan.review.targetBranch}`, plan.mergeOid, plan.review.targetOid]);
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
      await fs.unlink(tempIndex);
      await fs.unlink(recoveryPath);
      return { status: "integrated", mergeOid: plan.mergeOid, targetBranch: plan.review.targetBranch };
    } catch (cause) {
      if (partial) return { status: "partial-state", mergeOid: plan.mergeOid, targetBranch: plan.review.targetBranch,
        recoveryPath, reason: "Checkout or ref finalization failed; inspect recovery record and target worktree manually; do not retry" };
      if (cause instanceof GitIntegrationTargetMovedError) throw cause;
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
  if (!planId || planId !== approvePlanId || typeof beforeApply !== "function") fail("exact plan approval and durable intent required");
  const saved = plans().ffPending.get(planId);
  if (!saved || Date.now() > saved.plan.expiresAt) fail("unknown or expired plan");
  if (!sessionId || saved.plan.sessionId !== sessionId) fail("plan belongs to another session");
  const { options, plan, repo } = saved;
  if (plans().busy.has(repo)) fail("integration already in progress");
  plans().busy.add(repo);
  plans().ffPending.delete(planId);
  try {
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
      const latest = await preApplySnapshot(saved, before.target.indexPath);
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
      const admission = await beforeApply();
      assertIntegrationIntent(admission, options.agentDir, repo);
      partial = true; // read-tree -u may modify the checkout even if Git exits unsuccessfully.
      await git(latest.targetCwd, ["read-tree", "-u", "-m", plan.review.targetOid, plan.featureOid], tempIndex);
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
      assertIntegrationIntent(admission, options.agentDir, repo);
      await git(latest.targetCwd, ["update-ref", `refs/heads/${plan.review.targetBranch}`, plan.featureOid, plan.review.targetOid]);
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
      await fs.unlink(tempIndex);
      await fs.unlink(recoveryPath);
      return { status: "integrated", method: "ff", featureOid: plan.featureOid, treeOid: plan.treeOid,
        parents: [...plan.parents], targetBranch: plan.review.targetBranch };
    } catch (cause) {
      if (partial) return { status: "partial-state", method: "ff", featureOid: plan.featureOid, treeOid: plan.treeOid,
        parents: [...plan.parents], targetBranch: plan.review.targetBranch, recoveryPath,
        reason: "Checkout or ref finalization failed; inspect recovery record and target worktree manually; do not retry" };
      if (cause instanceof GitIntegrationTargetMovedError) throw cause;
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
