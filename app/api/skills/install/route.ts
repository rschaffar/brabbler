import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** Retired before body consumption, source discovery or native effects. */
export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403, headers });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415, headers });
  return NextResponse.json({ error: "Skill installation is retired. Use Pi or Nix to install and register skills; use Skills & extensions for availability only.", code: "PACKAGE_MANAGEMENT_RETIRED" }, { status: 410, headers });
}
