import { NextResponse } from "next/server";
import { existsSync, statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getProjectAccounts, listProviderAccounts, setProjectAccount } from "@/lib/provider-accounts";
import { readSessionAccounts } from "@/lib/session-accounts";
import { getRpcSession, setRpcSessionAccount } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

async function sessionSelection(sessionId: string) {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) return readSessionAccounts(live.inner.sessionManager.getEntries() as unknown as SessionEntry[]) ?? {};
  const file = await resolveSessionPath(sessionId);
  if (!file) throw new Error("Session not found");
  return readSessionAccounts(SessionManager.open(file, undefined).getEntries() as unknown as SessionEntry[]) ?? {};
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const cwd = params.get("cwd");
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return NextResponse.json({ error: "Valid cwd required" }, { status: 400 });
    const sessionId = params.get("sessionId");
    return NextResponse.json({
      accounts: listProviderAccounts(),
      project: await getProjectAccounts(cwd),
      session: sessionId ? await sessionSelection(sessionId) : null,
    });
  } catch {
    return NextResponse.json({ error: "Could not read account selection" }, { status: 404 });
  }
}

export async function PUT(req: Request) {
  try {
    const { cwd, sessionId, provider, accountId, scope } = await req.json() as {
      cwd?: string; sessionId?: string; provider?: string; accountId?: string | null; scope?: string;
    };
    if (typeof provider !== "string" || !provider || (accountId !== null && typeof accountId !== "string")) {
      return NextResponse.json({ error: "Provider and account selection required" }, { status: 400 });
    }
    if (accountId !== null && !listProviderAccounts().some((item) => item.id === accountId && item.provider === provider)) {
      return NextResponse.json({ error: "Account not found for provider" }, { status: 400 });
    }
    if (scope === "project" && cwd && existsSync(cwd) && statSync(cwd).isDirectory()) {
      return NextResponse.json({ project: await setProjectAccount(cwd, provider, accountId) });
    }
    if (scope === "session" && sessionId) {
      const file = await resolveSessionPath(sessionId);
      const nextSessionId = await setRpcSessionAccount(sessionId, file ?? undefined, provider, accountId);
      return NextResponse.json({ sessionId: nextSessionId });
    }
    return NextResponse.json({ error: "Valid project cwd or session ID required" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update account selection";
    return NextResponse.json({ error: message }, { status: /running/.test(message) ? 409 : 400 });
  }
}
