import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { migrateSessionEntries, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";

/** Source inspection never constructs a persistent SDK manager (open can migrate files). */
export async function readBtwSource(path: string, id: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size === BigInt(0) || before.size > BigInt(256 * 1024 * 1024)) throw new Error("Source session is unavailable or too large");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("Source session changed during read");
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true }), current = await stat(path, { bigint: true });
    if (after.dev !== current.dev || after.ino !== current.ino
      || ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(key => before[key as keyof typeof before] !== after[key as keyof typeof after])) throw new Error("Source session changed during read");
    const parsed = parseSessionEntries(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const header = parsed[0];
    if (header?.type !== "session" || header.id !== id || typeof header.cwd !== "string" || ![1, 2, 3].includes(header.version ?? 1)) throw new Error("Source session identity changed");
    // v1 migration creates random IDs, so it cannot establish a durable reference anchor.
    if ((header.version ?? 1) < 2) throw new Error("Source session needs an explicit ordinary reopen to upgrade before BTW can capture a stable reference");
    // Supported tree-format conversion is memory-only. No append, flush, navigate or SDK open.
    migrateSessionEntries(parsed);
    const entries = parsed.filter(entry => entry.type !== "session") as unknown as SessionEntry[];
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    if (byId.size !== entries.length || entries.some(entry => !entry.id)) throw new Error("Invalid source ancestry");
    const leafId = entries.at(-1)?.id ?? null;
    return {
      getSessionId: () => id,
      getCwd: () => header.cwd,
      getSessionDir: () => dirname(path),
      getSessionFile: () => path,
      getEntries: () => entries,
      getLeafId: () => leafId,
      getEntry: (entryId: string) => byId.get(entryId),
      getBranch: (anchor: string | null = leafId) => {
        const branch: SessionEntry[] = [], seen = new Set<string>();
        let next = anchor;
        while (next !== null) {
          const entry = byId.get(next);
          if (!entry || seen.has(next)) throw new Error("Invalid source ancestry");
          seen.add(next); branch.push(entry); next = entry.parentId;
        }
        return branch.reverse();
      },
    };
  } finally { await file.close(); }
}
