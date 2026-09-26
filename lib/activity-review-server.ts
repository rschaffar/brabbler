import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { SessionCompletion } from "./types";

const MAX_COMPLETIONS = 1000;
const MAX_SESSION_ID_LENGTH = 256;

export class ActivityReviewConflict extends Error {}

export interface ActivityReviewSnapshot {
  completedRuns: SessionCompletion[];
  reviewedRuns: SessionCompletion[];
}

export function activityReviewPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "activity-review.json");
}

export function validActivityCompletion(value: unknown): value is SessionCompletion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as { sessionId?: unknown; at?: unknown };
  return typeof entry.sessionId === "string" && entry.sessionId.length > 0
    && entry.sessionId.length <= MAX_SESSION_ID_LENGTH && typeof entry.at === "number"
    && Number.isSafeInteger(entry.at) && entry.at > 0;
}

function readSnapshot(path: string): ActivityReviewSnapshot {
  if (!existsSync(path)) return { completedRuns: [], reviewedRuns: [] };
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid activity review file");
  const data = raw as { version?: unknown; completedRuns?: unknown; reviewedRuns?: unknown };
  if (data.version !== 1 || !Array.isArray(data.completedRuns) || !Array.isArray(data.reviewedRuns)
    || data.completedRuns.length > MAX_COMPLETIONS || data.reviewedRuns.length > MAX_COMPLETIONS
    || !data.completedRuns.every(validActivityCompletion) || !data.reviewedRuns.every(validActivityCompletion)) {
    throw new Error("Invalid activity review file");
  }
  const completions = new Map<string, number>();
  const reviewed = new Map<string, number>();
  for (const entry of data.completedRuns as SessionCompletion[]) {
    if (completions.has(entry.sessionId)) throw new Error("Duplicate activity completion");
    completions.set(entry.sessionId, entry.at);
  }
  for (const entry of data.reviewedRuns as SessionCompletion[]) {
    if (reviewed.has(entry.sessionId) || !completions.has(entry.sessionId)
      || entry.at > completions.get(entry.sessionId)!) throw new Error("Invalid activity acknowledgement");
    reviewed.set(entry.sessionId, entry.at);
  }
  return { completedRuns: [...completions].map(([sessionId, at]) => ({ sessionId, at })),
    reviewedRuns: [...reviewed].map(([sessionId, at]) => ({ sessionId, at })) };
}

export function readActivityReview(path = activityReviewPath()): ActivityReviewSnapshot {
  return readSnapshot(path);
}

/** Lock a stable pathname, not the replaced inode; readers use atomic snapshots. */
function updateSnapshot(change: (snapshot: ActivityReviewSnapshot) => void, path: string): ActivityReviewSnapshot {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const wait = new Int32Array(new SharedArrayBuffer(4));
  let release: (() => void) | undefined;
  for (let attempt = 0; attempt < 11; attempt++) {
    try {
      release = lockfile.lockSync(path, { realpath: false, stale: 30_000 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt === 10) throw error;
      Atomics.wait(wait, 0, 0, 50);
    }
  }
  try {
    const snapshot = readSnapshot(path);
    change(snapshot);
    writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, ...snapshot }, null, 2));
    return snapshot;
  } finally {
    release?.();
  }
}

/** The server clock can move backwards, so a later run must still outrank its prior receipt. */
export function recordActivityCompletion(sessionId: string, path = activityReviewPath(), now = Date.now()): SessionCompletion {
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error("Invalid session ID");
  }
  let completion: SessionCompletion | undefined;
  updateSnapshot((snapshot) => {
    const previous = snapshot.completedRuns.find((entry) => entry.sessionId === sessionId)?.at ?? 0;
    const reviewed = snapshot.reviewedRuns.find((entry) => entry.sessionId === sessionId)?.at ?? 0;
    const at = Math.max(now, previous + 1, reviewed + 1);
    if (!Number.isSafeInteger(at) || at <= 0) throw new Error("Invalid completion timestamp");
    completion = { sessionId, at };
    snapshot.completedRuns = [...snapshot.completedRuns.filter((entry) => entry.sessionId !== sessionId), completion];
    if (snapshot.completedRuns.length > MAX_COMPLETIONS) {
      const evicted = snapshot.completedRuns.shift()!;
      snapshot.reviewedRuns = snapshot.reviewedRuns.filter((entry) => entry.sessionId !== evicted.sessionId);
    }
  }, path);
  return completion!;
}

/** POST only the exact completion observed by the client, never a replacement map. */
export function acknowledgeActivityCompletions(
  entries: readonly SessionCompletion[], path = activityReviewPath(), legacy = false,
): ActivityReviewSnapshot {
  if (entries.length > MAX_COMPLETIONS || !entries.every(validActivityCompletion)) {
    throw new Error("Invalid activity acknowledgements");
  }
  return updateSnapshot((snapshot) => {
    const completed = new Map(snapshot.completedRuns.map(({ sessionId, at }) => [sessionId, at]));
    const reviewed = new Map(snapshot.reviewedRuns.map(({ sessionId, at }) => [sessionId, at]));
    for (const { sessionId, at } of entries) {
      const latest = completed.get(sessionId);
      if (!latest) {
        if (!legacy) throw new ActivityReviewConflict("Unknown activity completion");
        continue;
      }
      if (at > latest) {
        if (!legacy) throw new ActivityReviewConflict("Future activity acknowledgement");
        continue;
      }
      reviewed.set(sessionId, Math.max(reviewed.get(sessionId) ?? 0, at));
    }
    snapshot.reviewedRuns = [...reviewed].map(([sessionId, at]) => ({ sessionId, at }));
  }, path);
}
