import type { PluginManifest } from "../../lib/plugins/types";

export const sessionLaunchManifest: PluginManifest = {
  id: "session-launch", name: "Session Launch", schemaVersion: 1, directoryProjects: true,
  fields: {
    enabled: { label: "Enabled", kind: "boolean", default: true, globalOnly: true,
      description: "Let ordinary coding sessions propose fresh independent sessions. This is not the subagent feature." },
    launch: { label: "Start a session", kind: "enum", default: "ask", options: ["deny", "ask", "allow"],
      description: "Allow skips the approval card, but still requires a user-requested launch. Destination-project settings apply; agents cannot change permissions." },
  },
};
