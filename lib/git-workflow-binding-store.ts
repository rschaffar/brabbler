import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { createDurableGitWorkflowDirectory, syncGitWorkflowDirectory } from "./git-workflow-write-epoch";
import { validateGitWorkflowSettings } from "./git-workflow-settings";
import { validLocalBranchName } from "./git-workflow-policy";
import { validateRuleSourceSet } from "./git-workflow-rule-sources";
import { bindingFields, bindingHash, bindingPath, bindingText, GitTaskBindingError, readBindingFile, validateBindingIdentity } from "./git-workflow-binding-io";
import { gitTaskBindingRuntime, retireGitTaskBindingPreviews } from "./git-workflow-binding-runtime";
import { GIT_BINDING_LIMITS, type GitTaskBindingRecord, type GitTaskBindingSnapshot } from "./git-workflow-binding-types";

const MAX_SNAPSHOT = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = (value: unknown) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new GitTaskBindingError(); return value; };
const entryId = (value: unknown) => { const id = bindingText(value, 128); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new GitTaskBindingError(); return id; };
const uuid = (value: unknown) => { const id = bindingText(value, 36); if (!UUID.test(id)) throw new GitTaskBindingError(); return id; };
const date = (value: unknown) => { const text = bindingText(value, 30); if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) throw new GitTaskBindingError(); return text; };
export function validateGitTaskBindingSnapshot(input: unknown): GitTaskBindingSnapshot {
  const data = bindingFields(input, ["version", "owner", "workspace", "request", "settings", "settingsEntryId", "sources"]);
  if (data.version !== 1) throw new GitTaskBindingError();
  const owner = bindingFields(data.owner, ["sessionId", "sessionFile", "sessionIdentity", "headerDigest", "cwd"]);
  const workspace = bindingFields(data.workspace, ["root", "projectRoot", "branch", "gitDir", "commonDir", "rootIdentity", "gitIdentity", "commonIdentity"]);
  const request = bindingFields(data.request, ["entryId", "digest", "goal"]);
  if (!validLocalBranchName(workspace.branch)) throw new GitTaskBindingError();
  const sources = validateRuleSourceSet(data.sources);
  const root = bindingPath(workspace.root);
  if (sources.cwd !== root) throw new GitTaskBindingError();
  return { version: 1,
    owner: { sessionId: entryId(owner.sessionId), sessionFile: bindingPath(owner.sessionFile), sessionIdentity: validateBindingIdentity(owner.sessionIdentity), headerDigest: digest(owner.headerDigest), cwd: bindingPath(owner.cwd) },
    workspace: { root, projectRoot: bindingPath(workspace.projectRoot), branch: workspace.branch as string, gitDir: bindingPath(workspace.gitDir), commonDir: bindingPath(workspace.commonDir),
      rootIdentity: validateBindingIdentity(workspace.rootIdentity), gitIdentity: validateBindingIdentity(workspace.gitIdentity), commonIdentity: validateBindingIdentity(workspace.commonIdentity) },
    request: { entryId: entryId(request.entryId), digest: digest(request.digest), goal: bindingText(request.goal, GIT_BINDING_LIMITS.goal) },
    settings: validateGitWorkflowSettings(data.settings), settingsEntryId: entryId(data.settingsEntryId), sources };
}
type Head = Omit<GitTaskBindingRecord, "snapshot"> & { snapshotDigest: string };
function validateHead(input: unknown, sessionId: string): Head {
  const data = bindingFields(input, ["version", "id", "generation", "sessionId", "state", "processEpoch", "reviewOrigin", "invalidatedBy", "adoptedAt", "updatedAt", "snapshotDigest"]);
  if (data.version !== 1 || data.sessionId !== sessionId || !Number.isSafeInteger(data.generation) || (data.generation as number) < 1
    || !["adopted", "released", "invalidated"].includes(data.state as string) || data.reviewOrigin !== "workflow-home"
    || ![null, "session-move", "settings-capture"].includes(data.invalidatedBy as null)
    || (data.state === "invalidated") !== (data.invalidatedBy !== null)) throw new GitTaskBindingError();
  return { version: 1, id: uuid(data.id), generation: data.generation as number, sessionId, state: data.state as Head["state"],
    processEpoch: uuid(data.processEpoch), reviewOrigin: "workflow-home", invalidatedBy: data.invalidatedBy as Head["invalidatedBy"],
    adoptedAt: date(data.adoptedAt), updatedAt: date(data.updatedAt), snapshotDigest: digest(data.snapshotDigest) };
}
function inspectDirectory(dir: string, privateDirectory: boolean, create: boolean): boolean {
  if (create) createDurableGitWorkflowDirectory(dir);
  let stat;
  try { stat = lstatSync(dir); } catch (cause) { if (!create && (cause as NodeJS.ErrnoException).code === "ENOENT") return false; throw cause; }
  if (!stat.isDirectory() || stat.isSymbolicLink() || typeof process.getuid === "function" && stat.uid !== process.getuid()
    || privateDirectory && (stat.mode & 0o077) !== 0) throw new GitTaskBindingError();
  return true;
}
/** Only application-owned directories beneath the selected agent directory; no transcript-derived path. */
function directory(sessionId: string, agentDir: string, create = false): string | null {
  entryId(sessionId);
  let dir = realpathSync(agentDir);
  for (const [part, privateDirectory] of [["pi-web", false], ["git-task-bindings", true], ["v1", true], [bindingHash(sessionId), true]] as const) {
    dir = join(dir, part);
    // Existence alone does not prove that an earlier mkdir's parent fsync
    // succeeded. Every write re-establishes all namespace-entry barriers.
    if (!inspectDirectory(dir, privateDirectory, create)) return null;
  }
  return dir;
}
export interface GitTaskBindingStored { revision: string; record: GitTaskBindingRecord | null }
export function readGitTaskBinding(sessionId: string, agentDir = getAgentDir()): GitTaskBindingStored {
  try {
    const dir = directory(sessionId, agentDir);
    if (!dir) return { revision: "none", record: null };
    // A present namespace without its head is damaged/incomplete, not permission
    // to revive a snapshot or silently reset a generation to zero.
    const { bytes } = readBindingFile(join(dir, "current.json"), 16 * 1024, true);
    const head = validateHead(JSON.parse(bytes.toString("utf8")), sessionId);
    const artifact = readBindingFile(join(dir, `${head.id}.json`), MAX_SNAPSHOT, true).bytes;
    if (bindingHash(artifact) !== head.snapshotDigest) throw new GitTaskBindingError();
    const snapshot = validateGitTaskBindingSnapshot(JSON.parse(artifact.toString("utf8")));
    if (snapshot.owner.sessionId !== sessionId) throw new GitTaskBindingError();
    const { snapshotDigest, ...record } = head;
    void snapshotDigest;
    return { revision: bindingHash(bytes), record: { ...record, snapshot } };
  } catch { throw new GitTaskBindingError(); }
}
function publish(dir: string, head: Head): void {
  writePrivateFileAtomicSync(join(dir, "current.json"), JSON.stringify(head));
  syncGitWorkflowDirectory(dir);
}
function nextGeneration(before: GitTaskBindingStored): number {
  const value = (before.record?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(value)) throw new GitTaskBindingError();
  return value;
}
/** Caller holds withGitWorkflowSettingsLock, shared with capture/move invalidation. */
export function adoptGitTaskBinding(snapshot: GitTaskBindingSnapshot, expectedRevision: string, agentDir = getAgentDir()): GitTaskBindingStored {
  const checked = validateGitTaskBindingSnapshot(snapshot), sessionId = checked.owner.sessionId;
  const before = readGitTaskBinding(sessionId, agentDir);
  if (before.revision !== expectedRevision) throw new GitTaskBindingError("Task binding changed elsewhere. Review a new candidate.");
  const id = randomUUID(), now = new Date().toISOString();
  const bytes = JSON.stringify(checked);
  if (Buffer.byteLength(bytes) > MAX_SNAPSHOT) throw new GitTaskBindingError();
  const dir = directory(sessionId, agentDir, true)!;
  // Immutable evidence first, atomic current-generation publication second.
  // Failed/orphan artifacts are retained; never reconstruct a head from them.
  writeFileSync(join(dir, `${id}.json`), bytes, { flag: "wx", mode: 0o600, flush: true });
  syncGitWorkflowDirectory(dir);
  publish(dir, { version: 1, id, generation: nextGeneration(before), sessionId, state: "adopted", processEpoch: gitTaskBindingRuntime().epoch,
    reviewOrigin: "workflow-home", invalidatedBy: null, adoptedAt: now, updatedAt: now, snapshotDigest: bindingHash(bytes) });
  return readGitTaskBinding(sessionId, agentDir);
}
/** A durable tombstone, never deletion. Caller holds withGitWorkflowSettingsLock. */
export function retireGitTaskBinding(sessionId: string, expectedRevision: string | undefined, reason: Head["invalidatedBy"], agentDir = getAgentDir()): GitTaskBindingStored {
  retireGitTaskBindingPreviews([sessionId]);
  const before = readGitTaskBinding(sessionId, agentDir);
  if (expectedRevision !== undefined && before.revision !== expectedRevision) throw new GitTaskBindingError("Task binding changed elsewhere. Reload its status.");
  if (!before.record || before.record.state !== "adopted") return before;
  const dir = directory(sessionId, agentDir)!;
  const { bytes } = readBindingFile(join(dir, "current.json"), 16 * 1024, true);
  if (bindingHash(bytes) !== before.revision) throw new GitTaskBindingError();
  const head = validateHead(JSON.parse(bytes.toString("utf8")), sessionId);
  publish(dir, { ...head, generation: nextGeneration(before), state: reason ? "invalidated" : "released", invalidatedBy: reason, updatedAt: new Date().toISOString() });
  return readGitTaskBinding(sessionId, agentDir);
}
