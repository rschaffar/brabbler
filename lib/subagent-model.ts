import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { splitSubagentModelReference } from "./subagent-model-reference";
export { SUBAGENT_THINKING_LEVELS } from "./subagent-model-reference";

function findModel(runtime: ModelRuntime, reference: string) {
  const slash = reference.indexOf("/");
  if (slash > 0) return runtime.getModel(reference.slice(0, slash), reference.slice(slash + 1));
  const matches = runtime.getModels().filter((model) => model.id === reference);
  if (matches.length > 1) throw new Error(`Subagent model is ambiguous; use provider/modelId: ${reference}`);
  return matches[0];
}

/** Strict host selection: no fuzzy match, auth-based provider selection or unknown-ID fallback. */
export function parseSubagentModel(runtime: ModelRuntime, value: string | undefined) {
  if (!value?.trim()) return undefined;
  const requested = value.trim();
  const parts = splitSubagentModelReference(requested, (reference) => Boolean(findModel(runtime, reference)));
  const model = findModel(runtime, parts.reference);
  if (!model) throw new Error(`Subagent model not found: ${requested}`);
  return { model, ...(parts.thinkingLevel ? { thinkingLevel: parts.thinkingLevel } : {}) };
}
