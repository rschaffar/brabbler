import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { gitExecEnv } from "../git-exec";
import type { Overrides, PluginManifest, PluginSettings, SettingValue } from "./types";

interface StoredSettings { version: number; global: Overrides; projects: Record<string, Overrides> }
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
    return realpathSync(execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { env: gitExecEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  } catch { return null; }
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
      : field.kind === "text" ? typeof value === "string" && value.length <= 256 && !/[\x00-\x1f]/.test(value)
      : field.kind === "enum" ? typeof value === "string" && field.options?.includes(value)
      : Array.isArray(value) && value.length <= 32 && value.every((check) => object(check)
        && Object.keys(check).every((key) => key === "name" || key === "command")
        && typeof check.name === "string" && check.name.trim().length > 0 && check.name.length <= 128
        && typeof check.command === "string" && check.command.trim().length > 0 && check.command.length <= 4096
        && !check.command.includes("\0"))
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
  return raw as unknown as StoredSettings;
}
export function resolvePluginSettings(manifest: PluginManifest, stored: StoredSettings, project: string | null): PluginSettings {
  const effective: Overrides = {};
  const sources: PluginSettings["sources"] = {};
  const overrides = project ? stored.projects[project] ?? {} : {};
  for (const [key, field] of Object.entries(manifest.fields)) {
    const source = Object.hasOwn(overrides, key) ? "project" : Object.hasOwn(stored.global, key) ? "global" : "builtin";
    sources[key] = source;
    effective[key] = structuredClone(source === "project" ? overrides[key] : source === "global" ? stored.global[key] : field.default);
  }
  return { pluginId: manifest.id, schemaVersion: manifest.schemaVersion, project,
    enabled: effective.enabled === true, global: stored.global, overrides, effective, sources };
}
export function readPluginSettings(manifest: PluginManifest, cwd?: string, path = pluginSettingsPath(manifest)): PluginSettings {
  return resolvePluginSettings(manifest, read(manifest, path), cwd ? pluginProjectIdentity(cwd) : null);
}
/** Only the authenticated settings route writes overrides; tools never receive this API. */
export function updatePluginSettings(manifest: PluginManifest, scope: "global" | "project", cwd: string | undefined,
  set: Record<string, SettingValue>, reset: string[], path = pluginSettingsPath(manifest)): PluginSettings {
  if (scope !== "global" && scope !== "project") throw new Error("Invalid scope");
  validateOverrides(manifest, set, scope === "project");
  if (!Array.isArray(reset) || reset.some((key) => typeof key !== "string" || !Object.hasOwn(manifest.fields, key)
    || (scope === "project" && manifest.fields[key].globalOnly) || Object.hasOwn(set, key))) throw new Error("Invalid reset");
  const project = cwd ? pluginProjectIdentity(cwd) : null;
  if (scope === "project" && !project) throw new Error("Select a Git repository for project settings");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = lockfile.lockSync(path, { realpath: false, stale: 30_000 });
  let result: PluginSettings;
  try {
    const stored = read(manifest, path);
    const values = scope === "global" ? stored.global : stored.projects[project!] ??= {};
    for (const key of reset) delete values[key];
    Object.assign(values, set);
    if (project && Object.keys(stored.projects[project] ?? {}).length === 0) delete stored.projects[project];
    writePrivateFileAtomicSync(path, JSON.stringify(stored, null, 2));
    result = resolvePluginSettings(manifest, stored, project);
  } finally { release(); }
  for (const listener of listeners) listener(manifest.id);
  return result;
}
