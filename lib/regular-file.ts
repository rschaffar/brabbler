import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";

/** Follow links like the SDK, but never block opening a FIFO or read a device. */
export function readRegularFileText(path: string, maxBytes?: number): string | undefined {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new Error("Invalid file size bound");
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new Error("Expected a regular file");
    if (maxBytes === undefined) return readFileSync(fd, "utf8");
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
    return Buffer.concat(chunks, length).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
