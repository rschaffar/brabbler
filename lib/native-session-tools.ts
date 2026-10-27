import { devNull } from "node:os";
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension,
  type ExtensionAPI, type ExtensionContext, type InlineExtension, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { captureMcpConfiguration } from "./native-mcp-configuration";
import { emptyMcpCredentials, nativeMcpRuntimeSdk } from "./native-mcp-sdk";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import { getProjectTrustDetails, getProjectTrustStatus } from "./project-trust";
import { validateNativeResourceSelection, type NativeResourceSelection } from "./session-native-resources";

const CONTROLS = new Set(["Agent", "get_subagent_result", "steer_subagent", "start_session"]);
const RESOURCES = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
const nativeTool = (name: string) => name === "codemode" || name === "tool_search" || name.startsWith("mcp__") || RESOURCES.has(name);
export interface NativeMcpStatus {
  scope: "global" | "project"; name: string;
  state: "starting" | "connecting" | "connected" | "needs-auth" | "failed" | "disconnected" | "retired" | "blocked" | "unavailable";
  tools?: number;
}
export function resolveMcpEnvironmentValue(value: string, source: Readonly<Record<string, string | undefined>>): string {
  if (value.startsWith("!")) throw new Error("MCP command helpers are not supported");
  return value.replace(/\$\$|\$!|\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (token, braced: string | undefined, bare: string | undefined) => {
    if (token === "$$") return "$";
    if (token === "$!") return "!";
    const name = braced ?? bare!;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return token;
    const replacement = Object.hasOwn(source, name) ? source[name] : undefined;
    if (!replacement) throw new Error("MCP environment reference is unavailable");
    return replacement;
  });
}
export function mcpBaseEnvironment(source: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    /^(PATH|HOME|USER|LOGNAME|LANG|LANGUAGE|LC_[A-Z_]+|TERM|TMPDIR|TMP|TEMP|SHELL|XDG_[A-Z_]+|SSL_CERT_FILE|SSL_CERT_DIR|NIX_SSL_CERT_FILE)$/.test(name)));
}

/** One fixed owner per wrapper. No SDK event prepares/replaces this binding, no
 * credential files, and no in-place reload. Explicit host replacement creates a
 * new owner only after the preceding wrapper has shut down. */
export async function createNativeSessionTools(options: { agentDir: string; cwd: string; selection: NativeResourceSelection }) {
  const selection = validateNativeResourceSelection(options.selection), hasMcp = selection.mcpServers.length > 0;
  const trusted = getProjectTrustStatus(options.cwd, options.agentDir).trusted;
  const capture = hasMcp ? await captureMcpConfiguration({ ...options, projectTrusted: trusted }) : undefined;
  if (capture && !capture.listing.ok) throw new Error("MCP configuration is unavailable");
  const entries = selection.mcpServers.map(server => {
    const entry = capture!.entries.find(entry => entry.scope === server.scope && entry.name === server.name);
    if (!entry || !capture!.listing.servers.find(row => row.scope === server.scope && row.name === server.name)?.eligible) throw new Error("Selected MCP server is unavailable or unsupported");
    const clone = structuredClone(entry);
    if (!selection.codeMode) {
      if (clone.config.exposure === undefined || clone.config.exposure === "codemode") clone.config.exposure = "deferred";
      for (const name of Object.keys(clone.config.toolExposure ?? {})) if (clone.config.toolExposure![name] === "codemode") clone.config.toolExposure![name] = "deferred";
    }
    return clone;
  });
  const sdk = hasMcp ? await nativeMcpRuntimeSdk() : undefined;
  // Reconnects retain the admitted environment and native home/cwd expansion.
  // Changing process configuration requires a new wrapper, not another transport.
  const environment = Object.freeze(hasMcp ? sanitizeProjectCommandEnvironment(process.env) : {});
  const templates = new Map(entries.filter(entry => !("url" in entry.config)).map(entry => [entry,
    sdk!.createDefaultTransport({ ...entry, config: { ...entry.config, env: {} } }, options.cwd, undefined)]));
  const requiresTrust = entries.some(entry => entry.scope === "project" || !!entry.override);
  let retired = false;
  const lifetime = new AbortController(), executions = new Set<Promise<void>>();
  const assertCurrent = () => {
    if (retired) throw new Error("Native session tools are retired");
    if (requiresTrust) {
      // A removed config file does not erase the authority needed by its frozen
      // runtime. The SDK status shortcut for resource-free projects is not a grant.
      const trust = getProjectTrustDetails(options.cwd, options.agentDir);
      if (!(trust.worktreeDecision ?? trust.repositoryTrusted)) throw new Error("Native session project trust was revoked");
    }
  };
  const owned = new Map<string, object>();
  let registry: ((name: string) => object | undefined) | undefined;
  let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
  const admitted = (name: string) => !!registry && owned.has(name) && registry(name) === owned.get(name);
  const api = (pi: ExtensionAPI, allowed: (tool: Pick<ToolDefinition, "name" | "namespace">) => boolean): ExtensionAPI => ({ ...pi,
    registerTool(tool) {
      if (!allowed(tool)) throw new Error("Unexpected native tool registration");
      if (tool.exposure !== "hidden") assertCurrent();
      const execute: typeof tool.execute = (id, input, signal, onUpdate, context) => {
        assertCurrent();
        if (!registry || registry(tool.name) !== execute || owned.get(tool.name) !== execute) throw new Error("Native tool definition is not admitted");
        // SDK 1.4 can wait for capacity before starting a worker. Retirement must
        // cancel already-admitted calls, not only refuse their next entry check.
        const executionSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
        const work = (async () => tool.execute(id, input, executionSignal, onUpdate, context))();
        const settled = work.then(() => { executions.delete(settled); }, () => { executions.delete(settled); });
        executions.add(settled);
        return work;
      };
      pi.registerTool({ ...tool, execute });
      if (tool.exposure === "hidden") owned.delete(tool.name); else owned.set(tool.name, execute);
    },
  });
  const factories: InlineExtension[] = [{ name: "pi-web-native-admission", hidden: true, factory(pi) {
    pi.on("tool_call", event => {
      if (event.parentToolCallId && CONTROLS.has(event.toolName)) return { block: true, reason: "Host controls require a direct model call" };
      if (!nativeTool(event.toolName)) return;
      try { assertCurrent(); if (!admitted(event.toolName)) throw new Error(); }
      catch { return { block: true, reason: "Native tool is not admitted for this session" }; }
    });
  } }];
  if (selection.codeMode) factories.push({ name: "pi-web-native-codemode", hidden: true,
    factory: pi => createCodemodeExtension({ mode: "on", models: false })(api(pi, tool => tool.name === "codemode")) });
  if (selection.codeMode || hasMcp) factories.push({ name: "pi-web-native-tool-search", hidden: true,
    factory: pi => createToolSearchExtension()(api(pi, tool => tool.name === "tool_search")) });
  if (hasMcp) factories.push({ name: "pi-web-native-mcp", hidden: true, factory: pi => createMcpExtension({
    credentials: emptyMcpCredentials(sdk!), logPath: devNull,
    loadConfig: () => { assertCurrent(); return { servers: entries, errors: [], autoEnableCodemode: false }; },
    createTransport(entry) {
      assertCurrent();
      if (!entries.includes(entry)) throw new Error("MCP transport is not admitted");
      const native = sdk!;
      const source = environment, config = entry.config;
      const resolve = (values: Record<string, string> = {}) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolveMcpEnvironmentValue(value, source)]));
      let transport, closing = false;
      if ("url" in config) {
        const headers = resolve(config.headers);
        try { new Headers(headers); } catch { throw new Error("Invalid MCP header configuration"); }
        const fetch = globalThis.fetch;
        // Deliberately omit the supplied OAuth/provider handler, even on 401.
        transport = new native.HttpTransport({ url: config.url, headers, fetch: (input, init) => {
          // Native close may terminate its already-created HTTP session. This
          // does not reopen request/auth/reconnect admission after retirement.
          if (!(closing && init?.method === "DELETE")) assertCurrent();
          return fetch(input, init);
        } });
      } else {
        const env = Object.fromEntries(Object.entries(sanitizeProjectCommandEnvironment({ ...mcpBaseEnvironment(source), ...resolve(config.env) } as NodeJS.ProcessEnv))
          .filter((pair): pair is [string, string] => pair[1] !== undefined));
        if ([...Object.keys(env), ...Object.values(env), config.command, config.cwd, ...(config.args ?? [])].some(value => value?.includes(String.fromCharCode(0)))) throw new Error("Invalid MCP stdio configuration");
        const template = templates.get(entry);
        if (!(template instanceof native.StdioTransport)) throw new Error("Unsupported MCP transport");
        transport = new native.StdioTransport({ ...template.options, env, inheritEnv: false });
      }
      return new Proxy(transport, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key === "start" || key === "send") return (...args: unknown[]) => { assertCurrent(); if (closing) throw new Error("MCP transport is closing"); return Reflect.apply(value, target, args); };
        if (key === "close") return (...args: unknown[]) => { closing = true; return Reflect.apply(value, target, args); };
        return value.bind(target);
      } });
    },
    updateConfig() { throw new Error("Edit native MCP configuration outside this session"); },
    openUrl() { throw new Error("MCP OAuth is not supported in this release"); },
  })({ ...api(pi, tool => RESOURCES.has(tool.name) || entries.some(entry => tool.namespace?.name === `mcp__${entry.name.replace(/-/g, "_")}` && tool.namespace.aliases?.includes(entry.name))),
    getMcpServers: () => [],
    on: ((event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      Reflect.apply(pi.on, pi, [event, (value: { type: string }, ctx: ExtensionContext) => {
        if (retired && value.type !== "session_shutdown") return;
        const ui = { ...ctx.ui, notify: (_message: string, kind?: "info" | "warning" | "error") => {
          if (!retired) ctx.ui.notify("MCP server state changed; inspect selected-server status.", kind);
        } };
        return handler(value, new Proxy(ctx, { get(target, key) { return key === "ui" ? ui : Reflect.get(target, key, target); } }));
      }]);
    }) as ExtensionAPI["on"],
    registerCommand(name, value) { if (name === "mcp") command = value; },
  }) });
  return {
    selection, factories,
    enabled: selection.codeMode || hasMcp,
    bindToolRegistry(inspect: (name: string) => object | undefined) { if (registry) throw new Error("Native registry is already bound"); registry = inspect; },
    retire() { retired = true; lifetime.abort(new Error("Native session tools are retired")); },
    /** Join admitted results, not worker exits; the SDK retains capacity until exit. */
    async settleExecutions() { while (executions.size) await Promise.all([...executions]); },
    status(): NativeMcpStatus[] {
      let blocked = false; try { assertCurrent(); } catch { blocked = true; }
      const completions = !blocked ? command?.getArgumentCompletions?.("reconnect ") : null;
      const rows = Array.isArray(completions) ? completions : [];
      return selection.mcpServers.map(server => {
        if (retired) return { ...server, state: "retired" };
        if (blocked) return { ...server, state: "blocked" };
        const description = rows.find(row => row.value === `reconnect ${server.name}`)?.description;
        const connected = /^connected · (\d+) tools?(?: · resources)?$/.exec(description ?? "");
        if (connected && Number.isSafeInteger(Number(connected[1]))) return { ...server, state: "connected", tools: Number(connected[1]) };
        const state = !description || description === "starting" ? "starting" : description === "connecting…" ? "connecting"
          : description === "needs sign-in" ? "needs-auth" : description.startsWith("failed:") ? "failed" : description === "disconnected" ? "disconnected" : "unavailable";
        return { ...server, state };
      });
    },
  };
}
export type NativeSessionTools = Awaited<ReturnType<typeof createNativeSessionTools>>;
