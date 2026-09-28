import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { samePath, toNativePath } from "./paths";

const exec = promisify(execFile);
const MAX_OUTPUT = 32 * 1024 * 1024;
async function git(cwd: string, args: string[], index?: string): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, ...args], {
    env: gitExecEnv(index),
    encoding: "utf8", maxBuffer: MAX_OUTPUT, timeout: 30_000,
  });
  return stdout;
}

function fail(reason: string): never { throw new Error(`Git commit unavailable: ${reason}`); }
function hash(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
const reviewSecretKey = Symbol.for("pi-web:git-commit:review-secret");
function reviewSecret(): Buffer {
  // Keep approvals across hot reloads, but fail closed across processes/restarts.
  const shared = globalThis as unknown as Record<symbol, Buffer | undefined>;
  return (shared[reviewSecretKey] ??= randomBytes(32));
}
function validPath(value: string): boolean {
  return value !== "" && value !== "." && !value.includes("\0") && !value.includes("\\") &&
    !path.isAbsolute(value) && !value.split("/").some((p) => p === "" || p === "." || p === "..");
}

interface State { branch: string; head: string; indexHash: string; indexPath: string; paths: string[]; }
export interface GitCommitPreview {
  repositoryRoot: string;
  branch: string;
  head: string;
  paths: string[];
  tree: string;
  /** Server-authenticated HMAC-SHA256 over checkout, branch, HEAD, paths, index bytes and tree. */
  reviewToken: string;
}
export type GitCommitResult =
  | { status: "committed"; commit: string; tree: string; parents: string[]; authorEmail: string }
  | { status: "partial-success"; commit: string; tree: string; parents: string[]; authorEmail: string; reason: string };

async function policy(cwd: string): Promise<void> {
  const config = await git(cwd, ["config", "--list", "--null"]);
  for (const record of config.split("\0")) {
    const key = record.split("\n", 1)[0].toLowerCase();
    if (/^(filter\.|core\.(hookspath|fsmonitor|splitindex|sparsecheckout|attributesfile|worktree)$)/.test(key) ||
        key === "commit.gpgsign" && record.slice(key.length + 1) !== "false") {
      fail(`unsupported Git policy: ${key}`);
    }
  }
  const hooks = path.resolve(cwd, toNativePath((await git(cwd, ["rev-parse", "--git-path", "hooks"])).trim()));
  try {
    for (const name of await fs.readdir(hooks)) {
      if (name.endsWith(".sample")) continue;
      const info = await fs.lstat(path.join(hooks, name));
      if (info.isFile() || info.isSymbolicLink()) fail(`hook policy (${name})`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function safePaths(cwd: string, paths: string[]): Promise<void> {
  for (const relative of paths) {
    if (!validPath(relative)) fail("invalid path");
    let current = cwd;
    const segments = relative.split("/");
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) fail(`symlink ancestor: ${relative}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

async function state(cwd: string, requested: string[], ownedLock?: string): Promise<State> {
  if (!path.isAbsolute(cwd) || !samePath(cwd, await fs.realpath(cwd))) fail("explicit physical checkout root required");
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]).then((value) => toNativePath(value.trim()), () => fail("explicit repository-root checkout required"));
  if (!samePath(root, cwd)) fail("cwd must be the repository root");
  await assertNoGitOperation(cwd);
  await policy(cwd);
  let branch: string;
  try { branch = (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim(); }
  catch { return fail("detached HEAD or unborn branch"); }
  if (!branch.startsWith("refs/heads/")) fail("not a local branch");
  const head = (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if ((await git(cwd, ["rev-parse", "--verify", branch])).trim() !== head) fail("branch moved");
  const indexPath = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
  if (!ownedLock && await fs.stat(`${indexPath}.lock`).then(() => true, () => false)) fail("index locked");
  if (ownedLock && indexPath !== ownedLock) fail("index path changed");
  const indexHash = hash(await fs.readFile(indexPath));
  if ((await git(cwd, ["ls-files", "-u", "-z"])) !== "") fail("unmerged index");
  const entriesInIndex = (await git(cwd, ["ls-files", "-s", "-z"])).split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) 0\t([\s\S]*)$/.exec(entry);
    if (!match) fail("invalid index entry");
    return `${match[1]} ${match[2]}\t${match[3]}`;
  }).sort();
  const entriesInHead = (await git(cwd, ["ls-tree", "-r", "-z", "HEAD"])).split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d{6}) \S+ ([a-f0-9]{40,64})\t([\s\S]*)$/.exec(entry);
    if (!match) fail("invalid HEAD entry");
    return `${match[1]} ${match[2]}\t${match[3]}`;
  }).sort();
  if (JSON.stringify(entriesInIndex) !== JSON.stringify(entriesInHead)) fail("index differs from HEAD");
  const indexFlags = await git(cwd, ["ls-files", "-v", "-z"]);
  if (indexFlags.split("\0").some((entry) => entry !== "" && !entry.startsWith("H "))) fail("nonstandard index flags");
  try { await git(cwd, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD", "--"]); }
  catch { fail("dirty index"); }
  const status = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = status.split("\0");
  const available = new Map<string, string[]>();
  const renameSources = new Map<string, string[]>();
  for (let i = 0; i < entries.length && entries[i]; i++) {
    const row = entries[i];
    if (row.length < 4 || row[2] !== " " || row[0] !== " " && row.slice(0, 2) !== "??") fail("dirty index or conflict");
    const dest = row.slice(3);
    const paths = [dest];
    if (row.slice(0, 2).includes("R") || row.slice(0, 2).includes("C")) {
      const source = entries[++i];
      if (!source) fail("malformed rename status");
      paths.push(source);
      renameSources.set(source, paths);
    }
    available.set(dest, paths);
  }
  if (!requested.length || requested.length !== new Set(requested).size) fail("select distinct complete status paths");
  const selected = requested.flatMap((p) => available.get(p) ?? renameSources.get(p) ?? fail(`path not in current status: ${p}`));
  const paths = [...new Set(selected)].sort();
  await safePaths(cwd, paths);
  const attrs = await git(cwd, ["check-attr", "-z", "filter", "--", ...paths]);
  const parts = attrs.split("\0");
  for (let i = 2; i < parts.length; i += 3) if (parts[i] && parts[i] !== "unspecified" && parts[i] !== "unset") fail("filter attribute policy");
  return { branch, head, indexHash, indexPath, paths };
}

async function candidate(cwd: string, s: State): Promise<{ tree: string; index: Buffer }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-web-git-"));
  const index = path.join(dir, "index");
  try {
    await git(cwd, ["read-tree", s.head], index);
    await git(cwd, ["--literal-pathspecs", "add", "-A", "--", ...s.paths], index);
    await git(cwd, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--check", s.head, "--"], index);
    const touched = (await git(cwd, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", s.head, "--"], index)).split("\0").filter(Boolean).sort();
    if (JSON.stringify(touched) !== JSON.stringify(s.paths)) fail("staged paths differ from selection");
    const stages = await git(cwd, ["ls-files", "-s", "-z", "--", ...s.paths.map((p) => `:(literal)${p}`)], index);
    if (stages.split("\0").some((r) => r.startsWith("160000 "))) fail("submodule changes unsupported");
    const tree = (await git(cwd, ["write-tree"], index)).trim();
    return { tree, index: await fs.readFile(index) };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function token(cwd: string, s: State, tree: string): string {
  return createHmac("sha256", reviewSecret())
    .update(JSON.stringify([path.resolve(cwd), s.branch, s.head, s.paths, s.indexHash, tree]))
    .digest("hex");
}

async function assertCheckout(cwd: string, branch: string, head: string): Promise<void> {
  if ((await git(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== branch ||
      (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim() !== head) fail("checkout moved");
}

async function verifyCommit(cwd: string, commit: string, tree: string, parent: string, message: string,
  author: string, committer: string): Promise<void> {
  const raw = await git(cwd, ["cat-file", "-p", commit]);
  const boundary = raw.indexOf("\n\n");
  if (boundary < 0) fail("invalid commit object");
  const headers = raw.slice(0, boundary).split("\n");
  // No gpgsig or other implicit metadata; one parent, exact candidate tree and identities.
  if (headers.length !== 4 || headers[0] !== `tree ${tree}` || headers[1] !== `parent ${parent}` ||
      !headers[2].startsWith(`author ${author} `) || !headers[3].startsWith(`committer ${committer} `) ||
      !/^\d+ [+-]\d{4}$/.test(headers[2].slice(`author ${author} `.length)) ||
      !/^\d+ [+-]\d{4}$/.test(headers[3].slice(`committer ${committer} `.length)) ||
      raw.slice(boundary + 2) !== `${message.replace(/\n+$/, "")}\n`) fail("commit object differs from approved snapshot");
}
function identity(ident: string): string {
  const end = ident.lastIndexOf("> ");
  if (end < 0) fail("invalid Git identity");
  return ident.slice(0, end + 1);
}
/**
 * Safe fixed-vocabulary refusal, thrown ONLY before ref CAS. It proves this
 * invocation did not update a ref/index, even after the intent callback.
 * Post-CAS failures must remain partial-success, never this error type.
 */
export class GitCommitOperationError extends Error {}
const operationMarkers = [
  ["MERGE_HEAD", "merge"], ["rebase-merge", "rebase"], ["rebase-apply", "rebase or git am"],
  ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"],
  ["sequencer", "sequenced cherry-pick or revert"], ["BISECT_START", "bisect"],
] as const;
async function assertNoGitOperation(cwd: string): Promise<void> {
  // These markers are all worktree-local. Resolve the Git directory, not .git/
  // or the common directory. Resolving an individual --git-path with absolute
  // formatting can follow a marker symlink before lstat gets to reject it.
  const metadata = toNativePath((await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim());
  for (const [marker, operation] of operationMarkers) {
    let present = false;
    try { await fs.lstat(path.join(metadata, marker)); present = true; }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw new GitCommitOperationError("Git operation state could not be inspected; commit blocked.");
    }
    // A malformed marker or dangling symlink is still an unresolved operation.
    if (present) throw new GitCommitOperationError(`Git ${operation} is in progress. Finish or abort it explicitly before requesting a commit.`);
  }
}
async function prepare(cwd: string, selected: string[], ownedLock?: string): Promise<{ preview: GitCommitPreview; state: State; index: Buffer }> {
  const s = await state(cwd, selected, ownedLock);
  const result = await candidate(cwd, s);
  return { state: s, index: result.index, preview: {
    repositoryRoot: cwd, branch: s.branch, head: s.head, paths: s.paths,
    tree: result.tree, reviewToken: token(cwd, s, result.tree),
  } };
}

/** No checkout/index/ref mutation. The returned token identifies the full candidate snapshot. */
export async function prepareGitCommit(cwd: string, selectedPaths: string[]): Promise<GitCommitPreview> {
  return (await prepare(cwd, selectedPaths)).preview;
}

/** Never commits a preview that has become stale. No hooks, signing, or remote operations. */
export async function confirmGitCommit(preview: GitCommitPreview, message: string,
  beforeRefUpdate?: (intended: { commit: string; tree: string; parents: string[]; authorEmail: string }) => Promise<void>,
): Promise<GitCommitResult> {
  if (!message.trim() || message.includes("\0")) fail("invalid commit message");
  const cwd = preview.repositoryRoot;
  const first = await prepare(cwd, preview.paths);
  if (first.preview.reviewToken !== preview.reviewToken || first.preview.tree !== preview.tree ||
      first.preview.branch !== preview.branch || first.preview.head !== preview.head ||
      JSON.stringify(first.preview.paths) !== JSON.stringify(preview.paths)) fail("stale preview");
  const lockPath = `${first.state.indexPath}.lock`;
  const lock = await fs.open(lockPath, "wx", 0o600).catch(() => fail("index locked"));
  let committed: string | null = null;
  let authorEmail = "";
  let installed = false;
  let lockIdentity: Awaited<ReturnType<typeof lock.stat>> | undefined;
  try {
    lockIdentity = await lock.stat();
    // Hold the real Git index lock throughout final validation and the ref CAS.
    const latest = await prepare(cwd, preview.paths, first.state.indexPath);
    if (latest.preview.reviewToken !== preview.reviewToken || latest.preview.tree !== preview.tree) fail("stale preview");
    if (hash(await fs.readFile(first.state.indexPath)) !== first.state.indexHash) fail("index changed");
    await assertCheckout(cwd, preview.branch, preview.head);
    const author = identity((await git(cwd, ["var", "GIT_AUTHOR_IDENT"])).trim());
    authorEmail = author.slice(author.lastIndexOf("<") + 1, -1);
    const committer = identity((await git(cwd, ["var", "GIT_COMMITTER_IDENT"])).trim());
    const commit = (await git(cwd, ["commit-tree", latest.preview.tree, "-p", preview.head, "-m", message])).trim();
    await verifyCommit(cwd, commit, latest.preview.tree, preview.head, message, author, committer);
    // Persist prepared identity BEFORE the ref mutation. A failed journal write
    // leaves only an unreachable object, never a silently unrecorded commit.
    await beforeRefUpdate?.({ commit, tree: latest.preview.tree, parents: [preview.head], authorEmail });
    await assertCheckout(cwd, preview.branch, preview.head);
    const beforeRef = await fs.lstat(lockPath);
    if (beforeRef.dev !== lockIdentity.dev || beforeRef.ino !== lockIdentity.ino) fail("index lock ownership lost");
    // An approval/journal callback can outlive the earlier operation-state check.
    // Ref CAS does not protect sequencer/merge/rebase metadata. Refuse, never continue it.
    await assertNoGitOperation(cwd);
    // update-ref is an atomic compare-and-swap. External writers can still race.
    await git(cwd, ["update-ref", preview.branch, commit, preview.head]);
    committed = commit;
    await assertCheckout(cwd, preview.branch, commit);
    await lock.writeFile(latest.index);
    await lock.sync();
    await assertCheckout(cwd, preview.branch, commit);
    await lock.close();
    const current = await fs.lstat(lockPath);
    if (current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino) fail("index lock ownership lost");
    await fs.rename(lockPath, first.state.indexPath);
    installed = true;
    await assertCheckout(cwd, preview.branch, commit);
    return { status: "committed", commit, tree: preview.tree, parents: [preview.head], authorEmail };
  } catch (error) {
    if (committed) return { status: "partial-success", commit: committed, tree: preview.tree,
      parents: [preview.head], authorEmail, reason: "Commit created, but checkout finalization failed" };
    throw error;
  } finally {
    await lock.close().catch(() => {});
    if (!installed) {
      // Remove only the lock we created, never a replacement belonging to another writer.
      const current = await fs.lstat(lockPath).catch(() => null);
      if (lockIdentity && current && lockIdentity.dev === current.dev && lockIdentity.ino === current.ino) await fs.unlink(lockPath).catch(() => {});
    }
  }
}
