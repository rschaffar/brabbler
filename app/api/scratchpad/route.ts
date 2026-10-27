import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isAbsolute } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { SCRATCHPAD_MAX_LENGTH, validScratchpadScope } from "@/lib/scratchpad";
import { readScratchpad, saveScratchpad, scratchpadPath, scratchpadProject, ScratchpadConflict } from "@/lib/scratchpad-server";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

function scopeFields(fields: { sessionId?: unknown; projectId?: unknown }) {
  if (Object.hasOwn(fields, "projectId")) return Object.hasOwn(fields, "sessionId") ? undefined : { projectId: fields.projectId };
  return typeof fields.sessionId === "string" || fields.sessionId === null ? fields.sessionId : undefined;
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].length > 1 || [...params.keys()].some(key => !["sessionId", "projectId", "projectCwd"].includes(key))) {
    return json({ error: "Select one scratchpad scope" }, 400);
  }
  if (params.has("projectCwd")) {
    const cwd = params.get("projectCwd")!;
    if (!cwd || cwd.length > 16_384 || !isAbsolute(cwd) || /[\x00-\x1f]/.test(cwd)) return json({ error: "Valid project directory required" }, 400);
    // Directory admission precedes any Git probe; this response grants no roots.
    try {
      if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return json({ error: "Access denied" }, 403);
      return json(scratchpadProject(cwd));
    } catch { return json({ error: "Project is unavailable" }, 400); }
  }
  // IDs address personal data only, never project files or operation authority.
  const scope = params.has("projectId") ? { projectId: params.get("projectId") } : params.get("sessionId");
  if (!validScratchpadScope(scope)) return json({ error: "Invalid scratchpad scope" }, 400);
  try { return json(readScratchpad(scratchpadPath(scope))); }
  catch { return json({ error: "Could not read scratchpad" }, 500); }
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "Content-Type must be application/json" }, 415);
  // Bound streamed input too, not only a caller-supplied Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "JSON body required" }, 400);
  let body: { sessionId?: unknown; projectId?: unknown; text?: unknown; revision?: unknown };
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); return json({ error: "Scratchpad request too large" }, 413); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ error: "Invalid JSON" }, 400); }
  finally { reader.releaseLock(); }
  const scope = body && scopeFields(body);
  if (!body || !validScratchpadScope(scope) || typeof body.text !== "string"
    || body.text.length > SCRATCHPAD_MAX_LENGTH || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)) {
    return json({ error: "Valid scope, text and revision required" }, 400);
  }
  try { return json(await saveScratchpad(scratchpadPath(scope), body.text, body.revision)); }
  catch (error) {
    if (error instanceof ScratchpadConflict) return json({ current: error.current }, 409);
    return json({ error: "Could not save scratchpad" }, 500);
  }
}
