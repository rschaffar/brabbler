import { execFile } from "node:child_process";
// @ts-expect-error Native Node tests require the .ts suffix.
import { gitExecEnv } from "./git-exec.ts";
// @ts-expect-error Native Node tests require the .ts suffix.
import { DiffContextError, MAX_DIFF_FILE_BYTES, MAX_DIFF_CONTEXT_LINES, countDiffTextLines, type DiffContext, type DiffFileContents } from "./diff-context.ts";
export { DiffContextError };

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
async function git(cwd: string, args: string[], limit = 64 * 1024, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  try {
    // execFile's abort callback can precede child/pipe close. Wait for both the
    // bounded result and close, so callers never settle while an owned read runs.
    return await new Promise<Buffer>((resolve, reject) => {
      let closed = false, result: { error: Error | null; stdout: Buffer } | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (!closed || !result) return;
        if (escalation) clearTimeout(escalation);
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(signal.reason);
        else if (result.error) reject(result.error);
        else resolve(result.stdout);
      };
      const child = execFile("git", ["-C", cwd, "--no-pager", "-c", "core.fsmonitor=false", ...args], {
        env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1",
          GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" },
        encoding: "buffer", maxBuffer: limit, timeout: 15_000,
      }, (error, stdout) => { result = { error, stdout }; finish(); });
      const abort = () => {
        if (closed) return;
        child.kill("SIGTERM");
        escalation ??= setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 1000);
      };
      child.once("close", () => { closed = true; finish(); });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  } catch (error) {
    signal?.throwIfAborted();
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
export async function readGitTreeFile(cwd: string, tree: string | null, filePath: string, signal?: AbortSignal): Promise<DiffFileContents | null> {
  signal?.throwIfAborted();
  if (tree === null) return null;
  if (!OID.test(tree) || !filePath || filePath.includes("\0")) throw new DiffContextError("Invalid file snapshot request.", 400);
  const output = (await git(cwd, ["ls-tree", "-z", tree, "--", filePath], undefined, signal)).toString("utf8");
  if (!output) return null;
  const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]+)\t([^\0]+)\0$/.exec(output);
  if (!match || match[4] !== filePath || !OID.test(match[3])) throw new DiffContextError("The matching tree entry is unavailable.");
  if (match[2] !== "blob" || !["100644", "100755"].includes(match[1])) {
    throw new DiffContextError("Full-file context is available only for regular text files, not symlinks or submodules.");
  }
  const oid = match[3];
  const rawSize = (await git(cwd, ["cat-file", "-s", oid], undefined, signal)).toString("utf8").trim();
  const size = Number(rawSize);
  if (!/^\d+$/.test(rawSize) || !Number.isSafeInteger(size)) throw new DiffContextError("Invalid file snapshot size.");
  if (size > MAX_DIFF_FILE_BYTES) throw new DiffContextError("Full-file context is limited to 1 MiB per side.", 413);
  const contents = decodeDiffText(await git(cwd, ["cat-file", "blob", oid], MAX_DIFF_FILE_BYTES, signal));
  return { name: filePath, contents, cacheKey: `git:${oid}:${filePath}` };
}

export async function readGitFileContext(cwd: string, before: string | null, after: string | null,
  filePath: string, previousPath = filePath, signal?: AbortSignal): Promise<DiffContext> {
  const controller = new AbortController();
  const ownedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let failed = false, failure: unknown;
  const observe = async (work: Promise<DiffFileContents | null>) => {
    try { return await work; }
    catch (error) { if (!failed) { failed = true; failure = error; controller.abort(error); } throw error; }
  };
  const results = await Promise.allSettled([
    observe(readGitTreeFile(cwd, before, previousPath, ownedSignal)), observe(readGitTreeFile(cwd, after, filePath, ownedSignal)),
  ]);
  if (failed) throw failure;
  const [oldFile, newFile] = results.map(result => (result as PromiseFulfilledResult<DiffFileContents | null>).value);
  if (!oldFile && !newFile) throw new DiffContextError("The matching file snapshot is unavailable.", 404);
  const lines = [oldFile, newFile].reduce((total, file) => total + (file ? countDiffTextLines(file.contents) : 0), 0);
  if (lines > MAX_DIFF_CONTEXT_LINES) throw new DiffContextError("Full-file context is limited to 50,000 combined lines.", 413);
  return { oldFile, newFile };
}
