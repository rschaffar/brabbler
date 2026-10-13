import { shareModelCatalogRefresh } from "@/lib/model-catalog-refresh";
import type { AccountSelection } from "@/lib/provider-accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/models/refresh — fetch the remote provider catalogs now.
 *
 * Body: `{ provider?: string, accounts?: Record<string, string> }`. Missing accounts
 * means Pi default; a supplied snapshot must be authorized. Without a provider,
 * every refreshable provider is passed over (the panel-wide button).
 *
 * The response says only whether the pass completed and whether anything
 * moved. The refreshed catalog itself reaches the browser through the
 * `/api/models` and `/api/models/enabled` reloads the caller does next, so
 * there is no second shape of the model list to keep in agreement.
 */
export async function POST(req: Request) {
  try {
    const text = await req.text();
    const body: unknown = text.trim() ? JSON.parse(text) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid refresh scope");
    const { provider, accounts } = body as { provider?: unknown; accounts?: unknown };
    if (Object.hasOwn(body, "provider") && (typeof provider !== "string" || !provider.trim())) {
      throw new Error("Invalid provider filter");
    }
    if (Object.hasOwn(body, "accounts") && (!accounts || typeof accounts !== "object" || Array.isArray(accounts))) {
      throw new Error("Invalid account selection");
    }
    const result = await shareModelCatalogRefresh({
      ...(typeof provider === "string" && provider.trim() ? { providers: [provider.trim()] } : {}),
      ...(accounts === undefined ? {} : { accounts: accounts as AccountSelection }),
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Invalid catalog refresh scope" }, { status: 400 });
  }
}
