import { NextResponse } from "next/server";
import { accountCredentialStore, listProviderAccounts } from "@/lib/provider-accounts";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = listProviderAccounts().find((item) => item.id === id && item.type === "api_key");
  if (!account) return NextResponse.json({ error: "API key account not found" }, { status: 404 });
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (typeof apiKey !== "string" || !apiKey.trim()) return NextResponse.json({ error: "API key is required" }, { status: 400 });
    const store = accountCredentialStore({ [account.provider]: id }, undefined, undefined, { allowPendingLogin: true });
    const runtime = await createModelRuntimeWithExtensions(store);
    const login = runtime.getProvider(account.provider)?.auth.apiKey?.login;
    if (!login) return NextResponse.json({ error: "Provider does not support API key login" }, { status: 400 });
    let submitted = false;
    const credential = await login({
      signal: req.signal,
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const choice = prompt.options.find((option) => option.id === "api-key" || option.id === "bearer-token");
          if (choice) return choice.id;
        }
        if (prompt.type === "secret" && !submitted) {
          submitted = true;
          return apiKey.trim();
        }
        throw new Error("Provider requires interactive authentication setup");
      },
    });
    if (credential.type !== "api_key") throw new Error("Provider returned an unexpected credential type");
    await store.modify(account.provider, async () => credential);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch {
    // Provider login errors can contain submitted values; do not echo them.
    return NextResponse.json({ error: "Could not authorize API key account" }, { status: 500 });
  }
}
