import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, readlink, realpath, type FileHandle } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { selectCanonicalGitResources, revalidateGitProjectResources, withGitProjectReview,
  GitProjectResourceError, parseBoundedGitWorktreePaths, type GitProjectResources, type GitResourceSelector } from "./git-project-resources";
import type { GitReviewRepository } from "./git-review";
import { loadGitProjectSettings } from "./git-project-settings";
import { validLocalBranchName } from "./git-workflow-policy";
import { samePath } from "./paths";

type BoundRepository = Exclude<GitReviewRepository, string>;

const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_COMMITS = 200;
const MAX_REFS = 1000;
const MAX_INDEX = 8 * 1024 * 1024;
const MAX_REFLOG_BYTES = 256 * 1024;
const MAX_TOTAL_REFLOG_BYTES = 8 * 1024 * 1024;
const MAX_REFLOG_OIDS = 2000;
const markers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START", "AUTO_MERGE", "MERGE_AUTOSTASH", "REBASE_HEAD", "ORIG_HEAD.lock", "index.lock"] as const;

export type GitPreparationBlocker = "invalid-selection" | "missing-main" | "main-source" | "selection-changed" |
  "ref-moved" | "dirty" | "operation" | "unsupported-index" | "history" | "shallow" | "oversized" | "shared" | "unavailable";
export class GitPreparationError extends Error {
  constructor(readonly code: GitPreparationBlocker, message: string) { super(message); this.name = "GitPreparationError"; }
}
function refuse(code: GitPreparationBlocker, message: string): never { throw new GitPreparationError(code, message); }
function oid(value: string): string {
  if (!OID.test(value)) refuse("history", "Invalid local object ID");
  return value;
}
function digest(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }

/** Resource paths and expected IDs describe a read, not authority to rewrite. No policies, approvals or execution handles are returned. */
export interface GitPreparationRequest {
  source: GitResourceSelector;
  target: GitResourceSelector;
  /** Optional consistency assertion only. Never used to designate main. */
  mainBranch?: string | null;
  expectedSourceOid?: string;
  expectedTargetOid?: string;
}
export interface GitPreparationCheckout {
  projectRoot: string;
  cwd: string;
  branch: string;
  ref: string;
  oid: string;
  indexDigest: string;
  /** Independently matched physical bytes/modes to the exact Git tree and pinned index. */
  trackedContents: GitPreparationTrackedContents;
  clean: true;
  indexFlags: "ordinary";
  operationMarkers: [];
}
export interface GitPreparationCommit { oid: string; parentOid: string; treeOid: string }
export interface GitPreparationRef { ref: string; oid: string; commitOid: string; checkout?: string }
/** Additional checkouts need readable physical registration/HEAD metadata, not clean indexes or worktrees. */
export interface GitPreparationRegistration {
  cwd: string; gitDir: string; headOid: string; headRef: string | null;
  identities: { checkout: GitProjectResources["identities"]["checkout"]; git: GitProjectResources["identities"]["git"]; marker: GitProjectResources["identities"]["marker"] };
  metadataDigest: string;
}
export interface GitPreparationSnapshot {
  status: "already-prepared" | "needs-rebase";
  source: GitPreparationCheckout;
  target: GitPreparationCheckout;
  designatedMain: { ref: string; oid: string };
  mergeBaseOid: string;
  /** Oldest first. Empty for an already-prepared no-op (even if the feature has commits). */
  rewriteSeries: GitPreparationCommit[];
  /** Locally observed only; absence does NOT establish that the branch was never published elsewhere. */
  localSharedRefs: GitPreparationRef[];
  /** Bounded local inventory, including tags and remote-tracking refs; not a remote query. */
  localRefs: GitPreparationRef[];
  registeredWorktrees: GitPreparationRegistration[];
  localReflogDigest: string;
  publication: "unknown-outside-local-repository";
}
async function git(repo: BoundRepository, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`,
    `--work-tree=${repo.cwd}`, "-c", "core.fsmonitor=false", "-c", "log.showSignature=false", ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_PAGER: "cat" },
  });
  return stdout;
}
/** Read-only capability bounds. These cover tracked tree/index union paths only,
 * not ignored caches, a workspace copy, a sandbox, or arbitrary user-file isolation. */
export const GIT_PREPARATION_TRACKED_CONTENT_LIMITS = Object.freeze({
  entries: 10_000, bytes: 64 * 1024 * 1024, fileBytes: 8 * 1024 * 1024,
  listingBytes: 2 * 1024 * 1024, symlinkBytes: 4096, depth: 64,
});
export interface GitPreparationTrackedContents {
  treeOid: string;
  indexDigest: string;
  fileCount: number;
  byteCount: number;
  /** Digest of independently verified path/mode/blob records, not a cached-stat cleanliness assertion. */
  digest: string;
}
type TrackedEntry = { path: string; mode: string; blob: string; size: number };
function physicalIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.mode === b.mode;
}
function stableFile(a: BigIntStats, b: BigIntStats): boolean {
  return physicalIdentity(a, b) && a.size === b.size && a.nlink === b.nlink &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function trackedPath(path: string): string[] {
  const parts = path.split("/");
  if (!path || Buffer.byteLength(path) > 4096 || /[\x00-\x1f\x7f]/.test(path) ||
      parts.length > GIT_PREPARATION_TRACKED_CONTENT_LIMITS.depth ||
      parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || part === ".gitattributes")) {
    refuse("unavailable", "Unsupported tracked path");
  }
  return parts;
}
async function trackedRead(repo: BoundRepository, args: string[], indexFile?: string): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`,
    `--work-tree=${repo.cwd}`, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
    "-c", "core.attributesFile=/dev/null", ...args], {
    encoding: "buffer", timeout: 15_000, maxBuffer: GIT_PREPARATION_TRACKED_CONTENT_LIMITS.listingBytes,
    env: { ...gitExecEnv(indexFile), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" },
  });
  return new TextDecoder("utf-8", { fatal: true }).decode(stdout);
}
async function trackedTree(repo: BoundRepository, treeOid: string): Promise<TrackedEntry[]> {
  oid(treeOid);
  if ((await trackedRead(repo, ["cat-file", "-t", treeOid])).trim() !== "tree") refuse("history", "Expected an exact tree object");
  const output = await trackedRead(repo, ["ls-tree", "-r", "-l", "-z", treeOid]);
  if (output && !output.endsWith("\0")) refuse("history", "Incomplete tracked tree inventory");
  const rows = output ? output.slice(0, -1).split("\0") : [];
  if (rows.length > GIT_PREPARATION_TRACKED_CONTENT_LIMITS.entries) refuse("oversized", "Too many tracked entries");
  const seen = new Set<string>();
  return rows.map((row) => {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64}) +(\d+)\t(.+)$/.exec(row);
    if (!match) refuse("unavailable", "Unsupported tracked object");
    const entry = { path: match[4], mode: match[1], blob: oid(match[2]), size: Number(match[3]) };
    trackedPath(entry.path);
    if (seen.has(entry.path) || entry.blob.length !== treeOid.length) refuse("history", "Ambiguous tracked tree inventory");
    seen.add(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size > (entry.mode === "120000"
      ? GIT_PREPARATION_TRACKED_CONTENT_LIMITS.symlinkBytes : GIT_PREPARATION_TRACKED_CONTENT_LIMITS.fileBytes)) {
      refuse("oversized", "Tracked object exceeds physical-read limit");
    }
    return entry;
  });
}
async function physicalBytes(fd: FileHandle, info: BigIntStats, maximum: number): Promise<Buffer> {
  if (!info.isFile() || info.nlink !== BigInt(1)) refuse("unavailable", "Tracked/index file is nonordinary or hardlinked");
  if (info.size > BigInt(maximum)) refuse("oversized", "Physical file exceeds preparation limit");
  const buffer = Buffer.alloc(Number(info.size) + 1);
  let count = 0;
  while (count < buffer.length) {
    const { bytesRead } = await fd.read(buffer, count, buffer.length - count, count);
    if (!bytesRead) break;
    count += bytesRead;
  }
  if (count !== Number(info.size) || !stableFile(info, await fd.stat({ bigint: true }))) refuse("dirty", "Physical file changed during read");
  return buffer.subarray(0, count);
}
/** Server-only READ: verify raw tracked bytes, owner-execute modes, and symlink
 * TARGET BYTES against exact blob OIDs, with the actual index separately pinned
 * and matched to that tree. Never follows a symlink or executes a filter/hash-object.
 * previousTreeOid bounds the old/new path union and proves removed paths absent.
 * Uses only supplied live directory-descriptor bindings; no unbound-path fallback.
 * Before/after inode checks narrow external-writer races, not race-free confinement.
 * This observation cannot mint completion/ordering/authority or a workspace copy. */
export async function verifyGitPreparationTrackedContents(repo: BoundRepository, treeOid: string,
  options: { indexFile?: string; previousTreeOid?: string } = {}): Promise<GitPreparationTrackedContents> {
  const pinned = new RegExp(`^/proc/${process.pid}/fd/[0-9]+$`);
  if (process.platform !== "linux" || !repo || ![repo.cwd, repo.gitDir, repo.commonDir].every((path) => pinned.test(path))) {
    refuse("unavailable", "Physical tracked verification requires pinned directories");
  }
  const expected = await trackedTree(repo, treeOid);
  const previous = options.previousTreeOid ? await trackedTree(repo, options.previousTreeOid) : [];
  const union = new Map<string, number>();
  for (const entry of [...expected, ...previous]) union.set(entry.path, Math.max(union.get(entry.path) ?? 0, entry.size));
  if (union.size > GIT_PREPARATION_TRACKED_CONTENT_LIMITS.entries ||
      [...union.values()].reduce((sum, size) => sum + size, 0) > GIT_PREPARATION_TRACKED_CONTENT_LIMITS.bytes) {
    refuse("oversized", "Tracked tree union exceeds preparation limit");
  }
  const root = await open(`${repo.cwd}/.`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const indexPath = options.indexFile ?? join(repo.gitDir, "index");
  const index = await open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(async (error) => {
    await root.close(); throw error;
  });
  try {
    const indexInfo = await index.stat({ bigint: true });
    const indexBytes = await physicalBytes(index, indexInfo, MAX_INDEX);
    if (indexBytes.length < 12 || indexBytes.toString("ascii", 0, 4) !== "DIRC" || ![2, 3].includes(indexBytes.readUInt32BE(4))) {
      refuse("unsupported-index", "Unsupported physical index");
    }
    const output = await trackedRead(repo, ["ls-files", "--stage", "-z"], `/proc/${process.pid}/fd/${index.fd}`);
    const rows = output ? output.slice(0, -1).split("\0") : [];
    if (output && !output.endsWith("\0") || rows.length !== expected.length) refuse("dirty", "Index does not match expected tree");
    const actual = rows.map((row) => {
      const match = /^(100644|100755|120000) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t(.+)$/.exec(row);
      if (!match) refuse("unsupported-index", "Nonordinary index entries");
      trackedPath(match[3]);
      return `${match[3]}\0${match[1]}\0${match[2]}`;
    }).sort();
    const records = expected.map((entry) => `${entry.path}\0${entry.mode}\0${entry.blob}`).sort();
    if (JSON.stringify(actual) !== JSON.stringify(records)) refuse("dirty", "Index differs from exact expected tree");
    const rootPath = `/proc/${process.pid}/fd/${root.fd}`;
    const rootInfo = await root.stat({ bigint: true });
    const checkAttributes = async (dir: string) => {
      try { await lstat(join(dir, ".gitattributes")); refuse("unavailable", "Physical tracked attributes are unsupported"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    };
    await checkAttributes(rootPath);
    const inspect = async (path: string, absent: boolean): Promise<void> => {
      const parts = trackedPath(path);
      const parents: { name: string; fd: FileHandle; info: BigIntStats }[] = [];
      let dir = rootPath;
      try {
        for (const part of parts.slice(0, -1)) {
          const name = join(dir, part);
          let info: BigIntStats;
          try { info = await lstat(name, { bigint: true }); }
          catch (error) { if (absent && (error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
          if (!info.isDirectory() || info.isSymbolicLink()) refuse("unavailable", "Nonphysical tracked parent");
          const fd = await open(name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          parents.push({ name, fd, info });
          if (!physicalIdentity(info, await fd.stat({ bigint: true }))) refuse("dirty", "Tracked parent replaced");
          dir = `/proc/${process.pid}/fd/${fd.fd}`;
          await checkAttributes(dir);
        }
        const name = join(dir, parts.at(-1)!);
        if (absent) {
          try { await lstat(name); refuse("dirty", "Removed tracked path still physically exists"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          return;
        }
        const entry = expectedByPath.get(path)!;
        const named = await lstat(name, { bigint: true });
        let data: Buffer;
        if (entry.mode === "120000") {
          if (!named.isSymbolicLink() || named.nlink !== BigInt(1)) refuse("dirty", "Tracked symlink representation differs");
          if (named.size > BigInt(GIT_PREPARATION_TRACKED_CONTENT_LIMITS.symlinkBytes)) refuse("oversized", "Oversized tracked symlink");
          data = await readlink(name, { encoding: "buffer" }); // reads link bytes, NEVER its referent
          if (data.length !== Number(named.size)) refuse("dirty", "Tracked symlink changed during read");
        } else {
          const fd = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const info = await fd.stat({ bigint: true });
            if (!stableFile(named, info) || Boolean(Number(info.mode) & 0o100) !== (entry.mode === "100755")) {
              refuse("dirty", "Tracked file representation/mode differs");
            }
            data = await physicalBytes(fd, info, GIT_PREPARATION_TRACKED_CONTENT_LIMITS.fileBytes);
          } finally { await fd.close(); }
        }
        if (!stableFile(named, await lstat(name, { bigint: true }))) refuse("dirty", "Tracked entry replaced during read");
        const blob = createHash(treeOid.length === 64 ? "sha256" : "sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
        if (data.length !== entry.size || blob !== entry.blob) refuse("dirty", "Physical tracked bytes differ from exact Git blob");
      } finally {
        try {
          for (const parent of parents) {
            if (!physicalIdentity(parent.info, await lstat(parent.name, { bigint: true }))) refuse("dirty", "Tracked parent replaced during read");
          }
        } finally { await Promise.allSettled(parents.map((parent) => parent.fd.close())); }
      }
    };
    const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
    const expectedDirectories = new Set<string>();
    for (const entry of expected) {
      const parts = entry.path.split("/");
      for (let i = 1; i < parts.length; i++) expectedDirectories.add(parts.slice(0, i).join("/"));
    }
    for (const entry of expected) await inspect(entry.path, false);
    for (const entry of previous) {
      const parts = entry.path.split("/");
      if (expectedByPath.has(entry.path) || expectedDirectories.has(entry.path) ||
          parts.slice(0, -1).some((_, i) => expectedByPath.has(parts.slice(0, i + 1).join("/")))) continue;
      await inspect(entry.path, true);
    }
    if (!physicalIdentity(rootInfo, await lstat(`${repo.cwd}/.`, { bigint: true })) ||
        !stableFile(indexInfo, await index.stat({ bigint: true })) ||
        !stableFile(indexInfo, await lstat(indexPath, { bigint: true }))) refuse("dirty", "Pinned tracked/index state changed");
    return { treeOid, indexDigest: digest(indexBytes), fileCount: expected.length,
      byteCount: expected.reduce((sum, entry) => sum + entry.size, 0), digest: digest(JSON.stringify(records)) };
  } finally { await index.close(); await root.close(); }
}

async function refOid(repo: BoundRepository, ref: string): Promise<string> {
  const value = (await git(repo, "show-ref", "--verify", "--hash", ref)).trim();
  return oid(value);
}
async function checkRepository(repo: BoundRepository): Promise<void> {
  if ((await git(repo, "rev-parse", "--is-shallow-repository")).trim() !== "false") refuse("shallow", "Shallow history cannot be prepared");
  for (const dir of [repo.commonDir, repo.gitDir]) {
    for (const name of ["info/grafts", "shallow"]) {
      try { await lstat(join(dir, name)); refuse("history", "Grafts or shallow metadata are unsupported"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  if ((await git(repo, "for-each-ref", "--format=%(refname)", "refs/replace")).trim()) refuse("history", "Replace refs are unsupported");
}
async function assertPassiveStatus(repo: BoundRepository): Promise<void> {
  // Git status can invoke configured clean filters. Do not execute user programs
  // while claiming this is a read-only preflight.
  const config = await git(repo, "config", "--list", "--null");
  for (const record of config.split("\0")) {
    const name = record.split("\n", 1)[0].toLowerCase();
    if (/^(filter\.|diff\..*\.(?:command|textconv)|core\.(?:attributesfile|external))/.test(name)) {
      refuse("unavailable", "Configured filters or external diff/attributes are unsupported in read-only status");
    }
  }
  const tracked = await git(repo, "ls-tree", "-r", "-z", "HEAD");
  for (const entry of tracked.split("\0")) {
    if (!entry) continue;
    if (entry.startsWith("160000 ")) refuse("unavailable", "Submodules are unsupported in read-only status");
    const name = entry.slice(entry.indexOf("\t") + 1);
    if (name === ".gitattributes" || name.endsWith("/.gitattributes")) {
      refuse("unavailable", "Tracked attributes are unsupported in read-only status");
    }
  }
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    try { await lstat(join(dir, "info", "attributes")); refuse("unavailable", "Git info attributes are unsupported"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
async function checkout(repo: BoundRepository, selection: GitProjectResources, expected?: string): Promise<GitPreparationCheckout> {
  const ref = `refs/heads/${selection.branch}`;
  const current = await refOid(repo, ref);
  if (expected !== undefined && current !== expected) refuse("ref-moved", "Selected branch moved");
  if ((await git(repo, "symbolic-ref", "--quiet", "HEAD")).trim() !== ref ||
      (await git(repo, "rev-parse", "--verify", "HEAD^{commit}")).trim() !== current) refuse("ref-moved", "Selected checkout HEAD moved");
  for (const marker of markers) {
    try { await lstat(join(repo.gitDir, marker)); refuse("operation", "Unfinished Git operation or index lock"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const indexPath = join(repo.gitDir, "index");
  const handle = await open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_INDEX) refuse("unsupported-index", "Missing, nonphysical or oversized index");
    const buffer = Buffer.allocUnsafe(MAX_INDEX + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > MAX_INDEX) refuse("unsupported-index", "Oversized index");
    bytes = buffer.subarray(0, length);
    const current = await lstat(indexPath);
    if (current.dev !== info.dev || current.ino !== info.ino || current.size !== length) refuse("unsupported-index", "Index replaced during inspection");
  } finally { await handle.close(); }
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "DIRC" || ![2, 3].includes(bytes.readUInt32BE(4))) {
    refuse("unsupported-index", "Unsupported index representation");
  }
  // Split indexes may live in either directory. Reject even a stale shared index rather than guessing ownership.
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    if ((await readdir(dir)).some((name) => name.startsWith("sharedindex."))) refuse("unsupported-index", "Split index unsupported");
  }
  for (const key of ["core.sparseCheckout", "index.sparse", "core.splitIndex"]) {
    // Absent settings are false; a non-boolean value is an error, never a fallback.
    if ((await git(repo, "config", "--bool", "--default=false", "--get", key)).trim() !== "false") refuse("unsupported-index", "Sparse or split index unsupported");
  }
  await assertPassiveStatus(repo);
  if (await git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all") !== "" ||
      await git(repo, "ls-files", "-u", "-z") !== "") refuse("dirty", "Checkout has staged, unstaged, untracked or unmerged changes");
  if ((await git(repo, "ls-files", "-v", "-z")).split("\0").some((row) => row && !row.startsWith("H "))) {
    refuse("unsupported-index", "Index has nonstandard flags");
  }
  const treeOid = oid((await git(repo, "rev-parse", `${current}^{tree}`)).trim());
  const trackedContents = await verifyGitPreparationTrackedContents(repo, treeOid);
  if (trackedContents.indexDigest !== digest(bytes)) refuse("ref-moved", "Index changed during physical content verification");
  return { projectRoot: selection.projectRoot, cwd: selection.cwd, branch: selection.branch, ref,
    oid: current, indexDigest: digest(bytes), trackedContents, clean: true, indexFlags: "ordinary", operationMarkers: [] };
}
async function series(repo: BoundRepository, base: string, tip: string): Promise<GitPreparationCommit[]> {
  const count = Number((await git(repo, "rev-list", "--count", `${base}..${tip}`)).trim());
  if (!Number.isSafeInteger(count) || count > MAX_COMMITS) refuse("oversized", "History exceeds preparation limit");
  if (!count) return [];
  const rows = (await git(repo, "log", "--reverse", "--topo-order", "--format=%H%x00%P%x00%T", `${base}..${tip}`)).trim().split("\n");
  if (rows.length !== count) refuse("history", "Incomplete or nonlinear history");
  return rows.map((row, i) => {
    const [id, parents, tree, extra] = row.split("\0");
    if (extra !== undefined || !parents || parents.includes(" ")) refuse("history", "Merge commits are not a linear rewrite series");
    const commit = { oid: oid(id), parentOid: oid(parents), treeOid: oid(tree) };
    if (commit.parentOid !== (i ? rows[i - 1].split("\0")[0] : base)) refuse("history", "Nonlinear history");
    return commit;
  });
}
async function inventory(repo: BoundRepository): Promise<GitPreparationRef[]> {
  const output = await git(repo, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(*objecttype)", "refs");
  const rows = output.trim() ? output.trimEnd().split("\n") : [];
  if (rows.length > MAX_REFS) refuse("oversized", "Too many local refs to inspect");
  return rows.map((row) => {
    const [ref, id, peeled, kind, peeledKind, extra] = row.split("\0");
    if (extra !== undefined || !ref?.startsWith("refs/") || /[\r\n]/.test(ref) ||
        (kind !== "commit" && !(kind === "tag" && peeledKind === "commit"))) refuse("history", "Unsupported local ref object");
    return { ref, oid: oid(id), commitOid: oid(peeled || id) };
  });
}
type AdditionalRepository = { cwd: string; repo: BoundRepository };
async function allRefs(source: BoundRepository, target: BoundRepository, additional: AdditionalRepository[]): Promise<GitPreparationRef[]> {
  const first = await inventory(source);
  const seen = new Set(first.map((item) => JSON.stringify(item)));
  for (const [label, repo] of [["target", target], ...additional.map((item) => [item.cwd, item.repo])] as [string, BoundRepository][]) {
    for (const item of await inventory(repo)) {
      if (!seen.has(JSON.stringify(item))) first.push({ ...item, checkout: label });
    }
  }
  if (first.length > MAX_REFS) refuse("oversized", "Too many combined local refs");
  return first;
}

/** Read only bounded, physical registration metadata. Never run discovery Git at
 * an extra checkout path or infer detached HEAD from its branch's shared ref. */
async function withWorktreeInventory<T>(repo: BoundRepository, source: GitProjectResources, target: GitProjectResources,
  inspect: (registrations: GitPreparationRegistration[], additional: AdditionalRepository[]) => Promise<T>): Promise<T> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`,
    `--work-tree=${repo.cwd}`, "worktree", "list", "--porcelain", "-z"], {
    encoding: "buffer", timeout: 15_000, maxBuffer: 128 * 1024,
    env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0" },
  });
  const paths = parseBoundedGitWorktreePaths(stdout);
  if (!samePath(paths[0], source.projectRoot) || !paths.some((path) => samePath(path, source.cwd)) ||
      !paths.some((path) => samePath(path, target.cwd))) refuse("unavailable", "Incomplete registered worktree inventory");
  const rows = new TextDecoder("utf-8", { fatal: true }).decode(stdout).slice(0, -2).split("\0\0");
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  const physical = async (path: string) => {
    if (!samePath(path, await realpath(path))) refuse("unavailable", "Nonphysical registration directory");
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(handle);
    const info = await handle.stat({ bigint: true });
    return { pinned: `/proc/${process.pid}/fd/${handle.fd}`,
      identity: { device: String(info.dev), inode: String(info.ino), birthtime: String(info.birthtimeNs) } };
  };
  try {
    const registrations: GitPreparationRegistration[] = [], additional: AdditionalRepository[] = [];
    for (let i = 0; i < paths.length; i++) {
      const cwd = paths[i], fields = rows[i].split("\0");
      const headOid = oid(fields[1].slice(5));
      const headRef = fields[2] === "detached" ? null : fields[2].slice(7);
      if (fields[2] === "bare" || fields.some((field) => field.startsWith("prunable")) ||
          headRef !== null && !validLocalBranchName(headRef.slice(11))) refuse("unavailable", "Unknown registered HEAD");
      const checkoutDir = await physical(cwd);
      const markerPath = join(checkoutDir.pinned, ".git");
      const marker = await lstat(markerPath, { bigint: true });
      let gitDir: string, markerText = "", adminText = "";
      if (samePath(cwd, source.projectRoot)) {
        if (marker.isSymbolicLink() || !marker.isDirectory() && !marker.isFile()) refuse("unavailable", "Nonphysical primary registration");
        gitDir = source.commonDir;
        if (marker.isFile()) {
          markerText = await boundedLog(markerPath, 4096);
          const match = /^gitdir: ([^\r\n]+)\n?$/.exec(markerText);
          if (!match || !samePath(resolve(cwd, match[1]), gitDir)) refuse("unavailable", "Foreign primary registration");
        }
      } else {
        if (!marker.isFile() || marker.isSymbolicLink()) refuse("unavailable", "Nonphysical linked registration");
        markerText = await boundedLog(markerPath, 4096);
        const match = /^gitdir: ([^\r\n]+)\n?$/.exec(markerText);
        if (!match) refuse("unavailable", "Unreadable linked registration");
        gitDir = resolve(cwd, match[1]);
        if (!samePath(dirname(gitDir), join(source.commonDir, "worktrees"))) refuse("unavailable", "Foreign linked registration");
      }
      const admin = await physical(gitDir);
      if (!samePath(cwd, source.projectRoot)) {
        const backlink = await boundedLog(join(admin.pinned, "gitdir"), 4096);
        const common = await boundedLog(join(admin.pinned, "commondir"), 4096);
        if (!isAbsolute(backlink.trim()) || !samePath(backlink.trim(), join(cwd, ".git")) ||
            !samePath(resolve(gitDir, common.trim()), source.commonDir)) refuse("unavailable", "Ambiguous linked registration");
        adminText = `${backlink}\0${common}`;
      }
      const head = await boundedLog(join(admin.pinned, "HEAD"), 4096);
      if (head !== (headRef === null ? `${headOid}\n` : `ref: ${headRef}\n`)) refuse("ref-moved", "Registered HEAD changed");
      const bound = { cwd: checkoutDir.pinned, gitDir: admin.pinned, commonDir: repo.commonDir };
      if ((await git(bound, "rev-parse", "--verify", "HEAD^{commit}")).trim() !== headOid) refuse("ref-moved", "Registered HEAD moved");
      registrations.push({ cwd, gitDir, headOid, headRef,
        identities: { checkout: checkoutDir.identity, git: admin.identity,
          marker: { device: String(marker.dev), inode: String(marker.ino), birthtime: String(marker.birthtimeNs),
            ...(marker.isFile() ? { changed: String(marker.ctimeNs), size: String(marker.size) } : {}) } },
        metadataDigest: digest(`${rows[i]}\0${markerText}\0${adminText}\0${head}`) });
      if (!samePath(cwd, source.cwd) && !samePath(cwd, target.cwd)) additional.push({ cwd, repo: bound });
    }
    const linked = join(source.commonDir, "worktrees");
    try {
      if (!samePath(linked, await realpath(linked))) refuse("unavailable", "Nonphysical worktree registry");
      const entries = await readdir(linked, { withFileTypes: true });
      if (entries.length > 255 || entries.some((entry) => !entry.isDirectory() ||
          !registrations.some((item) => samePath(item.gitDir, join(linked, entry.name))))) {
        refuse("unavailable", "Incomplete physical worktree registry");
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return await inspect(registrations, additional);
  } finally { await Promise.allSettled(handles.map((handle) => handle.close())); }
}

async function boundedLog(path: string, maximum = MAX_REFLOG_BYTES): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) refuse("oversized", "Unsupported or oversized Git reflog");
    const buffer = Buffer.allocUnsafe(maximum + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await handle.stat(), current = await lstat(path);
    if (count !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs ||
        current.dev !== info.dev || current.ino !== info.ino || current.isSymbolicLink()) refuse("unavailable", "Git metadata changed during bounded read");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
  } finally { await handle.close(); }
}
/** Inspect all physical ref logs in both pinned Git dirs and the common dir, including deleted remote refs. */
async function reflogs(source: BoundRepository, target: BoundRepository, sourceRef: string, additional: AdditionalRepository[]): Promise<{ snapshot: string; oids: string[] }> {
  const records: string[] = [];
  const commits = new Set<string>();
  const roots = new Map<string, { root: string; label: string }>();
  for (const [root, label] of [[source.commonDir, "common"], [source.gitDir, "source"], [target.gitDir, "target"],
    ...additional.map((item) => [item.repo.gitDir, item.cwd])] as [string, string][]) {
    roots.set(await realpath(root), { root, label });
  }
  let visited = 0;
  let totalBytes = 0;
  const addLog = async (file: string, name: string) => {
    const contents = await boundedLog(file);
    totalBytes += Buffer.byteLength(contents);
    if (totalBytes > MAX_TOTAL_REFLOG_BYTES) refuse("oversized", "Local reflog inventory exceeds preparation limit");
    records.push(`${name}\0${digest(contents)}`);
    // The source's own branch/HEAD reflogs are not evidence of a second holder.
    const ownLog = name === sourceRef || name === "source/HEAD";
    for (const line of contents.split("\n")) {
      if (!line) continue;
      // update-ref may record a reflog line without a tab/message.
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) [^\n]+$/.exec(line);
      if (!match) refuse("history", "Unrecognized Git reflog entry");
      if (ownLog) continue;
      for (const id of [match[1], match[2]]) {
        if (!/^0+$/.test(id)) commits.add(id);
        if (commits.size > MAX_REFLOG_OIDS) refuse("oversized", "Too many locally recorded ref tips");
      }
    }
  };
  for (const { root, label } of roots.values()) {
    const logs = join(root, "logs");
    let stat;
    try { stat = await lstat(logs); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse("history", "Nonphysical reflog directory");
    const head = join(logs, "HEAD");
    try { await lstat(head); await addLog(head, `${label}/HEAD`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const refs = join(logs, "refs");
    try { stat = await lstat(refs); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse("history", "Nonphysical reflog directory");
    const scan = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > 8) refuse("oversized", "Reflog directory nesting exceeds limit");
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (++visited > MAX_REFS || entry.isSymbolicLink()) refuse("oversized", "Too many or nonphysical reflogs");
        const name = `${prefix}/${entry.name}`;
        const file = join(dir, entry.name);
        if (entry.isDirectory()) await scan(file, name, depth + 1);
        else if (entry.isFile()) await addLog(file, name);
        else refuse("history", "Unsupported reflog entry");
      }
    };
    await scan(refs, "refs", 0);
  }
  return { snapshot: records.sort().join("\n"), oids: [...commits] };
}
async function ancestor(repo: BoundRepository, earlier: string, later: string): Promise<boolean> {
  try { await git(repo, "merge-base", "--is-ancestor", earlier, later); return true; }
  catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === 1) return false; throw error; }
}
function sameCheckout(a: GitPreparationCheckout, b: GitPreparationCheckout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Internal apply fence that remains usable while the source index.lock is owned.
 * No cleanliness inference or permission is made here. */
export async function revalidateGitPreparationInventory(source: GitProjectResources, target: GitProjectResources,
  snapshot: GitPreparationSnapshot): Promise<void> {
  await withGitProjectReview(source, async (from) => withGitProjectReview(target, async (to) => {
    if (typeof from === "string" || typeof to === "string") refuse("unavailable", "Bound inventory required");
    await withWorktreeInventory(from, source, target, async (registrations, additional) => {
      if (JSON.stringify(registrations) !== JSON.stringify(snapshot.registeredWorktrees) ||
          JSON.stringify(await allRefs(from, to, additional)) !== JSON.stringify(snapshot.localRefs) ||
          digest((await reflogs(from, to, snapshot.source.ref, additional)).snapshot) !== snapshot.localReflogDigest) {
        refuse("ref-moved", "Local sharing inventory changed");
      }
    });
  }));
}

/** Safe, read-only Phase 3 discovery. This is not a rebase plan, permission or execution endpoint.
 * agentDir is server-owned (or a disposable test directory), never a request field. */
export async function preflightGitPreparation(request: GitPreparationRequest, agentDir = getAgentDir()): Promise<GitPreparationSnapshot> {
  if (!request || !request.source || !request.target) refuse("invalid-selection", "Source and target checkouts required");
  if (request.expectedSourceOid !== undefined && !OID.test(request.expectedSourceOid) ||
      request.expectedTargetOid !== undefined && !OID.test(request.expectedTargetOid)) refuse("invalid-selection", "Invalid expected ref ID");
  try {
    const source = await selectCanonicalGitResources(request.source);
    const settings = await loadGitProjectSettings(source, [], agentDir);
    const mainBranch = settings.project.mainBranch;
    if (!mainBranch || !validLocalBranchName(mainBranch)) refuse("missing-main", "Saved project main branch designation required");
    if (request.mainBranch !== undefined && request.mainBranch !== mainBranch) refuse("invalid-selection", "Requested main differs from saved project main");
    const target = await selectCanonicalGitResources(request.target);
    if (source.branch === mainBranch) refuse("main-source", "The designated project main branch must never be rewritten");
    if (target.branch !== mainBranch) refuse("invalid-selection", "Target checkout must be the saved designated project main branch");
    if (!samePath(source.projectRoot, target.projectRoot) || !samePath(source.commonDir, target.commonDir) ||
        samePath(source.cwd, target.cwd) || source.branch === target.branch) refuse("invalid-selection", "Distinct registered checkouts in one repository required");
    return await withGitProjectReview(source, async (sourceRepo) => withGitProjectReview(target, async (targetRepo) => {
      // This read surface does not accept the unbound path variant used by legacy reviews.
      if (typeof sourceRepo === "string" || typeof targetRepo === "string") refuse("unavailable", "Bound Git directories required");
      await checkRepository(sourceRepo);
      await checkRepository(targetRepo);
      return await withWorktreeInventory(sourceRepo, source, target, async (worktrees, additional) => {
        const from = await checkout(sourceRepo, source, request.expectedSourceOid);
        const to = await checkout(targetRepo, target, request.expectedTargetOid);
        const mainRef = `refs/heads/${mainBranch}`;
        let mainOid: string;
        try {
          mainOid = await refOid(sourceRepo, mainRef);
          if ((await git(sourceRepo, "cat-file", "-t", mainOid)).trim() !== "commit") throw new Error("Non-commit main");
        } catch { refuse("missing-main", "Designated project main must be an existing local commit branch"); }
        let bases: string[];
        try { bases = (await git(sourceRepo, "merge-base", "--all", from.oid, to.oid)).trim().split("\n"); }
        catch { refuse("history", "Source and target have no common history"); }
        if (bases.length !== 1) refuse("history", "A single merge base is required");
        const base = oid(bases[0]);
        const sourceSeries = await series(sourceRepo, base, from.oid);
        if (!sourceSeries.length && base !== to.oid) refuse("history", "Source is behind target; there is no rewrite series");
        await series(sourceRepo, base, to.oid); // target-side topology is also bounded and linear
        const refs = await allRefs(sourceRepo, targetRepo, additional);
        const logs = await reflogs(sourceRepo, targetRepo, from.ref, additional);
        const alreadyPrepared = base === to.oid;
        const shared: GitPreparationRef[] = [];
        if (!alreadyPrepared && sourceSeries.length) {
          for (const ref of refs) {
            if (ref.ref === from.ref && ref.checkout === undefined) continue;
            if (await ancestor(sourceRepo, sourceSeries[0].oid, ref.commitOid)) shared.push(ref);
          }
          for (const registration of worktrees) {
            if (samePath(registration.cwd, source.cwd)) continue;
            if (await ancestor(sourceRepo, sourceSeries[0].oid, registration.headOid)) refuse("shared", "Registered checkout HEAD holds rewrite commits");
          }
          for (const loggedOid of logs.oids) {
            if (await ancestor(sourceRepo, sourceSeries[0].oid, loggedOid)) refuse("shared", "Historical local ref/reflog tip includes rewrite commits");
          }
        }
        if (shared.length) refuse("shared", `Locally known shared/published rewrite commits: ${shared.slice(0, 5).map((r) => r.ref).join(", ")}`);
        // Check all observed state again: inventory, main, indexes and physical registrations.
        if (!sameCheckout(from, await checkout(sourceRepo, source, from.oid)) ||
            !sameCheckout(to, await checkout(targetRepo, target, to.oid)) ||
            mainOid !== await refOid(sourceRepo, mainRef) ||
            !await withWorktreeInventory(sourceRepo, source, target, async (current, extras) =>
              JSON.stringify(worktrees) === JSON.stringify(current) &&
              JSON.stringify(refs) === JSON.stringify(await allRefs(sourceRepo, targetRepo, extras)) &&
              logs.snapshot === (await reflogs(sourceRepo, targetRepo, from.ref, extras)).snapshot)) refuse("ref-moved", "Repository changed during preflight");
        await checkRepository(sourceRepo);
        await checkRepository(targetRepo);
        if (settings.revision !== (await loadGitProjectSettings(source, [], agentDir)).revision) refuse("selection-changed", "Project main designation/settings changed during preflight");
        await revalidateGitProjectResources(source);
        await revalidateGitProjectResources(target);
        return { status: alreadyPrepared ? "already-prepared" : "needs-rebase", source: from, target: to,
          designatedMain: { ref: mainRef, oid: mainOid }, mergeBaseOid: base,
          rewriteSeries: alreadyPrepared ? [] : sourceSeries, localSharedRefs: shared, localRefs: refs,
          registeredWorktrees: worktrees, localReflogDigest: digest(logs.snapshot),
          publication: "unknown-outside-local-repository" };
      });
    }));
  } catch (error) {
    if (error instanceof GitPreparationError) throw error;
    if (error instanceof GitProjectResourceError && error.code === "selection-changed") {
      refuse("selection-changed", "Selected physical checkout changed during preflight");
    }
    refuse("unavailable", "Preparation preflight could not establish a stable local repository snapshot");
  }
}
