/** Client/server helpers adapted from upstream 0e78bbea. */
export interface ModelContextConfig {
  providers?: Record<string, { modelOverrides?: Record<string, unknown> }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Prefer the active auth method for a dual-auth managed provider. */
export function managedProviderKind(
  id: string,
  oauth: readonly { id: string; loggedIn: boolean }[],
  apiKeys: readonly { id: string; configured: boolean }[],
): "oauth" | "apikey" | null {
  if (oauth.some((provider) => provider.id === id && provider.loggedIn)) return "oauth";
  if (apiKeys.some((provider) => provider.id === id && provider.configured)) return "apikey";
  if (oauth.some((provider) => provider.id === id)) return "oauth";
  if (apiKeys.some((provider) => provider.id === id)) return "apikey";
  return null;
}

export function isOverridesOnlyProvider(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "modelOverrides");
}

/** Change only this budget; deleting it preserves sibling overrides and credentials. */
export function withContextWindowOverride<T extends ModelContextConfig>(
  config: T, providerId: string, modelId: string, value: string | number | undefined,
): T {
  const providers = { ...config.providers };
  const provider = { ...(Object.hasOwn(providers, providerId) ? providers[providerId] : {}) };
  const modelOverrides = { ...provider.modelOverrides };
  const previous = Object.hasOwn(modelOverrides, modelId) ? modelOverrides[modelId] : undefined;
  if (previous !== undefined && !isRecord(previous)) throw new Error("Model override must be an object");
  const override: Record<string, unknown> = { ...previous as Record<string, unknown> | undefined };
  if (value === undefined) delete override.contextWindow;
  else override.contextWindow = value;
  if (Object.keys(override).length) Object.defineProperty(modelOverrides, modelId, { value: override, enumerable: true, configurable: true });
  else delete modelOverrides[modelId];
  if (Object.keys(modelOverrides).length) provider.modelOverrides = modelOverrides;
  else delete provider.modelOverrides;
  if (Object.keys(provider).length) Object.defineProperty(providers, providerId, { value: provider, enumerable: true, configurable: true });
  else delete providers[providerId];
  return { ...config, providers };
}

export class ContextWindowError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(`Context window of ${model} must be a positive number of tokens`);
    this.name = "ContextWindowError";
    this.model = model;
  }
}

/** Typed text must be whole tokens; existing numeric values follow the SDK's >0 schema. */
export function parseContextWindow(value: unknown): number | undefined {
  if (typeof value === "string") {
    const parsed = /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function normalizeContextWindowOverrides<T extends ModelContextConfig>(config: T): T {
  const result = structuredClone(config);
  if (!isRecord(result.providers)) return result;
  for (const [providerId, provider] of Object.entries(result.providers)) {
    if (!isRecord(provider) || !isRecord(provider.modelOverrides)) continue;
    for (const [modelId, override] of Object.entries(provider.modelOverrides)) {
      if (!isRecord(override) || !Object.hasOwn(override, "contextWindow")) continue;
      const parsed = parseContextWindow(override.contextWindow);
      if (parsed === undefined) throw new ContextWindowError(`${providerId}/${modelId}`);
      override.contextWindow = parsed;
    }
  }
  return result;
}
