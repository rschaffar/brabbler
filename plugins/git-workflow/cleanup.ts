import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readlinkSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { sortedDirectoryNames } from "./inventory-names";
import { setImmediate } from "node:timers/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { samePath } from "../../lib/paths";
import type { GitSettings } from "./manifest";

export interface CleanupOperation {
  action: "cleanupFeature"; checkout: string; featureBranch: string; featureTip: string;
  integrationCommit: string; targetBranch?: string; worktreePath?: string;
  removeWorktree: boolean; deleteBranch: boolean; artifactRoots: string[];
}
export interface WorktreeRecord { path: string; branch?: string; locked?: string; prunable?: string }
export interface CleanupAccess {
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
  path?: string; cwd: string; target: string;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const oid = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const rootName = /^[a-zA-Z0-9_.-]+$/;
// Conservative on every platform, including Windows case/trailing-dot aliases.
const rootKey = (name: string) => name.replace(/[. ]+$/g, "").toLowerCase();
const validRoot = (name: string) => rootName.test(name) && !["", ".git"].includes(rootKey(name));
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
    || roots.some((name) => typeof name !== "string" || !validRoot(name))) throw new Error("Select distinct literal top-level generated files or directories");
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
async function inventory(path: string, roots: string[], tracked: Set<string>, budget: CleanupBudget) {
  const started = Date.now();
  const rootBefore = lstatSync(path, { bigint: true });
  const trackedDirectories = new Set<string>();
  for (const file of tracked) { const parts = file.split("/"); for (let i = 1; i < parts.length; i++) trackedDirectories.add(parts.slice(0, i).join("/")); }
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
  const visit = async (name: string): Promise<void> => {
    const absolute = join(path, name);
    const stat = lstatSync(absolute, { bigint: true });
    entries++; budget.entries++; bound();
    if (entries % 128 === 0) await setImmediate();
    if (Number(stat.dev) !== device) throw new Error("Cleanup crosses a mounted filesystem");
    const artifact = byRoot.get(name.split("/")[0]);
    const hash = artifact?.hash ?? tree;
    if (name.split("/").some((part) => rootKey(part) === ".git") && name !== ".git") throw new Error("Nested repository in cleanup resources");
    if (!artifact && name !== ".git" && (stat.isDirectory()
      ? !trackedDirectories.has(name) : !tracked.has(name))) throw new Error(`Unknown cleanup resource: ${name}`);
    hash.update(JSON.stringify([name, String(stat.dev), String(stat.ino), String(stat.mode), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]));
    if (artifact) artifact.entries++;
    if (stat.isSymbolicLink()) {
      if (roots.includes(name)) throw new Error("Generated artifact roots cannot be symlinks");
      hash.update(readlinkSync(absolute)); // Never follow a link, including one outside this checkout.
    } else if (stat.isDirectory()) {
      for await (const child of names(absolute)) await visit(`${name}/${child}`);
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
    const topEntries = new Set<string>();
    for await (const name of names(path)) topEntries.add(name);
    const trackedRoots = new Set([...tracked].map((file) => rootKey(file.split("/")[0])));
    for (const root of roots) {
      // lstat alone accepts alternate spellings on case-insensitive filesystems.
      // Require the literal enumerated entry, not an alias with an empty inventory.
      if (!topEntries.has(root)) throw new Error(`Artifact must match an exact top-level entry: ${root}`);
      if (trackedRoots.has(rootKey(root))) throw new Error("Generated roots cannot include or alias tracked source");
      const stat = lstatSync(join(path, root));
      if (!stat.isDirectory() && !stat.isFile()) throw new Error("Select existing regular generated files or directories only; symlink roots are refused");
    }
    for await (const name of names(path)) await visit(name);
    if (artifacts.some((item) => item.entries === 0)) throw new Error("Artifact root was not inventoried; resources retained");
    const rootAfter = lstatSync(path, { bigint: true });
    if (rootAfter.ino !== rootBefore.ino || rootAfter.dev !== rootBefore.dev || rootAfter.mtimeNs !== rootBefore.mtimeNs || rootAfter.ctimeNs !== rootBefore.ctimeNs) throw new Error("Cleanup root changed during inventory");
    return { tree: tree.digest("hex"), artifacts: artifacts.map(({ hash, ...entry }) => ({ ...entry, digest: hash.digest("hex") })) };
  } finally { budget.elapsed += Date.now() - started; }
}
async function* gitRecords(access: CleanupAccess, cwd: string, args: string[]) {
  if (access.records) yield* access.records(cwd, args);
  else for (const record of (await access.git(cwd, args)).split("\0")) if (record) yield record;
}
async function assertSourceClean(access: CleanupAccess, path: string, roots: string[]) {
  for await (const change of gitRecords(access, path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) {
    if (!change.startsWith("?? ") || !selectedArtifact(change.slice(3), roots)) throw new Error("Cleanup worktree has source changes or unapproved untracked files");
  }
}
export async function captureCleanup(callerCwd: string, op: CleanupOperation, policy: GitSettings, access: CleanupAccess, budget = createCleanupBudget(), discoverArtifacts = true): Promise<CleanupSnapshot> {
  if (!oid.test(op.featureTip) || !oid.test(op.integrationCommit)) throw new Error("Cleanup requires full exact feature and integration commit IDs");
  validateRoots(op.artifactRoots);
  let roots = [...op.artifactRoots];
  const permitted = permittedRoots(policy);
  if (typeof op.removeWorktree !== "boolean" || typeof op.deleteBranch !== "boolean") throw new Error("Cleanup resource choices must be explicit");
  if (op.removeWorktree && policy.cleanupWorktree === "keep" || op.deleteBranch && policy.cleanupBranch === "keep"
    || op.artifactRoots.length && policy.cleanupArtifacts === "keep") throw new Error("Cleanup conflicts with a configured Keep choice");
  // Arguments/discovery propose resources, never grant permission. The server
  // requires a live one-time approval for every root absent from the allowlist,
  // including when the operation's configured permission is Allow.
  const cwd = await access.checkout(op.checkout);
  if (!samePath(cwd, resolve(op.checkout))) throw new Error("Cleanup checkout must be physical, without symlink aliases");
  const repositoryIdentity = repositoryIdentityOf(access, cwd);
  const target = policy.targetBranch;
  if (!target || target === op.featureBranch) throw new Error("Select a distinct integration target");
  if (await directBranch(access, cwd, op.featureBranch) !== op.featureTip) throw new Error("Feature branch changed; cleanup refused");
  const targetTip = await directBranch(access, cwd, target);
  await access.git(cwd, ["merge-base", "--is-ancestor", op.featureTip, op.integrationCommit]);
  await access.git(cwd, ["merge-base", "--is-ancestor", op.integrationCommit, targetTip]);
  const registrations = await access.worktrees(cwd);
  let path: string | undefined; let files: Awaited<ReturnType<typeof inventory>> | undefined; let identity: unknown;
  if (op.worktreePath) {
    if (!isAbsolute(op.worktreePath) || lstatSync(op.worktreePath).isSymbolicLink()) throw new Error("Select a physical absolute linked worktree");
    path = await access.checkout(op.worktreePath, cwd);
    if (!samePath(path, resolve(op.worktreePath))) throw new Error("Cleanup path must be physical, without symlink parents");
    const entry = registrations.find((item) => samePath(item.path, path!));
    const callerWithin = cleanupPathWithin(path, existsSync(callerCwd) ? realpathSync(callerCwd) : resolve(callerCwd));
    if (!entry || entry.branch !== op.featureBranch || entry.locked !== undefined || entry.prunable !== undefined
      || samePath(path, registrations[0].path) || samePath(path, cwd)
      || callerWithin) throw new Error("Never clean main/caller, locked, prunable or changed worktrees");
    if (access.inUse(path)) throw new Error("Cleanup worktree is in active use");
    if (op.removeWorktree && discoverArtifacts) {
      // Git collapses wholly ignored directories. Never promote a nested ignored
      // file to its parent: that could sweep in unrelated untracked/source files.
      const discovered = new Set(roots);
      for await (const name of gitRecords(access, path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])) {
        const top = name.replace(/\/$/, "");
        if (top && !top.includes("/")) discovered.add(top);
      }
      roots = [...discovered];
      validateRoots(roots);
    }
    if (roots.length && policy.cleanupArtifacts === "keep") throw new Error("Cleanup conflicts with a configured Keep choice; artifact resources retained");
    await assertSourceClean(access, path, roots);
    const tracked = new Set<string>();
    for await (const name of gitRecords(access, path, ["ls-files", "--cached", "-z"])) if (name) tracked.add(name);
    files = await inventory(path, roots, tracked, budget);
    if (access.inUse(path)) throw new Error("Cleanup worktree became active during inventory");
    const currentEntry = (await access.worktrees(cwd)).find((item) => samePath(item.path, path!));
    if (digest(currentEntry) !== digest(entry) || !samePath(await access.checkout(path, cwd), path)) throw new Error("Worktree registration changed during inventory");
    await assertSourceClean(access, path, roots);
    const admin = (await access.git(path, ["rev-parse", "--absolute-git-dir"])).trim();
    identity = [path, entry, statIdentity(path), realpathSync(admin), statIdentity(admin), files.tree];
  } else if (op.removeWorktree || op.artifactRoots.length) throw new Error("Select the feature worktree for artifact cleanup");
  if (op.deleteBranch && registrations.some((entry) => entry.branch === op.featureBranch && (!op.removeWorktree || !path || !samePath(entry.path, path)))) throw new Error("Cannot delete a branch retained in a registered worktree");
  // Target tip deliberately excluded: reachability above is the invariant, not
  // unrelated advancement of a target that this operation never writes.
  if (!samePath(await access.checkout(op.checkout), cwd) || repositoryIdentity !== repositoryIdentityOf(access, cwd)
    || await directBranch(access, cwd, op.featureBranch) !== op.featureTip) throw new Error("Repository or feature changed during inventory");
  await access.git(cwd, ["merge-base", "--is-ancestor", op.integrationCommit, await directBranch(access, cwd, target)]);
  const bound = digest([repositoryIdentity, target, op.featureBranch, op.featureTip, op.integrationCommit, identity]);
  return { cwd, target, path, repositoryIdentity, identity: bound, artifacts: files?.artifacts ?? [],
    unapprovedArtifacts: roots.filter((root) => !permitted.includes(root)), fingerprint: digest([bound, files?.artifacts ?? []]) };
}
export async function performCleanup(callerCwd: string, op: CleanupOperation, policy: GitSettings, access: CleanupAccess,
  snapshot: CleanupSnapshot, guardPolicy: () => void, runGit: (args: string[]) => Promise<string>, effects: string[],
  onDispatch: (description: string) => void, budget: CleanupBudget): Promise<string> {
  // Freeze the exact prepared list. Later ignored files are NOT discovered or
  // implicitly added under an earlier approval.
  let remaining = snapshot.artifacts.map((item) => item.path);
  const revalidate = async () => {
    guardPolicy();
    const current = await captureCleanup(callerCwd, { ...op, artifactRoots: remaining }, policy, access, budget, false);
    if (current.identity !== snapshot.identity || current.artifacts.some((item) =>
      digest(item) !== digest(snapshot.artifacts.find((original) => original.path === item.path)))) throw new Error("Cleanup resources changed; remaining resources retained");
    guardPolicy();
  };
  for (const root of snapshot.artifacts.map((item) => item.path)) {
    await revalidate();
    onDispatch(`Remove generated artifact: ${root}`);
    await rm(join(snapshot.path!, root), { recursive: true });
    effects.push(`Removed generated artifact: ${root}`);
    remaining = remaining.filter((name) => name !== root);
  }
  await revalidate();
  if (op.removeWorktree) {
    onDispatch(`Remove worktree: ${snapshot.path}`);
    await runGit(["worktree", "remove", snapshot.path!]);
    effects.push(`Removed worktree: ${snapshot.path}`);
    if (existsSync(snapshot.path!) || (await access.worktrees(snapshot.cwd)).some((entry) => samePath(entry.path, snapshot.path!))) throw new Error("Worktree removal did not settle as expected");
  }
  if (op.deleteBranch) {
    guardPolicy();
    const current = await captureCleanup(callerCwd, { ...op, worktreePath: undefined, removeWorktree: false, artifactRoots: [] }, policy, access, budget);
    if (current.target !== snapshot.target || current.repositoryIdentity !== snapshot.repositoryIdentity) throw new Error("Cleanup repository or target changed");
    guardPolicy();
    // Conditional ref deletion binds the exact integrated commit. No -D fallback,
    // no upstream-dependent branch -d heuristic, and no Git configuration writes.
    onDispatch(`Delete local branch: ${op.featureBranch}`);
    await runGit(["update-ref", "--no-deref", "-d", `refs/heads/${op.featureBranch}`, op.featureTip]);
    effects.push(`Deleted local branch: ${op.featureBranch} at ${op.featureTip}`);
    if ((await access.git(snapshot.cwd, ["for-each-ref", "--format=%(refname)", `refs/heads/${op.featureBranch}`])).split("\n").includes(`refs/heads/${op.featureBranch}`)) throw new Error("Branch deletion did not settle as expected");
  }
  return effects.join("\n");
}
