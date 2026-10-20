import { isAbsolute } from "node:path";
import { samePath } from "./paths";
import type { SessionInfo } from "./types";
import type { SessionMovePlan, SessionMoveRequest, SessionMovePlanRoot } from "./session-worktrees-types";

export const SESSION_MOVE_LIMIT = 4096;
export const SESSION_MOVE_BODY_LIMIT = 512 * 1024;
export class SessionWorktreeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const invalid = (message: string): never => { throw new SessionWorktreeError(message); };
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) invalid(`${label} contains unsupported fields`);
  return record;
}
function path(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 32768 || value.includes("\0") || !isAbsolute(value)) {
    invalid(`${label} must be an absolute path`);
  }
  return value as string;
}
function id(value: unknown): string {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value)) invalid("Invalid session ID");
  return value as string;
}
function ids(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > SESSION_MOVE_LIMIT) invalid("Select between 1 and 4096 sessions");
  const result = (value as unknown[]).map(id);
  if (new Set(result).size !== result.length) invalid("Duplicate session IDs are not allowed");
  return result;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > SESSION_MOVE_LIMIT) invalid("Invalid session count");
  return value as number;
}
export function parseSessionMovePlan(value: unknown): SessionMovePlan {
  const v = object(value, ["project", "cwd", "missingOnly", "roots", "sessionCount", "archivedCount"], "Plan");
  if (typeof v.missingOnly !== "boolean") invalid("Plan missingOnly must be a boolean");
  if (!Array.isArray(v.roots) || v.roots.length > SESSION_MOVE_LIMIT) invalid("Invalid plan roots");
  const seen = new Set<string>();
  const roots: SessionMovePlanRoot[] = (v.roots as unknown[]).map((value) => {
    const root = object(value, ["id", "sourceCwd", "memberIds", "bindings"], "Plan root");
    const rootId = id(root.id), memberIds = ids(root.memberIds);
    if (!memberIds.includes(rootId)) invalid("A plan root must include itself");
    for (const member of memberIds) {
      if (seen.has(member)) invalid("Plan families overlap");
      seen.add(member);
      if (seen.size > SESSION_MOVE_LIMIT) invalid("A move may affect at most 4096 sessions");
    }
    if (!Array.isArray(root.bindings) || root.bindings.length !== memberIds.length) invalid("Plan session bindings are incomplete");
    const bindings = (root.bindings as unknown[]).map(value => {
      const binding = object(value, ["id", "cwd", "path"], "Session binding");
      return { id: id(binding.id), cwd: path(binding.cwd, "Session directory"), path: path(binding.path, "Session file") };
    });
    if (!sameSessionIds(memberIds, bindings.map(binding => binding.id))) invalid("Plan session bindings do not match its families");
    return { id: rootId, sourceCwd: path(root.sourceCwd, "Source directory"), memberIds, bindings };
  });
  const sessionCount = count(v.sessionCount), archivedCount = count(v.archivedCount);
  if (sessionCount !== seen.size || archivedCount > sessionCount) invalid("Plan counts do not match its families");
  return { project: path(v.project, "Project"), cwd: path(v.cwd, "Destination"), missingOnly: v.missingOnly as boolean, roots, sessionCount, archivedCount };
}
export function parseSessionMoveRequest(value: unknown): SessionMoveRequest {
  if (!value || typeof value !== "object") invalid("A move request is required");
  if ((value as { mode?: unknown }).mode === "execute") {
    const v = object(value, ["mode", "plan"], "Request");
    return { mode: "execute", plan: parseSessionMovePlan(v.plan) };
  }
  const v = object(value, ["mode", "project", "ids", "cwd", "missingOnly"], "Request");
  if (v.mode !== "preview") invalid("Choose preview or execute mode");
  if (v.missingOnly !== undefined && typeof v.missingOnly !== "boolean") invalid("missingOnly must be a boolean");
  if (v.missingOnly === true && v.ids !== undefined) invalid("Missing-session recovery selects all missing sessions; omit ids");
  const selected = v.ids === undefined ? undefined : ids(v.ids);
  if (v.missingOnly !== true && !selected) invalid("Select sessions to move");
  if (v.missingOnly !== true && v.cwd === undefined) invalid("Destination directory is required");
  return { mode: "preview", project: path(v.project, "Project"), ...(selected ? { ids: selected } : {}),
    ...(v.cwd === undefined ? {} : { cwd: path(v.cwd, "Destination") }), ...(v.missingOnly === undefined ? {} : { missingOnly: v.missingOnly as boolean }) };
}

/** Stream the bound as bytes, including requests without Content-Length. */
export async function readSessionMoveRequest(req: Request): Promise<SessionMoveRequest> {
  const declared = req.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > SESSION_MOVE_BODY_LIMIT)) throw new SessionWorktreeError("Move request exceeds 512 KiB", 413);
  if (!req.body) invalid("A move request is required");
  const reader = req.body!.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SESSION_MOVE_BODY_LIMIT) {
        await reader.cancel();
        throw new SessionWorktreeError("Move request exceeds 512 KiB", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { invalid("Move request must be valid JSON"); }
  return parseSessionMoveRequest(value);
}

/** All persisted and live sessions, not a project-filtered catalogue, own closure. */
export function sessionFamilyGraph(sessions: readonly SessionInfo[]) {
  const byId = new Map<string, SessionInfo>(), parents = new Map<string, string>(), children = new Map<string, string[]>();
  for (const session of sessions) {
    if (byId.has(session.id)) throw new SessionWorktreeError("Duplicate session identity; refresh the session list", 409);
    byId.set(session.id, session);
  }
  for (const session of sessions) {
    if (!session.relation || session.relation.kind === "fork") continue;
    if (session.relation.kind !== "subagent") continue;
    const parent = session.relation.parentSessionId;
    parents.set(session.id, parent);
    const siblings = children.get(parent) ?? [];
    siblings.push(session.id); children.set(parent, siblings);
  }
  const family = (root: string): string[] => {
    if (!byId.has(root)) throw new SessionWorktreeError("Session not found; refresh the session list", 409);
    const pending = [root], members: string[] = [], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) throw new SessionWorktreeError("Cyclic subagent relationship; cannot safely plan a move", 409);
      seen.add(current); members.push(current);
      if (members.length > SESSION_MOVE_LIMIT) throw new SessionWorktreeError("A move may affect at most 4096 sessions", 409);
      for (const child of children.get(current) ?? []) pending.push(child);
    }
    return members.sort();
  };
  const roots = (selection: readonly string[]): string[] => {
    if (selection.length > SESSION_MOVE_LIMIT) throw new SessionWorktreeError("Select at most 4096 sessions", 409);
    const selected = new Set(selection);
    for (const selectedId of selected) if (!byId.has(selectedId)) throw new SessionWorktreeError("Session not found; refresh the session list", 409);
    return [...selected].filter((selectedId) => {
      let parent = parents.get(selectedId);
      const seen = new Set([selectedId]);
      let selectedAncestor = false;
      while (parent) {
        if (seen.has(parent)) throw new SessionWorktreeError("Cyclic subagent relationship; cannot safely plan a move", 409);
        seen.add(parent);
        if (selected.has(parent)) selectedAncestor = true;
        parent = parents.get(parent);
      }
      return !selectedAncestor;
    });
  };
  return { byId, family, roots };
}
export function sameSessionIds(a: readonly string[], b: readonly string[]): boolean {
  const expected = new Set(a);
  return expected.size === a.length && new Set(b).size === b.length && a.length === b.length && b.every((id) => expected.has(id));
}
export function effectiveSessionArchived(session: SessionInfo, byId: ReadonlyMap<string, SessionInfo>): boolean {
  let current = session;
  const seen = new Set([current.id]);
  while (current.relation?.kind === "subagent") {
    const parent = byId.get(current.relation.parentSessionId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id); current = parent;
  }
  return Boolean(current.archived);
}
export function familyAlreadyThere(members: readonly SessionInfo[], cwd: string): boolean {
  return members.length > 0 && members.every((member) => samePath(member.cwd, cwd));
}
