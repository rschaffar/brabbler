import type { SessionManager } from "@earendil-works/pi-coding-agent";

/** Intent only. Current configuration, project trust and tool policy still own admission. */
export interface McpServerSelection { readonly scope: "global" | "project"; readonly name: string }
export interface NativeResourceSelection {
  readonly version: 1;
  readonly codeMode: boolean;
  readonly mcpServers: readonly McpServerSelection[];
}
export const NATIVE_RESOURCE_SELECTION_TYPE = "pi-web:native-resources";
export const NO_NATIVE_RESOURCES: NativeResourceSelection = Object.freeze({ version: 1, codeMode: false, mcpServers: Object.freeze([]) });

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid native resource selection");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key))
    || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key)
      || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable)) throw new Error("Invalid native resource selection");
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

/** Frozen defensive snapshot; no environment expansion, file reads or resource construction. */
export function validateNativeResourceSelection(value: unknown): NativeResourceSelection {
  const item = record(value, ["version", "codeMode", "mcpServers"]);
  if (item.version !== 1 || typeof item.codeMode !== "boolean" || !Array.isArray(item.mcpServers)
    || item.mcpServers.length > 128) throw new Error("Invalid native resource selection");
  const names = new Set<string>();
  const servers: McpServerSelection[] = [];
  for (let index = 0; index < item.mcpServers.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(item.mcpServers, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Invalid native resource selection");
    const server = record(descriptor.value, ["scope", "name"]);
    if ((server.scope !== "global" && server.scope !== "project") || typeof server.name !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(server.name)) throw new Error("Invalid native resource selection");
    // The native merged namespace treats '-' and '_' as aliases, even across scopes.
    const namespace = server.name.replace(/-/g, "_");
    if (names.has(namespace)) throw new Error("Duplicate MCP resource namespace");
    names.add(namespace);
    servers.push(Object.freeze({ scope: server.scope, name: server.name }));
  }
  servers.sort((a, b) => `${a.scope}:${a.name}` < `${b.scope}:${b.name}` ? -1 : `${a.scope}:${a.name}` > `${b.scope}:${b.name}` ? 1 : 0);
  return Object.freeze({ version: 1, codeMode: item.codeMode, mcpServers: Object.freeze(servers) });
}

type Entry = { type: string; customType?: string; data?: unknown };
/** Session-wide latest intent, not branch-local. A malformed latest marker revokes,
 * rather than resurrecting an older grant. Legacy sessions gain no native resources. */
export function readNativeResourceSelection(entries: readonly Entry[]): NativeResourceSelection {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== NATIVE_RESOURCE_SELECTION_TYPE) continue;
    try { return validateNativeResourceSelection(entry.data); }
    catch { return NO_NATIVE_RESOURCES; }
  }
  return NO_NATIVE_RESOURCES;
}

export function appendNativeResourceSelection(manager: Pick<SessionManager, "appendCustomEntry">, selection: NativeResourceSelection): void {
  manager.appendCustomEntry(NATIVE_RESOURCE_SELECTION_TYPE, validateNativeResourceSelection(selection));
}

/** Resource suppression happens before factories run. Project refusal must never
 * substitute an identically named global server for a selected project server. */
export function effectiveNativeResourceSelection(selection: NativeResourceSelection, options: { chatOnly: boolean; projectTrusted: boolean }): NativeResourceSelection {
  const checked = validateNativeResourceSelection(selection);
  if (options.chatOnly) return NO_NATIVE_RESOURCES;
  return validateNativeResourceSelection({ ...checked, mcpServers: checked.mcpServers.filter(server => server.scope !== "project" || options.projectTrusted) });
}
