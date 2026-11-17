import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, type BigIntStats } from "node:fs";

/** Follow links like the SDK, but never block opening a FIFO or read a device.
 * With expected, the caller supplies an independently admitted physical path:
 * refuse final symlinks and bind the opened descriptor before consuming bytes. */
export function readRegularFileText(path: string, maxBytes?: number, expected?: BigIntStats): string | undefined {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new Error("Invalid file size bound");
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (expected ? constants.O_NOFOLLOW || 0 : 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new Error("Expected a regular file");
    const assertExpected = () => {
      if (!expected) return;
      const opened = fstatSync(fd, { bigint: true });
      if (!opened.isFile() || (["dev", "ino", "mode", "uid", "gid", "nlink", "size", "birthtimeNs", "mtimeNs", "ctimeNs"] as const).some(key => opened[key] !== expected[key])) {
        throw new Error("File changed from the admitted target");
      }
    };
    assertExpected(); // In particular, do not read bytes from a substituted FD.
    const checked = (text: string) => { assertExpected(); return text; };
    if (maxBytes === undefined) return checked(readFileSync(fd, "utf8"));
    if (stats.size > maxBytes) throw new Error("File is larger than the size limit");
    const chunks: Buffer[] = [];
    let length = 0;
    // Read one byte beyond the limit to refuse a growing file, not truncate it.
    while (length <= maxBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - length));
      const size = readSync(fd, chunk, 0, chunk.length, null);
      if (!size) break;
      chunks.push(chunk.subarray(0, size));
      length += size;
    }
    if (length > maxBytes) throw new Error("File is larger than the size limit");
    return checked(Buffer.concat(chunks, length).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}
