import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const version = process.env.PI_WEB_SKIP_VERSION_CHECK === "1"
    ? null
    : (process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0");
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
