import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { advanceGitWorkflowWriteEpoch, gitWorkflowPrivateParent, readGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import { resolveProject } from "./worktree";
import { getProjectGitWorkflow, gitWorkflowDefaultsPath } from "./git-workflow-store";
import { readManagedSessionGitWorkflow, workflowTaskFromEntries } from "./git-workflow-session";
import { readGitProjectSessionSettings } from "./git-project-session";
import { gitProjectRootForCaller } from "./git-project-resources";
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
  advanceGitWorkflowWriteEpoch(agentDir);
  writePrivateFileAtomicSync(gitWorkflowSettingsPath(agentDir), JSON.stringify(document, null, 2));
}

/** All writes, including session adoption, serialize against defaults/pause changes. */
export async function withGitWorkflowSettingsLock<T>(agentDir: string, action: () => Promise<T>): Promise<T> {
  const path = gitWorkflowSettingsPath(agentDir);
  gitWorkflowPrivateParent(agentDir, true);
  const release = await lockfile.lock(path, { realpath: false, stale: 30_000,
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 } });
  try { return await action(); } finally { await release(); }
}

export async function projectWorkflowOverrides(
  document: GitWorkflowSettingsDocument, projectRoot: string, cwd: string, agentDir: string,
): Promise<GitWorkflowOverrides> {
  if (Object.hasOwn(document.projects, projectRoot)) return document.projects[projectRoot];
  const legacy = await getProjectGitWorkflow(cwd, gitWorkflowDefaultsPath(agentDir));
  if (!legacy) return {};
  const project: GitWorkflowOverrides = settingsFromLegacyPolicy(legacy);
  // v1 had no enablement field; importing it must not defeat Global Off.
  delete project.enabled;
  return project;
}

export async function loadGitWorkflowSettings(
  cwd?: string, entries: readonly SessionEntry[] = [], agentDir = getAgentDir(), sessionIdentity = "",
): Promise<GitWorkflowSettingsResponse> {
  const document = readGitWorkflowSettingsDocument(agentDir);
  const projectRoot = cwd ? (await resolveProject(cwd)).projectRoot : undefined;
  const project = projectRoot ? await projectWorkflowOverrides(document, projectRoot, cwd!, agentDir) : {};
  const keyed = readGitProjectSessionSettings(entries);
  // Display grouping deliberately treats repo subdirectories as projects. Live
  // restrictions must instead follow the caller's actual canonical repository.
  const needsCanonicalRestriction = keyed.size || Object.values(document.projects).some((item) => item.delivery === "pr" || item.delivery === "leave" ||
    item.enabled === false || item.commits === "off" || item.commits === "manual");
  const restrictionRoot = needsCanonicalRestriction && cwd ? await gitProjectRootForCaller(cwd) : undefined;
  const scoped = restrictionRoot ? keyed.get(restrictionRoot)?.overrides : undefined;
  const canonicalProject = restrictionRoot && Object.hasOwn(document.projects, restrictionRoot) ? document.projects[restrictionRoot] : undefined;
  const projectSessionRestrictions: NonNullable<GitWorkflowSettingsResponse["projectSessionRestrictions"]> = {
    ...(canonicalProject?.enabled === false || scoped?.enabled === false ? { enabled: false as const } : {}),
    ...(canonicalProject?.commits === "off" || scoped?.commits === "off" ? { commits: "off" as const } :
      canonicalProject?.commits === "manual" || scoped?.commits === "manual" ? { commits: "manual" as const } : {}),
    ...(canonicalProject?.delivery === "pr" || canonicalProject?.delivery === "leave" ? { delivery: canonicalProject.delivery } : {}),
    ...(scoped?.delivery === "pr" || scoped?.delivery === "leave" ? { delivery: scoped.delivery } : {}),
  };
  const saved = readManagedSessionGitWorkflow(entries);
  const session = sessionIdentity ? saved?.overrides ?? {} : null;
  const task = workflowTaskFromEntries(entries);
  const optedOut = !!sessionIdentity && saved?.optedOut === true;
  // Bind choices and identity, not unrelated transcript activity: streaming
  // must not make Global/Project saves or the safety pause perpetually stale.
  // Session append safety is separately checked against the live manager/stat.
  const revision = createHash("sha256").update(JSON.stringify({ document, projectRoot, project, cwd, sessionIdentity, session, task, optedOut, projectSessionRestrictions, writeEpoch: readGitWorkflowWriteEpoch(agentDir) })).digest("hex");
  return {
    revision, paused: document.paused, optedOut, ...(cwd ? { cwd } : {}), ...(projectRoot ? { projectRoot } : {}),
    global: document.global, project, session,
    ...(Object.keys(projectSessionRestrictions).length ? { projectSessionRestrictions } : {}),
    resolved: { global: resolveGitWorkflowSettings(document.global), project: resolveGitWorkflowSettings(document.global, project),
      session: resolveGitWorkflowSettings(document.global, project, session ?? {}) },
    task, sessionEditable: false,
  };
}
