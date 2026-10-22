import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { SCRATCHPAD_MAX_LENGTH, validScratchpadScope } from "@/lib/scratchpad";
import { readScratchpad, saveScratchpad, scratchpadPath, ScratchpadConflict } from "@/lib/scratchpad-server";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!validScratchpadScope(sessionId)) return json({ error: "Invalid scratchpad scope" }, 400);
  try { return json(readScratchpad(scratchpadPath(sessionId))); }
  catch { return json({ error: "Could not read scratchpad" }, 500); }
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "Content-Type must be application/json" }, 415);
  // Bound streamed input too, not only a caller-supplied Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "JSON body required" }, 400);
  let body: { sessionId?: unknown; text?: unknown; revision?: unknown };
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
  if (!body || !validScratchpadScope(body.sessionId) || typeof body.text !== "string"
    || body.text.length > SCRATCHPAD_MAX_LENGTH || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)) {
    return json({ error: "Valid scope, text and revision required" }, 400);
  }
  try { return json(await saveScratchpad(scratchpadPath(body.sessionId), body.text, body.revision)); }
  catch (error) {
    if (error instanceof ScratchpadConflict) return json({ current: error.current }, 409);
    return json({ error: "Could not save scratchpad" }, 500);
  }
}
