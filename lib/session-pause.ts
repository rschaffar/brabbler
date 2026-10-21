import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface SessionPause {
  id: string;
  sessionId: string;
  parentSessionId?: string;
  state: "pausing" | "paused" | "resuming";
  requestedAt: number;
  pausedAt?: number;
  leafId?: string;
  error?: string;
  waiting: string[];
  resumeId?: string;
}
export type SessionPauseSnapshot = Omit<SessionPause, "waiting" | "resumeId"> & { interrupted?: boolean };
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
export const sessionPausePath = () => join(getAgentDir(), "pi-web", "session-pauses.json");

export function readSessionPauses(path = sessionPausePath()): SessionPause[] {
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.version !== 1 || !Array.isArray(value.sessions) || value.sessions.some((row: SessionPause) =>
    !row || !validId(row.id) || !validId(row.sessionId) || (row.parentSessionId !== undefined && !validId(row.parentSessionId))
    || !["pausing", "paused", "resuming"].includes(row.state) || !Number.isSafeInteger(row.requestedAt) || row.requestedAt <= 0
    || (row.pausedAt !== undefined && (!Number.isSafeInteger(row.pausedAt) || row.pausedAt <= 0))
    || (row.error !== undefined && (typeof row.error !== "string" || row.error.length > 1000))
    || (row.leafId !== undefined && !validId(row.leafId))
    || !Array.isArray(row.waiting) || row.waiting.some((text) => typeof text !== "string")
    || (row.resumeId !== undefined && !validId(row.resumeId)))) throw new Error("Invalid session pause store");
  if (new Set(value.sessions.map((row: SessionPause) => row.sessionId)).size !== value.sessions.length) throw new Error("Duplicate session pause");
  return value.sessions;
}

/** Stable-path lock and atomic replacement; never overwrite an unreadable store. */
function update(change: (rows: SessionPause[]) => void, path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let release: (() => void) | undefined;
  for (let attempt = 0; ; attempt++) {
    try { release = lockfile.lockSync(path, { realpath: false, stale: 30_000 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt >= 10) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const rows = readSessionPauses(path);
    change(rows);
    writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, sessions: rows }));
  } finally { release?.(); }
}

export function requestSessionPause(sessionId: string, parentSessionId?: string, path = sessionPausePath()): SessionPause {
  if (!validId(sessionId) || (parentSessionId !== undefined && !validId(parentSessionId))) throw new Error("Invalid pause session ID");
  let result!: SessionPause;
  update((rows) => {
    result = rows.find((row) => row.sessionId === sessionId)!;
    if (result) {
      if (result.state === "resuming") {
        result.id = randomUUID(); result.state = "pausing"; result.requestedAt = Date.now();
        delete result.resumeId; delete result.pausedAt; delete result.leafId;
      }
      return;
    }
    result = { id: randomUUID(), sessionId, ...(parentSessionId ? { parentSessionId } : {}), state: "pausing", requestedAt: Date.now(), waiting: [] };
    rows.push(result);
  }, path);
  return result;
}

export function changeSessionPause(sessionId: string, id: string, change: (row: SessionPause) => void, path = sessionPausePath()): SessionPause {
  let result!: SessionPause;
  update((rows) => {
    const row = rows.find((entry) => entry.sessionId === sessionId && entry.id === id);
    if (!row) throw new Error("Pause changed; refresh Activity before retrying");
    change(row);
    result = row;
  }, path);
  return result;
}

export function removeSessionPause(sessionId: string, id: string, path = sessionPausePath()): void {
  update((rows) => {
    const index = rows.findIndex((row) => row.sessionId === sessionId && row.id === id);
    if (index >= 0) rows.splice(index, 1);
  }, path);
}

export function getSessionPause(sessionId: string): SessionPause | undefined {
  return readSessionPauses().find((row) => row.sessionId === sessionId);
}

/** These are context, never recovered tool calls or approval authority. */
export function sessionResumeMessage(root: SessionPause, children: Array<{ pause: SessionPause; description?: string; task?: string; result?: string; worktreePath?: string; worktreeExists?: boolean }>): string {
  const waiting = (pause: SessionPause) => pause.waiting.length
    ? `\nCancelled waiting cards (context only; ask again and revalidate any operation, never reuse an old approval):\n${pause.waiting.join("\n\n")}` : "";
  return `[Pi Web resume ${root.resumeId}]\nResume work from the saved conversation after the user's pause for a restart. This is a new continuation request, not restoration of an old execution. Review the recorded results and any saved undelivered accepted input before taking the next step; do not blindly replay tools.\n${root.state === "pausing" ? "The previous process stopped before pause settlement was confirmed. Some outcomes may be unknown; inspect them before continuing.\n" : ""}${waiting(root)}\n${children.length ? `\nPaused subsessions (incomplete; not automatically resumed). Their saved sessions and partial output are available for inspection. Decide whether any further delegated work is needed:\n${children.map(({ pause, description, task, result, worktreePath, worktreeExists }) => `\nSession: ${pause.sessionId}${pause.parentSessionId ? ` (parent ${pause.parentSessionId})` : ""}\n${description ? `Description: ${description}\n` : ""}${task ? `Task: ${task}\n` : ""}${worktreePath ? `Recorded working directory${worktreeExists === true ? " (retained at settlement)" : worktreeExists === false ? " (no longer present at settlement)" : " (current existence not verified)"}: ${worktreePath}\n` : ""}${result ? `Partial output:\n${result}\n` : "No final text was recorded; inspect the saved transcript/tool results.\n"}${waiting(pause)}`).join("\n")}` : ""}`;
}
