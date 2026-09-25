import { NextResponse } from "next/server";
import { addProviderAccount, listProviderAccounts, removeProviderAccount, renameProviderAccount } from "@/lib/provider-accounts";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ accounts: listProviderAccounts() }); }
  catch { return NextResponse.json({ error: "Could not read provider accounts" }, { status: 500 }); }
}

export async function POST(req: Request) {
  try {
    const { provider, label, type } = await req.json() as { provider?: string; label?: string; type?: string };
    if (typeof provider !== "string" || typeof label !== "string" || (type !== "oauth" && type !== "api_key")) {
      return NextResponse.json({ error: "provider, label and type are required" }, { status: 400 });
    }
    const runtime = await createModelRuntimeWithExtensions();
    const auth = runtime.getProvider(provider)?.auth;
    if (type === "oauth" ? !auth?.oauth : !auth?.apiKey?.login) {
      return NextResponse.json({ error: "Provider does not support this login type" }, { status: 400 });
    }
    return NextResponse.json({ account: await addProviderAccount(provider, label, type) });
  } catch {
    return NextResponse.json({ error: "Could not add provider account" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, label } = await req.json() as { id?: string; label?: string };
    if (typeof id !== "string" || typeof label !== "string") return NextResponse.json({ error: "id and label are required" }, { status: 400 });
    await renameProviderAccount(id, label);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Could not rename account" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json() as { id?: string };
    if (typeof id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
    await removeProviderAccount(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Could not remove account" }, { status: 400 });
  }
}
