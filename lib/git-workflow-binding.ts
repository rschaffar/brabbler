import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { samePath, toNativePath } from "./paths";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { readHumanGitSessionManager, type HumanGitScope } from "./git-action-human";
import { getRpcSession } from "./rpc-manager";
import { readSessionHeader, resolveSessionPath } from "./session-reader";
import { gitExecEnv } from "./git-exec";
import { selectGitWorkspace } from "./git-workspace-selector";
import { GIT_WORKFLOW_TYPE, validLocalBranchName } from "./git-workflow-policy";
import { loadGitWorkflowSettings, withGitWorkflowSettingsLock } from "./git-workflow-settings-store";
import { workflowTaskFromEntries } from "./git-workflow-session";
import { captureGitRuleSources, gitRuleSourceDocuments } from "./git-workflow-rule-sources";
import { bindingDigest, bindingPathIdentity, bindingText, GitTaskBindingError } from "./git-workflow-binding-io";
import { adoptGitTaskBinding, readGitTaskBinding, retireGitTaskBinding, type GitTaskBindingStored } from "./git-workflow-binding-store";
import { gitTaskBindingRuntime, retireGitTaskBindingPreviews } from "./git-workflow-binding-runtime";
import { GIT_BINDING_LIMITS, type GitBindingWorkspace, type GitRuleSourceTarget, type GitTaskBindingPreview, type GitTaskBindingRecord,
  type GitTaskBindingResponse, type GitTaskBindingSnapshot, type GitTaskBindingStatus, type GitTaskBindingSummary } from "./git-workflow-binding-types";
import type { SessionEntry } from "./types";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  try { return (await exec("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", env: gitExecEnv(), timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout.trim(); }
  catch { throw new GitTaskBindingError("Physical registered local-branch checkout information is unavailable."); }
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new GitTaskBindingError("A persisted session is required.", 400);
  return value;
}
async function context(sessionId: string, idle = false) {
  id(sessionId);
  const file = await resolveSessionPath(sessionId);
  const header = file ? readSessionHeader(file) : null;
  if (!file || header?.id !== sessionId) throw new GitTaskBindingError("Select a persisted ordinary chat for task binding.");
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(header.cwd, roots)) throw new GitTaskBindingError("Session checkout is outside allowed roots or unavailable.", 403);
  const cwd = realpathSync(header.cwd);
  if (!samePath(cwd, header.cwd)) throw new GitTaskBindingError("A physical saved session checkout is required.");
  const scope: HumanGitScope = { sessionId, sessionFile: file, cwd };
  const manager = readHumanGitSessionManager(scope);
  const entries = manager.getEntries() as unknown as SessionEntry[];
  if (entries.some((entry) => entry.type === "custom" && entry.customType === "pi-web:subagent")) throw new GitTaskBindingError("Subagents cannot adopt task bindings.");
  if (idle && getRpcSession(sessionId)?.isRunning()) throw new GitTaskBindingError("Stop the chat before reviewing or adopting a task binding.");
  const owner = { sessionId, sessionFile: file, sessionIdentity: bindingPathIdentity(file), headerDigest: bindingDigest(manager.getHeader()), cwd };
  return { scope, manager, entries, owner, roots };
}
type Context = Awaited<ReturnType<typeof context>>;
async function registeredWorkspaces(cwd: string) {
  const output = await git(cwd, "worktree", "list", "--porcelain", "-z");
  const entries: { path: string; branch?: string; unavailable: boolean }[] = [];
  let entry: (typeof entries)[number] | undefined;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) { entry = { path: toNativePath(field.slice(9)), unavailable: false }; entries.push(entry); }
    else if (entry && field.startsWith("branch refs/heads/")) entry.branch = field.slice("branch refs/heads/".length);
    else if (entry && (field === "bare" || field.startsWith("prunable"))) entry.unavailable = true;
  }
  if (!entries.length || entries.length > 128) throw new GitTaskBindingError("Registered checkout inventory is unavailable or too large.");
  return entries;
}
/** Fresh identity, never the cached display/grouping resolver. HEAD OID is not a permanent task lock. */
export async function captureGitBindingWorkspace(sessionCwd: string, branch?: string): Promise<GitBindingWorkspace> {
  const root = await selectGitWorkspace(sessionCwd, branch);
  const registered = await registeredWorkspaces(root);
  const selected = registered.filter((item) => samePath(item.path, root) && !item.unavailable);
  if (selected.length !== 1 || !validLocalBranchName(selected[0].branch)) throw new GitTaskBindingError("A registered checkout on a local branch is required.");
  const actualBranch = (await git(root, "symbolic-ref", "--quiet", "HEAD")).replace(/^refs\/heads\//, "");
  if (actualBranch !== selected[0].branch || branch !== undefined && branch !== actualBranch) throw new GitTaskBindingError("Workspace branch changed. Review the checkout again.");
  const gitDir = toNativePath(await git(root, "rev-parse", "--absolute-git-dir"));
  const commonDir = toNativePath(await git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"));
  const projectRoot = registered[0].path;
  if (registered[0].unavailable || !samePath(dirname(commonDir), projectRoot) || !samePath(join(projectRoot, ".git"), commonDir)) {
    throw new GitTaskBindingError("This task-binding slice requires an ordinary repository with a registered main checkout.");
  }
  return { root, projectRoot, branch: actualBranch, gitDir, commonDir,
    rootIdentity: bindingPathIdentity(root, true), gitIdentity: bindingPathIdentity(gitDir, true), commonIdentity: bindingPathIdentity(commonDir, true) };
}
function taskCapture(ctx: Context) {
  const task = workflowTaskFromEntries(ctx.entries);
  if (task.kind !== "managed") throw new GitTaskBindingError("Apply saved settings to this task before reviewing a binding.");
  const entry = [...ctx.entries].reverse().find((entry) => entry.type === "custom" && entry.customType === GIT_WORKFLOW_TYPE && (entry.data as { version?: unknown })?.version === 2);
  if (!entry?.id) throw new GitTaskBindingError("Captured task settings are unavailable.");
  return { settings: task.settings, settingsEntryId: entry.id };
}
function origin(ctx: Context, entryId: string) {
  const request = ctx.manager.getBranch().find((entry) => entry.id === entryId);
  if (request?.type !== "message" || request.message.role !== "user") throw new GitTaskBindingError("Select a user request on this chat's current branch.");
  return request;
}
function summary(record: GitTaskBindingRecord): GitTaskBindingSummary {
  return { id: record.id, generation: record.generation, state: record.state, goal: record.snapshot.request.goal,
    requestEntryId: record.snapshot.request.entryId, workspace: record.snapshot.workspace.root, branch: record.snapshot.workspace.branch, adoptedAt: record.adoptedAt,
    sources: gitRuleSourceDocuments(record.snapshot.sources).map(({ path, digest, role }) => ({ path, digest, role })) };
}
async function checkedStatus(ctx: Context, stored: GitTaskBindingStored, agentDir: string): Promise<GitTaskBindingStatus> {
  const { record, revision } = stored;
  if (!record) return { status: "none", revision, reason: "No private task binding. Captured settings and copied history are not adoption." };
  const own = bindingDigest(record.snapshot.owner) === bindingDigest(ctx.owner);
  const base = { revision, ...(own ? { binding: summary(record) } : {}) };
  if (record.state === "released") return { ...base, status: "released", reason: "The task binding was released. A new review is required." };
  if (record.state === "invalidated") return { ...base, status: "stale", reason: "The task binding was invalidated by a session move or a new settings capture. Review a new binding." };
  if (!own) return { ...base, status: "stale", reason: "Session file or checkout identity changed. A copy, import or move cannot inherit this binding." };
  if (record.processEpoch !== gitTaskBindingRuntime().epoch) return { ...base, status: "reconciliation-required", reason: "Saved review evidence survived a server restart. Review and adopt again; nothing was resumed." };
  try {
    const workspace = await captureGitBindingWorkspace(ctx.owner.cwd, record.snapshot.workspace.branch);
    const task = taskCapture(ctx);
    if (bindingDigest(workspace) !== bindingDigest(record.snapshot.workspace) || bindingDigest(task.settings) !== bindingDigest(record.snapshot.settings)
      || !ctx.manager.getEntry(record.snapshot.settingsEntryId) || bindingDigest(origin(ctx, record.snapshot.request.entryId)) !== record.snapshot.request.digest) throw new Error("changed");
    const sources = captureGitRuleSources({ workspace, agentDir, allowedDependencyRoots: ctx.roots,
      dependencies: record.snapshot.sources.sources.filter((item) => item.role === "dependency").map((item) => item.path),
      targets: gitRuleSourceDocuments(record.snapshot.sources).filter((item) => !samePath(item.path, item.realPath)).map(({ path, realPath }) => ({ path, realPath })) });
    if (sources.digest !== record.snapshot.sources.digest) throw new Error("changed");
    return { ...base, status: "current", reason: "Task and source review match this process's current observations. This is not execution permission or exclusive workspace ownership." };
  } catch { return { ...base, status: "stale", reason: "Task, checkout, request or instruction sources changed or could not be inspected. Review a new binding." }; }
}
export async function getGitTaskBindingStatus(sessionId: string, agentDir = getAgentDir()): Promise<GitTaskBindingStatus> {
  try { return await checkedStatus(await context(sessionId), readGitTaskBinding(sessionId, agentDir), agentDir); }
  catch { return { status: "unavailable", revision: "unavailable", reason: "Private task binding cannot be inspected safely. It supplies no execution authority." }; }
}
export async function getGitTaskBinding(sessionId: string, agentDir = getAgentDir()): Promise<GitTaskBindingResponse> {
  const ctx = await context(sessionId);
  const status = await getGitTaskBindingStatus(sessionId, agentDir);
  const requests = ctx.manager.getBranch().filter((entry) => entry.type === "message" && entry.message.role === "user").slice(-30).reverse().map((entry) => {
    const content = entry.type === "message" && entry.message.role === "user" ? entry.message.content : "";
    const text = typeof content === "string" ? content : content.flatMap((item) => item.type === "text" ? [item.text] : []).join(" ");
    return { entryId: entry.id, label: text.replace(/\s+/g, " ").slice(0, 160) || "User request" };
  });
  let workspaces: GitTaskBindingResponse["workspaces"] = [], reason: string | undefined;
  try {
    if (status.status === "unavailable") throw new GitTaskBindingError(status.reason);
    taskCapture(ctx);
    if (process.platform !== "linux") throw new GitTaskBindingError("Secure source review is currently available only with Linux descriptor-relative reads.");
    if (getRpcSession(sessionId)?.isRunning()) throw new GitTaskBindingError("Stop the chat before reviewing or adopting a task binding.");
    if (!requests.length) throw new GitTaskBindingError("A user request on the current branch is required.");
    await selectGitWorkspace(ctx.owner.cwd);
    workspaces = (await registeredWorkspaces(ctx.owner.cwd)).filter((item) => !item.unavailable && item.branch && isExistingFilePathAllowed(item.path, ctx.roots))
      .map((item) => ({ branch: item.branch!, path: item.path }));
    if (!workspaces.length) throw new GitTaskBindingError("No eligible registered local-branch checkout is available.");
  } catch (cause) { reason = cause instanceof GitTaskBindingError ? cause.message : "Task binding setup is unavailable for this checkout."; }
  return { status, editable: !reason, ...(reason ? { reason } : {}), requests, workspaces };
}
export interface GitTaskBindingInput {
  sessionId: string; revision: string; settingsRevision: string; workspaceBranch: string; requestEntryId: string; goal: string;
  dependencies: string[]; targets: GitRuleSourceTarget[];
}
export async function previewGitTaskBinding(input: GitTaskBindingInput, agentDir = getAgentDir()): Promise<GitTaskBindingPreview> {
  const ctx = await context(input.sessionId, true);
  const selected = await captureGitBindingWorkspace(ctx.owner.cwd, input.workspaceBranch);
  return withGitWorkflowSettingsLock(agentDir, async () => {
    const workspace = await captureGitBindingWorkspace(ctx.owner.cwd, input.workspaceBranch);
    if (bindingDigest(workspace) !== bindingDigest(selected)) throw new GitTaskBindingError("Workspace changed before preview. Review again.");
    const stored = readGitTaskBinding(input.sessionId, agentDir);
    if (stored.revision !== input.revision) throw new GitTaskBindingError("Task binding changed elsewhere. Reload its status.");
    const fresh = await context(input.sessionId, true);
    const settings = await loadGitWorkflowSettings(fresh.owner.cwd, fresh.entries, agentDir, input.sessionId);
    if (settings.revision !== input.settingsRevision) throw new GitTaskBindingError("Saved settings changed. Reload them before reviewing a binding.");
    const task = taskCapture(fresh);
    if (task.settings.workspace === "worktree" && samePath(workspace.gitDir, workspace.commonDir)
      || task.settings.workspace === "current" && task.settings.branch && task.settings.branch !== workspace.branch) throw new GitTaskBindingError("Selected checkout does not match the captured workspace settings.");
    const request = origin(fresh, id(input.requestEntryId));
    const goal = bindingText(input.goal.trim(), GIT_BINDING_LIMITS.goal);
    const sources = captureGitRuleSources({ workspace, agentDir, dependencies: input.dependencies, targets: input.targets, allowedDependencyRoots: fresh.roots });
    const snapshot: GitTaskBindingSnapshot = { version: 1, owner: fresh.owner, workspace, request: { entryId: request.id, digest: bindingDigest(request), goal }, ...task, sources };
    const headOid = await git(workspace.root, "rev-parse", "--verify", "HEAD^{commit}");
    if (bindingDigest((await context(input.sessionId, true)).owner) !== bindingDigest(fresh.owner)) throw new GitTaskBindingError("Session changed before preview. Review again.");
    const runtime = gitTaskBindingRuntime();
    retireGitTaskBindingPreviews([input.sessionId]);
    if (runtime.previews.size >= 128) throw new GitTaskBindingError("Too many pending task reviews. Close or cancel an existing preview.");
    const previewId = randomUUID();
    runtime.previews.set(previewId, { sessionId: input.sessionId, revision: stored.revision, settingsRevision: settings.revision, headOid, snapshot: structuredClone(snapshot) });
    return { previewId, snapshot };
  });
}
export async function confirmGitTaskBinding(sessionId: string, previewId: string, agentDir = getAgentDir()): Promise<GitTaskBindingResponse> {
  const pending = gitTaskBindingRuntime().previews.get(previewId);
  if (!pending || pending.sessionId !== sessionId) throw new GitTaskBindingError("Task review is unavailable or was replaced. Prepare a new preview.");
  // Consume before awaits. Failed/ambiguous responses must be reconciled by GET, never retried blindly.
  gitTaskBindingRuntime().previews.delete(previewId);
  await withGitWorkflowSettingsLock(agentDir, async () => {
    const ctx = await context(sessionId, true);
    const settings = await loadGitWorkflowSettings(ctx.owner.cwd, ctx.entries, agentDir, sessionId);
    const workspace = await captureGitBindingWorkspace(ctx.owner.cwd, pending.snapshot.workspace.branch);
    const task = taskCapture(ctx);
    const request = origin(ctx, pending.snapshot.request.entryId);
    const sources = captureGitRuleSources({ workspace, agentDir, allowedDependencyRoots: ctx.roots,
      dependencies: pending.snapshot.sources.sources.filter((item) => item.role === "dependency").map((item) => item.path),
      targets: gitRuleSourceDocuments(pending.snapshot.sources).filter((item) => !samePath(item.path, item.realPath)).map(({ path, realPath }) => ({ path, realPath })) });
    const fresh = { version: 1, owner: ctx.owner, workspace, request: { entryId: request.id, digest: bindingDigest(request), goal: pending.snapshot.request.goal }, ...task, sources };
    if (settings.revision !== pending.settingsRevision || bindingDigest(fresh) !== bindingDigest(pending.snapshot)
      || await git(workspace.root, "rev-parse", "--verify", "HEAD^{commit}") !== pending.headOid) throw new GitTaskBindingError("Task review is stale. No binding was adopted; prepare a new preview.");
    // Final synchronous session/source read before publication; no human wait or Git mutation here.
    const manager = readHumanGitSessionManager(ctx.scope);
    if (bindingDigest(manager.getHeader()) !== ctx.owner.headerDigest || bindingDigest(bindingPathIdentity(ctx.scope.sessionFile)) !== bindingDigest(ctx.owner.sessionIdentity)
      || getRpcSession(sessionId)?.isRunning()) throw new GitTaskBindingError("Session changed before adoption.");
    const finalSources = captureGitRuleSources({ workspace, agentDir, allowedDependencyRoots: ctx.roots,
      dependencies: sources.sources.filter((item) => item.role === "dependency").map((item) => item.path),
      targets: gitRuleSourceDocuments(sources).filter((item) => !samePath(item.path, item.realPath)).map(({ path, realPath }) => ({ path, realPath })) });
    if (finalSources.digest !== pending.snapshot.sources.digest) throw new GitTaskBindingError("Instruction sources changed before adoption. Preview again.");
    adoptGitTaskBinding(pending.snapshot, pending.revision, agentDir);
  });
  return getGitTaskBinding(sessionId, agentDir);
}
export async function releaseGitTaskBinding(sessionId: string, revision: string, agentDir = getAgentDir()): Promise<GitTaskBindingResponse> {
  await withGitWorkflowSettingsLock(agentDir, async () => {
    await context(sessionId); // A restrictive release is allowed while a chat is running.
    retireGitTaskBinding(sessionId, revision, null, agentDir);
  });
  return getGitTaskBinding(sessionId, agentDir);
}
export function cancelGitTaskBindingPreview(sessionId: string, previewId: string): void {
  if (gitTaskBindingRuntime().previews.get(previewId)?.sessionId === sessionId) gitTaskBindingRuntime().previews.delete(previewId);
}
