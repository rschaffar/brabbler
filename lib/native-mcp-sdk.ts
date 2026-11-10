import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { McpExtensionOptions, McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";

type Credentials = NonNullable<McpExtensionOptions["credentials"]>;
interface EmptyBackend {
  withLock<T>(fn: (current: undefined) => { result: T; next?: string }): T;
  withLockAsync<T>(fn: (current: undefined) => Promise<{ result: T; next?: string }>): Promise<T>;
}
interface ConfigurationSdk {
  validateServer(name: string, value: unknown): McpServerConfig | string;
  namespace(name: string): string;
}
interface RuntimeSdk {
  createDefaultTransport: NonNullable<McpExtensionOptions["createTransport"]>;
  CredentialStore: new (backend: EmptyBackend) => Credentials;
  StdioTransport: typeof StdioTransport;
  HttpTransport: typeof StreamableHttpTransport;
}
const nativeImport = (file: string) => import(/* webpackIgnore: true */ pathToFileURL(file).href);
function distribution(): string {
  // SDK 1.5.1 exposes neither its Pi-specific validator nor credential-store constructor.
  // Keep this version-scoped bridge separate from host policy and native engines.
  const manifest = findPackageJSON("@earendil-works/pi-coding-agent", pathToFileURL(join(__dirname, "brabbler-native-mcp.mjs")).href);
  if (!manifest || JSON.parse(readFileSync(manifest, "utf8")).version !== "1.5.1") throw new Error("Unsupported native MCP SDK version");
  return join(dirname(manifest), "dist");
}
function transportEntry(dist: string): string {
  const manifest = findPackageJSON("@earendil-works/pi-mcp", pathToFileURL(join(dist, "index.js")).href);
  if (!manifest || JSON.parse(readFileSync(manifest, "utf8")).version !== "1.5.1") throw new Error("Unsupported native MCP transport version");
  return join(dirname(manifest), "dist/index.js");
}
let configuration: Promise<ConfigurationSdk> | undefined;
/** Parsing only: evaluates the public MCP entry, but constructs no transports,
 * credential stores or sessions and never imports the session runtime. */
export function nativeMcpConfigurationSdk(): Promise<ConfigurationSdk> {
  return configuration ??= (async () => {
    const dist = distribution();
    const [core, naming] = await Promise.all([
      nativeImport(join(dist, "core/mcp-servers.js")), nativeImport(transportEntry(dist)),
    ]);
    if (typeof core.validateMcpServerConfig !== "function" || typeof naming.mcpNamespace !== "function") throw new Error("Unsupported native MCP configuration surface");
    return { validateServer: core.validateMcpServerConfig, namespace: naming.mcpNamespace };
  })();
}
let runtime: Promise<RuntimeSdk> | undefined;
export function nativeMcpRuntimeSdk(): Promise<RuntimeSdk> {
  return runtime ??= (async () => {
    const dist = distribution();
    const [native, transports] = await Promise.all([
      nativeImport(join(dist, "extensions/mcp/runtime.js")), nativeImport(transportEntry(dist)),
    ]);
    if ([native.createDefaultTransport, native.McpOAuthCredentialStore, transports.StdioTransport, transports.StreamableHttpTransport].some(value => typeof value !== "function")) throw new Error("Unsupported native MCP runtime surface");
    return { createDefaultTransport: native.createDefaultTransport, CredentialStore: native.McpOAuthCredentialStore,
      StdioTransport: transports.StdioTransport, HttpTransport: transports.StreamableHttpTransport };
  })();
}
/** An actual native store with no data and no disk backend. Authentication is
 * not delegated to it: transports never receive a native OAuth/provider handler. */
export function emptyMcpCredentials(sdk: RuntimeSdk): Credentials {
  const result = <T>(value: { result: T; next?: string }): T => {
    if (value.next !== undefined) throw new Error("MCP OAuth is not supported in this release");
    return value.result;
  };
  return new sdk.CredentialStore({ withLock: fn => result(fn(undefined)), withLockAsync: async fn => result(await fn(undefined)) });
}
