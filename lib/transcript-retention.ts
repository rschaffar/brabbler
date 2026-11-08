import type { AgentMessage } from "./types";

export interface RetainedTranscript { messages: AgentMessage[]; entryIds: string[] }
export const LIVE_TRANSCRIPT_LIMITS = { maxMessages: 200, maxBytes: 8 * 1024 * 1024 };
const sizes = new WeakMap<AgentMessage, number>();
function payloadBytes(message: AgentMessage): number {
  let size = sizes.get(message);
  if (size === undefined) {
    try { size = JSON.stringify(message).length * 2; }
    catch { size = Number.MAX_SAFE_INTEGER; }
    sizes.set(message, size);
  }
  return size;
}

/** A recent suffix, never an archive. The caller admits trimming only at the live
 * tail, not during deliberate history reading. Keep optimistic/unreconciled
 * entries, active calls and complete call/result dependencies. One indivisible
 * payload/dependency group may exceed the target; these are not heap limits. */
export function retainTranscriptTail<T extends RetainedTranscript>(
  current: T,
  activeCalls: ReadonlySet<string> = new Set(),
  limits = LIVE_TRANSCRIPT_LIMITS,
  protectUnanswered = false,
): T {
  let cut = current.messages.length, bytes = 0;
  while (cut > 0) {
    const next = payloadBytes(current.messages[cut - 1]);
    if (cut < current.messages.length && (current.messages.length - cut >= limits.maxMessages || bytes + next > limits.maxBytes)) break;
    bytes += next; cut--;
  }
  if (!cut) return current;
  const calls = new Map<string, number>(), results = new Map<string, number>();
  current.messages.forEach((message, index) => {
    if (!current.entryIds[index]) cut = Math.min(cut, index);
    if (message.role === "assistant") for (const block of message.content) {
      if (block.type === "toolCall") calls.set(block.toolCallId, index);
    }
    if (message.role === "toolResult") results.set(message.toolCallId, index);
  });
  let previous;
  do {
    previous = cut;
    for (const [id, index] of calls) {
      if (index < cut && (activeCalls.has(id) || (protectUnanswered && !results.has(id)) || (results.get(id) ?? -1) >= cut)) cut = index;
    }
    // The next exclusive `before` cursor must name an actual persisted entry.
    while (cut > 0 && !current.entryIds[cut]) cut--;
  } while (previous !== cut);
  if (!cut) return current;
  return { ...current, messages: current.messages.slice(cut), entryIds: current.entryIds.slice(cut) };
}
