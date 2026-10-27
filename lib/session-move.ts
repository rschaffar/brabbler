import { SessionManager } from "@earendil-works/pi-coding-agent";
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
import type { SessionInfo } from "./types";
import { samePath } from "./paths";
import { familyAlreadyThere, sameSessionIds, sessionFamilyGraph } from "./session-worktrees-plan";

export class SessionMoveConflict extends Error {}

declare global {
  var __piSessionMoveLock: Promise<void> | undefined;
}

type SessionFile = { id: string; source: string; target: string; rewritten: string; fingerprint: string };

export interface SessionMoveOptions {
  expectedSessionBindings?: readonly { id: string; cwd: string; path: string }[];
  requiredMissingCwd?: string;
  skipAlreadyThere?: boolean;
  assertAffected?: (ids: readonly string[]) => void;
  /** Trusted in-process guard, never a request callback. Repeated under the move
   * lock and after wrapper shutdown; returns a synchronous final mutation fence. */
  validate?: (sessions: readonly SessionInfo[], memberIds: readonly string[]) => Promise<(() => void) | void>;
}

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

/** Serialize relocations and read-only observations of an uncertain relocation. */
export async function withSessionMoveLock<T>(operation: (move: typeof moveSessionFamilyUnlocked) => Promise<T>): Promise<T> {
  const previous = globalThis.__piSessionMoveLock ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => turn);
  globalThis.__piSessionMoveLock = current;
  try {
    await previous;
    return await operation(moveSessionFamilyUnlocked);
  } finally {
    release();
    if (globalThis.__piSessionMoveLock === current) globalThis.__piSessionMoveLock = undefined;
  }
}

export async function moveSessionFamily(id: string, cwd: string, options: SessionMoveOptions = {}): Promise<{ movedIds: string[]; skipped?: boolean }> {
  return withSessionMoveLock(move => move(id, cwd, options));
}

/** Move a persisted session family; forks are independent but their origin paths must be repaired. */
async function moveSessionFamilyUnlocked(id: string, cwd: string, options: SessionMoveOptions): Promise<{ movedIds: string[]; skipped?: boolean }> {
  const sessions = mergeSessionLists(await listAllSessions({ force: true }), getRpcSessionInfos({ includeTransient: true }));
  const byId = new Map<string, SessionInfo>(sessions.map((session) => [session.id, session]));
  const root = byId.get(id);
  const source = await resolveSessionPath(id);
  if (!root || !source || !existsSync(source)) throw new SessionMoveConflict("Session is not persisted");

  let familyIds: string[];
  try { familyIds = sessionFamilyGraph(sessions).family(id); }
  catch { throw new SessionMoveConflict("Invalid or cyclic session family; refresh the session list"); }
  const movedIds = new Set(familyIds);
  if (!samePath(source, root.path)) throw new SessionMoveConflict("Session path changed while planning move");
  const members = familyIds.map(memberId => byId.get(memberId)!);
  if (options.expectedSessionBindings && (!sameSessionIds(familyIds, options.expectedSessionBindings.map(member => member.id))
    || options.expectedSessionBindings.some(expected => {
      const actual = byId.get(expected.id);
      return !actual || !samePath(actual.cwd, expected.cwd) || !samePath(actual.path, expected.path);
    }))) throw new SessionMoveConflict("Session family or source directories changed; preview the move again");
  for (const member of members) {
    if (member.transient || !existsSync(member.path)) throw new SessionMoveConflict("A subagent is not persisted");
  }
  let fence = await options.validate?.(sessions, familyIds);
  const assertBindings = () => {
    for (const member of members) {
      const header = readSessionHeader(member.path);
      if (!header || header.id !== member.id || !samePath(header.cwd, member.cwd)) {
        throw new SessionMoveConflict("Session family or source directories changed; preview the move again");
      }
    }
  };
  assertBindings();
  if (options.skipAlreadyThere && familyAlreadyThere(members, cwd)) {
    fence?.();
    return { movedIds: [], skipped: true };
  }
  const assertCurrent = () => {
    fence?.(); assertBindings();
    if (options.requiredMissingCwd) {
      let missing = false;
      try { statSync(options.requiredMissingCwd); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new SessionMoveConflict("Cannot verify the source directory is missing");
        missing = true;
      }
      if (!missing) throw new SessionMoveConflict("The source directory exists again; preview the move again");
    }
    if (getQueuedSubagentSessionIds().some(queuedId => movedIds.has(queuedId))) throw new SessionMoveConflict("Wait for queued subagents to finish before moving");
    if (members.some(member => getRpcSession(member.id)?.isRunning())) throw new SessionMoveConflict("Stop the session and its subagents before moving");
  };
  assertCurrent();
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

  if (files.length > 4096) throw new SessionMoveConflict("A move may affect at most 4096 sessions, including linked references");
  options.assertAffected?.(files.map(file => file.id));

  // A new queued task may have appeared while preparing the family.
  if (getQueuedSubagentSessionIds().some((queuedId) => movedIds.has(queuedId))) {
    throw new SessionMoveConflict("Wait for queued subagents to finish before moving");
  }
  // Evict idle wrappers before touching their files: their managers retain the
  // old path and could otherwise append to a stale or moved transcript.
  for (const file of files) {
    if (getRpcSession(file.id)?.isRunning() || getQueuedSubagentSessionIds().includes(file.id)) {
      throw new SessionMoveConflict("Stop linked sessions before moving");
    }
    await getRpcSession(file.id)?.shutdown();
  }
  fence = await options.validate?.(sessions, familyIds);
  // Include late children and incoming links after all awaited shutdown/validation.
  const finalSessions = mergeSessionLists(await listAllSessions({ force: true }), getRpcSessionInfos({ includeTransient: true }));
  let finalFamily: string[];
  try { finalFamily = sessionFamilyGraph(finalSessions).family(id); }
  catch { throw new SessionMoveConflict("Session family changed; preview the move again"); }
  const finalById = new Map(finalSessions.map(session => [session.id, session]));
  if (!sameSessionIds(familyIds, finalFamily) || members.some(member => {
    const current = finalById.get(member.id);
    return !current || !samePath(current.path, member.path) || !samePath(current.cwd, member.cwd);
  })) throw new SessionMoveConflict("Session family or source directories changed; preview the move again");
  const plannedFiles = new Set(files.map(file => sessionPathKey(file.source)));
  for (const session of finalSessions) {
    if (movedIds.has(session.id) || (session.relation?.kind !== "fork" && session.relation?.kind !== "subagent")) continue;
    const header = readSessionHeader(session.path);
    if (header?.parentSession && relocated.has(sessionPathKey(header.parentSession)) && !plannedFiles.has(sessionPathKey(session.path))) {
      throw new SessionMoveConflict("Linked sessions changed; preview the move again");
    }
  }
  assertCurrent();
  if (files.some(file => getRpcSession(file.id) || getQueuedSubagentSessionIds().includes(file.id))) {
    throw new SessionMoveConflict("A session reopened while preparing the move; stop it and preview again");
  }
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
    for (const file of stages) {
      if (readFileSync(file.target, "utf8") !== file.rewritten) throw new SessionMoveConflict("Installed session changed during move");
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
    for (const file of files) { invalidateSessionManagerCache(file.source); invalidateSessionManagerCache(file.target); }
    invalidateSessionListCache();
    if (recoveryErrors.length) throw new AggregateError([error, ...recoveryErrors], "Move failed; recovery files may remain");
    throw error;
  }
  for (const file of stages) {
    try { unlinkSync(file.backup); } catch (error) { console.error("[brabbler] Session move backup retained:", file.backup, error); }
    invalidateSessionManagerCache(file.source);
    invalidateSessionManagerCache(file.target);
    cacheSessionPath(file.id, file.target);
  }
  invalidateSessionListCache();
  return { movedIds: [...movedIds] };
}
