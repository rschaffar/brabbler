import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";
import { prepareAccountModelRuntime, type AccountModelRuntimeBinding } from "./account-model-runtime";
import type { AccountSelection } from "./provider-accounts";

/**
 * On-demand refresh of pi's remote provider catalogs.
 *
 * pi's built-in model lists are generated when the SDK is built and brabbler
 * pins one SDK version, so a model a provider ships after that release stays
 * invisible until brabbler itself publishes a new version (#914: Kimi for
 * Coding's K2.8). The SDK already carries the missing half: every built-in
 * provider is wrapped in a pi.dev catalog overlay that `ModelRuntime.refresh()`
 * fetches and persists to a scope-local `models-store.json`, keyed by provider.
 * Pi default keeps the CLI-shared file; selected accounts use isolated stores.
 * Restoring that overlay needs no network, which is why "run the pi CLI once"
 * was the known workaround — the CLI refreshes with the network on, and every
 * brabbler request then reads what the CLI left behind. Both of brabbler's own
 * refresh paths ask for the offline half only (`createAgentSessionServices()`
 * and `lib/provider-usage.ts` pass `allowNetwork: false`), so brabbler never
 * filled that file itself.
 *
 * This runs the network pass in brabbler, behind the Models panel's refresh
 * button. It only has to write `models-store.json`: the overlay reaches the UI
 * through the ordinary `/api/models` and `/api/models/enabled` loads, which
 * build a fresh runtime that restores the store.
 *
 * Deliberately never on an unrelated request's path. A pass fetches a catalog
 * per authenticated provider, and a save must not wait on a slow catalog — the
 * same reason `/api/auth/api-key/[provider]` stores the credential itself
 * instead of going through `ModelRuntime.login()`.
 */

/** Bounded like the background refresh the CLI starts in RPC mode. */
const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

/** The parts of a model that decide whether the Models panel has something new to show. */
const CATALOG_METADATA = ["type", "api", "input", "output", "reasoning", "thinkingLevelMap", "promptCache",
  "inputLimits", "contextWindow", "maxTokens", "cost", "compat", "samplingParams", "samplingParamsByThinkingLevel"] as const;
export type CatalogModel = { id: string; name: string; provider: string }
  & Partial<Record<typeof CATALOG_METADATA[number], unknown>>;

/** Sort nested object keys, preserving array order; never serialize request headers. */
function structuredMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredMetadata);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.toLowerCase() !== "headers")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, structuredMetadata(item)]));
  return value;
}

export interface CatalogRefreshResult {
  /** Every provider either refreshed or was skipped cleanly — nothing failed or was aborted. */
  completed: boolean;
  /** The visible model list moved, so cached `/api/models` payloads were dropped. */
  changed: boolean;
  /** Set when the pass could not run at all. `offline` means `PI_OFFLINE` is set. */
  reason?: "offline" | "runtime";
}

export interface CatalogRefreshOptions {
  /** Restrict the pass to these provider ids. Defaults to every refreshable provider. */
  providers?: readonly string[];
  /** Complete selected identity snapshot. Missing or empty means Pi default. */
  accounts?: Readonly<AccountSelection>;
  signal?: AbortSignal;
}

/**
 * Compare catalogs by what the model list actually exposes.
 *
 * A successful revalidation rewrites `checkedAt` and `etag` in the store on
 * every pass, so comparing stored bytes would report a change each time.
 */
export function modelCatalogSignature(models: readonly CatalogModel[]): string {
  return JSON.stringify(models.map((model) => JSON.stringify(structuredMetadata({
    provider: model.provider, id: model.id, name: model.name,
    ...Object.fromEntries(CATALOG_METADATA.map((key) => [key, key === "type" ? model[key] ?? "chat" : model[key]])),
  }))).sort());
}

/** pi reads any `PI_OFFLINE` value, empty included, as "never touch the network". */
export function isModelNetworkDisabled(): boolean {
  return process.env.PI_OFFLINE !== undefined;
}

/**
 * Fetch the remote catalogs once and persist them.
 *
 * `refresh()` is called without `allowNetwork` so the runtime applies its own
 * `PI_OFFLINE` rule instead of brabbler overriding it, and always with
 * `force: true`: someone who pressed the button is asking past the SDK's
 * four-hour freshness window, which is the whole point of a manual refresh.
 * Provider failures are reported rather than thrown; identity validation fails closed.
 */
async function runModelCatalogRefresh(
  options: CatalogRefreshOptions,
  binding: AccountModelRuntimeBinding,
): Promise<CatalogRefreshResult> {
  if (isModelNetworkDisabled()) return { completed: false, changed: false, reason: "offline" };

  const timeout = AbortSignal.timeout(CATALOG_REFRESH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let runtime: ModelRuntime;
  try {
    runtime = await createModelRuntimeWithExtensions(Object.keys(binding.accounts).length ? binding : undefined);
  } catch {
    return { completed: false, changed: false, reason: "runtime" };
  }

  // `createAgentSessionServices()` has already restored the stored overlay, so
  // this is exactly the list the panel is showing right now.
  const before = modelCatalogSignature(runtime.getModels());
  let completed = false;
  try {
    const result = await runtime.refresh({
      ...(options.providers ? { providers: options.providers } : {}),
      force: true,
      signal,
    });
    completed = !result.aborted && result.errors.size === 0;
  } catch {
    completed = false;
  }

  // A pass that failed for one provider can still have persisted another's
  // catalog, so compare regardless of the outcome.
  const changed = modelCatalogSignature(runtime.getModels()) !== before;
  if (changed) invalidateModelsCache();
  return { completed, changed };
}

declare global {
  var __piModelCatalogRefreshPasses: Map<string, Promise<CatalogRefreshResult>> | undefined;
  var __piModelCatalogRefreshScopes: Map<string, Promise<CatalogRefreshResult>> | undefined;
}

function captureRefresh(options: CatalogRefreshOptions) {
  const binding = prepareAccountModelRuntime(options.accounts);
  const providers = options.providers === undefined ? undefined : Object.freeze([...new Set(options.providers)].sort());
  return { binding, options: Object.freeze({ ...options, accounts: binding.accounts, providers }) };
}

/** Serialize whole passes per store, including all-provider/subset overlaps. */
function enqueueRefresh(options: CatalogRefreshOptions, binding: AccountModelRuntimeBinding): Promise<CatalogRefreshResult> {
  const scopes = globalThis.__piModelCatalogRefreshScopes ??= new Map();
  const scope = binding.modelsStorePath;
  const previous = scopes.get(scope);
  const pass = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(() => runModelCatalogRefresh(options, binding)).finally(() => {
      if (scopes.get(scope) === pass) scopes.delete(scope);
    });
  scopes.set(scope, pass);
  return pass;
}

/** Unjoined explicit pass; invalid identities reject before any SDK work. */
export function refreshModelCatalogs(options: CatalogRefreshOptions = {}): Promise<CatalogRefreshResult> {
  const captured = captureRefresh(options);
  return enqueueRefresh(captured.options, captured.binding);
}

/** Join only identical identity/provider sets; different identities never share work. */
export function shareModelCatalogRefresh(options: CatalogRefreshOptions = {}): Promise<CatalogRefreshResult> {
  const captured = captureRefresh({ ...options, signal: undefined });
  const key = JSON.stringify([captured.binding.modelsStorePath, captured.options.providers ?? null]);
  const passes = globalThis.__piModelCatalogRefreshPasses ??= new Map();
  const running = passes.get(key);
  if (running) return running;
  // A disconnected viewer must not abort work another viewer joined.
  const pass = enqueueRefresh(captured.options, captured.binding).finally(() => {
    if (passes.get(key) === pass) passes.delete(key);
  });
  passes.set(key, pass);
  return pass;
}
