import type { ExtensionContext, InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { onPluginSettingsChange, readPluginSettings } from "./settings";
import type { PluginManifest } from "./types";

/** Pi owns registration and prompt changes. No parallel extension ecosystem. */
export function createPluginExtension(manifest: PluginManifest, cwd: string, tools: ToolDefinition[],
  policyContext?: (ctx: ExtensionContext) => string | undefined): InlineExtension {
  return {
    name: `pi-web-plugin-${manifest.id}`, hidden: true,
    factory(pi) {
      let unsubscribe: (() => void) | undefined;
      let registered = false;
      const sync = () => {
        let enabled = false;
        try { enabled = readPluginSettings(manifest, cwd).enabled; } catch { /* malformed settings fail closed */ }
        if (!enabled && !registered) return;
        for (const tool of tools) pi.registerTool({ ...tool, exposure: enabled ? "model-only" : "hidden" });
        registered = true;
        const names = new Set(tools.map((tool) => tool.name));
        const active = pi.getActiveTools().filter((name) => !names.has(name));
        pi.setActiveTools(enabled ? [...active, ...names] : active);
      };
      // Disabled startup adds no tool declarations or guidance.
      try {
        if (readPluginSettings(manifest, cwd).enabled) {
          for (const tool of tools) pi.registerTool({ ...tool, exposure: "model-only" });
          registered = true;
        }
      } catch { /* Invalid plugin settings never block ordinary session startup. */ }
      pi.on("session_start", () => {
        unsubscribe?.();
        sync();
        unsubscribe = onPluginSettingsChange((id) => { if (id === manifest.id) sync(); });
      });
      if (policyContext) {
        // Request-local context: settings never depend on compaction or transcript branch.
        // No stale policy snapshot is persisted as a user instruction.
        pi.on("context", (event, ctx) => {
          const customType = `pi-web:plugin-policy:${manifest.id}`;
          const messages = event.messages.filter((message) => !(message.role === "custom" && message.customType === customType));
          let content: string | undefined;
          try { if (readPluginSettings(manifest, cwd).enabled) content = policyContext(ctx); }
          catch { content = `Plugin ${manifest.id}: current policy is unavailable. Do not infer authorization from earlier policy snapshots; resolve the settings error before using its operations.`; }
          if (content) messages.push({ role: "custom", customType, content, display: false, timestamp: Date.now() });
          return { messages };
        });
      }
      pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
    },
  };
}
