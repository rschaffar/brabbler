import { samePath } from "./paths";
import { effectiveSessionArchived } from "./session-worktrees-plan";
import { projectIdentityKey } from "./project-identity";
import type { SessionInfo } from "./types";
import type { SessionWorktree, SessionWorktreeInventory } from "./session-worktrees-types";

export function sessionDirectoryState(cwd: string, stat: (cwd: string) => { isDirectory(): boolean }): SessionWorktree["state"] {
  try { return stat(cwd).isDirectory() ? "present" : "unavailable"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable"; }
}

export interface SessionInventoryIO {
  /** Must use stat: only ENOENT is missing. Files, EACCES, EIO, etc. are unavailable. */
  state(cwd: string): SessionWorktree["state"];
  /** Live resolution; historical projectRoot/projectKey fields are not ownership evidence. */
  project(cwd: string): Promise<string>;
}
export interface SessionCheckoutRegistration { path: string; branch: string | null }

/** No IO beyond the injected observations; no roots are granted and no cwd is created. */
export async function sessionWorktreeInventory(
  projectRoot: string,
  sessions: readonly SessionInfo[],
  registrations: readonly SessionCheckoutRegistration[],
  verifiedMain: string | null,
  io: SessionInventoryIO,
): Promise<SessionWorktreeInventory> {
  const rows = new Map<string, SessionWorktree>();
  const add = (cwd: string, branch: string | null) => {
    const key = projectIdentityKey(cwd);
    let row = rows.get(key);
    if (!row) {
      row = { path: cwd, branch, isMain: verifiedMain !== null && samePath(cwd, verifiedMain), state: io.state(cwd), sessionCount: 0, archivedCount: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const checkout of registrations) add(checkout.path, checkout.branch);
  const projects = new Map<string, Promise<string>>();
  const byId = new Map(sessions.map(session => [session.id, session]));
  for (const session of sessions) {
    if (session.transient) continue;
    const key = projectIdentityKey(session.cwd);
    let project = projects.get(key);
    if (!project) { project = io.project(session.cwd); projects.set(key, project); }
    if (projectIdentityKey(await project) !== projectIdentityKey(projectRoot)) continue;
    // Branch names for stale/unregistered history are not registration evidence.
    const row = add(session.cwd, null);
    row.sessionCount++;
    if (effectiveSessionArchived(session, byId)) row.archivedCount++;
  }
  const main = verifiedMain ? [...rows.values()].find((row) => samePath(row.path, verifiedMain) && row.state === "present") : undefined;
  return { projectRoot, mainCwd: main?.path ?? null,
    worktrees: [...rows.values()].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path)) };
}
