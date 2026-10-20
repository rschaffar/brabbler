import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { migrateSessionEntries, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { computeSessionStats, type SessionUsageSummary } from "./session-stats";
import { computeSessionTotalActiveMs } from "./session-timing";
import type { SessionEntry } from "./types";

// Summaries only: never retain transcripts or construct a persistent SessionManager.
const summaries = new Map<string, { fingerprint: string; summary: SessionUsageSummary }>();
const MAX_CACHED_SUMMARIES = 64;
export const MAX_USAGE_FILE_BYTES = 256 * 1024 * 1024;

/** SDK parsing/migration happens only in memory, including legacy/no-final-newline files. */
export async function readDiskSessionUsage(path: string, id: string): Promise<SessionUsageSummary | null> {
  // NONBLOCK avoids hanging on a concurrently substituted FIFO; fstat admits only regular files.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size === 0 || before.size > MAX_USAGE_FILE_BYTES) return null;
    const fingerprintOf = (stat: typeof before) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const fingerprint = fingerprintOf(before);
    const key = JSON.stringify([path, id]);
    const cached = summaries.get(key);
    if (cached?.fingerprint === fingerprint) {
      summaries.delete(key); summaries.set(key, cached);
      return cached.summary;
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    // Never combine an earlier prefix with a newer fingerprint or loop on an active writer.
    if (fingerprintOf(await file.stat()) !== fingerprint) return null;
    const parsed = parseSessionEntries(bytes.toString("utf8")).filter(entry => entry && typeof entry === "object" && !Array.isArray(entry));
    const header = parsed[0];
    if (header?.type !== "session" || header.id !== id) return null;
    migrateSessionEntries(parsed);
    const entries = parsed.filter(entry => entry.type !== "session") as unknown as SessionEntry[];
    const stats = computeSessionStats(entries);
    const summary = { tokens: stats.tokens, cost: stats.cost, toolCalls: stats.toolCalls, totalActiveMs: computeSessionTotalActiveMs(entries) };
    summaries.delete(key); summaries.set(key, { fingerprint, summary });
    while (summaries.size > MAX_CACHED_SUMMARIES) summaries.delete(summaries.keys().next().value!);
    return summary;
  } finally { await file.close(); }
}
