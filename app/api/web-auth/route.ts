import { NextRequest, NextResponse } from "next/server";
import { getAuthRetryAfterMs, recordAuthFailure, recordAuthSuccess, retryAfterSeconds } from "@/lib/auth-throttle";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { createWebSessionToken, isValidWebSessionToken, BRABBLER_SESSION_COOKIE, BRABBLER_SESSION_MAX_AGE } from "@/lib/web-auth";
import { getWebAuthState, signingKey, verifyWebPassword, verifyBasicAuthorization, isAuthBusy } from "@/lib/web-auth-state";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
function locked() { return json({ error: "Authentication locked; run brabbler auth setup locally or repair authentication configuration.", setupNeeded: true }, 503); }
function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
}
function tooManyAttempts(retryAfterMs: number): NextResponse {
  return json({ error: "Too many failed attempts", retryAfterMs }, 429,
    { "Retry-After": String(retryAfterSeconds(retryAfterMs)) });
}
// Bound bytes before JSON parsing; never include body/parser/credential errors in responses/logs.
async function passwordBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 5000);
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    return body !== null && typeof body === "object" && "password" in body && typeof body.password === "string" ? body.password : null;
  } catch { return null; } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  const state = getWebAuthState();
  if (state.mode === "locked") return locked();
  const enabled = state.mode !== "disabled";
  let authenticated = !enabled || isValidWebSessionToken(request.cookies.get(BRABBLER_SESSION_COOKIE)?.value, signingKey(state));
  if (!authenticated && /^Basic\s/i.test(request.headers.get("authorization") || "")) {
    const retry = getAuthRetryAfterMs();
    if (retry) return tooManyAttempts(retry);
    try { authenticated = await verifyBasicAuthorization(request.headers.get("authorization"), state); }
    catch (error) { return isAuthBusy(error) ? tooManyAttempts(1000) : locked(); }
    authenticated &&= signingKey(getWebAuthState()) === signingKey(state);
    if (!authenticated) recordAuthFailure();
  }
  return json({ enabled, authenticated });
}
export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "Content-Type must be application/json" }, 415);
  const state = getWebAuthState();
  if (state.mode === "locked") return locked();
  if (state.mode === "disabled") return json({ error: "Password authentication is disabled" }, 404);
  const retry = getAuthRetryAfterMs();
  if (retry) return tooManyAttempts(retry);
  const password = await passwordBody(request);
  let valid = false;
  try { valid = password !== null && await verifyWebPassword(password, state); }
  catch (error) { return isAuthBusy(error) ? tooManyAttempts(1000) : locked(); }
  if (signingKey(getWebAuthState()) !== signingKey(state)) return locked();
  if (!valid) {
    const retryAfterMs = recordAuthFailure();
    return json({ error: "Invalid password", retryAfterMs }, 401,
      { "Retry-After": String(retryAfterSeconds(retryAfterMs)) });
  }
  recordAuthSuccess();
  const response = json({ ok: true });
  response.cookies.set({ name: BRABBLER_SESSION_COOKIE, value: createWebSessionToken(signingKey(state)!),
    httpOnly: true, sameSite: "lax", secure: isSecureRequest(request), path: "/", maxAge: BRABBLER_SESSION_MAX_AGE });
  return response;
}
export async function DELETE(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  const response = json({ ok: true });
  response.cookies.set({ name: BRABBLER_SESSION_COOKIE, value: "", httpOnly: true,
    sameSite: "lax", secure: isSecureRequest(request), path: "/", maxAge: 0 });
  return response;
}
