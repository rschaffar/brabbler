/** Session-local request intent, independent of reasoning effort. */
export type ModelSpeed = "standard" | "fast";

export function isModelSpeed(value: unknown): value is ModelSpeed {
  return value === "standard" || value === "fast";
}

/** The pinned SDK's ChatGPT subscription path, not OpenAI API-key providers. */
export function supportsModelSpeed(model: { provider: string; api?: string } | null | undefined): boolean {
  return model?.provider === "openai-codex" && model.api === "openai-codex-responses";
}
