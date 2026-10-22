import type { BundledPlugin } from "../../lib/plugins/types";
import { createAcceptanceExtension } from "../../lib/acceptance/extension";
import { acceptanceManifest } from "./manifest";

/** Only exposure is session-scoped. The shared coordinator owns accepted jobs. */
export const acceptancePlugin: BundledPlugin = {
  manifest: acceptanceManifest,
  extension: createAcceptanceExtension,
};
