import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { selectCanonicalGitResources, revalidateGitProjectResources, withGitProjectReview,
  GitProjectResourceError, type GitProjectResources, type GitResourceSelector } from "./git-project-resources";
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
  clean: true;
  indexFlags: "ordinary";
  operationMarkers: [];
}
export interface GitPreparationCommit { oid: string; parentOid: string; treeOid: string }
export interface GitPreparationRef { ref: string; oid: string; commitOid: string; checkout?: "source" | "target" }
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
  return { projectRoot: selection.projectRoot, cwd: selection.cwd, branch: selection.branch, ref,
    oid: current, indexDigest: digest(bytes), clean: true, indexFlags: "ordinary", operationMarkers: [] };
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
async function allRefs(source: BoundRepository, target: BoundRepository): Promise<GitPreparationRef[]> {
  const first = await inventory(source);
  const second = await inventory(target);
  const seen = new Set(first.map((item) => JSON.stringify(item)));
  for (const item of second) {
    if (!seen.has(JSON.stringify(item))) first.push({ ...item, checkout: "target" });
  }
  if (first.length > MAX_REFS) refuse("oversized", "Too many combined local refs");
  return first;
}

/** There is no safe inference from a third worktree's branch ref about its detached HEAD. */
async function onlySelectedWorktrees(repo: BoundRepository, source: GitProjectResources, target: GitProjectResources): Promise<string> {
  const listing = await git(repo, "worktree", "list", "--porcelain", "-z");
  const paths = listing.split("\0").filter((field) => field.startsWith("worktree ")).map((field) => field.slice(9));
  if (paths.length !== 2 || !paths.some((path) => samePath(path, source.cwd)) ||
      !paths.some((path) => samePath(path, target.cwd)) || samePath(paths[0], paths[1])) {
    refuse("unavailable", "Additional, missing, or ambiguous worktrees cannot be fully inventoried");
  }
  return listing;
}

async function boundedLog(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_REFLOG_BYTES) refuse("oversized", "Unsupported or oversized Git reflog");
    const buffer = Buffer.allocUnsafe(MAX_REFLOG_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== info.size) refuse("oversized", "Git reflog changed or exceeded bound");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
  } finally { await handle.close(); }
}
/** Inspect all physical ref logs in both pinned Git dirs and the common dir, including deleted remote refs. */
async function reflogs(source: BoundRepository, target: BoundRepository, sourceRef: string): Promise<{ snapshot: string; oids: string[] }> {
  const records: string[] = [];
  const commits = new Set<string>();
  const roots = new Set([source.commonDir, source.gitDir, target.gitDir]);
  let visited = 0;
  let totalBytes = 0;
  const addLog = async (file: string, name: string) => {
    const contents = await boundedLog(file);
    totalBytes += Buffer.byteLength(contents);
    if (totalBytes > MAX_TOTAL_REFLOG_BYTES) refuse("oversized", "Local reflog inventory exceeds preparation limit");
    records.push(`${name}\0${digest(contents)}`);
    // The source's own branch/HEAD reflogs are not evidence of a second holder.
    if (name === sourceRef || name === "source/HEAD") return;
    for (const line of contents.split("\n")) {
      if (!line) continue;
      // update-ref may record a reflog line without a tab/message.
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) [^\n]+$/.exec(line);
      if (!match) refuse("history", "Unrecognized Git reflog entry");
      for (const id of [match[1], match[2]]) {
        if (!/^0+$/.test(id)) commits.add(id);
        if (commits.size > MAX_REFLOG_OIDS) refuse("oversized", "Too many locally recorded ref tips");
      }
    }
  };
  for (const root of roots) {
    const label = samePath(root, source.gitDir) ? "source" : samePath(root, target.gitDir) ? "target" : "common";
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
      const worktrees = await onlySelectedWorktrees(sourceRepo, source, target);
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
      const refs = await allRefs(sourceRepo, targetRepo);
      const logs = await reflogs(sourceRepo, targetRepo, from.ref);
      const alreadyPrepared = base === to.oid;
      const shared: GitPreparationRef[] = [];
      if (!alreadyPrepared && sourceSeries.length) {
        for (const ref of refs) {
          if (ref.ref === from.ref && ref.checkout !== "target") continue;
          if (await ancestor(sourceRepo, sourceSeries[0].oid, ref.commitOid)) shared.push(ref);
        }
        for (const loggedOid of logs.oids) {
          if (await ancestor(sourceRepo, sourceSeries[0].oid, loggedOid)) refuse("shared", "Historical local ref/reflog tip includes rewrite commits");
        }
      }
      if (shared.length) refuse("shared", `Locally known shared/published rewrite commits: ${shared.slice(0, 5).map((r) => r.ref).join(", ")}`);
      // Check all observed state a second time, including the full inventory, main, indexes and physical registrations.
      if (!sameCheckout(from, await checkout(sourceRepo, source, from.oid)) ||
          !sameCheckout(to, await checkout(targetRepo, target, to.oid)) ||
          mainOid !== await refOid(sourceRepo, mainRef) ||
          JSON.stringify(refs) !== JSON.stringify(await allRefs(sourceRepo, targetRepo)) ||
          worktrees !== await onlySelectedWorktrees(sourceRepo, source, target) ||
          logs.snapshot !== (await reflogs(sourceRepo, targetRepo, from.ref)).snapshot) refuse("ref-moved", "Repository changed during preflight");
      await checkRepository(sourceRepo);
      await checkRepository(targetRepo);
      if (settings.revision !== (await loadGitProjectSettings(source, [], agentDir)).revision) refuse("selection-changed", "Project main designation/settings changed during preflight");
      await revalidateGitProjectResources(source);
      await revalidateGitProjectResources(target);
      return { status: alreadyPrepared ? "already-prepared" : "needs-rebase", source: from, target: to,
        designatedMain: { ref: mainRef, oid: mainOid }, mergeBaseOid: base,
        rewriteSeries: alreadyPrepared ? [] : sourceSeries, localSharedRefs: shared, localRefs: refs,
        publication: "unknown-outside-local-repository" };
    }));
  } catch (error) {
    if (error instanceof GitPreparationError) throw error;
    if (error instanceof GitProjectResourceError && error.code === "selection-changed") {
      refuse("selection-changed", "Selected physical checkout changed during preflight");
    }
    refuse("unavailable", "Preparation preflight could not establish a stable local repository snapshot");
  }
}
