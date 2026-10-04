import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { legacyGitWorkflowEpochIfUnchanged, readGitScopedAuthorityRevision, writeGitScopedAuthorityFile, type GitAuthorityScope, type GitAuthoritySelection } from "./git-scoped-authority";
import { bindingFields, bindingPath, readBindingFile } from "./git-workflow-binding-io";
import { loadGitProjectSettings } from "./git-project-settings";
import { revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { gitWorkflowPrivateParent, syncGitWorkflowDirectory } from "./git-workflow-write-epoch";
import { readGitWorkflowSettingsDocument, withGitWorkflowSettingsLock } from "./git-workflow-settings-store";
import { samePath } from "./paths";
import { readSessionHeader } from "./session-reader";
import type { SessionEntry } from "./types";

/** Standing decisions are metadata only. No operation gate may rely on this
 * module alone; recovery, candidate admission and dispatch are not complete. */
export const PROJECT_AUTHORIZATION_ACTIONS = ["workspace", "commit", "checks", "prepare", "integration", "cleanup"] as const;
export type ProjectAuthorizationAction = typeof PROJECT_AUTHORIZATION_ACTIONS[number];
export type ProjectAuthorizationScope = "global" | "project" | "session";
export type ProjectAuthorizationDecision = "allow" | "deny" | "inherit";
export type ProjectAuthorizationOwner = { sessionId: string; sessionFile: string; sessionCwd: string };
type Identity = { device: string; inode: string; birthtime: string };
type ProjectIdentity = { project: Identity; common: Identity };
type RecordEntry = { scope: ProjectAuthorizationScope; action: ProjectAuthorizationAction; decision: "allow" | "deny";
  projectRoot?: string; projectIdentity?: ProjectIdentity; sessionId?: string; sessionFile?: string; sessionCwd?: string;
  sessionInstance?: string; sessionPolicy?: string };
type Document = { version: 3; revision: string; grants: RecordEntry[] };
export type ProjectAuthorizationStatus = { revision: string; policyRevision: string; approvalToken: false;
  actions: Record<ProjectAuthorizationAction, { global: ProjectAuthorizationDecision; project: ProjectAuthorizationDecision | "stale";
    session: ProjectAuthorizationDecision | "stale"; effective: "allow" | "deny" | "none"; source: ProjectAuthorizationScope | "none" }> };
const MAX_GRANTS = 256;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const REVISION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SESSION_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const actionIsValid = (value: unknown): value is ProjectAuthorizationAction => PROJECT_AUTHORIZATION_ACTIONS.some((action) => action === value);
const scopeIsValid = (value: unknown): value is ProjectAuthorizationScope => value === "global" || value === "project" || value === "session";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class ProjectAuthorizationError extends Error {}
export function projectAuthorizationPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "git-project-authorizations.json");
}
function identity(value: unknown): Identity {
  const row = bindingFields(value, ["device", "inode", "birthtime"]);
  if (Object.values(row).some((part) => typeof part !== "string" || !/^[0-9]{1,30}$/.test(part))) throw new ProjectAuthorizationError("Invalid project identity");
  return row as Identity;
}
function projectIdentity(selection: GitProjectResources): ProjectIdentity {
  // Primary checkout + common Git directory stay fixed across registered
  // worktrees/branch changes; neither the chosen checkout nor branch does.
  return { project: selection.identities.project, common: selection.identities.common };
}
function validateProjectIdentity(value: unknown): ProjectIdentity {
  const row = bindingFields(value, ["project", "common"]);
  return { project: identity(row.project), common: identity(row.common) };
}
function documentFromDisk(agentDir: string): Document {
  const parent = gitWorkflowPrivateParent(agentDir);
  if (!parent) return { version: 3, revision: "none", grants: [] };
  let bytes: Buffer;
  try { bytes = readBindingFile(join(parent, "git-project-authorizations.json"), MAX_DOCUMENT_BYTES, true).bytes; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 3, revision: "none", grants: [] };
    throw error;
  }
  const data = bindingFields(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), ["version", "revision", "grants"]);
  // v2 records retain their exact actions/identity/revision; missing prepare and
  // cleanup mean no decision, never an alias of commit. Reads do not migrate disk.
  // No legacy import: v1 session-only records are not standing scoped grants.
  if ((data.version !== 2 && data.version !== 3) || typeof data.revision !== "string" || !REVISION.test(data.revision)
    || !Array.isArray(data.grants) || data.grants.length > MAX_GRANTS) throw new ProjectAuthorizationError("Unsupported project authorization document");
  const seen = new Set<string>();
  const grants = data.grants.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ProjectAuthorizationError("Invalid authorization record");
    const raw = item as Record<string, unknown>;
    if (!scopeIsValid(raw.scope) || !actionIsValid(raw.action)
      || data.version === 2 && (raw.action === "prepare" || raw.action === "cleanup")
      || (raw.decision !== "allow" && raw.decision !== "deny")) {
      throw new ProjectAuthorizationError("Invalid authorization record");
    }
    const fields = raw.scope === "global" ? ["scope", "action", "decision"] : raw.scope === "project"
      ? ["scope", "action", "decision", "projectRoot", "projectIdentity"]
      : ["scope", "action", "decision", "projectRoot", "projectIdentity", "sessionId", "sessionFile", "sessionCwd", "sessionInstance", "sessionPolicy"];
    bindingFields(raw, fields);
    const row: RecordEntry = { scope: raw.scope, action: raw.action, decision: raw.decision };
    if (raw.scope !== "global") {
      row.projectRoot = bindingPath(raw.projectRoot);
      row.projectIdentity = validateProjectIdentity(raw.projectIdentity);
    }
    if (raw.scope === "session") {
      if (typeof raw.sessionId !== "string" || !SESSION_ID.test(raw.sessionId) || typeof raw.sessionInstance !== "string"
        || !HASH.test(raw.sessionInstance) || typeof raw.sessionPolicy !== "string" || !HASH.test(raw.sessionPolicy)) {
        throw new ProjectAuthorizationError("Invalid chat authorization record");
      }
      row.sessionId = raw.sessionId;
      row.sessionFile = bindingPath(raw.sessionFile);
      row.sessionCwd = bindingPath(raw.sessionCwd);
      row.sessionInstance = raw.sessionInstance;
      row.sessionPolicy = raw.sessionPolicy;
    }
    const key = JSON.stringify([row.scope, row.projectRoot, row.sessionId, row.action]);
    if (seen.has(key)) throw new ProjectAuthorizationError("Duplicate project authorization record");
    seen.add(key);
    return row;
  });
  return { version: 3, revision: data.revision, grants };
}
function writeDocument(agentDir: string, grants: RecordEntry[], scope: GitAuthorityScope): void {
  if (grants.length > MAX_GRANTS) throw new ProjectAuthorizationError("Too many project authorizations");
  const parent = gitWorkflowPrivateParent(agentDir, true)!;
  documentFromDisk(agentDir); // Never overwrite a newer/corrupt schema.
  const bytes = JSON.stringify({ version: 3, revision: randomUUID(), grants } satisfies Document);
  if (Buffer.byteLength(bytes) > MAX_DOCUMENT_BYTES) throw new ProjectAuthorizationError("Too many project authorizations");
  writeGitScopedAuthorityFile(agentDir, join(parent, "git-project-authorizations.json"), bytes, "grants", [scope]);
  syncGitWorkflowDirectory(parent);
}
function ownerInstance(owner: ProjectAuthorizationOwner): string {
  if (!SESSION_ID.test(owner.sessionId)) throw new ProjectAuthorizationError("Select a persisted ordinary chat");
  bindingPath(owner.sessionFile); bindingPath(owner.sessionCwd);
  const header = readSessionHeader(owner.sessionFile);
  const stat = lstatSync(owner.sessionFile, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(realpathSync(owner.sessionFile), owner.sessionFile)
    || header?.id !== owner.sessionId || !samePath(header.cwd ?? "", owner.sessionCwd)) {
    throw new ProjectAuthorizationError("Chat identity changed; authorization is unavailable");
  }
  return digest({ file: owner.sessionFile, cwd: owner.sessionCwd, dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) });
}
function authorityScope(selection?: GitProjectResources, owner?: ProjectAuthorizationOwner): GitAuthoritySelection {
  return { projectRoots: selection ? [selection.projectRoot] : [], sessionId: owner?.sessionId };
}
async function context(selection: GitProjectResources | undefined, owner: ProjectAuthorizationOwner | undefined, agentDir: string) {
  const settingsScope: GitAuthoritySelection = { ...authorityScope(selection, owner), domains: ["settings"] };
  const original = readGitScopedAuthorityRevision(agentDir, settingsScope);
  let instance: string | undefined;
  let entries: SessionEntry[] = [];
  if (owner) {
    if (!selection) throw new ProjectAuthorizationError("A canonical project is required for a chat authorization");
    instance = ownerInstance(owner);
    const manager = SessionManager.open(owner.sessionFile, undefined);
    if (manager.getHeader()?.id !== owner.sessionId || !samePath(manager.getCwd(), owner.sessionCwd)) {
      throw new ProjectAuthorizationError("Chat identity changed; authorization is unavailable");
    }
    entries = manager.getEntries() as unknown as SessionEntry[];
    if (entries.some((item) => item.type === "custom" && item.customType === "pi-web:subagent")) {
      throw new ProjectAuthorizationError("Subagents cannot receive project authorizations");
    }
  }
  const settings = selection ? await loadGitProjectSettings(selection, entries, agentDir, owner?.sessionId)
    : undefined;
  const global = selection ? settings!.global : readGitWorkflowSettingsDocument(agentDir).global;
  const paused = selection ? settings!.paused : readGitWorkflowSettingsDocument(agentDir).paused;
  const values = { global, projectRoot: selection?.projectRoot, project: settings?.project,
    sessionId: owner?.sessionId, session: settings?.session, paused };
  const policyRevision = digest({ ...values, settingsGeneration: original });
  const legacyEpoch = legacyGitWorkflowEpochIfUnchanged(agentDir, settingsScope);
  const legacyPolicyRevision = legacyEpoch === undefined ? undefined : digest({ ...values, epoch: legacyEpoch });
  if (readGitScopedAuthorityRevision(agentDir, settingsScope) !== original) throw new ProjectAuthorizationError("Settings changed during authorization read");
  if (owner && ownerInstance(owner) !== instance) throw new ProjectAuthorizationError("Chat changed during authorization read");
  return { instance, policyRevision, legacyPolicyRevision, settingsGeneration: original, paused, enabled: selection ? (owner ? settings!.resolved.session.values.enabled : settings!.resolved.project.values.enabled)
    : !paused && readGitWorkflowSettingsDocument(agentDir).global.enabled !== false };
}
function status(doc: Document, selection: GitProjectResources | undefined, owner: ProjectAuthorizationOwner | undefined,
  current: Awaited<ReturnType<typeof context>>): ProjectAuthorizationStatus {
  const actions = Object.fromEntries(PROJECT_AUTHORIZATION_ACTIONS.map((action) => {
    const global = doc.grants.find((row) => row.scope === "global" && row.action === action);
    const project = selection && doc.grants.find((row) => row.scope === "project" && row.projectRoot === selection.projectRoot && row.action === action);
    const session = selection && owner && doc.grants.find((row) => row.scope === "session" && row.projectRoot === selection.projectRoot
      && row.sessionId === owner.sessionId && row.action === action);
    const projectDecision = !project ? "inherit" : JSON.stringify(project.projectIdentity) !== JSON.stringify(projectIdentity(selection!)) ? "stale" : project.decision;
    const sessionDecision = !session ? "inherit" : JSON.stringify(session.projectIdentity) !== JSON.stringify(projectIdentity(selection!))
      || session.sessionFile !== owner!.sessionFile || !samePath(session.sessionCwd!, owner!.sessionCwd)
      || session.sessionInstance !== current.instance || session.sessionPolicy !== current.policyRevision && session.sessionPolicy !== current.legacyPolicyRevision ? "stale" : session.decision;
    const source: ProjectAuthorizationScope | "none" = sessionDecision !== "inherit" ? "session" : projectDecision !== "inherit" ? "project" : global ? "global" : "none";
    const chosen = source === "session" ? sessionDecision : source === "project" ? projectDecision : global?.decision ?? "none";
    return [action, { global: global?.decision ?? "inherit", project: projectDecision, session: sessionDecision,
      // A stale specific record never falls back to a broader allow.
      effective: current.paused || !current.enabled || chosen === "stale" ? "deny" : chosen,
      source }];
  })) as ProjectAuthorizationStatus["actions"];
  // A saved record may be consumed by supported live gates, but this status
  // response is never a replayable candidate approval or execution token.
  return { revision: doc.revision, policyRevision: current.policyRevision, actions, approvalToken: false };
}
/** Fresh document/settings reads on every check. No snapshot is execution authority. */
export async function readProjectAuthorization(selection?: GitProjectResources, owner?: ProjectAuthorizationOwner,
  agentDir = getAgentDir()): Promise<ProjectAuthorizationStatus> {
  const original = readGitScopedAuthorityRevision(agentDir, authorityScope(selection, owner));
  const current = await context(selection, owner, agentDir);
  const result = status(documentFromDisk(agentDir), selection, owner, current);
  if (selection) await revalidateGitProjectResources(selection);
  if (owner && ownerInstance(owner) !== current.instance) throw new ProjectAuthorizationError("Chat changed during authorization read");
  if (readGitScopedAuthorityRevision(agentDir, authorityScope(selection, owner)) !== original) throw new ProjectAuthorizationError("Authority changed during authorization read");
  return result;
}
/** Only an explicit authenticated browser save should call this. Never invoke
 * from model tools, settings/task/proposals, or automated recovery. The HTTP
 * same-user API (including Basic clients) is NOT a model-resistant security boundary. */
export async function saveProjectAuthorization(selection: GitProjectResources | undefined, owner: ProjectAuthorizationOwner | undefined,
  scope: ProjectAuthorizationScope, action: ProjectAuthorizationAction, decision: ProjectAuthorizationDecision,
  expected: Pick<ProjectAuthorizationStatus, "revision" | "policyRevision">, agentDir = getAgentDir()): Promise<ProjectAuthorizationStatus> {
  if (!scopeIsValid(scope) || !actionIsValid(action) || !["allow", "deny", "inherit"].includes(decision)
    || scope !== "global" && !selection || scope === "session" && !owner || scope === "global" && (selection || owner)
    || scope === "project" && owner || typeof expected?.revision !== "string" || typeof expected.policyRevision !== "string") {
    throw new ProjectAuthorizationError("Invalid authorization decision");
  }
  return withGitWorkflowSettingsLock(agentDir, async () => {
    const current = await context(selection, owner, agentDir);
    const doc = documentFromDisk(agentDir);
    if (doc.revision !== expected.revision || current.policyRevision !== expected.policyRevision) {
      throw new ProjectAuthorizationError("Authorization or settings changed; review again");
    }
    if (decision === "allow" && (current.paused || !current.enabled)) throw new ProjectAuthorizationError("Cannot allow a paused or disabled workflow");
    const grants = doc.grants.filter((item) => !(item.scope === scope && item.action === action
      && (scope === "global" || item.projectRoot === selection!.projectRoot && (scope === "project" || item.sessionId === owner!.sessionId))));
    if (decision !== "inherit") grants.push({ scope, action, decision,
      ...(selection ? { projectRoot: selection.projectRoot, projectIdentity: projectIdentity(selection) } : {}),
      ...(owner ? { sessionId: owner.sessionId, sessionFile: owner.sessionFile, sessionCwd: owner.sessionCwd,
        sessionInstance: current.instance!, sessionPolicy: current.policyRevision } : {}) });
    const latest = await context(selection, owner, agentDir);
    if (latest.policyRevision !== current.policyRevision || latest.instance !== current.instance) {
      throw new ProjectAuthorizationError("Project or chat changed during authorization save");
    }
    if (selection) await revalidateGitProjectResources(selection);
    if (readGitScopedAuthorityRevision(agentDir, { ...authorityScope(selection, owner), domains: ["settings"] }) !== latest.settingsGeneration ||
      owner && ownerInstance(owner) !== latest.instance) throw new ProjectAuthorizationError("Authority changed during final authorization save");
    writeDocument(agentDir, grants, scope === "global" ? { kind: "global" } : scope === "project"
      ? { kind: "project", projectRoot: selection!.projectRoot }
      : { kind: "chat-project", projectRoot: selection!.projectRoot, sessionId: owner!.sessionId });
    return status(documentFromDisk(agentDir), selection, owner, latest);
  });
}
