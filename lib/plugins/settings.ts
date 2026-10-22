import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { gitExecEnv } from "../git-exec";
import { samePath, toNativePath } from "../paths";
import type { Overrides, PluginManifest, PluginSession, PluginSettings, SettingValue } from "./types";

interface StoredSettings {
  version: number;
  global: Overrides;
  projects: Record<string, Overrides>;
  sessions?: Record<string, { project: string; values: Overrides }>;
}
export function isPluginSessionId(value: unknown): value is string {
  // Imported SDK sessions can use non-UUID IDs. They still need a bounded safe key;
  // ownership comes from the saved header/runtime, not this lexical validation.
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
    && !["constructor", "prototype"].includes(value);
}
function validateSession(session: PluginSession): void {
  if (!isPluginSessionId(session.id) || !session.cwd) throw new Error("Invalid plugin session identity");
}
const symbol = Symbol.for("pi-web:bundled-plugin-settings-listeners");
const global = globalThis as typeof globalThis & { [symbol]?: Set<(id: string) => void> };
const listeners = global[symbol] ??= new Set();
export function onPluginSettingsChange(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Physical common Git directory is shared by linked checkouts. No remote identity. */
export function pluginProjectIdentity(cwd: string): string | null {
  try {
    return realpathSync(toNativePath(execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { env: gitExecEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()));
  } catch { return null; }
}
export function pluginScopeIdentity(manifest: PluginManifest, cwd: string): string | null {
  const repository = pluginProjectIdentity(cwd);
  if (repository || !manifest.directoryProjects) return repository;
  try { return realpathSync(cwd); } catch { return null; }
}
export function pluginSettingsPath(manifest: PluginManifest, agentDir = getAgentDir()): string {
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) throw new Error("Invalid plugin ID");
  return join(agentDir, "pi-web", "plugins", manifest.id, "settings.json");
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateOverrides(manifest: PluginManifest, raw: unknown, project = false): Overrides {
  if (!object(raw)) throw new Error("Invalid plugin overrides");
  for (const [key, value] of Object.entries(raw)) {
    const field = manifest.fields[key];
    if (!Object.hasOwn(manifest.fields, key) || !field || (project && field.globalOnly)) throw new Error(`Invalid setting: ${key}`);
    if (value === null && field.nullable) continue;
    const valid = field.kind === "boolean" ? typeof value === "boolean"
      : field.kind === "text" ? typeof value === "string" && !/[\x00-\x1f]/.test(value)
      : field.kind === "enum" ? typeof value === "string" && field.options?.includes(value)
      : Array.isArray(value) && value.every((check) => object(check)
        && Object.keys(check).every((key) => key === "name" || key === "command" || key === "timeoutMs")
        && typeof check.name === "string" && check.name.trim().length > 0
        && typeof check.command === "string" && check.command.trim().length > 0
        && !check.command.includes("\0")
        && (check.timeoutMs === undefined || typeof check.timeoutMs === "number" && Number.isSafeInteger(check.timeoutMs) && check.timeoutMs >= 0 && check.timeoutMs <= 2_147_483_647))
        && new Set(value.map((check) => check.name)).size === value.length;
    if (!valid) throw new Error(`Invalid value for ${key}`);
  }
  return raw as Overrides;
}
function read(manifest: PluginManifest, path: string): StoredSettings {
  if (!existsSync(path)) return { version: manifest.schemaVersion, global: {}, projects: {} };
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!object(raw) || raw.version !== manifest.schemaVersion || !object(raw.projects)) throw new Error("Unsupported plugin settings schema");
  validateOverrides(manifest, raw.global);
  for (const value of Object.values(raw.projects)) validateOverrides(manifest, value, true);
  if (raw.sessions !== undefined) {
    if (!object(raw.sessions)) throw new Error("Invalid plugin session settings");
    for (const [id, value] of Object.entries(raw.sessions)) {
      if (!object(value) || typeof value.project !== "string") throw new Error("Invalid plugin session settings");
      validateSession({ id, cwd: value.project });
      validateOverrides(manifest, value.values, true);
    }
  }
  return raw as unknown as StoredSettings;
}
export function resolvePluginSettings(manifest: PluginManifest, stored: StoredSettings, project: string | null,
  session?: { id: string; project: string | null }): PluginSettings {
  const effective: Overrides = {};
  const sources: PluginSettings["sources"] = {};
  const overrides = project ? stored.projects[project] ?? {} : {};
  const saved = session ? stored.sessions?.[session.id] : undefined;
  // Both the operation and saved overrides must belong to the session's OWN project.
  // An explicit foreign checkout, a move, or a non-Git session never imports them.
  const sessionApplicable = Boolean(project && session?.project && samePath(session.project, project));
  const sessionOverrides = sessionApplicable && project && saved?.project && samePath(saved.project, project) ? saved.values : {};
  for (const [key, field] of Object.entries(manifest.fields)) {
    const source = !field.globalOnly && Object.hasOwn(sessionOverrides, key) ? "session"
      : !field.globalOnly && Object.hasOwn(overrides, key) ? "project" : Object.hasOwn(stored.global, key) ? "global" : "builtin";
    sources[key] = source;
    effective[key] = structuredClone(source === "session" ? sessionOverrides[key]
      : source === "project" ? overrides[key] : source === "global" ? stored.global[key] : field.default);
  }
  return { pluginId: manifest.id, schemaVersion: manifest.schemaVersion, project,
    enabled: effective.enabled === true, global: stored.global, overrides, effective, sources,
    ...(session ? { sessionId: session.id, sessionProject: session.project, sessionApplicable, sessionOverrides } : {}) };
}
export function readPluginSettings(manifest: PluginManifest, cwd?: string, path = pluginSettingsPath(manifest), session?: PluginSession): PluginSettings {
  if (session) validateSession(session);
  return resolvePluginSettings(manifest, read(manifest, path), cwd ? pluginScopeIdentity(manifest, cwd) : null,
    session ? { id: session.id, project: pluginScopeIdentity(manifest, session.cwd) } : undefined);
}
/** Only the authenticated settings route writes overrides; tools never receive this API. */
export function updatePluginSettings(manifest: PluginManifest, scope: "global" | "project" | "session", cwd: string | undefined,
  set: Record<string, SettingValue>, reset: string[], path = pluginSettingsPath(manifest), session?: PluginSession): PluginSettings {
  if (scope !== "global" && scope !== "project" && scope !== "session") throw new Error("Invalid scope");
  if (session) validateSession(session);
  validateOverrides(manifest, set, scope !== "global");
  if (!Array.isArray(reset) || reset.some((key) => typeof key !== "string" || !Object.hasOwn(manifest.fields, key)
    || (scope !== "global" && manifest.fields[key].globalOnly) || Object.hasOwn(set, key))) throw new Error("Invalid reset");
  const project = cwd ? pluginScopeIdentity(manifest, cwd) : null;
  const ownProject = session ? pluginScopeIdentity(manifest, session.cwd) : null;
  if (scope !== "global" && !project) throw new Error(manifest.directoryProjects ? "Select an existing project for project settings" : "Select a Git repository for project settings");
  if (scope === "session" && (!session || !ownProject || !project || !samePath(project, ownProject))) throw new Error("Session overrides only apply to the session's own project");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = lockfile.lockSync(path, { realpath: false, stale: 30_000 });
  let result: PluginSettings;
  try {
    const stored = read(manifest, path);
    if (scope === "session") {
      stored.sessions ??= {};
      if (!stored.sessions[session!.id] || !samePath(stored.sessions[session!.id].project, project!)) stored.sessions[session!.id] = { project: project!, values: {} };
    }
    const values = scope === "global" ? stored.global : scope === "session" ? stored.sessions![session!.id].values : stored.projects[project!] ??= {};
    for (const key of reset) delete values[key];
    Object.assign(values, set);
    if (project && Object.keys(stored.projects[project] ?? {}).length === 0) delete stored.projects[project];
    if (session && stored.sessions?.[session.id] && Object.keys(stored.sessions[session.id].values).length === 0) delete stored.sessions[session.id];
    writePrivateFileAtomicSync(path, JSON.stringify(stored, null, 2));
    result = resolvePluginSettings(manifest, stored, project, session ? { id: session.id, project: ownProject } : undefined);
  } finally { release(); }
  // The write is already committed. A session refresh can reject while its model
  // definitions are applying; it must not suppress other subscribers' revocation.
  for (const listener of [...listeners]) {
    try { listener(manifest.id); }
    catch (error) { console.error("Bundled plugin settings subscriber failed", manifest.id, error); }
  }
  return result;
}
