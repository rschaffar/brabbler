import fs from "node:fs";
import path from "node:path";
import { isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { samePath } from "./paths";
import { GUIDED_LIMITS, parseNotebookChapter, parseNotebookIndex, validateNotebook } from "./guided-review";
import { notebookAssetHasSignature, notebookAssetLimit, notebookAssetMime } from "./guided-review-assets";

export class NotebookReadError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
/** Root admission and physical containment are checked for EVERY file, not inherited from an index. */
function readNotebookBytes(file: string, roots: Set<string>, maximum: number, folder?: string): Buffer {
  if (!path.isAbsolute(file) || !isFilePathAllowed(file, roots)) throw new NotebookReadError("Access denied", 403);
  const physical = fs.realpathSync(file);
  if (!isExistingFilePathAllowed(file, roots)) throw new NotebookReadError("Access denied", 403);
  if (!samePath(physical, file) || (folder && (!samePath(folder, fs.realpathSync(folder)) || !isFilePathAllowed(physical, new Set([folder]))))) throw new NotebookReadError("Notebook symlinks/escapes are forbidden", 403);
  const fd = fs.openSync(physical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new NotebookReadError("Expected a regular file");
    if (before.size > maximum) throw new NotebookReadError(`File exceeds ${maximum} bytes`, 413);
    const bytes = Buffer.alloc(maximum + 1);
    let count = 0, read = 0;
    do { read = fs.readSync(fd, bytes, count, bytes.length - count, null); count += read; } while (read && count < bytes.length);
    if (count > maximum) throw new NotebookReadError(`File exceeds ${maximum} bytes`, 413);
    const after = fs.fstatSync(fd), current = fs.lstatSync(physical);
    if (before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !samePath(fs.realpathSync(file), physical)) throw new NotebookReadError("File changed during read", 409);
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
export function readNotebookText(file: string, roots: Set<string>, folder?: string): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(readNotebookBytes(file, roots, GUIDED_LIMITS.documentBytes, folder));
  if (text.includes("\0")) throw new NotebookReadError("Binary text evidence is unsupported");
  return text;
}
export function readNotebookBinary(file: string, roots: Set<string>, folder: string) {
  const mime = notebookAssetMime(file);
  if (!mime) throw new NotebookReadError("Unsupported binary evidence format");
  const bytes = readNotebookBytes(file, roots, notebookAssetLimit(mime), folder);
  if (!notebookAssetHasSignature(bytes, mime)) throw new NotebookReadError("Evidence format does not match its filename", 415);
  return { bytes, mime };
}
export function readNotebook(indexPath: string, roots: Set<string>) {
  if (path.basename(indexPath) !== "index.md") throw new NotebookReadError("Open a notebook index.md");
  const folder = path.dirname(indexPath), source = readNotebookText(indexPath, roots, folder);
  const index = parseNotebookIndex(source);
  if (!index) throw new NotebookReadError("No notebook manifest found");
  let bytes = Buffer.byteLength(source);
  const chapters = index.chapters.map(chapter => {
    const text = readNotebookText(path.join(folder, chapter.path), roots, folder);
    bytes += Buffer.byteLength(text);
    if (bytes > GUIDED_LIMITS.packageBytes) throw new NotebookReadError("Notebook exceeds 2 MiB", 413);
    return { ...chapter, steps: parseNotebookChapter(text) };
  });
  return validateNotebook({ index, chapters });
}
