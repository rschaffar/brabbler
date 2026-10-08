import { readSessionHeader, resolveSessionPath } from "../session-reader";
import type { PluginSession } from "./types";
import { isPluginSessionId } from "./settings";

/** Resolve the owning project from the actual saved session, never a browser/tool supplied cwd. */
export async function resolvePluginSession(value: unknown): Promise<PluginSession | undefined> {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isPluginSessionId(value)) throw new Error("Invalid session ID");
  const path = await resolveSessionPath(value);
  const header = path ? readSessionHeader(path) : null;
  if (!header || header.id !== value || typeof header.cwd !== "string" || !header.cwd) throw new Error("Session not found or its identity changed");
  return { id: value, cwd: header.cwd };
}
