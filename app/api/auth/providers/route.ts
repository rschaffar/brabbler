import { buildApiKeyProviderList, buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";
import { readSettingsListing } from "@/lib/settings-listing-runtime";
import { validateAccountSelection, type AccountSelection } from "@/lib/provider-accounts";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET(req: Request) {
  let accounts: AccountSelection;
  try {
    accounts = JSON.parse(req ? new URL(req.url).searchParams.get("accounts") ?? "{}" : "{}");
    validateAccountSelection(accounts);
  } catch {
    return Response.json({ error: "Invalid or unavailable account selection" }, { status: 400 });
  }
  const inputs = await readSettingsListing(collectProviderListingInputs, accounts);
  const oauthProviders = buildOAuthProviderList(inputs);
  const apiKeyProviders = buildApiKeyProviderList(inputs);
  return Response.json({ providers: oauthProviders, oauthProviders, apiKeyProviders });
}
