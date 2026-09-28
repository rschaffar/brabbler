import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { resolveProject } from "./worktree";
import { getProjectGitWorkflow, gitWorkflowDefaultsPath } from "./git-workflow-store";
import { readManagedSessionGitWorkflow, workflowTaskFromEntries } from "./git-workflow-session";
import { resolveGitWorkflowSettings, settingsFromLegacyPolicy, validateGitWorkflowOverrides,
  type GitWorkflowOverrides, type GitWorkflowSettingsResponse } from "./git-workflow-settings";
import type { SessionEntry } from "./types";

export interface GitWorkflowSettingsDocument {
  version: 1;
  paused: boolean;
  global: GitWorkflowOverrides;
  projects: Record<string, GitWorkflowOverrides>;
}
export function gitWorkflowSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "git-workflow-settings.json");
}
export function readGitWorkflowSettingsDocument(agentDir = getAgentDir()): GitWorkflowSettingsDocument {
  let raw: string;
  try { raw = readFileSync(gitWorkflowSettingsPath(agentDir), "utf8"); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, paused: false, global: {}, projects: Object.create(null) };
    throw cause;
  }
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Workflow settings file too large");
  const data = JSON.parse(raw) as GitWorkflowSettingsDocument;
  if (!data || data.version !== 1 || Object.keys(data).sort().join(",") !== "global,paused,projects,version"
    || typeof data.paused !== "boolean" || !data.projects || typeof data.projects !== "object" || Array.isArray(data.projects)) {
    throw new Error("Unsupported workflow settings file");
  }
  const projects: GitWorkflowSettingsDocument["projects"] = Object.create(null);
  for (const [key, value] of Object.entries(data.projects)) {
    if (!key || key.length > 4096) throw new Error("Invalid workflow project");
    projects[key] = validateGitWorkflowOverrides(value);
  }
  return { version: 1, paused: data.paused, global: validateGitWorkflowOverrides(data.global), projects };
}
export function writeGitWorkflowSettingsDocument(document: GitWorkflowSettingsDocument, agentDir = getAgentDir()): void {
  writePrivateFileAtomicSync(gitWorkflowSettingsPath(agentDir), JSON.stringify(document, null, 2));
}

/** All writes, including session adoption, serialize against defaults/pause changes. */
export async function withGitWorkflowSettingsLock<T>(agentDir: string, action: () => Promise<T>): Promise<T> {
  const path = gitWorkflowSettingsPath(agentDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, { realpath: false, stale: 30_000,
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 } });
  try { return await action(); } finally { await release(); }
}

export async function loadGitWorkflowSettings(
  cwd?: string, entries: readonly SessionEntry[] = [], agentDir = getAgentDir(), sessionIdentity = "",
): Promise<GitWorkflowSettingsResponse> {
  const document = readGitWorkflowSettingsDocument(agentDir);
  const projectRoot = cwd ? (await resolveProject(cwd)).projectRoot : undefined;
  let project: GitWorkflowOverrides = {};
  if (projectRoot) {
    if (Object.hasOwn(document.projects, projectRoot)) project = document.projects[projectRoot];
    else {
      const legacy = await getProjectGitWorkflow(cwd!, gitWorkflowDefaultsPath(agentDir));
      if (legacy) {
        project = settingsFromLegacyPolicy(legacy);
        // v1 had no enablement field. Importing it must not invent an override
        // that defeats a newly disabled global default.
        delete project.enabled;
      }
    }
  }
  const saved = readManagedSessionGitWorkflow(entries);
  const session = sessionIdentity ? saved?.overrides ?? {} : null;
  const task = workflowTaskFromEntries(entries);
  // Bind choices and identity, not unrelated transcript activity: streaming
  // must not make Global/Project saves or the safety pause perpetually stale.
  // Session append safety is separately checked against the live manager/stat.
  const revision = createHash("sha256").update(JSON.stringify({ document, projectRoot, project, cwd, sessionIdentity, session, task })).digest("hex");
  return {
    revision, paused: document.paused, ...(cwd ? { cwd } : {}), ...(projectRoot ? { projectRoot } : {}),
    global: document.global, project, session,
    resolved: { global: resolveGitWorkflowSettings(document.global), project: resolveGitWorkflowSettings(document.global, project),
      session: resolveGitWorkflowSettings(document.global, project, session ?? {}) },
    task, sessionEditable: false,
  };
}
