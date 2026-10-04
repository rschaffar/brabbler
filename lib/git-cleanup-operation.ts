// INTERNAL Linux backend. No dispatch, controller registry, journal or admission implementation.
// Native pathname removal can still race arbitrary external writers; this is NOT a sandbox.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, readFile, realpath, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isAsyncFunction, isGeneratorFunction } from "node:util/types";
import { isDeepStrictEqual } from "node:util";
import { captureGitMutationAuthority, type GitMutationInvocation, type GitMutationInvocationAuthority } from "./git-mutation-invocation";
import type { GitInvocationBinding } from "./git-invocation";
import { assertGitCleanupNativeStateSync } from "./git-cleanup-admission";
import { gitExecEnv } from "./git-exec";
import { parseBoundedGitWorktreePaths, type GitProjectResources } from "./git-project-resources";
import { validLocalBranchName } from "./git-workflow-policy";

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const LIMIT = 64 * 1024 * 1024;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const equal = isDeepStrictEqual;
type Identity = GitProjectResources["identities"]["checkout"];
const identity = (s: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Identity =>
  ({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) });
type Repo = { cwd: string; gitDir: string; commonDir: string };
const markers = ["MERGE_HEAD", "MERGE_AUTOSTASH", "AUTO_MERGE", "REBASE_HEAD", "rebase-merge", "rebase-apply",
  "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START", "index.lock", "HEAD.lock", "config.lock", "packed-refs.lock", "ORIG_HEAD.lock"];
export class GitCleanupOperationError extends Error {
  constructor(readonly code: "unsafe" | "stale" | "ignored-blocked" | "recovery-required", readonly facts?: GitCleanupFailure,
    readonly ignored?: readonly GitCleanupIgnoredEntry[], readonly completedProof?: GitCleanupCompletedProof) {
    super(code === "recovery-required" ? "Cleanup requires manual recovery; do not retry." : "Cleanup refused; inspect the selected resources.");
  }
}
function refuse(code: GitCleanupOperationError["code"] = "unsafe"): never { throw new GitCleanupOperationError(code); }
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
async function absent(path: string) { if (await exists(path)) refuse(); }
async function physical(path: string): Promise<Identity> {
  if (!isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path)) refuse();
  const s = await lstat(path, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path) refuse();
  return identity(s);
}
// Beneath an already descriptor-pinned directory, permit the intentional /proc
// ancestor but never a symlink at the inspected child itself.
async function directory(path: string): Promise<void> {
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink()) refuse();
}
async function bytes(path: string, limit = 1024 * 1024): Promise<Buffer> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await fd.stat({ bigint: true });
    if (!s.isFile() || s.nlink !== BigInt(1) || s.size > BigInt(limit)) refuse();
    const data = Buffer.alloc(Number(s.size) + 1);
    let length = 0;
    while (length < data.length) {
      const r = await fd.read(data, length, data.length - length, length);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    const end = await fd.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    if (BigInt(length) !== s.size || end.ctimeNs !== s.ctimeNs || end.mtimeNs !== s.mtimeNs || !equal(identity(named), identity(s))) refuse("stale");
    return data.subarray(0, length);
  } finally { await fd.close(); }
}
class ChildFailure extends Error {
  constructor(readonly terminated: boolean, readonly timedOut: boolean, readonly reaped?: Promise<void>) { super("Native Git failed; output withheld."); }
}
/** Wait for positive close, not kill()'s boolean. Missing close is this attempt's uncertainty, never a repository veto. */
async function git(repo: Repo, args: string[], input?: string, passive = false,
  atSpawn?: () => void, prepareLaunch?: () => void | Promise<void>, afterSpawn?: () => void): Promise<string> {
  // Any awaited launch preparation precedes environment/argument construction
  // and ALL final synchronous guards. No promise turn is allowed after atSpawn.
  if (prepareLaunch) await prepareLaunch();
  const argv = ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
    ...(passive ? [] : ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null"]), ...args];
  const env = { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_ATTR_NOSYSTEM: "1", GIT_PAGER: "cat" };
  return new Promise((accept, reject) => {
    atSpawn?.();
    const child = spawn("git", argv, { env, stdio: ["pipe", "pipe", "pipe"] });
    let resolveReaped!: () => void;
    const reaped = new Promise<void>((resolve) => { resolveReaped = resolve; });
    let timedOut = false, overflow = false, size = 0, settled = false;
    const chunks: Buffer[] = [];
    let escalation: NodeJS.Timeout | undefined, uncertainty: NodeJS.Timeout | undefined;
    const stop = () => {
      if (timedOut) return;
      timedOut = true; child.kill("SIGTERM");
      escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
      uncertainty = setTimeout(() => {
        // Keep draining/observing the owned child, but never hold a repository gate.
        child.unref();
        for (const stream of [child.stdin, child.stdout, child.stderr]) (stream as typeof stream & { unref?(): void }).unref?.();
        finish(new ChildFailure(false, true, reaped));
      }, 5000);
    };
    const timer = setTimeout(stop, 15000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(escalation); clearTimeout(uncertainty);
      if (error) reject(error);
      else {
        try { accept(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { reject(new GitCleanupOperationError("unsafe")); }
      }
    };
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) { overflow = true; stop(); } else chunks.push(chunk); });
    child.stderr.on("data", () => { /* Never disclose command output/config/credentials. */ });
    child.stdin.on("error", () => { /* close decides success */ });
    child.on("error", () => { if (!child.pid) finish(new ChildFailure(true, false)); else stop(); });
    child.on("close", (code) => { resolveReaped(); finish(code === 0 && !timedOut && !overflow ? undefined : new ChildFailure(true, timedOut)); });
    // Internal node:test seam only: a competing real writer can win after the
    // child starts but before its conditional transaction consumes stdin.
    try { afterSpawn?.(); }
    catch { child.stdin.destroy(); stop(); return; }
    child.stdin.end(input);
  });
}
async function names(path: string): Promise<string[]> {
  const result: string[] = [];
  const dir = await opendir(path);
  for await (const e of dir) { if (result.length >= 2000) refuse(); result.push(e.name); }
  return result.sort();
}
/** Metadata only, complete within explicit budgets. No alternate object store,
 * symlink, hardlink, special file or mount indirection is supported by this backend.
 * Walk objects/info/pack and the shared info/refs/logs/hooks/admin namespaces
 * BEFORE invoking object-reading Git. The physical common root is independently
 * pinned; every child must stay there
 * and outside the approved source, even when ALL ignored names were approved. */
async function sharedStorage(common: string, source: string): Promise<string> {
  await physical(common);
  const entries: unknown[] = [];
  let count = 0, metadataBytes = 0;
  const scan = async (path: string, relative: string, registration = false): Promise<void> => {
    if (++count > 2000 || path === source || path.startsWith(`${source}/`) || /[\x00-\x1f\x7f]/.test(relative)) refuse();
    const s = await lstat(path, { bigint: true });
    if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile()) || s.isFile() && s.nlink !== BigInt(1) ||
      await realpath(path) !== path) refuse();
    if (["objects/info/alternates", "objects/info/http-alternates"].includes(relative) && (!s.isFile() || s.size !== BigInt(0))) refuse();
    const row = [relative, s.isDirectory() ? "directory" : "file", identity(s), String(s.mode), String(s.size), String(s.ctimeNs), String(s.mtimeNs)];
    metadataBytes += Buffer.byteLength(JSON.stringify(row));
    if (metadataBytes > 1024 * 1024) refuse();
    // Own admin removal is separately measured by the registration inventory.
    // Still completely classify its storage/backlinks/logs for indirection, but
    // do not require the deleted registration subtree in the stable digest.
    if (!registration) entries.push(row);
    if (s.isDirectory()) for (const name of await names(path)) await scan(join(path, name), `${relative}/${name}`, registration);
  };
  for (const name of ["objects", "info", "refs", "logs", "hooks", "worktrees"]) {
    const root = join(common, name);
    if (name !== "objects" && !await exists(root)) continue;
    await directory(root); await mounts(root);
    await scan(root, name, name === "worktrees");
  }
  // Fresh positive storage validation above remains mandatory, but unrelated
  // object/ref/log progress is not a dependency of this cleanup candidate.
  return hash(JSON.stringify(await physical(common)));
}
async function config(repo: Repo): Promise<string> {
  await bytes(join(repo.commonDir, "config"));
  const raw = await git(repo, ["config", "--list", "--null"], undefined, true);
  for (const row of raw.split("\0").filter(Boolean)) {
    const at = row.indexOf("\n"), key = row.slice(0, at).toLowerCase(), value = row.slice(at + 1).toLowerCase();
    if (at < 0) refuse();
    if (["core.fsmonitor", "core.autocrlf", "core.sparsecheckout", "core.splitindex", "index.sparse", "commit.gpgsign", "tag.gpgsign"].includes(key) && value === "false") continue;
    if (/^(objects\.|core\.(object|alternate)|include|filter\.|diff\.(external|.*\.(command|textconv))|merge\.|extensions\.|index\.|gpg\.|submodule\.|remote\..*\.promisor|core\.(hookspath|fsmonitor|attributesfile|worktree|sparsecheckout|splitindex|autocrlf|eol|symlinks|ignorecase|protecthfs|protectntfs)|commit\.gpgsign|tag\.gpgsign|worktree\.)/.test(key)) refuse();
  }
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    for (const name of [...(dir === repo.gitDir ? markers : ["config.lock", "packed-refs.lock"]),
      "info/attributes", "info/grafts", "shallow", "config.worktree", "locked"]) await absent(join(dir, name));
    if ((await names(dir)).some((n) => n.startsWith("sharedindex."))) refuse();
    const hooks = join(dir, "hooks");
    if (await exists(hooks)) {
      await directory(hooks);
      if ((await names(hooks)).some((n) => !n.endsWith(".sample"))) refuse();
    }
  }
  if ((await git(repo, ["for-each-ref", "--format=%(refname)", "refs/replace"])).trim()) refuse();
  return hash(JSON.stringify(identity(await lstat(join(repo.commonDir, "config"), { bigint: true }))) + raw); // No config values in evidence.
}
async function mounts(root: string) {
  const data = await readFile("/proc/self/mountinfo", "utf8");
  if (data.length > 1024 * 1024) refuse();
  for (const row of data.trim().split("\n")) {
    const fields = row.split(" ");
    if (fields.length < 10) refuse();
    const path = fields[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    if (path === root || path.startsWith(`${root}/`)) refuse();
  }
}
export interface GitCleanupIgnoredEntry {
  path: string; kind: "file" | "directory"; device: string; inode: string; birthtime: string;
  size: string; mode: string; changed: string; modified: string;
}
type Checkout = { oid: string; tree: string; config: string; index: string; head: string; tracked: string; ignored: GitCleanupIgnoredEntry[] };
async function checkout(repo: Repo, r: GitProjectResources, scanIgnored: boolean): Promise<Checkout> {
  const cfg = await config(repo);
  if (r.gitDir !== r.commonDir) {
    if ((await bytes(join(repo.cwd, ".git"), 4096)).toString("utf8") !== `gitdir: ${r.gitDir}\n` ||
      (await bytes(join(repo.gitDir, "gitdir"), 4096)).toString("utf8") !== `${r.cwd}/.git\n` ||
      resolve(r.gitDir, (await bytes(join(repo.gitDir, "commondir"), 4096)).toString("utf8").trim()) !== r.commonDir) refuse();
  }
  const ref = `refs/heads/${r.branch}`;
  const oid = (await git(repo, ["show-ref", "--verify", "--hash", ref])).trim();
  if (!OID.test(oid) || (await git(repo, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== ref ||
    (await git(repo, ["rev-parse", "HEAD^{commit}"])).trim() !== oid) refuse("stale");
  const tree = (await git(repo, ["rev-parse", `${oid}^{tree}`])).trim();
  if (!OID.test(tree)) refuse();
  const rows = (await git(repo, ["ls-tree", "-r", "-l", "-z", tree])).split("\0").filter(Boolean);
  if (rows.length > 2000) refuse();
  const files = new Map<string, { mode: string; blob: string }>(), dirs = new Set<string>([""]);
  let total = 0;
  for (const row of rows) {
    const m = /^(100644|100755) blob ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(row);
    if (!m || /(^|\/)\.(gitattributes|git)(\/|$)/.test(m[4]) || /[\x00-\x1f\x7f]/.test(m[4]) || m[4].split("/").some((p) => p === ".." || p === "." || !p)) refuse();
    total += Number(m[3]); if (total > LIMIT) refuse();
    files.set(m[4], { mode: m[1], blob: m[2] });
    let parent = dirname(m[4]);
    while (parent !== ".") { dirs.add(parent); parent = dirname(parent); }
  }
  const tracked: unknown[] = [], ignored: GitCleanupIgnoredEntry[] = [];
  let seen = 0, readBytes = 0;
  await mounts(r.cwd);
  for (const dir of [...dirs].sort()) {
    const path = dir ? join(repo.cwd, dir) : `${repo.cwd}/.`, s = await lstat(path, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || String(s.dev) !== r.identities.checkout.device) refuse();
    await absent(join(path, ".gitattributes"));
    tracked.push([dir, identity(s), String(s.mode)]);
  }
  for (const [path, f] of files) {
    const s = await lstat(join(repo.cwd, path), { bigint: true });
    if (String(s.dev) !== r.identities.checkout.device || Boolean(s.mode & BigInt(0o100)) !== (f.mode === "100755")) refuse();
    const data = await bytes(join(repo.cwd, path), LIMIT);
    readBytes += data.length; if (readBytes > LIMIT) refuse();
    if (createHash(oid.length === 40 ? "sha1" : "sha256").update(`blob ${data.length}\0`).update(data).digest("hex") !== f.blob) refuse("stale");
    tracked.push([path, identity(s), String(s.mode), hash(data)]);
  }
  const scan = async (relative: string): Promise<void> => {
    for (const name of await names(join(repo.cwd, relative))) {
      if (++seen > 2000 || /[\x00-\x1f\x7f]/.test(name)) refuse();
      const path = relative ? `${relative}/${name}` : name;
      if (path === ".git") continue;
      if (name === ".git" || name === ".gitattributes") refuse();
      const s = await lstat(join(repo.cwd, path), { bigint: true });
      if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile()) || s.isFile() && s.nlink !== BigInt(1) || String(s.dev) !== r.identities.checkout.device) refuse();
      if (!files.has(path) && !dirs.has(path)) {
        const check = await git(repo, ["check-ignore", "--no-index", "-z", "--stdin"], `${path}\0`);
        if (check !== `${path}\0`) refuse();
        ignored.push({ path, kind: s.isDirectory() ? "directory" : "file", ...identity(s), size: String(s.size),
          mode: String(s.mode), changed: String(s.ctimeNs), modified: String(s.mtimeNs) });
      }
      if (s.isDirectory()) await scan(path);
    }
  };
  if (scanIgnored) await scan("");
  if (Buffer.byteLength(JSON.stringify(ignored)) > 1024 * 1024) refuse();
  const indexPath = join(repo.gitDir, "index"), headPath = join(repo.gitDir, "HEAD");
  const index = await bytes(indexPath);
  if (index.length < 12 || index.toString("ascii", 0, 4) !== "DIRC" || ![2, 3].includes(index.readUInt32BE(4))) refuse();
  if (await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) !== "" ||
    await git(repo, ["ls-files", "-u", "-z"]) !== "" ||
    (await git(repo, ["ls-files", "-v", "-z"])).split("\0").some((row) => row && !row.startsWith("H ")) ||
    await git(repo, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", oid, "--"]) !== "") refuse();
  return { oid, tree, config: cfg, index: hash(JSON.stringify(identity(await lstat(indexPath, { bigint: true }))) + hash(index)),
    head: hash(JSON.stringify(identity(await lstat(headPath, { bigint: true }))) + hash(await bytes(headPath))), tracked: hash(JSON.stringify(tracked)), ignored };
}
async function pinned<T>(r: GitProjectResources, action: (repo: Repo) => Promise<T>): Promise<T> {
  if (process.platform !== "linux") refuse();
  const fds: FileHandle[] = [];
  let reaping: Promise<void> | undefined;
  const pin = async (path: string, id: Identity) => {
    const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); fds.push(fd);
    if (!equal(identity(await fd.stat({ bigint: true })), id) || !equal(await physical(path), id)) refuse("stale");
    return `/proc/${process.pid}/fd/${fd.fd}`;
  };
  try {
    if (!equal(await physical(r.projectRoot), r.identities.project)) refuse("stale");
    const marker = await lstat(join(r.cwd, ".git"), { bigint: true });
    if (marker.isSymbolicLink() || (!marker.isFile() && !marker.isDirectory()) ||
      !equal({ ...identity(marker), ...(marker.isFile() ? { changed: String(marker.ctimeNs), size: String(marker.size) } : {}) }, r.identities.marker)) refuse("stale");
    if (r.gitDir === r.commonDir) {
      if (r.cwd !== r.projectRoot || r.gitDir !== join(r.cwd, ".git") || !marker.isDirectory()) refuse();
    } else if (!marker.isFile() || dirname(r.gitDir) !== join(r.commonDir, "worktrees")) refuse();
    return await action({ cwd: await pin(r.cwd, r.identities.checkout), gitDir: await pin(r.gitDir, r.identities.git), commonDir: await pin(r.commonDir, r.identities.common) });
  } catch (error) {
    if (error instanceof ChildFailure && !error.terminated) reaping = error.reaped;
    throw error;
  } finally {
    const close = () => Promise.allSettled(fds.map((fd) => fd.close()));
    // A late owned child must not discover reused /proc FD numbers. These are
    // read-only pins, not retained Git locks, reservations or usage leases.
    if (reaping) void reaping.then(close);
    else await close();
  }
}
/** Registration/backlink/HEAD/index identity, NOT reflog history. Native Git
 * update-ref verify can append a HEAD reflog even without changing that ref. */
export interface GitCleanupInventory { refs: string; registrations: string; admins: Record<string, string>; checkouts: Record<string, Identity> }
async function inventory(repo: Repo, resources: GitProjectResources[]): Promise<GitCleanupInventory> {
  const refs = await git(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs"]);
  if (refs.split("\n").length > 2001) refuse();
  const registrations = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
  const checkouts: Record<string, Identity> = {};
  for (const path of parseBoundedGitWorktreePaths(Buffer.from(registrations))) {
    if (resources.some((r) => r.cwd === path)) checkouts[path] = await physical(path);
  }
  const admins: Record<string, string> = {};
  const root = join(repo.commonDir, "worktrees");
  if (await exists(root)) {
    await directory(root);
    for (const name of await names(root)) {
      if (!resources.some((r) => r.gitDir === join(r.commonDir, "worktrees", name))) continue;
      const dir = join(root, name), meta: unknown[] = [];
      const s = await lstat(dir, { bigint: true }); if (!s.isDirectory() || s.isSymbolicLink()) refuse();
      meta.push(identity(s));
      let entries = 0;
      const scan = async (relative: string): Promise<void> => {
        for (const entry of await names(join(dir, relative))) {
          if (++entries > 2000) refuse();
          if (!relative && entry === "logs") { await directory(join(dir, entry)); continue; }
          const child = relative ? `${relative}/${entry}` : entry;
          const path = join(dir, child), st = await lstat(path, { bigint: true });
          if (st.isSymbolicLink() || st.dev !== s.dev || (!st.isDirectory() && !st.isFile()) || st.isFile() && st.nlink !== BigInt(1)) refuse();
          meta.push([child, identity(st), st.isDirectory() ? "directory" : hash(await bytes(path))]);
          if (st.isDirectory()) await scan(child);
        }
      };
      await scan("");
      admins[name] = hash(JSON.stringify(meta));
    }
  }
  return selectGitCleanupInventory({ refs, registrations, admins, checkouts }, resources);
}
/** Relevant dependencies only; unrelated inventory remains informational. */
export function selectGitCleanupInventory(value: GitCleanupInventory, resources: GitProjectResources[]): GitCleanupInventory {
  const selected = new Set(resources.map((r) => `refs/heads/${r.branch}`));
  const registrations = rows(value.registrations).filter((row) => {
    const fields = row.split("\0"), cwd = fields[0].slice(9);
    return fields.some((f) => f.startsWith("branch ") && selected.has(f.slice(7))) ||
      resources.some((r) => cwd === r.cwd || cwd.startsWith(`${r.cwd}/`) || r.cwd.startsWith(`${cwd}/`));
  }).sort().join("\0\0") + "\0\0";
  return { refs: value.refs.split("\n").filter((row) => selected.has(row.split("\0")[0])).sort().join("\n") + "\n", registrations,
    admins: Object.fromEntries(Object.entries(value.admins).filter(([name]) => resources.some((r) => r.gitDir === join(r.commonDir, "worktrees", name)))),
    checkouts: Object.fromEntries(Object.entries(value.checkouts).filter(([cwd]) => resources.some((r) => r.cwd === cwd))) };
}
/** Controller must issue these only from actual completed native plans, keyed
 * by in-process handle identity. Parsed results/history/action IDs are NOT issuers. */
export interface GitCleanupIntegration {
  completedAt: number; delivery: "selected-local"; method: "ff" | "merge"; actualFF: boolean;
  feature: GitProjectResources; target: GitProjectResources;
  featureOid: string; previousTargetOid: string; resultOid: string; resultTree: string; parents: string[];
}
export interface GitCleanupCreatedWorkspace {
  mode: "create" | "attach"; destination: GitProjectResources; originalSource: GitProjectResources; branchRef: string;
}
export interface GitCleanupCandidate {
  readonly actionId: string; readonly sourcePath: string; readonly featureRef: string; readonly featureOid: string;
  readonly targetPath: string; readonly mainPath: string; readonly ignored: readonly Readonly<GitCleanupIgnoredEntry>[];
}
export interface GitCleanupEvidence {
  version: 2; actionId: string; integration: GitCleanupIntegration; creator: GitCleanupCreatedWorkspace; main: GitProjectResources;
  source: Checkout; target: Checkout; mainSnapshot: Checkout; inventory: GitCleanupInventory; sharedStorageDigest: string;
  adminParentIdentity: Identity;
}
export interface GitCleanupRemovalProof {
  version: 1; actionId: string; kind: "removed"; sourcePath: string; sourceIdentity: Identity; adminPath: string; featureOid: string;
  exit: 0; sourceAbsent: true; adminAbsent: true; before: GitCleanupInventory; after: GitCleanupInventory;
  invocationOwner: GitMutationInvocationAuthority["owner"];
}
export interface GitCleanupCompletedProof {
  version: 1; actionId: string; kind: "completed"; removal: GitCleanupRemovalProof; deletedRef: string; deletedOid: string;
  transactionExit: 0; finalInventory: GitCleanupInventory;
  /** Native Git may append HEAD reflogs on verify; no file/ref/index rollback. */
  nativeHeadReflogMayHaveChanged: true;
}
type NativeProof = GitCleanupRemovalProof | GitCleanupCompletedProof;
const nativeProofs = new WeakMap<object, { serialized: string; measured: Readonly<NativeProof>; invocation: GitMutationInvocation }>();
/** Detached read-only provenance facts, never an invocation capability. */
export interface GitCleanupCandidateAuthority {
  readonly binding: GitInvocationBinding;
  readonly evidence: GitCleanupEvidence;
}
// Private invocation identity joins the two genuine originals. No owner/action
// string comparison can substitute for this association, including after retire.
const candidateAuthorities = new WeakMap<object, {
  evidence: Readonly<GitCleanupEvidence>; invocation: GitMutationInvocation;
}>();
function freezeData<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
/** Detached original capture facts for review, not an execution capability or
 * native provenance. No callbacks/current-state reconstruction; copies, IDs and
 * reader-returned facts are never handles. Originals remain readable on retire. */
export function readGitCleanupCandidateEvidence(originalCandidate: unknown): Readonly<GitCleanupEvidence> | undefined {
  if (!originalCandidate || typeof originalCandidate !== "object") return undefined;
  const saved = candidateAuthorities.get(originalCandidate);
  return saved ? freezeData(structuredClone(saved.evidence)) : undefined;
}
/** Original candidate provenance for a trusted fence's pre-removal binding.
 * The detached, recursively frozen metadata is not itself a recognized handle. */
export function readGitCleanupCandidateAuthority(originalCandidate: unknown): Readonly<GitCleanupCandidateAuthority> | undefined {
  if (!originalCandidate || typeof originalCandidate !== "object") return undefined;
  const saved = candidateAuthorities.get(originalCandidate);
  return saved ? freezeData(structuredClone({ binding: saved.invocation.binding, evidence: saved.evidence })) : undefined;
}
/** Authenticate the SAME private invocation, not a structural owner/action join.
 * Historical facts remain readable after retire; reading never restores rights. */
export function readGitCleanupRemovalAuthority(originalCandidate: unknown,
  originalRemovalProof: unknown): Readonly<GitCleanupCandidateAuthority> | undefined {
  if (!originalCandidate || typeof originalCandidate !== "object" ||
      !originalRemovalProof || typeof originalRemovalProof !== "object") return undefined;
  const candidate = candidateAuthorities.get(originalCandidate), removal = nativeProofs.get(originalRemovalProof);
  if (!candidate || !removal || candidate.invocation !== removal.invocation ||
      readGitCleanupNativeProof(originalRemovalProof)?.kind !== "removed") return undefined;
  return readGitCleanupCandidateAuthority(originalCandidate);
}
/** Issued ONLY after successful native exit and independent effect verification.
 * Snapshots/history/clones/action IDs (including this reader's returned metadata)
 * are never proof handles. Mutation of an original handle invalidates its use. */
export function readGitCleanupNativeProof(handle: unknown): Readonly<NativeProof> | undefined {
  if (!handle || typeof handle !== "object") return undefined;
  const saved = nativeProofs.get(handle);
  if (!saved) return undefined;
  try { return JSON.stringify(handle) === saved.serialized ? saved.measured : undefined; }
  catch { return undefined; }
}
function issueNativeProof<P extends NativeProof>(proof: P, invocation: GitMutationInvocation): P {
  nativeProofs.set(proof, { serialized: JSON.stringify(proof), measured: freezeData(structuredClone(proof)), invocation });
  return freezeData(proof);
}
export interface GitCleanupFailure {
  version: 1; actionId: string; phase: string; removeAttempted: boolean; removalVerified: boolean; removalRecorded: boolean;
  branchDeleteAttempted: boolean; branchDeleteVerified: boolean; sourceAbsent: boolean | null; adminAbsent: boolean | null;
  observedFeatureOid: string | null; featureRefAbsent: boolean | null; removeExit: 0 | null; transactionExit: 0 | null;
  childTerminationConfirmed: boolean; failureRecorded: boolean; recoveryRequired: true;
  expectedFeatureOid?: string; expectedTargetOid?: string; expectedMainOid?: string;
  // Last independently measured snapshots, NOT a claim of current state after a
  // later failure/external write. Preserve actual trees/OIDs even before effects.
  verifiedFeatureOid?: string; verifiedFeatureTree?: string;
  verifiedTargetOid?: string; verifiedTargetTree?: string; verifiedMainOid?: string; verifiedMainTree?: string;
  completedRecorded?: boolean;
  originalFailureCode?: "unsafe" | "stale" | "ignored-blocked" | "recovery-required" | "refused";
}
/** Optional bounded diagnostics. Neither acknowledgement nor publication is authority. */
export interface GitCleanupDiagnostics {
  onIntent?(evidence: Readonly<GitCleanupEvidence>): Promise<void>;
  onRemoval?(proof: Readonly<GitCleanupRemovalProof>): Promise<void>;
  onCompleted?(proof: Readonly<GitCleanupCompletedProof>): Promise<void>;
  onFailure?(facts: Readonly<GitCleanupFailure>): Promise<void>;
}
export interface GitCleanupAdapters extends GitCleanupDiagnostics {
  nativeAuthority: GitMutationInvocationAuthority;
  readCompletedIntegration(handle: object): GitCleanupIntegration | undefined;
  readCreatedWorkspace(handle: object): GitCleanupCreatedWorkspace | undefined;
  /** Explicit designated Project main, not guessed from branch or primary. */
  getProjectMain(): Promise<GitProjectResources>;
  /** Live actor, exact approval, revocation/pause, policy/rules AND allowed-root
   * access. Registry-captured resources themselves are not execution grants. */
  authorize(phase: "capture" | "before-remove" | "before-delete", candidate?: GitCleanupCandidate,
    removal?: GitCleanupRemovalProof): Promise<void>;
  /** Disposable node:test seam, never request-forwarded or supported in production. */
  testPrepareNativeLaunch?(phase: "remove" | "delete"): void | Promise<void>;
  testAfterDeleteSpawn?(): void;
}
/** TypeScript void permits async/value-returning implementations. Enforce the
 * synchronous undefined contract at runtime without awaiting or an effect gap. */
function synchronousVoid(callback: () => unknown): void {
  const result = callback();
  if (result !== undefined) {
    // Consume a rejected async return so a refused adapter cannot cause an
    // unhandled rejection. Never await it or infer permission from settlement.
    if (result !== null && (typeof result === "object" || typeof result === "function") && typeof (result as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(result).catch(() => {});
    }
    refuse();
  }
}
function rows(registrations: string) { return registrations.slice(0, -2).split("\0\0"); }
function afterRemoval(e: GitCleanupEvidence): GitCleanupInventory {
  const source = e.integration.feature;
  const own = rows(e.inventory.registrations).filter((r) => r.startsWith(`worktree ${source.cwd}\0`));
  if (own.length !== 1 || own[0].split("\0").length !== 3 || !own[0].includes(`\0branch refs/heads/${source.branch}`) ||
    rows(e.inventory.registrations).some((row) => row !== own[0] && row.split("\0").includes(`branch refs/heads/${source.branch}`))) refuse();
  const admins = { ...e.inventory.admins }, ownAdmin = source.gitDir.slice(source.commonDir.length + "/worktrees/".length);
  if (!Object.hasOwn(admins, ownAdmin)) refuse();
  delete admins[ownAdmin];
  const checkouts = { ...e.inventory.checkouts }; delete checkouts[source.cwd];
  return { refs: e.inventory.refs, registrations: rows(e.inventory.registrations).filter((r) => r !== own[0]).join("\0\0") + "\0\0", admins, checkouts };
}
async function namespace(repo: Repo, branches: string[]) {
  for (const branch of branches) {
    for (const prefix of [["refs", "heads"], ["logs", "refs", "heads"]]) {
      let dir = repo.commonDir;
      for (const part of [...prefix, ...branch.split("/").slice(0, -1)]) {
        dir = join(dir, part); if (await exists(dir)) await directory(dir);
      }
      const path = join(dir, branch.split("/").at(-1)!);
      await absent(`${path}.lock`);
      if (await exists(path)) {
        const data = await bytes(path);
        if (prefix[0] === "refs" && data.toString("utf8").startsWith("ref:")) refuse();
      }
    }
  }
  if (await exists(join(repo.commonDir, "packed-refs"))) await bytes(join(repo.commonDir, "packed-refs"));
}
async function integration(repo: Repo, i: GitCleanupIntegration) {
  if (i.delivery !== "selected-local" || ![i.featureOid, i.previousTargetOid, i.resultOid, i.resultTree, ...i.parents].every((v) => OID.test(v))) refuse();
  if ((await git(repo, ["cat-file", "-t", i.previousTargetOid])).trim() !== "commit") refuse();
  const actual = (await git(repo, ["rev-list", "--parents", "-n", "1", i.resultOid])).trim().split(" ");
  const tree = (await git(repo, ["rev-parse", `${i.resultOid}^{tree}`])).trim();
  if (!equal(actual, [i.resultOid, ...i.parents]) || tree !== i.resultTree) refuse("stale");
  if (i.method === "ff" && i.actualFF === true) {
    if (i.resultOid !== i.featureOid || i.previousTargetOid === i.featureOid) refuse();
    await git(repo, ["merge-base", "--is-ancestor", i.previousTargetOid, i.featureOid]);
  } else if (i.method === "merge" && i.actualFF === false) {
    if (!equal(i.parents, [i.previousTargetOid, i.featureOid]) || i.resultOid === i.featureOid) refuse();
  } else refuse();
}
function selection(i: GitCleanupIntegration, c: GitCleanupCreatedWorkspace, main: GitProjectResources) {
  const s = i.feature;
  for (const r of [s, i.target, c.destination, c.originalSource, main]) {
    if (!validLocalBranchName(r.branch) || r.commonDir !== s.commonDir || r.projectRoot !== s.projectRoot ||
      !equal(r.identities.common, s.identities.common) || !equal(r.identities.project, s.identities.project)) refuse();
  }
  if (c.mode !== "create" || !equal(c.destination, s) || c.branchRef !== `refs/heads/${s.branch}` ||
    s.cwd === s.projectRoot || s.cwd === c.originalSource.cwd || s.branch === c.originalSource.branch ||
    !s.gitDir.startsWith(`${s.commonDir}/worktrees/`) || dirname(s.gitDir) !== `${s.commonDir}/worktrees`) refuse();
  for (const r of [main, i.target, c.originalSource]) {
    if (s.branch === r.branch || s.cwd === r.cwd || s.cwd.startsWith(`${r.cwd}/`) || r.cwd.startsWith(`${s.cwd}/`) || equal(s.identities.checkout, r.identities.checkout)) refuse();
  }
}
/** Public-runtime entry. Require a live synchronous authority assertion at the
 * ACTUAL child-spawn boundary, after preparation/environment and final owned
 * native state guards. Never await after the last guard. */
export function createGitCleanupEngineWithAuthority(adapters: GitCleanupAdapters & { assertCurrentSync(): void }) {
  const guard = adapters?.assertCurrentSync;
  if (typeof guard !== "function" || isAsyncFunction(guard) || isGeneratorFunction(guard) ||
    typeof (guard as unknown as PromiseLike<unknown>).then === "function") refuse();
  return cleanupEngine(adapters, () => guard.call(adapters));
}
/** Both entries require real capture-time nativeAuthority. No fixture bypass. */
export function createGitCleanupEngine(adapters: GitCleanupAdapters) {
  return cleanupEngine(adapters);
}
/** Trusted controller closures only. Keep one engine per controller lifetime;
 * never rehydrate handles/candidates from results/history or across restart. */
function cleanupEngine(adapters: GitCleanupAdapters, assertCurrentSync?: () => void) {
  if ((adapters.testPrepareNativeLaunch || adapters.testAfterDeleteSpawn) && !process.env.NODE_TEST_CONTEXT) refuse();
  type Saved = { e: GitCleanupEvidence; at: number; integrationHandle: object; creatorHandle: object; candidate: string;
    invocation: GitMutationInvocation };
  const candidates = new WeakMap<GitCleanupCandidate, Saved>();
  // Engine-local identity prevents a different engine from retiring this owner.
  const candidateInvocations = new WeakMap<object, GitMutationInvocation>();
  const read = (ih: object, ch: object) => {
    if (!ih || typeof ih !== "object" || !ch || typeof ch !== "object") refuse("stale");
    const i = adapters.readCompletedIntegration(ih), c = adapters.readCreatedWorkspace(ch);
    if (!i || !c || !Number.isFinite(i.completedAt) || Date.now() < i.completedAt || Date.now() - i.completedAt > 900000) refuse("stale");
    return { i: structuredClone(i), c: structuredClone(c) };
  };
  const live = async (saved: Saved) => {
    // During apply the handle is consumed; still require the original registry evidence.
    const i = adapters.readCompletedIntegration(saved.integrationHandle), c = adapters.readCreatedWorkspace(saved.creatorHandle);
    if (!i || !c || Date.now() < i.completedAt || Date.now() - i.completedAt > 900000 || !equal(i, saved.e.integration) || !equal(c, saved.e.creator) ||
      !equal(await adapters.getProjectMain(), saved.e.main)) refuse("stale");
  };
  const exact = async (e: GitCleanupEvidence, removed: boolean, repo: Repo) => {
    if (await sharedStorage(e.integration.feature.commonDir, e.integration.feature.cwd) !== e.sharedStorageDigest) refuse("stale");
    await integration(repo, e.integration);
    await namespace(repo, [e.integration.feature.branch, e.integration.target.branch, e.main.branch]);
    for (const [r, snap] of [[e.integration.target, e.target], [e.main, e.mainSnapshot]] as const) {
      if (!equal(await pinned(r, (p) => checkout(p, r, false)), snap)) refuse("stale");
    }
    if (!removed && !equal(await pinned(e.integration.feature, (p) => checkout(p, e.integration.feature, true)), e.source)) refuse("stale");
    const expected = removed ? afterRemoval(e) : e.inventory;
    if (!equal(await inventory(repo, [e.integration.feature, e.integration.target, e.main]), expected)) refuse("stale");
    if (removed) {
      await absent(e.integration.feature.cwd); await absent(e.integration.feature.gitDir);
      if (rows(expected.registrations).some((row) => row.split("\0").includes(`branch refs/heads/${e.integration.feature.branch}`))) refuse();
    }
  };
  return {
    async capture(request: { integrationHandle: object; creatorHandle: object; ignoredNames?: readonly string[] }): Promise<GitCleanupCandidate> {
      const authority = captureGitMutationAuthority(adapters.nativeAuthority);
      const { i, c } = read(request.integrationHandle, request.creatorHandle), main = structuredClone(await adapters.getProjectMain());
      selection(i, c, main);
      const actionId = randomUUID();
      try {
        await adapters.authorize("capture");
        const sharedStorageDigest = await sharedStorage(i.feature.commonDir, i.feature.cwd);
        const source = await pinned(i.feature, (p) => checkout(p, i.feature, true));
        const ignored = source.ignored;
        const supplied = request.ignoredNames ?? [];
        if (supplied.length > 2000 || supplied.some((s) => typeof s !== "string" || /[*?\[\]{}]/.test(s)) ||
          !equal([...supplied].sort(), ignored.map((e) => e.path).sort())) throw new GitCleanupOperationError("ignored-blocked", undefined, ignored);
        return await pinned(i.target, async (repo) => {
          const target = await checkout(repo, i.target, false), mainSnapshot = await pinned(main, (p) => checkout(p, main, false));
          if (source.oid !== i.featureOid || target.oid !== i.resultOid) refuse("stale");
          const e: GitCleanupEvidence = { version: 2, actionId, integration: i, creator: c, main, source, target, mainSnapshot,
            inventory: await inventory(repo, [i.feature, i.target, main]), sharedStorageDigest,
            adminParentIdentity: await physical(join(i.feature.commonDir, "worktrees")) };
          afterRemoval(e); // classify own exact row and admin before approval
          const paths = parseBoundedGitWorktreePaths(Buffer.from(e.inventory.registrations));
          for (const path of paths) {
            await physical(path);
            if (path !== i.feature.cwd && (path.startsWith(`${i.feature.cwd}/`) || i.feature.cwd.startsWith(`${path}/`))) refuse();
          }
          await exact(e, false, repo);
          authority.assertOriginalSync();
          const candidate: GitCleanupCandidate = Object.freeze({ actionId: e.actionId, sourcePath: i.feature.cwd, featureRef: c.branchRef,
            featureOid: i.featureOid, targetPath: i.target.cwd, mainPath: main.cwd,
            ignored: Object.freeze(ignored.map((entry) => Object.freeze({ ...entry }))) });
          const invocation = authority.bind({ kind: "cleanup", source: i.feature, target: i.target, candidateSha256: hash(JSON.stringify(candidate)) });
          const saved = { e, at: Date.now(), integrationHandle: request.integrationHandle, creatorHandle: request.creatorHandle, candidate: JSON.stringify(candidate), invocation };
          try {
            await live(saved); invocation.assertCurrentSync();
            candidateAuthorities.set(candidate, { evidence: freezeData(structuredClone(e)), invocation });
            candidateInvocations.set(candidate, invocation);
            candidates.set(candidate, saved);
          }
          catch (error) { invocation.retire(); throw error; }
          return candidate;
        });
      } catch (error) {
        if (error instanceof ChildFailure && !error.terminated) {
          // Read-only capture has no destructive effect. Report only its own uncertainty.
          throw new GitCleanupOperationError("recovery-required", { version: 1, actionId, phase: "capture",
            removeAttempted: false, removalVerified: false, removalRecorded: false, branchDeleteAttempted: false, branchDeleteVerified: false,
            sourceAbsent: null, adminAbsent: null, observedFeatureOid: null, featureRefAbsent: null, removeExit: null, transactionExit: null,
            childTerminationConfirmed: false, failureRecorded: false, recoveryRequired: true });
        }
        throw error;
      }
    },
    /** Identity-only and idempotent for this engine's originals, even after an
     * attempted apply. Never performs native IO or erases known partial facts. */
    retire(originalCandidate: unknown): void {
      const invocation = originalCandidate && typeof originalCandidate === "object"
        ? candidateInvocations.get(originalCandidate) : undefined;
      if (!invocation) refuse("stale");
      invocation.retire();
      candidates.delete(originalCandidate as GitCleanupCandidate);
    },
    async apply(candidate: GitCleanupCandidate): Promise<{ status: "completed"; proof: GitCleanupCompletedProof;
      diagnostics: "not-requested" | "recorded" | "unavailable" }> {
      const saved = candidates.get(candidate);
      if (!saved) refuse("stale");
      candidates.delete(candidate);
      const e = saved.e, s = e.integration.feature, invocation = saved.invocation;
      let completedProof: GitCleanupCompletedProof | undefined;
      let diagnostics: "not-requested" | "recorded" | "unavailable" = "not-requested";
      const diagnostic = async (callback?: () => Promise<void>): Promise<boolean> => {
        if (!callback) return false;
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([callback(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Diagnostics unavailable")), 1000);
          })]);
          if (diagnostics !== "unavailable") diagnostics = "recorded";
          return true;
        } catch { diagnostics = "unavailable"; return false; }
        finally { clearTimeout(timer); }
      };
      const ownRemoval = (proof: GitCleanupRemovalProof) => {
        if (nativeProofs.get(proof)?.invocation !== invocation || !readGitCleanupNativeProof(proof)) refuse("stale");
      };
      const facts: GitCleanupFailure = { version: 1, actionId: e.actionId, phase: "preflight", removeAttempted: false, removalVerified: false, removalRecorded: false,
        branchDeleteAttempted: false, branchDeleteVerified: false, sourceAbsent: null, adminAbsent: null, observedFeatureOid: null,
        featureRefAbsent: null, removeExit: null, transactionExit: null, childTerminationConfirmed: true, failureRecorded: false, recoveryRequired: true,
        expectedFeatureOid: e.integration.featureOid, expectedTargetOid: e.target.oid, expectedMainOid: e.mainSnapshot.oid,
        verifiedFeatureOid: e.source.oid, verifiedFeatureTree: e.source.tree,
        verifiedTargetOid: e.target.oid, verifiedTargetTree: e.target.tree,
        verifiedMainOid: e.mainSnapshot.oid, verifiedMainTree: e.mainSnapshot.tree };
      try {
        if (Date.now() < saved.at || Date.now() - saved.at > 300000 || JSON.stringify(candidate) !== saved.candidate) refuse("stale");
        await live(saved);
        await adapters.authorize("before-remove", candidate);
        invocation.assertCurrentSync();
        return await pinned(e.integration.target, async (repo) => {
          await exact(e, false, repo);
          facts.phase = "intent";
          await diagnostic(adapters.onIntent && (() => adapters.onIntent!(freezeData(structuredClone(e)))));
          await exact(e, false, repo); await live(saved);
          await adapters.authorize("before-remove", candidate);
          facts.phase = "before-remove";
          // EXACTLY ONE native no-force attempt. Final guards are INSIDE git(),
          // after all awaited launch preparation and argv/environment resolution.
          await git(e.integration.target, ["worktree", "remove", "--", s.cwd], undefined, false, () => {
            if (assertCurrentSync) synchronousVoid(assertCurrentSync);
            invocation.consumeSync();
            assertGitCleanupNativeStateSync(e);
            facts.phase = "remove"; facts.removeAttempted = true;
          }, async () => {
            await adapters.testPrepareNativeLaunch?.("remove");
            await exact(e, false, repo); await live(saved);
          });
          facts.removeExit = 0;
          facts.phase = "verify-removal";
          await exact(e, true, repo);
          facts.removalVerified = true;
          facts.verifiedTargetOid = e.target.oid; facts.verifiedTargetTree = e.target.tree;
          facts.verifiedMainOid = e.mainSnapshot.oid; facts.verifiedMainTree = e.mainSnapshot.tree;
          const removal: GitCleanupRemovalProof = { version: 1, actionId: e.actionId, kind: "removed", sourcePath: s.cwd, sourceIdentity: { ...s.identities.checkout }, adminPath: s.gitDir,
            featureOid: e.integration.featureOid, exit: 0, sourceAbsent: true, adminAbsent: true, before: structuredClone(e.inventory), after: afterRemoval(e),
            invocationOwner: invocation.binding.owner };
          issueNativeProof(removal, invocation);
          facts.phase = "record-removal";
          facts.removalRecorded = await diagnostic(adapters.onRemoval && (() => adapters.onRemoval!(removal)));
          // Fresh original authority follows the genuine planned physical transition.
          facts.phase = "before-delete";
          // Accept the genuine own-removal transition before ordinary caller
          // reads: those correctly revoke an unproven disappeared checkout.
          await adapters.authorize("before-delete", candidate, removal);
          invocation.assertCurrentSync();
          await live(saved); await exact(e, true, repo);
          const refs = new Map([[`refs/heads/${e.integration.target.branch}`, e.target.oid], [`refs/heads/${e.main.branch}`, e.mainSnapshot.oid]]);
          // Git transaction option is scoped to following operations. Unsupported no-deref/transaction fails closed.
          const transaction = `start\n${[...refs].map(([ref, oid]) => `option no-deref\nverify ${ref} ${oid}\n`).join("")}option no-deref\ndelete refs/heads/${s.branch} ${e.integration.featureOid}\nprepare\ncommit\n`;
          await git(e.integration.target, ["update-ref", "--stdin"], transaction, false, () => {
            ownRemoval(removal);
            if (assertCurrentSync) synchronousVoid(assertCurrentSync);
            invocation.assertCurrentSync();
            assertGitCleanupNativeStateSync(e, removal);
            facts.phase = "delete-ref"; facts.branchDeleteAttempted = true;
          }, async () => {
            await adapters.testPrepareNativeLaunch?.("delete");
            await live(saved); await exact(e, true, repo);
          }, adapters.testAfterDeleteSpawn);
          facts.transactionExit = 0;
          facts.phase = "verify-delete";
          const expected = afterRemoval(e);
          expected.refs = expected.refs.split("\n").filter((row) => !row.startsWith(`refs/heads/${s.branch}\0`)).join("\n");
          const finalInventory = await inventory(repo, [e.integration.feature, e.integration.target, e.main]);
          if (!equal(finalInventory, expected)) refuse("stale");
          await absent(s.cwd); await absent(s.gitDir);
          for (const [r, snap] of [[e.integration.target, e.target], [e.main, e.mainSnapshot]] as const) {
            if (!equal(await pinned(r, (p) => checkout(p, r, false)), snap)) refuse("stale");
          }
          facts.branchDeleteVerified = true;
          const proof: GitCleanupCompletedProof = { version: 1, actionId: e.actionId, kind: "completed", removal,
            deletedRef: `refs/heads/${s.branch}`, deletedOid: e.integration.featureOid, transactionExit: 0, finalInventory, nativeHeadReflogMayHaveChanged: true };
          ownRemoval(removal);
          issueNativeProof(proof, invocation); completedProof = proof;
          facts.phase = "completed-record";
          facts.completedRecorded = await diagnostic(adapters.onCompleted && (() => adapters.onCompleted!(proof)));
          facts.sourceAbsent = true; facts.adminAbsent = true; facts.featureRefAbsent = true;
          const result = Object.freeze({ status: "completed" as const, proof, diagnostics });
          nativeProofs.set(result, { ...nativeProofs.get(proof)!, serialized: JSON.stringify(result) });
          return result;
        });
      } catch (error) {
        facts.originalFailureCode = error instanceof GitCleanupOperationError ? error.code : "refused";
        if (error instanceof ChildFailure && !error.terminated) facts.childTerminationConfirmed = false;
        if (!facts.removeAttempted && facts.childTerminationConfirmed) throw error;
        facts.sourceAbsent = await exists(s.cwd).then((v) => !v, () => null);
        facts.adminAbsent = await exists(s.gitDir).then((v) => !v, () => null);
        if (facts.childTerminationConfirmed) {
          try {
            const observed = await git(e.integration.target, ["for-each-ref", "--format=%(refname)%00%(objectname)", `refs/heads/${s.branch}`]);
            const row = observed.split("\n").find((row) => row.startsWith(`refs/heads/${s.branch}\0`));
            facts.featureRefAbsent = row === undefined;
            const oid = row?.split("\0")[1];
            facts.observedFeatureOid = oid && OID.test(oid) ? oid : null;
          } catch (cause) {
            if (cause instanceof ChildFailure && !cause.terminated) facts.childTerminationConfirmed = false;
          }
        }
        facts.failureRecorded = await diagnostic(adapters.onFailure && (() => adapters.onFailure!(freezeData(structuredClone(facts)))));
        throw new GitCleanupOperationError("recovery-required", freezeData(facts), undefined, completedProof);
      } finally { invocation.retire(); }
    },
  };
}
