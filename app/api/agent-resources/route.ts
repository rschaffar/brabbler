import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getResourceInventory, patchResourceChoice, resourceApiFailure, resourceBody, resourceQuery } from "@/lib/agent-resources/api";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
function failure(error: unknown) {
  const { status, ...body } = resourceApiFailure(error); return json(body, status);
}
/** First use may atomically initialize Brabbler choices/receipt; native files are
 * read-only. Nothing here creates, reloads or acknowledges an applied runtime. */
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ code: "origin", error: "Untrusted API request" }, 403);
  try { return json(await getResourceInventory(resourceQuery(request))); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ code: "origin", error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(request)) return json({ code: "content-type", error: "Content-Type must be application/json" }, 415);
  try {
    if (new URL(request.url).search) return json({ code: "request", error: "PATCH context belongs in the JSON body, not query parameters" }, 400);
    return json(await patchResourceChoice(await resourceBody(request)));
  } catch (error) { return failure(error); }
}
