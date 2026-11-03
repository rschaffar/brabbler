import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { readStartupPreferences, saveStartupPreferences, type StartupPreferencesChanges } from "@/lib/startup-preferences";

export const dynamic = "force-dynamic";

function globalSettings() {
  const agentDir = getAgentDir();
  return SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
}

export async function GET() {
  const settings = globalSettings();
  if (settings.drainErrors().length) return Response.json({ error: "Could not read shared model defaults" }, { status: 500 });
  return Response.json(readStartupPreferences(settings));
}

export async function PUT(req: Request) {
  let changes: StartupPreferencesChanges;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => key !== "model" && key !== "thinkingLevel" && key !== "modelThinking")) throw new Error();
    if (body.model !== undefined && (!body.model || typeof body.model !== "object"
      || typeof body.model.provider !== "string" || !body.model.provider.trim()
      || typeof body.model.modelId !== "string" || !body.model.modelId.trim())) throw new Error();
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    if (body.thinkingLevel !== undefined && !levels.includes(body.thinkingLevel)) throw new Error();
    if (body.modelThinking !== undefined) {
      const value = body.modelThinking;
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !["provider", "modelId", "level"].includes(key))
        || typeof value.provider !== "string" || !value.provider.trim()
        || typeof value.modelId !== "string" || !value.modelId.trim()
        || (value.level !== null && !levels.includes(value.level))) throw new Error();
    }
    changes = body;
  } catch {
    return Response.json({ error: "Invalid shared model defaults" }, { status: 400 });
  }
  try {
    const settings = globalSettings();
    await saveStartupPreferences(settings, changes);
    invalidateModelsCache();
    return Response.json(readStartupPreferences(settings));
  } catch {
    return Response.json({ error: "Could not save shared model defaults" }, { status: 500 });
  }
}
