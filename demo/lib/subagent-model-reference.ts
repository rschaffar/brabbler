export type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const SUBAGENT_THINKING_LEVELS = new Set<SubagentThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Whole registered IDs win, even when their final component looks like a thinking level. */
export function splitSubagentModelReference(reference: string, isListed: (value: string) => boolean) {
  const text = reference.trim();
  if (isListed(text)) return { reference: text };
  const colon = text.lastIndexOf(":");
  const level = text.slice(colon + 1) as SubagentThinkingLevel;
  return colon > 0 && SUBAGENT_THINKING_LEVELS.has(level)
    ? { reference: text.slice(0, colon), thinkingLevel: level }
    : { reference: text };
}
