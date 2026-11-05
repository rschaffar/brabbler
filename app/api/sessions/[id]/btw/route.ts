import { NextResponse } from "next/server";
import { ensureBtwConversation, getBtwConversation } from "@/lib/btw-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await getBtwConversation((await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    if (!body || (body.action !== "ensure" && body.action !== "refresh") || Object.keys(body).some(key => key !== "action")) {
      return NextResponse.json({ error: "Expected action: ensure or refresh" }, { status: 400 });
    }
    return NextResponse.json(await ensureBtwConversation((await params).id, body.action === "refresh"));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}
