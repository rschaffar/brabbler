import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { samePath } from "./paths";
import { decodeDiffText, readGitTreeFile } from "./git-file-context";
import { DiffContextError, MAX_DIFF_FILE_BYTES, MAX_DIFF_CONTEXT_LINES, countDiffTextLines, type DiffContext } from "./diff-context";

const exec = promisify(execFile);
export interface WorkingFile { buffer: Buffer; signature: string }
interface Snapshot { cwd: string; root: string; filePath: string; gitPath: string; oldPath: string; head: string | null; signature: string | null; created: number }
const key = Symbol.for("brabbler:working-diff-context");
const global = globalThis as typeof globalThis & { [key]?: Map<string, Snapshot> };
const snapshots = global[key] ??= new Map<string, Snapshot>();
const TTL = 60 * 60 * 1000;
export const workingFileDigest = (value: WorkingFile | null) => value ? value.signature : null;
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}
function safeParent(root: string, filePath: string) {
  let parent = path.dirname(filePath);
  while (!fs.existsSync(parent) && parent !== path.dirname(parent)) parent = path.dirname(parent);
  if (!within(fs.realpathSync(root), fs.realpathSync(parent))) throw new DiffContextError("File escapes its checkout.", 403);
}

/** Bounded, no-follow read with inode/mode/content identity; never a preview chunk. */
export function readWorkingDiffFile(root: string, filePath: string): WorkingFile | null {
  safeParent(root, filePath);
  let before: fs.Stats;
  try { before = fs.lstatSync(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!before.isFile()) throw new DiffContextError("Full-file context requires a regular file, not a symlink.");
  if (before.size > MAX_DIFF_FILE_BYTES) throw new DiffContextError("Full-file context is limited to 1 MiB per side.", 413);
  let fd: number;
  try { fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new DiffContextError("Working file changed; refresh its diff.");
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    safeParent(root, filePath);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw new DiffContextError("Working file changed; refresh its diff.");
    const data = Buffer.alloc(MAX_DIFF_FILE_BYTES + 1);
    let bytes = 0, count;
    while (bytes < data.length && (count = fs.readSync(fd, data, bytes, data.length - bytes, bytes)) > 0) bytes += count;
    if (bytes > MAX_DIFF_FILE_BYTES) throw new DiffContextError("Full-file context is limited to 1 MiB per side.", 413);
    const final = fs.lstatSync(filePath);
    safeParent(root, filePath);
    if (!final.isFile() || final.dev !== stat.dev || final.ino !== stat.ino || final.size !== bytes || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) {
      throw new DiffContextError("Working file changed; refresh its diff.");
    }
    const buffer = data.subarray(0, bytes);
    const signature = createHash("sha256").update(buffer).update(JSON.stringify([stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs])).digest("hex");
    return { buffer, signature };
  } catch (error) {
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new DiffContextError("Working file changed; refresh its diff.");
    throw error;
  } finally { fs.closeSync(fd); }
}
export async function workingDiffHead(root: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], {
      env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
      encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
    });
    return stdout.trim();
  } catch { return null; }
}
export function captureWorkingDiff(value: Omit<Snapshot, "created">, patch: string): string {
  const revision = createHash("sha256").update(JSON.stringify(value)).update(patch).digest("hex"), now = Date.now();
  for (const [id, snapshot] of snapshots) if (now - snapshot.created >= TTL) snapshots.delete(id);
  if (!snapshots.has(revision) && snapshots.size >= 512) snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(revision, { ...value, created: now });
  return revision;
}
export async function getWorkingDiffContext(cwd: string, filePath: string, revision: string): Promise<DiffContext> {
  const snapshot = snapshots.get(revision);
  if (!snapshot || Date.now() - snapshot.created >= TTL || !samePath(cwd, snapshot.cwd) || !samePath(filePath, snapshot.filePath)) {
    throw new DiffContextError("This working-file snapshot is unavailable; refresh its diff.");
  }
  const verify = async () => {
    const current = readWorkingDiffFile(snapshot.root, snapshot.filePath);
    if (workingFileDigest(current) !== snapshot.signature || await workingDiffHead(snapshot.root) !== snapshot.head) {
      throw new DiffContextError("Working file or HEAD changed; refresh its diff before loading context.");
    }
    return current;
  };
  const current = await verify();
  const oldFile = await readGitTreeFile(snapshot.root, snapshot.head, snapshot.oldPath);
  const newFile = current ? { name: snapshot.gitPath, contents: decodeDiffText(current.buffer), cacheKey: `working:${revision}` } : null;
  if ([oldFile, newFile].reduce((sum, file) => sum + (file ? countDiffTextLines(file.contents) : 0), 0) > MAX_DIFF_CONTEXT_LINES) {
    throw new DiffContextError("Full-file context is limited to 50,000 combined lines.", 413);
  }
  await verify();
  return { oldFile, newFile };
}
