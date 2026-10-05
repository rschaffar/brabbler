import type { InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { onPluginSettingsChange, readPluginSettings } from "./settings";
import type { PluginManifest } from "./types";

/** Pi owns registration and prompt changes. No parallel extension ecosystem. */
export function createPluginExtension(manifest: PluginManifest, cwd: string, tools: ToolDefinition[]): InlineExtension {
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
      pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
    },
  };
}
