import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readTitleLanguage, writeTitleLanguage } from "@/lib/title-language";
import { isTitleLanguage } from "@/lib/title-language-options";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ language: readTitleLanguage() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body: unknown = await req.json();
    const language = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { language?: unknown }).language : undefined;
    if (!isTitleLanguage(language)) {
      return NextResponse.json({ error: "Unsupported title language" }, { status: 400 });
    }
    return NextResponse.json({ language: writeTitleLanguage(language) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
