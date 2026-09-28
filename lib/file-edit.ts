import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { isImagePath, isAudioPath, isVideoPath, isDocumentPreviewPath } from "./file-types";

export const MAX_EDIT_BYTES = 1024 * 1024;
export const MAX_EDIT_REQUEST_BYTES = 3 * 1024 * 1024;

export class FileEditError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function checkTarget(filePath: string, roots: Set<string>): fs.Stats {
  if (!isFilePathAllowed(filePath, roots) || !isExistingFilePathAllowed(filePath, roots)) {
    throw new FileEditError("Access denied", 403);
  }
  if (isImagePath(filePath) || isAudioPath(filePath) || isVideoPath(filePath) || isDocumentPreviewPath(filePath)) {
    throw new FileEditError("Not an editable text file", 415);
  }
  let stat: fs.Stats;
  try { stat = fs.lstatSync(filePath); }
  catch { throw new FileEditError("File not found", 404); }
  if (!stat.isFile()) throw new FileEditError("Not a regular file", 415);
  if (stat.size > MAX_EDIT_BYTES) throw new FileEditError("File too large to edit (1 MB limit)", 413);
  return stat;
}

function readSnapshot(filePath: string, stat: fs.Stats): { content: string; revision: string } {
  // O_NONBLOCK prevents a swapped-in FIFO from hanging the server before fstat.
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > MAX_EDIT_BYTES) {
      throw new FileEditError("File changed while opening", 409);
    }
    const buffer = Buffer.allocUnsafe(MAX_EDIT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, length);
      if (!read) break;
      length += read;
    }
    if (length > MAX_EDIT_BYTES) throw new FileEditError("File too large to edit (1 MB limit)", 413);
    const bytes = buffer.subarray(0, length);
    if (bytes.includes(0)) throw new FileEditError("Not an editable text file", 415);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new FileEditError("Not a UTF-8 text file", 415); }
    const after = fs.fstatSync(fd);
    if (after.size !== length || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new FileEditError("File changed while reading", 409);
    }
    return { content, revision: crypto.createHash("sha256").update(bytes).digest("hex") };
  } finally { fs.closeSync(fd); }
}

function canSave(filePath: string, stat: fs.Stats): boolean {
  if (!(stat.mode & 0o222)) return false;
  try {
    const directory = path.dirname(filePath);
    if (!(fs.statSync(directory).mode & 0o222)) return false;
    fs.accessSync(directory, fs.constants.W_OK);
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch { return false; }
}

export function loadEditableFile(filePath: string, roots: Set<string>) {
  const stat = checkTarget(filePath, roots);
  const snapshot = readSnapshot(filePath, stat);
  return { ...snapshot, writable: canSave(filePath, stat) };
}

/** Synchronous compare-and-replace: other Pi Web saves cannot interleave between
 * comparison and rename in this process. External filesystem writers can race. */
export function saveEditableFile(filePath: string, roots: Set<string>, content: string, expectedRevision: string) {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_EDIT_BYTES) throw new FileEditError("File too large to edit (1 MB limit)", 413);
  if (content.includes("\0")) throw new FileEditError("Not an editable text file", 415);
  const stat = checkTarget(filePath, roots);
  if (!canSave(filePath, stat)) throw new FileEditError("File is not writable", 403);
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new FileEditError("Invalid revision", 400);
  const current = readSnapshot(filePath, stat);
  if (current.revision !== expectedRevision) throw new FileEditError("File changed on disk; draft not saved", 409);

  const directory = path.dirname(filePath);
  const temp = path.join(directory, `.pi-web-edit-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let created = false;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx", mode: stat.mode & 0o777 });
    created = true;
    fs.chmodSync(temp, stat.mode & 0o777);
    // Refuse a replaced target or escaped parent before installing the temp.
    const latest = checkTarget(filePath, roots);
    if (latest.ino !== stat.ino || latest.dev !== stat.dev || readSnapshot(filePath, latest).revision !== expectedRevision) {
      throw new FileEditError("File changed on disk; draft not saved", 409);
    }
    fs.renameSync(temp, filePath);
    created = false;
    return { revision: crypto.createHash("sha256").update(bytes).digest("hex") };
  } finally {
    if (created) { try { fs.unlinkSync(temp); } catch { /* retain original failure */ } }
  }
}
