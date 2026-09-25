import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isProviderUsageId, queryProviderUsage } from "@/lib/provider-usage";
import { validateAccountSelection } from "@/lib/provider-accounts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { providerId, accountId } = body as { providerId?: unknown; accountId?: unknown };
  if (typeof providerId !== "string" || !isProviderUsageId(providerId)) return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  if (accountId !== undefined && accountId !== null) {
    if (typeof accountId !== "string") return NextResponse.json({ error: "Invalid account" }, { status: 400 });
    try {
      validateAccountSelection({ [providerId]: accountId });
    } catch {
      return NextResponse.json({ error: "Account is unavailable for this provider" }, { status: 400 });
    }
  }

  try {
    const result = await queryProviderUsage(providerId, accountId as string | null | undefined);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      providerId,
      status: "query-failed",
      message: "The provider usage query failed.",
    });
  }
}
