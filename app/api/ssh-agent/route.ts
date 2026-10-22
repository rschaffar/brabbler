import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { managedSshAgent } from "@/lib/managed-ssh-agent";
import { webAuthnOrigin } from "@/lib/browser-ssh-protocol";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isValidWebSessionToken, PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";

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
    const parsed = new URL(rawOrigin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.origin !== rawOrigin || parsed.username || parsed.password || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))) throw new Error("Secure browser management origin required");
    const origin = parsed.origin;
    // Native selection/status also works on a loopback IP. FIDO ceremonies still
    // require the stricter DNS RP boundary; never fabricate an IP relying party.
    if (parsed.host !== request.headers.get("host")) throw new Error("Origin must match the public Host");
    const owner = createHash("sha256").update(cookie!).digest("hex");
    const body = await boundedJson(request);
    if (!["status", "discover", "probe", "use", "custom"].includes(String(body.action))) webAuthnOrigin(origin);
    if (process.platform === "win32") {
      if (body.action !== "status") throw new Error("Managed SSH sockets require Unix");
      return json({ supported: false, runtime: { runtimeId: "unsupported", socketPath: "", inheritedSocket: null, revision: "unsupported", setupNeeded: true, selected: { type: "none" }, custom: [], settingsError: null, endpointPresent: false }, registry: { revision: null, keys: [] }, connections: [], activeId: null, pendingCount: 0 });
    }
    // No session/project binding, manual socket publication, or caller-provided
    // verification/unlock authority. All policy derives from server-owned state.
    return json(await managedSshAgent().dispatch(body, owner, origin));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Browser SSH request failed" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
