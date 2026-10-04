import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writeGitScopedAuthorityFile, type GitAuthorityScope } from "./git-scoped-authority";
import { gitProjectRootForCaller } from "./git-project-resources";
import { appendSessionGitWorkflow, validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { resolveProject } from "./worktree";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

interface DefaultFile { version: 1; projects: Record<string, GitWorkflowPolicy> }

export function gitWorkflowDefaultsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "git-workflow-defaults.json");
}

function readFile(path: string): DefaultFile {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, projects: Object.create(null) };
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Git workflow defaults file");
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !Object.hasOwn(data, "projects")
    || Object.keys(data).some((key) => key !== "version" && key !== "projects")
    || !data.projects || typeof data.projects !== "object" || Array.isArray(data.projects)) {
    throw new Error("Invalid Git workflow defaults file");
  }
  const projects: Record<string, GitWorkflowPolicy> = Object.create(null);
  for (const [root, policy] of Object.entries(data.projects)) {
    if (!root) throw new Error("Invalid Git workflow project key");
    projects[root] = validateGitWorkflowPolicy(policy);
  }
  return { version: 1, projects };
}

/** Canonical identity groups main and linked worktree checkouts together. */
export async function getProjectGitWorkflow(cwd: string, path = gitWorkflowDefaultsPath()): Promise<GitWorkflowPolicy | undefined> {
  const { projectRoot } = await resolveProject(cwd);
  return readFile(path).projects[projectRoot];
}

/** Null deletes the default; this never rewrites existing session snapshots. */
export async function setProjectGitWorkflow(
  cwd: string, policy: GitWorkflowPolicy | null, path = gitWorkflowDefaultsPath(),
): Promise<void> {
  const checked = policy === null ? null : validateGitWorkflowPolicy(policy);
  const { projectRoot } = await resolveProject(cwd);
  let scopes: GitAuthorityScope[] = [{ kind: "global" }];
  try {
    const canonical = await gitProjectRootForCaller(cwd);
    if (canonical === projectRoot) scopes = [{ kind: "project", projectRoot: canonical }];
  } catch { /* Ambiguous legacy defaults are a genuine global mutation. */ }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Lock a stable pathname, not the inode replaced by atomic rename. Read inside lock.
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 30_000,
    retries: { retries: 10, minTimeout: 100, maxTimeout: 1_000 },
  });
  try {
    const file = readFile(path);
    if (checked === null) delete file.projects[projectRoot];
    else file.projects[projectRoot] = checked;
    writeGitScopedAuthorityFile(dirname(dirname(path)), path, JSON.stringify(file, null, 2), "settings", scopes);
  } finally {
    await release();
  }
}

/** Called only during creation; no read-time fallback to defaults for existing sessions. */
export async function snapshotNewSessionGitWorkflow(
  cwd: string, manager: Pick<SessionManager, "appendCustomEntry">, path = gitWorkflowDefaultsPath(),
): Promise<GitWorkflowPolicy | undefined> {
  const policy = await getProjectGitWorkflow(cwd, path);
  if (policy) appendSessionGitWorkflow(manager, policy);
  return policy;
}
