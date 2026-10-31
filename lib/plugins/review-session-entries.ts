import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { resolveSessionPath } from "../session-reader";
import type { SessionEntry } from "../types";

/** Review-only persisted reader. Never opens an SDK manager (which can migrate
 * files), starts a wrapper, or persists a catalogue scan. Unsupported pre-tree
 * versions cannot establish exact ancestry and fail closed, byte-identically. */
export async function readPersistedReviewEntries(sessionId: string, signal?: AbortSignal): Promise<SessionEntry[] | null> {
  const path = await resolveSessionPath(sessionId, { allowCatalogueScan: false });
  if (!path) return null;
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const initial = await file.stat({ bigint: true });
    if (!initial.isFile()) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let pending = "", position = 0, header = false;
    const entries: SessionEntry[] = [], ids = new Set<string>();
    const line = (text: string) => {
      if (!text.trim()) return;
      const value = JSON.parse(text);
      if (!header) {
        if (value?.type !== "session" || value.id !== sessionId || ![2, 3].includes(value.version)) throw new Error("Unsupported review session owner");
        header = true; return;
      }
      if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id || ids.has(value.id)
        || !(value.parentId === null || typeof value.parentId === "string") || typeof value.type !== "string" || value.type === "session") throw new Error("Invalid review ancestry");
      ids.add(value.id); entries.push(value);
    };
    const buffer = Buffer.alloc(65536);
    while (BigInt(position) < initial.size) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, Number(initial.size - BigInt(position))), position);
      if (!bytesRead) throw new Error("Review owner changed during read");
      position += bytesRead; pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      // Physical LF/CR only, not Unicode line separators inside JSON strings.
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) { line(pending.slice(0, end)); pending = pending.slice(end + 1); }
    }
    pending += decoder.decode();
    if (pending.trim()) line(pending); // Valid unterminated record; torn data refuses.
    signal?.throwIfAborted();
    const after = await file.stat({ bigint: true }), current = await stat(path, { bigint: true });
    if (after.dev !== current.dev || after.ino !== current.ino) return null;
    if (!header || ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(key => initial[key as keyof typeof initial] !== after[key as keyof typeof after])) return null;
    return entries;
  } finally { await file.close(); }
}
