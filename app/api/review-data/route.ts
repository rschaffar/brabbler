import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** Retired recording boundary. Never read the index, request body or saved history. */
function retired(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  return Response.json({
    code: "NOTEBOOK_RECORDING_RETIRED",
    error: "Notebook review recording has been removed. Existing review-data files and browser recovery entries are preserved. Use ordinary chat to discuss or revise the guide.",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) { return retired(request); }
export async function POST(request: Request) { return retired(request); }
