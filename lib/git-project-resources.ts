import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { getAllowedFileRoots, isExistingFilePathAllowed, isWindowsAbsolutePath } from "./file-access";
import { gitExecEnv } from "./git-exec";
import { samePath, toNativePath } from "./paths";
import { validLocalBranchName } from "./git-workflow-policy";
import type { GitReviewRepository } from "./git-review";

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec("git", ["--no-optional-locks", "-C", cwd, ...args],
  { encoding: "utf8", env: gitExecEnv(), timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout.trim();

type DirectoryIdentity = { device: string; inode: string; birthtime: string };
const identity = (info: { dev: bigint; ino: bigint; birthtimeNs: bigint }): DirectoryIdentity => ({ device: String(info.dev), inode: String(info.ino), birthtime: String(info.birthtimeNs) });
/** Captured by the server; never accept this object as caller-supplied authority. */
export interface GitProjectResources {
  projectRoot: string;
  cwd: string;
  branch: string;
  commonDir: string;
  gitDir: string;
  identities: { project: DirectoryIdentity; checkout: DirectoryIdentity; common: DirectoryIdentity; git: DirectoryIdentity;
    marker: DirectoryIdentity & { changed?: string; size?: string } };
}
/** Future operation schema: explicit canonical repository + registered checkout.
 * A selector describes a resource, never authorization to execute there. */
export interface GitResourceSelector {
  repositoryPath: string;
  checkoutPath: string;
  workspaceBranch?: string;
}
export class GitProjectResourceError extends Error {
  constructor(readonly code: "invalid-selection" | "access-denied" | "unavailable" | "selection-changed" | "unsupported-platform", message: string) { super(message); }
}
function pathInput(input: unknown): asserts input is string {
  if (typeof input !== "string" || !input || input.length > 4096 || input !== input.trim()
    || /[\x00-\x1f\x7f]/.test(input) || (!isAbsolute(input) && !isWindowsAbsolutePath(input))) {
    throw new GitProjectResourceError("invalid-selection", "Select an absolute physical repository checkout root.");
  }
}
async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  if (!samePath(path, await realpath(path))) throw new GitProjectResourceError("unavailable", "Physical Git directories are required; symlink aliases are not selectors.");
  const info = await stat(path, { bigint: true });
  if (!info.isDirectory()) throw new GitProjectResourceError("unavailable", "Repository directory is unavailable.");
  return identity(info);
}
async function gitDirectories(cwd: string) {
  const marker = await lstat(join(cwd, ".git"), { bigint: true });
  if (marker.isSymbolicLink() || (!marker.isFile() && !marker.isDirectory())) {
    throw new GitProjectResourceError("unavailable", "A physical Git checkout is required.");
  }
  const root = toNativePath(await git(cwd, "rev-parse", "--show-toplevel"));
  if (!samePath(root, cwd)) throw new GitProjectResourceError("invalid-selection", "Select the registered checkout root, not a subdirectory.");
  const gitDir = toNativePath(await git(cwd, "rev-parse", "--path-format=absolute", "--git-dir"));
  const commonDir = toNativePath(await git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"));
  return { gitDir, commonDir, marker: { ...identity(marker), ...(marker.isFile() ? { changed: String(marker.ctimeNs), size: String(marker.size) } : {}) } };
}
async function registrations(cwd: string) {
  const output = await git(cwd, "worktree", "list", "--porcelain", "-z");
  const entries: { cwd: string; branch?: string }[] = [];
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) entries.push({ cwd: toNativePath(field.slice(9)) });
    else if (field.startsWith("branch refs/heads/") && entries.length) entries.at(-1)!.branch = field.slice("branch refs/heads/".length);
  }
  return entries;
}

/**
 * Explicit project selection does not inspect or move the calling chat. Resolve
 * from Git's physical registration, not resolveProject's display/cache fallback.
 * Access is checked before invoking Git on an untrusted caller-supplied path.
 */
export async function selectGitProjectResources(repositoryPath: string, workspaceBranch?: string, checkoutPath?: string): Promise<GitProjectResources> {
  pathInput(repositoryPath);
  if (checkoutPath !== undefined) pathInput(checkoutPath);
  if (workspaceBranch !== undefined && !validLocalBranchName(workspaceBranch)) {
    throw new GitProjectResourceError("invalid-selection", "Select a valid local workspace branch.");
  }
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(repositoryPath, roots)) throw new GitProjectResourceError("access-denied", "Repository selection is outside the allowed file roots.");
  try {
    const seedIdentity = await directoryIdentity(repositoryPath);
    const seed = await gitDirectories(repositoryPath);
    const registered = await registrations(repositoryPath);
    const seedRows = registered.filter((item) => samePath(item.cwd, repositoryPath));
    // A path selector is unambiguous even when an externally corrupted worktree
    // list contains two entries for the same branch. Still reject duplicate rows.
    const matches = checkoutPath !== undefined ? registered.filter((item) => samePath(item.cwd, checkoutPath))
      : workspaceBranch === undefined ? seedRows : registered.filter((item) => item.branch === workspaceBranch);
    if (seedRows.length !== 1 || matches.length !== 1 || !matches[0].branch || !validLocalBranchName(matches[0].branch)
      || (workspaceBranch !== undefined && matches[0].branch !== workspaceBranch)
      || (checkoutPath !== undefined && registered.filter((item) => item.branch === matches[0].branch).length !== 1)) {
      throw new GitProjectResourceError("unavailable", "Select one registered checkout of a local branch in this repository.");
    }
    const { cwd, branch } = matches[0] as { cwd: string; branch: string };
    if (!isExistingFilePathAllowed(cwd, roots)) throw new GitProjectResourceError("access-denied", "Selected worktree is outside the allowed file roots.");
    // Git lists the primary checkout first, including when called from a linked
    // worktree. This identity is independent of its current branch name.
    const projectRoot = registered[0].cwd;
    if (checkoutPath !== undefined && !samePath(repositoryPath, projectRoot)) {
      throw new GitProjectResourceError("invalid-selection", "Select the canonical primary repository root with an explicit checkout.");
    }
    if (!isExistingFilePathAllowed(projectRoot, roots)) throw new GitProjectResourceError("access-denied", "Canonical repository is outside the allowed file roots.");
    const selected = await gitDirectories(cwd);
    if (!samePath(seed.commonDir, selected.commonDir)) throw new GitProjectResourceError("selection-changed", "Selected worktree changed repositories.");
    const identities = {
      project: await directoryIdentity(projectRoot), checkout: await directoryIdentity(cwd),
      common: await directoryIdentity(selected.commonDir), git: await directoryIdentity(selected.gitDir), marker: selected.marker,
    };
    if ((await git(cwd, "symbolic-ref", "--quiet", "HEAD")) !== `refs/heads/${branch}`
      || JSON.stringify(seedIdentity) !== JSON.stringify(await directoryIdentity(repositoryPath))
      || JSON.stringify(selected) !== JSON.stringify(await gitDirectories(cwd))
      || JSON.stringify(registered) !== JSON.stringify(await registrations(repositoryPath))) {
      throw new GitProjectResourceError("selection-changed", "Repository or workspace identity changed during selection.");
    }
    return { projectRoot, cwd, branch, gitDir: selected.gitDir, commonDir: selected.commonDir, identities };
  } catch (cause) {
    if (cause instanceof GitProjectResourceError) throw cause;
    // Git stderr and arbitrary filesystem paths are not public error messages.
    throw new GitProjectResourceError("unavailable", "Physical registered repository/workspace unavailable; inspect the selection.");
  }
}

/** Strict selector for new read surfaces; legacy branch-only calls use selectGitProjectResources directly. */
export async function selectCanonicalGitResources(selector: GitResourceSelector): Promise<GitProjectResources> {
  return selectGitProjectResources(selector.repositoryPath, selector.workspaceBranch, selector.checkoutPath);
}

/** Catch replacement even when paths, branches, commits and index bytes match. */
export async function revalidateGitProjectResources(expected: GitProjectResources): Promise<void> {
  const current = await selectGitProjectResources(expected.cwd);
  if (!samePath(expected.projectRoot, current.projectRoot) || !samePath(expected.cwd, current.cwd)
    || !samePath(expected.commonDir, current.commonDir) || !samePath(expected.gitDir, current.gitDir)
    || expected.branch !== current.branch || JSON.stringify(expected.identities) !== JSON.stringify(current.identities)) {
    throw new GitProjectResourceError("selection-changed", "Captured repository/workspace identity changed; select it again.");
  }
}

/** Canonical policy key for an already-authorized caller cwd, including subdirectories. */
export async function gitProjectRootForCaller(cwd: string): Promise<string> {
  try {
    const root = toNativePath(await git(cwd, "rev-parse", "--show-toplevel"));
    const registered = await registrations(root);
    if (registered.filter((item) => samePath(item.cwd, root)).length !== 1) throw new Error("Unregistered caller");
    await directoryIdentity(registered[0].cwd);
    return registered[0].cwd;
  } catch {
    throw new GitProjectResourceError("unavailable", "Cannot resolve the caller's canonical repository for project-scoped restrictions.");
  }
}

/**
 * Pin directory instances while Git reads objects, not only before/after. The
 * child reads our live descriptors via /proc/<parent>/fd; --git-dir and the
 * explicit common dir prevent .git/commondir rediscovery between subprocesses.
 * There is no weaker path-based fallback where this mechanism is unavailable.
 */
export async function withGitProjectReview<T>(selection: GitProjectResources, read: (repository: GitReviewRepository) => Promise<T>): Promise<T> {
  if (process.platform !== "linux") throw new GitProjectResourceError("unsupported-platform", "Explicit-project comparisons currently require Linux directory-descriptor binding. Status and settings remain available.");
  await revalidateGitProjectResources(selection);
  const handles: FileHandle[] = [];
  const pin = async (path: string, expected: DirectoryIdentity) => {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(handle);
    if (JSON.stringify(identity(await handle.stat({ bigint: true }))) !== JSON.stringify(expected)) {
      throw new GitProjectResourceError("selection-changed", "Git directory changed before its review context could be pinned.");
    }
    return `/proc/${process.pid}/fd/${handle.fd}`;
  };
  try {
    const repository = { cwd: await pin(selection.cwd, selection.identities.checkout),
      gitDir: await pin(selection.gitDir, selection.identities.git), commonDir: await pin(selection.commonDir, selection.identities.common) };
    const result = await read(repository);
    await revalidateGitProjectResources(selection);
    return result;
  } finally { await Promise.all(handles.map((handle) => handle.close())); }
}

/** Public identity only. Directory-instance evidence stays server-owned. */
export function gitProjectResourceSummary(selection: GitProjectResources) {
  return { projectRoot: selection.projectRoot, cwd: selection.cwd, branch: selection.branch };
}
