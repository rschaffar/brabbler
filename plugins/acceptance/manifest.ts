import type { PluginManifest } from "../../lib/plugins/types";

export const acceptanceManifest: PluginManifest = {
  id: "acceptance", name: "Acceptance", schemaVersion: 1, directoryProjects: true,
  fields: {
    enabled: {
      label: "Enabled", kind: "boolean", default: false, globalOnly: true,
      description: "Expose managed acceptance tools and admit new jobs in every project. Disabling cancels jobs that have not started; running jobs continue with browser status and cancellation available. Profiles and history are retained.",
    },
  },
};
