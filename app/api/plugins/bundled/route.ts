import { NextResponse } from "next/server";
import { bundledPlugin, bundledPlugins } from "@/lib/plugins/registry";
import { readPluginSettings, updatePluginSettings } from "@/lib/plugins/settings";
import { getAllowedFileRoots, isFilePathAllowed, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import type { SettingValue } from "@/lib/plugins/types";

export const dynamic = "force-dynamic";
async function selectedCwd(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === null || value === "") return undefined;
  const roots = await getAllowedFileRoots();
  if (typeof value !== "string" || !isFilePathAllowed(value, roots) || !isExistingFilePathAllowed(value, roots)) throw new Error("Selected project is outside allowed roots");
  return value;
}
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    const cwd = await selectedCwd(new URL(req.url).searchParams.get("cwd"));
    return NextResponse.json({ plugins: bundledPlugins.map(({ manifest }) => ({ manifest, settings: readPluginSettings(manifest, cwd) })) });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
}
export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.pluginId !== "string") throw new Error("Invalid plugin settings request");
    const plugin = bundledPlugin(body.pluginId);
    const cwd = await selectedCwd(body.cwd);
    const settings = updatePluginSettings(plugin.manifest, body.scope, cwd,
      (body.set ?? {}) as Record<string, SettingValue>, body.reset ?? []);
    return NextResponse.json({ settings });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
}
