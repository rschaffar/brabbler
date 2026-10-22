import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { acceptanceView, acceptanceLog, allowedAcceptanceProject } from "@/lib/acceptance/server";
import { digest, saveProfiles } from "@/lib/acceptance/config";
import { acceptanceCoordinator } from "@/lib/acceptance/coordinator";
import { withAcceptanceAdmission } from "@/plugins/acceptance/policy";

export const dynamic = "force-dynamic";
const failure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams, project = await allowedAcceptanceProject(params.get("cwd"));
    const id = params.get("runId");
    return NextResponse.json(id ? { log: acceptanceLog(project, id) } : acceptanceView(project), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  try {
    const text = await req.text();
    if (text.length > 65536) throw new Error("Acceptance request exceeds size limit");
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid acceptance request");
    const project = await allowedAcceptanceProject(body.cwd), coordinator = acceptanceCoordinator();
    if (body.action === "configure") {
      if (Object.keys(body).some((key) => !["cwd", "action", "profiles"].includes(key))) throw new Error("Unexpected acceptance configuration field");
      saveProfiles(project, body.profiles);
    } else if (body.action === "run") {
      if (Object.keys(body).some((key) => !["cwd", "action", "profile", "profileDigest", "requestId"].includes(key))
        || typeof body.profile !== "string" || typeof body.requestId !== "string" || typeof body.profileDigest !== "string") throw new Error("Invalid acceptance run request");
      const profile = acceptanceView(project).profiles.find((p) => p.name === body.profile);
      if (!profile || digest(profile) !== body.profileDigest) throw new Error("Acceptance recipe changed; refresh before running");
      return NextResponse.json(await withAcceptanceAdmission(req.signal, (signal) => coordinator.submit(project, body.profile, "browser", body.requestId, body.profileDigest, signal)));
    } else if (body.action === "cancel") {
      if (typeof body.runId !== "string") throw new Error("Acceptance run ID required");
      await coordinator.cancel(project, body.runId, "browser", true);
    } else if (body.action === "recover") {
      await coordinator.recover(body.resourcesStopped === true);
    } else throw new Error("Unknown acceptance action");
    return NextResponse.json(acceptanceView(project));
  } catch (error) { return failure(error); }
}
