import {
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { accountModelRuntimeOptions, type AccountModelRuntimeBinding } from "./account-model-runtime";

/**
 * ModelRuntime that also includes providers registered by extensions (an
 * extension that calls `registerProvider` / `createProvider` during resource
 * loading). A bare `ModelRuntime.create()` only knows built-in providers plus
 * models.json, so extension-registered providers were invisible to the
 * provider-listing and auth routes.
 *
 * The agent dir acts as cwd so project-local extensions stay out; global
 * package extensions always load. Not cached: these routes need fresh
 * credentials for auth status and login/logout to be truthful.
 */
export async function createModelRuntimeWithExtensions(binding?: AccountModelRuntimeBinding): Promise<ModelRuntime> {
  // Validate before even asking the SDK for its default paths. Never let a supplied
  // null, legacy CredentialStore or partial object silently select Pi default.
  const runtimeOptions = binding === undefined ? undefined : accountModelRuntimeOptions(binding);
  const agentDir = getAgentDir();
  const modelRuntime = runtimeOptions === undefined ? undefined : await ModelRuntime.create(runtimeOptions);
  const services = await createAgentSessionServices({ cwd: agentDir, agentDir, ...(modelRuntime ? { modelRuntime } : {}) });
  return services.modelRuntime;
}
