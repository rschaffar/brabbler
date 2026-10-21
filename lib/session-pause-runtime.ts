import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession, getRpcSessionInfos, getRunningRpcSessionIds, getRpcSessionAttention, getSubagentRun, startRpcSession, waitForSessionAccountSwitch } from "./rpc-manager";
import { getQueuedSubagentSessionIds, cancelQueuedSubagentForPause } from "./subagent-runtime";
import { listAllSessions, resolveSessionPath } from "./session-reader";
import { changeSessionPause, readSessionPauses, removeSessionPause, requestSessionPause, sessionResumeMessage, type SessionPauseSnapshot } from "./session-pause";
import type { SessionInfo, SessionEntry } from "./types";

declare global {
  var __piPauseOperation: Promise<unknown> | undefined;
  var __piResumeOperations: Map<string, { pauseId: string; promise: Promise<void> }> | undefined;
}
/** Serialize control admission, not running tools; survives module reload. */
export async function runPauseOperation<T>(action: () => Promise<T>): Promise<T> {
  const previous = globalThis.__piPauseOperation;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  globalThis.__piPauseOperation = current;
  await previous?.catch(() => {});
  try { return await action(); }
  finally { release(); if (globalThis.__piPauseOperation === current) globalThis.__piPauseOperation = undefined; }
}

export function getSessionPauseSnapshot(): SessionPauseSnapshot[] {
  return readSessionPauses().map((row) => ({ id: row.id, sessionId: row.sessionId, parentSessionId: row.parentSessionId,
    state: getRpcSession(row.sessionId)?.getPauseError() ? "pausing" : row.state, requestedAt: row.requestedAt, pausedAt: row.pausedAt, error: row.error ?? getRpcSession(row.sessionId)?.getPauseError(),
    ...((row.state === "pausing" || row.state === "resuming") && !getRpcSession(row.sessionId)?.isRunning() && !getRpcSession(row.sessionId)?.hasQueuedPauseInput() && !getRpcSession(row.sessionId)?.getPauseError() && !getQueuedSubagentSessionIds().includes(row.sessionId)
      && globalThis.__piResumeOperations?.get(row.sessionId)?.pauseId !== row.id
      ? { interrupted: true } : {}),
  }));
}

function parentOf(session: SessionInfo | undefined): string | undefined {
  return session?.relation?.kind === "subagent" ? session.relation.parentSessionId : undefined;
}
async function catalogue() {
  const sessions = new Map((await listAllSessions()).map((row) => [row.id, row]));
  for (const row of getRpcSessionInfos()) sessions.set(row.id, row);
  return sessions;
}
function descendants(ids: Set<string>, sessions: ReadonlyMap<string, SessionInfo>): Set<string> {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of sessions.values()) if (!result.has(row.id) && result.has(parentOf(row) ?? "")) { result.add(row.id); changed = true; }
  }
  return result;
}

export async function pauseManagedSessions(sessionId?: string): Promise<{ errors: string[] }> {
  const sessions = await catalogue();
  const queued = new Set(getQueuedSubagentSessionIds());
  const active = new Set([...getRunningRpcSessionIds(), ...queued, ...getRpcSessionAttention().map((row) => row.sessionId),
    ...(globalThis.__piResumeOperations?.keys() ?? [])]);
  const selected = sessionId ? new Set([sessionId]) : new Set(active);
  if (sessionId && !sessions.has(sessionId)) throw new Error("Session not found");
  if (!sessionId) {
    // An idle main session still needs Resume when its background children pause.
    for (const id of active) {
      const visited = new Set<string>();
      let parent = parentOf(sessions.get(id));
      while (parent && !visited.has(parent)) { visited.add(parent); selected.add(parent); parent = parentOf(sessions.get(parent)); }
    }
  }
  const targets = [...descendants(selected, sessions)].filter((id) => selected.has(id) || active.has(id));
  const errors: string[] = [];
  const accepted = new Set<string>();
  // Publish all intent before cancelling a child wait or yielding to any writer.
  for (const id of targets) {
    try {
      const wrapper = getRpcSession(id);
      if (wrapper?.isAlive()) {
        wrapper.requestPause(parentOf(sessions.get(id)));
        accepted.add(id);
      } else {
        const row = requestSessionPause(id, parentOf(sessions.get(id)));
        if (row?.state === "pausing") changeSessionPause(id, row.id, (item) => { item.state = "paused"; item.pausedAt = Date.now(); });
      }
    } catch (error) { errors.push(`${id}: ${String(error)}`); }
  }
  for (const id of targets.filter((id) => queued.has(id) && accepted.has(id))) {
    try { await cancelQueuedSubagentForPause(id); }
    catch (error) { errors.push(`${id}: ${String(error)}`); }
  }
  return { errors };
}

export async function resumeManagedSession(sessionId: string, pauseId: string): Promise<void> {
  const operations = globalThis.__piResumeOperations ??= new Map();
  const current = operations.get(sessionId);
  if (current) {
    if (current.pauseId !== pauseId) throw new Error("The previous Resume is still settling");
    return current.promise;
  }
  const promise = resumeManagedSessionInternal(sessionId, pauseId).finally(() => {
    if (operations.get(sessionId)?.promise === promise) operations.delete(sessionId);
  });
  operations.set(sessionId, { pauseId, promise });
  return promise;
}

async function resumeManagedSessionInternal(sessionId: string, pauseId: string): Promise<void> {
  const records = readSessionPauses();
  const root = records.find((row) => row.sessionId === sessionId);
  if (root?.parentSessionId) throw new Error("Resume is only available on the main session");
  if (root && root.id !== pauseId) throw new Error("Pause changed; refresh Activity");
  const resumeId = root?.resumeId ?? randomUUID();
  // Publish a supersedable claim before catalogue/account/resource awaits.
  if (root) changeSessionPause(sessionId, root.id, (row) => { row.state = "resuming"; row.resumeId = resumeId; });
  const sessions = await catalogue();
  if (parentOf(sessions.get(sessionId))) throw new Error("Resume is only available on the main session");
  if (!root) return; // A lost successful response must not send another prompt.
  const familyIds = descendants(new Set([sessionId]), sessions);
  // Retain relations even when an old catalogue row was removed/filtered.
  let grew = true;
  while (grew) { grew = false; for (const row of records) if (row.parentSessionId && familyIds.has(row.parentSessionId) && !familyIds.has(row.sessionId)) { familyIds.add(row.sessionId); grew = true; } }
  const family = records.filter((row) => familyIds.has(row.sessionId));
  const busy = new Set([...getRunningRpcSessionIds(), ...getQueuedSubagentSessionIds()]);
  if ([...familyIds].some((id) => busy.has(id) || getRpcSession(id)?.hasQueuedPauseInput())) throw new Error("The session family is still pausing; wait for its tools to finish");
  await waitForSessionAccountSwitch(sessionId);
  const path = await resolveSessionPath(sessionId);
  if (!path) throw new Error("Session file not found");
  const manager = getRpcSession(sessionId)?.inner.sessionManager ?? SessionManager.open(path);
  if (root.leafId && !manager.getBranch().some((entry) => entry.id === root.leafId)) throw new Error("The active conversation branch changed after Pause; return to the paused branch before Resume");
  const marker = root.resumeId ? `[Pi Web resume ${root.resumeId}]` : undefined;
  const alreadySent = marker && (manager.getBranch() as unknown as SessionEntry[]).some((entry) => entry.type === "message" && entry.message.role === "user"
    && (typeof entry.message.content === "string" ? entry.message.content.startsWith(marker) : Array.isArray(entry.message.content) && entry.message.content.some((part) => part.type === "text" && part.text.startsWith(marker))));
  if (!alreadySent) {
    const children = await Promise.all(family.filter((row) => row.sessionId !== sessionId).map(async (pause) => {
      const run = await getSubagentRun(pause.sessionId);
      return { pause, description: run?.description, task: run?.task, result: run?.result, worktreePath: run?.worktreePath, worktreeExists: run?.worktreeExists };
    }));
    changeSessionPause(sessionId, root.id, (row) => {
      if (row.state !== "resuming" || row.resumeId !== resumeId) throw new Error("Resume was superseded before dispatch");
    });
    const { session } = await startRpcSession(sessionId, path, undefined);
    await session.resumeFromPause(sessionResumeMessage({ ...root, resumeId }, children), root.id);
  }
  const current = readSessionPauses().find((row) => row.sessionId === sessionId);
  if (current?.id !== root.id || current.state !== "resuming") throw new Error("Resume was superseded; pause information was retained");
  getRpcSession(sessionId)?.clearPause(root.id);
  for (const row of family) removeSessionPause(row.sessionId, row.id);
}

export async function resumeAllManagedSessions(): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  await Promise.all(readSessionPauses().filter((item) => !item.parentSessionId).map(async (row) => {
    try { await resumeManagedSession(row.sessionId, row.id); }
    catch (error) { errors.push(`${row.sessionId}: ${String(error)}`); }
  }));
  return { errors };
}
