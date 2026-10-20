import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";

export const UPLOAD_CONFLICT_STRATEGIES = ["error", "overwrite", "skip"] as const;
export type UploadConflictStrategy = typeof UPLOAD_CONFLICT_STRATEGIES[number];

const UPLOAD_CONFLICT_STRATEGY_SET = new Set<string>(UPLOAD_CONFLICT_STRATEGIES);

export interface UploadTargetInspection {
  conflicts: string[];
  nonReplaceable: string[];
}

export function parseUploadConflictStrategy(value: string | null): UploadConflictStrategy | null {
  const candidate = value ?? "error";
  return UPLOAD_CONFLICT_STRATEGY_SET.has(candidate)
    ? candidate as UploadConflictStrategy
    : null;
}

export function validateUploadFileNames(fileNames: string[]): string | null {
  if (fileNames.length === 0) return "No files selected";

  const seen = new Set<string>();
  for (const fileName of fileNames) {
    if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
      return `Invalid file name: ${fileName || "(empty)"}`;
    }
    if (fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
      return `File names must not contain a path: ${fileName}`;
    }
    // Win32 aliases and alternate data streams must not bypass flat-name or
    // duplicate validation. POSIX names retain their literal semantics.
    if (process.platform === "win32" && (/[<>:"|?*\x00-\x1f]/.test(fileName)
      || /[. ]$/.test(fileName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName))) {
      return `Invalid file name: ${fileName}`;
    }
    const key = process.platform === "win32" ? fileName.toLowerCase() : fileName;
    if (seen.has(key)) return `Duplicate file name in upload: ${fileName}`;
    seen.add(key);
  }

  return null;
}

export function inspectUploadTargets(directory: string, fileNames: string[]): UploadTargetInspection {
  const conflicts: string[] = [];
  const nonReplaceable: string[] = [];

  for (const fileName of fileNames) {
    const destination = path.join(directory, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }

    conflicts.push(fileName);
    if (!stat.isFile() || stat.isSymbolicLink()) nonReplaceable.push(fileName);
  }

  return { conflicts, nonReplaceable };
}

export class UploadWriteError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export interface UploadDirectory {
  directory: string;
  roots: Set<string>;
  identity: fs.Stats;
}

/** The route supplies a physically resolved directory and roots. Recheck after
 * asynchronous body reads and immediately before installation. This does not
 * lock out external filesystem writers between the final check and effect. */
export function assertUploadDirectoryWritable(target: UploadDirectory): void {
  const { directory, roots, identity } = target;
  if (!isPathWithinRoots(directory, roots) || !isExistingPathWithinRoots(directory, roots)) {
    throw new UploadWriteError("Access denied", 403);
  }
  const current = fs.lstatSync(directory);
  if (!current.isDirectory() || !samePath(fs.realpathSync(directory), directory)
    || current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new UploadWriteError("Upload directory changed; select it again", 409);
  }
  if (!(current.mode & 0o222)) throw new UploadWriteError("Upload directory is not writable", 403);
  try { fs.accessSync(directory, fs.constants.W_OK | fs.constants.X_OK); }
  catch { throw new UploadWriteError("Upload directory is not writable", 403); }
}

function uploadDestinationStat(destination: string): fs.Stats | undefined {
  try { return fs.lstatSync(destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function writeUploadFile(
  target: UploadDirectory, name: string, bytes: Buffer, strategy: UploadConflictStrategy,
): "uploaded" | "skipped" {
  const invalid = validateUploadFileNames([name]);
  if (invalid) throw new UploadWriteError(invalid, 400);
  assertUploadDirectoryWritable(target);
  const destination = path.join(target.directory, name);
  const before = uploadDestinationStat(destination);
  if (before && strategy === "skip") return "skipped";
  if (before && strategy === "error") throw new UploadWriteError("File already exists", 409);
  if (before && (!before.isFile() || before.isSymbolicLink())) {
    throw new UploadWriteError("Cannot replace a directory or symbolic link", 409);
  }
  if (before) {
    if (!(before.mode & 0o222)) throw new UploadWriteError("File is not writable", 403);
    try { fs.accessSync(destination, fs.constants.W_OK); }
    catch { throw new UploadWriteError("File is not writable", 403); }
  }

  const temporary = path.join(target.directory, `.pi-web-upload-${randomUUID()}.tmp`);
  let staged = false;
  try {
    // Never unlink the original before all bytes have been written successfully.
    const fd = fs.openSync(temporary, "wx", before ? before.mode & 0o777 : 0o666);
    staged = true;
    try {
      fs.writeFileSync(fd, bytes);
      if (before) fs.fchmodSync(fd, before.mode & 0o777);
    } finally { fs.closeSync(fd); }
    assertUploadDirectoryWritable(target);
    const latest = uploadDestinationStat(destination);
    if (before) {
      if (!latest?.isFile() || latest.dev !== before.dev || latest.ino !== before.ino
        || latest.size !== before.size || latest.mtimeMs !== before.mtimeMs || latest.ctimeMs !== before.ctimeMs) {
        throw new UploadWriteError("File changed during upload; try again after reviewing it", 409);
      }
      fs.renameSync(temporary, destination);
      staged = false;
    } else {
      // Never use overwrite-capable rename for a new name. Prefer exclusive
      // hard-link installation, with exclusive copy for FAT/UNC destinations
      // that do not support links. New-file copy is not a transactional write.
      try {
        try { fs.linkSync(temporary, destination); }
        catch (error) {
          if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "ENOSYS", "EXDEV"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          assertUploadDirectoryWritable(target);
          fs.copyFileSync(temporary, destination, fs.constants.COPYFILE_EXCL);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" && strategy === "skip") return "skipped";
        throw error;
      }
    }
    return "uploaded";
  } finally {
    if (staged) {
      try {
        // A rejected/swapped parent must not redirect cleanup outside the
        // original directory. An orphan is safer than deleting through an alias.
        assertUploadDirectoryWritable(target);
        fs.unlinkSync(temporary);
      } catch { /* retain original outcome; inaccessible staging may remain */ }
    }
  }
}
