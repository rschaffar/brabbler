import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403, headers });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415, headers });
  return NextResponse.json({ error: "Skill package search is retired. Use Pi or Nix for package discovery and installation.", code: "PACKAGE_MANAGEMENT_RETIRED" }, { status: 410, headers });
}
