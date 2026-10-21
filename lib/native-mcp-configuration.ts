import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";
import { nativeMcpConfigurationSdk } from "./native-mcp-sdk";
import { validateNativeResourceSelection } from "./session-native-resources";

type Scope = "global" | "project";
export interface ConfiguredMcpServer {
  scope: Scope; name: string; transport: "stdio" | "http"; enabled: boolean; projectOverride: boolean;
  eligible: boolean; limitation?: "disabled" | "oauth" | "provider-auth" | "command-helper" | "invalid-endpoint";
}
export interface McpConfigurationListing {
  version: 1; ok: boolean; projectTrusted: boolean; servers: ConfiguredMcpServer[];
  issues: Array<{ scope: Scope; code: "unavailable" | "invalid-document" | "invalid-server" | "invalid-override" | "namespace-collision"; entry?: number }>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const MAX_BYTES = 16 * 1024 * 1024;
/** Fixed native leaf, bounded regular-file capture. Resolve intentional native/Nix
 * leaf symlinks, but never read a special file or silently accept a disappearing
 * captured target. No locks, writes, interpolation or runtime imports. */
function document(file: string): unknown {
  let fd: number | undefined, captured = false;
  try {
    const target = realpathSync(file); captured = true;
    fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_BYTES)) throw new Error();
    const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (length !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error();
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } catch (error) {
    if (!captured && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("MCP configuration is unavailable");
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function supportedMcpTransport(config: McpServerConfig): boolean {
  const value = config as unknown as Record<string, unknown>;
  const http = typeof value.url === "string", stdio = typeof value.command === "string";
  return http !== stdio && (value.timeout === undefined || typeof value.timeout === "number" && Number.isFinite(value.timeout))
    && !(http ? ["command", "args", "env", "cwd"] : ["url", "headers", "oauth", "auth"]).some(key => Object.hasOwn(value, key));
}
function limitation(config: McpServerConfig): ConfiguredMcpServer["limitation"] {
  if (config.enabled === false) return "disabled";
  if ("url" in config) {
    if (config.auth) return "provider-auth";
    if (config.oauth !== undefined) return "oauth";
    try { const url = new URL(config.url); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "invalid-endpoint"; }
    catch { return "invalid-endpoint"; }
    if (Object.values(config.headers ?? {}).some(value => value.startsWith("!"))) return "command-helper";
  } else if (Object.values(config.env ?? {}).some(value => value.startsWith("!"))) return "command-helper";
}
/** Sensitive host-only capture. Never serialize this object to the browser: only
 * its listing is public. Directory approval and project trust belong to the host. */
export async function captureMcpConfiguration(options: { agentDir: string; cwd: string; projectTrusted: boolean }): Promise<{
  listing: McpConfigurationListing; entries: McpServerEntry[];
}> {
  const listing: McpConfigurationListing = { version: 1, ok: true, projectTrusted: options.projectTrusted, servers: [], issues: [] };
  const native = await nativeMcpConfigurationSdk(), servers = new Map<string, McpServerEntry>();
  for (const [scope, file] of [["global", join(options.agentDir, "mcp.json")],
    ...(options.projectTrusted ? [["project", join(options.cwd, ".pi/mcp.json")]] : [])] as Array<[Scope, string]>) {
    let value: unknown;
    try { value = document(file); } catch { listing.issues.push({ scope, code: "unavailable" }); continue; }
    if (value === undefined) continue;
    if (!record(value) || value.mcpServers !== undefined && !record(value.mcpServers)
      || value.autoEnableCodemode !== undefined && typeof value.autoEnableCodemode !== "boolean") {
      listing.issues.push({ scope, code: "invalid-document" }); continue;
    }
    const rows = Object.entries(value.mcpServers ?? {});
    if (rows.length > 1024) { listing.issues.push({ scope, code: "invalid-document" }); continue; }
    for (const [entry, [name, raw]] of rows.entries()) {
      const partial = scope === "project" && record(raw) && raw.command === undefined && raw.url === undefined && raw.type === undefined;
      const base = servers.get(name);
      if (partial && (!base || Object.keys(raw).some(key => !["enabled", "exposure", "toolExposure"].includes(key)))) {
        listing.issues.push({ scope, code: "invalid-override", entry }); continue;
      }
      const config = native.validateServer(name, partial ? { ...base!.config, ...raw as object } : raw);
      try { validateNativeResourceSelection({ version: 1, codeMode: false, mcpServers: [{ scope, name }] }); }
      catch { listing.issues.push({ scope, code: "invalid-server", entry }); continue; }
      if (typeof config === "string" || !supportedMcpTransport(config) || scope === "project" && !partial && "url" in config && config.auth) {
        listing.issues.push({ scope, code: "invalid-server", entry }); continue;
      }
      if ([...servers.keys()].some(other => other !== name && native.namespace(other) === native.namespace(name))) {
        listing.issues.push({ scope, code: "namespace-collision", entry }); continue;
      }
      servers.set(name, partial ? { ...base!, config, override: file } : { name, scope, source: file, config });
    }
  }
  listing.ok = listing.issues.length === 0;
  if (!listing.ok) return { listing, entries: [] };
  const entries = [...servers.values()];
  listing.servers = entries.map(entry => {
    const reason = limitation(entry.config);
    return { scope: entry.scope as Scope, name: entry.name, transport: "url" in entry.config ? "http" : "stdio",
      enabled: entry.config.enabled !== false, projectOverride: !!entry.override, eligible: reason === undefined, ...(reason ? { limitation: reason } : {}) };
  });
  listing.servers.sort((a, b) => a.name.localeCompare(b.name));
  return { listing, entries };
}
/** Public, inert projection only. */
export async function listMcpConfiguration(options: Parameters<typeof captureMcpConfiguration>[0]): Promise<McpConfigurationListing> {
  return (await captureMcpConfiguration(options)).listing;
}
