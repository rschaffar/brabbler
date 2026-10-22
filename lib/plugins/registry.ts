// The sole server composition root. Static imports, not arbitrary frontend loading.
import { gitWorkflowPlugin } from "../../plugins/git-workflow";
import { sessionLaunchPlugin } from "../../plugins/session-launch";
import { acceptancePlugin } from "../../plugins/acceptance";
import type { BundledPlugin } from "./types";
export const bundledPlugins: readonly BundledPlugin[] = [gitWorkflowPlugin, sessionLaunchPlugin, acceptancePlugin];
export function bundledPlugin(id: string): BundledPlugin {
  const plugin = bundledPlugins.find((entry) => entry.manifest.id === id);
  if (!plugin) throw new Error("Unknown bundled plugin");
  return plugin;
}
export function bundledPluginExtensions(cwd: string) {
  return bundledPlugins.map((plugin) => plugin.extension(cwd));
}
