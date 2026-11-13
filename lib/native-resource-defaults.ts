import { validateNativeResourceSelection, type McpServerSelection, type NativeResourceSelection } from "./session-native-resources";

export interface NativeServerDefault extends McpServerSelection { readonly value: boolean | null }
export interface NativeResourcePreferences {
  readonly servers: readonly NativeServerDefault[];
  readonly codeMode?: boolean | null;
}
export type NativeDefaultChange = { server: McpServerSelection; value: boolean | null } | { codeMode: boolean | null };
export const EMPTY_NATIVE_PREFERENCES: NativeResourcePreferences = Object.freeze({ servers: Object.freeze([]) });
export const nativeServerNamespace = (server: { name: string }) => server.name.replace(/-/g, "_");

export function validateNativePreferences(value: unknown, global = false): NativeResourcePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native-tool preferences");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["servers", "codeMode"].includes(key)) || !Array.isArray(item.servers)
    || item.codeMode !== undefined && item.codeMode !== null && typeof item.codeMode !== "boolean"
    || global && item.codeMode === null) throw new Error("Invalid native-tool preferences");
  const servers = item.servers.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 3
      || ![true, false, null].includes(raw.value) || global && (raw.scope !== "global" || raw.value === null)) throw new Error("Invalid native-tool preferences");
    return { scope: raw.scope, name: raw.name, value: raw.value } as NativeServerDefault;
  });
  const selection = validateNativeResourceSelection({ version: 1, codeMode: false, mcpServers: servers.map(({ scope, name }) => ({ scope, name })) });
  return { ...(item.codeMode !== undefined ? { codeMode: item.codeMode as boolean | null } : {}),
    servers: selection.mcpServers.map(server => ({ ...server, value: servers.find(row => row.name === server.name)!.value })) };
}
export function validateNativeDefaultChange(value: unknown, global = false): NativeDefaultChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native-tool preference change");
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, "codeMode") && Object.keys(item).length === 1) {
    const checked = validateNativePreferences({ servers: [], codeMode: item.codeMode }, global);
    if (checked.codeMode === undefined) throw new Error("Invalid native-tool preference change");
    return { codeMode: checked.codeMode };
  }
  if (Object.keys(item).length !== 2 || !Object.hasOwn(item, "server") || !Object.hasOwn(item, "value")) throw new Error("Invalid native-tool preference change");
  const server = validateNativeResourceSelection({ version: 1, codeMode: false, mcpServers: [item.server] }).mcpServers[0];
  const checked = validateNativePreferences({ servers: [{ ...server, value: item.value }] }, global);
  return { server, value: checked.servers[0].value };
}
export function patchNativePreferences(preferences: NativeResourcePreferences, change: NativeDefaultChange): NativeResourcePreferences {
  if ("codeMode" in change) return { ...preferences, codeMode: change.codeMode };
  return validateNativePreferences({ ...preferences, servers: [...preferences.servers.filter(server => nativeServerNamespace(server) !== nativeServerNamespace(change.server)), { ...change.server, value: change.value }] });
}
/** null means inherit, including an explicit opt-in to inheritance from a legacy snapshot. */
export function nativeDefaultChoice(selection: NativeResourceSelection | null, preferences: NativeResourcePreferences, server: McpServerSelection): boolean | null {
  const override = preferences.servers.find(row => nativeServerNamespace(row) === nativeServerNamespace(server));
  if (override) return override.value === true ? override.scope === server.scope && override.name === server.name : override.value;
  if (!selection) return null;
  return selection.mcpServers.some(row => row.scope === server.scope && row.name === server.name);
}
export function nativeCodeModeChoice(selection: NativeResourceSelection | null, preferences: NativeResourcePreferences): boolean | null {
  return preferences.codeMode !== undefined ? preferences.codeMode : selection?.codeMode ?? null;
}
export class NativeResourceDefaultsLimitError extends Error {
  constructor() { super("Too many selected MCP servers (maximum 128)"); }
}
function composeNativeDefaults(globalSelection: NativeResourceSelection | null, globalPreferences: NativeResourcePreferences,
  projectSelection: NativeResourceSelection | null, projectPreferences: NativeResourcePreferences): NativeResourceSelection | undefined {
  const global = new Map((globalSelection?.mcpServers ?? []).map(server => [nativeServerNamespace(server), server]));
  for (const server of globalPreferences.servers) {
    const key = nativeServerNamespace(server);
    if (server.value) global.set(key, { scope: server.scope, name: server.name }); else global.delete(key);
  }
  const servers = projectSelection ? new Map(projectSelection.mcpServers.map(server => [nativeServerNamespace(server), server])) : new Map(global);
  for (const server of projectPreferences.servers) {
    const key = nativeServerNamespace(server);
    if (server.value === true) servers.set(key, { scope: server.scope, name: server.name });
    else if (server.value === null && global.has(key)) servers.set(key, global.get(key)!);
    else servers.delete(key);
  }
  const globalCodeMode = nativeCodeModeChoice(globalSelection, globalPreferences) ?? false;
  const codeMode = nativeCodeModeChoice(projectSelection, projectPreferences) ?? globalCodeMode;
  if (!globalSelection && !projectSelection && !globalPreferences.servers.length && !projectPreferences.servers.length
    && globalPreferences.codeMode === undefined && projectPreferences.codeMode === undefined) return undefined;
  return { version: 1, codeMode, mcpServers: [...servers.values()] };
}
export function nativeDefaultsServerCount(...args: Parameters<typeof composeNativeDefaults>): number {
  return composeNativeDefaults(...args)?.mcpServers.length ?? 0;
}
export function resolveNativeDefaults(...args: Parameters<typeof composeNativeDefaults>): NativeResourceSelection | undefined {
  const selection = composeNativeDefaults(...args);
  if (!selection) return undefined;
  if (selection.mcpServers.length > 128) throw new NativeResourceDefaultsLimitError();
  return validateNativeResourceSelection(selection);
}
