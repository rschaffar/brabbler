import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { gitExecEnv } from "./git-exec";
import { validLocalBranchName } from "./git-workflow-policy";
import { samePath, toNativePath } from "./paths";

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec("git", ["--no-optional-locks", "-C", cwd, ...args],
  { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();

/** Select only a physical, registered, local-branch checkout in the calling chat's repository. */
export async function selectGitWorkspace(sessionCwd: string, branch?: string): Promise<string> {
  const sessionRoot = toNativePath(await git(sessionCwd, "rev-parse", "--show-toplevel"));
  if (!samePath(sessionCwd, sessionRoot) || !samePath(sessionRoot, await realpath(sessionRoot))) throw new Error("Physical session checkout root required");
  // The calling session already authorizes its own checkout. Only a different
  // registered checkout needs the additional Pi Web file-root boundary.
  if (branch === undefined) return sessionRoot;
  const roots = await getAllowedFileRoots();
  if (!validLocalBranchName(branch)) throw new Error("Invalid local workspace branch");
  const output = await git(sessionRoot, "worktree", "list", "--porcelain", "-z");
  let location = "";
  let selected = "";
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) location = toNativePath(field.slice(9));
    if (field === `branch refs/heads/${branch}`) {
      if (selected) throw new Error("Ambiguous workspace branch");
      selected = location;
    }
  }
  if (!selected || !samePath(selected, await realpath(selected)) ||
      (!samePath(selected, sessionRoot) && !isExistingFilePathAllowed(selected, roots))) {
    throw new Error("Physical registered workspace required within allowed roots");
  }
  if (!samePath(selected, toNativePath(await git(selected, "rev-parse", "--show-toplevel"))) ||
      !samePath(toNativePath(await git(selected, "rev-parse", "--path-format=absolute", "--git-common-dir")),
        toNativePath(await git(sessionRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"))) ||
      (await git(selected, "symbolic-ref", "--quiet", "HEAD")) !== `refs/heads/${branch}`) {
    throw new Error("Workspace checkout changed");
  }
  return selected;
}
