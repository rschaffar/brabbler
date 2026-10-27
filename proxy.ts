import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthRetryAfterMs,
  recordAuthFailure,
  retryAfterSeconds,
} from "@/lib/auth-throttle";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidWebSessionToken,
  BRABBLER_SESSION_COOKIE,
} from "@/lib/web-auth";

import { getWebAuthState, signingKey, verifyBasicAuthorization, isAuthBusy } from "@/lib/web-auth-state";

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return new NextResponse("Too many failed attempts", {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds(retryAfterMs)),
    },
  });
}

export async function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const state = getWebAuthState();
  if (state.mode === "locked") {
    return NextResponse.json({ error: "Authentication locked; run brabbler auth setup locally or repair authentication configuration.", setupNeeded: true },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (state.mode === "disabled") {
    if (request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.next();
  }

  let authenticated = isValidWebSessionToken(request.cookies.get(BRABBLER_SESSION_COOKIE)?.value, signingKey(state));
  const authorization = isApiRequest ? request.headers.get("authorization") : null;
  if (!authenticated && authorization && /^Basic\s/i.test(authorization)) {
    // Every Basic header is a password guess, so it shares the login form's
    // throttle; otherwise any API path (or GET /api/web-auth) answers guesses
    // at full speed. While blocked even the right password is refused, or the
    // answer would leak. A success does not reset the counter: Basic clients
    // authenticate on every request, and each reset would hand an interleaved
    // guesser a fresh short block.
    const retryAfterMs = getAuthRetryAfterMs();
    if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
    try { authenticated = await verifyBasicAuthorization(authorization, state); }
    catch (error) {
      if (isAuthBusy(error)) return tooManyAttempts(1000);
      return NextResponse.json({ error: "Authentication unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    // A rotation while the KDF was running cannot authorize using the old verifier.
    authenticated &&= signingKey(getWebAuthState()) === signingKey(state);
    if (!authenticated) recordAuthFailure();
  }
  if (request.nextUrl.pathname === "/login") {
    return authenticated
      ? NextResponse.redirect(new URL("/", request.url), { headers: { "Cache-Control": "no-store" } })
      : NextResponse.next({ headers: { "Cache-Control": "no-store" } });
  }
  if (request.nextUrl.pathname === "/api/web-auth") return NextResponse.next();

  if (!authenticated) {
    if (!isApiRequest) {
      const loginUrl = new URL("/login", request.url);
      if (request.nextUrl.search) {
        loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      }
      return NextResponse.redirect(loginUrl, { headers: { "Cache-Control": "no-store" } });
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Brabbler", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };
