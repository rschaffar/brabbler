import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { GitProjectResourceError, selectGitProjectResources } from "@/lib/git-project-resources";
import { ProjectAuthorizationError, readProjectAuthorization, saveProjectAuthorization,
  type ProjectAuthorizationOwner, type ProjectAuthorizationScope } from "@/lib/git-project-authorization";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";

// Proxy authenticates and applies host/origin protections to browser API routes.
// This is not a security boundary against a same-user agent that can call APIs
// (including authenticated Basic clients), nor against shell/file writes.
const LIMIT = 8 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
class RequestError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
function fields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (!required.every((key) => Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new RequestError("Unexpected authorization fields");
  }
}
function scope(value: unknown): ProjectAuthorizationScope {
  if (value !== "global" && value !== "project" && value !== "session") throw new RequestError("Invalid authorization scope");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4096) throw new RequestError("Invalid authorization selector");
  return value;
}
async function selectionFor(input: Record<string, unknown>) {
  const selectedScope = scope(input.scope);
  if (selectedScope === "global") {
    if (input.repositoryPath !== undefined || input.sessionId !== undefined) throw new RequestError("Global authorizations have no project or chat selector");
    return { selectedScope, selection: undefined, owner: undefined };
  }
  const selection = await selectGitProjectResources(text(input.repositoryPath));
  let owner: ProjectAuthorizationOwner | undefined;
  if (selectedScope === "project" && input.sessionId !== undefined) throw new RequestError("Project authorizations are not chat-bound");
  if (selectedScope === "session") {
    if (typeof input.sessionId !== "string" || !ID.test(input.sessionId)) throw new RequestError("Select a persisted ordinary chat");
    const file = await resolveSessionPath(input.sessionId);
    const header = file ? readSessionHeader(file) : null;
    if (!file || !header?.cwd || header.id !== input.sessionId) throw new RequestError("Chat identity unavailable", 409);
    owner = { sessionId: input.sessionId, sessionFile: file, sessionCwd: header.cwd };
  }
  return { selectedScope, selection, owner };
}
function failure(cause: unknown) {
  if (cause instanceof GitProjectResourceError) return NextResponse.json({ error: cause.message },
    { status: cause.code === "access-denied" ? 403 : cause.code === "invalid-selection" ? 400 : 409 });
  return NextResponse.json({ error: cause instanceof RequestError || cause instanceof ProjectAuthorizationError ? cause.message
    : "Authorization data unavailable; inspect and reload before saving." },
  { status: cause instanceof RequestError ? cause.status : 409 });
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new RequestError("Duplicate selector");
    const input = Object.fromEntries(params);
    fields(input, ["scope"], ["repositoryPath", "sessionId"]);
    const { selection, owner } = await selectionFor(input);
    return NextResponse.json(await readProjectAuthorization(selection, owner, getAgentDir()));
  } catch (cause) { return failure(cause); }
}
export async function PUT(req: Request) {
  try {
    if (!req.headers.get("content-type")?.startsWith("application/json")) throw new RequestError("JSON request required");
    const reader = req.body?.getReader();
    if (!reader) throw new RequestError("JSON request required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT) { await reader.cancel(); throw new RequestError("Authorization request too large", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new RequestError("Invalid JSON authorization request"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestError("Invalid authorization request");
    const input = parsed as Record<string, unknown>;
    fields(input, ["scope", "action", "decision", "revision", "policyRevision"], ["repositoryPath", "sessionId"]);
    const { selectedScope, selection, owner } = await selectionFor(input);
    return NextResponse.json(await saveProjectAuthorization(selection, owner, selectedScope, input.action as never,
      input.decision as never, { revision: input.revision as string, policyRevision: input.policyRevision as string }, getAgentDir()));
  } catch (cause) { return failure(cause); }
}
