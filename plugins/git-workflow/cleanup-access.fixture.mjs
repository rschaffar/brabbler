import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const fixtureGit = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
/** Native resource-engine adapter for private fixtures whose primary checkout is repo.
 * No SDK, settings/review import, global builtin patch or cached capture. */
export function nativeCleanupAccess(repo, overrides = {}) {
  return {
    git: (cwd, args) => fixtureGit(cwd, ...args), checkout: (path) => path,
    branchTip: (cwd, branch) => fixtureGit(cwd, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`),
    worktrees: () => fixtureGit(repo, "worktree", "list", "--porcelain", "-z").split("\0\0").filter(Boolean).map((record) => {
      const fields = record.split("\0");
      return { path: fields.find((value) => value.startsWith("worktree ")).slice(9),
        branch: fields.find((value) => value.startsWith("branch refs/heads/"))?.slice(18),
        head: fields.find((value) => value.startsWith("HEAD "))?.slice(5), detached: fields.includes("detached"),
        locked: fields.find((value) => value === "locked" || value.startsWith("locked ")),
        prunable: fields.find((value) => value === "prunable" || value.startsWith("prunable ")) };
    }),
    project: () => join(repo, ".git"), inUse: () => false, ...overrides,
  };
}
