import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { samePath } from "./paths";
import type { GitBindingFileIdentity } from "./git-workflow-binding-types";

export class GitTaskBindingError extends Error {
  constructor(message = "Task binding data is unavailable; inspect it before continuing.", readonly status = 409) { super(message); }
}
export function bindingFields(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.keys(input).sort().join(",") !== [...keys].sort().join(",")) throw new GitTaskBindingError();
  return input as Record<string, unknown>;
}
export function bindingText(value: unknown, max = 4096): string {
  if (typeof value !== "string" || !value || value.includes("\0") || Buffer.byteLength(value) > max) throw new GitTaskBindingError();
  return value;
}
export function bindingPath(value: unknown): string {
  const text = bindingText(value);
  if (!isAbsolute(text)) throw new GitTaskBindingError();
  return text;
}
export function bindingHash(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
export function bindingDigest(value: unknown): string {
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v);
  return bindingHash(canonical(value));
}
export function bindingIdentity(stat: BigIntStats): GitBindingFileIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) };
}
export function validateBindingIdentity(input: unknown): GitBindingFileIdentity {
  const data = bindingFields(input, ["dev", "ino", "birthtime"]);
  for (const value of Object.values(data)) if (typeof value !== "string" || !/^[0-9]{1,30}$/.test(value)) throw new GitTaskBindingError();
  return data as unknown as GitBindingFileIdentity;
}
export function bindingPathIdentity(file: string, directory = false): GitBindingFileIdentity {
  const stat = lstatSync(file, { bigint: true });
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || !samePath(realpathSync(file), file)) throw new GitTaskBindingError("A physical file or directory is required for task binding.");
  return bindingIdentity(stat);
}
export function bindingFileFingerprint(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
function unchanged(a: BigIntStats, b: BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
/** Pin each parent through a directory descriptor. O_NOFOLLOW on the leaf alone
 * is insufficient: a source's parent could be retargeted after realpath().
 * The kernel-owned proc fd directory supplies openat-style traversal on Linux.
 * Other platforms keep this optional source-review capability unavailable.
 */
function openInstructionFile(file: string): number {
  if (process.platform !== "linux" || !isAbsolute(file) || resolve(file) !== file) throw new GitTaskBindingError("Secure instruction-source capture requires Linux descriptor-relative reads on this version.");
  const components = file.split("/").filter(Boolean);
  let parent = openSync("/", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const component of components.slice(0, -1)) {
      const next = openSync(`/proc/self/fd/${parent}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(parent); parent = next;
    }
    return openSync(`/proc/self/fd/${parent}/${components.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } finally { closeSync(parent); }
}
export function statInstructionFile(file: string): BigIntStats {
  const fd = openInstructionFile(file);
  try { return fstatSync(fd, { bigint: true }); } finally { closeSync(fd); }
}
/** Bounded descriptor read; source identities are checked BEFORE any bytes are
 * read. The private-data variant retains the established portable IO contract.
 */
export function readBindingFile(file: string, limit: number, privateFile = false, expectedSourceFingerprint?: string): { bytes: Buffer; identity: GitBindingFileIdentity; fingerprint: string } {
  const source = expectedSourceFingerprint !== undefined;
  const before = source ? statInstructionFile(file) : lstatSync(file, { bigint: true });
  const check = (stat: BigIntStats) => {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(limit)
      || privateFile && (stat.nlink !== BigInt(1) || (stat.mode & BigInt(0o077)) !== BigInt(0) || typeof process.getuid === "function" && stat.uid !== BigInt(process.getuid()))) throw new GitTaskBindingError();
  };
  check(before);
  const fd = source ? openInstructionFile(file) : openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    check(opened);
    if (!unchanged(before, opened) || source && bindingFileFingerprint(opened) !== expectedSourceFingerprint) throw new GitTaskBindingError("Source changed before it could be read. Preview again.");
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, size);
      if (!count) break;
      size += count;
    }
    if (BigInt(size) !== opened.size || !unchanged(opened, fstatSync(fd, { bigint: true }))
      || !unchanged(opened, source ? statInstructionFile(file) : lstatSync(file, { bigint: true }))) throw new GitTaskBindingError("Source changed while it was being read. Preview again.");
    return { bytes: buffer.subarray(0, size), identity: bindingIdentity(opened), fingerprint: bindingFileFingerprint(opened) };
  } finally { closeSync(fd); }
}
