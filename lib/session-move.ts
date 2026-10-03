import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getRpcSession, getRpcSessionInfos } from "./rpc-manager";
import {
  cacheSessionPath, invalidateSessionListCache, invalidateSessionManagerCache,
  listAllSessions, mergeSessionLists, readSessionHeader, resolveSessionPath,
} from "./session-reader";
import { sessionPathKey } from "./session-path";
import { SUBAGENT_META_TYPE } from "./subagents";
import { getQueuedSubagentSessionIds } from "./subagent-runtime";
import { withGitWorkflowSettingsLock } from "./git-workflow-settings-store";
import { retireGitTaskBinding } from "./git-workflow-binding-store";
import { advanceGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import type { SessionInfo } from "./types";
import { beginGitWorkspacePlacement } from "./git-workspace-usage";

export class SessionMoveConflict extends Error {}

declare global {
  var __piSessionMoveLock: Promise<void> | undefined;
}

type SessionFile = { id: string; source: string; target: string; rewritten: string; fingerprint: string };

function fingerprint(path: string): string {
  const stat = statSync(path);
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

function rewriteFile(content: string, cwd: string | null, relocated: Map<string, string>): string {
  const lines = content.split("\n");
  const header = JSON.parse(lines[0]) as { type?: string; cwd?: string; parentSession?: string };
  if (header.type !== "session") throw new SessionMoveConflict("Invalid session header");
  if (cwd) header.cwd = cwd;
  if (header.parentSession) header.parentSession = relocated.get(sessionPathKey(header.parentSession)) ?? header.parentSession;
  lines[0] = JSON.stringify(header);
  // Subagent metadata duplicates its parent's path. Update only that field;
  // the parent id and historical tool/resource entries must remain unchanged.
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].includes(SUBAGENT_META_TYPE)) continue;
    let entry: { type?: string; customType?: string; data?: { parentSessionPath?: string } };
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type !== "custom" || entry.customType !== SUBAGENT_META_TYPE || !entry.data?.parentSessionPath) continue;
    const newPath = relocated.get(sessionPathKey(entry.data.parentSessionPath));
    if (newPath) {
      entry.data.parentSessionPath = newPath;
      lines[i] = JSON.stringify(entry);
    }
  }
  return lines.join("\n");
}

/** Serialize Pi Web relocations so overlapping families cannot stage stale copies. */
export async function moveSessionFamily(id: string, cwd: string): Promise<{ movedIds: string[] }> {
  // Mark the destination before waiting for the family/settings locks. A
  // queued move is already an in-flight placement, not an idle checkout.
  let finishPlacement: () => void;
  try { finishPlacement = beginGitWorkspacePlacement(cwd); }
  catch { throw new SessionMoveConflict("Workspace cleanup blocks session relocation"); }
  const previous = globalThis.__piSessionMoveLock ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => turn);
  globalThis.__piSessionMoveLock = current;
  try {
    await previous;
    return await withGitWorkflowSettingsLock(getAgentDir(), () => moveSessionFamilyUnlocked(id, cwd));
  } finally {
    finishPlacement();
    release();
    if (globalThis.__piSessionMoveLock === current) globalThis.__piSessionMoveLock = undefined;
  }
}

/** Move a persisted session family; forks are independent but their origin paths must be repaired. */
async function moveSessionFamilyUnlocked(id: string, cwd: string): Promise<{ movedIds: string[] }> {
  const sessions = mergeSessionLists(await listAllSessions({ force: true }), getRpcSessionInfos({ includeTransient: true }));
  const byId = new Map<string, SessionInfo>(sessions.map((session) => [session.id, session]));
  const root = byId.get(id);
  const source = await resolveSessionPath(id);
  if (!root || !source || !existsSync(source)) throw new SessionMoveConflict("Session is not persisted");

  const children = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.relation?.kind !== "subagent") continue;
    const siblings = children.get(session.relation.parentSessionId) ?? [];
    siblings.push(session.id);
    children.set(session.relation.parentSessionId, siblings);
  }
  const movedIds = new Set<string>([id]);
  const pending = [id];
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (movedIds.has(child)) continue;
      movedIds.add(child);
      pending.push(child);
    }
  }
  if (getQueuedSubagentSessionIds().some((queuedId) => movedIds.has(queuedId))) {
    throw new SessionMoveConflict("Wait for queued subagents to finish before moving");
  }
  // Avoid overwriting a path already occupied by another session, including a
  // fork with the same basename in the destination directory.
  // The SDK owns cwd encoding and the agent sessions directory. Creating a
  // manager without appending does not persist a file.
  const destinationFile = SessionManager.create(cwd).getSessionFile();
  if (!destinationFile) throw new SessionMoveConflict("Cannot create destination session directory");
  const destinationDir = dirname(destinationFile);
  if (sessionPathKey(join(destinationDir, basename(source))) === sessionPathKey(source)) {
    throw new SessionMoveConflict("Session is already in that directory");
  }
  const relocated = new Map<string, string>();
  for (const sessionId of movedIds) {
    const member = byId.get(sessionId);
    if (!member || !existsSync(member.path)) throw new SessionMoveConflict("A subagent is not persisted");
    if (getRpcSession(sessionId)?.isRunning()) throw new SessionMoveConflict("Stop the session and its subagents before moving");
    const target = join(destinationDir, basename(member.path));
    if ((sessionPathKey(target) !== sessionPathKey(member.path) && existsSync(target))
      || [...relocated.values()].some((path) => sessionPathKey(path) === sessionPathKey(target))) {
      throw new SessionMoveConflict("Destination session file already exists");
    }
    relocated.set(sessionPathKey(member.path), target);
  }
  // Scan *all* sessions for references, not only siblings: forks can belong
  // to another project and subagents can have their own worktree directory.
  const files: SessionFile[] = [];
  for (const session of sessions) {
    if (!existsSync(session.path)) continue;
    const moving = movedIds.has(session.id);
    if (!moving && session.relation?.kind !== "fork" && session.relation?.kind !== "subagent") continue;
    const header = readSessionHeader(session.path);
    if (!header || header.id !== session.id) throw new SessionMoveConflict("Session changed while planning move");
    if (!moving && (!header.parentSession || !relocated.has(sessionPathKey(header.parentSession)))) continue;
    if (getRpcSession(session.id)?.isRunning()) throw new SessionMoveConflict("Stop linked sessions before moving");
    const beforeRead = fingerprint(session.path);
    const original = readFileSync(session.path, "utf8");
    if (fingerprint(session.path) !== beforeRead) throw new SessionMoveConflict("Session changed during move");
    const target = moving ? relocated.get(sessionPathKey(session.path))! : session.path;
    files.push({ id: session.id, source: session.path, target,
      rewritten: rewriteFile(original, moving ? cwd : null, relocated), fingerprint: beforeRead });
  }
  if (files.filter((file) => movedIds.has(file.id)).length !== movedIds.size) {
    throw new SessionMoveConflict("A subagent disappeared while planning move");
  }

  // A new queued task may have appeared while preparing the family.
  if (getQueuedSubagentSessionIds().some((queuedId) => movedIds.has(queuedId))) {
    throw new SessionMoveConflict("Wait for queued subagents to finish before moving");
  }
  // Fence reviewed metadata before replacing any file, including repaired parent
  // references. A failed/rolled-back move never resurrects its old generation.
  try {
    advanceGitWorkflowWriteEpoch(getAgentDir());
    for (const file of files) retireGitTaskBinding(file.id, undefined, "session-move", getAgentDir());
  } catch { throw new SessionMoveConflict("Task bindings could not be invalidated; session was not moved."); }
  // Evict idle wrappers before touching their files: their managers retain the
  // old path and could otherwise append to a stale or moved transcript.
  for (const file of files) await getRpcSession(file.id)?.shutdown();
  const token = randomUUID();
  const stages = files.map((file) => ({ ...file, stage: `${file.target}.${token}.tmp`, backup: `${file.source}.${token}.bak` }));
  const staged: string[] = [];
  const backedUp: typeof stages = [];
  const installed: typeof stages = [];
  try {
    for (const file of stages) {
      if (fingerprint(file.source) !== file.fingerprint) throw new SessionMoveConflict("Session changed during move");
      if (file.source !== file.target && existsSync(file.target)) throw new SessionMoveConflict("Destination session file already exists");
      writeFileSync(file.stage, file.rewritten, { flag: "wx", mode: 0o600 });
      staged.push(file.stage);
    }
    for (const file of stages) {
      if (fingerprint(file.source) !== file.fingerprint) throw new SessionMoveConflict("Session changed during move");
      renameSync(file.source, file.backup);
      backedUp.push(file);
    }
    for (const file of stages) {
      // Unlike rename, hard-link creation refuses to overwrite a destination
      // created concurrently after preflight. Stage and target share a dir.
      linkSync(file.stage, file.target);
      installed.push(file);
      unlinkSync(file.stage);
    }
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    for (const file of installed.reverse()) {
      try { unlinkSync(file.target); } catch (cause) { recoveryErrors.push(cause); }
    }
    for (const file of backedUp.reverse()) {
      try { renameSync(file.backup, file.source); } catch (cause) { recoveryErrors.push(cause); }
    }
    for (const stage of staged) if (existsSync(stage)) {
      try { unlinkSync(stage); } catch (cause) { recoveryErrors.push(cause); }
    }
    if (recoveryErrors.length) throw new AggregateError([error, ...recoveryErrors], "Move failed; recovery files may remain");
    throw error;
  }
  for (const file of stages) {
    try { unlinkSync(file.backup); } catch (error) { console.error("[pi-web] Session move backup retained:", file.backup, error); }
    invalidateSessionManagerCache(file.source);
    invalidateSessionManagerCache(file.target);
    cacheSessionPath(file.id, file.target);
  }
  invalidateSessionListCache();
  return { movedIds: [...movedIds] };
}
