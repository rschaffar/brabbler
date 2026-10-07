import type { Agent } from "@earendil-works/pi-agent-core";
import { calculateCost, clampThinkingLevel, normalizeContext, type AssistantMessage, type AssistantMessageEventStream, type Model, type OpenAICodexResponsesOptions } from "@earendil-works/pi-ai";
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options";
import type { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { supportsModelSpeed } from "./model-speed";
import { readSessionModelSpeed } from "./session-model-speed";
import type { SessionEntry } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pi 1.0.0's legacy Codex adapter prices priority, but not the fast response spelling. */
function withReportedFastPricing(
  source: AssistantMessageEventStream,
  observed: () => { tier?: string; model: Model<"openai-codex-responses"> },
): AssistantMessageEventStream {
  const correct = (message: AssistantMessage): AssistantMessage => {
    const { tier, model } = observed();
    if (tier !== "fast" || !supportsModelSpeed(model)) return message;
    // Recompute first: both iterator and result() may observe the same object.
    // Never multiply an already-priced cost, or subscription quota consumption.
    calculateCost(model, message.usage);
    const multiplier = model.id === "gpt-5.5" ? 2.5 : 2;
    for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      message.usage.cost[field] *= multiplier;
    }
    message.usage.cost.total = message.usage.cost.input + message.usage.cost.output
      + message.usage.cost.cacheRead + message.usage.cost.cacheWrite;
    return message;
  };
  return new Proxy(source, {
    get(target, key) {
      if (key === "result") return async () => correct(await target.result());
      if (key === Symbol.asyncIterator) return async function* () {
        for await (const event of target) {
          if (event.type === "done") correct(event.message);
          else if (event.type === "error") correct(event.error);
          yield event;
        }
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * A session-local view, never a mutation of the account/runtime shared by subagents.
 * Bind other methods to the original runtime. Main turns carry the owning
 * agent's active signal AND payload callback in SDK 1.0.0. Cache warming uses
 * its own signal; bug-report/compaction summaries omit that callback, even
 * when a caller supplies the main signal or the same session id.
 */
export function withSessionModelSpeed(
  runtime: ModelRuntime,
  manager: Pick<SessionManager, "getEntries" | "getSessionId">,
  getAgent: () => Pick<Agent, "signal" | "onPayload"> | undefined,
): ModelRuntime {
  const simple = runtime.streamSimple.bind(runtime);
  const full = runtime.stream.bind(runtime);
  const streamSimple: ModelRuntime["streamSimple"] = (model, context, options) => {
    const agent = getAgent();
    const isChatRequest = options?.signal !== undefined && options.signal === agent?.signal
      && options.onPayload !== undefined && options.onPayload === agent?.onPayload;
    if (!isChatRequest || !supportsModelSpeed(model) || options?.sessionId !== manager.getSessionId()) {
      return simple(model, context, options);
    }
    const codexModel = model as Model<"openai-codex-responses">;
    const serviceTier = readSessionModelSpeed(manager.getEntries() as unknown as SessionEntry[]) === "fast"
      ? "priority" : "default";
    // Match the SDK's native simple adapter, while carrying tier into its pricing
    // resolver as a real full option. Payload injection alone loses that information.
    const clamped = options.reasoning ? clampThinkingLevel(codexModel, options.reasoning) : undefined;
    let reportedTier: string | undefined;
    let reportedModel = codexModel;
    const fullOptions: OpenAICodexResponsesOptions = {
      ...buildBaseOptions(codexModel, normalizeContext(context), options),
      toolChoice: options.toolChoice,
      reasoningEffort: clamped === "off" ? undefined : clamped,
      serviceTier,
      onPayload: async (payload, requestModel) => {
        const replacement = await options.onPayload?.(payload, requestModel);
        const effective = replacement === undefined ? payload : replacement;
        if (!isRecord(effective) || effective.service_tier !== serviceTier) {
          throw new Error("A provider payload hook conflicts with this session's model speed");
        }
        return replacement;
      },
      onProviderStreamEvent: async (data, requestModel) => {
        if (isRecord(data) && isRecord(data.response) && typeof data.response.service_tier === "string") {
          reportedTier = data.response.service_tier;
          reportedModel = requestModel as Model<"openai-codex-responses">;
        }
        await options.onProviderStreamEvent?.(data, requestModel);
      },
    };
    // buildBaseOptions intentionally excludes this ModelRuntime-specific hook.
    const source = full(codexModel, context, { ...fullOptions, transformHeaders: options.transformHeaders });
    return withReportedFastPricing(source, () => ({ tier: reportedTier, model: reportedModel }));
  };
  return new Proxy(runtime, {
    get(target, key) {
      if (key === "streamSimple") return streamSimple;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
