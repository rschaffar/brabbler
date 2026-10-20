import type { AgentMessage } from "./types";
import { userMessageKey } from "./prompt-recovery";

interface Transcript { messages: AgentMessage[]; entryIds: string[] }

/** Commit live content and its persisted navigation target in one state update. */
export function appendCompletedMessage(
  current: Transcript,
  completed: AgentMessage,
  entryId: string,
  optimisticKey: string | null = null,
): Transcript {
  const last = current.messages.at(-1);
  if (completed.role === "user" && optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
    return {
      messages: optimisticKey === userMessageKey(completed)
        ? current.messages
        : [...current.messages.slice(0, -1), completed],
      entryIds: [...current.entryIds.slice(0, -1), entryId],
    };
  }
  return {
    messages: [...current.messages, completed],
    entryIds: [...current.entryIds, entryId],
  };
}
