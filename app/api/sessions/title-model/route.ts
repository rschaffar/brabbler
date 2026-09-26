import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isTitleModelSelection, readTitleModel, writeTitleModel } from "@/lib/title-language";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ model: readTitleModel() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        !("model" in body) || (body.model !== null && !isTitleModelSelection(body.model))) {
      return NextResponse.json({ error: "Invalid title model" }, { status: 400 });
    }
    return NextResponse.json({ model: writeTitleModel(body.model) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
