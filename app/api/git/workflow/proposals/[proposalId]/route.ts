import { NextResponse } from "next/server";
import { decideGitSettingsProposal, gitSettingsProposal } from "@/lib/git-settings-proposals";
import { workflowSettingsFailure, SettingsError } from "@/app/api/git/workflow/settings/service";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ proposalId: string }> };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request, ctx: Context) {
  try {
    const params = new URL(req.url).searchParams;
    if ([...params.keys()].some((key) => key !== "sessionId") || !params.get("sessionId")) throw new SettingsError("sessionId required", 400);
    return reply(await gitSettingsProposal((await ctx.params).proposalId, params.get("sessionId")!));
  } catch (cause) { return workflowSettingsFailure(cause); }
}
export async function POST(req: Request, ctx: Context) {
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new SettingsError("Proposal response required", 400);
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) { await reader.cancel(); throw new SettingsError("Proposal response too large", 413); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SettingsError("Invalid proposal response", 400);
    const data = input as Record<string, unknown>;
    if (Object.keys(data).sort().join(",") !== "decision,sessionId" || typeof data.sessionId !== "string"
      || !["apply", "dismiss"].includes(data.decision as string)) throw new SettingsError("Invalid proposal response", 400);
    const result = await decideGitSettingsProposal((await ctx.params).proposalId, data.sessionId, data.decision as "apply" | "dismiss");
    return result ?? reply({ state: "dismissed" });
  } catch (cause) { return workflowSettingsFailure(cause); }
}
