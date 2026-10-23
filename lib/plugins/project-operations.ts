import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { acquireDirectoryReservation } from "../directory-reservations";
import { allowFileRoot, getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../file-access";
import { samePath } from "../paths";
import { bundledPlugin } from "./registry";
import { readPluginSettings } from "./settings";
import { preparePluginReview } from "./review-store";
import { createProjectOperationHost, projectOperationScheduler } from "./project-operation-host";
import type { LiveProjectOperation } from "./project-operation-host";
import { createFileProjectOperationStore } from "./project-operation-store";
import type { ProjectOperationStore } from "./project-operation-store";

const root = () => join(getAgentDir(), "pi-web", "project-operations");
const key = Symbol.for("pi-web:project-operations/v1");
const host = globalThis as typeof globalThis & { [key]?: Map<string, LiveProjectOperation> };
const live = host[key] ??= new Map<string, LiveProjectOperation>();

function compose(store: ProjectOperationStore, operations?: Map<string, LiveProjectOperation>) {
  return createProjectOperationHost({
    store,
    scheduler: projectOperationScheduler,
    capability(pluginId) {
      const plugin = bundledPlugin(pluginId);
      if (!plugin.projectActions) throw new Error("Plugin does not support project actions");
      return { plugin, adapter: plugin.projectActions };
    },
    enabled: (plugin, cwd) => readPluginSettings(plugin.manifest, cwd).enabled,
    admission: {
      async allowed(cwd) {
        const roots = await getAllowedFileRoots();
        if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots) || !samePath(realpathSync(cwd), cwd)) throw new Error("Access denied: select an allowed physical directory");
      },
      assertInvocation(cwd) {
        const roots = getKnownAllowedFileRoots();
        if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) throw new Error("Invocation directory access changed");
      },
      admitRelated(paths) {
        for (const path of paths) if (existsSync(path) && samePath(path, realpathSync(path))) allowFileRoot(path);
      },
    },
    async observers() {
      // A failed import must not leave its sibling loading beyond run settlement.
      const [rpc, terminal] = await Promise.allSettled([import("../rpc-manager"), import("../terminal-manager")]);
      if (rpc.status === "rejected") throw rpc.reason;
      if (terminal.status === "rejected") throw terminal.reason;
      return (path: string) => rpc.value.hasBusyRpcSessionWithin(path) || terminal.value.hasActiveTerminalWithin(path);
    },
    reserveDirectory: acquireDirectoryReservation,
    prepareReview: preparePluginReview,
  }, operations);
}

/** Internal service constructor. Only storage varies; native plugin, path admission,
 * observers, reservations, review storage and settings remain the secure defaults.
 * Each constructed service owns a separate live map. No route takes these options. */
export function createProjectOperationService(store: ProjectOperationStore = createFileProjectOperationStore(root)) {
  return compose(store);
}

/** Preserve the process-wide HMR owner and the existing route API. */
export const projectOperationHost = compose(createFileProjectOperationStore(root), live);
export const { prepareProjectAction, getProjectOperation, decideProjectOperation, listProjectOperations, projectOperationReview } = projectOperationHost;
