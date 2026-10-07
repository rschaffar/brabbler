import { NextRequest, NextResponse } from "next/server";
import { bundledPlugin } from "@/lib/plugins/registry";
import { DiffContextError } from "@/lib/diff-context";
export const dynamic = "force-dynamic";

/** A plugin-owned opaque display resource, not a Git/path/revision endpoint. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const query = request.nextUrl.searchParams;
  const handle = query.get("handle") ?? "", file = query.get("file") ?? "";
  if (query.size !== 2 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(handle) || !/^(?:0|[1-9]\d{0,2})$/.test(file) || Number(file) > 255) {
    return NextResponse.json({ error: "Invalid patch context request" }, { status: 400 });
  }
  let plugin;
  try { plugin = bundledPlugin((await params).id); }
  catch { return NextResponse.json({ error: "Unknown context provider" }, { status: 404 }); }
  if (!plugin.readPatchContext) return NextResponse.json({ error: "Full-file context is unavailable for this card" }, { status: 404 });
  try { return NextResponse.json(await plugin.readPatchContext(handle, file)); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Context unavailable" }, {
      status: error instanceof DiffContextError ? error.status : 409,
    });
  }
}
