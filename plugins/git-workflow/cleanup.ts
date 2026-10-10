import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readlinkSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { sortedDirectoryNames } from "./inventory-names";
import { directoryIdentity, holdCleanupParent, supportsNestedCleanup, type CleanupDirectoryIdentity } from "./cleanup-path";
import { setImmediate } from "node:timers/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { samePath } from "../../lib/paths";
import type { GitSettings } from "./manifest";
import type { BrowserDiscardOperation, DiscardLossEvidence, DiscardSubject } from "./discard";

export interface CleanupOperation {
  action: "cleanupFeature"; checkout: string; featureBranch: string; featureTip: string;
  integrationCommit: string; targetBranch?: string; worktreePath?: string;
  removeWorktree: boolean; deleteBranch: boolean; artifactRoots: string[];
}
export interface WorktreeRecord { path: string; branch?: string; head?: string; detached?: boolean; locked?: string; prunable?: string }
export interface CleanupAccess {
  /** Trusted browser adapter restriction, never supplied through operation JSON. */
  rejectUnignoredUntracked?: boolean;
  git(cwd: string, args: string[]): string | Promise<string>;
  records?(cwd: string, args: string[]): AsyncIterable<string>;
  checkout(path: string, repository?: string): string | Promise<string>;
  branchTip(cwd: string, branch: string): string | Promise<string>;
  worktrees(cwd: string): WorktreeRecord[] | Promise<WorktreeRecord[]>;
  project(cwd: string): string | null;
  inUse(path: string): boolean;
}
export interface ArtifactInventory { path: string; entries: number; bytes: number; digest: string }
export interface CleanupSnapshot {
  identity: string; repositoryIdentity: string; fingerprint: string; artifacts: ArtifactInventory[];
  unapprovedArtifacts: string[];
  artifactParents: string[];
  artifactParentMetadata: Array<{ path: string; digest: string }>;
  artifactParentIdentities: CleanupDirectoryIdentity[];
  path?: string; cwd: string; target: string;
  lossEvidence?: DiscardLossEvidence;
  /** Fresh direct tip supporting this capture's proof, not the approval's pinned comparison. */
  verifiedComparison?: { branch: string; tip: string };
}
export interface CleanupGitTransaction {
  /** NUL-framed commands ending at prepare; commit is sent only after verification under ref locks. */
  input: string;
  verifyPrepared(): Promise<void>;
}
export type CleanupGitRunner = (args: string[], transaction?: CleanupGitTransaction) => Promise<string>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const oid = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const rootName = /^[a-zA-Z0-9_.-]+$/;
// Conservative on every platform, including Windows case/trailing-dot aliases.
const rootKey = (name: string) => name.replace(/[. ]+$/g, "").toLowerCase();
const pathKey = (name: string) => name.split("/").map(rootKey).join("/");
const validRoot = (name: string) => name.split("/").every((part) => rootName.test(part) && !["", ".git"].includes(rootKey(part)));
function artifactParentsOf(roots: string[]): string[] {
  const parents = new Set<string>();
  for (const root of roots) {
    const parts = root.split("/");
    for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join("/"));
  }
  return [...parents];
}
export interface CleanupBudget { entries: number; bytes: number; elapsed: number; guard?: () => void }
export const createCleanupBudget = (guard?: () => void): CleanupBudget => ({ entries: 0, bytes: 0, elapsed: 0, guard });
export function cleanupPathWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
async function directBranch(access: CleanupAccess, cwd: string, branch: string): Promise<string> {
  const tip = await access.branchTip(cwd, branch);
  const row = (await access.git(cwd, ["for-each-ref", "--format=%(refname)%00%(symref)", `refs/heads/${branch}`])).split("\n")
    .find((line) => line.split("\0")[0] === `refs/heads/${branch}`);
  if (!row || row.split("\0")[1]) throw new Error("Cleanup refuses symbolic branch refs");
  return tip;
}
function permittedRoots(policy: GitSettings): string[] {
  const roots = (policy.approvedArtifactRoots ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (roots.some((value) => !validRoot(value))) throw new Error("Invalid configured generated artifact list");
  return roots;
}
function validateRoots(roots: string[]) {
  if (!Array.isArray(roots) || new Set(roots).size !== roots.length
    || roots.some((name) => typeof name !== "string" || !validRoot(name))) throw new Error("Select distinct literal relative generated files or directories");
  const keys = roots.map(pathKey).sort();
  const selected = new Set<string>();
  for (const key of keys) {
    if (selected.has(key) || artifactParentsOf([key]).some((parent) => selected.has(parent))) throw new Error("Generated artifact roots cannot overlap or alias each other");
    selected.add(key);
  }
}
function directArtifactParents(roots: string[]): string[] {
  return [...new Set(roots.filter((root) => root.includes("/")).map((root) => root.slice(0, root.lastIndexOf("/"))))];
}
function selectedArtifact(name: string, roots: string[]): boolean {
  return roots.some((root) => name === root || name.startsWith(`${root}/`));
}
function statIdentity(path: string) {
  const stat = lstatSync(path, { bigint: true });
  return [String(stat.dev), String(stat.ino), String(stat.mode)];
}
function repositoryIdentityOf(access: CleanupAccess, cwd: string): string {
  const common = access.project(cwd);
  if (!common) throw new Error("Cleanup repository identity is unavailable");
  return digest([cwd, statIdentity(cwd), common, statIdentity(common)]);
}
/** Read-only bounded content inventory, never one JSON row per dependency in the approval. */
async function inventory(path: string, roots: string[], tracked: Set<string>, budget: CleanupBudget, artifactParents: string[], metadataParents: string[], explicitRoots: string[]) {
  const started = Date.now();
  const rootBefore = lstatSync(path, { bigint: true });
  const trackedDirectories = new Set<string>();
  for (const file of tracked) { const parts = file.split("/"); for (let i = 1; i < parts.length; i++) trackedDirectories.add(parts.slice(0, i).join("/")); }
  const parents = new Set(artifactParents);
  const mutableParents = new Set(metadataParents);
  const artifactParentMetadata: CleanupSnapshot["artifactParentMetadata"] = [];
  const artifactParentIdentities: CleanupDirectoryIdentity[] = [{ path: "", identity: directoryIdentity(rootBefore) }];
  const trackedKeys = new Set([...tracked, ...trackedDirectories].map(pathKey));
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let entries = 0;
  const bound = () => {
    budget.guard?.();
  };
  const names = (directory: string) => sortedDirectoryNames(directory, bound);
  const tree = createHash("sha256");
  const artifacts = roots.map((name) => ({ path: name, entries: 0, bytes: 0, hash: createHash("sha256") }));
  const byRoot = new Map(artifacts.map((entry) => [entry.path, entry]));
  const device = lstatSync(path).dev;
  // Reject Linux bind mounts as well as different-device mounts. Other platforms
  // still reject device changes and symlink/reparse directories.
  const mounts = process.platform === "linux" ? readFileSync("/proc/self/mountinfo", "utf8").split("\n").filter(Boolean).map((line) =>
    line.split(" ")[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))) : [];
  if (mounts.some((mount) => cleanupPathWithin(path, mount))) throw new Error("Mounted cleanup resources are unsupported");
  const visit = async (name: string, inheritedArtifact?: typeof artifacts[number]): Promise<void> => {
    const absolute = join(path, name);
    const stat = lstatSync(absolute, { bigint: true });
    entries++; budget.entries++; bound();
    if (entries % 128 === 0) await setImmediate();
    if (Number(stat.dev) !== device) throw new Error("Cleanup crosses a mounted filesystem");
    const artifact = byRoot.get(name) ?? inheritedArtifact;
    const hash = artifact?.hash ?? tree;
    if (name.split("/").some((part) => rootKey(part) === ".git") && name !== ".git") throw new Error("Nested repository in cleanup resources");
    if (!artifact && name !== ".git" && (stat.isDirectory()
      ? !trackedDirectories.has(name) && !parents.has(name) : !tracked.has(name))) throw new Error(`Unknown cleanup resource: ${name}`);
    // Direct parents change size/timestamps after an approved child deletion.
    // Keep those fields separately, still strict before approval/first effect;
    // between effects only completed deletions exempt their own direct parents.
    // Identity/mode and all non-artifact entries/content remain bound in tree.
    if (!artifact && stat.isDirectory() && parents.has(name)) artifactParentIdentities.push({ path: name, identity: directoryIdentity(stat) });
    const structuralParent = !artifact && stat.isDirectory() && mutableParents.has(name);
    const metadata = [String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)];
    if (structuralParent) artifactParentMetadata.push({ path: name, digest: digest(metadata) });
    hash.update(JSON.stringify([name, String(stat.dev), String(stat.ino), String(stat.mode),
      ...(structuralParent ? [] : metadata)]));
    if (artifact) artifact.entries++;
    if (stat.isSymbolicLink()) {
      if (roots.includes(name)) throw new Error("Generated artifact roots cannot be symlinks");
      hash.update(readlinkSync(absolute)); // Never follow a link, including one outside this checkout.
    } else if (stat.isDirectory()) {
      for await (const child of names(absolute)) await visit(`${name}/${child}`, artifact);
    } else if (stat.isFile()) {
      budget.bytes += Number(stat.size); bound();
      if (artifact) artifact.bytes += Number(stat.size);
      const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = fstatSync(fd, { bigint: true });
        if (before.ino !== stat.ino || before.dev !== stat.dev || !before.isFile()) throw new Error("Cleanup file changed during inventory");
        let count: number; let chunks = 0;
        while ((count = readSync(fd, buffer, 0, buffer.length, null))) {
          bound(); hash.update(buffer.subarray(0, count));
          if (++chunks % 4 === 0) await setImmediate();
        }
        const after = fstatSync(fd, { bigint: true });
        if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) throw new Error("Cleanup file changed during inventory");
      } finally { closeSync(fd); }
    } else throw new Error("Special cleanup files are unsupported");
    const after = lstatSync(absolute, { bigint: true });
    if (after.ino !== stat.ino || after.dev !== stat.dev || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) throw new Error("Cleanup resource changed during inventory");
  };
  try {
    // Validate every component before reading below it: no aliased entry or
    // symlink ancestor may redirect inventory/deletion outside the worktree.
    // Discovery must not hide a typo, alias or symlink in an explicit child
    // by replacing it with a valid wholly ignored parent.
    for (const root of new Set([...roots, ...explicitRoots])) {
      let directory = path; let prefix = "";
      const parts = root.split("/");
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]; prefix = prefix ? `${prefix}/${part}` : part;
        let exact = false;
        for await (const name of names(directory)) if (name === part) { exact = true; break; }
        if (!exact) throw new Error(`Artifact must match an exact directory entry: ${prefix}`);
        if (trackedKeys.has(pathKey(prefix)) && (i === parts.length - 1 || !trackedDirectories.has(prefix))) throw new Error("Generated roots cannot include or alias tracked source");
        const absolute = join(directory, part);
        const stat = lstatSync(absolute);
        if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isDirectory() && !stat.isFile()) throw new Error("Select existing regular generated files or directories only; symlink roots and ancestors are refused");
        directory = absolute;
      }
    }
    for await (const name of names(path)) await visit(name);
    if (artifacts.some((item) => item.entries === 0)) throw new Error("Artifact root was not inventoried; resources retained");
    const rootAfter = lstatSync(path, { bigint: true });
    if (rootAfter.ino !== rootBefore.ino || rootAfter.dev !== rootBefore.dev || rootAfter.mtimeNs !== rootBefore.mtimeNs || rootAfter.ctimeNs !== rootBefore.ctimeNs) throw new Error("Cleanup root changed during inventory");
    return { tree: tree.digest("hex"), artifactParentMetadata, artifactParentIdentities, artifacts: artifacts.map(({ hash, ...entry }) => ({ ...entry, digest: hash.digest("hex") })) };
  } finally { budget.elapsed += Date.now() - started; }
}
async function* gitRecords(access: CleanupAccess, cwd: string, args: string[]) {
  if (access.records) yield* access.records(cwd, args);
  else for (const record of (await access.git(cwd, args)).split("\0")) if (record) yield record;
}
async function assertSourceClean(access: CleanupAccess, path: string, roots: string[]) {
  for await (const change of gitRecords(access, path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) {
    if (access.rejectUnignoredUntracked || !change.startsWith("?? ") || !selectedArtifact(change.slice(3), roots)) throw new Error("Cleanup worktree has source changes or unapproved untracked files");
  }
}
interface ResourceOperation {
  checkout: string; subject: DiscardSubject; worktreePath?: string;
  removeWorktree: boolean; deleteBranch: boolean; artifactRoots: string[];
}
type FrozenStructure = Pick<CleanupSnapshot, "artifactParents" | "artifactParentMetadata" | "lossEvidence">;
interface ResourceRules {
  target: string;
  binding: unknown;
  protectedBranches: string[];
  verify(cwd: string): Promise<void>;
  artifacts(roots: string[]): void;
}
function cleanupResources(op: CleanupOperation): ResourceOperation {
  return { ...op, subject: { kind: "branch", branch: op.featureBranch, tip: op.featureTip } };
}
async function assertWorktreeSubject(access: CleanupAccess, path: string, entry: WorktreeRecord, subject: DiscardSubject) {
  let ref: string | undefined;
  try { ref = (await access.git(path, ["symbolic-ref", "--quiet", "HEAD"])).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  const tip = (await access.git(path, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (!oid.test(tip) || entry.head !== tip) throw new Error("Worktree HEAD or registration is invalid or changed");
  if (subject.kind === "detached") {
    if (ref !== undefined || entry.branch !== undefined || !entry.detached || tip !== subject.head) throw new Error("Detached HEAD moved or reattached; resources retained");
  } else if (ref !== `refs/heads/${subject.branch}` || entry.branch !== subject.branch || entry.detached || tip !== subject.tip) {
    throw new Error("Feature worktree HEAD or branch changed; resources retained");
  }
}
/** Structural safety is shared; eligibility rules are trusted plugin code, never JSON switches. */
async function captureResources(callerCwd: string, op: ResourceOperation, policy: GitSettings, access: CleanupAccess, rules: ResourceRules,
  budget: CleanupBudget, discoverArtifacts: boolean, frozenStructure?: FrozenStructure): Promise<CleanupSnapshot> {
  if (!oid.test(op.subject.kind === "branch" ? op.subject.tip : op.subject.head)) throw new Error("Cleanup requires full exact subject commit IDs");
  validateRoots(op.artifactRoots);
  let roots = [...op.artifactRoots];
  const permitted = permittedRoots(policy);
  if (typeof op.removeWorktree !== "boolean" || typeof op.deleteBranch !== "boolean") throw new Error("Cleanup resource choices must be explicit");
  if (op.subject.kind === "detached" && (!op.removeWorktree || op.deleteBranch || !op.worktreePath)) throw new Error("Detached discard removes only its exact worktree");
  rules.artifacts(roots);
  // Arguments/discovery propose resources, never grant permission. The server
  // requires a live one-time approval for every root absent from the allowlist,
  // including when the operation's configured permission is Allow.
  const cwd = await access.checkout(op.checkout);
  if (!samePath(cwd, resolve(op.checkout))) throw new Error("Cleanup checkout must be physical, without symlink aliases");
  const repositoryIdentity = repositoryIdentityOf(access, cwd);
  const verifySubject = async () => {
    if (op.subject.kind === "branch" && await directBranch(access, cwd, op.subject.branch) !== op.subject.tip) throw new Error("Feature branch changed; cleanup refused");
    await rules.verify(cwd);
  };
  await verifySubject();
  const registrations = await access.worktrees(cwd);
  if (!registrations.length) throw new Error("Cleanup registration inventory is unavailable");
  if (op.subject.kind === "branch" && rules.protectedBranches.includes(op.subject.branch)) throw new Error("Never discard the designated or comparison target branch");
  let path: string | undefined; let files: Awaited<ReturnType<typeof inventory>> | undefined; let identity: unknown;
  let capturedEntry: WorktreeRecord | undefined;
  let artifactParents = frozenStructure?.artifactParents ?? artifactParentsOf(roots);
  let metadataParents = frozenStructure?.artifactParentMetadata.map((item) => item.path) ?? directArtifactParents(roots);
  if (op.worktreePath) {
    if (!isAbsolute(op.worktreePath) || lstatSync(op.worktreePath).isSymbolicLink()) throw new Error("Select a physical absolute linked worktree");
    path = await access.checkout(op.worktreePath, cwd);
    if (!samePath(path, resolve(op.worktreePath))) throw new Error("Cleanup path must be physical, without symlink parents");
    const entry = registrations.find((item) => samePath(item.path, path!));
    const callerWithin = cleanupPathWithin(path, existsSync(callerCwd) ? realpathSync(callerCwd) : resolve(callerCwd));
    if (!entry || entry.locked !== undefined || entry.prunable !== undefined
      || samePath(path, registrations[0].path) || samePath(path, cwd)
      || callerWithin) throw new Error("Never clean main/caller, locked, prunable or changed worktrees");
    capturedEntry = entry;
    await assertWorktreeSubject(access, path, entry, op.subject);
    if (access.inUse(path)) throw new Error("Cleanup worktree is in active use");
    if (op.removeWorktree && discoverArtifacts) {
      // Preserve exact Git paths, including nested caches. Git may collapse a
      // wholly ignored directory; never promote a path to a source parent.
      const discovered = new Set(roots);
      for await (const name of gitRecords(access, path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])) {
        const root = name.replace(/\/$/, "");
        if (root) discovered.add(root);
      }
      // If Git reports an ignored parent of an explicit child, inventory it once
      // and show that actual parent in approval, never delete overlapping roots.
      roots = [...discovered].filter((root) => !artifactParentsOf([root]).some((parent) => discovered.has(parent)));
      validateRoots(roots);
      artifactParents = artifactParentsOf(roots);
      metadataParents = directArtifactParents(roots);
    }
    rules.artifacts(roots);
    if (roots.some((root) => root.includes("/")) && !supportsNestedCleanup()) throw new Error("Nested cleanup requires Linux no-follow directory handles; resources retained");
    await assertSourceClean(access, path, roots);
    const tracked = new Set<string>();
    for await (const name of gitRecords(access, path, ["ls-files", "--cached", "-z"])) if (name) tracked.add(name);
    files = await inventory(path, roots, tracked, budget, artifactParents, metadataParents, op.artifactRoots);
    if (access.inUse(path)) throw new Error("Cleanup worktree became active during inventory");
    const currentEntry = (await access.worktrees(cwd)).find((item) => samePath(item.path, path!));
    if (!currentEntry || digest(currentEntry) !== digest(entry) || !samePath(await access.checkout(path, cwd), path)) throw new Error("Worktree registration changed during inventory");
    await assertWorktreeSubject(access, path, currentEntry, op.subject);
    await assertSourceClean(access, path, roots);
    const admin = (await access.git(path, ["rev-parse", "--absolute-git-dir"])).trim();
    identity = [path, entry, statIdentity(path), realpathSync(admin), statIdentity(admin), files.tree];
  } else if (op.removeWorktree || op.artifactRoots.length) throw new Error("Select the feature worktree for artifact cleanup");
  const selectedBranch = op.subject.kind === "branch" ? op.subject.branch : undefined;
  if (op.deleteBranch && registrations.some((entry) => entry.branch === selectedBranch && (!op.removeWorktree || !path || !samePath(entry.path, path)))) throw new Error("Cannot delete a branch retained in a registered worktree");
  // Target tip deliberately excluded: eligibility proves reachability, not an
  // unrelated advancement of a target that this operation never writes.
  if (!samePath(await access.checkout(op.checkout), cwd) || repositoryIdentity !== repositoryIdentityOf(access, cwd)) throw new Error("Repository changed during inventory");
  await verifySubject();
  if (path) {
    const finalEntry = (await access.worktrees(cwd)).find((entry) => samePath(entry.path, path!));
    if (!finalEntry || digest(finalEntry) !== digest(capturedEntry)) throw new Error("Worktree registration changed during capture");
    await assertWorktreeSubject(access, path, finalEntry, op.subject);
    if (access.inUse(path)) throw new Error("Cleanup worktree became active during capture");
  }
  const bound = digest([repositoryIdentity, rules.binding, op.subject, identity]);
  return { cwd, target: rules.target, path, repositoryIdentity, identity: bound, artifacts: files?.artifacts ?? [],
    artifactParents, artifactParentMetadata: files?.artifactParentMetadata ?? [], artifactParentIdentities: files?.artifactParentIdentities ?? [],
    unapprovedArtifacts: roots.filter((root) => !permitted.includes(root)), fingerprint: digest([bound, files?.artifacts ?? [], files?.artifactParentMetadata ?? []]) };
}
export async function captureCleanup(callerCwd: string, op: CleanupOperation, policy: GitSettings, access: CleanupAccess,
  budget = createCleanupBudget(), discoverArtifacts = true, frozenStructure?: FrozenStructure): Promise<CleanupSnapshot> {
  if (!oid.test(op.featureTip) || !oid.test(op.integrationCommit)) throw new Error("Cleanup requires full exact feature and integration commit IDs");
  const target = policy.targetBranch;
  if (!target || target === op.featureBranch) throw new Error("Select a distinct integration target");
  if (op.removeWorktree && policy.cleanupWorktree === "keep" || op.deleteBranch && policy.cleanupBranch === "keep"
    || op.artifactRoots.length && policy.cleanupArtifacts === "keep") throw new Error("Cleanup conflicts with a configured Keep choice");
  return captureResources(callerCwd, cleanupResources(op), policy, access, {
    target, binding: [target, op.integrationCommit], protectedBranches: [target],
    verify: async (cwd) => {
      await access.git(cwd, ["merge-base", "--is-ancestor", op.featureTip, op.integrationCommit]);
      await access.git(cwd, ["merge-base", "--is-ancestor", op.integrationCommit, await directBranch(access, cwd, target)]);
    },
    artifacts: (roots) => { if (roots.length && policy.cleanupArtifacts === "keep") throw new Error("Cleanup conflicts with a configured Keep choice; artifact resources retained"); },
  }, budget, discoverArtifacts, frozenStructure);
}
/** A configured symbolic target can alias a different subject spelling. Refuse
 * conservatively, including dangling symbolic refs; an absent direct ref is OK.
 * This checks designation safety, not graph availability or target existence. */
async function assertDirectDesignatedTarget(access: CleanupAccess, cwd: string, branch: string | null) {
  if (!branch) return;
  let referent: string;
  try { referent = (await access.git(cwd, ["symbolic-ref", "--quiet", `refs/heads/${branch}`])).trim(); }
  catch (error) {
    if ((error as { status?: number }).status === 1) return; // Direct or missing.
    throw error; // Cancellation/read failures cannot silently relax protection.
  }
  throw new Error(`Manual discard refuses symbolic designated targets (${branch} -> ${referent}); resources retained`);
}
/** Comparison ref identity does not require its graph objects to be readable. */
async function comparisonRefTip(access: CleanupAccess, cwd: string, branch: string): Promise<string> {
  await access.git(cwd, ["check-ref-format", `refs/heads/${branch}`]);
  const row = (await access.git(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", `refs/heads/${branch}`])).split("\n")
    .map((line) => line.split("\0")).find((parts) => parts[0] === `refs/heads/${branch}`);
  if (!row || !oid.test(row[1]) || row[2]) throw new Error("Comparison target ref changed or is symbolic; refresh inventory");
  return row[1];
}
async function contains(access: CleanupAccess, cwd: string, feature: string, target: string): Promise<"yes" | "no" | "unknown"> {
  try { await access.git(cwd, ["merge-base", "--is-ancestor", feature, target]); return "yes"; }
  catch (error) {
    if ((error as { status?: number }).status === 1) {
      try { if ((await access.git(cwd, ["rev-parse", "--is-shallow-repository"])).trim() === "false") return "no"; } catch { /* Evidence unavailable, not deletion authority. */ }
    }
    return "unknown";
  }
}
export async function captureBrowserDiscard(callerCwd: string, op: BrowserDiscardOperation, policy: GitSettings, access: CleanupAccess,
  budget = createCleanupBudget(), discoverArtifacts = true, frozenStructure?: FrozenStructure): Promise<CleanupSnapshot> {
  const comparison = op.comparisonTarget;
  const requiresProof = op.deleteBranch && frozenStructure?.lossEvidence?.state === "integrated";
  const preparedComparison = frozenStructure?.lossEvidence?.comparisonTarget;
  if (requiresProof && (!comparison || !preparedComparison || digest(comparison) !== digest(preparedComparison))) {
    throw new Error("Originally proven comparison ref binding changed; remaining resources retained");
  }
  let lossEvidence: DiscardLossEvidence = { state: "unknown", reason: "no-comparison-target" };
  let verifiedComparison: CleanupSnapshot["verifiedComparison"];
  const protectedBranches = [policy.targetBranch, comparison?.branch].filter((branch): branch is string => !!branch);
  const snapshot = await captureResources(callerCwd, op, policy, access, {
    target: comparison?.branch ?? "", binding: ["browser-discard", comparison, protectedBranches], protectedBranches,
    verify: async (cwd) => {
      budget.guard?.();
      await assertDirectDesignatedTarget(access, cwd, policy.targetBranch);
      if (comparison) {
        const targetTip = await comparisonRefTip(access, cwd, comparison.branch);
        if (!frozenStructure && targetTip !== comparison.tip) throw new Error("Captured comparison target changed; refresh inventory");
        const tip = op.subject.kind === "branch" ? op.subject.tip : op.subject.head;
        const contained = await contains(access, cwd, tip, comparison.tip);
        const retained = await contains(access, cwd, comparison.tip, targetTip);
        lossEvidence = { comparisonTarget: comparison,
          state: retained === "yes" && contained === "yes" ? "integrated" : retained === "yes" && contained === "no" ? "not-integrated" : "unknown",
          ...(retained !== "yes" ? { reason: "comparison-proof-lost" } : contained === "unknown" ? { reason: "graph-unavailable-or-incomplete" } : {}) };
        verifiedComparison = lossEvidence.state === "integrated" ? { branch: comparison.branch, tip: targetTip } : undefined;
      }
      budget.guard?.();
      if (requiresProof && lossEvidence.state !== "integrated") throw new Error("Originally proven branch integration is no longer reachable; remaining resources retained");
      const registrations = await access.worktrees(cwd);
      const subject = op.subject;
      if (subject.kind === "branch" && registrations.some((entry, index) => entry.branch === subject.branch && (index === 0 || samePath(entry.path, cwd)
        || cleanupPathWithin(entry.path, existsSync(callerCwd) ? realpathSync(callerCwd) : resolve(callerCwd))))) throw new Error("Never discard main, selected or invocation resources");
      // This list is fresh at the end of capture too. The structural inventory's
      // earlier list cannot authorize deletion after another checkout appears.
      if (op.deleteBranch && subject.kind === "branch" && registrations.some((entry) => entry.branch === subject.branch
        && (!op.removeWorktree || !op.worktreePath || !samePath(entry.path, op.worktreePath)))) throw new Error("Cannot delete a branch retained in a registered worktree");
    },
    // Completed-feature Keep preferences are not manual discard permissions.
    artifacts: () => {},
  }, budget, discoverArtifacts, frozenStructure);
  if (op.deleteBranch && lossEvidence.state === "integrated" && (!frozenStructure || requiresProof)) {
    // prepare/commit exist since 2.27, but pre-2.34 versions can fail to flush
    // prepare acknowledgments. Refuse conservatively without a no-op write probe.
    const version = /\bgit version (\d+)\.(\d+)\./.exec(await access.git(snapshot.cwd, ["--version"]));
    if (!version || Number(version[1]) < 2 || Number(version[1]) === 2 && Number(version[2]) < 34) {
      throw new Error("Proven browser branch deletion requires Git 2.34 or newer for prepared no-deref ref verification; resources retained");
    }
    budget.guard?.();
  }
  return { ...snapshot, lossEvidence, verifiedComparison };
}
async function performResources(op: ResourceOperation, access: CleanupAccess,
  snapshot: CleanupSnapshot, guardPolicy: () => void, runGit: CleanupGitRunner, effects: string[],
  onDispatch: (description: string) => void, onCompleted: (() => void) | undefined,
  recapture: (remaining: string[], branchOnly?: boolean) => Promise<CleanupSnapshot>, designatedTarget: string | null = null): Promise<string> {
  // Freeze the exact prepared list. Later ignored files are NOT discovered or
  // implicitly added under an earlier approval.
  let remaining = snapshot.artifacts.map((item) => item.path);
  const changedParents = new Set<string>();
  const revalidate = async () => {
    guardPolicy();
    const current = await recapture(remaining);
    if (current.identity !== snapshot.identity || current.artifactParentMetadata.some((item) =>
      !changedParents.has(item.path) && item.digest !== snapshot.artifactParentMetadata.find((original) => original.path === item.path)?.digest)
      || current.artifacts.some((item) =>
      digest(item) !== digest(snapshot.artifacts.find((original) => original.path === item.path)))) throw new Error("Cleanup resources changed; remaining resources retained");
    guardPolicy();
  };
  for (const root of snapshot.artifacts.map((item) => item.path)) {
    await revalidate();
    // Hold physical ancestors across the destructive call. An external rename
    // or symlink substitution cannot redirect nested rm to an outside target.
    const held = root.includes("/") ? holdCleanupParent(snapshot.path!, root, snapshot.artifactParentIdentities) : undefined;
    try {
      guardPolicy(); held?.validate();
      onDispatch(`Remove generated artifact: ${root}`);
      await rm(held?.path ?? join(snapshot.path!, root), { recursive: true });
    } finally { held?.close(); }
    effects.push(`Removed generated artifact: ${root}`);
    onCompleted?.();
    if (root.includes("/")) changedParents.add(root.slice(0, root.lastIndexOf("/")));
    remaining = remaining.filter((name) => name !== root);
  }
  await revalidate();
  if (op.removeWorktree) {
    onDispatch(`Remove worktree: ${snapshot.path}`);
    await runGit(["worktree", "remove", snapshot.path!]);
    effects.push(`Removed worktree: ${snapshot.path}`);
    onCompleted?.();
    if (existsSync(snapshot.path!) || (await access.worktrees(snapshot.cwd)).some((entry) => samePath(entry.path, snapshot.path!))) throw new Error("Worktree removal did not settle as expected");
  }
  if (op.deleteBranch) {
    guardPolicy();
    const current = await recapture([], true);
    if (current.target !== snapshot.target || current.repositoryIdentity !== snapshot.repositoryIdentity) throw new Error("Cleanup repository or target changed");
    guardPolicy();
    if (op.subject.kind !== "branch") throw new Error("Detached worktrees have no branch deletion effect");
    const subject = op.subject;
    let transaction: CleanupGitTransaction | undefined;
    if (snapshot.lossEvidence?.state === "integrated") {
      // Only browser approvals exempted from the loss checkbox require this
      // extra proof binding. Agent cleanup's native conditional deletion stays unchanged.
      const comparison = current.verifiedComparison;
      const approvedComparison = snapshot.lossEvidence.comparisonTarget;
      if (!comparison || !approvedComparison || current.lossEvidence?.state !== "integrated") throw new Error("Originally proven comparison ref binding lost; remaining resources retained");
      transaction = {
        input: ["start", `verify refs/heads/${comparison.branch}`, comparison.tip,
          `delete refs/heads/${subject.branch}`, subject.tip, "prepare", ""].join("\0"),
        verifyPrepared: async () => {
          guardPolicy();
          await assertDirectDesignatedTarget(access, snapshot.cwd, designatedTarget);
          // --no-deref OID verification alone accepts a same-tip symref.
          // Native prepare holds both ref locks while these direct-ref checks
          // reject symbolic replacements, including same-tip and dangling refs.
          if (await comparisonRefTip(access, snapshot.cwd, comparison.branch) !== comparison.tip
            || await directBranch(access, snapshot.cwd, subject.branch) !== subject.tip) throw new Error("Prepared branch or comparison ref changed; remaining resources retained");
          if (await contains(access, snapshot.cwd, subject.tip, approvedComparison.tip) !== "yes"
            || await contains(access, snapshot.cwd, approvedComparison.tip, comparison.tip) !== "yes") throw new Error("Originally proven branch integration is no longer reachable; remaining resources retained");
          if ((await access.worktrees(snapshot.cwd)).some((entry) => entry.branch === subject.branch)) throw new Error("Cannot delete a branch retained in a registered worktree");
          guardPolicy();
        },
      };
    }
    // Exact local ref CAS only: no -D fallback, upstream heuristic or config cleanup.
    onDispatch(`Delete local branch: ${subject.branch}`);
    if (!transaction && snapshot.lossEvidence) {
      // Loss acknowledgment does not waive designated-target protection. Check
      // after the receipt callback, which can outlive the final recapture.
      guardPolicy();
      await assertDirectDesignatedTarget(access, snapshot.cwd, designatedTarget);
      guardPolicy();
    }
    await runGit(transaction ? ["update-ref", "--no-deref", "--stdin", "-z"]
      : ["update-ref", "--no-deref", "-d", `refs/heads/${subject.branch}`, subject.tip], transaction);
    effects.push(`Deleted local branch: ${op.subject.branch} at ${op.subject.tip}`);
    onCompleted?.();
    if ((await access.git(snapshot.cwd, ["for-each-ref", "--format=%(refname)", `refs/heads/${op.subject.branch}`])).split("\n").includes(`refs/heads/${op.subject.branch}`)) throw new Error("Branch deletion did not settle as expected");
  }
  return effects.join("\n");
}
export async function performCleanup(callerCwd: string, op: CleanupOperation, policy: GitSettings, access: CleanupAccess,
  snapshot: CleanupSnapshot, guardPolicy: () => void, runGit: CleanupGitRunner, effects: string[],
  onDispatch: (description: string) => void, budget: CleanupBudget, onCompleted?: () => void): Promise<string> {
  return performResources(cleanupResources(op), access, snapshot, guardPolicy, runGit, effects, onDispatch, onCompleted,
    (remaining, branchOnly) => captureCleanup(callerCwd, { ...op, artifactRoots: remaining,
      ...(branchOnly ? { worktreePath: undefined, removeWorktree: false } : {}) }, policy, access, budget, false, snapshot));
}
export async function performBrowserDiscard(callerCwd: string, op: BrowserDiscardOperation, policy: GitSettings, access: CleanupAccess,
  snapshot: CleanupSnapshot, guardPolicy: () => void, runGit: CleanupGitRunner, effects: string[],
  onDispatch: (description: string) => void, budget: CleanupBudget, onCompleted?: () => void): Promise<string> {
  return performResources(op, access, snapshot, guardPolicy, runGit, effects, onDispatch, onCompleted,
    (remaining, branchOnly) => captureBrowserDiscard(callerCwd, { ...op, artifactRoots: remaining,
      ...(branchOnly ? { worktreePath: undefined, removeWorktree: false } : {}) }, policy, access, budget, false, snapshot), policy.targetBranch);
}
