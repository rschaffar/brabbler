import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PluginReviewReference, PluginReviewWriter } from "./types";
import { isOperationId } from "./ui";

export const REVIEW_PAGE_SIZE = 40;
export const REVIEW_PREVIEW_BYTES = 256 * 1024;
export interface ReviewEntry { id: number; label: string; kind: "text" | "patch"; start: number; bytes: number; sha256: string }
interface Manifest { version: 1; pluginId: string; operationId: string; entries: number; bytes: number; sha256: string }
const root = () => join(getAgentDir(), "brabbler", "reviews");
function directory(id: string) {
  if (!isOperationId(id)) throw new Error("Invalid review identity");
  return join(root(), id);
}
async function writeAll(file: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.length) { const result = await file.write(bytes, offset); if (!result.bytesWritten) throw new Error("Review write did not advance"); offset += result.bytesWritten; }
}
async function readExact(file: FileHandle, length: number, position: number) {
  const bytes = Buffer.alloc(length); let offset = 0;
  while (offset < length) { const result = await file.read(bytes, offset, length - offset, position + offset); if (!result.bytesRead) throw new Error("Incomplete review attachment"); offset += result.bytesRead; }
  return bytes;
}
async function readOnly(path: string) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { if (!(await file.stat()).isFile()) throw new Error("Invalid review file"); return file; }
  catch (error) { await file.close(); throw error; }
}

/** Host-owned immutable storage. No TTL/automatic GC: references can survive moves,
 * forks and deletion of the original session or checkout. Failed unpublished work
 * is removed; successfully published bundles are retained, including orphans. */
export async function preparePluginReview(pluginId: string, operationId: string,
  build: (writer: PluginReviewWriter) => Promise<void>): Promise<PluginReviewReference> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId) || !isOperationId(operationId)) throw new Error("Invalid review owner");
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const id = randomUUID(); const staging = join(root(), `.${id}.pending`);
  await mkdir(staging, { mode: 0o700 });
  const files: FileHandle[] = [];
  try {
    for (const name of ["data", "entries", "offsets"]) files.push(await open(join(staging, name), "wx", 0o600));
    const [data, entries, offsets] = files;
    let bytes = 0, count = 0, metadataOffset = 0;
    const hash = createHash("sha256"), metadataHash = createHash("sha256"), offsetsHash = createHash("sha256");
    let current: { label: string; kind: "text" | "patch"; start: number; hash: ReturnType<typeof createHash> } | undefined;
    const writer: PluginReviewWriter = {
      async begin(label, kind) {
        if (current) throw new Error("Review entry not closed");
        if (!label || label.length > 16384 || !["text", "patch"].includes(kind)) throw new Error("Invalid review entry label/type");
        current = { label, kind, start: bytes, hash: createHash("sha256") };
      },
      async write(chunk) {
        if (!current) throw new Error("Review entry not opened");
        if (!Number.isSafeInteger(bytes + chunk.byteLength)) throw new Error("Review exceeds addressable storage");
        await writeAll(data, chunk); current.hash.update(chunk); hash.update(chunk); bytes += chunk.byteLength;
      },
      async end() {
        if (!current) throw new Error("Review entry not opened");
        const entry: ReviewEntry = { id: count++, label: current.label, kind: current.kind, start: current.start, bytes: bytes - current.start, sha256: current.hash.digest("hex") };
        const encoded = Buffer.from(JSON.stringify(entry) + "\n");
        const offset = Buffer.alloc(8); offset.writeBigUInt64BE(BigInt(metadataOffset));
        await writeAll(offsets, offset); offsetsHash.update(offset); await writeAll(entries, encoded); metadataHash.update(encoded); metadataOffset += encoded.length; current = undefined;
      },
    };
    await build(writer);
    if (current) throw new Error("Review entry not closed");
    const sha256 = createHash("sha256").update(JSON.stringify([hash.digest("hex"), metadataHash.digest("hex"), offsetsHash.digest("hex")])).digest("hex");
    const manifest: Manifest = { version: 1, pluginId, operationId, entries: count, bytes, sha256 };
    const meta = await open(join(staging, "manifest.json"), "wx", 0o600); files.push(meta);
    await writeAll(meta, Buffer.from(JSON.stringify(manifest)));
    for (const file of files) await file.sync();
    for (const file of files.splice(0)) await file.close();
    if (process.platform !== "win32") { const dir = await open(staging, "r"); try { await dir.sync(); } finally { await dir.close(); } }
    await rename(staging, directory(id));
    if (process.platform !== "win32") { const parent = await open(root(), "r"); try { await parent.sync(); } finally { await parent.close(); } }
    return { version: 1, id, operationId, sha256, entries: count, bytes };
  } catch (error) {
    for (const file of files) await file.close().catch(() => {});
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
export async function reviewManifest(ref: PluginReviewReference, pluginId: string): Promise<Manifest> {
  const file = await readOnly(join(directory(ref.id), "manifest.json"));
  try {
    if ((await file.stat()).size > 4096) throw new Error("Invalid review manifest");
    const manifest = JSON.parse(await file.readFile("utf8")) as Manifest;
    if (manifest.version !== 1 || manifest.pluginId !== pluginId || manifest.operationId !== ref.operationId
      || manifest.sha256 !== ref.sha256 || manifest.entries !== ref.entries || manifest.bytes !== ref.bytes) throw new Error("Review reference mismatch");
    await verifyReview(ref);
    return manifest;
  } finally { await file.close(); }
}
const verified = new Map<string, string>();
/** Verify bytes and index together before serving exact material. The bounded
 * cache retains only stat identities, never content; any observed change rehashes. */
async function verifyReview(ref: PluginReviewReference) {
  const handles: FileHandle[] = [];
  try {
    for (const name of ["data", "entries", "offsets"]) handles.push(await readOnly(join(directory(ref.id), name)));
    const stats = await Promise.all(handles.map((file) => file.stat({ bigint: true })));
    const signature = JSON.stringify(stats.map((s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String)));
    if (stats[0].size !== BigInt(ref.bytes) || stats[2].size !== BigInt(ref.entries) * BigInt(8)) throw new Error("Incomplete review attachment");
    const key = `${ref.id}:${ref.sha256}`;
    if (verified.get(key) === signature) return;
    const hashes: string[] = [];
    for (const file of handles) {
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let position = 0;
      for (;;) { const { bytesRead } = await file.read(buffer, 0, buffer.length, position); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); position += bytesRead; }
      hashes.push(hash.digest("hex"));
    }
    const after = await Promise.all(handles.map((file) => file.stat({ bigint: true })));
    if (JSON.stringify(after.map((s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String))) !== signature
      || createHash("sha256").update(JSON.stringify(hashes)).digest("hex") !== ref.sha256) throw new Error("Review content integrity failure");
    while (verified.size >= 64) verified.delete(verified.keys().next().value!);
    verified.set(key, signature);
  } finally { for (const file of handles) await file.close(); }
}
export async function reviewEntry(ref: PluginReviewReference, id: number): Promise<ReviewEntry> {
  if (!Number.isSafeInteger(id) || id < 0 || id >= ref.entries) throw new Error("Invalid review entry");
  const offsets = await readOnly(join(directory(ref.id), "offsets"));
  let entries: FileHandle | undefined;
  try {
    entries = await readOnly(join(directory(ref.id), "entries"));
    const start = Number((await readExact(offsets, 8, id * 8)).readBigUInt64BE());
    const end = id + 1 < ref.entries ? Number((await readExact(offsets, 8, (id + 1) * 8)).readBigUInt64BE()) : (await entries.stat()).size;
    if (!Number.isSafeInteger(start) || end < start || end - start > 128 * 1024) throw new Error("Invalid review index");
    const entry = JSON.parse((await readExact(entries, end - start, start)).toString("utf8")) as ReviewEntry;
    if (entry.id !== id || !["text", "patch"].includes(entry.kind) || typeof entry.label !== "string"
      || !Number.isSafeInteger(entry.start) || entry.start < 0 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || entry.start + entry.bytes > ref.bytes || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid review entry");
    return entry;
  } finally { await offsets.close(); await entries?.close(); }
}
export async function reviewPage(ref: PluginReviewReference, start: number) {
  if (!Number.isSafeInteger(start) || start < 0 || start > ref.entries) throw new Error("Invalid review page");
  const entries: ReviewEntry[] = [];
  for (let id = start; id < Math.min(start + REVIEW_PAGE_SIZE, ref.entries); id++) entries.push(await reviewEntry(ref, id));
  return { entries, total: ref.entries, next: start + entries.length < ref.entries ? start + entries.length : null };
}
export async function reviewPreview(ref: PluginReviewReference, entry: ReviewEntry, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.bytes) throw new Error("Invalid review offset");
  const file = await readOnly(join(directory(ref.id), "data"));
  try {
    const bytes = await readExact(file, Math.min(REVIEW_PREVIEW_BYTES, entry.bytes - offset), entry.start + offset);
    if (offset === 0 && bytes.length === entry.bytes && createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Review content integrity failure");
    return { text: bytes.toString("utf8"), offset, next: offset + bytes.length < entry.bytes ? offset + bytes.length : null, complete: offset === 0 && bytes.length === entry.bytes };
  } finally { await file.close(); }
}
/** Stream from a no-follow descriptor; never return a private filesystem path. */
export async function reviewStream(ref: PluginReviewReference, entry?: ReviewEntry) {
  const file = await readOnly(join(directory(ref.id), "data"));
  const start = entry?.start ?? 0, length = entry?.bytes ?? ref.bytes;
  if (!length) { await file.close(); return null; }
  return file.createReadStream({ autoClose: true, start, end: start + length - 1 });
}
