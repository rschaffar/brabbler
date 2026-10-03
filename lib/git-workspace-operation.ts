// Internal only. No route/tool, session movement, legacy consent, receipts or last selection.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, opendir, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify, types } from "node:util";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { acquireGitCheckoutGate } from "./git-checkout-gate";
import { gitExecEnv } from "./git-exec";
import { parseBoundedGitWorktreePaths, revalidateGitProjectResources, selectCanonicalGitResources,
  type GitProjectResources } from "./git-project-resources";
import { validLocalBranchName } from "./git-workflow-policy";
import { samePath } from "./paths";
import { proposedWorktreePath } from "./worktree";

const exec = promisify(execFile);
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
// Explicit tracked-tree capability bounds; ignored dependency/cache trees are
// neither inventoried nor hashed and do not consume this budget.
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10000;
const markers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer",
  "BISECT_START", "AUTO_MERGE", "MERGE_AUTOSTASH", "REBASE_HEAD", "ORIG_HEAD.lock", "index.lock", "HEAD.lock", "config.lock", "packed-refs.lock"];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type Identity = { device: string; inode: string; birthtime: string };
const identity = (s: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Identity =>
  ({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) });
type Repo = { cwd: string; gitDir: string; commonDir: string };
const PARENT_MODE = 0o700;
/** Exact additional effect, disclosed to live authorization/history before apply. */
export interface GitWorkspaceParentCreation {
  path: string;
  expectedAbsent: true;
  ancestorPath: string;
  ancestorIdentity: Identity;
  mode: typeof PARENT_MODE;
}
/** Measured only after exclusive mkdir and verification of the new directory. */
export interface GitWorkspaceKnownParentCreation {
  path: string;
  identity: Identity;
  mode: number;
  ownerUid: number;
  ancestorPath: string;
  ancestorIdentity: Identity;
}
type DestinationFacts = { parentIdentity: Identity; parentCreation?: never } |
  { parentIdentity?: never; parentCreation: GitWorkspaceParentCreation };
const overlaps = (a: string, b: string) => samePath(a, b) ||
  a.startsWith(b.endsWith("/") ? b : `${b}/`) || b.startsWith(a.endsWith("/") ? a : `${a}/`);

export type GitWorkspaceRequest = {
  repositoryPath: string;
  sourceCheckoutPath: string;
  destinationPath: string;
  branch: string;
  baseBranch: string;
  expectedBaseOid: string;
} & ({ mode: "create" } | { mode: "attach"; expectedTipOid: string });
export class GitWorkspaceOperationError extends Error {
  constructor(readonly code: "invalid-selection" | "unsafe" | "stale" | "access-denied" | "recovery-required",
    message: string, readonly actionId?: string) { super(message); this.name = "GitWorkspaceOperationError"; }
}
function refuse(code: GitWorkspaceOperationError["code"] = "unsafe"): never {
  throw new GitWorkspaceOperationError(code, "Workspace operation refused; inspect the explicit resources.");
}
function pathInput(path: string): void {
  if (typeof path !== "string" || !isAbsolute(path) || path !== resolve(path) || path.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(path)) refuse("invalid-selection");
}
async function absent(path: string): Promise<void> {
  try { await lstat(path); refuse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function physical(path: string): Promise<Identity> {
  const s = await lstat(path, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || !samePath(path, await realpath(path))) refuse();
  return identity(s);
}
async function bytes(path: string, limit = 8 * 1024 * 1024): Promise<Buffer> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.nlink !== 1 || s.size > limit) refuse();
    const data = Buffer.alloc(s.size + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await fd.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const end = await fd.stat(), named = await lstat(path);
    if (length !== s.size || end.size !== s.size || end.ctimeMs !== s.ctimeMs || end.mtimeMs !== s.mtimeMs ||
        named.dev !== s.dev || named.ino !== s.ino) refuse("stale");
    return data.subarray(0, length);
  } finally { await fd.close(); }
}
async function git(repo: Repo, args: string[], passiveConfig = false, beforeStart?: () => void,
  prepareLaunch?: () => void | Promise<void>): Promise<string> {
  const argv = ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`,
    `--work-tree=${repo.cwd}`, ...(passiveConfig ? [] : ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgsign=false", "-c", "core.attributesFile=/dev/null"]), ...args];
  const launch = {
    encoding: "utf8" as const, timeout: args[0] === "worktree" && args[1] === "add" ? 300000 : 15000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_ATTR_NOSYSTEM: "1", GIT_PAGER: "cat" },
  };
  if (prepareLaunch) await prepareLaunch();
  // Arguments/environment and every asynchronous launch hook are ready. The
  // guard is on the child-start boundary, not before entering this async helper.
  beforeStart?.();
  const child = exec("git", argv, launch); // starts synchronously; no intervening await
  const { stdout } = await child;
  return stdout;
}
function syncVoid(value: unknown): void {
  // Invalid promise-returning assertions must not also cause an unhandled rejection.
  // Do NOT assimilate arbitrary thenables or use their eventual value as authority.
  if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
  if (value !== undefined) refuse("invalid-selection");
}
function bindCurrentSync(options: { assertCurrentSync(): void }): () => void {
  const assertion = options?.assertCurrentSync;
  if (typeof assertion !== "function" || types.isAsyncFunction(assertion)) refuse("invalid-selection");
  // Capture the actual function, never rediscover it through mutable options or
  // an action/candidate payload. Runtime binds its live closure inside authorize.
  return () => syncVoid(Reflect.apply(assertion, options, []));
}
function assertOwnedSync(intent: GitWorkspaceIntent, proof?: GitWorkspaceCompletedProof): void {
  if (types.isAsyncFunction(intent.assertOwned)) refuse("invalid-selection");
  syncVoid(intent.assertOwned(proof));
}
async function names(dir: string): Promise<string[]> {
  const output: string[] = [];
  const fd = await opendir(dir);
  for await (const entry of fd) {
    if (output.length >= MAX_FILES) refuse();
    output.push(entry.name);
  }
  return output;
}
async function safeConfig(repo: Repo): Promise<string> {
  await bytes(join(repo.commonDir, "config"), 2 * 1024 * 1024);
  const config = await git(repo, ["config", "--list", "--null"], true);
  for (const row of config.split("\0").filter(Boolean)) {
    const boundary = row.indexOf("\n");
    if (boundary < 0) refuse();
    const key = row.slice(0, boundary).toLowerCase(), value = row.slice(boundary + 1).toLowerCase();
    // A conditional include may become active only in the NEW Git directory,
    // before we can inspect it. There is no speculative-config fallback.
    if (key.startsWith("includeif.")) refuse();
    // This backend verifies absolute registration/backlink paths. Refuse the
    // configured relative-path policy before intent rather than overriding it.
    if (key === "worktree.userelativepaths" && value !== "false") refuse();
    if (["commit.gpgsign", "tag.gpgsign", "core.fsmonitor", "core.autocrlf", "core.sparsecheckout", "core.splitindex", "index.sparse"].includes(key) && value === "false") continue;
    if (/^(filter\.|diff\.(external|.*\.(command|textconv))|merge\.|extensions\.|index\.|gpg\.|submodule\.|init\.templatedir|remote\..*\.promisor|core\.(hookspath|fsmonitor|attributesfile|worktree|sparsecheckout|splitindex|autocrlf|eol|symlinks|ignorecase|protecthfs|protectntfs)|commit\.gpgsign|tag\.gpgsign)/.test(key)) refuse();
  }
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    for (const name of ["info/attributes", "info/grafts", "shallow", "config.worktree"]) await absent(join(dir, name));
    if ((await names(dir)).some((name) => name.startsWith("sharedindex."))) refuse();
    // *.sample is inert. Any other hook entry (including symlinks) is unsupported.
    const hooks = join(dir, "hooks");
    try {
      if (!(await lstat(hooks)).isDirectory() || (await lstat(hooks)).isSymbolicLink() ||
          (await names(hooks)).some((name) => !name.endsWith(".sample"))) refuse();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if ((await git(repo, ["for-each-ref", "--format=%(refname)", "refs/replace"])).trim()) refuse();
  return hash(config);
}
async function noMarkers(repo: Repo): Promise<void> {
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    for (const marker of markers) await absent(join(dir, marker));
  }
}
async function safeTree(repo: Repo, oid: string): Promise<string> {
  if ((await git(repo, ["cat-file", "-t", oid])).trim() !== "commit") refuse();
  const tree = (await git(repo, ["rev-parse", `${oid}^{tree}`])).trim();
  if (!OID.test(tree)) refuse();
  const rows = (await git(repo, ["ls-tree", "-r", "-l", "-z", tree])).split("\0").filter(Boolean);
  if (rows.length > MAX_FILES) refuse();
  let total = 0;
  for (const row of rows) {
    const match = /^(100644|100755) blob [a-f0-9]+\s+(\d+)\t(.+)$/.exec(row);
    if (!match || /(^|\/)\.gitattributes$/.test(match[3]) || /[\x00-\x1f\x7f]/.test(match[3])) refuse();
    total += Number(match[2]); if (total > MAX_BYTES) refuse();
  }
  return tree;
}
/** Only the NEW destination is required to contain exactly the tracked tree plus
 * .git. Reject unexpected entries (even empty ignored directories) without reading
 * their bytes or descending into dependency/cache trees. Never walk source/base. */
async function destinationEntries(repo: Repo, tree: string): Promise<void> {
  const children = new Map<string, Set<string>>([["", new Set([".git"])]]);
  for (const row of (await git(repo, ["ls-tree", "-r", "-z", tree])).split("\0").filter(Boolean)) {
    const path = row.slice(row.indexOf("\t") + 1), parts = path.split("/");
    let parent = "";
    for (const part of parts) {
      const entries = children.get(parent) ?? new Set<string>();
      entries.add(part); children.set(parent, entries);
      parent = parent ? `${parent}/${part}` : part;
    }
  }
  const scan = async (relative: string): Promise<void> => {
    const expected = children.get(relative)!;
    const seen = new Set<string>();
    const dir = await opendir(join(repo.cwd, relative));
    for await (const entry of dir) {
      if (!expected.has(entry.name) || seen.has(entry.name)) refuse();
      seen.add(entry.name);
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (children.has(path)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) refuse();
        await scan(path);
      } else if (!entry.isFile() || entry.isSymbolicLink()) refuse();
    }
    if (seen.size !== expected.size) refuse();
  };
  await scan("");
}
type CheckoutSnapshot = { ref: string; oid: string; indexDigest: string; headDigest: string;
  indexIdentity: Identity; headIdentity: Identity;
  /** Verified tracked bytes/modes and their directory identities ONLY. No ignored-byte claim. */
  trackedFilesDigest: string; configDigest: string };
async function checkout(repo: Repo, selection: GitProjectResources): Promise<CheckoutSnapshot> {
  const configDigest = await safeConfig(repo);
  await noMarkers(repo);
  const ref = `refs/heads/${selection.branch}`;
  const oid = (await git(repo, ["show-ref", "--verify", "--hash", ref])).trim();
  if (!OID.test(oid) || (await git(repo, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== ref ||
      (await git(repo, ["rev-parse", "HEAD^{commit}"])).trim() !== oid) refuse("stale");
  const treeOid = await safeTree(repo, oid);
  const trackedFiles: string[] = [];
  const trackedDirectories = new Map<string, Identity>([["", selection.identities.checkout]]);
  let trackedBytes = 0;
  await absent(join(repo.cwd, ".gitattributes"));
  // Status's stat cache is not independent proof of actual file bytes. With
  // attributes/EOL conversion unsupported, compare raw blob hashes and owner
  // execute bits directly, independently of core.fileMode and Git's stat cache.
  for (const row of (await git(repo, ["ls-tree", "-r", "-z", treeOid])).split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/.exec(row);
    if (!match) refuse();
    let parent = repo.cwd, relativeParent = "";
    for (const part of match[3].split("/").slice(0, -1)) {
      parent = join(parent, part);
      relativeParent = relativeParent ? `${relativeParent}/${part}` : part;
      const s = await lstat(parent, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink()) refuse();
      const current = identity(s), previous = trackedDirectories.get(relativeParent);
      if (previous && JSON.stringify(previous) !== JSON.stringify(current)) refuse("stale");
      if (!previous) await absent(join(parent, ".gitattributes"));
      trackedDirectories.set(relativeParent, current);
    }
    const path = join(repo.cwd, match[3]), mode = (await lstat(path)).mode;
    // Git's 100755/100644 distinction is the owner execute bit, not the full
    // permission mask (which also depends on umask). Do not trust fileMode=false.
    if (Boolean(mode & 0o100) !== (match[1] === "100755")) refuse("stale");
    const data = await bytes(path, MAX_BYTES);
    trackedBytes += data.length;
    if (trackedBytes > MAX_BYTES) refuse();
    const blob = createHash(oid.length === 64 ? "sha256" : "sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
    if (blob !== match[2]) refuse("stale");
    trackedFiles.push(`${match[3]}\0${mode}\0${hash(data)}`);
  }
  // Native add does not intentionally write source/base files. We bind verified
  // tracked paths, not an isolation snapshot of arbitrary ignored filesystem data.
  const trackedFilesDigest = hash(JSON.stringify({ files: trackedFiles, directories: [...trackedDirectories] }));
  const index = await bytes(join(repo.gitDir, "index"));
  if (index.length < 12 || index.toString("ascii", 0, 4) !== "DIRC" || ![2, 3].includes(index.readUInt32BE(4))) refuse();
  if (await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) !== "" ||
      await git(repo, ["ls-files", "-u", "-z"]) !== "" ||
      (await git(repo, ["ls-files", "-v", "-z"])).split("\0").some((row) => row && !row.startsWith("H "))) refuse();
  if (await git(repo, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", oid, "--"]) !== "") refuse();
  return { ref, oid, configDigest, indexDigest: hash(index), headDigest: hash(await bytes(join(repo.gitDir, "HEAD"))),
    indexIdentity: identity(await lstat(join(repo.gitDir, "index"), { bigint: true })),
    headIdentity: identity(await lstat(join(repo.gitDir, "HEAD"), { bigint: true })), trackedFilesDigest };
}
async function inventory(repo: Repo): Promise<{ refs: string; registrations: string }> {
  const refs = await git(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs"]);
  if (refs.split("\n").length > 1001) refuse();
  const registrations = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
  parseBoundedGitWorktreePaths(Buffer.from(registrations));
  return { refs, registrations };
}
/** Validate the namespaces native add may write, including dangling loose
 * symrefs omitted by for-each-ref. This is bounded path inspection, not a lock
 * against external writers; ordinary native collision checks still apply. */
async function safeNamespace(repo: Repo, request: GitWorkspaceRequest, sourceBranch: string): Promise<void> {
  const directoryChain = async (parts: string[]) => {
    let path = repo.commonDir;
    for (const part of parts) {
      path = join(path, part);
      try {
        const s = await lstat(path);
        if (!s.isDirectory() || s.isSymbolicLink()) refuse();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
  };
  await directoryChain(["worktrees"]);
  await directoryChain(["info"]);
  for (const branch of new Set([sourceBranch, request.baseBranch, request.branch])) {
    const parts = branch.split("/");
    await directoryChain(["refs", "heads", ...parts.slice(0, -1)]);
    await directoryChain(["logs", "refs", "heads", ...parts.slice(0, -1)]);
    const ref = join(repo.commonDir, "refs", "heads", ...parts);
    await absent(`${ref}.lock`);
    if (request.mode === "create" && branch === request.branch) await absent(ref);
    else {
      try { if ((await bytes(ref, 4096)).toString("utf8").startsWith("ref:")) refuse(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    try { await bytes(join(repo.commonDir, "logs", "refs", "heads", ...parts)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  try { await bytes(join(repo.commonDir, "packed-refs"), 2 * 1024 * 1024); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function writableDirectory(path: string): Promise<Identity> {
  const id = await physical(path), info = await lstat(path);
  // Do not silently chmod or bypass a visibly nonwritable directory as root.
  if (!(info.mode & 0o222) || !(info.mode & 0o111)) refuse("access-denied");
  await access(path, constants.W_OK | constants.X_OK);
  return id;
}
async function destinationPermission(request: GitWorkspaceRequest): Promise<DestinationFacts> {
  await absent(request.destinationPath);
  const parent = dirname(request.destinationPath), ancestorPath = dirname(request.repositoryPath);
  const roots = await getAllowedFileRoots();
  const conventional = samePath(request.destinationPath, proposedWorktreePath(request.repositoryPath, request.branch)) &&
    samePath(parent, `${request.repositoryPath}-worktrees`) && samePath(dirname(parent), ancestorPath) &&
    isExistingFilePathAllowed(request.repositoryPath, roots);
  let missing = false;
  try { await lstat(parent); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing = true; }
  if (missing) {
    // ONLY one absent conventional sibling of an allowed canonical repository.
    // No arbitrary missing parents, ancestor chains, capture mkdir or root widening.
    if (!conventional) refuse("access-denied");
    return { parentCreation: { path: parent, expectedAbsent: true, ancestorPath,
      ancestorIdentity: await writableDirectory(ancestorPath), mode: PARENT_MODE } };
  }
  const parentIdentity = await writableDirectory(parent);
  if (!isExistingFilePathAllowed(parent, roots) && !conventional) refuse("access-denied");
  if (conventional) await physical(ancestorPath);
  return { parentIdentity };
}
async function knownParent(e: GitWorkspaceEvidence, measured?: GitWorkspaceKnownParentCreation): Promise<void> {
  const expected = measured?.identity ?? e.parentIdentity;
  if (!expected || JSON.stringify(await physical(dirname(e.request.destinationPath))) !== JSON.stringify(expected)) refuse("stale");
  if (e.parentCreation) {
    const plan = e.parentCreation;
    if (!measured || measured.path !== plan.path || measured.mode !== plan.mode || measured.ownerUid !== process.geteuid!() ||
        measured.ancestorPath !== plan.ancestorPath || JSON.stringify(measured.ancestorIdentity) !== JSON.stringify(plan.ancestorIdentity) ||
        JSON.stringify(await physical(plan.ancestorPath)) !== JSON.stringify(plan.ancestorIdentity)) refuse("stale");
    const info = await lstat(plan.path);
    if ((info.mode & 0o7777) !== measured.mode || info.uid !== measured.ownerUid) refuse("stale");
  } else if (measured) refuse("stale");
}

export interface GitWorkspaceCandidate {
  readonly actionId: string;
  readonly request: Readonly<GitWorkspaceRequest>;
  readonly sourceOid: string;
  readonly resultOid: string;
  readonly treeOid: string;
  /** UI/history MUST disclose this additional directory creation when present. */
  readonly parentCreation?: Readonly<GitWorkspaceParentCreation>;
}
export interface GitWorkspaceEvidence {
  version: 1;
  actionId: string;
  request: GitWorkspaceRequest;
  source: GitProjectResources;
  baseCheckout?: GitProjectResources;
  sourceSnapshot: CheckoutSnapshot;
  baseSnapshot?: CheckoutSnapshot;
  /** Present only for an already-existing destination parent. */
  parentIdentity?: Identity;
  /** Otherwise exact absent parent + existing physical ancestor binding. */
  parentCreation?: GitWorkspaceParentCreation;
  refs: string;
  registrations: string;
  resultOid: string;
  treeOid: string;
}
/** Parent must add a workspace intent kind and validate/persist this proof;
 * do not adapt it to preparation or proof-free resolve(). No engine-owned ledger. */
export interface GitWorkspaceCompletedProof {
  version: 1;
  outcome: "completed";
  actionId: string;
  mode: "create" | "attach";
  destination: GitProjectResources;
  sourceOid: string;
  baseOid: string;
  branchRef: string;
  resultOid: string;
  treeOid: string;
  sourceIndexDigest: string;
  destinationIndexDigest: string;
  /** Tracked bytes/modes and relevant directory identities; excludes ignored content. */
  sourceTrackedFilesDigest: string;
  destinationTrackedFilesDigest: string;
  configDigest: string;
  refsDigest: string;
  registrationsDigest: string;
  backlinkDigest: string;
  knownParentCreation?: GitWorkspaceKnownParentCreation;
  status: "clean";
}
export interface GitWorkspaceFailureEvidence {
  version: 1;
  actionId: string;
  phase: "intent" | "before-add" | "create-parent" | "after-parent" | "add" | "verify" | "completed-record";
  addAttempted: boolean;
  parentCreationAttempted?: boolean;
  parentCreated?: boolean;
  knownParentCreation?: GitWorkspaceKnownParentCreation;
  observedBranchOid: string | null;
  destinationPresent: boolean | null;
  recoveryRequired: true;
}
export interface GitWorkspaceIntent {
  /** Before effects, undefined requires original inventory. After native verification,
   * the exact proof identity allows ONLY its expected registration/ref addition;
   * adapter MUST authenticate it with readGitWorkspaceNativeProof, never JSON.
   * Publish verified evidence before changing the reservation's expected inventory. */
  assertOwned(proof?: GitWorkspaceCompletedProof): void;
  /** Mandatory measured proof; persist it before releasing quarantine. */
  completed(proof: GitWorkspaceCompletedProof): Promise<void>;
  /** Immutable evidence only. Must NOT release, rollback, delete or schedule retry. */
  recordFailure(evidence: GitWorkspaceFailureEvidence): Promise<void>;
}
export interface GitWorkspaceAdmission {
  /** Include canonical/common identity, all registered aliases and absent destination.
   * Unknown writers, surviving checks, historical uncertainty and namespace overlap deny. */
  assertAdmission(source: GitProjectResources, destinationPath: string, parentCreation?: GitWorkspaceParentCreation): Promise<void>;
  /** Persist exact evidence and exclusive intent BEFORE returning, including on crash.
   * Own assertion permits only this operation's expected registration/ref addition. */
  beginIntent(evidence: GitWorkspaceEvidence): Promise<GitWorkspaceIntent>;
}
type Saved = { evidence: GitWorkspaceEvidence; issuedAt: number; admission: GitWorkspaceAdmission; candidate: string };
const issued = new WeakMap<GitWorkspaceCandidate, Saved>();
const nativeProofs = new WeakMap<object, Readonly<GitWorkspaceCompletedProof>>();
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
/** In-process identity authentication of measured native facts ONLY. Copies, JSON,
 * durable history and action IDs are not handles. NOT proof of durable publication,
 * admission release or eligibility/authority for cleanup. A failed publisher leaves
 * these facts readable through the original object, never replayable execution. */
export function readGitWorkspaceNativeProof(handle: unknown): Readonly<GitWorkspaceCompletedProof> | undefined {
  return handle && typeof handle === "object" ? nativeProofs.get(handle) : undefined;
}
async function pinned<T>(selection: GitProjectResources, action: (repo: Repo) => Promise<T>): Promise<T> {
  if (process.platform !== "linux") refuse();
  const fds: FileHandle[] = [];
  const pin = async (path: string, expected: Identity) => {
    const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); fds.push(fd);
    if (JSON.stringify(identity(await fd.stat({ bigint: true }))) !== JSON.stringify(expected)) refuse("stale");
    return `/proc/${process.pid}/fd/${fd.fd}`;
  };
  try {
    const repo = { cwd: await pin(selection.cwd, selection.identities.checkout),
      gitDir: await pin(selection.gitDir, selection.identities.git), commonDir: await pin(selection.commonDir, selection.identities.common) };
    await revalidateGitProjectResources(selection);
    return await action(repo);
  } finally { await Promise.allSettled(fds.map((fd) => fd.close())); }
}
async function assertExact(e: GitWorkspaceEvidence, repo: Repo, duringPreflight?: () => void | Promise<void>,
  measuredParent?: GitWorkspaceKnownParentCreation): Promise<void> {
  await revalidateGitProjectResources(e.source);
  if (duringPreflight) await duringPreflight();
  await safeNamespace(repo, e.request, e.source.branch);
  const expectedParent: DestinationFacts = measuredParent ? { parentIdentity: measuredParent.identity } :
    e.parentCreation ? { parentCreation: e.parentCreation } : { parentIdentity: e.parentIdentity! };
  if (measuredParent) await knownParent(e, measuredParent);
  if (JSON.stringify(await destinationPermission(e.request)) !== JSON.stringify(expectedParent) ||
      JSON.stringify(await checkout(repo, e.source)) !== JSON.stringify(e.sourceSnapshot) ||
      JSON.stringify(await inventory(repo)) !== JSON.stringify({ refs: e.refs, registrations: e.registrations }) ||
      await safeTree(repo, e.resultOid) !== e.treeOid) refuse("stale");
  if (e.baseCheckout) await pinned(e.baseCheckout, async (base) => {
    if (JSON.stringify(await checkout(base, e.baseCheckout!)) !== JSON.stringify(e.baseSnapshot)) refuse("stale");
  });
}
/** Capture is independently callable/repeatable; not an approval. admission is a
 * trusted parent closure, never an external request field. */
export async function captureGitWorkspaceOperation(request: GitWorkspaceRequest, admission: GitWorkspaceAdmission): Promise<GitWorkspaceCandidate> {
  if (!request || !admission || typeof admission.assertAdmission !== "function" || typeof admission.beginIntent !== "function" ||
      !["create", "attach"].includes(request.mode) || !validLocalBranchName(request.branch) || !validLocalBranchName(request.baseBranch) ||
      !OID.test(request.expectedBaseOid) || request.mode === "attach" && !OID.test(request.expectedTipOid)) refuse("invalid-selection");
  for (const path of [request.repositoryPath, request.sourceCheckoutPath, request.destinationPath]) pathInput(path);
  request = structuredClone(request);
  const source = await selectCanonicalGitResources({ repositoryPath: request.repositoryPath, checkoutPath: request.sourceCheckoutPath });
  const release = acquireGitCheckoutGate([...new Set([source.projectRoot, source.cwd, dirname(request.destinationPath), request.destinationPath])]);
  try {
    return await pinned(source, async (repo) => {
      const parentFacts = await destinationPermission(request);
      const namespacePath = parentFacts.parentCreation?.ancestorPath ?? dirname(request.destinationPath);
      const namespaceIdentity = parentFacts.parentCreation?.ancestorIdentity ?? parentFacts.parentIdentity;
      const namespace = await open(namespacePath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        if (JSON.stringify(identity(await namespace.stat({ bigint: true }))) !== JSON.stringify(namespaceIdentity)) refuse("stale");
        await admission.assertAdmission(structuredClone(source), request.destinationPath, structuredClone(parentFacts.parentCreation));
        await safeNamespace(repo, request, source.branch);
        const sourceSnapshot = await checkout(repo, source), current = await inventory(repo);
        const refRows = current.refs.trimEnd().split("\n").map((row) => row.split("\0"));
        const baseOid = refRows.find(([ref]) => ref === `refs/heads/${request.baseBranch}`)?.[1];
        const tip = refRows.find(([ref]) => ref === `refs/heads/${request.branch}`)?.[1];
        if (baseOid !== request.expectedBaseOid || (request.mode === "create" ? tip !== undefined : tip !== request.expectedTipOid) ||
            refRows.some(([ref, , symref]) => symref && [source.branch, request.baseBranch, request.branch].some((branch) => ref === `refs/heads/${branch}`))) refuse("stale");
        const rows = current.registrations.slice(0, -2).split("\0\0").map((row) => row.split("\0"));
        if (rows.some((row) => row.includes(`branch refs/heads/${request.branch}`)) ||
            [...parseBoundedGitWorktreePaths(Buffer.from(current.registrations)), source.gitDir, source.commonDir].some((path) =>
              overlaps(path, request.destinationPath) || parentFacts.parentCreation && overlaps(path, parentFacts.parentCreation.path))) refuse();
        const baseRows = rows.filter((row) => row.includes(`branch refs/heads/${request.baseBranch}`));
        if (baseRows.length > 1) refuse();
        let baseCheckout: GitProjectResources | undefined, baseSnapshot: CheckoutSnapshot | undefined;
        if (baseRows.length && !samePath(baseRows[0][0].slice(9), source.cwd)) {
          baseCheckout = await selectCanonicalGitResources({ repositoryPath: source.projectRoot, checkoutPath: baseRows[0][0].slice(9) });
          baseSnapshot = await pinned(baseCheckout, (base) => checkout(base, baseCheckout!));
        }
        await safeTree(repo, baseOid);
        const resultOid = request.mode === "create" ? baseOid : request.expectedTipOid;
        const treeOid = await safeTree(repo, resultOid);
        const evidence: GitWorkspaceEvidence = { version: 1, actionId: randomUUID(), request, source, sourceSnapshot,
          ...(baseCheckout ? { baseCheckout, baseSnapshot } : {}), ...parentFacts, ...current, resultOid, treeOid };
        await assertExact(evidence, repo);
        await admission.assertAdmission(structuredClone(source), request.destinationPath, structuredClone(parentFacts.parentCreation));
        if (JSON.stringify(await physical(namespacePath)) !== JSON.stringify(namespaceIdentity)) refuse("stale");
        const candidate = Object.freeze({ actionId: evidence.actionId, request: Object.freeze(structuredClone(request)),
          sourceOid: sourceSnapshot.oid, resultOid, treeOid,
          ...(parentFacts.parentCreation ? { parentCreation: Object.freeze({ ...structuredClone(parentFacts.parentCreation),
            ancestorIdentity: Object.freeze(structuredClone(parentFacts.parentCreation.ancestorIdentity)) }) } : {}) });
        issued.set(candidate, { evidence: structuredClone(evidence), issuedAt: Date.now(), admission, candidate: JSON.stringify(candidate) });
        return candidate;
      } finally { await namespace.close(); }
    });
  } finally { release(); }
}
export interface GitWorkspaceApplyOptions {
  candidate: GitWorkspaceCandidate;
  /** Parent owns actor capability, exact Ask/Allow scope, live revocation/pause,
   * policy revision and applicable rules; file-root access alone never suffices.
   * This is a live assertion, NOT a human wait: obtain any exact approval before
   * apply, outside the checkout gate. */
  authorize(phase: "before-apply" | "before-add", candidate: GitWorkspaceCandidate): Promise<void>;
  /** Disposable node:test failure/race seams only; no request forwarding. */
  afterIntent?: () => void | Promise<void>;
  duringFinalPreflight?: () => void | Promise<void>;
  afterParentCreate?: () => void | Promise<void>;
  duringParentLaunch?: () => void | Promise<void>;
  duringAddLaunch?: () => void | Promise<void>;
  afterAdd?: () => void | Promise<void>;
}
export type GitWorkspaceResult = { status: "created" | "attached"; actionId: string; path: string; branch: string; oid: string;
  treeOid: string; knownParentCreation?: GitWorkspaceKnownParentCreation };
/** One native attempt. Partial effects/uncertain final records remain quarantined.
 * Existing directories are descriptor-pinned for reads; a disclosed, single absent
 * conventional parent is exclusively created through its pinned ancestor after
 * durable intent/live authorization. It is never removed on failure. Native add uses physical
 * paths to write durable registration/backlinks, not ephemeral /proc paths. The
 * open parent and before/after identity checks narrow but CANNOT eliminate an
 * arbitrary external-writer or destination pathname race. This is not race-free
 * confinement, nor a sandbox for shell/file tools. Native add does not intentionally
 * write source/base files; verified snapshots cover tracked content and Git state,
 * NOT independent preservation of ignored/cache bytes. No copying/rollback/delete/retry. */
/** Backward-compatible internal standalone entry. Selected/public runtime callers
 * must use applyGitWorkspaceOperationWithAuthority, not this compatibility API. */
export async function applyGitWorkspaceOperation(options: GitWorkspaceApplyOptions): Promise<GitWorkspaceResult> {
  return applyWorkspace(options);
}
/** Public selected-operation runtime entry. Required trusted synchronous LIVE
 * authority is asserted after authorize binds it, then again at EACH actual
 * filesystem/child-start effect. No optional bypass flag or serialized grant. */
export async function applyGitWorkspaceOperationWithAuthority(
  options: Parameters<typeof applyGitWorkspaceOperation>[0] & { assertCurrentSync(): void },
): Promise<GitWorkspaceResult> {
  const currentSync = bindCurrentSync(options);
  return applyWorkspace(options, currentSync);
}
async function applyWorkspace(options: GitWorkspaceApplyOptions, currentSync?: () => void): Promise<GitWorkspaceResult> {
  if (!options || typeof options.authorize !== "function" ||
      (options.afterIntent || options.duringFinalPreflight || options.afterParentCreate || options.duringParentLaunch ||
        options.duringAddLaunch || options.afterAdd) && !process.env.NODE_TEST_CONTEXT) refuse("invalid-selection");
  const saved = issued.get(options.candidate);
  if (!saved) refuse("stale");
  issued.delete(options.candidate);
  if (Date.now() - saved.issuedAt > 300000 || JSON.stringify(options.candidate) !== saved.candidate) refuse("stale");
  const e = saved.evidence, { request } = e;
  const release = acquireGitCheckoutGate([...new Set([e.source.projectRoot, e.source.cwd,
    ...(e.baseCheckout ? [e.baseCheckout.cwd] : []), dirname(request.destinationPath), request.destinationPath])]);
  try {
    await options.authorize("before-apply", options.candidate);
    currentSync?.(); // runtime closure is now bound; reject non-void/thenable assertions before intent
    await saved.admission.assertAdmission(structuredClone(e.source), request.destinationPath, structuredClone(e.parentCreation));
    return await pinned(e.source, async (repo) => {
      const plan = e.parentCreation;
      const namespacePath = plan?.ancestorPath ?? dirname(request.destinationPath);
      const namespace = await open(namespacePath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      let parent: FileHandle | undefined = plan ? undefined : namespace;
      let measuredParent: GitWorkspaceKnownParentCreation | undefined;
      let intent: GitWorkspaceIntent | undefined;
      let phase: GitWorkspaceFailureEvidence["phase"] = "intent", attempted = false, intentStarted = false;
      let parentCreationAttempted = false, parentCreated = false;
      try {
        if (JSON.stringify(identity(await namespace.stat({ bigint: true }))) !==
            JSON.stringify(plan?.ancestorIdentity ?? e.parentIdentity)) refuse("stale");
        await assertExact(e, repo);
        // A throwing begin may already have published intent: report recovery,
        // never treat that exception as a safe retry or invent a resolution.
        intentStarted = true;
        intent = await saved.admission.beginIntent(structuredClone(e));
        if (!intent || typeof intent.assertOwned !== "function" || typeof intent.completed !== "function" || typeof intent.recordFailure !== "function") refuse();
        phase = "before-add";
        await options.afterIntent?.();
        await assertExact(e, repo, options.duringFinalPreflight);
        // Final LIVE revocation check follows all asynchronous exact preflight.
        // Launch preparation may still await; assert runtime authority again at
        // the actual effect below, AFTER that preparation (never just here).
        await options.authorize("before-add", options.candidate);
        currentSync?.();
        if (plan) {
          // Single exclusive mkdir under the already-open canonical repo parent.
          // Never recursive, never adopt EEXIST, never overwrite/chmod an entry.
          const mapped = join(`/proc/${process.pid}/fd/${namespace.fd}`, basename(plan.path));
          const creationOptions = { mode: plan.mode, recursive: false };
          if (options.duringParentLaunch) await options.duringParentLaunch();
          assertOwnedSync(intent);
          currentSync?.();
          phase = "create-parent"; parentCreationAttempted = true;
          const creation = mkdir(mapped, creationOptions); // synchronous launch, no await after the fence
          await creation;
          parentCreated = true;
          const created = await lstat(mapped, { bigint: true });
          if (!created.isDirectory() || created.isSymbolicLink() || (Number(created.mode) & 0o7777) !== plan.mode ||
              Number(created.uid) !== process.geteuid!()) refuse();
          parent = await open(mapped, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          if (JSON.stringify(identity(await parent.stat({ bigint: true }))) !== JSON.stringify(identity(created)) ||
              (await names(`/proc/${process.pid}/fd/${parent.fd}`)).length !== 0) refuse("stale");
          measuredParent = { path: plan.path, identity: identity(created), mode: Number(created.mode) & 0o7777,
            ownerUid: Number(created.uid), ancestorPath: plan.ancestorPath, ancestorIdentity: structuredClone(plan.ancestorIdentity) };
          await knownParent(e, measuredParent);
          await parent.sync(); await namespace.sync();
          phase = "after-parent";
          await options.afterParentCreate?.();
          // Parent creation is an effect, not permission to proceed on old refs
          // or checkout state. Revalidate everything and recheck live authority.
          if (JSON.stringify(identity(await parent.stat({ bigint: true }))) !== JSON.stringify(measuredParent.identity)) refuse("stale");
          await assertExact(e, repo, undefined, measuredParent);
          await options.authorize("before-add", options.candidate);
          currentSync?.();
        }
        // Equivalent bounded native addWorktree primitive, without its implicit
        // sibling mkdir, allowFileRoot side effect or mutable repository discovery.
        await git(e.source, ["worktree", "add", ...(request.mode === "create" ? ["--no-track", "-b", request.branch] : []),
          "--", request.destinationPath, request.mode === "create" ? e.resultOid : request.branch], false, () => {
            assertOwnedSync(intent!);
            currentSync?.();
            phase = "add"; attempted = true;
          }, options.duringAddLaunch);
        phase = "verify";
        await options.afterAdd?.();
        await knownParent(e, measuredParent);
        if (!parent || JSON.stringify(identity(await parent.stat({ bigint: true }))) !==
            JSON.stringify(measuredParent?.identity ?? e.parentIdentity)) refuse("stale");
        if (plan) await parent.sync();
        const proof = freeze(await verify(e, repo, measuredParent));
        // No awaited publication between independent verification and the private
        // identity registration. Adapter may publish these verified facts before
        // allowing ONLY the expected new inventory, not waive unresolved state.
        nativeProofs.set(proof, freeze(structuredClone(proof)));
        assertOwnedSync(intent, proof);
        phase = "completed-record";
        await intent.completed(proof);
        return { status: request.mode === "create" ? "created" : "attached", actionId: e.actionId,
          path: request.destinationPath, branch: request.branch, oid: proof.resultOid, treeOid: proof.treeOid,
          ...(measuredParent ? { knownParentCreation: structuredClone(measuredParent) } : {}) };
      } catch (error) {
        if (intentStarted) {
          let present: boolean | null = null;
          try { await lstat(request.destinationPath); present = true; }
          catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") present = false; }
          const observed = await git(repo, ["show-ref", "--verify", "--hash", `refs/heads/${request.branch}`]).then((s) => s.trim(), () => "");
          try {
            if (intent && typeof intent.recordFailure === "function") await intent.recordFailure({ version: 1,
              actionId: e.actionId, phase, addAttempted: attempted, observedBranchOid: OID.test(observed) ? observed : null,
              destinationPresent: present, recoveryRequired: true,
              ...(plan ? { parentCreationAttempted, parentCreated,
                ...(measuredParent ? { knownParentCreation: structuredClone(measuredParent) } : {}) } : {}) });
          } catch { /* Original durable intent remains; never invent a release. */ }
        } else throw error; // definite pre-intent refusal
        throw new GitWorkspaceOperationError("recovery-required", `Workspace intent ${e.actionId} requires manual recovery; do not retry.`, e.actionId);
      } finally {
        await Promise.allSettled([namespace, ...(parent && parent !== namespace ? [parent] : [])].map((fd) => fd.close()));
      }
    });
  } finally { release(); }
}
async function verify(e: GitWorkspaceEvidence, repo: Repo,
  measuredParent?: GitWorkspaceKnownParentCreation): Promise<GitWorkspaceCompletedProof> {
  const r = e.request;
  await knownParent(e, measuredParent);
  await revalidateGitProjectResources(e.source);
  if (JSON.stringify(await checkout(repo, e.source)) !== JSON.stringify(e.sourceSnapshot)) refuse("stale");
  if (e.baseCheckout) await pinned(e.baseCheckout, async (base) => {
    if (JSON.stringify(await checkout(base, e.baseCheckout!)) !== JSON.stringify(e.baseSnapshot)) refuse("stale");
  });
  const now = await inventory(repo);
  const expectedRefs = e.refs.trimEnd().split("\n").filter(Boolean);
  if (r.mode === "create") expectedRefs.push(`refs/heads/${r.branch}\0${e.resultOid}\0`);
  if (JSON.stringify(expectedRefs.sort()) !== JSON.stringify(now.refs.trimEnd().split("\n").filter(Boolean).sort())) refuse("stale");
  const oldRows = e.registrations.slice(0, -2).split("\0\0"), rows = now.registrations.slice(0, -2).split("\0\0");
  const added = `worktree ${r.destinationPath}\0HEAD ${e.resultOid}\0branch refs/heads/${r.branch}`;
  if (JSON.stringify([...oldRows, added].sort()) !== JSON.stringify(rows.sort())) refuse("stale");
  // Do NOT widen file access to make this verification succeed. The conventional
  // sibling was validated separately; selector access still requires parent
  // allowance. Verify native registration/backlinks directly under pinned dirs.
  const marker = (await bytes(join(r.destinationPath, ".git"), 4096)).toString("utf8");
  const match = /^gitdir: (.+)\n$/.exec(marker);
  if (!match || !isAbsolute(match[1])) refuse();
  const gitDir = match[1];
  if (!samePath(dirname(gitDir), join(e.source.commonDir, "worktrees")) || !basename(gitDir)) refuse();
  const gitIdentity = await physical(gitDir), checkoutIdentity = await physical(r.destinationPath);
  const backlink = await bytes(join(gitDir, "gitdir"), 4096), common = await bytes(join(gitDir, "commondir"), 4096);
  if (backlink.toString("utf8") !== `${join(r.destinationPath, ".git")}\n` ||
      !samePath(resolve(gitDir, common.toString("utf8").trim()), e.source.commonDir)) refuse();
  const destination: GitProjectResources = { projectRoot: e.source.projectRoot, cwd: r.destinationPath, branch: r.branch,
    gitDir, commonDir: e.source.commonDir, identities: { project: e.source.identities.project, checkout: checkoutIdentity,
      git: gitIdentity, common: e.source.identities.common, marker: { ...identity(await lstat(join(r.destinationPath, ".git"), { bigint: true })),
        changed: String((await lstat(join(r.destinationPath, ".git"), { bigint: true })).ctimeNs), size: String(Buffer.byteLength(marker)) } } };
  // Pin without the access selector: this is measured result of the already
  // authorized absent destination, not a new caller-supplied checkout selector.
  const fds: FileHandle[] = [];
  const pin = async (path: string, expected: Identity) => {
    const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); fds.push(fd);
    if (JSON.stringify(identity(await fd.stat({ bigint: true }))) !== JSON.stringify(expected)) refuse();
    return `/proc/${process.pid}/fd/${fd.fd}`;
  };
  try {
    const destRepo = { cwd: await pin(destination.cwd, checkoutIdentity), gitDir: await pin(gitDir, gitIdentity), commonDir: repo.commonDir };
    await destinationEntries(destRepo, e.treeOid);
    const actual = await checkout(destRepo, destination);
    if (JSON.stringify(await physical(destination.cwd)) !== JSON.stringify(checkoutIdentity) ||
        JSON.stringify(await physical(destination.gitDir)) !== JSON.stringify(gitIdentity) ||
        !common.equals(await bytes(join(destRepo.gitDir, "commondir"), 4096))) refuse("stale");
    if (actual.configDigest !== e.sourceSnapshot.configDigest || actual.oid !== e.resultOid || await safeTree(destRepo, actual.oid) !== e.treeOid ||
        await git(destRepo, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]) !== "" ||
        !samePath(await realpath(destination.cwd), destination.cwd) || marker !== (await bytes(join(destination.cwd, ".git"), 4096)).toString("utf8") ||
        !backlink.equals(await bytes(join(destRepo.gitDir, "gitdir"), 4096)) ||
        JSON.stringify(await inventory(repo)) !== JSON.stringify(now) ||
        JSON.stringify(await checkout(repo, e.source)) !== JSON.stringify(e.sourceSnapshot)) refuse("stale");
    await knownParent(e, measuredParent);
    return { version: 1, outcome: "completed", actionId: e.actionId, mode: r.mode, destination,
      sourceOid: e.sourceSnapshot.oid, baseOid: r.expectedBaseOid, branchRef: actual.ref, resultOid: actual.oid, treeOid: e.treeOid,
      sourceIndexDigest: e.sourceSnapshot.indexDigest, destinationIndexDigest: actual.indexDigest,
      sourceTrackedFilesDigest: e.sourceSnapshot.trackedFilesDigest,
      destinationTrackedFilesDigest: actual.trackedFilesDigest, configDigest: actual.configDigest,
      refsDigest: hash(now.refs), registrationsDigest: hash(now.registrations), backlinkDigest: hash(backlink),
      ...(measuredParent ? { knownParentCreation: structuredClone(measuredParent) } : {}), status: "clean" };
  } finally { await Promise.allSettled(fds.map((fd) => fd.close())); }
}
