import { execFile } from "node:child_process";
import { promisify } from "node:util";
// @ts-expect-error Native Node tests require the .ts suffix.
import { gitExecEnv } from "./git-exec.ts";
// @ts-expect-error Native Node tests require the .ts suffix.
import { DiffContextError, MAX_DIFF_FILE_BYTES, MAX_DIFF_CONTEXT_LINES, countDiffTextLines, type DiffContext, type DiffFileContents } from "./diff-context.ts";
export { DiffContextError };

const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
async function git(cwd: string, args: string[], limit = 64 * 1024): Promise<Buffer> {
  try {
    const { stdout } = await exec("git", ["-C", cwd, "--no-pager", ...args], {
      env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1",
        GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" },
      encoding: "buffer", maxBuffer: limit, timeout: 15_000,
    });
    return stdout;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new DiffContextError("Full-file context exceeds the size limit; the patch remains available.", 413);
    }
    throw new DiffContextError("The matching file snapshot is unavailable; the patch remains available.");
  }
}

export function decodeDiffText(buffer: Buffer): string {
  if (buffer.length > MAX_DIFF_FILE_BYTES) throw new DiffContextError("Full-file context is limited to 1 MiB per side.", 413);
  if (buffer.includes(0)) throw new DiffContextError("Full-file context is unavailable for binary files.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { throw new DiffContextError("Full-file context requires valid UTF-8 text."); }
  if (countDiffTextLines(text) > MAX_DIFF_CONTEXT_LINES) throw new DiffContextError("Full-file context exceeds the line limit.", 413);
  return text;
}

/** Callers authorize the tree pair and literal changed paths; this is not an arbitrary object API. */
export async function readGitTreeFile(cwd: string, tree: string | null, filePath: string): Promise<DiffFileContents | null> {
  if (tree === null) return null;
  if (!OID.test(tree) || !filePath || filePath.includes("\0")) throw new DiffContextError("Invalid file snapshot request.", 400);
  const output = (await git(cwd, ["ls-tree", "-z", tree, "--", filePath])).toString("utf8");
  if (!output) return null;
  const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]+)\t([^\0]+)\0$/.exec(output);
  if (!match || match[4] !== filePath || !OID.test(match[3])) throw new DiffContextError("The matching tree entry is unavailable.");
  if (match[2] !== "blob" || !["100644", "100755"].includes(match[1])) {
    throw new DiffContextError("Full-file context is available only for regular text files, not symlinks or submodules.");
  }
  const oid = match[3];
  const rawSize = (await git(cwd, ["cat-file", "-s", oid])).toString("utf8").trim();
  const size = Number(rawSize);
  if (!/^\d+$/.test(rawSize) || !Number.isSafeInteger(size)) throw new DiffContextError("Invalid file snapshot size.");
  if (size > MAX_DIFF_FILE_BYTES) throw new DiffContextError("Full-file context is limited to 1 MiB per side.", 413);
  const contents = decodeDiffText(await git(cwd, ["cat-file", "blob", oid], MAX_DIFF_FILE_BYTES));
  return { name: filePath, contents, cacheKey: `git:${oid}:${filePath}` };
}

export async function readGitFileContext(cwd: string, before: string | null, after: string | null,
  filePath: string, previousPath = filePath): Promise<DiffContext> {
  const [oldFile, newFile] = await Promise.all([
    readGitTreeFile(cwd, before, previousPath), readGitTreeFile(cwd, after, filePath),
  ]);
  if (!oldFile && !newFile) throw new DiffContextError("The matching file snapshot is unavailable.", 404);
  const lines = [oldFile, newFile].reduce((total, file) => total + (file ? countDiffTextLines(file.contents) : 0), 0);
  if (lines > MAX_DIFF_CONTEXT_LINES) throw new DiffContextError("Full-file context is limited to 50,000 combined lines.", 413);
  return { oldFile, newFile };
}
