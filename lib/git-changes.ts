import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import { gitExecEnv } from "./git-exec";
import { toNativePath } from "./paths";
import { DiffContextError } from "./diff-context";
import { captureWorkingDiff, readWorkingDiffFile, workingDiffHead, workingFileDigest } from "./working-diff-context";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_LITERAL_PATHSPECS: "1" },
  });
  return stdout;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return toNativePath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()) || null;
  } catch {
    return null;
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

async function readTrackedLineStats(
  repositoryRoot: string,
  cwd: string,
): Promise<{ additions: number; deletions: number }> {
  const relativeCwd = toGitPath(path.relative(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--numstat",
      "HEAD",
      "--",
      pathspec,
    ]);
    let additions = 0;
    let deletions = 0;
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const [added, deleted] = line.split("\t", 2);
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isInteger(addedCount)) additions += addedCount;
      if (Number.isInteger(deletedCount)) deletions += deletedCount;
    }
    return { additions, deletions };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

function countUntrackedTextLines(filePath: string): number {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return 0;
    const content = fs.readFileSync(filePath);
    if (hasNullByte(content) || content.length === 0) return 0;
    const text = content.toString("utf8");
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    };
  }

  const [entries, trackedLineStats] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readTrackedLineStats(repositoryRoot, cwd),
  ]);
  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    return [{
      filePath,
      ...(entry.indexStatus === "R" && entry.originalPath && isWithinPath(cwd, path.resolve(repositoryRoot, entry.originalPath))
        ? { originalFilePath: path.resolve(repositoryRoot, entry.originalPath) } : {}),
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    }];
  });
  const untrackedAdditions = files.reduce(
    (total, file) => total + (file.status === "untracked" ? countUntrackedTextLines(file.filePath) : 0),
    0,
  );

  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: trackedLineStats.additions + untrackedAdditions,
    deletions: trackedLineStats.deletions,
  };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
  head = "HEAD",
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      head,
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const entries = await readStatusEntries(repositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  const head = await workingDiffHead(repositoryRoot);
  let current;
  try { current = readWorkingDiffFile(repositoryRoot, resolvedFilePath); }
  catch (error) { if (error instanceof DiffContextError && error.status !== 403) return { supported: false }; throw error; }
  if (!current && status !== "deleted") return { supported: false };
  if (current && (current.buffer.length > TEXT_PREVIEW_MAX_BYTES || hasNullByte(current.buffer))) return { supported: false };
  const newContent = current?.buffer.toString("utf8") ?? "";

  let patch: string;
  if (status === "untracked") patch = createAddedFilePatch(relativePath, newContent);
  else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, head ?? "HEAD");
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else patch = trackedPatch;
  }
  if (!patch.includes("\n@@ ")) return { supported: false };
  if (head !== await workingDiffHead(repositoryRoot) || workingFileDigest(current) !== workingFileDigest(readWorkingDiffFile(repositoryRoot, resolvedFilePath))) {
    throw new DiffContextError("Working file or HEAD changed while reading; refresh its diff.");
  }
  const revision = captureWorkingDiff({ cwd: path.resolve(cwd), root: repositoryRoot, filePath: resolvedFilePath,
    gitPath: relativePath, oldPath: entry.originalPath ?? relativePath, head, signature: workingFileDigest(current) }, patch);
  return { supported: true, status, patch, revision };
}
