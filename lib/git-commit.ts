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

export type GitCommitMode = "whole-file" | "staged";
interface State { branch: string; head: string; indexHash: string; indexPath: string; paths: string[]; mode: GitCommitMode; }
export interface GitCommitPreview {
  repositoryRoot: string;
  branch: string;
  head: string;
  paths: string[];
  tree: string;
  /** Explicit candidate source; authenticated together with the selected paths. */
  mode: GitCommitMode;
  /** Server-authenticated HMAC-SHA256 over checkout, mode, branch, HEAD, paths, index bytes and tree. */
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

async function state(cwd: string, requested: string[], mode: GitCommitMode, ownedLock?: string): Promise<State> {
  if (!path.isAbsolute(cwd) || !samePath(cwd, await fs.realpath(cwd))) fail("explicit physical checkout root required");
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]).then((value) => toNativePath(value.trim()), () => fail("explicit repository-root checkout required"));
  if (!samePath(root, cwd)) fail("cwd must be the repository root");
  await assertNoGitOperation(cwd);
  await policy(cwd);
  let branch: string;
  try { branch = (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim(); }
  catch { return fail("detached HEAD or unborn branch"); }
  if (!branch.startsWith("refs/heads/")) fail("not a local branch");
  const headOid = (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if ((await git(cwd, ["rev-parse", "--verify", branch])).trim() !== headOid) fail("branch moved");
  const indexPath = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
  if (!ownedLock && await fs.stat(`${indexPath}.lock`).then(() => true, () => false)) fail("index locked");
  if (ownedLock && indexPath !== ownedLock) fail("index path changed");
  if (mode === "staged" && !(await fs.lstat(indexPath)).isFile()) fail("unsafe index path");
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
  if (mode === "staged") {
    // -v alone does not reveal intent-to-add (its empty blob appears as an ordinary H entry).
    // --debug exposes the extended index flags even on unrelated entries.
    const debug = await git(cwd, ["ls-files", "--debug", "-z"]);
    const flags = [...debug.matchAll(/\tflags: ([0-9a-f]+)\n/g)].map((match) => match[1]);
    if (flags.length !== entriesInIndex.length || flags.some((flag) => flag !== "0")) fail("nonstandard index flags or intent-to-add");
    const head = new Map(entriesInHead.map((entry) => [entry.slice(entry.indexOf("\t") + 1), entry]));
    const index = new Map(entriesInIndex.map((entry) => [entry.slice(entry.indexOf("\t") + 1), entry]));
    if (!requested.length || requested.length !== new Set(requested).size) fail("select distinct changed staged paths");
    for (const p of requested) {
      if (!validPath(p)) fail("invalid path");
      if (index.get(p) === head.get(p)) fail(`path not changed in index: ${p}`);
      for (const entry of [index.get(p), head.get(p)]) {
        if (entry?.startsWith("160000 ")) fail("submodule changes unsupported");
        if (entry && !/^(100644|100755|120000) /.test(entry)) fail("unsupported index mode");
      }
    }
    const paths = [...requested].sort();
    await safePaths(cwd, paths);
    await checkFilters(cwd, paths);
    await checkFilters(cwd, paths, undefined, true);
    return { branch, head: headOid, indexHash, indexPath, paths, mode };
  }
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
  await checkFilters(cwd, paths);
  return { branch, head: headOid, indexHash, indexPath, paths, mode };
}

async function checkFilters(cwd: string, paths: string[], index?: string, cached = false): Promise<void> {
  const attrs = await git(cwd, ["check-attr", ...(cached ? ["--cached"] : []), "-z", "filter", "--", ...paths], index);
  const parts = attrs.split("\0");
  for (let i = 2; i < parts.length; i += 3) if (parts[i] && parts[i] !== "unspecified" && parts[i] !== "unset") fail("filter attribute policy");
}

async function candidate(cwd: string, s: State): Promise<{ tree: string; index: Buffer }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-web-git-"));
  const index = path.join(dir, "index");
  try {
    await git(cwd, ["read-tree", s.head], index);
    if (s.mode === "staged") {
      const staged = new Map((await git(cwd, ["ls-files", "-s", "-z"])).split("\0").filter(Boolean).map((entry) => {
        const match = /^(\d{6}) ([a-f0-9]{40,64}) 0\t([\s\S]*)$/.exec(entry);
        if (!match) fail("invalid index entry");
        return [match[3], { mode: match[1], oid: match[2] }] as const;
      }));
      for (const p of s.paths) {
        const entry = staged.get(p);
        if (entry) await git(cwd, ["update-index", "--add", "--cacheinfo", entry.mode, entry.oid, p], index);
        else await git(cwd, ["--literal-pathspecs", "update-index", "--force-remove", "--", p], index);
      }
      // The temporary candidate uses HEAD plus the selected index records, never the
      // worktree. After CAS the original index remains valid: selected records now
      // match HEAD, while unrelated staged records and partial unstaged hunks remain.
      await checkFilters(cwd, s.paths, index, true);
    } else {
      await git(cwd, ["--literal-pathspecs", "add", "-A", "--", ...s.paths], index);
    }
    await git(cwd, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--check", s.head, "--"], index);
    const touched = (await git(cwd, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", s.head, "--"], index)).split("\0").filter(Boolean).sort();
    if (JSON.stringify(touched) !== JSON.stringify(s.paths)) fail("staged paths differ from selection");
    const stages = await git(cwd, ["ls-files", "-s", "-z", "--", ...s.paths.map((p) => `:(literal)${p}`)], index);
    if (stages.split("\0").some((r) => r.startsWith("160000 "))) fail("submodule changes unsupported");
    const tree = (await git(cwd, ["write-tree"], index)).trim();
    if (s.mode === "staged") {
      const original = await fs.readFile(s.indexPath);
      if (hash(original) !== s.indexHash) fail("index changed");
      return { tree, index: original };
    }
    return { tree, index: await fs.readFile(index) };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function token(cwd: string, s: State, tree: string): string {
  return createHmac("sha256", reviewSecret())
    .update(JSON.stringify([path.resolve(cwd), s.mode, s.branch, s.head, s.paths, s.indexHash, tree]))
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
async function prepare(cwd: string, selected: string[], mode: GitCommitMode, ownedLock?: string): Promise<{ preview: GitCommitPreview; state: State; index: Buffer }> {
  const s = await state(cwd, selected, mode, ownedLock);
  const result = await candidate(cwd, s);
  return { state: s, index: result.index, preview: {
    repositoryRoot: cwd, branch: s.branch, head: s.head, paths: s.paths, mode,
    tree: result.tree, reviewToken: token(cwd, s, result.tree),
  } };
}

/** No checkout/index/ref mutation. The returned token identifies the full candidate snapshot. */
export async function prepareGitCommit(cwd: string, selectedPaths: string[], mode: GitCommitMode = "whole-file"): Promise<GitCommitPreview> {
  if (mode !== "whole-file" && mode !== "staged") fail("invalid candidate mode");
  return (await prepare(cwd, selectedPaths, mode)).preview;
}

/** Never commits a preview that has become stale. No hooks, signing, or remote operations. */
export async function confirmGitCommit(preview: GitCommitPreview, message: string,
  beforeRefUpdate?: (intended: { commit: string; tree: string; parents: string[]; authorEmail: string }) => Promise<void>,
): Promise<GitCommitResult> {
  if (!message.trim() || message.includes("\0")) fail("invalid commit message");
  if (preview.mode !== "whole-file" && preview.mode !== "staged") fail("invalid candidate mode");
  const cwd = preview.repositoryRoot;
  const first = await prepare(cwd, preview.paths, preview.mode);
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
    const latest = await prepare(cwd, preview.paths, preview.mode, first.state.indexPath);
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
    if (preview.mode === "staged") {
      // Journal callbacks and external processes can alter selection, policy or
      // index bytes while we hold the lock. Ref CAS alone cannot detect that.
      const final = await prepare(cwd, preview.paths, preview.mode, first.state.indexPath);
      if (final.preview.reviewToken !== preview.reviewToken || final.preview.tree !== preview.tree ||
          hash(await fs.readFile(first.state.indexPath)) !== first.state.indexHash) fail("stale preview");
      const currentLock = await fs.lstat(lockPath);
      if (currentLock.dev !== lockIdentity.dev || currentLock.ino !== lockIdentity.ino) fail("index lock ownership lost");
    }
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
