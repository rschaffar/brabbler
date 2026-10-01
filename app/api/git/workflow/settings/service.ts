import { realpathSync, statSync } from "node:fs";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { samePath } from "@/lib/paths";
import { getRpcSession } from "@/lib/rpc-manager";
import { isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { retireGitTaskBinding } from "@/lib/git-workflow-binding-store";
import { gitTaskBindingRuntime } from "@/lib/git-workflow-binding-runtime";
import { advanceGitWorkflowWriteEpoch } from "@/lib/git-workflow-write-epoch";
import { validateGitWorkflowOverrides, validateGitWorkflowScopeOverrides } from "@/lib/git-workflow-settings";
import { selectGitProjectResources, revalidateGitProjectResources, GitProjectResourceError } from "@/lib/git-project-resources";
import { loadGitProjectSettings } from "@/lib/git-project-settings";
import { appendGitProjectSessionSettings, readGitProjectSessionSettings } from "@/lib/git-project-session";
import { managedGitPermissions } from "@/lib/git-workflow-permissions";
import { managedGitSessionFacts } from "@/lib/git-workflow-access";
import { appendManagedSessionGitWorkflow, workflowTaskFromEntries } from "@/lib/git-workflow-session";
import { loadGitWorkflowSettings, readGitWorkflowSettingsDocument, withGitWorkflowSettingsLock, writeGitWorkflowSettingsDocument } from "@/lib/git-workflow-settings-store";
import { invalidateSessionListCache, invalidateSessionManagerCache, readLatestSessionEntryId, readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export class SettingsError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
async function allowedCwd(input: unknown): Promise<string> {
  if (typeof input !== "string" || !input || input !== input.trim() || (!input.startsWith("/") && !isWindowsAbsolutePath(input))) {
    throw new SettingsError("cwd must be an absolute directory", 400);
  }
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(input, roots) || !isExistingFilePathAllowed(input, roots)) throw new SettingsError("Access denied", 403);
  if (!statSync(input).isDirectory()) throw new SettingsError("Directory not found", 404);
  return realpathSync(input);
}
export async function target(input: Record<string, unknown>) {
  if (input.projectPath !== undefined && input.cwd !== undefined) throw new SettingsError("Use projectPath or legacy cwd, not both", 400);
  const selection = input.projectPath === undefined ? undefined : await selectGitProjectResources(input.projectPath as string);
  if (input.sessionId === undefined) return { cwd: selection?.cwd ?? (input.cwd === undefined ? undefined : await allowedCwd(input.cwd)), selection };
  if (input.cwd !== undefined || typeof input.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.sessionId)) {
    throw new SettingsError("Use a sessionId or a cwd, not both", 400);
  }
  const id = input.sessionId;
  const file = await resolveSessionPath(id);
  if (!file) throw new SettingsError("Session not persisted", 409);
  const header = readSessionHeader(file);
  if (!header || header.id !== id || !header.cwd) throw new SettingsError("Session identity mismatch");
  const cwd = await allowedCwd(header.cwd);
  const live = getRpcSession(id);
  const manager = live?.isAlive() && live.sessionFile === file ? live.inner.sessionManager : SessionManager.open(file, undefined);
  if (manager.getHeader()?.id !== id || !samePath(manager.getCwd(), cwd)) throw new SettingsError("Session identity mismatch");
  const latest = readLatestSessionEntryId(file);
  if (latest && !manager.getEntry(latest)) throw new SettingsError("Session was changed by another editor");
  return { cwd: selection?.cwd ?? cwd, sessionCwd: cwd, selection, id, file, live, manager, stat: statSync(file) };
}
type Target = Awaited<ReturnType<typeof target>>;
const entriesOf = (t: Target) => (t.manager?.getEntries() ?? []) as unknown as SessionEntry[];
function sessionReason(t: Target): string | undefined {
  if (!t.manager || !t.file || !t.id) return "Select a persisted chat to edit session settings.";
  if (entriesOf(t).some((e) => e.type === "custom" && e.customType === "pi-web:subagent")) return "Subagent workflows are read-only.";
  if (t.live?.isRunning()) return "Stop the chat before changing its session settings.";
  if (isGitCheckoutGated(t.cwd!) || t.sessionCwd && isGitCheckoutGated(t.sessionCwd)) return "Checkout is busy with a Git transaction.";
}
export async function responseFor(t: Target) {
  const result = t.selection ? await loadGitProjectSettings(t.selection, entriesOf(t), getAgentDir(), t.id)
    : await loadGitWorkflowSettings(t.cwd, entriesOf(t), getAgentDir(), t.id);
  const reason = sessionReason(t);
  // Never start a wrapper to report permission facts. A disk-only session with
  // no pinned tools remains unknown until its effective SDK selection is loaded.
  const tools = t.live?.isAlive() && t.live.sessionFile === t.file ? t.live.inner.getActiveToolNames() : undefined;
  const permissions = t.id ? managedGitPermissions(result, managedGitSessionFacts(entriesOf(t), tools)) : undefined;
  return { ...result, permissions, sessionEditable: !reason, ...(reason ? { sessionReason: reason } : {}) };
}
function failure(cause: unknown) {
  if (cause instanceof GitProjectResourceError) return NextResponse.json({ error: cause.message, code: cause.code },
    { status: cause.code === "access-denied" ? 403 : cause.code === "invalid-selection" ? 400 : 409 });
  return NextResponse.json({ error: cause instanceof SettingsError ? cause.message : "Workflow settings unavailable; inspect configuration before retrying." },
    { status: cause instanceof SettingsError ? cause.status : 409 });
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    if ([...params.keys()].some((key) => !["cwd", "sessionId", "projectPath"].includes(key))) throw new SettingsError("Unknown query field", 400);
    return NextResponse.json(await responseFor(await target(Object.fromEntries(params))));
  } catch (cause) { return failure(cause); }
}
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new SettingsError("JSON body required", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); throw new SettingsError("Settings request too large", 413); }
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!record(parsed)) throw new Error("Invalid object");
    return parsed;
  } catch (cause) {
    if (cause instanceof SettingsError) throw cause;
    throw new SettingsError("Invalid JSON settings request", 400);
  } finally { reader.releaseLock(); }
}
export async function applyWorkflowSettings(input: Record<string, unknown>,
  prepare?: (t: Target, before: Awaited<ReturnType<typeof responseFor>>) => Promise<Record<string, unknown>>,
  onWritten?: () => void): Promise<NextResponse> {
    const scope = input.scope;
    if (typeof scope !== "string" || !["global", "project", "session", "pause", "task"].includes(scope) || typeof input.revision !== "string") {
      throw new SettingsError("Scope and revision required", 400);
    }
    const allowed = ["scope", "revision", "cwd", "sessionId", "projectPath", ...(scope === "pause" ? ["paused"] : scope === "task" ? [] : ["overrides"])];
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw new SettingsError("Unknown settings field", 400);
    if (!prepare && scope !== "pause" && scope !== "task") {
      try { validateGitWorkflowOverrides(input.overrides); }
      catch (cause) { throw new SettingsError(cause instanceof Error ? cause.message : "Invalid overrides", 400); }
    }
    if (!prepare && scope === "pause" && typeof input.paused !== "boolean") throw new SettingsError("paused must be boolean", 400);
    return await withGitWorkflowSettingsLock(getAgentDir(), async () => {
      const t = await target(input);
      const before = await responseFor(t);
      if (input.revision !== before.revision) throw new SettingsError("Settings changed elsewhere. Reload saved values before saving your draft.");
      const prepared = prepare ? await prepare(t, before) : input;
      if (prepared.scope !== scope || prepared.revision !== input.revision) throw new SettingsError("Settings proposal changed its destination");
      let overrides;
      if (scope !== "pause" && scope !== "task") {
        try { overrides = validateGitWorkflowOverrides(prepared.overrides); }
        catch (cause) { throw new SettingsError(cause instanceof Error ? cause.message : "Invalid overrides", 400); }
      }
      if (scope !== "pause" && scope !== "task") {
        try { overrides = validateGitWorkflowScopeOverrides(overrides, scope as "global" | "project" | "session", before[scope as "global" | "project" | "session"] ?? {}); }
        catch (cause) { throw new SettingsError(cause instanceof Error ? cause.message : "Invalid scoped overrides", 400); }
      }
      if (scope === "pause" && typeof prepared.paused !== "boolean") throw new SettingsError("paused must be boolean", 400);
      if (scope === "task" && t.selection) throw new SettingsError("Explicit-project settings do not capture or adopt a task", 400);
      if (t.selection) await revalidateGitProjectResources(t.selection);
      // Even an Off/Pause -> On round trip cannot revive an old metadata review.
      // This affects only task-adoption previews, never existing Git approvals.
      gitTaskBindingRuntime().previews.clear();
      if (scope === "session" || scope === "task") {
        const reason = sessionReason(t);
        if (reason) throw new SettingsError(reason);
        const now = statSync(t.file!);
        if (now.size !== t.stat!.size || now.mtimeMs !== t.stat!.mtimeMs || now.ino !== t.stat!.ino) throw new SettingsError("Session was changed by another editor");
        if (t.selection) {
          const projects = readGitProjectSessionSettings(entriesOf(t));
          if (!projects.has(t.selection.projectRoot) && projects.size >= 256) throw new SettingsError("Too many project-scoped chat settings");
        }
        advanceGitWorkflowWriteEpoch(getAgentDir());
        if (t.selection) appendGitProjectSessionSettings(t.manager!, t.selection.projectRoot, overrides!);
        else {
          if (scope === "task") retireGitTaskBinding(t.id!, undefined, "settings-capture", getAgentDir());
          appendManagedSessionGitWorkflow(t.manager!, scope === "session" ? overrides! : before.session ?? {},
            scope === "task" ? { kind: "managed", settings: before.resolved.session.values } : workflowTaskFromEntries(entriesOf(t)));
        }
        invalidateSessionManagerCache(t.file!);
        invalidateSessionListCache();
      } else {
        const doc = readGitWorkflowSettingsDocument();
        if (scope === "global") doc.global = overrides!;
        else if (scope === "pause") doc.paused = prepared.paused as boolean;
        else {
          if (!before.projectRoot) throw new SettingsError("Select a project before saving project defaults", 400);
          // An explicit empty object is reset-to-inherit, not re-import old defaults.
          doc.projects[before.projectRoot] = overrides!;
        }
        writeGitWorkflowSettingsDocument(doc);
      }
      // A post-write status read can fail. Do not report an applied proposal as
      // an untouched stale candidate after the write has already completed.
      onWritten?.();
      return NextResponse.json(await responseFor(t));
    });
}
export async function PUT(req: Request) {
  try { return await applyWorkflowSettings(await readBody(req)); }
  catch (cause) { return failure(cause); }
}
export { failure as workflowSettingsFailure };
