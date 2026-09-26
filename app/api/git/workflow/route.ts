import { realpathSync, statSync } from "node:fs";
import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { appendSessionGitWorkflow, readSessionGitWorkflow, validateGitWorkflowPolicy } from "@/lib/git-workflow-policy";
import { isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { getProjectGitWorkflow, setProjectGitWorkflow } from "@/lib/git-workflow-store";
import { getRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, invalidateSessionManagerCache, readLatestSessionEntryId, readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { SUBAGENT_META_TYPE } from "@/lib/subagents";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function checkCwd(cwd: unknown) {
  if (typeof cwd !== "string" || !cwd.trim() || (!cwd.trim().startsWith("/") && !isWindowsAbsolutePath(cwd.trim()))) {
    return { response: error("cwd must be an absolute path", 400) };
  }
  const target = cwd.trim();
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(target, roots)) return { response: error("Access denied", 403) };
  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(target); }
  catch { return { response: error("Directory not found", 404) }; }
  if (!stat.isDirectory()) return { response: error("Not a directory", 400) };
  if (!isExistingFilePathAllowed(target, roots)) return { response: error("Access denied", 403) };
  return { cwd: target };
}

async function sessionTarget(sessionId: unknown) {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId !== sessionId.trim()) {
    return { response: error("Valid sessionId required", 400) };
  }
  const file = await resolveSessionPath(sessionId);
  if (!file) return { response: error("Session not found", 404) };
  let header: ReturnType<typeof readSessionHeader>;
  try { header = readSessionHeader(file); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { response: error("Session not persisted", 409) };
    throw cause;
  }
  if (!header || header.id !== sessionId || !header.cwd) return { response: error("Session identity mismatch", 409) };
  const checked = await checkCwd(header.cwd);
  if (checked.response) return { response: checked.response };
  return { file, cwd: checked.cwd };
}

function sessionEntries(manager: SessionManager): SessionEntry[] {
  return manager.getEntries() as unknown as SessionEntry[];
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("sessionId");
    const suppliedCwd = params.get("cwd");
    if (id !== null) {
      const target = await sessionTarget(id);
      if (target.response) return target.response;
      if (suppliedCwd !== null) {
        const checked = await checkCwd(suppliedCwd);
        if (checked.response) return checked.response;
        if (realpathSync(checked.cwd!) !== realpathSync(target.cwd!)) return error("cwd does not match session", 409);
      }
      const live = getRpcSession(id);
      const manager = live?.isAlive() && live.sessionFile === target.file
        ? live.inner.sessionManager : SessionManager.open(target.file!, undefined);
      if (manager.getHeader()?.id !== id || manager.getHeader()?.cwd !== target.cwd) return error("Session identity mismatch", 409);
      const diskLatest = readLatestSessionEntryId(target.file);
      if (live?.isAlive() && live.sessionFile === target.file && diskLatest && !manager.getEntry(diskLatest)) {
        return error("Session was changed by another editor", 409);
      }
      const snapshot = readSessionGitWorkflow(sessionEntries(manager));
      return NextResponse.json({ cwd: target.cwd, project: await getProjectGitWorkflow(target.cwd!) ?? null,
        session: snapshot ?? null, sessionSnapshotPresent: snapshot !== undefined });
    }
    const checked = await checkCwd(suppliedCwd);
    if (checked.response) return checked.response;
    return NextResponse.json({ cwd: checked.cwd, project: await getProjectGitWorkflow(checked.cwd!) ?? null, session: null });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause), 500);
  }
}

export async function PUT(req: Request) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request", 400);
    const input = body as Record<string, unknown>;
    if (!Object.hasOwn(input, "policy")) return error("policy required", 400);
    let policy;
    try { policy = input.policy === null ? null : validateGitWorkflowPolicy(input.policy); }
    catch (cause) { return error(cause instanceof Error ? cause.message : "Invalid policy", 400); }
    if (input.scope === "project" && !Object.hasOwn(input, "sessionId")) {
      const checked = await checkCwd(input.cwd);
      if (checked.response) return checked.response;
      await setProjectGitWorkflow(checked.cwd!, policy);
      return NextResponse.json({ ok: true, cwd: checked.cwd, project: policy });
    }
    // Session mutations derive their cwd solely from the persisted session header.
    if (input.scope !== "session" || Object.hasOwn(input, "cwd")) return error("Valid scope and target required", 400);
    const target = await sessionTarget(input.sessionId);
    if (target.response) return target.response;
    const id = input.sessionId as string;
    if (isGitCheckoutGated(target.cwd!)) return error("Checkout is busy with a Git transaction", 409);
    const live = getRpcSession(id);
    if (live?.isRunning()) return error("Stop the session before changing its workflow", 409);
    let before: ReturnType<typeof statSync>;
    try { before = statSync(target.file!); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return error("Session not persisted", 409);
      throw cause;
    }
    const usingLive = !!live?.isAlive() && live.sessionFile === target.file;
    const manager = usingLive ? live!.inner.sessionManager : SessionManager.open(target.file!, undefined);
    if (manager.getHeader()?.id !== id || manager.getHeader()?.cwd !== target.cwd) return error("Session identity mismatch", 409);
    const entries = sessionEntries(manager);
    if (entries.some((entry) => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE)) {
      return error("Cannot change a subagent workflow", 409);
    }
    // A live manager may be stale if a separate pi process has appended to the JSONL.
    // Refuse to write rather than silently appending from the wrong editor's view.
    const diskLatest = readLatestSessionEntryId(target.file);
    if (usingLive && diskLatest && !manager.getEntry(diskLatest)) {
      return error("Session was changed by another editor", 409);
    }
    const now = statSync(target.file!);
    if (now.size !== before.size || now.mtimeMs !== before.mtimeMs || now.ino !== before.ino) {
      return error("Session was changed by another editor", 409);
    }
    if (live?.isRunning() || isGitCheckoutGated(target.cwd!)) return error("Stop the session before changing its workflow or checkout", 409);
    appendSessionGitWorkflow(manager, policy);
    invalidateSessionManagerCache(target.file);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, sessionId: id, cwd: target.cwd, session: policy });
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("Invalid JSON", 400);
    return error(cause instanceof Error ? cause.message : String(cause), 500);
  }
}
