import { lstatSync, realpathSync, statSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getKnownAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { readHumanGitSessionManager } from "@/lib/git-action-human";
import { GIT_ACTION_ID_PATTERN } from "@/lib/git-action-types";
import { samePath } from "@/lib/paths";
import { readSessionHeader } from "@/lib/session-reader";

export const dynamic = "force-dynamic";
const SESSION = /^[a-zA-Z0-9_-]{1,128}$/;
const REASON = "Check recovery approval is retired. Failed or uncertain checks produce no passing receipt. History does not admit or block other Git invocations; no recovery action is required. Inspect recorded effects in action cards and current checkout files and processes as needed. This response is not a native preflight or evidence that processes stopped.";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const error = (message: string, status: number) => json({ error: message }, status);
const diagnostic = (status = 200) => json({ diagnosticOnly: true, retired: true, reason: REASON }, status);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Bounded saved-session lookup only. resolveSessionPath's catalogue fallback can
 * invoke Git project discovery, which this compatibility endpoint must not do.
 * Unknown layouts, symlinks, duplicate IDs and over-budget stores fail closed.
 * This reads no Git action/admission records and is never Git permission.
 */
async function savedSessionFile(sessionId: string): Promise<string | null> {
  const root = join(getAgentDir(), "sessions");
  if (!lstatSync(root).isDirectory() || !samePath(root, realpathSync(root))) return null;
  let remaining = 8192, directories = 256, found: string | null = null;
  for await (const directory of await opendir(root)) {
    if (--remaining < 0) throw new Error("Session lookup budget");
    if (!directory.isDirectory()) continue;
    if (--directories < 0) throw new Error("Session lookup budget");
    const folder = join(root, directory.name);
    if (!samePath(folder, realpathSync(folder))) throw new Error("Session directory changed");
    for await (const file of await opendir(folder)) {
      if (--remaining < 0) throw new Error("Session lookup budget");
      if (!file.name.endsWith(`_${sessionId}.jsonl`)) continue;
      const candidate = join(folder, file.name);
      if (found || !file.isFile() || !samePath(candidate, realpathSync(candidate))) throw new Error("Session identity unavailable");
      found = candidate;
    }
  }
  return found;
}

async function ordinarySavedSession(sessionId: string): Promise<boolean> {
  const sessionFile = await savedSessionFile(sessionId);
  if (!sessionFile) return false;
  const stat = lstatSync(sessionFile);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return false;
  const header = readSessionHeader(sessionFile);
  if (!header || header.id !== sessionId || typeof header.cwd !== "string" ||
    !isExistingFilePathAllowed(header.cwd, getKnownAllowedFileRoots()) ||
    !statSync(header.cwd).isDirectory() || !samePath(header.cwd, realpathSync(header.cwd))) return false;
  const manager = readHumanGitSessionManager({ sessionId, sessionFile, cwd: header.cwd });
  return !manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === "pi-web:subagent");
}

/** Host/origin and web authentication remain enforced by proxy.ts. Only an
 * ordinary persisted session in an already allowed physical cwd gets this fixed
 * information response. No policy/trust, checkout, process or history inspection
 * is performed, and no ticket, receipt or health/admission claim is returned.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sessionId = params.get("sessionId");
  if ([...params.keys()].length !== 1 || !sessionId || !SESSION.test(sessionId)) return error("Valid sessionId required", 400);
  try {
    if (!await ordinarySavedSession(sessionId)) return error("Saved session context unavailable", 404);
    return diagnostic();
  } catch { return error("Saved session context unavailable", 404); }
}

async function bodyOf(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > 4096) throw new Error("oversized");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("oversized"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Accept only the old bounded DTO to explain retirement, never to approve it.
 * Legacy tickets and records are inert: do not consume, resolve or erase them.
 */
export async function POST(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length) return error("Invalid retired recovery request", 400);
  let input: unknown;
  try { input = await bodyOf(req); } catch { return error("Invalid or oversized JSON", 400); }
  if (!record(input)) return error("Invalid retired recovery request", 400);
  const names = ["sessionId", "actionId", "revision", "acknowledged", ...(input.reviewedMovement === true ? ["reviewedMovement"] : [])];
  if (Object.keys(input).length !== names.length || !names.every((name) => Object.hasOwn(input, name)) ||
    typeof input.sessionId !== "string" || !SESSION.test(input.sessionId) ||
    typeof input.actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(input.actionId) ||
    typeof input.revision !== "string" || !GIT_ACTION_ID_PATTERN.test(input.revision) || input.acknowledged !== true)
    return error("Invalid retired recovery request", 400);
  try {
    if (!await ordinarySavedSession(input.sessionId)) return error("Saved session context unavailable", 404);
    return diagnostic(410);
  } catch { return error("Saved session context unavailable", 404); }
}
