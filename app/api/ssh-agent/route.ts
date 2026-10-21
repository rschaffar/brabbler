import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { browserSshAgent } from "@/lib/browser-ssh-agent";
import { webAuthnOrigin, type BrowserSshAssertion, type BrowserSshCredential } from "@/lib/browser-ssh-protocol";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isValidWebSessionToken, PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!hasJsonContentType(request) || !request.body) throw new Error("JSON body required");
  const reader = request.body.getReader();
  const timer = setTimeout(() => { void reader.cancel(); }, 5000);
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
    return body as Record<string, unknown>;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  const password = process.env.PI_WEB_PASSWORD;
  const cookie = request.cookies.get(PI_WEB_SESSION_COOKIE)?.value;
  // Basic/API authentication is deliberately insufficient for browser key management.
  if (!isValidWebSessionToken(cookie, password)) return NextResponse.json({ error: "Sign in with a configured Pi Web password before using browser SSH" }, { status: 403 });
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || !isApiRequestAllowed(request) || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Same-origin browser request required" }, { status: 403 });
  const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  try {
    const { origin } = webAuthnOrigin(rawOrigin);
    // Reverse proxies may change the scheme but must preserve the public Host.
    if (new URL(origin).host !== request.headers.get("host")) throw new Error("Origin must match the public Host");
    const owner = createHash("sha256").update(cookie!).digest("hex");
    const body = await boundedJson(request);
    const agent = browserSshAgent();
    const action = body.action;
    if (action === "status" || action === "unbind" || action === "bind") {
      const sessionId = body.sessionId;
      if (sessionId !== undefined && sessionId !== null && (typeof sessionId !== "string" || !await resolveSessionPath(sessionId))) throw new Error("Session not found");
      if (action === "status") return json({ supported: process.platform !== "win32", bound: typeof sessionId === "string" && agent.isBound(sessionId) });
      if (typeof sessionId !== "string") throw new Error("Session required");
      if (action === "unbind") { agent.unbind(sessionId, owner, typeof body.token === "string" ? body.token : undefined); return json({ success: true }); }
      if (typeof body.token !== "string") throw new Error("Agent capability required");
      agent.bind(body.token, owner, origin, sessionId);
      return json({ success: true });
    }
    if (action === "create") return json(agent.create(owner, body.credential as BrowserSshCredential, origin));
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) throw new Error("Agent capability required");
    switch (action) {
      case "activate": return json(await agent.activate(body.token, owner, origin, body.assertion as BrowserSshAssertion));
      case "poll": return json(agent.poll(body.token, owner, origin));
      case "respond":
        if (typeof body.requestId !== "string") throw new Error("Signing request required");
        agent.respond(body.token, owner, origin, body.requestId, body.assertion as BrowserSshAssertion | undefined);
        return json({ success: true });
      case "disconnect": agent.disconnect(body.token, owner, origin); return json({ success: true });
      default: throw new Error("Unknown browser SSH action");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Browser SSH request failed" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
