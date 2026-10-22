import type { ExtensionContext, InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { onPluginSettingsChange, readPluginSettings } from "./settings";
import type { PluginManifest } from "./types";

/** Pi owns registration and prompt changes. No parallel extension ecosystem. */
export function createPluginExtension(manifest: PluginManifest, cwd: string, tools: ToolDefinition[],
  policyContext?: (ctx: ExtensionContext) => string | undefined,
  options: { registerHidden?: boolean } = {}): InlineExtension {
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
      // Hidden definitions optionally preserve selector/SDK allowlist identity for extension-enabled children.
      // They add no model declarations or callable capabilities while disabled.
      let initiallyEnabled = false;
      try { initiallyEnabled = readPluginSettings(manifest, cwd).enabled; }
      catch { /* Invalid plugin settings never block ordinary session startup. */ }
      if (initiallyEnabled || options.registerHidden) {
        for (const tool of tools) pi.registerTool({ ...tool, exposure: initiallyEnabled ? "model-only" : "hidden" });
        registered = true;
      }
      pi.on("session_start", () => {
        unsubscribe?.();
        sync();
        unsubscribe = onPluginSettingsChange((id) => { if (id === manifest.id) sync(); });
      });
      if (policyContext) {
        // Request-local context: settings never depend on compaction or transcript branch.
        // Preserve Pi's system/tool anchors instead of the ordinary context hook's
        // merged-head restoration. No policy snapshot enters persisted history.
        pi.on("context_with_system", (event, ctx) => {
          const customType = `pi-web:plugin-policy:${manifest.id}`;
          const messages = event.messages.filter((message) => !(message.role === "custom" && message.customType === customType));
          let content: string | undefined;
          try { if (readPluginSettings(manifest, cwd).enabled) content = policyContext(ctx); }
          catch { content = `Plugin ${manifest.id}: current policy is unavailable. Do not infer authorization from earlier policy snapshots; resolve the settings error before using its operations.`; }
          if (content) {
            // A moving request-only footer prevents cache reuse and WebSocket
            // continuation. Anchor after the first user/summary, never the newest
            // turn, and keep sibling plugin policies in registration order.
            const anchor = messages.findIndex((message) => message.role === "user"
              || message.role === "compactionSummary" || message.role === "branchSummary");
            let index = anchor + 1;
            if (anchor === -1) while (messages[index]?.role === "system") index++;
            while (true) {
              const sibling = messages[index];
              if (sibling?.role !== "custom" || typeof sibling.customType !== "string"
                || !sibling.customType.startsWith("pi-web:plugin-policy:")) break;
              index++;
            }
            messages.splice(index, 0, { role: "custom", customType, content, display: false, timestamp: 0 });
          }
          return { messages };
        });
      }
      pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
    },
  };
}
