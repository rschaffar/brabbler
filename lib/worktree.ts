import { execFile } from "child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { allowFileRoot } from "./allowed-roots";
import { gitExecEnv } from "./git-exec";
import { samePath, toNativePath } from "./paths";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface LocalBranchTip {
  branch: string;
  oid: string;
}

export type AddWorktreeOptions = {
  branch: string;
  baseBranch: string;
  expectedBaseOid: string;
  /** Optional live asynchronous policy recheck. Not a final mutation fence. */
  beforeCreate?: () => Promise<void>;
  /** Trusted original caller fence, retained across every await. Never JSON.
   * Called without yielding before mkdir and inside Git's dispatch boundary. */
  assertCurrentSync?: () => void;
} & ({ mode: "create" } | { mode: "attach"; expectedTipOid: string });

export interface RemoveWorktreeOptions {
  beforeRemove?: () => Promise<void>;
  /** Same original synchronous fence contract as addWorktree. */
  assertCurrentSync?: () => void;
}
export interface WorktreeMutationEffects {
  operation: "add" | "remove";
  parentPath?: string;
  parentCreationAttempted: boolean;
  /** true: mkdir acknowledged; null: attempt threw (unknown); false: not attempted. */
  parentCreated: boolean | null;
  /** Dispatch attempted, NOT proof that Git changed or did not change anything. */
  gitDispatchAttempted: boolean;
}
/** An error after an effect boundary must not imply an unchanged checkout.
 * No rollback/retry is attempted. Ordinary error messages remain compatible. */
export class WorktreeMutationError extends Error {
  readonly effects: Readonly<WorktreeMutationEffects>;
  constructor(message: string, effects: WorktreeMutationEffects) {
    super(message);
    this.effects = Object.freeze({ ...effects });
  }
}
function assertSynchronousGuard(guard: (() => void) | undefined): void {
  const result: unknown = guard?.();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => {});
    throw new Error("Worktree mutation requires a synchronous void postguard");
  }
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
  var __piProjectRefresh: Map<string, Promise<void>> | undefined;
  var __piProjectCacheGeneration: number | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
  globalThis.__piProjectCacheGeneration = (globalThis.__piProjectCacheGeneration ?? 0) + 1;
  globalThis.__piProjectRefresh?.clear();
}

async function git(cwd: string, args: string[], timeoutMs = 10_000,
  mutation?: { assertCurrentSync: () => void; dispatchAttempted: () => void }): Promise<string> {
  const argv = ["--no-optional-locks", "-C", cwd, ...args];
  const options = {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    // Preflight status must not refresh/write an index. Required mutation locks
    // still work; no optional-lock disabling is used as mutation authorization.
    // Pin the locale for the DELETE route's dirty-worktree diagnostic.
    env: gitExecEnv(),
  };
  // Environment/options construction can call instrumented getters. Guard AFTER
  // it, with no await between this original assertion and actual child dispatch.
  mutation?.assertCurrentSync();
  mutation?.dispatchAttempted();
  const { stdout } = await execFileAsync("git", argv, options);
  return stdout.trim();
}

function realPathOrSelf(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  return { projectRoot: realPathOrSelf(repoRoot), branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

/**
 * Resolve a cwd's project identity with stale-while-revalidate caching.
 *
 * Within PROJECT_CACHE_TTL_MS the cached value is returned directly. After
 * that the stale value is still returned immediately while a background
 * refresh re-runs git; callers (chiefly the session list, which fans out over
 * every project cwd) therefore never wait on git subprocesses once a cwd has
 * been resolved once. Concurrent refreshes for the same cwd share one promise.
 * add/removeWorktree invalidate eagerly via invalidateProjectCache().
 */
export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.info;

  // Serve the stale entry now; refresh out of band.
  if (cached) {
    refreshProjectInBackground(cwd);
    return cached.info;
  }

  const info = await resolveProjectUncached(cwd);
  cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

function refreshProjectInBackground(cwd: string): void {
  const inflight = (globalThis.__piProjectRefresh ??= new Map<string, Promise<void>>());
  if (inflight.has(cwd)) return;
  const generation = globalThis.__piProjectCacheGeneration ?? 0;
  const task = resolveProjectUncached(cwd)
    .then((info) => {
      if ((globalThis.__piProjectCacheGeneration ?? 0) !== generation) return;
      getProjectCache().set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
    })
    .catch(() => {
      // Keep the stale entry on refresh failure; the next TTL window retries.
    })
    .finally(() => {
      if (inflight.get(cwd) === task) inflight.delete(cwd);
    });
  inflight.set(cwd, task);
}

async function resolveProjectUncached(cwd: string): Promise<ProjectInfo> {
  let info: ProjectInfo;
  try {
    if (!existsSync(cwd)) {
      return inferRemovedWorktree(cwd) ?? { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
    }
    const out = await git(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDirRaw, gitDirRaw, toplevelRaw, ref] = out.split("\n").map((l) => l.trim());
    // Only the first three lines are paths — `ref` is a branch name and must
    // keep its forward slashes (`feature/foo`).
    const [commonDir, gitDir, toplevel] = [commonDirRaw, gitDirRaw, toplevelRaw].map(toNativePath);
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    const realCwd = realPathOrSelf(cwd);
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users.
    const isTopLevel = samePath(toplevel, realCwd);
    const isWorktreeTopLevel = !samePath(gitDir, commonDir) && isTopLevel;
    const topLevelProjectRoot = isWorktreeTopLevel ? dirname(commonDir) : toplevel;
    info = {
      projectRoot: isTopLevel ? realPathOrSelf(topLevelProjectRoot) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch {
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }

  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return realPathOrSelf(dirname(toNativePath(commonDir)));
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  let current: (Partial<WorktreeInfo> & { prunable?: boolean }) | null = null;

  const flush = () => {
    if (current?.path) {
      // Prunable worktrees point at missing/broken gitdirs and cannot be
      // browsed or selected usefully. Also skip vanished paths even if git has
      // not marked them prunable yet.
      if (!current.prunable && existsSync(current.path)) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          isMain: worktrees.length === 0,
        });
      }
    }
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: toNativePath(line.slice("worktree ".length).trim()) };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return worktrees;
}

/** Branches whose current tips are reachable from the local integration branch.
 *  Missing rst-main (or an unavailable ancestry check) means no badges, not
 *  a failed worktree listing. Never consult remote-tracking refs. */
export async function listMergedWorktreeBranches(cwd: string): Promise<Set<string>> {
  try {
    const out = await git(cwd, ["for-each-ref", "--format=%(refname)", "--merged", "refs/heads/rst-main", "refs/heads"]);
    return new Set(out.split("\n").filter(Boolean).map((ref) => ref.replace(/^refs\/heads\//, "")));
  } catch {
    return new Set();
  }
}

export async function listLocalBranchTips(cwd: string): Promise<LocalBranchTip[]> {
  const out = await git(cwd, ["for-each-ref", "--format=%(refname:short)%00%(objectname)", "refs/heads"]);
  return out.split("\n").filter(Boolean).map((line) => {
    const [branch, oid] = line.split("\0");
    return { branch, oid };
  });
}

/** Capture the checked-out local branch and its full commit, without consulting remotes or the project cache. */
export async function currentLocalBranchTip(cwd: string): Promise<LocalBranchTip> {
  let ref: string;
  try {
    ref = await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
  } catch {
    throw new Error("A checked-out local branch is required for worktree isolation (detached HEAD or non-git directory)");
  }
  if (!ref.startsWith("refs/heads/")) throw new Error("A checked-out local branch is required for worktree isolation");
  const branch = ref.slice("refs/heads/".length);
  const oid = await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const checkout = toNativePath(await git(cwd, ["rev-parse", "--show-toplevel"]));
  if (await git(checkout, ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error(`Checkout is not clean: ${checkout}`);
  }
  // A checkout or ref update during capture must not silently change the base.
  if (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]).catch(() => "") !== ref ||
      await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]).catch(() => "") !== oid ||
      await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]).catch(() => "") !== oid) {
    throw new Error(`Parent local branch moved while capturing worktree base: ${branch}`);
  }
  return { branch, oid };
}

function findWorktreeByPath(worktrees: readonly WorktreeInfo[], candidate: string): WorktreeInfo | undefined {
  return worktrees.find((worktree) => samePath(worktree.path, candidate));
}

export function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): string | null {
  return findWorktreeByPath(worktrees, realPathOrSelf(cwd))?.path ?? null;
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path); // Unlike existsSync, catches dangling symlinks too.
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function pinPathInstance(file: string): () => void {
  const observe = () => {
    const s = lstatSync(file, { bigint: true });
    return JSON.stringify({ real: realpathSync(file), dev: String(s.dev), ino: String(s.ino), birthtime: String(s.birthtimeNs),
      directory: s.isDirectory(), file: s.isFile(), symlink: s.isSymbolicLink(),
      ...(s.isFile() || s.isSymbolicLink() ? { size: String(s.size), changed: String(s.ctimeNs) } : {}) });
  };
  const original = observe();
  return () => { if (observe() !== original) throw new Error(`Worktree physical path changed: ${file}`); };
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The destination that addWorktree will use; never an approval to create it. */
export function proposedWorktreePath(repoRoot: string, branch: string): string {
  return join(`${resolve(repoRoot)}-worktrees`, sanitizeBranchForDir(branch));
}

// Legacy string callers are accepted by the type system only so they fail
// explicitly at runtime instead of silently creating from an implicit base.
export async function addWorktree(cwd: string, options: AddWorktreeOptions | string): Promise<{ path: string; branch: string }> {
  if (!options || typeof options !== "object") throw new Error("Explicit local base branch and expected HEAD are required");
  // Retain the actual callbacks/inputs before any await; do not re-read a mutable
  // options object at a later effect boundary.
  options = { ...options };
  const { branch, baseBranch, expectedBaseOid, mode, beforeCreate, assertCurrentSync } = options;
  const assertSource = pinPathInstance(cwd);
  const repoRoot = await getRepoRoot(cwd);
  const assertRepo = pinPathInstance(repoRoot);
  const checkBranch = async (name: unknown, label: string): Promise<string> => {
    if (typeof name !== "string" || !name || name !== name.trim() || name.startsWith("-")) {
      throw new Error(`${label} is required and must be a valid branch name`);
    }
    try {
      if (await git(repoRoot, ["check-ref-format", "--branch", name]) !== name) {
        throw new Error("Branch name expands to another ref");
      }
    } catch {
      throw new Error(`Invalid ${label}: ${name}`);
    }
    return name;
  };
  const target = await checkBranch(branch, "branch name");
  const base = await checkBranch(baseBranch, "local base branch");
  if (mode !== "create" && mode !== "attach") throw new Error("Select create or attach explicitly");

  const oidLength = (await git(repoRoot, ["rev-parse", "--show-object-format"])) === "sha256" ? 64 : 40;
  const validOid = (oid: unknown) => typeof oid === "string" && new RegExp(`^[0-9a-fA-F]{${oidLength}}$`).test(oid);
  if (!validOid(expectedBaseOid)) throw new Error("Full expected base HEAD is required");
  if (mode === "attach" && !validOid(options.expectedTipOid)) throw new Error("Full expected branch tip is required for attach");

  const branches = await listLocalBranchTips(repoRoot);
  const baseTip = branches.find((entry) => entry.branch === base);
  if (!baseTip) throw new Error(`Local base branch does not exist: ${base}`);
  if (baseTip.oid !== expectedBaseOid.toLowerCase()) throw new Error(`Stale local base branch: ${base} moved; refresh and select it again`);
  const existing = branches.find((entry) => entry.branch === target);
  if (mode === "create" && existing) throw new Error(`Branch already exists: ${target}. Select attach explicitly`);
  if (mode === "attach" && !existing) throw new Error(`Local branch does not exist: ${target}`);
  if (mode === "attach" && existing?.oid !== options.expectedTipOid.toLowerCase()) {
    throw new Error(`Stale branch tip: ${target} moved; refresh and select it again`);
  }

  // Do not create from an uncommitted checkout, nor from a dirty checked-out
  // base. Git does not copy these changes, so proceeding would mislead users.
  const checkClean = async (path: string) => {
    if (await git(path, ["status", "--porcelain", "--untracked-files=all"])) {
      throw new Error(`Checkout is not clean: ${path}`);
    }
  };
  const sourceCheckout = toNativePath(await git(cwd, ["rev-parse", "--show-toplevel"]));
  await checkClean(sourceCheckout);
  for (const worktree of await listWorktrees(repoRoot)) {
    if (worktree.branch === base && !samePath(worktree.path, sourceCheckout)) await checkClean(worktree.path);
  }

  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = proposedWorktreePath(repoRoot, target);
  if (pathEntryExists(worktreePath)) throw new Error(`Directory already exists: ${worktreePath}`);
  if (pathEntryExists(baseDir)) {
    const parent = lstatSync(baseDir);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Invalid worktree directory: ${baseDir}`);
  }
  // Recheck refs and caller-owned admission after asynchronous preflight.
  // Git's own -b/checkout checks still protect collisions with another
  // concurrent writer; settings changed by an external process can still race.
  if (await git(repoRoot, ["rev-parse", "--verify", `refs/heads/${base}^{commit}`]) !== expectedBaseOid.toLowerCase()) {
    throw new Error(`Stale local base branch: ${base} moved`);
  }
  const assertExistingParent = pathEntryExists(baseDir) ? pinPathInstance(baseDir) : undefined;
  await beforeCreate?.();
  // Complete attach's late tip read BEFORE the first filesystem effect. A
  // revoked original during this await must not even leave a parent directory.
  if (mode === "attach" && await git(repoRoot, ["rev-parse", "--verify", `refs/heads/${target}^{commit}`]) !== options.expectedTipOid.toLowerCase()) {
    throw new Error(`Stale branch tip: ${target} moved`);
  }
  let assertParent = assertExistingParent;
  const assertMutation = () => {
    // The owner callback may run live getters. Check captured physical paths
    // AFTER it, not only before it; never let that callback replace our target.
    assertSynchronousGuard(assertCurrentSync);
    assertSource(); assertRepo();
    if (pathEntryExists(worktreePath)) throw new Error(`Directory already exists: ${worktreePath}`);
    if (assertParent) assertParent();
    else if (pathEntryExists(baseDir)) throw new Error(`Worktree parent changed: ${baseDir}`);
    if (pathEntryExists(baseDir)) {
      const parent = lstatSync(baseDir);
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Invalid worktree directory: ${baseDir}`);
    }
  };
  const effects: WorktreeMutationEffects = { operation: "add", parentPath: baseDir,
    parentCreationAttempted: false, parentCreated: false, gitDispatchAttempted: false };
  try {
    assertMutation();
    if (!assertParent) {
      effects.parentCreationAttempted = true;
      effects.parentCreated = null;
      mkdirSync(baseDir); // No yield after the original guard above.
      effects.parentCreated = true;
      assertParent = pinPathInstance(baseDir); // Own known effect, not a new policy baseline.
    }
    // Large repos (30k+ files) can take minutes to checkout.
    const WORKTREE_TIMEOUT = 5 * 60_000;
    const args = mode === "attach" ? ["worktree", "add", "--", worktreePath, target]
      : ["worktree", "add", "-b", target, "--", worktreePath, expectedBaseOid];
    await git(repoRoot, args, WORKTREE_TIMEOUT, { assertCurrentSync: assertMutation,
      dispatchAttempted: () => { effects.gitDispatchAttempted = true; } });
  } catch (error) {
    if (effects.parentCreationAttempted || effects.gitDispatchAttempted) throw new WorktreeMutationError(extractGitError(error), effects);
    throw error;
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  return { path: worktreePath, branch: target };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false, options: RemoveWorktreeOptions = {}): Promise<void> {
  const { beforeRemove, assertCurrentSync } = options;
  const assertSource = pinPathInstance(cwd), assertTarget = pinPathInstance(worktreePath);
  const assertMarker = pinPathInstance(join(worktreePath, ".git"));
  const worktrees = await listWorktrees(cwd);
  const target = findWorktreeByPath(worktrees, worktreePath);
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  await beforeRemove?.();
  const effects: WorktreeMutationEffects = { operation: "remove", parentCreationAttempted: false, parentCreated: false, gitDispatchAttempted: false };
  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path], 10_000, {
      assertCurrentSync: () => { assertSynchronousGuard(assertCurrentSync); assertSource(); assertTarget(); assertMarker(); },
      dispatchAttempted: () => { effects.gitDispatchAttempted = true; },
    });
  } catch (error) {
    if (effects.gitDispatchAttempted) throw new WorktreeMutationError(extractGitError(error), effects);
    throw error;
  }
  // Do not reinterpret revocation AFTER a successful effect as a failed delete.
  invalidateProjectCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
