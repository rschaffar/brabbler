import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync, type BigIntStats } from "node:fs";
import { posix } from "node:path";
import { isWindowsAbsolutePath } from "../paths";
import type { SelectionContext } from "./selection";

/** Technical limits, not producer policy or filesystem authority. */
export const CATALOG_METADATA_MAX_BYTES = 4 * 1024 * 1024;
export const CATALOG_METADATA_MAX_DEPTH = 16;
export const CATALOG_METADATA_MAX_NODES = 100_000;
export const CATALOG_METADATA_MAX_ENTRIES = 10_000;
export const CATALOG_METADATA_MAX_PATH_LENGTH = 16_384;
export const CATALOG_METADATA_MAX_TEXT_LENGTH = 4096;
/** Internal native-inventory kinds; producer v1 admits only skill/extension. */
export type CatalogMetadataKind = "skill" | "extension" | "prompt" | "theme";
type Presentation = Readonly<{ label?: string; purpose?: string }>;
export type CatalogMetadataGroup = Presentation & Readonly<{ key: string }>;
export type CatalogMetadataMember = Presentation & Readonly<{ kind: CatalogMetadataKind; path: string }>;
export type CatalogMetadataPackage = Presentation & Readonly<{
  source: string; group: string | null; members: readonly CatalogMetadataMember[];
}>;
export type CatalogMetadataStandalone = CatalogMetadataMember & Readonly<{ group: string | null }>;
/** UNBOUND declarations only. No source existence, native registration, trust,
 * physical deduplication, availability or content-read permission is established.
 * The hierarchy and presentation names below are internal normalization only.
 * Global origin is supplied by the admitted consumer context, never JSON authority. */
export interface UnboundCatalogMetadata {
  readonly binding: "unbound";
  readonly version: 1;
  readonly scope: "global";
  readonly managedBy: "nix";
  readonly groups: readonly CatalogMetadataGroup[];
  readonly packages: readonly CatalogMetadataPackage[];
  readonly standalone: readonly CatalogMetadataStandalone[];
}
export type CatalogMetadataErrorCode = "limit" | "json" | "schema" | "path" | "conflict" | "missing-group" | "read" | "generation";
export class CatalogMetadataError extends Error {
  constructor(readonly code: CatalogMetadataErrorCode, readonly at: string, message: string) {
    super(`Catalog metadata ${at}: ${message}`);
    this.name = "CatalogMetadataError";
  }
}
function requireValue(condition: unknown, code: CatalogMetadataErrorCode, at: string, message: string): asserts condition {
  if (!condition) throw new CatalogMetadataError(code, at, message);
}

/** Small strict JSON decoder: checks decoded duplicate keys BEFORE information is
 * lost by JSON.parse. Depth/node bounds also cover hostile unknown-field values.
 * JSON.parse is used only for individual strings/numbers, never the whole input. */
function decodeJson(input: string): unknown {
  let cursor = 0, nodes = 0;
  const fail = () => new CatalogMetadataError("json", `$@${cursor}`, "Invalid JSON");
  const space = () => { while (/[\x20\t\r\n]/.test(input[cursor] ?? "!")) cursor++; };
  const string = (): string => {
    const start = cursor++;
    while (cursor < input.length) {
      const char = input[cursor++];
      if (char === "\\") { cursor++; continue; }
      if (char === '"') {
        try { return JSON.parse(input.slice(start, cursor)) as string; } catch { throw fail(); }
      }
    }
    throw fail();
  };
  const value = (depth: number): unknown => {
    requireValue(depth <= CATALOG_METADATA_MAX_DEPTH && ++nodes <= CATALOG_METADATA_MAX_NODES, "limit", "$", "JSON complexity limit exceeded");
    space();
    const char = input[cursor];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      const object = char === "{", end = object ? "}" : "]";
      cursor++; space();
      const record: Record<string, unknown> = Object.create(null), array: unknown[] = [], keys = new Set<string>();
      if (input[cursor] === end) { cursor++; return object ? record : array; }
      while (cursor < input.length) {
        if (object) {
          if (input[cursor] !== '"') throw fail();
          const key = string();
          requireValue(!keys.has(key), "json", `$@${cursor}`, "Duplicate JSON key");
          keys.add(key); space();
          if (input[cursor++] !== ":") throw fail();
          record[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        space();
        if (input[cursor] === end) { cursor++; return object ? record : array; }
        if (input[cursor++] !== ",") throw fail();
        space();
      }
      throw fail();
    }
    for (const [token, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (input.startsWith(token, cursor)) { cursor += token.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(cursor));
    if (!number) throw fail();
    cursor += number[0].length;
    return JSON.parse(number[0]);
  };
  const result = value(0); space();
  if (cursor !== input.length) throw fail();
  return result;
}
function object(value: unknown, required: readonly string[], optional: readonly string[], at: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), "schema", at, "Expected an object");
  const record = value as Record<string, unknown>;
  requireValue(required.every(key => Object.hasOwn(record, key)) && Object.keys(record).every(key => required.includes(key) || optional.includes(key)),
    "schema", at, "Missing required field or unknown field");
  return record;
}
function text(value: unknown, at: string, max = CATALOG_METADATA_MAX_TEXT_LENGTH): string {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= max && value.isWellFormed()
    && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
  "schema", at, "Expected bounded plain text without controls or unpaired surrogates");
  return value;
}
function presentationText(value: unknown, at: string): string {
  requireValue(typeof value === "string" && value.length <= CATALOG_METADATA_MAX_TEXT_LENGTH && value.isWellFormed() && !value.includes("\0"),
    "schema", at, "Expected bounded plain presentation text");
  return value;
}
function list(value: unknown, at: string): unknown[] {
  requireValue(Array.isArray(value) && value.length <= CATALOG_METADATA_MAX_ENTRIES, "limit", at, "Expected a bounded array");
  return value;
}
function absolutePath(value: unknown, file: boolean, at: string): string {
  const path = text(value, at, CATALOG_METADATA_MAX_PATH_LENGTH);
  // The v1 pilot and W03 identity are POSIX lexical installed names. Refuse
  // Windows/UNC wire forms; never reinterpret them, case-fold or realpath them.
  // A backslash within a POSIX absolute name remains a literal POSIX character.
  requireValue(posix.isAbsolute(path) && !isWindowsAbsolutePath(path) && !path.split("/").includes("..")
    && !/[*?\[\]{}]/.test(path) && (!file || (!path.endsWith("/") && posix.basename(path) !== ".")),
  "path", at, "Expected a local POSIX absolute installed path without traversal or patterns");
  const normalized = posix.normalize(path).replace(/\/$/, "");
  requireValue(normalized.length > 0, "path", at, "Filesystem root is not an installed source/file");
  return normalized;
}
function relativeFile(value: unknown, at: string): string {
  const path = text(value, at, CATALOG_METADATA_MAX_PATH_LENGTH);
  requireValue(!posix.isAbsolute(path) && !isWindowsAbsolutePath(path) && !/[\\:*?\[\]{}]/.test(path)
    && path.split("/").every(part => part !== "" && part !== "." && part !== ".."),
  "path", at, "Expected an exact slash-relative entry file without traversal or patterns");
  return path;
}
/** Parse producer v1 inert bytes/text into the internal hierarchy only.
 * No legacy wire schema, discovery, filesystem resolution or binding. */
export function parseCatalogMetadata(input: string | Uint8Array): UnboundCatalogMetadata {
  requireValue((typeof input === "string" || input instanceof Uint8Array)
    && (typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.byteLength) <= CATALOG_METADATA_MAX_BYTES,
  "limit", "$", "Metadata byte limit exceeded");
  let json: string;
  try {
    // Fatal UTF-8 avoids replacement-character identity collisions; BOM is not JSON.
    json = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch { throw new CatalogMetadataError("json", "$", "Invalid UTF-8"); }
  const root = object(decodeJson(json), ["version", "groups", "packages", "resources"], [], "$");
  requireValue(root.version === 1, "schema", "$", "Expected producer version 1");
  const groupKeys = new Set<string>(), sources = new Set<string>(), files = new Set<string>();
  let entries = 0;
  const count = (at: string) => requireValue(++entries <= CATALOG_METADATA_MAX_ENTRIES, "limit", at, "Total declaration limit exceeded");
  const groups = list(root.groups, "$.groups").map((item, index) => {
    const at = `$.groups[${index}]`; count(at);
    const record = object(item, ["key", "description"], [], at), key = text(record.key, `${at}.key`);
    requireValue(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key), "schema", `${at}.key`, "Expected a lowercase hyphenated group key");
    requireValue(!groupKeys.has(key), "conflict", at, "Duplicate group key"); groupKeys.add(key);
    return Object.freeze({ key, purpose: presentationText(record.description, `${at}.description`) });
  });
  const group = (value: unknown, at: string): string | null => {
    if (value === null) return null;
    const key = text(value, at);
    requireValue(groupKeys.has(key), "missing-group", at, "Unknown group reference");
    return key;
  };
  const member = (record: Record<string, unknown>, path: string, installedFile: string, at: string): CatalogMetadataMember => {
    const kind = record.kind;
    requireValue(kind === "skill" || kind === "extension", "schema", `${at}.kind`, "Unknown producer resource kind");
    requireValue(kind === "skill" ? posix.basename(path) === "SKILL.md" : /\.(ts|js)$/.test(path),
      "path", at, "Expected SKILL.md or an explicit .ts/.js extension entry file");
    requireValue(record.managedBy === "nix", "schema", `${at}.managedBy`, "Expected managedBy nix");
    // One lexical file cannot be claimed twice, even under different kinds/owners.
    requireValue(!files.has(installedFile), "conflict", at, "Duplicate file reference or conflicting ownership"); files.add(installedFile);
    return Object.freeze({ kind, path });
  };
  const packages = list(root.packages, "$.packages").map((item, index) => {
    const at = `$.packages[${index}]`; count(at);
    const record = object(item, ["source", "name", "group", "managedBy"], [], at);
    const source = absolutePath(record.source, false, `${at}.source`);
    requireValue(!sources.has(source), "conflict", at, "Duplicate normalized package source"); sources.add(source);
    requireValue(record.managedBy === "nix", "schema", `${at}.managedBy`, "Expected managedBy nix");
    return { source, group: group(record.group, `${at}.group`), members: [] as CatalogMetadataMember[],
      label: presentationText(record.name, `${at}.name`) };
  });
  const bySource = new Map(packages.map(pkg => [pkg.source, pkg]));
  const standalone: CatalogMetadataStandalone[] = [];
  list(root.resources, "$.resources").forEach((item, index) => {
    const at = `$.resources[${index}]`; count(at);
    const record = object(item, ["kind", "package", "path", "managedBy"], ["group"], at);
    if (record.package === null) {
      requireValue(Object.hasOwn(record, "group"), "schema", at, "Standalone resource requires group");
      const path = absolutePath(record.path, true, `${at}.path`);
      standalone.push(Object.freeze({ ...member(record, path, path, at), group: group(record.group, `${at}.group`) }));
    } else {
      requireValue(!Object.hasOwn(record, "group"), "schema", at, "Packaged resource must not have group");
      const source = absolutePath(record.package, false, `${at}.package`), pkg = bySource.get(source);
      requireValue(pkg, "schema", `${at}.package`, "Unknown package reference");
      const path = relativeFile(record.path, `${at}.path`);
      pkg.members.push(member(record, path, posix.join(source, path), at));
    }
  });
  // Sorted adjacency detects nesting in O(n log n), not quadratic work at bounds.
  const sorted = [...sources].map(source => `${source}/`).sort();
  for (let index = 1; index < sorted.length; index++) {
    requireValue(!sorted[index].startsWith(sorted[index - 1]), "conflict", "$.packages", "Nested packages are unsupported");
  }
  const allPaths = [...new Set([...sources, ...files])].map(path => `${path}/`).sort();
  for (let index = 0; index < allPaths.length; index++) {
    const path = allPaths[index].slice(0, -1);
    requireValue(!(sources.has(path) && files.has(path))
      && !(files.has(path) && allPaths[index + 1]?.startsWith(allPaths[index])),
    "conflict", "$", "Directory/file ownership conflict");
  }
  return Object.freeze({ binding: "unbound", version: 1, scope: "global", managedBy: "nix",
    groups: Object.freeze(groups), packages: Object.freeze(packages.map(pkg => Object.freeze({ ...pkg, members: Object.freeze(pkg.members) }))),
    standalone: Object.freeze(standalone) });
}

export type CatalogMetadataReadInput = Readonly<{ status: "unconfigured" }> | Readonly<{
  status: "configured";
  /** ALREADY ADMITTED by the caller, including symlink/target authority. This
   * module does not derive this path from agentDir or discover any settings. */
  path: string;
  context: Readonly<Pick<SelectionContext, "agentDir">>;
}>;
export type CatalogMetadataReadResult = Readonly<{ status: "unconfigured" }> | Readonly<{
  status: "loaded";
  catalog: UnboundCatalogMetadata;
  generation: Readonly<{ path: string; agentDir: string; token: string }>;
}>;
function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(":");
}
function observe(path: string) {
  const link = lstatSync(path, { bigint: true }), target = statSync(path, { bigint: true });
  requireValue((link.isFile() || link.isSymbolicLink()) && target.isFile(), "read", "$", "Configured metadata must resolve to a regular file");
  return { link: identity(link), target: identity(target), resolved: realpathSync(path), size: target.size };
}
/** Bounded synchronous read of ONLY the admitted metadata file. Read-only Nix
 * symlinks are supported here, not in any mutable preference-store policy.
 * Before/after path + descriptor identity fence the observed generation. This
 * is not a lock, an ABA-proof filesystem transaction or a native-source snapshot;
 * W04b must independently bind/revalidate sources before admission. */
export function readCatalogMetadata(input: CatalogMetadataReadInput): CatalogMetadataReadResult {
  if (input.status === "unconfigured") return Object.freeze({ status: "unconfigured" });
  requireValue(input.status === "configured" && process.platform !== "win32", "path", "$", "Only the POSIX local metadata pilot is supported");
  const path = absolutePath(input.path, true, "configured path"), agentDir = absolutePath(input.context.agentDir, false, "admitted agentDir");
  let fd: number | undefined;
  try {
    const before = observe(path);
    requireValue(before.size <= BigInt(CATALOG_METADATA_MAX_BYTES), "limit", "$", "Metadata byte limit exceeded");
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const opened = fstatSync(fd, { bigint: true });
    requireValue(opened.isFile() && identity(opened) === before.target, "generation", "$", "Configured generation changed before open");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    requireValue(length === Number(before.size), "generation", "$", "Metadata length changed during read");
    const catalog = parseCatalogMetadata(bytes.subarray(0, length));
    const after = observe(path), closedGeneration = identity(fstatSync(fd, { bigint: true }));
    requireValue(before.link === after.link && before.target === after.target && before.resolved === after.resolved && before.target === closedGeneration,
      "generation", "$", "Configured metadata generation changed during read");
    const token = createHash("sha256").update(JSON.stringify([path, agentDir, before.link, before.target, before.resolved])).update(bytes.subarray(0, length)).digest("hex");
    return Object.freeze({ status: "loaded", catalog, generation: Object.freeze({ path, agentDir, token }) });
  } catch (error) {
    if (error instanceof CatalogMetadataError) throw error;
    throw new CatalogMetadataError("read", "$", "Configured metadata is missing, broken or unreadable");
  } finally { if (fd !== undefined) closeSync(fd); }
}
