import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { physicalDirectoryPath } from "./path-security";
import { managementRegistrations } from "./worktree-management";
import { resolveProjectUncached } from "./worktree";
import { listAllSessions } from "./session-reader";
import { moveSessionFamily, SessionMoveConflict } from "./session-move";
import { assertMoveDestination, assertMissingMoveSource, validateSessionMoveSource } from "./session-move-validation";
import { samePath } from "./paths";
import { projectIdentityKey } from "./project-identity";
import { sessionDirectoryState, sessionWorktreeInventory } from "./session-worktrees-inventory";
import { effectiveSessionArchived, familyAlreadyThere, sameSessionIds, sessionFamilyGraph, SESSION_MOVE_LIMIT, SessionWorktreeError } from "./session-worktrees-plan";
import type { SessionInfo } from "./types";
import type { SessionMoveExecuteResponse, SessionMovePlan, SessionMovePreviewRequest, SessionMovePreviewResponse, SessionWorktree } from "./session-worktrees-types";

export function sessionCwdState(cwd: string): SessionWorktree["state"] {
  return sessionDirectoryState(cwd, statSync);
}
function assertProjectAccess(project: string, roots: Set<string>): void {
  if (!project || project.length > 32768 || project.includes("\0") || !isAbsolute(project)) throw new SessionWorktreeError("Project must be an absolute path");
  if (!isFilePathAllowed(project, roots)) throw new SessionWorktreeError("Access denied", 403);
  const state = sessionCwdState(project);
  if (state === "present" && isExistingFilePathAllowed(project, roots)) return;
  if (state === "missing") {
    // Metadata-only requests may name a vanished project. Resolve its existing
    // ancestors through the same containment boundary; never grant that cwd.
    try {
      const physicalRoots = new Set<string>();
      for (const root of roots) {
        try { physicalRoots.add(physicalDirectoryPath(root)); } catch { /* unavailable grant */ }
      }
      if (isFilePathAllowed(physicalDirectoryPath(project), physicalRoots)) return;
    } catch { /* fail closed */ }
  }
  throw new SessionWorktreeError("Access denied", 403);
}
async function authorizeProject(project: string): Promise<() => void> {
  const roots = await getAllowedFileRoots();
  assertProjectAccess(project, roots);
  return () => assertProjectAccess(project, roots);
}
export async function sessionMoveCatalogue(): Promise<SessionInfo[]> {
  // Preview/inventory read disk only. The mover's existing live-catalogue scan
  // catches newly created or transient descendants under its lock.
  return listAllSessions({ force: true });
}
async function projectFor(cwd: string): Promise<string> { return (await resolveProjectUncached(cwd)).projectRoot; }
async function assertMembership(session: SessionInfo, project: string): Promise<void> {
  if (projectIdentityKey(await projectFor(session.cwd)) !== projectIdentityKey(project)) throw new SessionWorktreeError("A selected session no longer belongs to this project; preview again", 409);
}

/** Full registrations include missing/prunable entries, unlike listWorktrees().
 * The main flag from any filtered list is deliberately never consulted. */
async function checkoutInventory(project: string, sessions: readonly SessionInfo[]) {
  const access = await authorizeProject(project);
  const resolved = await resolveProjectUncached(project), projectRoot = resolved.projectRoot;
  const rootAccess = await authorizeProject(projectRoot);
  let gitCwd: string | null = resolved.isTopLevel && sessionCwdState(project) === "present" ? project : null;
  if (!gitCwd) {
    const seen = new Set<string>();
    for (const session of sessions) {
      if (seen.has(session.cwd) || sessionCwdState(session.cwd) !== "present") continue;
      seen.add(session.cwd);
      const candidate = await resolveProjectUncached(session.cwd);
      if (candidate.isTopLevel && samePath(candidate.projectRoot, projectRoot)) { gitCwd = session.cwd; break; }
    }
  }
  const registrations = gitCwd ? await managementRegistrations(gitCwd).catch(() => []) : [];
  let mainCwd: string | null = null;
  const primary = registrations.find((entry) => entry.main);
  if (primary && sessionCwdState(primary.path) === "present") {
    const actual = await resolveProjectUncached(primary.path);
    if (actual.isTopLevel && !actual.isWorktree && samePath(actual.projectRoot, primary.path) && samePath(actual.projectRoot, projectRoot)) {
      mainCwd = realpathSync(primary.path);
    }
  }
  access(); rootAccess();
  return { projectRoot, registrations, mainCwd };
}
export async function getSessionWorktreeInventory(project: string) {
  // Authorize before any user-directed Git reads.
  await authorizeProject(project);
  const sessions = await listAllSessions({ force: true });
  const checkout = await checkoutInventory(project, sessions);
  return sessionWorktreeInventory(checkout.projectRoot, sessions, checkout.registrations, checkout.mainCwd,
    { state: sessionCwdState, project: projectFor });
}

export async function previewSessionMoves(request: SessionMovePreviewRequest): Promise<SessionMovePreviewResponse> {
  const access = await authorizeProject(request.project);
  const sessions = await sessionMoveCatalogue();
  const checkout = await checkoutInventory(request.project, sessions);
  const project = checkout.projectRoot, missingOnly = request.missingOnly === true;
  let cwd = request.cwd;
  if (missingOnly) {
    if (!checkout.mainCwd) throw new SessionWorktreeError("The primary checkout is unavailable; restore it before recovering sessions", 409);
    if (cwd && !samePath(cwd, checkout.mainCwd)) throw new SessionWorktreeError("Missing sessions must move to the primary checkout", 409);
    cwd = checkout.mainCwd;
  }
  if (!cwd) throw new SessionWorktreeError("Destination directory is required");
  assertMoveDestination(cwd);
  const graph = sessionFamilyGraph(sessions);
  let selected = request.ids ?? [];
  if (missingOnly) {
    selected = [];
    const projects = new Map<string, Promise<string>>();
    for (const session of sessions) {
      if (session.transient || sessionCwdState(session.cwd) !== "missing") continue;
      let owner = projects.get(session.cwd);
      if (!owner) { owner = projectFor(session.cwd); projects.set(session.cwd, owner); }
      if (samePath(await owner, project)) selected.push(session.id);
    }
  }
  const roots = graph.roots(selected), skippedAlreadyThere: string[] = [];
  const plan: SessionMovePlan = { project, cwd, missingOnly, roots: [], sessionCount: 0, archivedCount: 0 };
  for (const id of roots) {
    const root = graph.byId.get(id)!;
    await assertMembership(root, project);
    const memberIds = graph.family(id), members = memberIds.map((member) => graph.byId.get(member)!);
    if (members.some((member) => member.transient || !member.path)) throw new SessionWorktreeError("Wait for the session and its subagents to be persisted", 409);
    if (familyAlreadyThere(members, cwd)) { skippedAlreadyThere.push(id); continue; }
    if (samePath(root.cwd, cwd)) throw new SessionWorktreeError("The parent is already at the destination. Use the worktree filter to select its other subtrees instead.", 409);
    const fence = await validateSessionMoveSource(root.cwd, cwd);
    fence();
    if (missingOnly) assertMissingMoveSource(root.cwd);
    plan.roots.push({ id, sourceCwd: root.cwd, memberIds,
      bindings: members.map(member => ({ id: member.id, cwd: member.cwd, path: member.path })) });
    plan.sessionCount += memberIds.length;
    plan.archivedCount += members.filter(member => effectiveSessionArchived(member, graph.byId)).length;
    if (plan.sessionCount > SESSION_MOVE_LIMIT) throw new SessionWorktreeError("A move may affect at most 4096 sessions", 409);
  }
  access();
  return { plan, ...(skippedAlreadyThere.length ? { skippedAlreadyThere } : {}) };
}

/** The wire shape binds root cwd, exact family IDs and every descendant cwd/path
 * observed during preview. All bindings are rechecked under the move lock.
 * No serialized field bypasses live membership or ordinary move validation. */
export async function executeSessionMoves(plan: SessionMovePlan, signal?: AbortSignal): Promise<SessionMoveExecuteResponse> {
  await authorizeProject(plan.project);
  const result: SessionMoveExecuteResponse = { succeeded: [], failed: [], skipped: [], movedIds: [] };
  const affected = new Set<string>();
  for (const proposed of plan.roots) {
    try {
      signal?.throwIfAborted();
      const bindings = proposed.bindings;
      let affectedByMove: readonly string[] = [];
      const moved = await moveSessionFamily(proposed.id, plan.cwd, {
        assertAffected: (ids) => {
          if (new Set([...affected, ...ids]).size > SESSION_MOVE_LIMIT) throw new SessionWorktreeError("A move may affect at most 4096 sessions, including linked references", 409);
          affectedByMove = ids;
        },
        expectedSessionBindings: bindings,
        requiredMissingCwd: plan.missingOnly ? proposed.sourceCwd : undefined,
        skipAlreadyThere: true,
        validate: async (sessions, memberIds) => {
          const access = await authorizeProject(plan.project);
          signal?.throwIfAborted();
          const graph = sessionFamilyGraph(sessions);
          if (!sameSessionIds(proposed.memberIds, memberIds) || !sameSessionIds(graph.family(proposed.id), proposed.memberIds)) {
            throw new SessionWorktreeError("Session family changed; preview the move again", 409);
          }
          const root = graph.byId.get(proposed.id)!;
          const members = memberIds.map((id) => graph.byId.get(id)!);
          assertMoveDestination(plan.cwd);
          // No effects and no source-waiver needed for a genuine whole-family no-op.
          if (familyAlreadyThere(members, plan.cwd)) return () => { access(); signal?.throwIfAborted(); assertMoveDestination(plan.cwd); };
          if (!samePath(root.cwd, proposed.sourceCwd)) throw new SessionWorktreeError("Source directory changed; preview the move again", 409);
          await assertMembership(root, plan.project);
          if (plan.missingOnly) {
            const checkout = await checkoutInventory(plan.project, sessions);
            if (!checkout.mainCwd || !samePath(checkout.mainCwd, plan.cwd)) throw new SessionWorktreeError("The primary checkout changed or is unavailable; preview again", 409);
          }
          const sourceFence = await validateSessionMoveSource(root.cwd, plan.cwd);
          return () => { access(); signal?.throwIfAborted(); sourceFence(); };
        },
      });
      if (moved.skipped) result.skipped.push(proposed.id);
      else {
        result.succeeded.push(proposed.id); result.movedIds.push(...moved.movedIds);
        for (const id of affectedByMove) affected.add(id);
      }
    } catch (error) {
      result.failed.push({ id: proposed.id, error: sessionMoveErrorMessage(error) });
    }
  }
  return result;
}
export function sessionMoveErrorMessage(error: unknown): string {
  if (error instanceof SessionWorktreeError || error instanceof SessionMoveConflict) return error.message;
  if (error instanceof AggregateError) return "Move failed; recovery files may remain. Check the session files before retrying.";
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return "Directory or session does not exist";
  if (code === "EACCES" || code === "EPERM") return "Cannot access the directory or session files";
  if (error instanceof Error && error.name === "AbortError") return "Move request was cancelled";
  return "Unable to move sessions; refresh and try again";
}
