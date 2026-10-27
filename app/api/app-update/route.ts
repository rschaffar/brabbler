import { NextResponse } from "next/server";
import type { AppUpdateResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

/** This independent fork has no configured publication/update destination. */
export function GET() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  return NextResponse.json({
    currentVersion: version,
    latestVersion: version,
    updateAvailable: false,
    releaseUrl: "",
  } satisfies AppUpdateResponse, { headers: { "Cache-Control": "no-store" } });
}
