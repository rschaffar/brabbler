import { statSync } from "node:fs";
import { listWorktrees, resolveProjectUncached } from "./worktree";
import { samePath } from "./paths";
import { projectIdentityKey } from "./project-identity";
import { SessionMoveConflict } from "./session-move";

export function assertMoveDestination(cwd: string): void {
  if (!statSync(cwd).isDirectory()) throw new SessionMoveConflict("Destination must be an existing directory");
}
export function assertMissingMoveSource(cwd: string): void {
  try { statSync(cwd); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new SessionMoveConflict("Cannot verify the source directory is missing");
  }
  throw new SessionMoveConflict("The source directory exists again; preview the move again");
}
/** Ordinary move-route semantics, shared by single and bulk moves. Only ENOENT
 * waives source registration. The returned synchronous fence survives awaits. */
export async function validateSessionMoveSource(sourceCwd: string, cwd: string): Promise<() => void> {
  assertMoveDestination(cwd);
  let sourceMissing = false;
  try { statSync(sourceCwd); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    sourceMissing = true;
  }
  const [from, to] = await Promise.all([resolveProjectUncached(sourceCwd), resolveProjectUncached(cwd)]);
  const sourceWorktrees = await listWorktrees(sourceMissing ? from.projectRoot : sourceCwd).catch(() => []);
  const destinationWorktrees = await listWorktrees(cwd).catch(() => []);
  const sameGitRepo = sourceWorktrees.some((source) => destinationWorktrees.some((destination) => samePath(source.path, destination.path)));
  if (sameGitRepo || projectIdentityKey(from.projectRoot) === projectIdentityKey(to.projectRoot)) {
    if ((!sourceMissing && !from.isTopLevel) || !to.isTopLevel || samePath(sourceCwd, cwd)) {
      throw new SessionMoveConflict("Choose another worktree or project");
    }
    if ((!sourceMissing && !sourceWorktrees.some((item) => samePath(item.path, sourceCwd)))
      || !destinationWorktrees.some((item) => samePath(item.path, cwd))) {
      throw new SessionMoveConflict("Choose a registered worktree");
    }
  }
  return () => {
    assertMoveDestination(cwd);
    if (sourceMissing) assertMissingMoveSource(sourceCwd);
  };
}
