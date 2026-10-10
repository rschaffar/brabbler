import { allowFileRoot, getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { samePath } from "@/lib/paths";
import { existsSync, realpathSync } from "node:fs";
import { bundledPlugin } from "@/lib/plugins/registry";
import { readPluginSettings } from "@/lib/plugins/settings";
import { captureWorktreeManagement, managementCheckout, WorktreeManagementError, worktreeManagementDetails } from "@/lib/worktree-management";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted request" }, { status: 403, headers });
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["cwd", "target", "captureId", "rows", "details", "datesOnly"].includes(key))) throw new WorktreeManagementError("INVALID", "Unknown inventory query");
    const cwd = query.get("cwd");
    if (!cwd) throw new WorktreeManagementError("INVALID", "cwd is required");
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) return Response.json({ error: "Access denied" }, { status: 403, headers });
    request.signal.throwIfAborted();
    const project = await managementCheckout(cwd, request.signal);
    // An admitted physical registered project explicitly admits its related checkouts.
    for (const w of project.registrations) if (!w.missing && existsSync(w.path) && samePath(w.path, realpathSync(w.path))) {
      try { if ((await managementCheckout(w.path, request.signal)).project === project.project) allowFileRoot(w.path); }
      catch { request.signal.throwIfAborted(); /* Diagnostics never grant access. */ }
    }
    if (query.get("details") === "1") {
      if (!query.get("captureId") || !query.get("rows") || query.has("target")) throw new WorktreeManagementError("INVALID", "Captured row IDs required; do not supply a new target");
      const ids: unknown = JSON.parse(query.get("rows")!);
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new WorktreeManagementError("INVALID", "rows must be a JSON array of captured row IDs");
      return Response.json(await worktreeManagementDetails(cwd, query.get("captureId")!, ids, request.signal, query.get("datesOnly") === "1", (path) => {
        const currentRoots = getKnownAllowedFileRoots();
        return isFilePathAllowed(path, currentRoots) && isExistingFilePathAllowed(path, currentRoots);
      }), { headers });
    }
    if (query.has("captureId") || query.has("rows") || query.has("details") || query.has("datesOnly")) throw new WorktreeManagementError("INVALID", "Invalid capture query");
    const plugin = bundledPlugin("git-workflow");
    const policy = readPluginSettings(plugin.manifest, cwd);
    const inventory = await captureWorktreeManagement(cwd, { target: query.get("target") ?? undefined,
      configuredTarget: typeof policy.effective.targetBranch === "string" ? policy.effective.targetBranch : null,
      targetSource: policy.sources.targetBranch as "builtin" | "global" | "project", signal: request.signal });
    return Response.json({ ...inventory, cleanup: { pluginId: plugin.manifest.id, enabled: policy.enabled,
      permission: policy.effective.discardResources, targetSelection: policy.effective.targetSelection } }, { headers });
  } catch (error) {
    const code = error instanceof WorktreeManagementError ? error.code : error instanceof SyntaxError ? "INVALID" : "UNAVAILABLE";
    return Response.json({ error: error instanceof Error ? error.message : String(error), code },
      { status: code === "STALE" ? 409 : code === "INVALID" ? 400 : 503, headers });
  }
}
